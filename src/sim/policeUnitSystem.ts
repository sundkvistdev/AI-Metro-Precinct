import * as THREE from 'three';
import {
  AssetIssue,
  CustomMapAsset,
  EngineConfigAsset,
  LoadedJsonAssets,
} from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { TextureRegistry } from '../assets/textureRegistry';
import { StaticObstacleBVH } from './bvh';
import { CombatSystem } from './combatSystem';
import {
  AvoidanceVehicleProxy,
  computeAvoidanceSteerAndSpeed,
  computePurePursuitLookahead,
  updateImpatienceAndReverse,
} from './drivingAvoidance';
import { updateLightbarVisuals } from './lightbarSystem';
import {
  getSurfaceHeight,
  pruneLeadingWaypoints,
  TownRoadGraph,
} from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  CivilianVehicle,
  OfficerActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import {
  DrivingMode,
  LightbarMode,
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
): PoliceUnit[] {
  const units: PoliceUnit[] = [];
  const palette = config.vehicles.paintPalette;
  const stationBays = config.vehicles.stationBays;

  stationBays.forEach((bay, idx) => {
    const baseSwatch = palette[Math.floor(rng() * palette.length)] ?? palette[0];
    const baseColorHex = parseInt(baseSwatch.color.replace('#', ''), 16);
    const parkPos = new THREE.Vector3(...bay.parkPos);

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
    hierarchy.entities.police.add(rig.root);
    clickables.push(rig.clickableMesh);

    const maxHp = bay.vehicleKind === 'apc' ? 185 : bay.isHeavyUnit ? 160 : 100;
    const maxArmor = bay.vehicleKind === 'apc' ? 150 : bay.isHeavyUnit ? 120 : 45;
    const magSize = config.weapons[bay.weaponKind].magSize;

    const makeOfficer = (offsetZ: number, strafeSign: 1 | -1): OfficerActor => {
      const oRig = createHumanoid(
        bay.isHeavyUnit ? 'heavy_officer' : 'officer',
        assets,
        textures,
        undefined,
        onAssetIssue,
      );
      oRig.root.visible = false;
      hierarchy.entities.police.add(oRig.root);
      const startPos = parkPos.clone().add(new THREE.Vector3(0, 0, offsetZ));
      startPos.y = getSurfaceHeight(startPos.x, startPos.z, map ?? config.world);
      return {
        rig: oRig,
        pos: startPos,
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
        strafeSign,
        strafeTimer: 1.5 + rng() * 1.5,
        roamTarget: null,
        roamTimer: 0,
        roamPauseTimer: 0,
        mountPhase: 'walk',
        boardTimer: 0,
      };
    };

    const chassis = config.vehicles.chassis[bay.vehicleKind] ?? config.vehicles.chassis['sedan'];
    const mass =
      bay.isHeavyUnit && bay.vehicleKind === 'van'
        ? chassis.mass
        : bay.isHeavyUnit
        ? Math.max(chassis.mass, 1.85)
        : chassis.mass;

    units.push({
      id: bay.id,
      callsign: bay.callsign,
      bayIndex: idx,
      vehicleKind: bay.vehicleKind,
      liveryId: bay.liveryId,
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
      officers: [makeOfficer(0.8, 1), makeOfficer(-0.8, -1)],
      holdTimer: 0,
      stuckTimer: 0,
      impatience: 0,
      reverseTimer: 0,
      reverseSteerDir: 1,
      towRequested: false,
      beingTowed: false,
    });
  });

  return units;
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
  const bay = config.vehicles.stationBays[unit.bayIndex];
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
  unit.lightsActive = retreatMode;
  unit.sirensActive = retreatMode;
  unit.status = retreatMode ? UnitStatus.Retreating : UnitStatus.Returning;
  unit.avoidanceSteer = 0;
  unit.stuckTimer = 0;
  unit.reverseTimer = 0;

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
      audio?.playAssetAt('dispatch_chirp');
      return true;
    }
    if (best.immobilized) return false;
    best.freeRoam = false;
    best.mounted = true;
    best.mountTimer = 0;
    best.rig.cabinCrewGroup.visible = true;
    best.officers.forEach((o) => {
      o.rig.root.visible = false;
      o.ragdoll.active = false;
      o.roamTarget = null;
      resetOfficerPose(o, best.yaw);
    });
  }

  const urgencyNorm = THREE.MathUtils.clamp(crime.urgency / 100, 0, 1);
  const isAggro =
    drivingMode === DrivingMode.Aggressive || urgencyNorm >= 0.65 || best.isHeavyUnit;

  best.lightsActive = true;
  best.sirensActive = urgencyNorm >= 0.42 || drivingMode === DrivingMode.Aggressive;
  best.status = crime.inVehiclePursuit ? UnitStatus.Pursuing : UnitStatus.Responding;
  best.repathTimer = 0.75;
  best.avoidanceSteer = 0;
  best.stuckTimer = 0;
  best.reverseTimer = 0;

  const bay = config.vehicles.stationBays[best.bayIndex];
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

  if (best.pos.x < apronThresholdX) {
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

    // Filter out waypoints along x=-75 that sit behind the bay exit point
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

  audio?.playAssetAt('dispatch_chirp');
  return true;
}

