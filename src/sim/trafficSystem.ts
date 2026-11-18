import * as THREE from 'three';
import {
  AIGoalRuleDef,
  AssetIssue,
  CustomMapAsset,
  EngineConfigAsset,
  LoadedJsonAssets,
} from '../assets/assetTypes';
import { TextureRegistry } from '../assets/textureRegistry';
import { StaticObstacleBVH } from './bvh';
import {
  AvoidanceVehicleProxy,
  computeAvoidanceSteerAndSpeed,
  updateImpatienceAndReverse,
} from './drivingAvoidance';
import { isPointNearArmedNailMat } from './nailMatSystem';
import { getSurfaceHeight, TownRoadGraph, WorldConfig } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  AssailantActor,
  CivilianVehicle,
  NailMatActor,
  OfficerActor,
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

const DEFAULT_PEDESTRIAN_GOALS: AIGoalRuleDef[] = [
  { id: 'RAGDOLL_INCAPACITATED', enabled: true, priority: 100 },
  {
    id: 'EVADE_VEHICLE',
    enabled: true,
    priority: 90,
    params: { ttcHorizon: 1.85, detectRadius: 22, sprintSpeed: 6.4, jumpThresholdTtc: 0.95 },
  },
  {
    id: 'FLEE_THREAT',
    enabled: true,
    priority: 75,
    params: { fleeRadius: 34, fleeSpeed: 5.2 },
  },
  {
    id: 'AVOID_OBSTACLE',
    enabled: true,
    priority: 55,
    params: { crowdRadius: 1.65, lookahead: 2.4 },
  },
  {
    id: 'SIDEWALK_STROLL',
    enabled: true,
    priority: 20,
    params: { walkSpeed: 1.8 },
  },
];

