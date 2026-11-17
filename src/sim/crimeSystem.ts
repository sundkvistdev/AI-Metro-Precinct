import * as THREE from 'three';
import {
  AssetIssue,
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
} from './drivingAvoidance';
import { isPointNearArmedNailMat } from './nailMatSystem';
import { dismountUnit, dispatchNearestUnit } from './policeUnitSystem';
import { getSurfaceHeight, TownRoadGraph } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  NailMatActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import {
  CrimeType,
  DrivingMode,
  UnitStatus,
  WeaponKind,
  WeatherCondition,
} from './types';
import {
  CivilianCarRig,
  createCivilianCar,
  createHumanoid,
} from './vehicleModels';
import {
  applyVehicleWheelVisuals,
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';
import {
  createRagdollState,
  SimVfxManager,
  stepRagdollPhysics,
} from './vfx';

export interface SpawnCrimeParams {
  forcePursuit: boolean;
  crimes: ActiveCrime[];
  crimeCounter: number;
  units: PoliceUnit[];
  hierarchy: SceneWorldHierarchy;
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  config: EngineConfigAsset;
  assets: LoadedJsonAssets;
  textures: TextureRegistry;
  drivingMode: DrivingMode;
  audio: JsonAudioSynth | null;
  rng: () => number;
  onAssetIssue?: (issue: AssetIssue) => void;
}

export function spawnCrime(params: SpawnCrimeParams): ActiveCrime | null {
  const {
    forcePursuit,
    crimes,
    crimeCounter,
    units,
    hierarchy,
    roadGraph,
    staticBvh,
    config,
    assets,
    textures,
    drivingMode,
    audio,
    rng,
    onAssetIssue,
  } = params;

  if (crimes.length >= config.simulation.maxActiveCrimes) return null;

  const isPursuit = forcePursuit || rng() < config.simulation.pursuitTriggerChance;
  const spot = roadGraph.generateRandomCrimeSpot(rng);
  const footTypes = [
    CrimeType.ArmedRobbery,
    CrimeType.ShotsFired,
    CrimeType.StorefrontHeist,
    CrimeType.StreetAssault,
  ];
  const type = isPursuit
    ? CrimeType.VehiclePursuit
    : footTypes[crimeCounter % footTypes.length];
  const id = `crime-${crimeCounter}`;

  const suspectRig = createHumanoid(
    'suspect',
    assets,
    textures,
    undefined,
    onAssetIssue,
  );
  const pos = new THREE.Vector3(spot.x, 0, spot.z);
  staticBvh.resolveCircle(pos, 0.52);
  pos.y = getSurfaceHeight(pos.x, pos.z, config.world);
  suspectRig.root.position.copy(pos);
  suspectRig.root.visible = !isPursuit;
  hierarchy.entities.crimes.add(suspectRig.root);

  const suspectWeaponKind: WeaponKind =
    !isPursuit &&
    (type === CrimeType.ArmedRobbery || rng() < config.simulation.suspectRifleChance)
      ? 'rifle'
      : 'pistol';
  const suspectArmor = suspectWeaponKind === 'rifle' ? 40 : 15;
  const magSize = config.weapons[suspectWeaponKind].magSize;

  let vehicleRig: CivilianCarRig | null = null;
  let vehicleThreatRing: THREE.Mesh | null = null;
  const vehiclePos = new THREE.Vector3();
  const vehicleDyn = createVehicleDynState();
  let vehicleYaw = 0;
  let vehicleNodeId = spot.nearestNodeId;
  let vehicleNextNodeId = spot.nearestNodeId;

  if (isPursuit) {
    const startNode = roadGraph.nodes[spot.nearestNodeId];
    vehicleNextNodeId =
      startNode.neighbors[Math.floor(rng() * startNode.neighbors.length)];
    const nextNode = roadGraph.nodes[vehicleNextNodeId];
    const dx = nextNode.x - startNode.x;
    const dz = nextNode.z - startNode.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const laneOffset = config.world.laneOffset;
    const vx0 = startNode.x + ux * 16 - uz * laneOffset;
    const vz0 = startNode.z + uz * 16 + ux * laneOffset;
    vehiclePos.set(vx0, getSurfaceHeight(vx0, vz0, config.world), vz0);
    vehicleYaw = Math.atan2(ux, uz);
    vehicleDyn.vx = ux * 11;
    vehicleDyn.vz = uz * 11;
    vehicleNodeId = startNode.id;

    const variants: ('sedan' | 'hatch')[] = ['sedan', 'hatch'];
    const paletteHexes = config.world.getawayColors.map((c) =>
      parseInt(c.replace('#', ''), 16),
    );
    const colorHex = paletteHexes[crimeCounter % paletteHexes.length] ?? 0x991b1b;
    vehicleRig = createCivilianCar(
      variants[crimeCounter % variants.length],
      colorHex,
      assets,
      textures,
      onAssetIssue,
    );
    vehicleRig.root.position.copy(vehiclePos);
    vehicleRig.root.rotation.y = vehicleYaw;

    vehicleThreatRing = new THREE.Mesh(
      new THREE.RingGeometry(1.75, 2.25, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
      }),
    );
    vehicleThreatRing.position.y = 0.06;
    vehicleRig.root.add(vehicleThreatRing);
    hierarchy.entities.crimes.add(vehicleRig.root);
  }

  const crime: ActiveCrime = {
    id,
    type,
    district: spot.district,
    pos: isPursuit ? vehiclePos.clone() : pos.clone(),
    roadPullOverPos: isPursuit ? vehiclePos.clone() : spot.roadPullOverPos.clone(),
    roadPullOverYaw: spot.roadPullOverYaw,
    nearestNodeId: spot.nearestNodeId,
    suspectRig,
    suspectPos: isPursuit ? vehiclePos.clone() : pos.clone(),
    suspectYaw: rng() * Math.PI * 2,
    suspectHp: 100,
    suspectArmor,
    suspectWeaponKind,
    suspectAlive: true,
    suspectAmmo: magSize,
    suspectReloadTimer: 0,
    suspectRecoil: 0,
    suspectStrafeDir: rng() < 0.5 ? 1 : -1,
    suspectMoveTimer: 1.5,
    suspectWalkPhase: 0,
    suspectRagdoll: createRagdollState(),
    lastHitDir: new THREE.Vector3(0, 0, 1),
    inVehiclePursuit: isPursuit,
    vehicleRig,
    vehicleThreatRing,
    vehiclePos,
    vehicleYaw,
    vehicleSpeed: isPursuit ? 11 : 0,
    vehicleDyn,
    vehicleMaxSpeed: 18.2 + rng() * 2.4,
    vehicleHp: 100,
    vehicleNodeId,
    vehicleNextNodeId,
    vehicleTurnApex: null,
    vehiclePinnedTimer: 0,
    vehicleStuckTimer: 0,
    vehicleImmobilized: false,
    vehicleImmobilizeTilt: 0,
    vehicleTireBlowoutTimer: 0,
    vehicleSmokeTimer: 0,
    vehicleSmokeAccum: 0,
    assignedUnitId: null,
    backupDispatched: false,
    heavyDeployed: false,
    nailMatAttempts: 0,
    fireCooldown: 1.1,
    muzzleTimer: 0,
    cleanupTimer: 4.5,
    elapsedSec: 0,
    engagedSec: 0,
  };

  crimes.push(crime);
  dispatchNearestUnit(crime, units, roadGraph, config, drivingMode, audio);
  return crime;
}

