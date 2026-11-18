import * as THREE from 'three';
import {
  AssetIssue,
  CustomMapAsset,
  EngineConfigAsset,
  LightbarAssetDef,
  LoadedJsonAssets,
  SeatPartSpec,
} from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { simEventLog } from '../assets/simEventLog';
import { TextureRegistry } from '../assets/textureRegistry';
import { StaticObstacleBVH } from './bvh';
import { CombatSystem } from './combatSystem';
import {
  AvoidanceVehicleProxy,
  computeAvoidanceSteerAndSpeed,
  computePurePursuitLookahead,
  updateImpatienceAndReverse,
} from './drivingAvoidance';
import { playBoundAudioEvent } from './eventBindings';
import { lightbarModeToAssetId, updateLightbarVisuals } from './lightbarSystem';
import {
  getSurfaceHeight,
  pruneLeadingWaypoints,
  TownRoadGraph,
  WorldConfig,
} from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  AssailantActor,
  CivilianVehicle,
  OfficerActor,
  PedestrianActor,
  PoliceUnit,
  VehicleSeatState,
  resolveCrimePrimaryAssailant,
  resolveUnitOfficers,
} from './simActors';
import {
  DrivingMode,
  LightbarMode,
  PoliceUnitGoalId,
  UnitStatus,
  WeatherCondition,
} from './types';
import { createHumanoid, createPoliceCruiser } from './vehicleModels';
import {
  applyVehicleWheelVisuals,
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';
import { createRagdollState, SimVfxManager, stepRagdollPhysics } from './vfx';

const _tmpDoorPos = new THREE.Vector3();

let officerIdSeq = 1;

export function resetOfficerPose(off: OfficerActor, yaw: number): void {
  off.rig.root.rotation.set(0, yaw, 0);
  off.rig.torso.position.y = off.rig.torsoBaseY;
  off.rig.head.rotation.set(0, 0, 0);
  off.rig.leftArm.rotation.set(0, 0, 0);
  off.rig.rightArm.rotation.set(0, 0, 0);
  off.rig.leftLeg.rotation.set(0, 0, 0);
  off.rig.rightLeg.rotation.set(0, 0, 0);
  if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
}

export function applyOfficerSeatedPose(
  off: OfficerActor,
  unit: PoliceUnit,
  seat: VehicleSeatState,
): void {
  const cos = Math.cos(unit.yaw);
  const sin = Math.sin(unit.yaw);
  const lx = seat.localOffset.x;
  const ly = seat.localOffset.y;
  const lz = seat.localOffset.z;

  // Vehicle local (+Z forward, +X left/right depending on yaw) rotation about Y
  const wx = unit.pos.x + lx * cos + lz * sin;
  const wz = unit.pos.z - lx * sin + lz * cos;
  const wy = unit.pos.y + ly - 0.14;

  off.pos.set(wx, wy, wz);
  off.yaw = unit.yaw;

  off.rig.root.visible = true;
  off.rig.root.position.set(wx, wy, wz);
  off.rig.root.rotation.set(0, unit.yaw, 0);
  off.rig.torso.position.y = off.rig.torsoBaseY - 0.32;
  off.rig.head.rotation.set(0, 0, 0);
  off.rig.leftLeg.rotation.set(seat.seatedPitch, 0, 0);
  off.rig.rightLeg.rotation.set(seat.seatedPitch, 0, 0);
  const isDriver = seat.role === 'driver';
  off.rig.leftArm.rotation.set(isDriver ? -0.78 : -0.45, 0, isDriver ? -0.18 : 0);
  off.rig.rightArm.rotation.set(isDriver ? -0.78 : -0.45, 0, isDriver ? 0.18 : 0);
  if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
}

export function seatOffsetToWorld(
  unit: PoliceUnit,
  offset: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const cos = Math.cos(unit.yaw);
  const sin = Math.sin(unit.yaw);
  return out.set(
    unit.pos.x + offset.x * cos + offset.z * sin,
    unit.pos.y,
    unit.pos.z - offset.x * sin + offset.z * cos,
  );
}

export function updateVehicleHinges(unit: PoliceUnit, dt: number): void {
  const openHinges = new Set<string>();
  for (const seat of unit.seats) {
    if (seat.doorOpenTimer > 0) {
      seat.doorOpenTimer = Math.max(0, seat.doorOpenTimer - dt);
      if (seat.hingePartId) openHinges.add(seat.hingePartId);
    }
  }
  for (const [hingeId, hinge] of Object.entries(unit.hinges)) {
    const isOpen = openHinges.has(hingeId) || unit.status === UnitStatus.Dismounting;
    const target = isOpen ? hinge.spec.openAngle : hinge.spec.closedAngle ?? 0;
    const speed = hinge.spec.speed && hinge.spec.speed > 0 ? hinge.spec.speed : 5.5;
    hinge.currentAngle = THREE.MathUtils.damp(hinge.currentAngle, target, speed, dt);
    hinge.object.rotation.set(
      hinge.spec.axis === 'x' ? hinge.currentAngle : 0,
      hinge.spec.axis === 'y' ? hinge.currentAngle : 0,
      hinge.spec.axis === 'z' ? hinge.currentAngle : 0,
    );
  }
}

export function assignOfficerToUnitSeat(
  off: OfficerActor,
  unit: PoliceUnit,
  preferredSeatIndex?: number,
): boolean {
  let seatIdx = -1;
  if (
    preferredSeatIndex !== undefined &&
    unit.seats[preferredSeatIndex] &&
    unit.seats[preferredSeatIndex].occupantOfficerId === null
  ) {
    seatIdx = preferredSeatIndex;
  } else {
    seatIdx = unit.seats.findIndex((s) => s.occupantOfficerId === null);
  }
  if (seatIdx < 0) return false;

  const seat = unit.seats[seatIdx];
  seat.occupantOfficerId = off.id;
  seat.doorOpenTimer = 0.85;

  off.occupiedUnitId = unit.id;
  off.occupiedSeatIndex = seatIdx;
  off.targetUnitId = unit.id;
  off.targetSeatIndex = seatIdx;
  off.boardingState = 'seated';
  off.mountPhase = 'walk';
  off.boardTimer = 0;
  off.ragdoll.active = false;
  off.roamTarget = null;
  if (!unit.officerRefs.includes(off.id)) {
    unit.officerRefs.push(off.id);
    if (!off.unitId) off.unitId = unit.id;
  }
  applyOfficerSeatedPose(off, unit, seat);
  return true;
}

export function ejectOfficerFromSeat(
  off: OfficerActor,
  unit: PoliceUnit,
  staticBvh: StaticObstacleBVH,
  surfaceSource: CustomMapAsset | WorldConfig,
): boolean {
  if (off.occupiedUnitId !== unit.id || off.occupiedSeatIndex === null) return false;
  const seat = unit.seats[off.occupiedSeatIndex];
  if (seat) {
    if (seat.occupantOfficerId === off.id) seat.occupantOfficerId = null;
    seat.doorOpenTimer = 1.05;
    seatOffsetToWorld(unit, seat.exitOffset, off.pos);
  } else {
    off.pos.set(unit.pos.x + 1.35, unit.pos.y, unit.pos.z);
  }
  staticBvh.resolveCircle(off.pos, 0.45);
  off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, surfaceSource);

  off.occupiedUnitId = null;
  off.occupiedSeatIndex = null;
  off.boardingState = 'dismounted';
  off.mountPhase = 'walk';
  off.boardTimer = 0;
  off.ragdoll.active = false;
  off.yaw = unit.yaw + (seat && seat.localOffset.x < 0 ? -Math.PI * 0.35 : Math.PI * 0.35);
  resetOfficerPose(off, off.yaw);
  off.rig.root.position.copy(off.pos);
  off.rig.root.visible = true;
  return true;
}

function buildSeatStatesFromRig(rigSeats: PoliceUnit['rig']['seats'], hinges: PoliceUnit['hinges']): VehicleSeatState[] {
  if (rigSeats.length > 0) {
    return rigSeats.map((s, idx) => ({
      slotIndex: idx,
      role: s.spec.role,
      spec: s.spec,
      localOffset: s.localOffset.clone(),
      enterOffset: new THREE.Vector3(...(s.spec.enterOffset ?? [s.localOffset.x >= 0 ? 1.45 : -1.45, 0, s.localOffset.z])),
      exitOffset: new THREE.Vector3(...(s.spec.exitOffset ?? [s.localOffset.x >= 0 ? 1.45 : -1.45, 0, s.localOffset.z])),
      hingePartId: s.spec.hingePartId,
      hingeRef: s.spec.hingePartId ? hinges[s.spec.hingePartId] : undefined,
      seatedPitch: s.spec.seatedPitch ?? -1.38,
      occupantOfficerId: null,
      doorOpenTimer: 0,
    }));
  }

  // Fallback front driver/passenger seats if custom model omitted explicit seat parts
  const fallbackSpecs: Array<{ spec: SeatPartSpec; local: [number, number, number]; exit: [number, number, number] }> = [
    {
      spec: { role: 'driver', enterOffset: [1.35, 0, 0.25], exitOffset: [1.45, 0, 0.25], seatedPitch: -1.38 },
      local: [0.42, 0.62, 0.22],
      exit: [1.45, 0, 0.25],
    },
    {
      spec: { role: 'passenger', enterOffset: [-1.35, 0, 0.25], exitOffset: [-1.45, 0, 0.25], seatedPitch: -1.38 },
      local: [-0.42, 0.62, 0.22],
      exit: [-1.45, 0, 0.25],
    },
  ];
  return fallbackSpecs.map((f, idx) => ({
    slotIndex: idx,
    role: f.spec.role,
    spec: f.spec,
    localOffset: new THREE.Vector3(...f.local),
    enterOffset: new THREE.Vector3(...(f.spec.enterOffset ?? f.exit)),
    exitOffset: new THREE.Vector3(...f.exit),
    seatedPitch: f.spec.seatedPitch ?? -1.38,
    occupantOfficerId: null,
    doorOpenTimer: 0,
  }));
}

