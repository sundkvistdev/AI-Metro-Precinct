import * as THREE from 'three';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { StaticObstacleBVH } from './bvh';
import { CombatSystem } from './combatSystem';
import { computeAvoidanceSteerAndSpeed } from './drivingAvoidance';
import { isPointNearArmedNailMat } from './nailMatSystem';
import {
  applyVehicleWheelVisuals,
  buildAllVehicleProxies,
  dismountUnit,
} from './policeUnitSystem';
import { getSurfaceHeight, LANE_OFFSET, TownRoadGraph } from './roadGraph';
import {
  ActiveCrime,
  CivilianVehicle,
  NailMatActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { ProceduralTexturePack } from './textures';
import { UnitStatus, WeatherCondition } from './types';
import { createCivilianCar, createHumanoid } from './vehicleModels';
import {
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';
import { createRagdollState, SimVfxManager, stepRagdollPhysics } from './vfx';

export function spawnCivilianTraffic(
  count: number,
  scene: THREE.Scene,
  roadGraph: TownRoadGraph,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
): CivilianVehicle[] {
  const civilianCars: CivilianVehicle[] = [];
  const variants: ('sedan' | 'hatch' | 'taxi' | 'van')[] = ['sedan', 'hatch', 'taxi', 'van'];
  const colors = [0x94a3b8, 0x3b82f6, 0x10b981, 0xb91c1c, 0x6366f1, 0xd97706, 0xe2e8f0];

  for (let i = 0; i < count; i++) {
    const variant = variants[i % variants.length];
    const rig = createCivilianCar(variant, colors[i % colors.length], assets, textures);
    const startNode = roadGraph.nodes[(i * 3) % roadGraph.nodes.length];
    const nextNodeId = startNode.neighbors[i % startNode.neighbors.length];
    const nextNode = roadGraph.nodes[nextNodeId];

    const dx = nextNode.x - startNode.x;
    const dz = nextNode.z - startNode.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const rx = -uz * LANE_OFFSET;
    const rz = ux * LANE_OFFSET;

    const t = 0.25 + ((i * 19) % 50) / 100;
    const px = startNode.x + dx * t + rx;
    const pz = startNode.z + dz * t + rz;
    const pos = new THREE.Vector3(px, getSurfaceHeight(px, pz), pz);
    const yaw = Math.atan2(ux, uz);
    const initSpeed = 7.5 + (i % 4) * 1.1;
    const dyn = createVehicleDynState();
    dyn.vx = ux * initSpeed;
    dyn.vz = uz * initSpeed;

    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    scene.add(rig.root);

    civilianCars.push({
      id: `civ-${i}`,
      rig,
      pos,
      yaw,
      speed: initSpeed,
      dyn,
      maxSpeed: 8.5 + (i % 4) * 1.2,
      currentNodeId: startNode.id,
      nextNodeId,
      prevNodeId: startNode.id,
      turnApex: null,
      lateralYield: 0,
      stunTimer: 0,
      immobilized: false,
      immobilizeTilt: 0,
      damageSmokeTimer: 0,
      smokeAccum: 0,
    });
  }

  return civilianCars;
}

export function spawnPedestrians(
  count: number,
  scene: THREE.Scene,
  staticBvh: StaticObstacleBVH,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  rng: () => number,
): PedestrianActor[] {
  const pedestrians: PedestrianActor[] = [];
  const shirtColors = [0x475569, 0x0f766e, 0x92400e, 0x3730a3, 0xbe123c, 0x3f6212, 0x0369a1];
  const blockCenters = [-112.5, -37.5, 37.5, 112.5];
  const loopRadius = (75 - 14) * 0.5 - 1.8;

  for (let i = 0; i < count; i++) {
    const bx = blockCenters[i % blockCenters.length];
    const bz = blockCenters[Math.floor(i / 4) % blockCenters.length];
    const safeBx = bx === -112.5 && bz === -37.5 ? 37.5 : bx;
    const cornerIdx = i % 4;
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;

    const corners = [
      [safeBx - loopRadius, bz - loopRadius],
      [safeBx + loopRadius, bz - loopRadius],
      [safeBx + loopRadius, bz + loopRadius],
      [safeBx - loopRadius, bz + loopRadius],
    ];
    const [cx, cz] = corners[cornerIdx];
    const rig = createHumanoid('pedestrian', assets, textures, shirtColors[i % shirtColors.length]);
    const pos = new THREE.Vector3(cx, getSurfaceHeight(cx, cz), cz);
    staticBvh.resolveCircle(pos, 0.45);
    pos.y = getSurfaceHeight(pos.x, pos.z);
    rig.root.position.copy(pos);
    scene.add(rig.root);

    pedestrians.push({
      rig,
      pos,
      yaw: 0,
      blockCx: safeBx,
      blockCz: bz,
      loopRadius,
      cornerIdx,
      dir,
      walkPhase: rng() * Math.PI * 2,
      panicTimer: 0,
      ragdoll: createRagdollState(),
    });
  }

  return pedestrians;
}

export function bailOutGetawaySuspect(
  crime: ActiveCrime,
  units: PoliceUnit[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
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
  crime.suspectPos.y = getSurfaceHeight(crime.suspectPos.x, crime.suspectPos.z);
  crime.pos.copy(crime.suspectPos);
  crime.roadPullOverPos.copy(crime.vehiclePos);
  crime.nearestNodeId = roadGraph.findNearestNode(crime.vehiclePos.x, crime.vehiclePos.z).id;
  crime.suspectRig.root.position.copy(crime.suspectPos);
  crime.suspectRig.root.visible = true;

  for (const u of units) {
    if (u.targetCrimeId === crime.id && u.status === UnitStatus.Pursuing) {
      if (u.pos.distanceToSquared(crime.vehiclePos) < 22 * 22) {
        dismountUnit(u, cowardiceLevel, staticBvh, rng);
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
  civilianCars: CivilianVehicle[],
  crimes: ActiveCrime[],
  pedestrians: PedestrianActor[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  combat: CombatSystem,
  vfx: SimVfxManager,
  weather: WeatherCondition,
  cowardiceLevel: number,
  simTime: number,
  rng: () => number,
  dt: number,
): void {
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
    crime.vehiclePos.y = getSurfaceHeight(crime.vehiclePos.x, crime.vehiclePos.z);
    crime.vehicleRig!.root.position.copy(crime.vehiclePos);
    crime.vehicleRig!.root.rotation.y = crime.vehicleYaw;
    bailOutGetawaySuspect(crime, units, roadGraph, staticBvh, cowardiceLevel, rng);
    return;
  }

  const currNode = roadGraph.nodes[crime.vehicleNodeId];
  const nextNode = roadGraph.nodes[crime.vehicleNextNodeId];

  const segDx = nextNode.x - currNode.x;
  const segDz = nextNode.z - currNode.z;
  const segLen = Math.hypot(segDx, segDz) || 1;
  const ux = segDx / segLen;
  const uz = segDz / segLen;
  const rx = -uz * LANE_OFFSET;
  const rz = ux * LANE_OFFSET;

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
      const nrx = -(ndz / nlen) * LANE_OFFSET;
      const nrz = (ndx / nlen) * LANE_OFFSET;

      crime.vehicleTurnApex = new THREE.Vector3(
        nextNode.x + (rx + nrx) * 0.5,
        0.035,
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

    const allVehicles = buildAllVehicleProxies(units, civilianCars, crimes);
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

    // Slight panicked swerve if suspect spots a spike strip right ahead
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

  crime.vehiclePos.y = getSurfaceHeight(crime.vehiclePos.x, crime.vehiclePos.z);
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
    bailOutGetawaySuspect(crime, units, roadGraph, staticBvh, cowardiceLevel, rng);
  }
}

export function updateCivilianTraffic(
  civilianCars: CivilianVehicle[],
  units: PoliceUnit[],
  crimes: ActiveCrime[],
  pedestrians: PedestrianActor[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  combat: CombatSystem,
  vfx: SimVfxManager,
  weather: WeatherCondition,
  rng: () => number,
  dt: number,
): void {
  const grip = weather === WeatherCondition.Rain ? 4.4 : 6.8;
  const allVehicles = buildAllVehicleProxies(units, civilianCars, crimes);

  for (let i = 0; i < civilianCars.length; i++) {
    const car = civilianCars[i];

    if (car.damageSmokeTimer > 0 || car.immobilized) {
      if (car.damageSmokeTimer > 0) car.damageSmokeTimer -= dt;
      car.smokeAccum += dt;
      if (car.smokeAccum >= 0.16) {
        car.smokeAccum = 0;
        const hoodX = car.pos.x + Math.sin(car.yaw) * 1.5;
        const hoodZ = car.pos.z + Math.cos(car.yaw) * 1.5;
        vfx.spawnSmokePuff(hoodX, 0.95, hoodZ, 0.75, 0.36, 0.6, 2.0);
      }
    }

    if (car.immobilized || car.stunTimer > 0) {
      if (car.stunTimer > 0) car.stunTimer -= dt;
      const damp = Math.exp((car.immobilized ? -6.5 : -5.0) * dt);
      car.dyn.vx *= damp;
      car.dyn.vz *= damp;
      car.pos.x += car.dyn.vx * dt;
      car.pos.z += car.dyn.vz * dt;
      car.speed = Math.hypot(car.dyn.vx, car.dyn.vz);
      if (car.immobilized) {
        car.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
          car.rig.bodyGroup.rotation.z,
          car.immobilizeTilt,
          6,
          dt,
        );
      }
      car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z);
      car.rig.root.position.copy(car.pos);
      car.rig.root.rotation.y = car.yaw;
      continue;
    }

    const currNode = roadGraph.nodes[car.currentNodeId];
    const nextNode = roadGraph.nodes[car.nextNodeId];

    const segDx = nextNode.x - currNode.x;
    const segDz = nextNode.z - currNode.z;
    const segLen = Math.hypot(segDx, segDz) || 1;
    const ux = segDx / segLen;
    const uz = segDz / segLen;

    let sirenNear = false;
    for (const u of units) {
      if (u.sirensActive && u.pos.distanceToSquared(car.pos) < 26 * 26) {
        sirenNear = true;
        break;
      }
    }
    car.lateralYield = THREE.MathUtils.damp(car.lateralYield, sirenNear ? 2.1 : 0, 5, dt);

    const laneOff = LANE_OFFSET + car.lateralYield;
    const rx = -uz * laneOff;
    const rz = ux * laneOff;

    let targetX = nextNode.x - ux * 7.5 + rx;
    let targetZ = nextNode.z - uz * 7.5 + rz;
    if (car.turnApex) {
      targetX = car.turnApex.x;
      targetZ = car.turnApex.z;
    }

    const dx = targetX - car.pos.x;
    const dz = targetZ - car.pos.z;
    const dist = Math.hypot(dx, dz);
    const fwdX = Math.sin(car.yaw);
    const fwdZ = Math.cos(car.yaw);
    const passedTarget = dx * fwdX + dz * fwdZ < -1.0 && dist < 14;

    if (dist < 4.2 || passedTarget) {
      if (car.turnApex) {
        car.turnApex = null;
      } else {
        const candidates = nextNode.neighbors.filter((n) => n !== car.currentNodeId);
        const pick =
          candidates.length > 0
            ? candidates[Math.floor(rng() * candidates.length)]
            : car.currentNodeId;
        const afterNode = roadGraph.nodes[pick];
        const ndx = afterNode.x - nextNode.x;
        const ndz = afterNode.z - nextNode.z;
        const nlen = Math.hypot(ndx, ndz) || 1;
        const nrx = -(ndz / nlen) * LANE_OFFSET;
        const nrz = (ndx / nlen) * LANE_OFFSET;

        car.turnApex = new THREE.Vector3(
          nextNode.x + (rx + nrx) * 0.5,
          0.035,
          nextNode.z + (rz + nrz) * 0.5,
        );
        car.prevNodeId = car.currentNodeId;
        car.currentNodeId = car.nextNodeId;
        car.nextNodeId = pick;
      }
    } else {
      const baseDesiredYaw = Math.atan2(dx, dz);
      const yawDiff = normalizeAngle(baseDesiredYaw - car.yaw);
      const turnPenalty = Math.abs(yawDiff) > 0.75 ? 0.52 : 1.0;
      const spikeAhead = isPointNearArmedNailMat(
        car.pos.x,
        car.pos.z,
        fwdX,
        fwdZ,
        nailMats,
      );
      const baseGoal = spikeAhead ? 0 : sirenNear ? 1.5 : car.maxSpeed * turnPenalty;

      const avoid = computeAvoidanceSteerAndSpeed({
        selfId: car.id,
        pos: car.pos,
        yaw: car.yaw,
        speed: car.speed,
        selfHalfW: 0.92,
        selfHalfL: 2.24,
        baseDesiredYaw,
        baseSpeed: baseGoal,
        prevSteerBias: 0,
        canOvertake: false,
        allVehicles,
        pedestrians,
        staticBvh,
        dt,
      });

      const yawState = { yaw: car.yaw, speed: car.speed };
      stepVehicleDynamics(
        car.pos,
        yawState,
        car.dyn,
        car.rig.bodyGroup,
        {
          targetSpeed: avoid.speedCap,
          desiredYaw: avoid.desiredYaw,
          maxAccel: 5.2,
          maxBrake: 11.2,
          maxSteerRate: 2.2,
          lateralGrip: grip,
          mass: 1.0,
        },
        dt,
      );
      car.yaw = yawState.yaw;
      car.speed = yawState.speed;

      if (car.speed > 4.0) {
        combat.checkVehiclePedestrianStrike(car.pos, car.yaw, car.speed, pedestrians);
      }

      applyVehicleWheelVisuals(car.rig.wheels, undefined, car.speed, 0, 0.33, dt);
    }

    car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z);
    car.rig.root.position.copy(car.pos);
    car.rig.root.rotation.y = car.yaw;
  }
}

export function updatePedestrians(
  pedestrians: PedestrianActor[],
  staticBvh: StaticObstacleBVH,
  dt: number,
): void {
  for (const ped of pedestrians) {
    if (ped.panicTimer > 0) ped.panicTimer -= dt;

    if (ped.ragdoll.active) {
      stepRagdollPhysics(ped.ragdoll, ped.pos, ped.rig, staticBvh, dt);
      ped.ragdoll.recoverTimer -= dt;
      if (ped.ragdoll.recoverTimer <= 0) {
        ped.ragdoll.active = false;
        ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z);
        ped.rig.root.rotation.set(0, ped.yaw, 0);
        ped.rig.leftArm.rotation.set(0, 0, 0);
        ped.rig.rightArm.rotation.set(0, 0, 0);
        ped.rig.leftLeg.rotation.set(0, 0, 0);
        ped.rig.rightLeg.rotation.set(0, 0, 0);
      }
      continue;
    }

    const r = ped.loopRadius;
    const corners = [
      [ped.blockCx - r, ped.blockCz - r],
      [ped.blockCx + r, ped.blockCz - r],
      [ped.blockCx + r, ped.blockCz + r],
      [ped.blockCx - r, ped.blockCz + r],
    ];
    const [tx, tz] = corners[ped.cornerIdx];
    const dx = tx - ped.pos.x;
    const dz = tz - ped.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.8) {
      ped.cornerIdx = (ped.cornerIdx + (ped.dir === 1 ? 1 : 3)) % 4;
    } else {
      const speed = ped.panicTimer > 0 ? 4.8 : 1.55;
      ped.yaw = Math.atan2(dx, dz);
      ped.pos.x += (dx / dist) * speed * dt;
      ped.pos.z += (dz / dist) * speed * dt;
      staticBvh.resolveCircle(ped.pos, 0.42);
      ped.walkPhase += dt * (ped.panicTimer > 0 ? 14 : 6.5);

      const swing = Math.sin(ped.walkPhase) * 0.45;
      ped.rig.leftLeg.rotation.x = swing;
      ped.rig.rightLeg.rotation.x = -swing;
      ped.rig.leftArm.rotation.x = -swing * 0.7;
      ped.rig.rightArm.rotation.x = swing * 0.7;
    }

    ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z);
    ped.rig.root.position.copy(ped.pos);
    ped.rig.root.rotation.y = ped.yaw;
  }
}