export function dismountUnit(
  unit: PoliceUnit,
  cowardiceLevel: number,
  staticBvh: StaticObstacleBVH,
  config: EngineConfigAsset,
  rng: () => number,
  freeRoam = false,
  map?: CustomMapAsset,
): void {
  if (!unit.mounted) return;
  unit.mounted = false;
  unit.freeRoam = freeRoam;
  unit.dismountTimer = 0;
  unit.mountTimer = 0;
  unit.holdTimer = 0;
  unit.speed = 0;
  unit.dyn.vx = 0;
  unit.dyn.vz = 0;
  unit.dyn.omega = 0;
  unit.rig.cabinCrewGroup.visible = false;
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

  const sillOffsets: [number, number][] = [
    [0.92, 0.25],
    [-0.92, 0.25],
  ];
  unit.officers.forEach((off, idx) => {
    const [lx, lz] = sillOffsets[idx];
    off.pos.set(
      unit.pos.x + rightX * lx + fwdX * lz,
      0,
      unit.pos.z + rightZ * lx + fwdZ * lz,
    );
    staticBvh.resolveCircle(off.pos, 0.45);
    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, map ?? config.world);

    off.yaw = idx === 0 ? unit.yaw + Math.PI * 0.45 : unit.yaw - Math.PI * 0.45;
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

    const fearScale = off.isHeavy ? 0.22 : 1.0;
    off.morale = freeRoam
      ? 100
      : Math.max(40, 100 - cowardiceLevel * 42 * fearScale - rng() * 12 * fearScale);
    off.cowardiceState = off.morale < 52 && !off.isHeavy ? 'suppressed' : 'steady';
    resetOfficerPose(off, off.yaw);
    off.rig.torso.position.y = off.rig.torsoBaseY - 0.32;
    off.rig.root.position.copy(off.pos);
    off.rig.root.visible = true;
    off.fireCooldown = 0.2 + idx * 0.14;
  });

  unit.status = UnitStatus.Dismounting;
}