export function spawnPoliceUnits(
  hierarchy: SceneWorldHierarchy,
  config: EngineConfigAsset,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  isSoftwareGl: boolean,
  rng: () => number,
  clickables: THREE.Object3D[],
  onAssetIssue?: (issue: AssetIssue) => void,
  map?: CustomMapAsset,
): { units: PoliceUnit[]; officers: OfficerActor[] } {
  const units: PoliceUnit[] = [];
  const officers: OfficerActor[] = [];
  const palette = config.vehicles.paintPalette;
  const stationBays = map?.stationBays?.length ? map.stationBays : config.vehicles.stationBays;

  stationBays.forEach((bay, idx) => {
    const baseSwatch = palette[Math.floor(rng() * palette.length)] ?? palette[0];
    const baseColorHex = parseInt(baseSwatch.color.replace('#', ''), 16);
    const parkPos = new THREE.Vector3(...bay.parkPos);
    const vehDef = assets.vehicleDefs?.[bay.vehicleKind];
    const resolvedLightbarId = bay.lightbarId ?? vehDef?.defaultLightbarId ?? 'led_array';

    const rig = createPoliceCruiser(
      idx + 1,
      bay.vehicleKind,
      bay.liveryId,
      config.vehicles,
      assets,
      textures,
      isSoftwareGl,
      baseColorHex,
      onAssetIssue,
    );
    rig.root.position.copy(parkPos);
    rig.root.rotation.y = bay.parkYaw;
    rig.clickableMesh.userData.unitId = bay.id;
    rig.cabinCrewGroup.visible = false; // Real seated OfficerActors replace static crew placeholders
    hierarchy.addEntity(rig.root);
    clickables.push(rig.clickableMesh);

    const maxHp =
      vehDef?.maxHp ?? (bay.vehicleKind === 'apc' ? 185 : bay.isHeavyUnit ? 160 : 100);
    const maxArmor =
      vehDef?.maxArmor ?? (bay.vehicleKind === 'apc' ? 150 : bay.isHeavyUnit ? 120 : 45);
    const magSize = config.weapons[bay.weaponKind].magSize;

    const seats = buildSeatStatesFromRig(rig.seats, rig.hinges);
    const chassis = config.vehicles.chassis[bay.vehicleKind] ?? config.vehicles.chassis['sedan'];
    const mass =
      vehDef?.chassis.mass ??
      (bay.isHeavyUnit && bay.vehicleKind === 'van'
        ? chassis.mass
        : bay.isHeavyUnit
        ? Math.max(chassis.mass, 1.85)
        : chassis.mass);

    const unit: PoliceUnit = {
      id: bay.id,
      callsign: bay.callsign,
      bayIndex: idx,
      vehicleKind: bay.vehicleKind,
      liveryId: bay.liveryId,
      lightbarId: resolvedLightbarId,
      baseColorHex,
      isHeavyUnit: bay.isHeavyUnit,
      weaponKind: bay.weaponKind,
      wheelRadius: chassis.wheelRadius,
      halfW: chassis.halfW,
      halfL: chassis.halfL,
      mass,
      rig,
      pos: parkPos.clone(),
      yaw: bay.parkYaw,
      speed: 0,
      dyn: createVehicleDynState(),
      lateralOffset: 0,
      status: UnitStatus.AtStation,
      activeGoal: 'STATION_STANDBY',
      goalReason: 'Parked at precinct bay',
      mounted: true,
      freeRoam: false,
      dismountTimer: 0,
      mountTimer: 0,
      immobilized: false,
      immobilizeTilt: 0,
      lightsActive: false,
      sirensActive: false,
      waypoints: [],
      waypointIndex: 0,
      repathTimer: 0,
      avoidanceSteer: 0,
      damageSmokeTimer: 0,
      smokeAccum: 0,
      lightPhaseOffset: idx * 0.43 + rng() * 0.31,
      lightRateMult: 0.94 + idx * 0.045 + (rng() - 0.5) * 0.03,
      targetCrimeId: null,
      assignedCaseNumber: null,
      assignedRole: null,
      pursuitRole: 'direct',
      officerRefs: [],
      seats,
      hinges: rig.hinges,
      holdTimer: 0,
      stuckTimer: 0,
      impatience: 0,
      reverseTimer: 0,
      reverseSteerDir: 1,
      stallCount: 0,
      towRequested: false,
      beingTowed: false,
    };

    const crewCount = Math.min(Math.max(2, seats.length >= 2 ? 2 : seats.length), 2);
    for (let sIdx = 0; sIdx < crewCount; sIdx++) {
      const seat = seats[sIdx];
      const oRig = createHumanoid(
        bay.isHeavyUnit ? 'heavy_officer' : 'officer',
        assets,
        textures,
        undefined,
        onAssetIssue,
      );
      const oid = `officer-${officerIdSeq++}`;
      oRig.root.userData.unitId = bay.id;
      oRig.root.userData.officerId = oid;
      hierarchy.addEntity(oRig.root);

      const officer: OfficerActor = {
        id: oid,
        unitId: bay.id,
        occupiedUnitId: bay.id,
        occupiedSeatIndex: sIdx,
        boardingState: 'seated',
        targetUnitId: bay.id,
        targetSeatIndex: sIdx,
        assignedCrimeId: null,
        rig: oRig,
        pos: parkPos.clone(),
        yaw: bay.parkYaw,
        hp: maxHp,
        maxHp,
        armor: maxArmor,
        maxArmor,
        weaponKind: bay.weaponKind,
        isHeavy: bay.isHeavyUnit,
        morale: 100,
        cowardiceState: 'steady',
        ragdoll: createRagdollState(),
        fireCooldown: 0.25 + rng() * 0.2,
        muzzleTimer: 0,
        walkPhase: 0,
        ammo: magSize,
        reloadTimer: 0,
        recoilKick: 0,
        strafeSign: sIdx === 0 ? 1 : -1,
        strafeTimer: 1.5 + rng() * 1.5,
        roamTarget: null,
        roamTimer: 0,
        roamPauseTimer: 0,
        mountPhase: 'walk',
        boardTimer: 0,
      };
      if (seat) {
        seat.occupantOfficerId = officer.id;
        applyOfficerSeatedPose(officer, unit, seat);
      }
      unit.officerRefs.push(officer.id);
      officers.push(officer);
    }

    units.push(unit);
  });

  return { units, officers };
}

export function routeUnitToStation(
  unit: PoliceUnit,
  retreatMode: boolean,
  roadGraph: TownRoadGraph,
  config: EngineConfigAsset,
  staticBvh?: StaticObstacleBVH,
  map?: CustomMapAsset,
): void {
  const surface = map ?? config.world;
  const laneOffset = roadGraph.laneOffset;
  const bays = map?.stationBays?.length ? map.stationBays : config.vehicles.stationBays;
  const bay = bays[unit.bayIndex] ?? bays[0];
  const { primary, secondary } = roadGraph.findStationExitNodeIds();
  const primaryNode = roadGraph.getNodeById(primary);
  const secondaryNode = roadGraph.getNodeById(secondary);
  const exitRoadX = primaryNode?.x ?? config.world.roadCoords[1] ?? -75;
  const [apronExitX] = roadGraph.stationExitPoint;
  const apronSurfaceY = surface.surfaceHeights.apron;
  const roadSurfaceY = roadGraph.roadSurfaceY;

  unit.targetCrimeId = null;
  unit.assignedCaseNumber = null;
  unit.assignedRole = null;
  unit.pursuitRole = 'direct';
  unit.lightsActive = retreatMode;
  unit.sirensActive = retreatMode;
  unit.status = retreatMode ? UnitStatus.Retreating : UnitStatus.Returning;
  unit.activeGoal = retreatMode ? 'RETREAT_TO_STATION' : 'RETURN_TO_STATION';
  unit.goalReason = retreatMode ? 'Tactical retreat to precinct' : 'Returning to precinct bay';
  unit.avoidanceSteer = 0;
  unit.stuckTimer = 0;
  unit.reverseTimer = 0;
  unit.stallCount = 0;

  if (!bay) return;

  const entry = roadGraph.findNearestRoadEntryPoint(unit.pos.x, unit.pos.z, staticBvh);
  let pathA = roadGraph.findNodePath(entry.nearestNode.id, primary);
  let pathB =
    secondaryNode && secondary !== primary
      ? roadGraph.findNodePath(entry.nearestNode.id, secondary)
      : pathA;
  if (pathA.length === 0 && pathB.length === 0) {
    const reach = roadGraph.findNearestReachableNode(exitRoadX, bay.parkPos[2], entry.nearestNode.id);
    pathA = reach ? roadGraph.findNodePath(entry.nearestNode.id, reach.id) : [];
    pathB = pathA;
  }
  const chosenPath =
    pathB.length > 0 && (pathA.length === 0 || pathB.length < pathA.length) ? pathB : pathA;
  const wps: THREE.Vector3[] = [];
  if (unit.pos.distanceToSquared(entry.point) > 9) {
    wps.push(entry.point);
  }
  wps.push(...roadGraph.buildLaneWaypoints(chosenPath, undefined, retreatMode));
  pruneLeadingWaypoints(unit.pos, unit.yaw, wps, staticBvh);
  wps.push(new THREE.Vector3(exitRoadX - laneOffset, roadSurfaceY, bay.parkPos[2]));
  wps.push(new THREE.Vector3(apronExitX, apronSurfaceY, bay.parkPos[2]));
  wps.push(new THREE.Vector3(...bay.parkPos));
  unit.waypoints = wps;
  unit.waypointIndex = 0;
}