export function spawnCivilianTraffic(
  hierarchy: SceneWorldHierarchy,
  world: WorldConfig,
  roadGraph: TownRoadGraph,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  onAssetIssue?: (issue: AssetIssue) => void,
  countScale = 1.0,
  map?: CustomMapAsset,
): CivilianVehicle[] {
  const civilianCars: CivilianVehicle[] = [];
  if (roadGraph.nodes.length === 0) return civilianCars;

  const baseTraffic = map?.trafficCount ?? world.trafficCount;
  const count = Math.max(0, Math.round(baseTraffic * countScale));
  const variants = world.civilianVariants;
  const colors = world.civilianColors.map((c) => parseInt(c.replace('#', ''), 16));
  const laneOffset = roadGraph.laneOffset;
  const surface = map ?? world;

  for (let i = 0; i < count; i++) {
    const variant = variants[i % variants.length] ?? 'sedan';
    const colorHex = colors[i % colors.length] ?? 0x94a3b8;
    const rig = createCivilianCar(variant, colorHex, assets, textures, onAssetIssue);
    const startNode = roadGraph.nodes[(i * 3) % roadGraph.nodes.length];
    const nextNodeId =
      startNode.neighbors.length > 0
        ? startNode.neighbors[i % startNode.neighbors.length]
        : startNode.id;
    const nextNode = roadGraph.getNodeById(nextNodeId) ?? startNode;

    const t = 0.25 + ((i * 19) % 50) / 100;
    const sampled = roadGraph.sampleDirectedEdge(startNode, nextNode, t);
    const ux = sampled.tx;
    const uz = sampled.tz;
    const rx = -uz * laneOffset;
    const rz = ux * laneOffset;

    const px = sampled.x + rx;
    const pz = sampled.z + rz;
    const pos = new THREE.Vector3(px, getSurfaceHeight(px, pz, surface), pz);
    const yaw = Math.atan2(ux, uz);
    const initSpeed = 7.5 + (i % 4) * 1.1;
    const dyn = createVehicleDynState();
    dyn.vx = ux * initSpeed;
    dyn.vz = uz * initSpeed;

    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    hierarchy.addEntity(rig.root);

    const reachable = roadGraph
      .getReachableNodeIds(startNode.id)
      .filter((id) => id !== startNode.id && id !== nextNode.id);
    const destNodeId =
      reachable.length > 0 ? reachable[(i * 7 + 3) % reachable.length] : nextNode.id;
    const plannedNodes =
      destNodeId !== nextNode.id ? roadGraph.findNodePath(nextNode.id, destNodeId) : [];
    const routeQueue = plannedNodes.slice(1).map((n) => n.id);

    civilianCars.push({
      id: `civ-${i}`,
      rig,
      pos,
      yaw,
      speed: initSpeed,
      dyn,
      maxSpeed: 8.5 + (i % 4) * 1.2,
      currentNodeId: startNode.id,
      nextNodeId: nextNode.id,
      prevNodeId: startNode.id,
      routeQueue,
      destinationNodeId: destNodeId,
      junctionPauseTimer: 0,
      junctionWaitNodeId: undefined,
      turnApex: null,
      lateralYield: 0,
      stunTimer: 0,
      impatience: 0,
      patienceRate: 0.14 + (i % 5) * 0.055,
      stuckTimer: 0,
      reverseTimer: 0,
      reverseSteerDir: i % 2 === 0 ? 1 : -1,
      stallCount: 0,
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
  map: CustomMapAsset,
  world: WorldConfig,
  staticBvh: StaticObstacleBVH,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  rng: () => number,
  onAssetIssue?: (issue: AssetIssue) => void,
  countScale = 1.0,
): PedestrianActor[] {
  const pedestrians: PedestrianActor[] = [];
  const basePeds = map.pedestrianCount ?? world.pedestrianCount;
  const count = Math.max(0, Math.round(basePeds * countScale));
  const shirtColors = world.pedestrianShirtColors.map((c) => parseInt(c.replace('#', ''), 16));
  const loops =
    map.pedLoops.length > 0
      ? map.pedLoops
      : [
          {
            cx: 0,
            cz: 0,
            halfW: Math.max(18, map.bounds.halfSize * 0.2),
            halfD: Math.max(18, map.bounds.halfSize * 0.2),
          },
        ];

  const pedPool =
    world.pedestrianModels && world.pedestrianModels.length > 0
      ? world.pedestrianModels
      : ['pedestrian_humanoid'];

  for (let i = 0; i < count; i++) {
    const loop = loops[i % loops.length];
    const cornerIdx = i % 4;
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;

    const corners = [
      [loop.cx - loop.halfW, loop.cz - loop.halfD],
      [loop.cx + loop.halfW, loop.cz - loop.halfD],
      [loop.cx + loop.halfW, loop.cz + loop.halfD],
      [loop.cx - loop.halfW, loop.cz + loop.halfD],
    ];
    const [cx, cz] = corners[cornerIdx];
    const shirtHex = shirtColors[i % shirtColors.length] ?? 0x475569;
    const pedModelKey = pedPool[i % pedPool.length];
    const rig = createHumanoid(
      'pedestrian',
      assets,
      textures,
      pedModelKey === 'pedestrian_humanoid' ? shirtHex : undefined,
      onAssetIssue,
      pedModelKey,
    );
    const pos = new THREE.Vector3(cx, getSurfaceHeight(cx, cz, map), cz);
    staticBvh.resolveCircle(pos, 0.45);
    pos.y = getSurfaceHeight(pos.x, pos.z, map);
    rig.root.position.copy(pos);
    hierarchy.addEntity(rig.root);

    pedestrians.push({
      id: `ped-${i + 1}`,
      rig,
      pos,
      yaw: 0,
      velX: 0,
      velZ: 0,
      jumpY: 0,
      jumpVelY: 0,
      activeGoal: 'SIDEWALK_STROLL',
      blockCx: loop.cx,
      blockCz: loop.cz,
      loopRadius: Math.min(loop.halfW, loop.halfD),
      loopRect: { ...loop },
      cornerIdx,
      dir,
      walkPhase: rng() * Math.PI * 2,
      panicTimer: 0,
      hp: 100,
      maxHp: 100,
      injured: false,
      dead: false,
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
  surfaceSource: CustomMapAsset | WorldConfig,
  vfx: SimVfxManager,
  weather: WeatherCondition,
  rng: () => number,
  dt: number,
): void {
  const grip = weather === WeatherCondition.Rain ? 4.4 : 6.8;
  const baseLaneOffset = roadGraph.laneOffset;

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
      car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z, surfaceSource);
      car.rig.root.position.copy(car.pos);
      car.rig.root.rotation.y = car.yaw;
      continue;
    }

    const currNode = roadGraph.getNodeById(car.currentNodeId);
    const nextNode = roadGraph.getNodeById(car.nextNodeId);
    if (!currNode || !nextNode) continue;

    const exitSample = roadGraph.sampleDirectedEdge(currNode, nextNode, 0.94);
    const ux = exitSample.tx;
    const uz = exitSample.tz;

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

    const endTargetX = nextNode.x - ux * 7.5 + rx;
    const endTargetZ = nextNode.z - uz * 7.5 + rz;
    let targetX = endTargetX;
    let targetZ = endTargetZ;

    if (car.turnApex) {
      targetX = car.turnApex.x;
      targetZ = car.turnApex.z;
    } else {
      const prog = roadGraph.findDirectedEdgeProgress(car.pos.x, car.pos.z, currNode, nextNode);
      if (prog.isCurved && prog.t < 0.85) {
        const ahead = roadGraph.sampleDirectedEdge(
          currNode,
          nextNode,
          Math.min(0.95, prog.t + 0.25),
        );
        targetX = ahead.x - ahead.tz * laneOff;
        targetZ = ahead.z + ahead.tx * laneOff;
      }
    }

    if (car.junctionPauseTimer > 0) {
      car.junctionPauseTimer = Math.max(0, car.junctionPauseTimer - dt);
    }

    const dx = targetX - car.pos.x;
    const dz = targetZ - car.pos.z;
    const dist = Math.hypot(dx, dz);
    if (!car.debugNextTarget) {
      car.debugNextTarget = new THREE.Vector3(targetX, car.pos.y, targetZ);
    } else {
      car.debugNextTarget.set(targetX, car.pos.y, targetZ);
    }

    const endDist = car.turnApex ? dist : Math.hypot(endTargetX - car.pos.x, endTargetZ - car.pos.z);
    const fwdX = Math.sin(car.yaw);
    const fwdZ = Math.cos(car.yaw);
    const passedTarget =
      (endTargetX - car.pos.x) * fwdX + (endTargetZ - car.pos.z) * fwdZ < -1.0 && endDist < 14;

    if (endDist < 4.2 || passedTarget) {
      if (car.turnApex) {
        car.turnApex = null;
      } else {
        let pick: number | undefined;
        while (car.routeQueue.length > 0 && pick === undefined) {
          const cand = car.routeQueue.shift()!;
          if (cand !== car.nextNodeId && nextNode.neighbors.includes(cand)) {
            pick = cand;
          }
        }
        if (pick === undefined) {
          const reachable = roadGraph
            .getReachableNodeIds(nextNode.id)
            .filter((id) => id !== nextNode.id && id !== car.currentNodeId);
          if (reachable.length > 0) {
            const destId = reachable[Math.floor(rng() * reachable.length)];
            car.destinationNodeId = destId;
            const path = roadGraph.findNodePath(nextNode.id, destId);
            if (path.length >= 2) {
              pick = path[1].id;
              car.routeQueue = path.slice(2).map((n) => n.id);
            }
          }
        }
        if (pick === undefined) {
          const candidates = nextNode.neighbors.filter((n) => n !== car.currentNodeId);
          pick =
            candidates.length > 0
              ? candidates[Math.floor(rng() * candidates.length)]
              : nextNode.neighbors[0] ?? car.currentNodeId;
        }

        const afterNode = roadGraph.getNodeById(pick) ?? nextNode;
        const nextEntry = roadGraph.sampleDirectedEdge(nextNode, afterNode, 0.06);
        const nrx = -nextEntry.tz * baseLaneOffset;
        const nrz = nextEntry.tx * baseLaneOffset;

        if (nextNode.nodeType !== 'join') {
          car.turnApex = new THREE.Vector3(
            nextNode.x + (rx + nrx) * 0.5,
            roadGraph.roadSurfaceY,
            nextNode.z + (rz + nrz) * 0.5,
          );
        }
        car.prevNodeId = car.currentNodeId;
        car.currentNodeId = car.nextNodeId;
        car.nextNodeId = pick;
        car.junctionWaitNodeId = undefined;
      }
    } else {
      const baseDesiredYaw = Math.atan2(dx, dz);
      const yawDiff = normalizeAngle(baseDesiredYaw - car.yaw);
      const turnPenalty = nextNode.nodeType === 'join' ? 0.92 : Math.abs(yawDiff) > 0.75 ? 0.52 : 1.0;
      const spikeAhead = isPointNearArmedNailMat(
        car.pos.x,
        car.pos.z,
        fwdX,
        fwdZ,
        nailMats,
      );

      let junctionHold = false;
      let junctionSlowFactor = 1.0;
      if (!car.turnApex && nextNode.nodeType !== 'join' && endDist < 12.5) {
        if (nextNode.priority === 'stop') {
          if (car.junctionWaitNodeId !== nextNode.id) {
            car.junctionWaitNodeId = nextNode.id;
            car.junctionPauseTimer = 0.65;
          }
          if (car.junctionPauseTimer > 0) {
            junctionHold = true;
          } else {
            for (const other of allVehicles) {
              if (other.id === car.id) continue;
              const dSq = (other.x - nextNode.x) ** 2 + (other.z - nextNode.z) ** 2;
              if (dSq < 12 * 12 && other.speed > 1.2) {
                junctionHold = true;
                break;
              }
            }
          }
        } else if (nextNode.priority === 'yield') {
          for (const other of allVehicles) {
            if (other.id === car.id) continue;
            const dSq = (other.x - nextNode.x) ** 2 + (other.z - nextNode.z) ** 2;
            if (dSq < 12 * 12 && other.speed > 1.2) {
              junctionSlowFactor = 0.25;
              break;
            }
          }
        }
      }

      const baseGoal =
        spikeAhead || junctionHold
          ? 0
          : sirenNear
          ? 1.5
          : car.maxSpeed * turnPenalty * junctionSlowFactor;

      const avoid = computeAvoidanceSteerAndSpeed({
        selfId: car.id,
        pos: car.pos,
        yaw: car.yaw,
        speed: Math.abs(car.speed),
        selfHalfW: 0.92,
        selfHalfL: 2.24,
        baseDesiredYaw,
        baseSpeed: baseGoal,
        prevSteerBias: 0,
        canOvertake: car.impatience >= 0.5 && !spikeAhead && !junctionHold,
        allVehicles,
        pedestrians,
        staticBvh,
        dt,
        recklessness: car.impatience * 0.42,
        impatience: car.impatience,
      });
      car.debugAvoidActive =
        avoid.wallBlocked || avoid.vehicleBlocked || Math.abs(avoid.nextSteerBias) > 0.05;

      const revState = {
        impatience: car.impatience,
        stuckTimer: car.stuckTimer,
        reverseTimer: car.reverseTimer,
        reverseSteerDir: car.reverseSteerDir,
        stallCount: car.stallCount,
      };
      const revStep = updateImpatienceAndReverse(revState, {
        baseGoalSpeed: spikeAhead || sirenNear || junctionHold ? 0 : baseGoal,
        actualSpeed: car.speed,
        avoid,
        patienceRate: car.patienceRate,
        reverseThresholdSec: 2.4 - car.patienceRate * 1.4,
        reverseDurationSec: 1.35,
        dt,
      });
      car.impatience = revState.impatience;
      car.stuckTimer = revState.stuckTimer;
      car.reverseTimer = revState.reverseTimer;
      car.reverseSteerDir = revState.reverseSteerDir;
      car.stallCount = revState.stallCount ?? 0;

      if (revStep.justFinishedReverse && dist < 18) {
        const alt = nextNode.neighbors.filter(
          (n) => n !== car.currentNodeId && n !== car.nextNodeId,
        );
        if (alt.length > 0) {
          car.turnApex = null;
          car.routeQueue = [];
          car.nextNodeId = alt[Math.floor(rng() * alt.length)];
        }
      }

      const yawState = { yaw: car.yaw, speed: car.speed };
      const signedSpeed = stepVehicleDynamics(
        car.pos,
        yawState,
        car.dyn,
        car.rig.bodyGroup,
        {
          targetSpeed: revStep.isReversing ? -3.6 : avoid.speedCap,
          desiredYaw: avoid.desiredYaw,
          maxAccel: 5.2,
          maxBrake: 11.2,
          maxSteerRate: 2.2,
          lateralGrip: grip,
          mass: 1.0,
          reverseTurnDir: revStep.isReversing ? car.reverseSteerDir : 0,
        },
        dt,
      );
      car.yaw = yawState.yaw;
      car.speed = signedSpeed;

      applyVehicleWheelVisuals(car.rig.wheels, undefined, car.speed, car.dyn.steerAngle, 0.33, dt);
    }

    car.pos.y = getSurfaceHeight(car.pos.x, car.pos.z, surfaceSource);
    car.rig.root.position.copy(car.pos);
    car.rig.root.rotation.y = car.yaw;
  }
}

export function updatePedestrians(
  pedestrians: PedestrianActor[],
  allVehicles: AvoidanceVehicleProxy[],
  officers: OfficerActor[],
  assailants: AssailantActor[],
  staticBvh: StaticObstacleBVH,
  surfaceSource: CustomMapAsset | WorldConfig,
  config: EngineConfigAsset | null,
  dt: number,
): void {
  const rules = [...(config?.aiGoals?.pedestrian ?? DEFAULT_PEDESTRIAN_GOALS)]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => b.priority - a.priority);

  for (let pIdx = 0; pIdx < pedestrians.length; pIdx++) {
    const ped = pedestrians[pIdx];
    if (ped.panicTimer > 0) ped.panicTimer = Math.max(0, ped.panicTimer - dt);

    // Step vertical jump / dive physics arc if airborne
    if (ped.jumpY > 0 || ped.jumpVelY > 0) {
      ped.jumpVelY -= 20.0 * dt;
      ped.jumpY += ped.jumpVelY * dt;
      if (ped.jumpY <= 0) {
        ped.jumpY = 0;
        ped.jumpVelY = 0;
      }
    }

    // Evaluate highest-priority active goal from asset-pack goals
    let chosenDirX = 0;
    let chosenDirZ = 0;
    let chosenSpeed = 0;
    let goalHandled = false;

    for (const rule of rules) {
      if (goalHandled) break;
      const params = rule.params ?? {};

      if (rule.id === 'RAGDOLL_INCAPACITATED') {
        if (ped.dead || ped.ragdoll.active) {
          ped.activeGoal = 'RAGDOLL_INCAPACITATED';
          stepRagdollPhysics(ped.ragdoll, ped.pos, ped.rig, staticBvh, surfaceSource, dt);
          if (!ped.dead && ped.ragdoll.active) {
            ped.ragdoll.recoverTimer -= dt;
            if (ped.ragdoll.recoverTimer <= 0) {
              ped.ragdoll.active = false;
              ped.jumpY = 0;
              ped.jumpVelY = 0;
              ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z, surfaceSource);
              ped.rig.root.rotation.set(0, ped.yaw, 0);
              ped.rig.leftArm.rotation.set(0, 0, 0);
              ped.rig.rightArm.rotation.set(0, 0, 0);
              ped.rig.leftLeg.rotation.set(0, 0, 0);
              ped.rig.rightLeg.rotation.set(0, 0, 0);
            }
          }
          goalHandled = true;
        }
        continue;
      }

      if (ped.dead || ped.ragdoll.active) continue;

      if (rule.id === 'EVADE_VEHICLE') {
        const detectRadius = params.detectRadius ?? 22;
        const ttcHorizon = params.ttcHorizon ?? 1.85;
        const jumpThresholdTtc = params.jumpThresholdTtc ?? 0.95;
        const sprintSpeed = (params.sprintSpeed ?? 6.4) * (ped.injured ? 0.65 : 1.0);

        let bestTtc = Infinity;
        let evadeX = 0;
        let evadeZ = 0;

        for (let v = 0; v < allVehicles.length; v++) {
          const veh = allVehicles[v];
          if (veh.speed < 1.35) continue;
          const relX = ped.pos.x - veh.x;
          const relZ = ped.pos.z - veh.z;
          if (relX * relX + relZ * relZ > detectRadius * detectRadius) continue;

          const fwdX = Math.sin(veh.yaw);
          const fwdZ = Math.cos(veh.yaw);
          const along = relX * fwdX + relZ * fwdZ;
          if (along < -0.6) continue;

          const ttc = along / Math.max(1.0, veh.speed);
          if (ttc > ttcHorizon) continue;

          const rightX = Math.cos(veh.yaw);
          const rightZ = -Math.sin(veh.yaw);
          const sideDist = relX * rightX + relZ * rightZ;
          const clearance = veh.halfW + 1.5;
          if (Math.abs(sideDist) > clearance) continue;

          if (ttc < bestTtc) {
            bestTtc = ttc;
            const escapeSign = sideDist >= 0 ? 1 : -1;
            evadeX = rightX * escapeSign * 0.92 + fwdX * 0.35;
            evadeZ = rightZ * escapeSign * 0.92 + fwdZ * 0.35;
          }
        }

        if (bestTtc < Infinity) {
          const len = Math.hypot(evadeX, evadeZ) || 1;
          chosenDirX = evadeX / len;
          chosenDirZ = evadeZ / len;
          chosenSpeed = sprintSpeed;
          ped.panicTimer = Math.max(ped.panicTimer, 2.2);
          if (bestTtc < jumpThresholdTtc && ped.jumpY <= 0.02) {
            ped.jumpVelY = 4.6;
          }
          ped.activeGoal = 'EVADE_VEHICLE';
          goalHandled = true;
        }
        continue;
      }

      if (rule.id === 'FLEE_THREAT') {
        const fleeRadius = params.fleeRadius ?? 34;
        const fleeSpeed = (params.fleeSpeed ?? 5.2) * (ped.injured ? 0.58 : 1.0);
        let nearestThreat: AssailantActor | null = null;
        let minSq = fleeRadius * fleeRadius;

        for (let a = 0; a < assailants.length; a++) {
          const as = assailants[a];
          if (!as.alive || as.inVehicle) continue;
          const dSq = as.pos.distanceToSquared(ped.pos);
          if (dSq < minSq) {
            minSq = dSq;
            nearestThreat = as;
          }
        }

        if (nearestThreat) {
          const dx = ped.pos.x - nearestThreat.pos.x;
          const dz = ped.pos.z - nearestThreat.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          chosenDirX = dx / d;
          chosenDirZ = dz / d;
          chosenSpeed = fleeSpeed;
          ped.activeGoal = 'FLEE_THREAT';
          goalHandled = true;
        } else if (ped.panicTimer > 0) {
          const hw = ped.loopRect ? ped.loopRect.halfW : ped.loopRadius;
          const hd = ped.loopRect ? ped.loopRect.halfD : ped.loopRadius;
          const cx = ped.loopRect ? ped.loopRect.cx : ped.blockCx;
          const cz = ped.loopRect ? ped.loopRect.cz : ped.blockCz;
          const corners = [
            [cx - hw, cz - hd],
            [cx + hw, cz - hd],
            [cx + hw, cz + hd],
            [cx - hw, cz + hd],
          ];
          const [tx, tz] = corners[ped.cornerIdx];
          const dx = tx - ped.pos.x;
          const dz = tz - ped.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.9) {
            ped.cornerIdx = (ped.cornerIdx + (ped.dir === 1 ? 1 : 3)) % 4;
          } else {
            chosenDirX = dx / dist;
            chosenDirZ = dz / dist;
          }
          chosenSpeed = fleeSpeed * 0.92;
          ped.activeGoal = 'FLEE_THREAT';
          goalHandled = true;
        }
        continue;
      }

      if (rule.id === 'SIDEWALK_STROLL' || rule.id === 'AVOID_OBSTACLE') {
        const walkSpeed = (params.walkSpeed ?? 1.8) * (ped.injured ? 0.52 : 1.0);
        const hw = ped.loopRect ? ped.loopRect.halfW : ped.loopRadius;
        const hd = ped.loopRect ? ped.loopRect.halfD : ped.loopRadius;
        const cx = ped.loopRect ? ped.loopRect.cx : ped.blockCx;
        const cz = ped.loopRect ? ped.loopRect.cz : ped.blockCz;

        const corners = [
          [cx - hw, cz - hd],
          [cx + hw, cz - hd],
          [cx + hw, cz + hd],
          [cx - hw, cz + hd],
        ];
        const [tx, tz] = corners[ped.cornerIdx];
        const dx = tx - ped.pos.x;
        const dz = tz - ped.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.85) {
          ped.cornerIdx = (ped.cornerIdx + (ped.dir === 1 ? 1 : 3)) % 4;
        } else {
          chosenDirX = dx / dist;
          chosenDirZ = dz / dist;
        }
        chosenSpeed = walkSpeed;
        ped.activeGoal = 'SIDEWALK_STROLL';
        goalHandled = true;
      }
    }

    if (ped.dead || ped.ragdoll.active) continue;

    // Apply AVOID_OBSTACLE separation + static wall steering if goal rule enabled
    const avoidRule = rules.find((r) => r.id === 'AVOID_OBSTACLE');
    if (avoidRule && chosenSpeed > 0.05) {
      const crowdR = avoidRule.params?.crowdRadius ?? 1.65;
      const crowdRSq = crowdR * crowdR;
      const lookahead = avoidRule.params?.lookahead ?? 2.4;
      let repelX = 0;
      let repelZ = 0;

      for (let j = 0; j < pedestrians.length; j++) {
        if (j === pIdx) continue;
        const other = pedestrians[j];
        if (other.dead) continue;
        const dx = ped.pos.x - other.pos.x;
        const dz = ped.pos.z - other.pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0.001 && dSq < crowdRSq) {
          const d = Math.sqrt(dSq);
          const w = (crowdR - d) / crowdR;
          repelX += (dx / d) * w * 1.45;
          repelZ += (dz / d) * w * 1.45;
        }
      }
      for (let o = 0; o < officers.length; o++) {
        const off = officers[o];
        if (off.boardingState !== 'dismounted' || off.hp <= 0) continue;
        const dx = ped.pos.x - off.pos.x;
        const dz = ped.pos.z - off.pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0.001 && dSq < crowdRSq * 1.2) {
          const d = Math.sqrt(dSq);
          repelX += (dx / d) * 1.6;
          repelZ += (dz / d) * 1.6;
        }
      }
      for (let a = 0; a < assailants.length; a++) {
        const as = assailants[a];
        if (!as.alive || as.inVehicle) continue;
        const dx = ped.pos.x - as.pos.x;
        const dz = ped.pos.z - as.pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0.001 && dSq < crowdRSq * 1.2) {
          const d = Math.sqrt(dSq);
          repelX += (dx / d) * 1.6;
          repelZ += (dz / d) * 1.6;
        }
      }

      if (chosenDirX !== 0 || chosenDirZ !== 0) {
        const ray = staticBvh.raycastSegment(
          ped.pos.x,
          ped.pos.z,
          ped.pos.x + chosenDirX * lookahead,
          ped.pos.z + chosenDirZ * lookahead,
        );
        if (!ray.clear) {
          // Steer tangentially along wall normal + push slightly out
          const tangX = -ray.normalZ;
          const tangZ = ray.normalX;
          const sign = tangX * chosenDirX + tangZ * chosenDirZ >= 0 ? 1 : -1;
          repelX += tangX * sign * 1.5 + ray.normalX * 0.7;
          repelZ += tangZ * sign * 1.5 + ray.normalZ * 0.7;
          if (ped.activeGoal === 'SIDEWALK_STROLL') {
            ped.activeGoal = 'AVOID_OBSTACLE';
          }
        }
      }

      if (Math.abs(repelX) > 0.1 || Math.abs(repelZ) > 0.1) {
        chosenDirX += repelX;
        chosenDirZ += repelZ;
        const len = Math.hypot(chosenDirX, chosenDirZ) || 1;
        chosenDirX /= len;
        chosenDirZ /= len;
      }
    }

    if (chosenSpeed > 0.05 && (chosenDirX !== 0 || chosenDirZ !== 0)) {
      ped.velX = chosenDirX * chosenSpeed;
      ped.velZ = chosenDirZ * chosenSpeed;
      ped.yaw = Math.atan2(chosenDirX, chosenDirZ);
      ped.pos.x += ped.velX * dt;
      ped.pos.z += ped.velZ * dt;
      staticBvh.resolveCircle(ped.pos, 0.42);
      ped.walkPhase += dt * (chosenSpeed * 4.2);

      if (ped.jumpY > 0.05) {
        ped.rig.leftLeg.rotation.x = -0.65;
        ped.rig.rightLeg.rotation.x = 0.55;
        ped.rig.leftArm.rotation.x = -1.2;
        ped.rig.rightArm.rotation.x = -1.2;
      } else {
        const swing = Math.sin(ped.walkPhase) * (ped.injured ? 0.3 : 0.48);
        ped.rig.leftLeg.rotation.x = swing;
        ped.rig.rightLeg.rotation.x = -swing;
        ped.rig.leftArm.rotation.x = -swing * 0.75;
        ped.rig.rightArm.rotation.x = swing * 0.75;
      }
    } else {
      ped.velX = 0;
      ped.velZ = 0;
    }

    ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z, surfaceSource) + ped.jumpY;
    ped.rig.root.position.copy(ped.pos);
    ped.rig.root.rotation.y = ped.yaw;
  }
}
