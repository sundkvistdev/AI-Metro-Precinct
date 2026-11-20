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
import { isExperimentalComplexMeshesEnabled } from '../assets/jsonModelBuilder';
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
import { applyRigidHumanoidPose } from './humanoidAnim';
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
import { getPrecinctDoorPos } from './townBuilder';
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

function getSeatedTorsoScaleY(vehicleKind: string): number {
  switch (vehicleKind) {
    case 'sedan':
      return 0.76;
    case 'suv':
      return 0.86;
    case 'van':
      return 0.92;
    case 'apc':
      return 0.9;
    default:
      return 0.82;
  }
}

export function resetOfficerPose(off: OfficerActor, yaw: number): void {
  off.rig.root.rotation.set(0, yaw, 0);
  applyRigidHumanoidPose(off.rig, 'idle', { snap: true });
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

  // World position mirrors seat transform for AI/distance queries while scene-graph rig stays parented under unit.rig.root
  const wx = unit.pos.x + lx * cos + lz * sin;
  const wz = unit.pos.z - lx * sin + lz * cos;
  const wy = unit.pos.y;

  off.pos.set(wx, wy, wz);
  off.yaw = unit.yaw;
  off.locationState = 'field';

  if (off.rig.root.parent !== unit.rig.root) {
    unit.rig.root.add(off.rig.root);
  }
  off.rig.root.visible = true;
  off.rig.root.position.set(lx, 0, lz);
  applyRigidHumanoidPose(off.rig, 'seated', {
    isDriver: seat.role === 'driver',
    seatedPitch: seat.seatedPitch,
    torsoScaleY: getSeatedTorsoScaleY(unit.vehicleKind),
    hipY: Math.max(0.44, ly - 0.06),
    snap: true,
  });
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
  if (!isExperimentalComplexMeshesEnabled()) return;
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

export function canOfficerOperateVehicle(
  officer: Pick<OfficerActor, 'officerClass'>,
  unit: Pick<PoliceUnit, 'vehicleClass'>,
): boolean {
  return officer.officerClass >= unit.vehicleClass;
}

export function assignOfficerToUnitSeat(
  off: OfficerActor,
  unit: PoliceUnit,
  preferredSeatIndex?: number,
): boolean {
  if (!canOfficerOperateVehicle(off, unit)) return false;
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
  hierarchy?: SceneWorldHierarchy,
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

  if (hierarchy) {
    hierarchy.addEntity(off.rig.root);
  } else if (off.rig.root.parent === unit.rig.root) {
    unit.rig.root.parent?.add(off.rig.root);
  }

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
      seatedPitch: s.spec.seatedPitch ?? -1.48,
      occupantOfficerId: null,
      doorOpenTimer: 0,
    }));
  }

  // Fallback front driver/passenger seats if custom model omitted explicit seat parts
  const fallbackSpecs: Array<{ spec: SeatPartSpec; local: [number, number, number]; exit: [number, number, number] }> = [
    {
      spec: { slotIndex: 0, role: 'driver', enterOffset: [1.35, 0, 0.25], exitOffset: [1.45, 0, 0.25], seatedPitch: -1.48 },
      local: [0.42, 0.62, 0.22],
      exit: [1.45, 0, 0.25],
    },
    {
      spec: { slotIndex: 1, role: 'passenger', enterOffset: [-1.35, 0, 0.25], exitOffset: [-1.45, 0, 0.25], seatedPitch: -1.48 },
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
    seatedPitch: f.spec.seatedPitch ?? -1.48,
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

  const doorSpec = map
    ? getPrecinctDoorPos(map, config)
    : {
        x: config.world.apronBounds.maxX - 17,
        y: config.world.surfaceHeights.apron,
        z: -38,
      };

  stationBays.forEach((bay, idx) => {
    const baseSwatch = palette[Math.floor(rng() * palette.length)] ?? palette[0];
    const baseColorHex = parseInt(baseSwatch.color.replace('#', ''), 16);
    const parkPos = new THREE.Vector3(...bay.parkPos);
    const vehDef = assets.vehicleDefs?.[bay.vehicleKind];
    const resolvedLightbarId = bay.lightbarId ?? vehDef?.defaultLightbarId ?? 'led_array';
    const vehicleClass: 0 | 1 =
      bay.vehicleClass ?? vehDef?.vehicleClass ?? (bay.isHeavyUnit ? 1 : 0);

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
      vehicleClass,
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
      goalReason: 'Parked empty at precinct bay (crew on standby inside)',
      mounted: false,
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
      patrolTimer: 0,
      patrolTargetNodeId: null,
      stalledGoalTimer: 0,
      bayApproachTimer: 0,
    };

    const officerClass: 0 | 1 = bay.isHeavyUnit || vehicleClass === 1 ? 1 : 0;
    const crewCount = Math.min(Math.max(2, seats.length >= 2 ? 2 : seats.length), 2);
    for (let sIdx = 0; sIdx < crewCount; sIdx++) {
      const oRig = createHumanoid(
        officerClass === 1 ? 'heavy_officer' : 'officer',
        assets,
        textures,
        undefined,
        onAssetIssue,
      );
      const oid = `officer-${officerIdSeq++}`;
      oRig.root.userData.unitId = bay.id;
      oRig.root.userData.officerId = oid;
      const doorSpawn = new THREE.Vector3(
        doorSpec.x + 0.35,
        doorSpec.y,
        doorSpec.z + (sIdx % 2 === 0 ? -0.45 : 0.45),
      );
      oRig.root.position.copy(doorSpawn);
      oRig.root.visible = false; // Officers start inside the precinct until dispatched
      hierarchy.addEntity(oRig.root);

      const officer: OfficerActor = {
        id: oid,
        unitId: bay.id,
        occupiedUnitId: null,
        occupiedSeatIndex: null,
        boardingState: 'dismounted',
        targetUnitId: bay.id,
        targetSeatIndex: sIdx,
        assignedCrimeId: null,
        rig: oRig,
        pos: doorSpawn,
        yaw: bay.parkYaw,
        hp: maxHp,
        maxHp,
        armor: maxArmor,
        maxArmor,
        weaponKind: bay.weaponKind,
        isHeavy: bay.isHeavyUnit,
        officerClass,
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
        locationState: 'in_precinct',
      };
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
  unit.patrolTimer = 0;
  unit.patrolTargetNodeId = null;
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

  const primaryApron = roadGraph.stationZones[0];
  const apronThresholdX = primaryApron
    ? primaryApron.cx + primaryApron.width * 0.5 + 1
    : config.world.apronBounds.maxX + 1;
  const approachDist = 4.2;
  const approachSpot = new THREE.Vector3(
    bay.parkPos[0] + Math.sin(bay.parkYaw) * approachDist,
    apronSurfaceY,
    bay.parkPos[2] + Math.cos(bay.parkYaw) * approachDist,
  );
  const parkSpot = new THREE.Vector3(...bay.parkPos);

  if (unit.pos.x <= apronThresholdX + 1.0) {
    // Already inside the precinct apron: pull directly to bay without looping back onto street roads
    const wps: THREE.Vector3[] = [];
    if (unit.pos.distanceToSquared(approachSpot) > 5.5) {
      wps.push(approachSpot);
    }
    wps.push(parkSpot);
    unit.waypoints = wps;
    unit.waypointIndex = 0;
    return;
  }

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
  wps.push(approachSpot);
  wps.push(parkSpot);
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

  const reqClass: 0 | 1 = allowHeavy ? 1 : 0;
  const isAvailableForDispatch = (u: PoliceUnit): boolean =>
    u.vehicleClass === reqClass &&
    !u.immobilized &&
    (u.status === UnitStatus.AtStation ||
      (u.status === UnitStatus.Returning && (u.bayApproachTimer ?? 0) <= 0)) &&
    u.id !== crime.assignedUnitId &&
    u.targetCrimeId !== crime.id;

  const mountedAvailable = units.filter(isAvailableForDispatch);
  const footRoamAvailable = units.filter(
    (u) =>
      u.vehicleClass === reqClass &&
      u.freeRoam &&
      u.status === UnitStatus.Engaging &&
      !u.targetCrimeId &&
      u.id !== crime.assignedUnitId,
  );
  const available = mountedAvailable.length > 0 ? mountedAvailable : footRoamAvailable;
  if (available.length === 0) return false;

  const doorSpec = map ? getPrecinctDoorPos(map, config) : { x: apronThresholdX - 18, y: apronSurfaceY, z: -38 };
  const unitDispatchCostSq = (u: PoliceUnit): number => {
    const crew = resolveUnitOfficers(u, officersById);
    const hasInPrecinctCrew = !u.mounted && crew.some((o) => o.hp > 0 && o.locationState === 'in_precinct');
    if (hasInPrecinctCrew) {
      const dDoor = Math.hypot(u.pos.x - doorSpec.x, u.pos.z - doorSpec.z);
      const dCrime = Math.hypot(u.pos.x - crime.pos.x, u.pos.z - crime.pos.z);
      const total = dDoor * 3.5 + dCrime;
      return total * total;
    }
    return u.pos.distanceToSquared(crime.pos);
  };

  let best = specificUnitId
    ? available.find((u) => u.id === specificUnitId) ?? available[0]
    : available[0];
  let bestDist = unitDispatchCostSq(best);
  if (!specificUnitId || best.id !== specificUnitId) {
    for (const u of available) {
      const d = unitDispatchCostSq(u);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
  }

  // If dispatched station unit has crew inside precinct, pick closest unoccupied class-compatible vehicle to precinctDoors
  const bestCrew = resolveUnitOfficers(best, officersById);
  if (
    !specificUnitId &&
    best.status === UnitStatus.AtStation &&
    !best.mounted &&
    bestCrew.some((o) => o.hp > 0 && o.locationState === 'in_precinct')
  ) {
    let closestStationVeh = best;
    let minDoorSq =
      (best.pos.x - doorSpec.x) ** 2 + (best.pos.z - doorSpec.z) ** 2;
    for (const candidate of units) {
      if (candidate.id === best.id) continue;
      if (
        candidate.status !== UnitStatus.AtStation ||
        candidate.mounted ||
        candidate.immobilized ||
        candidate.targetCrimeId ||
        candidate.vehicleClass !== best.vehicleClass ||
        !candidate.seats.every((s) => s.occupantOfficerId === null)
      ) {
        continue;
      }
      const otherCrew = resolveUnitOfficers(candidate, officersById);
      if (
        !bestCrew.every((o) => canOfficerOperateVehicle(o, candidate)) ||
        !otherCrew.every((o) => canOfficerOperateVehicle(o, best))
      ) {
        continue;
      }
      const candDoorSq =
        (candidate.pos.x - doorSpec.x) ** 2 + (candidate.pos.z - doorSpec.z) ** 2;
      if (candDoorSq < minDoorSq) {
        minDoorSq = candDoorSq;
        closestStationVeh = candidate;
      }
    }
    if (closestStationVeh !== best) {
      const otherCrew = resolveUnitOfficers(closestStationVeh, officersById);
      best.officerRefs = otherCrew.map((o) => o.id);
      closestStationVeh.officerRefs = bestCrew.map((o) => o.id);
      for (const o of bestCrew) {
        o.unitId = closestStationVeh.id;
        o.targetUnitId = closestStationVeh.id;
        o.rig.root.userData.unitId = closestStationVeh.id;
      }
      for (const o of otherCrew) {
        o.unitId = best.id;
        o.targetUnitId = best.id;
        o.rig.root.userData.unitId = best.id;
      }
      best = closestStationVeh;
    }
  }

  const alreadyAssignedCount = units.filter(
    (u) => u.targetCrimeId === crime.id && u.status !== UnitStatus.Retreating,
  ).length;

  best.targetCrimeId = crime.id;
  best.assignedCaseNumber = crime.caseNumber;
  best.assignedRole = allowHeavy ? 'tactical' : isBackup ? 'backup' : 'primary';
  best.pursuitRole = 'direct';
  best.patrolTimer = 0;
  best.patrolTargetNodeId = null;
  if (!isBackup || !crime.assignedUnitId) {
    crime.assignedUnitId = best.id;
  }
  if (!crime.assignedUnitIds.includes(best.id)) {
    crime.assignedUnitIds.push(best.id);
  }

  const crewAfterAssign = resolveUnitOfficers(best, officersById);
  const anyLivingInPrecinct = crewAfterAssign.some(
    (o) => o.hp > 0 && (o.locationState === 'in_precinct' || o.locationState === 'entering_precinct'),
  );
  if (anyLivingInPrecinct && !best.mounted) {
    // Exit precinct doors and sprint to closest assigned vehicle
    crewAfterAssign.forEach((o, sIdx) => {
      if (o.hp <= 0) return;
      if (o.locationState === 'in_precinct' || o.locationState === 'entering_precinct') {
        const wasHidden = o.locationState === 'in_precinct';
        o.locationState = 'exiting_precinct';
        o.boardingState = 'dismounted';
        o.mountPhase = 'walk';
        o.boardTimer = 0;
        if (wasHidden) {
          o.pos.set(
            doorSpec.x + 0.4 + sIdx * 0.45,
            apronSurfaceY,
            doorSpec.z + (sIdx % 2 === 0 ? -0.45 : 0.45),
          );
        }
        o.yaw = Math.atan2(best.pos.x - o.pos.x, best.pos.z - o.pos.z);
        o.rig.root.position.copy(o.pos);
        o.rig.root.visible = true;
        resetOfficerPose(o, o.yaw);
      }
    });
    best.freeRoam = false;
    best.status = UnitStatus.Mounting;
    best.activeGoal = 'MOUNT_CREW';
    best.goalReason = `Crew exiting precinct to ${best.callsign} (Case #${crime.caseNumber})`;
    best.mountTimer = 0;
    best.lightsActive = false;
    best.sirensActive = false;
    playBoundAudioEvent(audio, config, 'dispatch_chirp');
    simEventLog.info(
      'dispatch',
      `${best.callsign} crew scrambling from precinct to Case #${crime.caseNumber}`,
      `${crime.type} • ${crime.district} • Urgency ${crime.urgency}`,
    );
    return true;
  }

  if (!best.mounted) {
    if (!crime.inVehiclePursuit && best.pos.distanceToSquared(crime.pos) < 42 * 42) {
      best.freeRoam = false;
      best.status = UnitStatus.Engaging;
      best.activeGoal = 'ENGAGE_ON_FOOT';
      best.goalReason = `Engaging Case #${crime.caseNumber} on foot`;
      playBoundAudioEvent(audio, config, 'dispatch_chirp');
      return true;
    }
    if (best.immobilized) return false;
    best.freeRoam = false;
    best.status = UnitStatus.Mounting;
    best.activeGoal = 'MOUNT_CREW';
    best.goalReason = `Crew mounting ${best.callsign} for Case #${crime.caseNumber}`;
    best.mountTimer = 0;
    best.lightsActive = true;
    playBoundAudioEvent(audio, config, 'dispatch_chirp');
    return true;
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
  const knownSpot = crime.hasLineOfSight
    ? crime.inVehiclePursuit
      ? crime.vehiclePos
      : crime.roadPullOverPos
    : crime.everSpotted
    ? crime.predictedPos
    : crime.reportedPos;
  const targetNodeId =
    crime.inVehiclePursuit && crime.hasLineOfSight
      ? crime.vehicleNextNodeId
      : crime.inVehiclePursuit
      ? roadGraph.findNearestNode(knownSpot.x, knownSpot.z).id
      : crime.nearestNodeId;

  const pullSpot = knownSpot.clone();
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
  } else if (
    staticBvh &&
    bestDist < 95 * 95 &&
    staticBvh.sweepCorridor(
      best.pos.x,
      best.pos.z,
      pullSpot.x - best.pos.x,
      pullSpot.z - best.pos.z,
      Math.max(0.1, Math.hypot(pullSpot.x - best.pos.x, pullSpot.z - best.pos.z)),
      best.halfW + 0.55,
    ).clear
  ) {
    // Off-road / alley direct corridor shortcut when unobstructed
    wps.push(pullSpot.clone());
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
  hierarchy?: SceneWorldHierarchy,
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
    // Do not revive or eject already dead officers into combat stride
    if (off.hp <= 0) return;

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

    if (hierarchy) {
      hierarchy.addEntity(off.rig.root);
    } else if (off.rig.root.parent === unit.rig.root) {
      unit.rig.root.parent?.add(off.rig.root);
    }

    off.occupiedUnitId = null;
    off.occupiedSeatIndex = null;
    off.boardingState = 'dismounted';
    off.locationState = 'field';
    off.yaw = idx % 2 === 0 ? unit.yaw + Math.PI * 0.45 : unit.yaw - Math.PI * 0.45;
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
    // Include parked/station vehicles so crookedly parked cars create real avoidance obstacles
    proxies.push({
      id: u.id,
      x: u.pos.x,
      z: u.pos.z,
      yaw: u.yaw,
      speed: u.status === UnitStatus.AtStation ? 0 : Math.max(0, u.speed),
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

interface PoliceGoalEvalContext {
  unit: PoliceUnit;
  crew: OfficerActor[];
  livingCrew: OfficerActor[];
  crime: ActiveCrime | undefined;
  primarySuspect: AssailantActor | undefined;
  suspectAlive: boolean;
  anyFleeing: boolean;
  allDead: boolean;
  anyUnseatedLiving: boolean;
  anyExitingPrecinct: boolean;
  anyEnteringPrecinct: boolean;
  anyInPrecinctLiving: boolean;
  arrivedAtBay: boolean;
}

interface PoliceGoalSpec {
  id: string;
  defaultPriority: number;
  predicate: (ctx: PoliceGoalEvalContext, params: Record<string, number>) => boolean;
  resolve: (
    ctx: PoliceGoalEvalContext,
    params: Record<string, number>,
  ) => { goal: PoliceUnitGoalId; reason: string };
}

const POLICE_GOAL_SPECS: PoliceGoalSpec[] = [
  {
    id: 'AWAIT_TOW',
    defaultPriority: 100,
    predicate: (ctx) => ctx.unit.immobilized || (ctx.allDead && !ctx.unit.mounted),
    resolve: (ctx) => {
      if (
        ctx.unit.immobilized &&
        !ctx.unit.mounted &&
        ctx.crime &&
        ctx.suspectAlive &&
        !ctx.crime.inVehiclePursuit &&
        ctx.crew.some((o) => o.hp > 0 && o.cowardiceState !== 'fleeing')
      ) {
        return {
          goal: 'ENGAGE_ON_FOOT',
          reason: `Vehicle disabled — engaging Case #${ctx.crime.caseNumber} on foot`,
        };
      }
      return {
        goal: 'IMMOBILIZED_HOLD',
        reason: ctx.allDead
          ? 'Crew incapacitated — unit out of service'
          : 'Vehicle disabled / awaiting recovery',
      };
    },
  },
  {
    id: 'RETREAT_TO_PRECINCT',
    defaultPriority: 90,
    predicate: (ctx) =>
      ctx.unit.status === UnitStatus.Retreating || (ctx.anyFleeing && ctx.unit.status !== UnitStatus.AtStation),
    resolve: (ctx) =>
      !ctx.unit.mounted || ctx.anyUnseatedLiving
        ? {
            goal: 'MOUNT_CREW',
            reason: 'Squad retreating — waiting for officers to board',
          }
        : {
            goal: 'RETREAT_TO_STATION',
            reason: 'Squad morale broken — retreating to station',
          },
  },
  {
    id: 'DEPLOY_NAIL_MAT',
    defaultPriority: 85,
    predicate: (ctx) =>
      ctx.unit.pursuitRole === 'nail_mat' &&
      Boolean(ctx.crime && ctx.suspectAlive && ctx.crime.inVehiclePursuit) &&
      ctx.unit.status === UnitStatus.DeployingSpikes,
    resolve: (ctx) => ({
      goal: 'DEPLOY_SPIKES',
      reason: `Staging spike strip ahead of Case #${ctx.crime!.caseNumber}`,
    }),
  },
  {
    id: 'DISMOUNT_COMBAT',
    defaultPriority: 75,
    predicate: (ctx, params) => {
      if (!ctx.crime || !ctx.suspectAlive || ctx.crime.inVehiclePursuit) return false;
      if (
        !ctx.unit.mounted &&
        !ctx.anyExitingPrecinct &&
        ctx.unit.status !== UnitStatus.Mounting &&
        !ctx.anyInPrecinctLiving
      ) {
        return true;
      }
      const dismountDist = params.dismountDist ?? 22.0;
      const targetRef =
        ctx.crime.hasLineOfSight && ctx.primarySuspect
          ? ctx.primarySuspect.pos
          : ctx.crime.everSpotted
          ? ctx.crime.predictedPos
          : ctx.crime.reportedPos;
      return (
        ctx.unit.mounted &&
        ctx.unit.status === UnitStatus.Pursuing &&
        Boolean(ctx.primarySuspect) &&
        ctx.unit.pos.distanceToSquared(targetRef) < dismountDist * dismountDist
      );
    },
    resolve: (ctx) => ({
      goal: 'ENGAGE_ON_FOOT',
      reason:
        ctx.unit.status === UnitStatus.Pursuing
          ? `Suspect bailed out — dismounting (Case #${ctx.crime!.caseNumber})`
          : `Engaging suspect on foot (Case #${ctx.crime!.caseNumber})`,
    }),
  },
  {
    id: 'PURSUE_INTERCEPT',
    defaultPriority: 70,
    predicate: (ctx) => Boolean(ctx.crime && ctx.suspectAlive && ctx.crime.inVehiclePursuit),
    resolve: (ctx) =>
      !ctx.unit.mounted || ctx.anyUnseatedLiving
        ? {
            goal: 'MOUNT_CREW',
            reason: ctx.anyExitingPrecinct
              ? `Waiting for crew from precinct (Case #${ctx.crime!.caseNumber})`
              : `Mounting crew for pursuit (Case #${ctx.crime!.caseNumber})`,
          }
        : {
            goal: 'PURSUE_VEHICLE',
            reason: `Intercepting getaway vehicle (Case #${ctx.crime!.caseNumber})`,
          },
  },
  {
    id: 'RESPOND_TO_CALL',
    defaultPriority: 65,
    predicate: (ctx) => Boolean(ctx.crime && ctx.suspectAlive),
    resolve: (ctx) =>
      !ctx.unit.mounted || ctx.anyUnseatedLiving
        ? {
            goal: 'MOUNT_CREW',
            reason: ctx.anyExitingPrecinct
              ? `Waiting for crew from precinct (Case #${ctx.crime!.caseNumber})`
              : `Mounting crew to respond (Case #${ctx.crime!.caseNumber})`,
          }
        : {
            goal: 'RESPOND_TO_CALL',
            reason: `Responding to Case #${ctx.crime!.caseNumber}`,
          },
  },
  {
    id: 'BOARD_CRUISER',
    defaultPriority: 50,
    predicate: (ctx) =>
      (!ctx.unit.mounted || ctx.anyUnseatedLiving) &&
      !ctx.unit.freeRoam &&
      ctx.unit.status !== UnitStatus.AtStation &&
      !ctx.anyEnteringPrecinct &&
      !ctx.anyInPrecinctLiving &&
      (ctx.unit.patrolTimer ?? 0) <= 0,
    resolve: () => ({
      goal: 'MOUNT_CREW',
      reason: 'Scene clear — remounting cruiser',
    }),
  },
  {
    id: 'MANUAL_FOOT_PATROL',
    defaultPriority: 40,
    predicate: (ctx) => ctx.unit.freeRoam && !ctx.unit.mounted,
    resolve: () => ({
      goal: 'MANUAL_FOOT_PATROL',
      reason: 'On foot patrol near cruiser',
    }),
  },
  {
    id: 'PATROL_STREETS',
    defaultPriority: 25,
    predicate: (ctx) =>
      !ctx.unit.isHeavyUnit &&
      ctx.unit.vehicleClass === 0 &&
      (ctx.unit.patrolTimer ?? 0) > 0 &&
      ctx.unit.status !== UnitStatus.AtStation,
    resolve: (ctx) =>
      !ctx.unit.mounted || ctx.anyUnseatedLiving
        ? {
            goal: 'MOUNT_CREW',
            reason: ctx.anyExitingPrecinct
              ? 'Crew exiting precinct for city patrol'
              : 'Mounting cruiser for city patrol',
          }
        : {
            goal: 'PATROL_STREETS',
            reason: 'On routine precinct sector patrol',
          },
  },
  {
    id: 'RETURN_TO_PRECINCT',
    defaultPriority: 20,
    predicate: (ctx) =>
      ctx.unit.status !== UnitStatus.AtStation &&
      !ctx.arrivedAtBay &&
      !ctx.anyEnteringPrecinct &&
      !ctx.anyInPrecinctLiving,
    resolve: (ctx) =>
      !ctx.unit.mounted || ctx.anyUnseatedLiving
        ? {
            goal: 'MOUNT_CREW',
            reason: 'Remounting before return to precinct',
          }
        : {
            goal: 'RETURN_TO_STATION',
            reason: 'Code 4 — returning to precinct bay',
          },
  },
  {
    id: 'PARKED_STANDBY',
    defaultPriority: 10,
    predicate: () => true,
    resolve: (ctx) => ({
      goal: 'STATION_STANDBY',
      reason: ctx.anyEnteringPrecinct
        ? 'Parked at bay — crew walking into precinct'
        : 'Parked & on standby at precinct',
    }),
  },
];

const POLICE_GOAL_MAP = new Map(POLICE_GOAL_SPECS.map((s) => [s.id, s]));

/**
 * Priority-ordered Predicate-Based Goal Evaluator for police units, driven by asset-pack `aiGoals.police`.
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
  const livingCrew = crew.filter((o) => o.hp > 0);
  const allDead = crew.length > 0 && livingCrew.length === 0;
  const anyFleeing = livingCrew.some((o) => o.cowardiceState === 'fleeing');
  const anyUnseatedLiving = livingCrew.some(
    (o) =>
      o.locationState !== 'in_precinct' &&
      o.locationState !== 'entering_precinct' &&
      o.boardingState !== 'seated',
  );
  const anyExitingPrecinct = livingCrew.some((o) => o.locationState === 'exiting_precinct');
  const anyEnteringPrecinct = livingCrew.some((o) => o.locationState === 'entering_precinct');
  const anyInPrecinctLiving = livingCrew.some((o) => o.locationState === 'in_precinct');

  const distToBay = bayParkPos
    ? Math.hypot(unit.pos.x - bayParkPos[0], unit.pos.z - bayParkPos[2])
    : 999;
  const arrivedAtBay =
    unit.status === UnitStatus.AtStation ||
    (distToBay < 4.2 && Math.abs(unit.speed) < 2.2) ||
    (unit.bayApproachTimer ?? 0) > 5.5;

  const evalCtx: PoliceGoalEvalContext = {
    unit,
    crew,
    livingCrew,
    crime,
    primarySuspect,
    suspectAlive,
    anyFleeing,
    allDead,
    anyUnseatedLiving,
    anyExitingPrecinct,
    anyEnteringPrecinct,
    anyInPrecinctLiving,
    arrivedAtBay,
  };

  const packRules = config.aiGoals?.police ?? [];
  const ruleEntries =
    packRules.length > 0
      ? [...packRules]
          .filter((r) => r.enabled !== false)
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
          .map((r) => ({ id: r.id, params: r.params ?? {} }))
      : POLICE_GOAL_SPECS.map((s) => ({ id: s.id, params: {} as Record<string, number> }));

  // Test each enabled rule's predicate in descending priority order; fall through on false
  for (const entry of ruleEntries) {
    const spec = POLICE_GOAL_MAP.get(entry.id);
    if (!spec) continue;
    if (spec.predicate(evalCtx, entry.params)) {
      return spec.resolve(evalCtx, entry.params);
    }
  }

  // Final fallback goal MUST always succeed
  const fallback = POLICE_GOAL_MAP.get('PARKED_STANDBY')!;
  return fallback.resolve(evalCtx, {});
}

function maintainCityPatrols(
  units: PoliceUnit[],
  officersById: Map<string, OfficerActor>,
  doorSpec: { x: number; y: number; z: number },
  apronSurfaceY: number,
  config: EngineConfigAsset,
  simTime: number,
  defaultPatrolSec: number,
  maxPatrolCars: number,
): void {
  if (simTime < 0.8 || maxPatrolCars <= 0) return;

  // Never patrol tactical/SWAT units; only count non-SWAT class-0 cruisers on patrol
  const regularUnits = units.filter((u) => u.vehicleClass === 0 && !u.isHeavyUnit);
  if (regularUnits.length < 2) return;

  const maxAllowed = Math.min(maxPatrolCars, Math.max(1, regularUnits.length - 1));
  let activePatrols = 0;
  let scramblingPatrol = false;

  for (const u of regularUnits) {
    if (!u.targetCrimeId && (u.patrolTimer ?? 0) > 0 && u.status !== UnitStatus.AtStation) {
      activePatrols++;
      if (!u.mounted) scramblingPatrol = true;
    }
  }

  if (activePatrols >= maxAllowed || scramblingPatrol) return;

  // Pick a compatible AtStation regular cruiser whose living crew are resting in_precinct
  const candidates = regularUnits
    .filter((u) => {
      if (u.status !== UnitStatus.AtStation || u.mounted || u.immobilized || u.targetCrimeId) {
        return false;
      }
      if (!u.seats.every((s) => s.occupantOfficerId === null)) return false;
      const crew = resolveUnitOfficers(u, officersById);
      return (
        crew.length > 0 &&
        crew.every(
          (o) =>
            o.hp > 0 &&
            o.locationState === 'in_precinct' &&
            canOfficerOperateVehicle(o, u),
        )
      );
    })
    .sort(
      (a, b) =>
        (a.pos.x - doorSpec.x) ** 2 +
        (a.pos.z - doorSpec.z) ** 2 -
        ((b.pos.x - doorSpec.x) ** 2 + (b.pos.z - doorSpec.z) ** 2),
    );

  const pick = candidates[0];
  if (!pick) return;

  const crew = resolveUnitOfficers(pick, officersById);
  crew.forEach((o, sIdx) => {
    if (o.hp <= 0) return;
    o.locationState = 'exiting_precinct';
    o.boardingState = 'dismounted';
    o.mountPhase = 'walk';
    o.boardTimer = 0;
    o.pos.set(
      doorSpec.x + 0.4 + sIdx * 0.45,
      apronSurfaceY,
      doorSpec.z + (sIdx % 2 === 0 ? -0.45 : 0.45),
    );
    o.yaw = Math.atan2(pick.pos.x - o.pos.x, pick.pos.z - o.pos.z);
    o.rig.root.position.copy(o.pos);
    o.rig.root.visible = true;
    resetOfficerPose(o, o.yaw);
  });

  pick.freeRoam = false;
  pick.status = UnitStatus.Mounting;
  pick.activeGoal = 'MOUNT_CREW';
  pick.goalReason = 'Crew exiting precinct for routine city patrol';
  pick.mountTimer = 0;
  pick.patrolTimer = defaultPatrolSec;
  pick.patrolTargetNodeId = null;
  pick.lightsActive = false;
  pick.sirensActive = false;
}

function beginMounting(unit: PoliceUnit, crew: OfficerActor[]): void {
  if (unit.status === UnitStatus.Mounting) return;
  unit.holdTimer = 0;
  unit.mountTimer = 0;
  unit.freeRoam = false;
  crew.forEach((o) => {
    if (o.hp <= 0) return;
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
  const doorSpec = map ? getPrecinctDoorPos(map, config) : { x: apronThresholdX - 18, y: world.surfaceHeights.apron, z: -38 };
  const patrolGoalDef = config.aiGoals?.police?.find((g) => g.id === 'PATROL_STREETS');
  const patrolEnabled = patrolGoalDef ? patrolGoalDef.enabled !== false : true;
  const defaultPatrolSec = patrolGoalDef?.params?.patrolDuration ?? 36.0;
  const defaultPatrolSpeed = patrolGoalDef?.params?.cruiseSpeed ?? 10.5;
  const maxPatrolRadius = patrolGoalDef?.params?.maxRadiusFromPrecinct ?? 125.0;
  const maxPatrolCars = Math.round(patrolGoalDef?.params?.maxPatrolCars ?? 2);

  if (patrolEnabled) {
    maintainCityPatrols(
      units,
      officersById,
      doorSpec,
      world.surfaceHeights.apron,
      config,
      simTime,
      defaultPatrolSec,
      maxPatrolCars,
    );
  }

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
      // Only let non-SWAT regular units continue onto sector patrol if below active patrol cap
      const activePatrolCount = units.filter(
        (u) =>
          u.id !== unit.id &&
          u.vehicleClass === 0 &&
          !u.isHeavyUnit &&
          !u.targetCrimeId &&
          (u.patrolTimer ?? 0) > 0 &&
          u.status !== UnitStatus.AtStation,
      ).length;
      if (
        patrolEnabled &&
        !unit.isHeavyUnit &&
        unit.vehicleClass === 0 &&
        unit.pos.x > apronThresholdX &&
        activePatrolCount < maxPatrolCars &&
        (unit.patrolTimer ?? 0) <= 0
      ) {
        unit.patrolTimer = defaultPatrolSec;
        unit.patrolTargetNodeId = null;
      } else {
        unit.patrolTimer = 0;
      }
    }

    // Also keep updating any dead crew members outside vehicles so they settle cleanly to dead_flat
    for (const off of crew) {
      if (off.hp <= 0 && off.boardingState !== 'seated' && off.locationState !== 'in_precinct') {
        if (off.ragdoll.active) {
          stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
        } else {
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world) + 0.16;
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.set(Math.PI * 0.5, off.yaw, 0);
          applyRigidHumanoidPose(off.rig, 'dead_flat', { snap: true });
        }
      }
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
          applyRigidHumanoidPose(off.rig, 'walk', { phase: off.walkPhase, dt });
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.set(0, off.yaw, 0);
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
          if (!p?.alive || c.inVehiclePursuit) return false;
          const spot = c.hasLineOfSight
            ? p.pos
            : c.everSpotted
            ? c.predictedPos
            : c.reportedPos;
          return spot.distanceToSquared(crew[0].pos) < 48 * 48;
        });
        if (nearbyFoot) {
          unit.targetCrimeId = nearbyFoot.id;
          unit.assignedCaseNumber = nearbyFoot.caseNumber;
          if (!nearbyFoot.assignedUnitId) nearbyFoot.assignedUnitId = unit.id;
          crime = nearbyFoot;
          primarySuspect = resolveCrimePrimaryAssailant(nearbyFoot, assailantsById);
        }
      }

      // Engage crime suspect or nearest standalone foot assailant if within range and LoS
      let combatTarget =
        crime && primarySuspect?.alive && !crime.inVehiclePursuit ? primarySuspect : undefined;
      if (!combatTarget && crew[0]) {
        combatTarget = assailants.find(
          (a) =>
            a.alive &&
            !a.inVehicle &&
            a.crimeId === null &&
            a.pos.distanceToSquared(crew[0].pos) < 40 * 40 &&
            staticBvh.raycastSegment(crew[0].pos.x, crew[0].pos.z, a.pos.x, a.pos.z).clear,
        );
      }

      if (combatTarget) {
        const knownTargetPos =
          crime && !crime.hasLineOfSight
            ? crime.everSpotted
              ? crime.predictedPos
              : crime.reportedPos
            : undefined;
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
            knownTargetPos,
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

    // --- Goal 2 (if dismounted / driver waiting for passengers) & Goal 8: MOUNT_CREW ---
    if (goal === 'MOUNT_CREW') {
      beginMounting(unit, crew);
      // Driver holds vehicle stationary while passengers sprint & board
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.mounted = false;
      unit.mountTimer += dt;
      let allBack = true;
      let boardingRollPulse = 0;
      const isPanicRetreat = unit.status === UnitStatus.Retreating || crew.some((o) => o.hp > 0 && o.cowardiceState === 'fleeing');
      // Safety fallback only for stuck *living* officers (never resurrects dead cops)
      const forceBoard = unit.mountTimer > 8.5;

      crew.forEach((off, idx) => {
        if (off.hp <= 0 || off.locationState === 'in_precinct') return;
        if (off.boardingState === 'seated') return;

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
          if (seat) seat.doorOpenTimer = Math.max(seat.doorOpenTimer, 0.55);
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
          applyRigidHumanoidPose(off.rig, 'walk', { phase: off.walkPhase, dt });
          off.rig.torso.position.y = THREE.MathUtils.lerp(
            off.rig.torsoBaseY,
            Math.max(0.44, (seat?.localOffset.y ?? 0.62) - 0.06),
            ease,
          );
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.set(0, off.yaw, 0);

          boardingRollPulse += Math.sin(b * Math.PI) * 0.03 * sideSign;

          if (b >= 1 || forceBoard) {
            off.ammo = config.weapons[off.weaponKind].magSize;
            off.reloadTimer = 0;
            off.roamTarget = null;
            off.locationState = 'field';
            assignOfficerToUnitSeat(off, unit, idx < unit.seats.length ? idx : undefined);
          }
          return;
        }

        const distToCar = Math.hypot(unit.pos.x - off.pos.x, unit.pos.z - off.pos.z);
        const dx = targetX - off.pos.x;
        const dz = targetZ - off.pos.z;
        const dist = Math.hypot(dx, dz);

        if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;

        if (!forceBoard && dist > 0.85 && distToCar > 1.85) {
          allBack = false;
          const isSprinting = isPanicRetreat || off.locationState === 'exiting_precinct';
          const spd = isSprinting ? 6.4 : 5.2;
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

          off.walkPhase += dt * (isSprinting ? 14 : 10);
          applyRigidHumanoidPose(off.rig, isSprinting ? 'run' : 'walk', {
            phase: off.walkPhase,
            dt,
          });
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.set(0, off.yaw, 0);
        } else if (!forceBoard) {
          allBack = false;
          off.mountPhase = 'boarding';
          off.boardTimer = 0;
          if (seat) seat.doorOpenTimer = 0.75;
        } else {
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          off.locationState = 'field';
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
          if (off.hp <= 0) return;
          off.ragdoll.active = false;
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          off.locationState = 'field';
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
            if (
              patrolEnabled &&
              !unit.isHeavyUnit &&
              unit.vehicleClass === 0 &&
              (unit.patrolTimer ?? 0) > 0
            ) {
              unit.status = UnitStatus.Returning;
              unit.lightsActive = false;
              unit.sirensActive = false;
              unit.waypoints = [];
              unit.waypointIndex = 0;
            } else {
              unit.patrolTimer = 0;
              routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
            }
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
      // Natural free parking: preserve current parked position & angle without snapping!
      unit.status = UnitStatus.AtStation;
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.dyn.omega = 0;
      unit.lightsActive = false;
      unit.sirensActive = false;
      unit.patrolTimer = 0;
      unit.patrolTargetNodeId = null;
      unit.bayApproachTimer = 0;
      unit.waypoints = [];
      unit.waypointIndex = 0;

      // Guarantee living crew disembark vehicle & walk into precinctDoors on arrival
      crew.forEach((off) => {
        if (off.hp <= 0) return;
        if (off.boardingState !== 'dismounted' || off.occupiedUnitId !== null) {
          ejectOfficerFromSeat(off, unit, staticBvh, world);
          off.locationState = 'entering_precinct';
          off.mountPhase = 'walk';
          off.boardTimer = 0;
        }
      });
      unit.mounted = false;

      // Walk any dismounted entering_precinct crew inside precinctDoors
      crew.forEach((off, idx) => {
        if (off.hp <= 0 || off.boardingState !== 'dismounted') return;
        if (off.locationState === 'in_precinct') {
          off.rig.root.visible = false;
          return;
        }
        if (off.locationState === 'field' || off.locationState === 'exiting_precinct') {
          off.locationState = 'entering_precinct';
          off.boardTimer = 0;
        }
        if (off.locationState === 'entering_precinct') {
          off.boardTimer += dt;
          const targetX = doorSpec.x + 0.35;
          const targetZ = doorSpec.z + (idx % 2 === 0 ? -0.35 : 0.35);
          const dx = targetX - off.pos.x;
          const dz = targetZ - off.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.35 || off.boardTimer > 12.0) {
            off.locationState = 'in_precinct';
            off.rig.root.visible = false;
            off.hp = off.maxHp;
            off.armor = off.maxArmor;
            off.ammo = config.weapons[off.weaponKind].magSize;
            off.morale = 100;
            off.cowardiceState = 'steady';
            off.ragdoll.active = false;
            off.mountPhase = 'walk';
            off.boardTimer = 0;
            return;
          }
          const spd = 2.6;
          const ux = dx / dist;
          const uz = dz / dist;
          const prevX = off.pos.x;
          const prevZ = off.pos.z;
          off.pos.x += ux * spd * dt;
          off.pos.z += uz * spd * dt;
          staticBvh.resolveCircle(off.pos, 0.42);
          if (Math.hypot(off.pos.x - prevX, off.pos.z - prevZ) < spd * dt * 0.25) {
            const sideSign = idx % 2 === 0 ? 1 : -1;
            off.pos.x += -uz * sideSign * spd * dt;
            off.pos.z += ux * sideSign * spd * dt;
            staticBvh.resolveCircle(off.pos, 0.42);
          }
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
          const stepDx = off.pos.x - prevX;
          const stepDz = off.pos.z - prevZ;
          off.yaw =
            stepDx * stepDx + stepDz * stepDz > 1e-6
              ? Math.atan2(stepDx, stepDz)
              : Math.atan2(ux, uz);
          off.walkPhase += dt * 7.5;
          applyRigidHumanoidPose(off.rig, 'walk', { phase: off.walkPhase, dt });
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.set(0, off.yaw, 0);
          off.rig.root.visible = true;
        }
      });

      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      syncMountedSeats();
      continue;
    }

    // --- Driving Goals: RETREAT_TO_STATION | PURSUE_VEHICLE | RESPOND_TO_CALL | PATROL_STREETS | RETURN_TO_STATION | DEPLOY_SPIKES (mounted) ---
    if (goal === 'RETREAT_TO_STATION' && unit.status !== UnitStatus.Retreating) {
      unit.bayApproachTimer = 0;
      routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
      simEventLog.warn('dispatch', `${unit.callsign} retreating to station`, reason);
    } else if (
      goal === 'RETURN_TO_STATION' &&
      (unit.status !== UnitStatus.Returning || prevGoal !== 'RETURN_TO_STATION')
    ) {
      unit.bayApproachTimer = 0;
      routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
    } else if (goal === 'PURSUE_VEHICLE') {
      unit.status = UnitStatus.Pursuing;
    } else if (goal === 'RESPOND_TO_CALL' && unit.status !== UnitStatus.Responding) {
      unit.status = UnitStatus.Responding;
      unit.repathTimer = 0;
    } else if (goal === 'PATROL_STREETS') {
      unit.status = UnitStatus.Returning;
      unit.lightsActive = false;
      unit.sirensActive = false;
      unit.patrolTimer = Math.max(0, (unit.patrolTimer ?? defaultPatrolSec) - dt);
      if (
        (unit.waypointIndex >= unit.waypoints.length || unit.waypoints.length === 0) &&
        roadGraph.nodes.length > 0
      ) {
        const [patrolApronExitX] = roadGraph.stationExitPoint;
        const onApron = bay && unit.pos.x <= apronThresholdX;
        const entry = roadGraph.findNearestRoadEntryPoint(
          onApron ? patrolApronExitX + 4 : unit.pos.x,
          unit.pos.z,
          staticBvh,
        );
        const nearbyRadiusNodes = roadGraph.nodes.filter(
          (n) =>
            n.id !== entry.nearestNode.id &&
            Math.hypot(n.x - doorSpec.x, n.z - doorSpec.z) <= maxPatrolRadius &&
            Math.hypot(n.x - unit.pos.x, n.z - unit.pos.z) > 26,
        );
        const candidates =
          nearbyRadiusNodes.length > 0
            ? nearbyRadiusNodes
            : roadGraph.nodes.filter(
                (n) =>
                  n.id !== entry.nearestNode.id &&
                  Math.hypot(n.x - unit.pos.x, n.z - unit.pos.z) > 26,
              );
        const pick =
          candidates.length > 0
            ? candidates[Math.floor(rng() * candidates.length)]
            : roadGraph.nodes[Math.floor(rng() * roadGraph.nodes.length)];
        if (pick) {
          unit.patrolTargetNodeId = pick.id;
          const nodePath = roadGraph.findNodePath(entry.nearestNode.id, pick.id);
          const wps: THREE.Vector3[] = [];
          if (onApron && bay) {
            wps.push(
              new THREE.Vector3(patrolApronExitX, world.surfaceHeights.apron, bay.parkPos[2]),
            );
          } else if (unit.pos.distanceToSquared(entry.point) > 9) {
            wps.push(entry.point);
          }
          wps.push(...roadGraph.buildLaneWaypoints(nodePath, undefined, false));
          pruneLeadingWaypoints(unit.pos, unit.yaw, wps, staticBvh);
          unit.waypoints = wps;
          unit.waypointIndex = 0;
        }
      }
    }

    const isPursuit = goal === 'PURSUE_VEHICLE';
    const isSpikeIntercept = goal === 'DEPLOY_SPIKES';
    const isRetreat = goal === 'RETREAT_TO_STATION';
    const isPatrol = goal === 'PATROL_STREETS';

    const rawUrgency = crime ? crime.urgency / 100 : isRetreat ? 0.75 : isPatrol ? 0.25 : 0.42;
    const urgencyNorm = THREE.MathUtils.clamp(
      isAggro && crime ? Math.max(rawUrgency, 0.78) + 0.14 : rawUrgency,
      0.24,
      1.0,
    );
    const recklessness = THREE.MathUtils.clamp(
      isPursuit || isAggro ? Math.max(0.75, urgencyNorm) : isPatrol ? 0 : (urgencyNorm - 0.34) / 0.66,
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
        unit.repathTimer = isPursuit ? 0.85 : 1.5;
        const targetPos = crime.hasLineOfSight
          ? crime.inVehiclePursuit
            ? crime.vehiclePos
            : crime.roadPullOverPos
          : crime.everSpotted
          ? crime.predictedPos
          : crime.reportedPos;
        const dSq = unit.pos.distanceToSquared(targetPos);

        if (
          crime.inVehiclePursuit &&
          crime.hasLineOfSight &&
          dSq < 34 * 34 &&
          staticBvh.raycastSegment(
            unit.pos.x,
            unit.pos.z,
            crime.vehiclePos.x,
            crime.vehiclePos.z,
          ).clear
        ) {
          const distNow = Math.sqrt(dSq);
          const leadDist = distNow < 6.5 ? 0 : Math.min(7.5, distNow * 0.28);
          const leadX = crime.vehiclePos.x + Math.sin(crime.vehicleYaw) * leadDist;
          const leadZ = crime.vehiclePos.z + Math.cos(crime.vehicleYaw) * leadDist;
          unit.waypoints = [new THREE.Vector3(leadX, roadGraph.roadSurfaceY, leadZ)];
          unit.waypointIndex = 0;
        } else if (
          dSq < 68 * 68 &&
          unit.pos.x > apronThresholdX - 2 &&
          staticBvh.sweepCorridor(
            unit.pos.x,
            unit.pos.z,
            targetPos.x - unit.pos.x,
            targetPos.z - unit.pos.z,
            Math.max(0.1, Math.sqrt(dSq)),
            unit.halfW + 0.55,
          ).clear
        ) {
          // Direct off-road/alley corridor toward known or predicted location
          unit.waypoints = [targetPos.clone()];
          unit.waypointIndex = 0;
        } else {
          // Handles both road-network repath and apron-exit repath cleanly without getting stuck
          const wps: THREE.Vector3[] = [];
          const [apronExitX] = roadGraph.stationExitPoint;
          if (unit.pos.x <= apronThresholdX - 2) {
            const exitZ = bay ? bay.parkPos[2] : unit.pos.z;
            wps.push(
              new THREE.Vector3(apronExitX, world.surfaceHeights.apron, exitZ),
            );
          }
          const entry = roadGraph.findNearestRoadEntryPoint(
            unit.pos.x <= apronThresholdX - 2 ? apronExitX + 4 : unit.pos.x,
            unit.pos.z,
            staticBvh,
          );
          if (unit.pos.distanceToSquared(entry.point) > 9) {
            wps.push(entry.point);
          }
          if (crime.inVehiclePursuit) {
            const targetNodeId = crime.hasLineOfSight
              ? crime.vehicleNextNodeId
              : roadGraph.findNearestNode(targetPos.x, targetPos.z).id;
            let path = roadGraph.findNodePath(entry.nearestNode.id, targetNodeId);
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
    const urgencyCruise = isPatrol
      ? defaultPatrolSpeed
      : THREE.MathUtils.lerp(11.5, 24.6, urgencyNorm);
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

    const finishStationArrival = () => {
      // Natural free parking: preserve current parked pos, yaw, body tilt & part damage
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.dyn.omega = 0;
      unit.lateralOffset = 0;
      unit.avoidanceSteer = 0;
      unit.stuckTimer = 0;
      unit.impatience = 0;
      unit.reverseTimer = 0;
      unit.stallCount = 0;
      unit.bayApproachTimer = 0;
      unit.status = UnitStatus.AtStation;
      unit.activeGoal = 'STATION_STANDBY';
      unit.goalReason = 'Parked at precinct bay — crew entering station';
      unit.assignedCaseNumber = null;
      unit.assignedRole = null;
      unit.pursuitRole = 'direct';
      unit.lightsActive = false;
      unit.sirensActive = false;
      unit.freeRoam = false;
      unit.mountTimer = 0;
      unit.dismountTimer = 0;

      // Eject living crew at real parked doors and send them inside precinctDoors
      let anyLiving = false;
      crew.forEach((off, idx) => {
        if (off.hp <= 0) return;
        anyLiving = true;
        if (off.occupiedUnitId === unit.id && off.occupiedSeatIndex !== null) {
          const seat = unit.seats[off.occupiedSeatIndex];
          if (seat) {
            if (seat.occupantOfficerId === off.id) seat.occupantOfficerId = null;
            seat.doorOpenTimer = 1.1;
            seatOffsetToWorld(unit, seat.exitOffset, off.pos);
          } else {
            off.pos.set(unit.pos.x + (idx % 2 === 0 ? 1.35 : -1.35), unit.pos.y, unit.pos.z);
          }
          staticBvh.resolveCircle(off.pos, 0.45);
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
          unit.rig.root.parent?.add(off.rig.root);
          off.occupiedUnitId = null;
          off.occupiedSeatIndex = null;
          off.boardingState = 'dismounted';
          off.rig.root.visible = true;
        }
        off.locationState = 'entering_precinct';
        off.mountPhase = 'walk';
        off.boardTimer = 0;
        off.ragdoll.active = false;
        resetOfficerPose(off, off.yaw);
        off.rig.root.position.copy(off.pos);
      });
      if (anyLiving) {
        unit.mounted = false;
      }
    };

    const distToBay = bay ? Math.hypot(unit.pos.x - bay.parkPos[0], unit.pos.z - bay.parkPos[2]) : 99;
    const isReturningGoal = goal === 'RETURN_TO_STATION' || goal === 'RETREAT_TO_STATION';
    if (isReturningGoal && distToBay < 9.5) {
      unit.bayApproachTimer = (unit.bayApproachTimer ?? 0) + dt;
    }

    if (
      isReturningGoal &&
      ((distToBay < 3.4 && Math.abs(unit.speed) < 1.35 && unit.waypointIndex >= Math.max(0, unit.waypoints.length - 1)) ||
        (unit.bayApproachTimer ?? 0) > 6.5)
    ) {
      finishStationArrival();
    } else if (unit.waypointIndex >= unit.waypoints.length) {
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
      } else if (goal === 'PATROL_STREETS') {
        unit.repathTimer = 0;
      } else if (goal === 'DEPLOY_SPIKES') {
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
      } else if (isReturningGoal) {
        if (distToBay > 12) {
          routeUnitToStation(unit, isRetreat, roadGraph, config, staticBvh, map);
        } else {
          finishStationArrival();
        }
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