export function dispatchNearestUnit(
  crime: ActiveCrime,
  units: PoliceUnit[],
  officersById: Map<string, OfficerActor>,
  roadGraph: TownRoadGraph,
  config: EngineConfigAsset,
  drivingMode: DrivingMode,
  audio: JsonAudioSynth | null,
  isBackup = false,
  allowHeavy = false,
  specificUnitId?: string,
  staticBvh?: StaticObstacleBVH,
  map?: CustomMapAsset,
): boolean {
  const surface = map ?? config.world;
  const laneOffset = roadGraph.laneOffset;
  const { primary, secondary } = roadGraph.findStationExitNodeIds();
  const primaryNode = roadGraph.getNodeById(primary);
  const secondaryNode = roadGraph.getNodeById(secondary);
  const exitRoadX = primaryNode?.x ?? config.world.roadCoords[1] ?? -75;
  const [apronExitX] = roadGraph.stationExitPoint;
  const primaryApron = roadGraph.stationZones[0];
  const apronThresholdX = primaryApron
    ? primaryApron.cx + primaryApron.width * 0.5 + 1
    : config.world.apronBounds.maxX + 1;
  const apronSurfaceY = surface.surfaceHeights.apron;
  const roadSurfaceY = roadGraph.roadSurfaceY;

  const mountedAvailable = units.filter(
    (u) =>
      (allowHeavy ? u.isHeavyUnit : !u.isHeavyUnit) &&
      !u.immobilized &&
      (u.status === UnitStatus.AtStation || u.status === UnitStatus.Returning) &&
      u.id !== crime.assignedUnitId &&
      u.targetCrimeId !== crime.id,
  );
  const footRoamAvailable = units.filter(
    (u) =>
      (allowHeavy ? u.isHeavyUnit : !u.isHeavyUnit) &&
      u.freeRoam &&
      u.status === UnitStatus.Engaging &&
      !u.targetCrimeId &&
      u.id !== crime.assignedUnitId,
  );
  const available = mountedAvailable.length > 0 ? mountedAvailable : footRoamAvailable;
  if (available.length === 0) return false;

  let best = specificUnitId
    ? available.find((u) => u.id === specificUnitId) ?? available[0]
    : available[0];
  let bestDist = best.pos.distanceToSquared(crime.pos);
  if (!specificUnitId || best.id !== specificUnitId) {
    for (const u of available) {
      const d = u.pos.distanceToSquared(crime.pos);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
  }

  const alreadyAssignedCount = units.filter(
    (u) => u.targetCrimeId === crime.id && u.status !== UnitStatus.Retreating,
  ).length;

  best.targetCrimeId = crime.id;
  best.assignedCaseNumber = crime.caseNumber;
  best.assignedRole = allowHeavy ? 'tactical' : isBackup ? 'backup' : 'primary';
  best.pursuitRole = 'direct';
  if (!isBackup || !crime.assignedUnitId) {
    crime.assignedUnitId = best.id;
  }
  if (!crime.assignedUnitIds.includes(best.id)) {
    crime.assignedUnitIds.push(best.id);
  }

  if (!best.mounted) {
    if (!crime.inVehiclePursuit && bestDist < 42 * 42) {
      best.freeRoam = false;
      best.status = UnitStatus.Engaging;
      best.activeGoal = 'ENGAGE_ON_FOOT';
      best.goalReason = `Engaging Case #${crime.caseNumber} on foot`;
      playBoundAudioEvent(audio, config, 'dispatch_chirp');
      return true;
    }
    if (best.immobilized) return false;
    best.freeRoam = false;
    best.mounted = true;
    best.mountTimer = 0;
    const crew = resolveUnitOfficers(best, officersById);
    crew.forEach((o, sIdx) => {
      assignOfficerToUnitSeat(o, best, sIdx < best.seats.length ? sIdx : undefined);
    });
  }

  const urgencyNorm = THREE.MathUtils.clamp(crime.urgency / 100, 0, 1);
  const isAggro =
    drivingMode === DrivingMode.Aggressive || urgencyNorm >= 0.65 || best.isHeavyUnit;

  best.lightsActive = true;
  best.sirensActive = urgencyNorm >= 0.42 || drivingMode === DrivingMode.Aggressive;
  best.status = crime.inVehiclePursuit ? UnitStatus.Pursuing : UnitStatus.Responding;
  best.activeGoal = crime.inVehiclePursuit ? 'PURSUE_VEHICLE' : 'RESPOND_TO_CALL';
  best.goalReason = crime.inVehiclePursuit
    ? `Pursuing suspect vehicle (Case #${crime.caseNumber})`
    : `Responding Code ${best.sirensActive ? '3' : '2'} to Case #${crime.caseNumber}`;
  best.repathTimer = 0.75;
  best.avoidanceSteer = 0;
  best.stuckTimer = 0;
  best.reverseTimer = 0;
  best.stallCount = 0;

  const bays = map?.stationBays?.length ? map.stationBays : config.vehicles.stationBays;
  const bay = bays[best.bayIndex] ?? bays[0];
  const wps: THREE.Vector3[] = [];
  const targetNodeId = crime.inVehiclePursuit ? crime.vehicleNextNodeId : crime.nearestNodeId;

  const pullSpot = crime.inVehiclePursuit
    ? crime.vehiclePos.clone()
    : crime.roadPullOverPos.clone();
  if ((isBackup || allowHeavy || alreadyAssignedCount > 0) && !crime.inVehiclePursuit) {
    const side = alreadyAssignedCount % 2 === 1 ? 1 : -1;
    const rank = Math.ceil(Math.max(1, alreadyAssignedCount) * 0.5);
    const shift = (allowHeavy ? -7.6 * rank : 7.2 * rank) * side;
    pullSpot.x += Math.sin(crime.roadPullOverYaw) * shift;
    pullSpot.z += Math.cos(crime.roadPullOverYaw) * shift;
  }

  if (bay && best.pos.x < apronThresholdX) {
    const headingSouth = crime.pos.z >= bay.parkPos[2];
    const laneExitX = exitRoadX + (headingSouth ? -laneOffset : laneOffset);
    wps.push(new THREE.Vector3(apronExitX, apronSurfaceY, bay.parkPos[2]));
    wps.push(new THREE.Vector3(laneExitX, roadSurfaceY, bay.parkPos[2]));

    let startNodeId = primary;
    if (primaryNode && secondaryNode && secondary !== primary) {
      startNodeId = headingSouth
        ? secondaryNode.z >= primaryNode.z
          ? secondaryNode.id
          : primaryNode.id
        : primaryNode.z <= secondaryNode.z
        ? primaryNode.id
        : secondaryNode.id;
    }
    const roadWps = crime.inVehiclePursuit
      ? roadGraph.buildLaneWaypoints(
          roadGraph.findNodePath(startNodeId, targetNodeId),
          pullSpot,
          isAggro,
        )
      : roadGraph.buildRouteToSegmentSpot(
          startNodeId,
          crime.segmentNodeA,
          crime.segmentNodeB,
          pullSpot,
          isAggro,
        );

    for (const wp of roadWps) {
      if (Math.abs(wp.x - exitRoadX) < 6) {
        if (headingSouth && wp.z < bay.parkPos[2] - 2) continue;
        if (!headingSouth && wp.z > bay.parkPos[2] + 2) continue;
      }
      wps.push(wp);
    }
  } else {
    const entry = roadGraph.findNearestRoadEntryPoint(best.pos.x, best.pos.z, staticBvh);
    if (best.pos.distanceToSquared(entry.point) > 9) {
      wps.push(entry.point);
    }
    if (crime.inVehiclePursuit) {
      let nodePath = roadGraph.findNodePath(entry.nearestNode.id, targetNodeId);
      if (nodePath.length === 0) {
        const reach = roadGraph.findNearestReachableNode(pullSpot.x, pullSpot.z, entry.nearestNode.id);
        if (reach) nodePath = roadGraph.findNodePath(entry.nearestNode.id, reach.id);
      }
      wps.push(...roadGraph.buildLaneWaypoints(nodePath, pullSpot, isAggro));
    } else {
      wps.push(
        ...roadGraph.buildRouteToSegmentSpot(
          entry.nearestNode.id,
          crime.segmentNodeA,
          crime.segmentNodeB,
          pullSpot,
          isAggro,
        ),
      );
    }
    pruneLeadingWaypoints(best.pos, best.yaw, wps, staticBvh);
  }

  best.waypoints = wps;
  best.waypointIndex = 0;

  playBoundAudioEvent(audio, config, 'dispatch_chirp');
  simEventLog.info(
    'dispatch',
    `${best.callsign} (${best.assignedRole ?? 'primary'}) dispatched to Case #${crime.caseNumber}`,
    `${crime.type} • ${crime.district} • Urgency ${crime.urgency}`,
  );
  return true;
}

export function dismountUnit(
  unit: PoliceUnit,
  officersById: Map<string, OfficerActor>,
  cowardiceLevel: number,
  staticBvh: StaticObstacleBVH,
  config: EngineConfigAsset,
  rng: () => number,
  freeRoam = false,
  map?: CustomMapAsset,
): void {
  if (!unit.mounted) return;
  const surface = map ?? config.world;
  unit.mounted = false;
  unit.freeRoam = freeRoam;
  unit.dismountTimer = 0;
  unit.mountTimer = 0;
  unit.holdTimer = 0;
  unit.speed = 0;
  unit.dyn.vx = 0;
  unit.dyn.vz = 0;
  unit.dyn.omega = 0;
  if (freeRoam && !unit.targetCrimeId) {
    unit.lightsActive = false;
    unit.sirensActive = false;
  } else {
    unit.lightsActive = true;
    unit.sirensActive = rng() < config.simulation.sirenKeepOnAtSceneChance;
  }

  const rightX = Math.cos(unit.yaw);
  const rightZ = -Math.sin(unit.yaw);
  const fwdX = Math.sin(unit.yaw);
  const fwdZ = Math.cos(unit.yaw);

  const crew = resolveUnitOfficers(unit, officersById);
  crew.forEach((off, idx) => {
    const seat = off.occupiedSeatIndex !== null ? unit.seats[off.occupiedSeatIndex] : unit.seats[idx];
    if (seat) {
      if (seat.occupantOfficerId === off.id) seat.occupantOfficerId = null;
      seat.doorOpenTimer = 1.1;
      seatOffsetToWorld(unit, seat.exitOffset, off.pos);
    } else {
      const sideSign = idx % 2 === 0 ? 1 : -1;
      off.pos.set(
        unit.pos.x + rightX * (0.95 * sideSign) + fwdX * 0.25,
        0,
        unit.pos.z + rightZ * (0.95 * sideSign) + fwdZ * 0.25,
      );
    }
    staticBvh.resolveCircle(off.pos, 0.45);
    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, surface);

    off.occupiedUnitId = null;
    off.occupiedSeatIndex = null;
    off.boardingState = 'dismounted';
    off.yaw = idx % 2 === 0 ? unit.yaw + Math.PI * 0.45 : unit.yaw - Math.PI * 0.45;
    if (off.hp <= 0) off.hp = off.maxHp;
    if (off.armor <= 0) off.armor = off.maxArmor;
    off.ammo = config.weapons[off.weaponKind].magSize;
    off.reloadTimer = 0;
    off.ragdoll.active = false;
    off.roamTarget = null;
    off.roamTimer = 0;
    off.roamPauseTimer = 0;
    off.mountPhase = 'walk';
    off.boardTimer = 0;

    const fearScale = off.isHeavy ? 0.18 : 1.0;
    off.morale = freeRoam
      ? 100
      : Math.max(45, 100 - cowardiceLevel * 40 * fearScale - rng() * 10 * fearScale);
    off.cowardiceState = off.morale < 50 && !off.isHeavy ? 'suppressed' : 'steady';
    resetOfficerPose(off, off.yaw);
    off.rig.torso.position.y = off.rig.torsoBaseY - 0.32;
    off.rig.root.position.copy(off.pos);
    off.rig.root.visible = true;
    off.fireCooldown = 0.2 + idx * 0.14;
  });

  unit.status = UnitStatus.Dismounting;
  unit.activeGoal = freeRoam ? 'MANUAL_FOOT_PATROL' : 'ENGAGE_ON_FOOT';
  unit.goalReason = freeRoam ? 'Dismounting for foot patrol' : 'Dismounting at scene';
}