export interface PoliceUnitUpdateContext {
  units: PoliceUnit[];
  crimes: ActiveCrime[];
  pedestrians: PedestrianActor[];
  allVehicles: AvoidanceVehicleProxy[];
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  config: EngineConfigAsset;
  map?: CustomMapAsset;
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
    if (cr.inVehiclePursuit && cr.suspectAlive && cr.vehicleRig) {
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

export function updatePoliceUnits(ctx: PoliceUnitUpdateContext, dt: number): void {
  const {
    units,
    crimes,
    pedestrians,
    allVehicles,
    roadGraph,
    staticBvh,
    config,
    map,
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
  const primaryApron = roadGraph.stationZones[0];
  const apronThresholdX = primaryApron
    ? primaryApron.cx + primaryApron.width * 0.5 + 1
    : config.world.apronBounds.maxX + 1;
  const isAggro = drivingMode === DrivingMode.Aggressive;
  const gripScale = weather === WeatherCondition.Rain ? 0.68 : 1.0;
  const haloBoost =
    weather === WeatherCondition.Rain || weather === WeatherCondition.HeavyFog ? 1.35 : 1.0;

  for (const unit of units) {
    updateLightbarVisuals(
      unit.rig,
      lightbarMode,
      unit.lightsActive,
      simTime,
      haloBoost,
      unit.lightPhaseOffset,
      unit.lightRateMult,
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

    if (unit.status === UnitStatus.DeployingSpikes && !unit.mounted) {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.x, 0, 8, dt);
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        unit.immobilized ? unit.immobilizeTilt : 0,
        8,
        dt,
      );
      for (const off of unit.officers) {
        if (off.ragdoll.active) {
          stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
        }
      }
      unit.rig.root.position.copy(unit.pos);
      unit.rig.root.rotation.y = unit.yaw;
      continue;
    }

    if (
      unit.status === UnitStatus.Responding ||
      unit.status === UnitStatus.Pursuing ||
      unit.status === UnitStatus.DeployingSpikes ||
      unit.status === UnitStatus.Returning ||
      unit.status === UnitStatus.Retreating
    ) {
      const isPursuit = unit.status === UnitStatus.Pursuing;
      const isSpikeIntercept = unit.status === UnitStatus.DeployingSpikes;
      const isRetreat = unit.status === UnitStatus.Retreating;
      const crime = unit.targetCrimeId
        ? crimes.find((c) => c.id === unit.targetCrimeId)
        : undefined;

      if (unit.immobilized) {
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

        if (
          unit.speed < 1.3 &&
          (unit.status === UnitStatus.Responding || unit.status === UnitStatus.Pursuing)
        ) {
          dismountUnit(unit, cowardiceLevel, staticBvh, config, rng, false, map);
        }
        unit.rig.root.position.copy(unit.pos);
        unit.rig.root.rotation.y = unit.yaw;
        continue;
      }

      if (isPursuit && crime && !crime.inVehiclePursuit) {
        if (crime.suspectAlive) {
          if (unit.pos.distanceToSquared(crime.suspectPos) < 22 * 22) {
            dismountUnit(unit, cowardiceLevel, staticBvh, config, rng, false, map);
            continue;
          }
          unit.status = UnitStatus.Responding;
          unit.repathTimer = 0;
        } else {
          routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
        }
      }

      const rawUrgency = crime ? crime.urgency / 100 : isRetreat ? 0.72 : 0.38;
      const urgencyNorm = THREE.MathUtils.clamp(
        isAggro && crime ? Math.max(rawUrgency, 0.76) + 0.14 : rawUrgency,
        0.22,
        1.0,
      );
      const recklessness = THREE.MathUtils.clamp((urgencyNorm - 0.36) / 0.64, 0, 1);

      // Low urgency units run Code 2 (no siren) unless blocked and impatient
      if (
        crime &&
        (unit.status === UnitStatus.Responding || unit.status === UnitStatus.Pursuing)
      ) {
        unit.sirensActive =
          urgencyNorm >= 0.42 || isAggro || unit.impatience >= 0.48;
      }

      if (
        (isPursuit ||
          (unit.status === UnitStatus.Responding && unit.waypointIndex >= unit.waypoints.length)) &&
        crime &&
        crime.suspectAlive
      ) {
        unit.repathTimer -= dt;
        if (unit.repathTimer <= 0) {
          unit.repathTimer = isPursuit ? 0.55 : 1.8;
          const targetPos = crime.inVehiclePursuit ? crime.vehiclePos : crime.roadPullOverPos;
          const dSq = unit.pos.distanceToSquared(targetPos);

          if (
            crime.inVehiclePursuit &&
            dSq < 36 * 36 &&
            staticBvh.raycastSegment(
              unit.pos.x,
              unit.pos.z,
              crime.vehiclePos.x,
              crime.vehiclePos.z,
            ).clear
          ) {
            const distNow = Math.sqrt(dSq);
            const leadDist = distNow < 8 ? 0 : Math.min(8.5, distNow * 0.35);
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
      const urgencyCruise = THREE.MathUtils.lerp(11.2, 24.4, urgencyNorm);
      const baseCruise =
        (isRetreat ? 17.0 : urgencyCruise) * chassis.chassisScale;
      const maxCruise =
        isPursuit || isSpikeIntercept
          ? Math.max(baseCruise, THREE.MathUtils.lerp(18.5, 25.2, urgencyNorm) * chassis.chassisScale)
          : baseCruise;
      const maxAccel =
        THREE.MathUtils.lerp(5.4, 11.4, Math.max(urgencyNorm, isPursuit || isSpikeIntercept ? 0.72 : 0)) *
        chassis.chassisScale;
      const maxBrake = 12.2;
      const maxSteerRate =
        THREE.MathUtils.lerp(1.75, 2.75, Math.max(urgencyNorm, isPursuit || isSpikeIntercept ? 0.7 : 0)) *
        chassis.maxSteerScale;

      if (unit.waypointIndex >= unit.waypoints.length) {
        if (unit.status === UnitStatus.Responding) {
          const canPanicBeforeStop =
            !unit.isHeavyUnit && cowardiceLevel > 0.72 && rng() < (cowardiceLevel - 0.65) * 0.8;
          if (canPanicBeforeStop) {
            if (crime && crime.assignedUnitId === unit.id) {
              crime.assignedUnitId = null;
            }
            routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
          } else {
            dismountUnit(unit, cowardiceLevel, staticBvh, config, rng, false, map);
          }
        } else if (unit.status === UnitStatus.Pursuing) {
          unit.repathTimer = 0;
        } else if (unit.status === UnitStatus.DeployingSpikes) {
          unit.speed = 0;
          unit.dyn.vx = 0;
          unit.dyn.vz = 0;
        } else {
          const bay = config.vehicles.stationBays[unit.bayIndex];
          unit.pos.set(...bay.parkPos);
          unit.yaw = bay.parkYaw;
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
          unit.immobilized = false;
          unit.immobilizeTilt = 0;
          unit.status = UnitStatus.AtStation;
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
          unit.officers.forEach((o) => {
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
          const lookDist = isFinalWp ? dist : 7.5 + Math.min(4.2, Math.abs(unit.speed) * 0.22);
          const aim = computePurePursuitLookahead(
            unit.pos,
            unit.waypoints,
            unit.waypointIndex,
            lookDist,
          );
          const baseDesiredYaw = Math.atan2(aim.targetX - unit.pos.x, aim.targetZ - unit.pos.z);

          let upcomingCornerFactor = 1.0;
          if (dist < 15 && unit.waypointIndex + 1 < unit.waypoints.length) {
            const nextWp = unit.waypoints[unit.waypointIndex + 1];
            const ndx = nextWp.x - wp.x;
            const ndz = nextWp.z - wp.z;
            if (ndx * ndx + ndz * ndz > 4) {
              const nextYaw = Math.atan2(ndx, ndz);
              const bend = Math.abs(normalizeAngle(nextYaw - baseDesiredYaw));
              if (bend > 0.45) {
                upcomingCornerFactor = THREE.MathUtils.lerp(0.42, 0.72, recklessness);
              }
            }
          } else if (isFinalWp && !isPursuit && dist < 12) {
            upcomingCornerFactor = THREE.MathUtils.clamp(dist / 12, 0.25, 1.0);
          }

          const absYawDiff = Math.abs(normalizeAngle(baseDesiredYaw - unit.yaw));
          const curTurnFactor =
            absYawDiff > 1.15
              ? 0.28
              : absYawDiff > 0.65
              ? THREE.MathUtils.lerp(0.42, 0.56, recklessness)
              : absYawDiff > 0.3
              ? THREE.MathUtils.lerp(0.65, 0.8, recklessness)
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
          };
          const revStep = updateImpatienceAndReverse(revState, {
            baseGoalSpeed,
            actualSpeed: unit.speed,
            avoid,
            patienceRate: 0.2 + urgencyNorm * 0.38,
            reverseThresholdSec: THREE.MathUtils.lerp(2.1, 1.15, urgencyNorm),
            reverseDurationSec: 1.3,
            dt,
          });
          unit.impatience = revState.impatience;
          unit.stuckTimer = revState.stuckTimer;
          unit.reverseTimer = revState.reverseTimer;
          unit.reverseSteerDir = revState.reverseSteerDir;

          if (revStep.justFinishedReverse) {
            if (crime && crime.suspectAlive && unit.pos.x > apronThresholdX) {
              unit.repathTimer = 0;
            } else if (unit.status === UnitStatus.Returning || unit.status === UnitStatus.Retreating) {
              routeUnitToStation(unit, unit.status === UnitStatus.Retreating, roadGraph, config, staticBvh, map);
            }
          }

          const yawState = { yaw: unit.yaw, speed: unit.speed };
          const signedSpeed = stepVehicleDynamics(
            unit.pos,
            yawState,
            unit.dyn,
            unit.rig.bodyGroup,
            {
              targetSpeed: revStep.isReversing ? -4.4 : avoid.speedCap,
              desiredYaw: avoid.desiredYaw,
              maxAccel,
              maxBrake,
              maxSteerRate,
              lateralGrip: THREE.MathUtils.lerp(6.8, 5.1, recklessness) * gripScale,
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
    } else if (unit.status === UnitStatus.Dismounting) {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.dismountTimer += dt;
      const p = THREE.MathUtils.clamp(unit.dismountTimer / 0.72, 0, 1);
      const ease = p * p * (3 - 2 * p);

      const rightX = Math.cos(unit.yaw);
      const rightZ = -Math.sin(unit.yaw);
      const fwdX = Math.sin(unit.yaw);
      const fwdZ = Math.cos(unit.yaw);

      const targetTilt = unit.immobilized
        ? unit.immobilizeTilt
        : Math.sin(p * Math.PI) * 0.038;
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        targetTilt,
        10,
        dt,
      );

      unit.officers.forEach((off, idx) => {
        const sideSign = idx === 0 ? 1 : -1;
        const lat = THREE.MathUtils.lerp(0.92, 1.56, ease) * sideSign;
        const fwd = THREE.MathUtils.lerp(0.25, 0.35, ease);
        off.pos.set(
          unit.pos.x + rightX * lat + fwdX * fwd,
          0,
          unit.pos.z + rightZ * lat + fwdZ * fwd,
        );
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
    } else if (unit.status === UnitStatus.Engaging) {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      unit.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(unit.rig.bodyGroup.rotation.x, 0, 8, dt);
      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        unit.immobilized ? unit.immobilizeTilt : 0,
        8,
        dt,
      );

      let crime = crimes.find((c) => c.id === unit.targetCrimeId);
      if (unit.freeRoam && (!crime || !crime.suspectAlive)) {
        unit.targetCrimeId = null;
        const nearbyFoot = crimes.find(
          (c) =>
            c.suspectAlive &&
            !c.inVehiclePursuit &&
            c.pos.distanceToSquared(unit.officers[0].pos) < 46 * 46,
        );
        if (nearbyFoot) {
          crime = nearbyFoot;
          unit.targetCrimeId = nearbyFoot.id;
          if (!nearbyFoot.assignedUnitId) {
            nearbyFoot.assignedUnitId = unit.id;
          }
        }
      }

      if (crime && crime.suspectAlive && !crime.inVehiclePursuit) {
        let activeCombatants = 0;
        let fleeingCount = 0;

        unit.officers.forEach((off, idx) => {
          combat.updateOfficerCombat(
            off,
            idx,
            crime!,
            unit,
            cowardiceLevel,
            staticBvh,
            pedestrians,
            audio,
            dt,
          );
          if (off.hp > 0 && off.cowardiceState !== 'fleeing') activeCombatants++;
          if (off.hp > 0 && off.cowardiceState === 'fleeing') fleeingCount++;
        });

        if (activeCombatants === 0 || fleeingCount === 2) {
          if (crime.assignedUnitId === unit.id) {
            crime.assignedUnitId = null;
          }
          if (!unit.immobilized) {
            unit.holdTimer = 0;
            unit.mountTimer = 0;
            unit.freeRoam = false;
            unit.officers.forEach((o) => {
              o.mountPhase = 'walk';
              o.boardTimer = 0;
            });
            unit.status = UnitStatus.Mounting;
          }
        }
      } else if (crime && crime.suspectAlive && crime.inVehiclePursuit) {
        if (!unit.immobilized) {
          unit.holdTimer = 0;
          unit.mountTimer = 0;
          unit.freeRoam = false;
          unit.officers.forEach((o) => {
            o.mountPhase = 'walk';
            o.boardTimer = 0;
          });
          unit.status = UnitStatus.Mounting;
        }
      } else if (unit.freeRoam) {
        unit.targetCrimeId = null;
        unit.officers.forEach((off, idx) => {
          combat.updateOfficerFreeRoam(off, idx, unit, staticBvh, dt);
        });
      } else {
        unit.holdTimer += dt;
        if (unit.holdTimer > 1.8 && !unit.immobilized) {
          unit.holdTimer = 0;
          unit.mountTimer = 0;
          unit.officers.forEach((o) => {
            o.mountPhase = 'walk';
            o.boardTimer = 0;
          });
          unit.status = UnitStatus.Mounting;
        }
      }
    } else if (unit.status === UnitStatus.Mounting) {
      unit.mountTimer += dt;
      let allBack = true;
      let boardingRollPulse = 0;
      const isPanicRetreat = unit.officers.some(
        (o) => o.cowardiceState === 'fleeing' || o.hp <= 0,
      );
      const forceBoard = unit.mountTimer > 5.4;

      unit.officers.forEach((off, idx) => {
        if (!off.rig.root.visible) return;

        if (off.hp <= 0) {
          if (off.ragdoll.active) {
            stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
          }
          if (!forceBoard) {
            allBack = false;
            return;
          }
          off.rig.root.visible = false;
          off.ragdoll.active = false;
          resetOfficerPose(off, unit.yaw);
          return;
        }

        if (off.ragdoll.active) {
          stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
          off.ragdoll.recoverTimer -= dt * (unit.mountTimer > 2.5 ? 2.2 : 1.0);
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

        const sideSign = idx === 0 ? 1 : -1;
        const doorX = unit.pos.x + Math.cos(unit.yaw) * (1.3 * sideSign);
        const doorZ = unit.pos.z - Math.sin(unit.yaw) * (1.3 * sideSign);
        _tmpDoorPos.set(doorX, getSurfaceHeight(doorX, doorZ, world), doorZ);
        staticBvh.resolveCircle(_tmpDoorPos, 0.45);
        const doorShifted =
          Math.hypot(_tmpDoorPos.x - doorX, _tmpDoorPos.z - doorZ) > 0.35;

        const targetX = doorShifted ? unit.pos.x : _tmpDoorPos.x;
        const targetZ = doorShifted ? unit.pos.z : _tmpDoorPos.z;

        if (off.mountPhase === 'boarding') {
          allBack = false;
          off.boardTimer += dt;
          const b = THREE.MathUtils.clamp(off.boardTimer / 0.44, 0, 1);
          const ease = b * b * (3 - 2 * b);
          const cabinTargetX = unit.pos.x + Math.cos(unit.yaw) * (0.42 * sideSign);
          const cabinTargetZ = unit.pos.z - Math.sin(unit.yaw) * (0.42 * sideSign);

          off.pos.x = THREE.MathUtils.lerp(off.pos.x, cabinTargetX, Math.min(1, dt * 8));
          off.pos.z = THREE.MathUtils.lerp(off.pos.z, cabinTargetZ, Math.min(1, dt * 8));
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
          off.yaw = unit.yaw;
          off.rig.torso.position.y = THREE.MathUtils.lerp(
            off.rig.torsoBaseY,
            off.rig.torsoBaseY - 0.34,
            ease,
          );
          off.rig.leftLeg.rotation.x = THREE.MathUtils.lerp(0, -0.45, ease);
          off.rig.rightLeg.rotation.x = THREE.MathUtils.lerp(0, 0.2, ease);
          off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, 0, 12, dt);
          off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, 0, 12, dt);
          off.rig.root.position.copy(off.pos);
          off.rig.root.rotation.y = off.yaw;

          boardingRollPulse += Math.sin(b * Math.PI) * 0.03 * sideSign;

          if (b >= 1 || forceBoard) {
            off.rig.root.visible = false;
            off.ammo = config.weapons[off.weaponKind].magSize;
            off.reloadTimer = 0;
            off.roamTarget = null;
            resetOfficerPose(off, unit.yaw);
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
          const spd = isPanicRetreat ? 6.4 : 4.9;
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
        } else {
          off.rig.root.visible = false;
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          resetOfficerPose(off, unit.yaw);
        }
      });

      unit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
        unit.rig.bodyGroup.rotation.z,
        (unit.immobilized ? unit.immobilizeTilt : 0) + boardingRollPulse,
        10,
        dt,
      );

      if (allBack || forceBoard) {
        unit.mounted = true;
        unit.freeRoam = false;
        unit.mountTimer = 0;
        unit.rig.cabinCrewGroup.visible = true;
        unit.officers.forEach((off) => {
          off.rig.root.visible = false;
          off.ragdoll.active = false;
          off.ammo = config.weapons[off.weaponKind].magSize;
          off.reloadTimer = 0;
          off.roamTarget = null;
          off.mountPhase = 'walk';
          off.boardTimer = 0;
          resetOfficerPose(off, unit.yaw);
        });

        if (isPanicRetreat) {
          routeUnitToStation(unit, true, roadGraph, config, staticBvh, map);
        } else {
          const currCrime = unit.targetCrimeId
            ? crimes.find((c) => c.id === unit.targetCrimeId)
            : undefined;
          if (currCrime && currCrime.suspectAlive) {
            if (currCrime.inVehiclePursuit) {
              unit.status = UnitStatus.Pursuing;
              unit.lightsActive = true;
              unit.sirensActive = true;
              unit.repathTimer = 0;
            } else {
              unit.status = UnitStatus.Responding;
              unit.lightsActive = true;
              unit.sirensActive = currCrime.urgency >= 42;
              unit.waypoints = [];
              unit.waypointIndex = 0;
              unit.repathTimer = 0;
            }
          } else {
            unit.targetCrimeId = null;
            unit.assignedCaseNumber = null;
            unit.assignedRole = null;
            const pending = crimes.find((c) => c.suspectAlive && !c.assignedUnitId);
            if (pending) {
              dispatchNearestUnit(
                pending,
                units,
                roadGraph,
                config,
                drivingMode,
                audio,
                false,
                false,
                undefined,
                staticBvh,
                map,
              );
            } else {
              routeUnitToStation(unit, false, roadGraph, config, staticBvh, map);
            }
          }
        }
      }
    }

    unit.rig.root.position.copy(unit.pos);
    unit.rig.root.rotation.y = unit.yaw;
  }
}
