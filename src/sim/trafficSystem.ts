import * as THREE from 'three';
import { AssetIssue, LoadedJsonAssets } from '../assets/assetTypes';
import { TextureRegistry } from '../assets/textureRegistry';
import { StaticObstacleBVH } from './bvh';
import { CombatSystem } from './combatSystem';
import {
  AvoidanceVehicleProxy,
  computeAvoidanceSteerAndSpeed,
} from './drivingAvoidance';
import { isPointNearArmedNailMat } from './nailMatSystem';
import { getSurfaceHeight, TownRoadGraph, WorldConfig } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  CivilianVehicle,
  NailMatActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { WeatherCondition } from './types';
import { createCivilianCar, createHumanoid } from './vehicleModels';
import {
  applyVehicleWheelVisuals,
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';
import { createRagdollState, SimVfxManager, stepRagdollPhysics } from './vfx';

export function spawnCivilianTraffic(
  hierarchy: SceneWorldHierarchy,
  world: WorldConfig,
  roadGraph: TownRoadGraph,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  onAssetIssue?: (issue: AssetIssue) => void,
): CivilianVehicle[] {
  const civilianCars: CivilianVehicle[] = [];
  const count = world.trafficCount;
  const variants = world.civilianVariants;
  const colors = world.civilianColors.map((c) => parseInt(c.replace('#', ''), 16));
  const laneOffset = world.laneOffset;

  for (let i = 0; i < count; i++) {
    const variant = variants[i % variants.length] ?? 'sedan';
    const colorHex = colors[i % colors.length] ?? 0x94a3b8;
    const rig = createCivilianCar(variant, colorHex, assets, textures, onAssetIssue);
    const startNode = roadGraph.nodes[(i * 3) % roadGraph.nodes.length];
    const nextNodeId = startNode.neighbors[i % startNode.neighbors.length];
    const nextNode = roadGraph.nodes[nextNodeId];

    const dx = nextNode.x - startNode.x;
    const dz = nextNode.z - startNode.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const rx = -uz * laneOffset;
    const rz = ux * laneOffset;

    const t = 0.25 + ((i * 19) % 50) / 100;
    const px = startNode.x + dx * t + rx;
    const pz = startNode.z + dz * t + rz;
    const pos = new THREE.Vector3(px, getSurfaceHeight(px, pz, world), pz);
    const yaw = Math.atan2(ux, uz);
    const initSpeed = 7.5 + (i % 4) * 1.1;
    const dyn = createVehicleDynState();
    dyn.vx = ux * initSpeed;
    dyn.vz = uz * initSpeed;

    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    hierarchy.entities.traffic.add(rig.root);

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
  hierarchy: SceneWorldHierarchy,
  world: WorldConfig,
  staticBvh: StaticObstacleBVH,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  rng: () => number,
  onAssetIssue?: (issue: AssetIssue) => void,
): PedestrianActor[] {
  const pedestrians: PedestrianActor[] = [];
  const count = world.pedestrianCount;
  const shirtColors = world.pedestrianShirtColors.map((c) => parseInt(c.replace('#', ''), 16));
  const blockCenters = world.blockCenters;
  const loopRadius = (75 - world.roadWidth) * 0.5 - 1.8;

  for (let i = 0; i < count; i++) {
    const bx = blockCenters[i % blockCenters.length];
    const bz = blockCenters[Math.floor(i / blockCenters.length) % blockCenters.length];
    const isStationBlock =
      bx >= world.stationBounds.minX &&
      bx <= world.stationBounds.maxX &&
      bz >= world.stationBounds.minZ &&
      bz <= world.stationBounds.maxZ;
    const safeBx = isStationBlock ? world.parkBlock.centerX : bx;
    const cornerIdx = i % 4;
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;

    const corners = [
      [safeBx - loopRadius, bz - loopRadius],
      [safeBx + loopRadius, bz - loopRadius],
      [safeBx + loopRadius, bz + loopRadius],
      [safeBx - loopRadius, bz + loopRadius],
    ];
    const [cx, cz] = corners[cornerIdx];
    const shirtHex = shirtColors[i % shirtColors.length] ?? 0x475569;
    const rig = createHumanoid('pedestrian', assets, textures, shirtHex, onAssetIssue);
    const pos = new THREE.Vector3(cx, getSurfaceHeight(cx, cz, world), cz);
    staticBvh.resolveCircle(pos, 0.45);
    pos.y = getSurfaceHeight(pos.x, pos.z, world);
    rig.root.position.copy(pos);
    hierarchy.entities.pedestrians.add(rig.root);

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

export function updateCivilianTraffic(
  civilianCars: CivilianVehicle[],
  units: PoliceUnit[],
  pedestrians: PedestrianActor[],
  allVehicles: AvoidanceVehicleProxy[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  world: WorldConfig,
  combat: CombatSystem,
  vfx: SimVfxManager,
  weather: WeatherCondition,
  rng: () => number,
  dt: number,
): void {
  const grip = weather === WeatherCondition.Rain ? 4.4 : 6.8;
  const baseLaneOffset = world.laneOffset;

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
      car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z, world);
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

    const laneOff = baseLaneOffset + car.lateralYield;
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
        const nrx = -(ndz / nlen) * baseLaneOffset;
        const nrz = (ndx / nlen) * baseLaneOffset;

        car.turnApex = new THREE.Vector3(
          nextNode.x + (rx + nrx) * 0.5,
          world.surfaceHeights.road,
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

    car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z, world);
    car.rig.root.position.copy(car.pos);
    car.rig.root.rotation.y = car.yaw;
  }
}

export function updatePedestrians(
  pedestrians: PedestrianActor[],
  staticBvh: StaticObstacleBVH,
  world: WorldConfig,
  dt: number,
): void {
  for (const ped of pedestrians) {
    if (ped.panicTimer > 0) ped.panicTimer -= dt;

    if (ped.ragdoll.active) {
      stepRagdollPhysics(ped.ragdoll, ped.pos, ped.rig, staticBvh, world, dt);
      ped.ragdoll.recoverTimer -= dt;
      if (ped.ragdoll.recoverTimer <= 0) {
        ped.ragdoll.active = false;
        ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z, world);
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

    ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z, world);
    ped.rig.root.position.copy(ped.pos);
    ped.rig.root.rotation.y = ped.yaw;
  }
}