export interface PoliceUnitUpdateContext {
  units: PoliceUnit[];
  officersById: Map<string, OfficerActor>;
  crimes: ActiveCrime[];
  assailants: AssailantActor[];
  assailantsById: Map<string, AssailantActor>;
  pedestrians: PedestrianActor[];
  allVehicles: AvoidanceVehicleProxy[];
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  config: EngineConfigAsset;
  map?: CustomMapAsset;
  lightbars?: Record<string, LightbarAssetDef>;
  combat: CombatSystem;
  vfx: SimVfxManager;
  audio: JsonAudioSynth | null;
  lightbarMode: LightbarMode;
  drivingMode: DrivingMode;
  weather: WeatherCondition;
  cowardiceLevel: number;
  simTime: number;
  rng: () => number;
}

export function buildAllVehicleProxies(
  units: PoliceUnit[],
  civilianCars: CivilianVehicle[],
  crimes: ActiveCrime[],
  assailantsById: Map<string, AssailantActor>,
): AvoidanceVehicleProxy[] {
  const proxies: AvoidanceVehicleProxy[] = [];
  for (const u of units) {
    if (u.status === UnitStatus.AtStation) continue;
    proxies.push({
      id: u.id,
      x: u.pos.x,
      z: u.pos.z,
      yaw: u.yaw,
      speed: Math.max(0, u.speed),
      halfW: u.halfW,
      halfL: u.halfL,
    });
  }
  for (const c of civilianCars) {
    proxies.push({
      id: c.id,
      x: c.pos.x,
      z: c.pos.z,
      yaw: c.yaw,
      speed: Math.max(0, c.speed),
      halfW: 0.92,
      halfL: 2.24,
    });
  }
  for (const cr of crimes) {
    const primarySuspect = resolveCrimePrimaryAssailant(cr, assailantsById);
    if (cr.inVehiclePursuit && primarySuspect?.alive && cr.vehicleRig) {
      proxies.push({
        id: `getaway-${cr.id}`,
        x: cr.vehiclePos.x,
        z: cr.vehiclePos.z,
        yaw: cr.vehicleYaw,
        speed: Math.max(0, cr.vehicleSpeed),
        halfW: 0.92,
        halfL: 2.24,
      });
    }
  }
  return proxies;
}

/**
 * Priority-ordered Goal-Based AI Evaluator for police units, driven by asset-pack `aiGoals.police`.
 */
function evaluateUnitGoal(
  unit: PoliceUnit,
  crew: OfficerActor[],
  crime: ActiveCrime | undefined,
  primarySuspect: AssailantActor | undefined,
  bayParkPos: [number, number, number] | undefined,
  config: EngineConfigAsset,
): { goal: PoliceUnitGoalId; reason: string } {
  const suspectAlive = Boolean(primarySuspect?.alive);
  const packGoals = [...(config.aiGoals?.police ?? [])].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const goalMap = new Map<string, { enabled: boolean; params?: Record<string, number> }>();
  for (const g of packGoals) {
    goalMap.set(g.id, { enabled: g.enabled !== false, params: g.params });
  }
  const isEnabled = (packId: string): boolean => goalMap.get(packId)?.enabled ?? true;
  const dismountDist = goalMap.get('DISMOUNT_COMBAT')?.params?.dismountDist ?? 22.0;

  // Priority 1: Immobilized vehicle (crew can fight on foot if near active foot crime, else hold)
  if (unit.immobilized && isEnabled('AWAIT_TOW')) {
    if (!unit.mounted && crime && suspectAlive && !crime.inVehiclePursuit) {
      const anyAlive = crew.some((o) => o.hp > 0 && o.cowardiceState !== 'fleeing');
      if (anyAlive) {
        return {
          goal: 'ENGAGE_ON_FOOT',
          reason: `Vehicle disabled — engaging Case #${crime.caseNumber} on foot`,
        };
      }
    }
    return {
      goal: 'IMMOBILIZED_HOLD',
      reason: 'Vehicle disabled / awaiting recovery',
    };
  }

  const anyFleeing = crew.some((o) => o.hp > 0 && o.cowardiceState === 'fleeing');
  const allDead = crew.length > 0 && crew.every((o) => o.hp <= 0);

  // Ordered goal rules matching pack configuration
  const orderedIds =
    packGoals.length > 0
      ? packGoals.map((g) => g.id)
      : [
          'RETREAT_TO_PRECINCT',
          'DEPLOY_NAIL_MAT',
          'DISMOUNT_COMBAT',
          'PURSUE_INTERCEPT',
          'RESPOND_TO_CALL',
          'MANUAL_FOOT_PATROL',
          'BOARD_CRUISER',
          'RETURN_TO_PRECINCT',
          'PARKED_STANDBY',
        ];

  for (const gid of orderedIds) {
    if (!isEnabled(gid)) continue;

    if (
      gid === 'RETREAT_TO_PRECINCT' &&
      (unit.status === UnitStatus.Retreating || anyFleeing || (!unit.mounted && allDead))
    ) {
      return {
        goal: 'RETREAT_TO_STATION',
        reason: allDead
          ? 'Crew incapacitated — emergency return'
          : 'Squad morale broken — retreating to station',
      };
    }

    if (
      gid === 'DEPLOY_NAIL_MAT' &&
      unit.pursuitRole === 'nail_mat' &&
      crime &&
      suspectAlive &&
      crime.inVehiclePursuit &&
      unit.status === UnitStatus.DeployingSpikes
    ) {
      return {
        goal: 'DEPLOY_SPIKES',
        reason: `Staging spike strip ahead of Case #${crime.caseNumber}`,
      };
    }

    if (gid === 'DISMOUNT_COMBAT' && crime && suspectAlive && !crime.inVehiclePursuit) {
      if (!unit.mounted || unit.status === UnitStatus.Dismounting) {
        return {
          goal: 'ENGAGE_ON_FOOT',
          reason: `Engaging suspect on foot (Case #${crime.caseNumber})`,
        };
      }
      if (
        unit.status === UnitStatus.Pursuing &&
        primarySuspect &&
        unit.pos.distanceToSquared(primarySuspect.pos) < dismountDist * dismountDist
      ) {
        return {
          goal: 'ENGAGE_ON_FOOT',
          reason: `Suspect bailed out — dismounting (Case #${crime.caseNumber})`,
        };
      }
    }

    if (gid === 'PURSUE_INTERCEPT' && crime && suspectAlive && crime.inVehiclePursuit) {
      if (!unit.mounted) {
        return {
          goal: 'MOUNT_CREW',
          reason: `Mounting crew for pursuit (Case #${crime.caseNumber})`,
        };
      }
      return {
        goal: 'PURSUE_VEHICLE',
        reason: `Intercepting getaway vehicle (Case #${crime.caseNumber})`,
      };
    }

    if (gid === 'RESPOND_TO_CALL' && crime && suspectAlive) {
      if (!unit.mounted) {
        return {
          goal: 'MOUNT_CREW',
          reason: `Mounting crew to respond (Case #${crime.caseNumber})`,
        };
      }
      return {
        goal: 'RESPOND_TO_CALL',
        reason: `Responding to Case #${crime.caseNumber}`,
      };
    }

    if (gid === 'MANUAL_FOOT_PATROL' && unit.freeRoam && !unit.mounted) {
      return {
        goal: 'MANUAL_FOOT_PATROL',
        reason: 'On foot patrol near cruiser',
      };
    }

    if (gid === 'BOARD_CRUISER' && !unit.mounted) {
      return {
        goal: 'MOUNT_CREW',
        reason: 'Scene clear — remounting cruiser',
      };
    }

    if (gid === 'RETURN_TO_PRECINCT') {
      const atBay =
        bayParkPos !== undefined &&
        Math.hypot(unit.pos.x - bayParkPos[0], unit.pos.z - bayParkPos[2]) < 3.6;
      if (!atBay && unit.status !== UnitStatus.AtStation) {
        return {
          goal: 'RETURN_TO_STATION',
          reason: 'Code 4 — returning to precinct bay',
        };
      }
    }
  }

  return {
    goal: 'STATION_STANDBY',
    reason: 'Parked & ready at station bay',
  };
}