export function bailOutGetawaySuspect(
  crime: ActiveCrime,
  units: PoliceUnit[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  config: EngineConfigAsset,
  cowardiceLevel: number,
  rng: () => number,
): void {
  if (!crime.inVehiclePursuit) return;
  crime.inVehiclePursuit = false;
  crime.vehicleSpeed = 0;
  crime.vehicleDyn.vx = 0;
  crime.vehicleDyn.vz = 0;
  crime.vehicleSmokeTimer = 18;
  if (crime.vehicleThreatRing) {
    crime.vehicleThreatRing.visible = false;
  }

  const sideX = Math.cos(crime.vehicleYaw) * 1.8;
  const sideZ = -Math.sin(crime.vehicleYaw) * 1.8;
  crime.suspectPos.set(crime.vehiclePos.x + sideX, 0, crime.vehiclePos.z + sideZ);
  staticBvh.resolveCircle(crime.suspectPos, 0.52);
  crime.suspectPos.y = getSurfaceHeight(crime.suspectPos.x, crime.suspectPos.z, config.world);
  crime.pos.copy(crime.suspectPos);
  crime.roadPullOverPos.copy(crime.vehiclePos);
  crime.nearestNodeId = roadGraph.findNearestNode(crime.vehiclePos.x, crime.vehiclePos.z).id;
  crime.suspectRig.root.position.copy(crime.suspectPos);
  crime.suspectRig.root.visible = true;

  for (const u of units) {
    if (u.targetCrimeId === crime.id && u.status === UnitStatus.Pursuing) {
      if (u.pos.distanceToSquared(crime.vehiclePos) < 22 * 22) {
        dismountUnit(u, cowardiceLevel, staticBvh, config, rng);
      } else {
        u.status = UnitStatus.Responding;
        u.repathTimer = 0;
      }
    }
  }
}

export function updateGetawayVehicle(
  crime: ActiveCrime,
  units: PoliceUnit[],
  pedestrians: PedestrianActor[],
  allVehicles: AvoidanceVehicleProxy[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  config: EngineConfigAsset,
  combat: CombatSystem,
  vfx: SimVfxManager,
  weather: WeatherCondition,
  cowardiceLevel: number,
  simTime: number,
  rng: () => number,
  dt: number,
): void {
  const world = config.world;
  const laneOffset = world.laneOffset;

  if (crime.vehicleTireBlowoutTimer > 0 && !crime.vehicleImmobilized) {
    crime.vehicleTireBlowoutTimer = Math.max(0, crime.vehicleTireBlowoutTimer - dt);
    if (crime.vehicleSpeed > 3.5 && rng() < 0.65) {
      vfx.spawnImpactSparks(
        crime.vehiclePos.x + (rng() - 0.5) * 1.4,
        0.2,
        crime.vehiclePos.z + (rng() - 0.5) * 1.4,
        2,
        0.85,
        0,
        0,
      );
    }
    if (crime.vehicleTireBlowoutTimer <= 0) {
      crime.vehicleImmobilized = true;
      crime.vehicleImmobilizeTilt = (rng() < 0.5 ? 1 : -1) * 0.16;
      crime.vehicleSmokeTimer = Math.max(crime.vehicleSmokeTimer, 18);
    }
  }

  if (crime.vehicleImmobilized) {
    const yawState = { yaw: crime.vehicleYaw, speed: crime.vehicleSpeed };
    stepVehicleDynamics(
      crime.vehiclePos,
      yawState,
      crime.vehicleDyn,
      crime.vehicleRig!.bodyGroup,
      {
        targetSpeed: 0,
        desiredYaw: crime.vehicleYaw,
        maxAccel: 0,
        maxBrake: 12,
        maxSteerRate: 0.4,
        lateralGrip: 8.0,
        mass: 1.15,
      },
      dt,
    );
    crime.vehicleYaw = yawState.yaw;
    crime.vehicleSpeed = yawState.speed;
    crime.vehicleRig!.bodyGroup.rotation.z = THREE.MathUtils.damp(
      crime.vehicleRig!.bodyGroup.rotation.z,
      crime.vehicleImmobilizeTilt,
      6,
      dt,
    );
    crime.vehiclePos.y = getSurfaceHeight(crime.vehiclePos.x, crime.vehiclePos.z, world);
    crime.vehicleRig!.root.position.copy(crime.vehiclePos);
    crime.vehicleRig!.root.rotation.y = crime.vehicleYaw;
    bailOutGetawaySuspect(crime, units, roadGraph, staticBvh, config, cowardiceLevel, rng);
    return;
  }

  const currNode = roadGraph.nodes[crime.vehicleNodeId];
  const nextNode = roadGraph.nodes[crime.vehicleNextNodeId];

  const segDx = nextNode.x - currNode.x;
  const segDz = nextNode.z - currNode.z;
  const segLen = Math.hypot(segDx, segDz) || 1;
  const ux = segDx / segLen;
  const uz = segDz / segLen;
  const rx = -uz * laneOffset;
  const rz = ux * laneOffset;

  let targetX = nextNode.x - ux * 7.5 + rx;
  let targetZ = nextNode.z - uz * 7.5 + rz;
  if (crime.vehicleTurnApex) {
    targetX = crime.vehicleTurnApex.x;
    targetZ = crime.vehicleTurnApex.z;
  }

  const dx = targetX - crime.vehiclePos.x;
  const dz = targetZ - crime.vehiclePos.z;
  const dist = Math.hypot(dx, dz);
  const vehFwdX = Math.sin(crime.vehicleYaw);
  const vehFwdZ = Math.cos(crime.vehicleYaw);
  const passedTarget = dx * vehFwdX + dz * vehFwdZ < -1.0 && dist < 16;

  if (dist < 5.5 || passedTarget) {
    if (crime.vehicleTurnApex) {
      crime.vehicleTurnApex = null;
    } else {
      const candidates = nextNode.neighbors.filter((n) => n !== crime.vehicleNodeId);
      const pool = candidates.length > 0 ? candidates : nextNode.neighbors;
      let pick = pool[0];
      let bestScore = -Infinity;

      for (const candId of pool) {
        const cand = roadGraph.nodes[candId];
        let minWeightedCopDist = Infinity;
        for (const u of units) {
          const d = Math.hypot(cand.x - u.pos.x, cand.z - u.pos.z);
          const weight =
            u.status === UnitStatus.Pursuing || u.status === UnitStatus.Responding ? 0.65 : 1.0;
          const wd = d * weight;
          if (wd < minWeightedCopDist) minWeightedCopDist = wd;
        }
        const cDx = cand.x - nextNode.x;
        const cDz = cand.z - nextNode.z;
        const cLen = Math.hypot(cDx, cDz) || 1;
        const momentumBonus = ((cDx / cLen) * vehFwdX + (cDz / cLen) * vehFwdZ) * 34;
        const edgePenalty = Math.abs(cand.x) >= 148 || Math.abs(cand.z) >= 148 ? -18 : 0;
        const score = minWeightedCopDist + momentumBonus + edgePenalty + rng() * 18;
        if (score > bestScore) {
          bestScore = score;
          pick = candId;
        }
      }

      const afterNode = roadGraph.nodes[pick];
      const ndx = afterNode.x - nextNode.x;
      const ndz = afterNode.z - nextNode.z;
      const nlen = Math.hypot(ndx, ndz) || 1;
      const nrx = -(ndz / nlen) * laneOffset;
      const nrz = (ndx / nlen) * laneOffset;

      crime.vehicleTurnApex = new THREE.Vector3(
        nextNode.x + (rx + nrx) * 0.5,
        world.surfaceHeights.road,
        nextNode.z + (rz + nrz) * 0.5,
      );
      crime.vehicleNodeId = crime.vehicleNextNodeId;
      crime.vehicleNextNodeId = pick;
    }
  } else {
    const baseDesiredYaw = Math.atan2(dx, dz);
    const yawDiff = normalizeAngle(baseDesiredYaw - crime.vehicleYaw);
    const absYawDiff = Math.abs(yawDiff);
    const cornerPenalty = absYawDiff > 0.85 ? 0.44 : absYawDiff > 0.38 ? 0.68 : 1.0;
    const blowoutActive = crime.vehicleTireBlowoutTimer > 0;
    const grip = blowoutActive ? 1.55 : weather === WeatherCondition.Rain ? 4.2 : 6.2;
    const speedFactor = blowoutActive ? 0.38 : cornerPenalty;

    const avoid = computeAvoidanceSteerAndSpeed({
      selfId: `getaway-${crime.id}`,
      pos: crime.vehiclePos,
      yaw: crime.vehicleYaw,
      speed: crime.vehicleSpeed,
      selfHalfW: 0.92,
      selfHalfL: 2.24,
      baseDesiredYaw,
      baseSpeed: crime.vehicleMaxSpeed * speedFactor,
      prevSteerBias: 0,
      canOvertake: true,
      allVehicles,
      pedestrians,
      staticBvh,
      dt,
    });

    let targetYaw = avoid.desiredYaw;
    if (
      !blowoutActive &&
      isPointNearArmedNailMat(crime.vehiclePos.x, crime.vehiclePos.z, vehFwdX, vehFwdZ, nailMats)
    ) {
      targetYaw += (crime.id.charCodeAt(crime.id.length - 1) % 2 === 0 ? 1 : -1) * 0.12;
    }

    const yawState = { yaw: crime.vehicleYaw, speed: crime.vehicleSpeed };
    stepVehicleDynamics(
      crime.vehiclePos,
      yawState,
      crime.vehicleDyn,
      crime.vehicleRig!.bodyGroup,
      {
        targetSpeed: avoid.speedCap,
        desiredYaw: targetYaw,
        maxAccel: blowoutActive ? 1.5 : 11.0,
        maxBrake: 12.0,
        maxSteerRate: blowoutActive ? 1.35 : 2.75,
        lateralGrip: grip,
        mass: 1.15,
      },
      dt,
    );
    crime.vehicleYaw = yawState.yaw;
    crime.vehicleSpeed = yawState.speed;

    if (crime.vehicleSpeed > 4.0) {
      combat.checkVehiclePedestrianStrike(
        crime.vehiclePos,
        crime.vehicleYaw,
        crime.vehicleSpeed,
        pedestrians,
      );
    }
  }

  let policeAdjacent = false;
  for (const u of units) {
    if (u.status === UnitStatus.Pursuing && u.pos.distanceToSquared(crime.vehiclePos) < 5.5 * 5.5) {
      policeAdjacent = true;
      break;
    }
  }
  if (policeAdjacent && crime.vehicleSpeed < 3.5) {
    crime.vehiclePinnedTimer += dt;
    crime.vehicleStuckTimer = 0;
  } else {
    crime.vehiclePinnedTimer = Math.max(0, crime.vehiclePinnedTimer - dt);
    if (crime.vehicleSpeed < 1.2) {
      crime.vehicleStuckTimer += dt;
      if (crime.vehicleStuckTimer > 1.5) {
        crime.vehicleStuckTimer = 0;
        crime.vehicleTurnApex = null;
        const pool = nextNode.neighbors.filter((n) => n !== crime.vehicleNodeId);
        if (pool.length > 0) {
          crime.vehicleNodeId = crime.vehicleNextNodeId;
          crime.vehicleNextNodeId = pool[Math.floor(rng() * pool.length)];
        }
      }
    } else {
      crime.vehicleStuckTimer = 0;
    }
  }

  crime.vehiclePos.y = getSurfaceHeight(crime.vehiclePos.x, crime.vehiclePos.z, world);
  crime.pos.copy(crime.vehiclePos);
  crime.suspectPos.copy(crime.vehiclePos);

  if (crime.vehicleRig) {
    crime.vehicleRig.root.position.copy(crime.vehiclePos);
    crime.vehicleRig.root.rotation.y = crime.vehicleYaw;
    applyVehicleWheelVisuals(
      crime.vehicleRig.wheels,
      undefined,
      crime.vehicleSpeed,
      0,
      0.33,
      dt,
    );
  }

  if (crime.vehicleThreatRing) {
    const pulse = 1 + Math.sin(simTime * 6) * 0.1;
    crime.vehicleThreatRing.scale.set(pulse, pulse, 1);
  }

  if (crime.vehicleHp <= 0 || crime.vehiclePinnedTimer >= 2.2) {
    bailOutGetawaySuspect(crime, units, roadGraph, staticBvh, config, cowardiceLevel, rng);
  }
}

export interface UpdateCrimesParams {
  crimes: ActiveCrime[];
  units: PoliceUnit[];
  pedestrians: PedestrianActor[];
  allVehicles: AvoidanceVehicleProxy[];
  nailMats: NailMatActor[];
  hierarchy: SceneWorldHierarchy;
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  config: EngineConfigAsset;
  combat: CombatSystem;
  vfx: SimVfxManager;
  audio: JsonAudioSynth | null;
  weather: WeatherCondition;
  cowardiceLevel: number;
  simTime: number;
  rng: () => number;
  onCrimeCleared: () => void;
}

export function updateCrimes(params: UpdateCrimesParams, dt: number): void {
  const {
    crimes,
    units,
    pedestrians,
    allVehicles,
    nailMats,
    hierarchy,
    roadGraph,
    staticBvh,
    config,
    combat,
    vfx,
    audio,
    weather,
    cowardiceLevel,
    simTime,
    rng,
    onCrimeCleared,
  } = params;

  for (let i = crimes.length - 1; i >= 0; i--) {
    const c = crimes[i];
    c.elapsedSec += dt;

    if (c.suspectAlive) {
      const activelyEngaged = units.some(
        (u) =>
          u.targetCrimeId === c.id &&
          (u.status === UnitStatus.Dismounting ||
            u.status === UnitStatus.Engaging ||
            (u.status === UnitStatus.Pursuing &&
              u.pos.distanceToSquared(c.vehiclePos) < 28 * 28)),
      );
      if (activelyEngaged) {
        c.engagedSec += dt;
      }
    }

    if (c.muzzleTimer > 0) {
      c.muzzleTimer -= dt;
      if (c.muzzleTimer <= 0 && c.suspectRig.muzzleFlash) {
        c.suspectRig.muzzleFlash.visible = false;
      }
    }

    if (c.vehicleRig && c.vehicleSmokeTimer > 0) {
      c.vehicleSmokeTimer -= dt;
      c.vehicleSmokeAccum += dt;
      if (c.vehicleSmokeAccum >= 0.12) {
        c.vehicleSmokeAccum = 0;
        const hoodX = c.vehiclePos.x + Math.sin(c.vehicleYaw) * 1.65;
        const hoodZ = c.vehiclePos.z + Math.cos(c.vehicleYaw) * 1.65;
        vfx.spawnSmokePuff(hoodX, 1.0, hoodZ, 0.95, 0.48, 0.78, 2.5);
      }
    }

    if (c.suspectAlive && c.inVehiclePursuit && c.vehicleRig) {
      updateGetawayVehicle(
        c,
        units,
        pedestrians,
        allVehicles,
        nailMats,
        roadGraph,
        staticBvh,
        config,
        combat,
        vfx,
        weather,
        cowardiceLevel,
        simTime,
        rng,
        dt,
      );
      continue;
    }

    if (c.suspectAlive) {
      combat.updateFootCrimeSuspect(
        c,
        units,
        cowardiceLevel,
        staticBvh,
        audio,
        simTime,
        dt,
      );
    } else {
      stepRagdollPhysics(c.suspectRagdoll, c.suspectPos, c.suspectRig, staticBvh, config.world, dt);
      c.cleanupTimer -= dt;
      if (c.cleanupTimer <= 0) {
        hierarchy.entities.crimes.remove(c.suspectRig.root);
        if (c.vehicleRig) {
          hierarchy.entities.crimes.remove(c.vehicleRig.root);
        }
        crimes.splice(i, 1);
        onCrimeCleared();
      }
    }
  }
}