function beginMounting(unit: PoliceUnit, crew: OfficerActor[]): void {
  if (unit.status === UnitStatus.Mounting) return;
  unit.holdTimer = 0;
  unit.mountTimer = 0;
  unit.freeRoam = false;
  crew.forEach((o) => {
    o.mountPhase = 'walk';
    o.boardTimer = 0;
  });
  unit.status = UnitStatus.Mounting;
}

export function updatePoliceUnits(ctx: PoliceUnitUpdateContext, dt: number): void {
  const {
    units,
    officersById,
    crimes,
    assailants,
    assailantsById,
    pedestrians,
    allVehicles,
    roadGraph,
    staticBvh,
    config,
    map,
    lightbars,
    combat,
    vfx,
    audio,
    lightbarMode,
    drivingMode,
    weather,
    cowardiceLevel,
    simTime,
    rng,
  } = ctx;

  const world = map ?? config.world;
  const bays = map?.stationBays?.length ? map.stationBays : config.vehicles.stationBays;
  const primaryApron = roadGraph.stationZones[0];
  const apronThresholdX = primaryApron
    ? primaryApron.cx + primaryApron.width * 0.5 + 1
    : config.world.apronBounds.maxX + 1;
  const isAggro = drivingMode === DrivingMode.Aggressive;
  const gripScale = weather === WeatherCondition.Rain ? 0.68 : 1.0;
  const haloBoost =
    weather === WeatherCondition.Rain || weather === WeatherCondition.HeavyFog ? 1.35 : 1.0;
  const globalLbAsset = lightbars?.[lightbarModeToAssetId(lightbarMode)];

  for (const unit of units) {
    const crew = resolveUnitOfficers(unit, officersById);
    const unitLbAsset = lightbars?.[unit.lightbarId] ?? globalLbAsset;
    updateLightbarVisuals(
      unit.rig,
      lightbarMode,
      unit.lightsActive,
      simTime,
      haloBoost,
      unit.lightPhaseOffset,
      unit.lightRateMult,
      unitLbAsset,
    );

    if (unit.damageSmokeTimer > 0 || unit.immobilized) {
      if (unit.damageSmokeTimer > 0) unit.damageSmokeTimer -= dt;
      unit.smokeAccum += dt;
      if (unit.smokeAccum >= 0.14) {
        unit.smokeAccum = 0;
        const hoodX = unit.pos.x + Math.sin(unit.yaw) * 1.7;
        const hoodZ = unit.pos.z + Math.cos(unit.yaw) * 1.7;
        vfx.spawnSmokePuff(hoodX, 1.05, hoodZ, 0.85, 0.42, 0.7, 2.2);
      }
    }

    const bay = bays[unit.bayIndex];
    let crime = unit.targetCrimeId
      ? crimes.find((c) => c.id === unit.targetCrimeId)
      : undefined;
    let primarySuspect = crime ? resolveCrimePrimaryAssailant(crime, assailantsById) : undefined;

    // Clear stale crime assignment immediately once all crime suspects are neutralized
    if (crime && !primarySuspect?.alive) {
      if (crime.assignedUnitId === unit.id) {
        crime.assignedUnitId = null;
      }
      unit.targetCrimeId = null;
      unit.assignedCaseNumber = null;
      unit.assignedRole = null;
      crime = undefined;
      primarySuspect = undefined;
    }

    // Evaluate highest-priority goal cleanly every frame
    const prevGoal = unit.activeGoal;
    const { goal, reason } = evaluateUnitGoal(
      unit,
      crew,
      crime,
      primarySuspect,
      bay?.parkPos,
      config,
    );
    unit.activeGoal = goal;
    unit.goalReason = reason;

    const syncMountedSeats = () => {
      for (const seat of unit.seats) {
        if (!seat.occupantOfficerId) continue;
        const occupant = officersById.get(seat.occupantOfficerId);
        if (occupant && occupant.boardingState === 'seated') {
          applyOfficerSeatedPose(occupant, unit, seat);
        }
      }
      updateVehicleHinges(unit, dt);
    };

    // --- Goal 1: IMMOBILIZED_HOLD ---
    if (goal === 'IMMOBILIZED_HOLD') {
      const yawState = { yaw: unit.yaw, speed: unit.speed };
      stepVehicleDynamics(
        unit.pos,
        yawState,
        unit.dyn,
        unit.rig.bodyGroup,
        {
          targetSpeed: 0,
          desiredYaw: unit.yaw,
          maxAccel: 0,
          maxBrake: 12.0,
          maxSteerRate: 0.4,
          lateralGrip: 8.5,
          mass: unit.mass,
        },
        dt,
      );
      unit.yaw = yawState.yaw;
      unit.speed = yawState.speed;
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        unit.immobilizeTilt,
        6,
        dt,
      );
      unit.pos.y = THREE.MathUtils.damp(
        unit.pos.y,
        getSurfaceHeight(unit.pos.x, unit.pos.z, world),
        12,
        dt,
      );

      if (unit.mounted && unit.speed < 1.3 && crime && primarySuspect?.alive) {
        dismountUnit(unit, officersById, cowardiceLevel, staticBvh, config, rng, false, map);
      } else {
        for (const off of crew) {
          if (off.boardingState !== 'dismounted' || !off.rig.root.visible) continue;
          if (off.ragdoll.active) {
            stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
          }
        }
      }
      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Goal 3: DEPLOY_SPIKES (while dismounted or positioning) ---
    if (goal === 'DEPLOY_SPIKES' && !unit.mounted) {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.x, 0, 8, dt);
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.z, 0, 8, dt);
      for (const off of crew) {
        if (off.boardingState === 'dismounted' && off.ragdoll.active) {
          stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
        }
      }
      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Goal 4: ENGAGE_ON_FOOT & Goal 7: MANUAL_FOOT_PATROL ---
    if (goal === 'ENGAGE_ON_FOOT' || goal === 'MANUAL_FOOT_PATROL') {
      if (unit.mounted) {
        dismountUnit(
          unit,
          officersById,
          cowardiceLevel,
          staticBvh,
          config,
          rng,
          goal === 'MANUAL_FOOT_PATROL',
          map,
        );
      }

      if (unit.status === UnitStatus.Dismounting) {
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
        unit.dismountTimer += dt;
        const p = THREE.MathUtils.clamp(unit.dismountTimer / 0.72, 0, 1);
        const ease = p * p * (3 - 2 * p);

        const targetTilt = Math.sin(p * Math.PI) * 0.038;
        unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
          unit.rig.bodyGroup.rotation.z,
          targetTilt,
          10,
          dt,
        );

        crew.forEach((off, idx) => {
          const seat = unit.seats[idx];
          const sideSign = idx % 2 === 0 ? 1 : -1;
          if (seat) {
            seat.doorOpenTimer = Math.max(seat.doorOpenTimer, 0.35);
            const fromW = seatOffsetToWorld(unit, seat.localOffset, new THREE.Vector3());
            const toW = seatOffsetToWorld(unit, seat.exitOffset, new THREE.Vector3());
            off.pos.lerpVectors(fromW, toW, ease);
          } else {
            const rightX = Math.cos(unit.yaw);
            const rightZ = -Math.sin(unit.yaw);
            const fwdX = Math.sin(unit.yaw);
            const fwdZ = Math.cos(unit.yaw);
            const lat = THREE.MathUtils.lerp(0.92, 1.56, ease) * sideSign;
            const fwd = THREE.MathUtils.lerp(0.25, 0.35, ease);
            off.pos.set(
              unit.pos.x + rightX * lat + fwdX * fwd,
              0,
              unit.pos.z + rightZ * lat + fwdZ * fwd,
            );
          }
          staticBvh.resolveCircle(off.pos, 0.45);
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);

          off.yaw =
            unit.yaw + sideSign * THREE.MathUtils.lerp(Math.PI * 0.48, 0.25, ease);
          off.walkPhase += dt * 9.5;
          const swing = Math.sin(off.walkPhase) * 0.45 * (1 - Math.max(0, p - 0.75) * 4);
          off.rig.leftLeg.rotation.x = swing;
          off.rig.rightLeg.rotation.x = -swing;
          off.rig.torso.position.y = THREE.MathUtils.lerp(
            off.rig.torsoBaseY - 0.32,
            off.rig.torsoBaseY,
            ease,
          );
          off.rig.rightArm.rotation.x = THREE.MathUtils.lerp(-0.1, -0.58, ease);
          off.rig.leftArm.rotation.x = THREE.MathUtils.lerp(-0.1, -0.5, ease);
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.y = off.yaw;
        });

        if (p >= 1) {
          unit.status = UnitStatus.Engaging;
        }
        unit.rig.root.position.copy(unit.pos);
        unit.rig.root.rotation.y = unit.yaw;
        syncMountedSeats();
        continue;
      }

      unit.status = UnitStatus.Engaging;
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.x, 0, 8, dt);
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.z, 0, 8, dt);

      if (goal === 'MANUAL_FOOT_PATROL' && crew[0]) {
        const nearbyFoot = crimes.find((c) => {
          const p = resolveCrimePrimaryAssailant(c, assailantsById);
          return (
            p?.alive &&
            !c.inVehiclePursuit &&
            c.pos.distanceToSquared(crew[0].pos) < 48 * 48
          );
        });
        if (nearbyFoot) {
          unit.targetCrimeId = nearbyFoot.id;
          unit.assignedCaseNumber = nearbyFoot.caseNumber;
          if (!nearbyFoot.assignedUnitId) nearbyFoot.assignedUnitId = unit.id;
          crime = nearbyFoot;
          primarySuspect = resolveCrimePrimaryAssailant(nearbyFoot, assailantsById);
        }
      }

      // Engage crime suspect or nearest standalone foot assailant if within range
      let combatTarget =
        crime && primarySuspect?.alive && !crime.inVehiclePursuit ? primarySuspect : undefined;
      if (!combatTarget && crew[0]) {
        combatTarget = assailants.find(
          (a) => a.alive && !a.inVehicle && a.pos.distanceToSquared(crew[0].pos) < 40 * 40,
        );
      }

      if (combatTarget) {
        let activeCombatants = 0;
        let fleeingCount = 0;
        crew.forEach((off, idx) => {
          if (off.boardingState !== 'dismounted') return;
          combat.updateOfficerCombat(
            off,
            idx,
            combatTarget!,
            unit.pos,
            cowardiceLevel,
            staticBvh,
            pedestrians,
            audio,
            dt,
          );
          if (off.hp > 0 && off.cowardiceState !== 'fleeing') activeCombatants++;
          if (off.hp > 0 && off.cowardiceState === 'fleeing') fleeingCount++;
        });
        if (activeCombatants === 0 || (crew.length > 0 && fleeingCount >= crew.length)) {
          if (crime && crime.assignedUnitId === unit.id) {
            crime.assignedUnitId = null;
          }
          beginMounting(unit, crew);
        }
      } else {
        crew.forEach((off, idx) => {
          if (off.boardingState === 'dismounted') {
            combat.updateOfficerFreeRoam(off, idx, unit.pos, staticBvh, dt);
          }
        });
      }

      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Goal 2 (if dismounted) & Goal 8: MOUNT_CREW ---
    if (!unit.mounted && (goal === 'MOUNT_CREW' || goal === 'RETREAT_TO_STATION')) {
      beginMounting(unit, crew);
      unit.mountTimer += dt;
      let allBack = true;
      let boardingRollPulse = 0;
      const isPanicRetreat = goal === 'RETREAT_TO_STATION';
      // Hard timeout guarantees SWAT/officers NEVER stall indefinitely
      const forceBoard = unit.mountTimer > 4.4;

      crew.forEach((off, idx) => {
        if (off.boardingState === 'seated') return;

        if (off.hp <= 0) {
          if (off.ragdoll.active) {
            stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
          }
          if (!forceBoard && unit.mountTimer < 2.2) {
            allBack = false;
            return;
          }
          off.hp = off.maxHp;
          off.armor = off.maxArmor;
          assignOfficerToUnitSeat(off, unit, idx < unit.seats.length ? idx : undefined);
          return;
        }

        if (off.ragdoll.active) {
          stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
          off.ragdoll.recoverTimer -= dt * (unit.mountTimer > 1.8 ? 2.5 : 1.0);
          if (off.ragdoll.recoverTimer <= 0 || forceBoard) {
            off.ragdoll.active = false;
            off.hp = Math.max(off.hp, 40);
            off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
            resetOfficerPose(off, off.yaw);
          } else {
            allBack = false;
            return;
          }
        }

        const seat = unit.seats[idx] ?? unit.seats[idx % Math.max(1, unit.seats.length)];
        const sideSign = seat ? (seat.localOffset.x >= 0 ? 1 : -1) : idx % 2 === 0 ? 1 : -1;
        if (seat) {
          seatOffsetToWorld(unit, seat.enterOffset, _tmpDoorPos);
          _tmpDoorPos.y = getSurfaceHeight(_tmpDoorPos.x, _tmpDoorPos.z, world);
        } else {
          const doorX = unit.pos.x + Math.cos(unit.yaw) * (1.3 * sideSign);
          const doorZ = unit.pos.z - Math.sin(unit.yaw) * (1.3 * sideSign);
          _tmpDoorPos.set(doorX, getSurfaceHeight(doorX, doorZ, world), doorZ);
        }
        const origDoorX = _tmpDoorPos.x;
        const origDoorZ = _tmpDoorPos.z;
        staticBvh.resolveCircle(_tmpDoorPos, 0.45);
        const doorShifted = Math.hypot(_tmpDoorPos.x - origDoorX, _tmpDoorPos.z - origDoorZ) > 0.35;

        const targetX = doorShifted ? unit.pos.x : _tmpDoorPos.x;
        const targetZ = doorShifted ? unit.pos.z : _tmpDoorPos.z;

        if (off.mountPhase === 'boarding') {
          allBack = false;
          off.boardingState = 'entering';
          if (seat) seat.doorOpenTimer = Math.max(seat.doorOpenTimer, 0.45);
          off.boardTimer += dt;
          const b = THREE.MathUtils.clamp(off.boardTimer / 0.4, 0, 1);
          const ease = b * b * (3 - 2 * b);
          const cabinPos = seat
            ? seatOffsetToWorld(unit, seat.localOffset, new THREE.Vector3())
            : new THREE.Vector3(
                unit.pos.x + Math.cos(unit.yaw) * (0.42 * sideSign),
                unit.pos.y,
                unit.pos.z - Math.sin(unit.yaw) * (0.42 * sideSign),
              );

          off.pos.x = THREE.MathUtils.lerp(off.pos.x, cabinPos.x, Math.min(1, dt * 8));
          off.pos.z = THREE.MathUtils.lerp(off.pos.z, cabinPos.z, Math.min(1, dt * 8));
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
          off.yaw = unit.yaw;
          off.rig.torso.position.y = THREE.MathUtils.lerp(
            off.rig.torsoBaseY,
            off.rig.torsoBaseY - 0.34,
            ease,
          );
          off.rig.leftLeg.rotation.x = THREE.MathUtils.lerp(0, -1.2, ease);
          off.rig.rightLeg.rotation.x = THREE.MathUtils.lerp(0, -1.1, ease);
          off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, -0.45, 12, dt);
          off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, -0.45, 12, dt);
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.y = off.yaw;

          boardingRollPulse += Math.sin(b * Math.PI) * 0.03 * sideSign;

          if (b >= 1 || forceBoard) {
            off.ammo = config.weapons[off.weaponKind].magSize;
            off.reloadTimer = 0;
            off.roamTarget = null;
            assignOfficerToUnitSeat(off, unit, idx < unit.seats.length ? idx : undefined);
          }
          return;
        }

        const distToCar = Math.hypot(unit.pos.x - off.pos.x, unit.pos.z - off.pos.z);
        const dx = targetX - off.pos.x;
        const dz = targetZ - off.pos.z;
        const dist = Math.hypot(dx, dz);

        off.rig.torso.position.y = THREE.MathUtils.damp(
          off.rig.torso.position.y,
          off.rig.torsoBaseY,
          10,
          dt,
        );
        off.rig.head.rotation.y = THREE.MathUtils.damp(off.rig.head.rotation.y, 0, 10, dt);
        off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, 0, 10, dt);
        off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0, 10, dt);
        off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, 0, 10, dt);
        off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, 0, 10, dt);
        if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;

        if (!forceBoard && dist > 0.85 && distToCar > 1.85) {
          allBack = false;
          const spd = isPanicRetreat ? 6.6 : 5.2;
          const ux = dx / (dist || 1);
          const uz = dz / (dist || 1);
          const prevX = off.pos.x;
          const prevZ = off.pos.z;

          off.pos.x += ux * spd * dt;
          off.pos.z += uz * spd * dt;
          staticBvh.resolveCircle(off.pos, 0.45);

          const progress = Math.hypot(off.pos.x - prevX, off.pos.z - prevZ);
          if (progress < spd * dt * 0.25) {
            off.pos.x += -uz * sideSign * spd * dt;
            off.pos.z += ux * sideSign * spd * dt;
            staticBvh.resolveCircle(off.pos, 0.45);
          }

          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);

          const stepDx = off.pos.x - prevX;
          const stepDz = off.pos.z - prevZ;
          off.yaw =
            stepDx * stepDx + stepDz * stepDz > 1e-6
              ? Math.atan2(stepDx, stepDz)
              : Math.atan2(dx, dz);

          off.walkPhase += dt * (isPanicRetreat ? 15 : 10);
          const swing = Math.sin(off.walkPhase) * (isPanicRetreat ? 0.7 : 0.55);
          off.rig.leftLeg.rotation.x = swing;
          off.rig.rightLeg.rotation.x = -swing;
          if (isPanicRetreat) {
            off.rig.leftArm.rotation.x = -swing * 0.9;
            off.rig.rightArm.rotation.x = swing * 0.9;
          }
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.y = off.yaw;
        } else if (!forceBoard) {
          allBack = false;
          off.mountPhase = 'boarding';
          off.boardTimer = 0;
          if (seat) seat.doorOpenTimer = 0.7;
        } else {
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          assignOfficerToUnitSeat(off, unit, idx < unit.seats.length ? idx : undefined);
        }
      });

      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        boardingRollPulse,
        10,
        dt,
      );

      if (allBack || forceBoard) {
        unit.mounted = true;
        unit.freeRoam = false;
        unit.mountTimer = 0;
        crew.forEach((off, idx) => {
          off.ragdoll.active = false;
          if (off.hp <= 0) off.hp = off.maxHp;
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          if (off.boardingState !== 'seated') {
            assignOfficerToUnitSeat(off, unit, idx < unit.seats.length ? idx : undefined);
          }
        });

        if (isPanicRetreat) {
          routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
        } else if (crime && primarySuspect?.alive) {
          unit.status = crime.inVehiclePursuit ? UnitStatus.Pursuing : UnitStatus.Responding;
          unit.lightsActive = true;
          unit.sirensActive = crime.inVehiclePursuit || crime.urgency >= 42;
          unit.waypoints = [];
          unit.waypointIndex = 0;
          unit.repathTimer = 0;
        } else {
          unit.targetCrimeId = null;
          unit.assignedCaseNumber = null;
          unit.assignedRole = null;
          unit.pursuitRole = 'direct';

          const eligibleCrime = unit.isHeavyUnit
            ? crimes.find(
                (c) =>
                  Boolean(resolveCrimePrimaryAssailant(c, assailantsById)?.alive) &&
                  !c.assignedUnitId &&
                  (c.urgency >= 65 || c.inVehiclePursuit),
              )
            : crimes.find(
                (c) =>
                  Boolean(resolveCrimePrimaryAssailant(c, assailantsById)?.alive) &&
                  !c.assignedUnitId,
              );

          unit.status = UnitStatus.Returning;
          let reassigned = false;
          if (eligibleCrime) {
            reassigned = dispatchNearestUnit(
              eligibleCrime,
              units,
              officersById,
              roadGraph,
              config,
              drivingMode,
              audio,
              false,
              unit.isHeavyUnit,
              unit.id,
              staticBvh,
              map,
            );
          }
          if (!reassigned) {
            routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
          }
        }
      }

      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Goal 10: STATION_STANDBY ---
    if (goal === 'STATION_STANDBY') {
      if (unit.status !== UnitStatus.AtStation && bay) {
        unit.pos.set(...bay.parkPos);
        unit.yaw = bay.parkYaw;
      }
      unit.status = UnitStatus.AtStation;
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.dyn.omega = 0;
      unit.lightsActive = false;
      unit.sirensActive = false;
      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Driving Goals: RETREAT_TO_STATION | PURSUE_VEHICLE | RESPOND_TO_CALL | RETURN_TO_STATION | DEPLOY_SPIKES (mounted) ---
    if (goal === 'RETREAT_TO_STATION' && unit.status !== UnitStatus.Retreating) {
      routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
      simEventLog.warn('dispatch', `${unit.callsign} retreating to station`, reason);
    } else if (
      goal === 'RETURN_TO_STATION' &&
      (unit.status !== UnitStatus.Returning || prevGoal !== 'RETURN_TO_STATION')
    ) {
      routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
    } else if (goal === 'PURSUE_VEHICLE') {
      unit.status = UnitStatus.Pursuing;
    } else if (goal === 'RESPOND_TO_CALL' && unit.status !== UnitStatus.Responding) {
      unit.status = UnitStatus.Responding;
      unit.repathTimer = 0;
    }

    const isPursuit = goal === 'PURSUE_VEHICLE';
    const isSpikeIntercept = goal === 'DEPLOY_SPIKES';
    const isRetreat = goal === 'RETREAT_TO_STATION';

    const rawUrgency = crime ? crime.urgency / 100 : isRetreat ? 0.75 : 0.42;
    const urgencyNorm = THREE.MathUtils.clamp(
      isAggro && crime ? Math.max(rawUrgency, 0.78) + 0.14 : rawUrgency,
      0.24,
      1.0,
    );
    const recklessness = THREE.MathUtils.clamp(
      isPursuit || isAggro ? Math.max(0.75, urgencyNorm) : (urgencyNorm - 0.34) / 0.66,
      0,
      1,
    );

    if (crime && (goal === 'RESPOND_TO_CALL' || goal === 'PURSUE_VEHICLE')) {
      unit.lightsActive = true;
      unit.sirensActive =
        urgencyNorm >= 0.42 || isAggro || unit.impatience >= 0.48;
    }

    if (
      (isPursuit ||
        (goal === 'RESPOND_TO_CALL' && unit.waypointIndex >= unit.waypoints.length)) &&
      crime &&
      primarySuspect?.alive
    ) {
      unit.repathTimer -= dt;
      if (unit.repathTimer <= 0) {
        unit.repathTimer = isPursuit ? 0.48 : 1.6;
        const targetPos = crime.inVehiclePursuit ? crime.vehiclePos : crime.roadPullOverPos;
        const dSq = unit.pos.distanceToSquared(targetPos);

        if (
          crime.inVehiclePursuit &&
          dSq < 42 * 42 &&
          staticBvh.raycastSegment(
            unit.pos.x,
            unit.pos.z,
            crime.vehiclePos.x,
            crime.vehiclePos.z,
          ).clear
        ) {
          const distNow = Math.sqrt(dSq);
          const leadDist = distNow < 6.5 ? 0 : Math.min(11.0, distNow * 0.45);
          const leadX = crime.vehiclePos.x + Math.sin(crime.vehicleYaw) * leadDist;
          const leadZ = crime.vehiclePos.z + Math.cos(crime.vehicleYaw) * leadDist;
          unit.waypoints = [new THREE.Vector3(leadX, roadGraph.roadSurfaceY, leadZ)];
          unit.waypointIndex = 0;
        } else if (unit.pos.x > apronThresholdX - 5) {
          const entry = roadGraph.findNearestRoadEntryPoint(
            unit.pos.x,
            unit.pos.z,
            staticBvh,
          );
          const wps: THREE.Vector3[] = [];
          if (unit.pos.distanceToSquared(entry.point) > 9) {
            wps.push(entry.point);
          }
          if (crime.inVehiclePursuit) {
            let path = roadGraph.findNodePath(entry.nearestNode.id, crime.vehicleNextNodeId);
            if (path.length === 0) {
              const reach = roadGraph.findNearestReachableNode(targetPos.x, targetPos.z, entry.nearestNode.id);
              if (reach) path = roadGraph.findNodePath(entry.nearestNode.id, reach.id);
            }
            wps.push(...roadGraph.buildLaneWaypoints(path, targetPos, recklessness > 0.35));
          } else {
            wps.push(
              ...roadGraph.buildRouteToSegmentSpot(
                entry.nearestNode.id,
                crime.segmentNodeA,
                crime.segmentNodeB,
                targetPos,
                recklessness > 0.35,
              ),
            );
          }
          pruneLeadingWaypoints(unit.pos, unit.yaw, wps, staticBvh);
          unit.waypoints = wps;
          unit.waypointIndex = 0;
        }
      }
    }

    const chassis = config.vehicles.chassis[unit.vehicleKind] ?? config.vehicles.chassis['sedan'];
    const urgencyCruise = THREE.MathUtils.lerp(11.5, 24.6, urgencyNorm);
    const baseCruise = (isRetreat ? 17.5 : urgencyCruise) * chassis.chassisScale;
    const maxCruise =
      isPursuit || isSpikeIntercept
        ? Math.max(baseCruise, THREE.MathUtils.lerp(19.0, 25.8, urgencyNorm) * chassis.chassisScale)
        : baseCruise;
    const maxAccel =
      THREE.MathUtils.lerp(
        5.8,
        11.8,
        Math.max(urgencyNorm, isPursuit || isSpikeIntercept ? 0.78 : 0),
      ) * chassis.chassisScale;
    const maxBrake = 12.6;
    const maxSteerRate =
      THREE.MathUtils.lerp(
        1.85,
        2.85,
        Math.max(urgencyNorm, isPursuit || isSpikeIntercept ? 0.74 : 0),
      ) * chassis.maxSteerScale;

    if (unit.waypointIndex >= unit.waypoints.length) {
      if (goal === 'RESPOND_TO_CALL') {
        const canPanicBeforeStop =
          !unit.isHeavyUnit && cowardiceLevel > 0.74 && rng() < (cowardiceLevel - 0.65) * 0.75;
        if (canPanicBeforeStop) {
          if (crime && crime.assignedUnitId === unit.id) {
            crime.assignedUnitId = null;
          }
          routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
        } else {
          dismountUnit(unit, officersById, cowardiceLevel, staticBvh, config, rng, false, map);
        }
      } else if (goal === 'PURSUE_VEHICLE') {
        unit.repathTimer = 0;
      } else if (goal === 'DEPLOY_SPIKES') {
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
      } else {
        if (bay) {
          unit.pos.set(...bay.parkPos);
          unit.yaw = bay.parkYaw;
        }
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
        unit.dyn.omega = 0;
        unit.dyn.bodyPitch = 0;
        unit.dyn.bodyRoll = 0;
        unit.lateralOffset = 0;
        unit.avoidanceSteer = 0;
        unit.stuckTimer = 0;
        unit.impatience = 0;
        unit.reverseTimer = 0;
        unit.stallCount = 0;
        unit.immobilized = false;
        unit.immobilizeTilt = 0;
        unit.status = UnitStatus.AtStation;
        unit.activeGoal = 'STATION_STANDBY';
        unit.goalReason = 'Parked & ready at station bay';
        unit.assignedCaseNumber = null;
        unit.assignedRole = null;
        unit.pursuitRole = 'direct';
        unit.lightsActive = false;
        unit.sirensActive = false;
        unit.freeRoam = false;
        unit.mountTimer = 0;
        unit.dismountTimer = 0;
        unit.damageSmokeTimer = 0;
        unit.rig.bodyGroup.rotation.set(0, 0, 0);
        unit.rig.lightbar.detached = false;
        unit.rig.lightbar.headlightLeftDetached = false;
        unit.rig.lightbar.headlightRightDetached = false;
        unit.rig.lightbar.taillightLeftDetached = false;
        unit.rig.lightbar.taillightRightDetached = false;
        unit.rig.wheels.forEach((w) => {
          w.userData.bentAmount = 0;
          w.rotation.z = 0;
        });
        crew.forEach((o) => {
          o.hp = o.maxHp;
          o.armor = o.maxArmor;
          o.ammo = config.weapons[o.weaponKind].magSize;
          o.morale = 100;
          o.cowardiceState = 'steady';
          o.ragdoll.active = false;
          o.mountPhase = 'walk';
          o.boardTimer = 0;
        });
      }
    } else {
      const wp = unit.waypoints[unit.waypointIndex];
      const dx = wp.x - unit.pos.x;
      const dz = wp.z - unit.pos.z;
      const dist = Math.hypot(dx, dz);
      const isFinalWp = unit.waypointIndex === unit.waypoints.length - 1;
      const fwdX = Math.sin(unit.yaw);
      const fwdZ = Math.cos(unit.yaw);
      const forwardDot = dx * fwdX + dz * fwdZ;

      if (
        dist < (isFinalWp ? 3.2 : 5.2) ||
        (!isFinalWp &&
          dist < 14 &&
          forwardDot < 1.0 &&
          staticBvh.raycastSegment(
            unit.pos.x,
            unit.pos.z,
            unit.waypoints[unit.waypointIndex + 1].x,
            unit.waypoints[unit.waypointIndex + 1].z,
          ).clear)
      ) {
        unit.waypointIndex++;
      } else {
        const lookDist = isFinalWp ? dist : 7.5 + Math.min(4.5, Math.abs(unit.speed) * 0.24);
        const aim = computePurePursuitLookahead(
          unit.pos,
          unit.waypoints,
          unit.waypointIndex,
          lookDist,
        );
        const baseDesiredYaw = Math.atan2(aim.targetX - unit.pos.x, aim.targetZ - unit.pos.z);

        let upcomingCornerFactor = 1.0;
        if (dist < 16 && unit.waypointIndex + 1 < unit.waypoints.length) {
          const nextWp = unit.waypoints[unit.waypointIndex + 1];
          const ndx = nextWp.x - wp.x;
          const ndz = nextWp.z - wp.z;
          if (ndx * ndx + ndz * ndz > 4) {
            const nextYaw = Math.atan2(ndx, ndz);
            const bend = Math.abs(normalizeAngle(nextYaw - baseDesiredYaw));
            if (bend > 0.42) {
              upcomingCornerFactor = THREE.MathUtils.lerp(0.42, 0.72, recklessness);
            }
          }
        } else if (isFinalWp && !isPursuit && dist < 13) {
          upcomingCornerFactor = THREE.MathUtils.clamp(dist / 13, 0.25, 1.0);
        }

        const absYawDiff = Math.abs(normalizeAngle(baseDesiredYaw - unit.yaw));
        const curTurnFactor =
          absYawDiff > 1.15
            ? 0.28
            : absYawDiff > 0.65
            ? THREE.MathUtils.lerp(0.42, 0.58, recklessness)
            : absYawDiff > 0.3
            ? THREE.MathUtils.lerp(0.65, 0.82, recklessness)
            : 1.0;
        const baseGoalSpeed = maxCruise * Math.min(upcomingCornerFactor, curTurnFactor);

        const avoid = computeAvoidanceSteerAndSpeed({
          selfId: unit.id,
          pos: unit.pos,
          yaw: unit.yaw,
          speed: Math.abs(unit.speed),
          selfHalfW: unit.halfW,
          selfHalfL: unit.halfL,
          baseDesiredYaw,
          baseSpeed: baseGoalSpeed,
          prevSteerBias: unit.avoidanceSteer,
          canOvertake: (urgencyNorm >= 0.45 || unit.sirensActive) && !isFinalWp,
          allVehicles,
          pedestrians,
          staticBvh,
          dt,
          recklessness,
          impatience: unit.impatience,
          targetVehicleId: isPursuit && crime ? `getaway-${crime.id}` : undefined,
        });
        unit.avoidanceSteer = avoid.nextSteerBias;
        unit.debugAvoidActive =
          avoid.wallBlocked || avoid.vehicleBlocked || Math.abs(avoid.nextSteerBias) > 0.05;
        unit.lateralOffset = 0;

        const revState = {
          impatience: unit.impatience,
          stuckTimer: unit.stuckTimer,
          reverseTimer: unit.reverseTimer,
          reverseSteerDir: unit.reverseSteerDir,
          stallCount: unit.stallCount,
        };
        const revStep = updateImpatienceAndReverse(revState, {
          baseGoalSpeed,
          actualSpeed: unit.speed,
          avoid,
          patienceRate: 0.22 + urgencyNorm * 0.4,
          reverseThresholdSec: THREE.MathUtils.lerp(1.9, 1.05, urgencyNorm),
          reverseDurationSec: 1.25,
          dt,
        });
        unit.impatience = revState.impatience;
        unit.stuckTimer = revState.stuckTimer;
        unit.reverseTimer = revState.reverseTimer;
        unit.reverseSteerDir = revState.reverseSteerDir;
        unit.stallCount = revState.stallCount ?? 0;

        if (revStep.justFinishedReverse) {
          if (crime && primarySuspect?.alive && unit.pos.x > apronThresholdX) {
            unit.repathTimer = 0;
          } else if (goal === 'RETURN_TO_STATION' || goal === 'RETREAT_TO_STATION') {
            routeUnitToStation(unit, goal === 'RETREAT_TO_STATION', roadGraph, config, staticBvh, map);
          }
        }

        const yawState = { yaw: unit.yaw, speed: unit.speed };
        const signedSpeed = stepVehicleDynamics(
          unit.pos,
          yawState,
          unit.dyn,
          unit.rig.bodyGroup,
          {
            targetSpeed: revStep.isReversing ? -4.6 : avoid.speedCap,
            desiredYaw: avoid.desiredYaw,
            maxAccel,
            maxBrake,
            maxSteerRate,
            lateralGrip: THREE.MathUtils.lerp(6.8, 5.2, recklessness) * gripScale,
            mass: unit.mass,
            reverseTurnDir: revStep.isReversing ? unit.reverseSteerDir : 0,
          },
          dt,
        );
        unit.yaw = yawState.yaw;
        unit.speed = signedSpeed;
        unit.pos.y = THREE.MathUtils.damp(
          unit.pos.y,
          getSurfaceHeight(unit.pos.x, unit.pos.z, world),
          12,
          dt,
        );

        applyVehicleWheelVisuals(
          unit.rig.wheels,
          unit.rig.frontWheels,
          unit.speed,
          unit.dyn.steerAngle,
          unit.wheelRadius,
          dt,
        );
      }
    }

    unit.rig.root.position.copy(unit.pos);
    unit.rig.root.rotation.y = unit.yaw;
    syncMountedSeats();
  }
}

