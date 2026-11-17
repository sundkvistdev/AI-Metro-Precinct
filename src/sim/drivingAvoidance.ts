import * as THREE from 'three';
import { StaticObstacleBVH } from './bvh';
import { PedestrianActor } from './simActors';
import { normalizeAngle } from './vehiclePhysics';

export interface AvoidanceVehicleProxy {
  id: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  halfW: number;
  halfL: number;
}

export interface AvoidanceResult {
  desiredYaw: number;
  speedCap: number;
  nextSteerBias: number;
  wallBlocked: boolean;
  vehicleBlocked: boolean;
  rearClear: boolean;
  preferredTurnDir: 1 | -1;
}

/**
 * Computes pure-pursuit path lookahead without cutting across sharp building corners.
 */
export function computePurePursuitLookahead(
  pos: THREE.Vector3,
  waypoints: THREE.Vector3[],
  waypointIndex: number,
  lookaheadDist: number,
): { targetX: number; targetZ: number } {
  const start = waypoints[waypointIndex];
  if (!start) return { targetX: pos.x, targetZ: pos.z };

  let accum = Math.hypot(start.x - pos.x, start.z - pos.z);
  if (accum >= lookaheadDist || waypointIndex >= waypoints.length - 1) {
    return { targetX: start.x, targetZ: start.z };
  }

  let prevDirX = start.x - pos.x;
  let prevDirZ = start.z - pos.z;
  const prevLen = Math.hypot(prevDirX, prevDirZ);
  if (prevLen > 0.01) {
    prevDirX /= prevLen;
    prevDirZ /= prevLen;
  }

  for (let i = waypointIndex; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const segDx = b.x - a.x;
    const segDz = b.z - a.z;
    const segLen = Math.hypot(segDx, segDz);

    // Do not look past a sharp bend before reaching the turn waypoint
    if (segLen > 0.5 && prevLen > 0.5) {
      const dot = (segDx / segLen) * prevDirX + (segDz / segLen) * prevDirZ;
      if (dot < 0.72) {
        return { targetX: a.x, targetZ: a.z };
      }
    }

    if (accum + segLen >= lookaheadDist) {
      const t = THREE.MathUtils.clamp((lookaheadDist - accum) / Math.max(0.01, segLen), 0, 1);
      return {
        targetX: a.x + segDx * t,
        targetZ: a.z + segDz * t,
      };
    }

    accum += segLen;
    if (segLen > 0.01) {
      prevDirX = segDx / segLen;
      prevDirZ = segDz / segLen;
    }
  }

  const last = waypoints[waypoints.length - 1];
  return { targetX: last.x, targetZ: last.z };
}

export function computeAvoidanceSteerAndSpeed(params: {
  selfId: string;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  selfHalfW: number;
  selfHalfL: number;
  baseDesiredYaw: number;
  baseSpeed: number;
  prevSteerBias: number;
  canOvertake: boolean;
  allVehicles: AvoidanceVehicleProxy[];
  pedestrians: PedestrianActor[];
  staticBvh: StaticObstacleBVH;
  dt: number;
  recklessness?: number;
  impatience?: number;
}): AvoidanceResult {
  const {
    selfId,
    pos,
    yaw,
    speed,
    selfHalfW,
    selfHalfL,
    baseDesiredYaw,
    baseSpeed,
    prevSteerBias,
    canOvertake,
    allVehicles,
    pedestrians,
    staticBvh,
    dt,
    recklessness = 0,
    impatience = 0,
  } = params;

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let speedCap = baseSpeed;
  let targetSteerBias = 0;
  let wallBlocked = false;
  let vehicleBlocked = false;

  // 1. Bumper-width static building / obstacle feelers + wide corner whiskers
  const rayLen = 5.4 + selfHalfL + Math.min(7.5, speed * 0.44);
  const castFromOffset = (latFrac: number, angleOffset: number, len: number) => {
    const ox = pos.x + rightX * (latFrac * selfHalfW * 0.92) + fwdX * (selfHalfL * 0.55);
    const oz = pos.z + rightZ * (latFrac * selfHalfW * 0.92) + fwdZ * (selfHalfL * 0.55);
    const a = yaw + angleOffset;
    const tx = ox + Math.sin(a) * len;
    const tz = oz + Math.cos(a) * len;
    return staticBvh.raycastSegment(ox, oz, tx, tz);
  };

  const cRay = castFromOffset(0, 0, rayLen);
  const lbRay = castFromOffset(1, 0.08, rayLen * 0.9);
  const rbRay = castFromOffset(-1, -0.08, rayLen * 0.9);
  const lWideRay = castFromOffset(0.7, 0.54, rayLen * 0.72);
  const rWideRay = castFromOffset(-0.7, -0.54, rayLen * 0.72);
  const rearRay = staticBvh.raycastSegment(
    pos.x,
    pos.z,
    pos.x - fwdX * (selfHalfL + 3.4),
    pos.z - fwdZ * (selfHalfL + 3.4),
  );
  const rearClear = rearRay.clear;

  const minFrontT = Math.min(
    cRay.clear ? 1 : cRay.t,
    lbRay.clear ? 1 : lbRay.t,
    rbRay.clear ? 1 : rbRay.t,
  );
  const leftClear = Math.min(lbRay.clear ? 1 : lbRay.t, lWideRay.clear ? 1 : lWideRay.t);
  const rightClear = Math.min(rbRay.clear ? 1 : rbRay.t, rWideRay.clear ? 1 : rWideRay.t);
  const preferredTurnDir: 1 | -1 = leftClear >= rightClear ? 1 : -1;

  if (minFrontT < 1) {
    const wallDist = minFrontT * rayLen;
    if (wallDist < 2.2) {
      speedCap = 0;
      wallBlocked = true;
      targetSteerBias += preferredTurnDir * 0.95;
    } else if (wallDist < 4.8) {
      speedCap = Math.min(speedCap, Math.max(0.8, (wallDist - 1.8) * 1.6));
      wallBlocked = wallDist < 3.0;
      targetSteerBias += preferredTurnDir * 0.78;
    } else {
      speedCap = Math.min(speedCap, Math.max(4.0, wallDist * 0.92));
      targetSteerBias += preferredTurnDir * (1 - minFrontT) * 0.56;
    }
  } else {
    if (!lWideRay.clear && lWideRay.t < 0.72) {
      targetSteerBias -= (1 - lWideRay.t) * 0.52;
    }
    if (!rWideRay.clear && rWideRay.t < 0.72) {
      targetSteerBias += (1 - rWideRay.t) * 0.52;
    }
  }

  // 2. Forward vehicle corridor check + overtaking / impatience squeeze
  const scanRange = 8.5 + Math.min(13, speed * 0.65);
  let closestVehicle: AvoidanceVehicleProxy | null = null;
  let closestGap = Infinity;

  for (const other of allVehicles) {
    if (other.id === selfId) continue;
    const dx = other.x - pos.x;
    const dz = other.z - pos.z;
    const fwdDist = dx * fwdX + dz * fwdZ;
    if (fwdDist < 0.4 || fwdDist > scanRange) continue;

    const latDist = Math.abs(dx * rightX + dz * rightZ);
    const corridorTightness = THREE.MathUtils.lerp(0.52, 0.24, Math.max(recklessness, impatience * 0.6));
    const corridorHalf = selfHalfW + other.halfW + corridorTightness;
    if (latDist < corridorHalf) {
      const gap = fwdDist - (selfHalfL + other.halfL);
      if (gap < closestGap) {
        closestGap = gap;
        closestVehicle = other;
      }
    }
  }

  const effectiveOvertake = canOvertake || impatience >= 0.48;
  const hardStopGap = THREE.MathUtils.lerp(2.15, 1.15, Math.max(recklessness * 0.85, impatience * 0.55));

  if (closestVehicle) {
    const otherSameDir =
      Math.sin(closestVehicle.yaw) * fwdX + Math.cos(closestVehicle.yaw) * fwdZ > 0.35;

    if (effectiveOvertake && closestGap > 0.9 && closestGap < 15.5) {
      const isSideClear = (sideSign: number): boolean => {
        const shift = 2.85 + selfHalfW * 0.4;
        const probeX = pos.x + fwdX * 6.5 + rightX * (sideSign * shift);
        const probeZ = pos.z + fwdZ * 6.5 + rightZ * (sideSign * shift);
        if (!staticBvh.raycastSegment(pos.x, pos.z, probeX, probeZ).clear) {
          return false;
        }
        for (const v of allVehicles) {
          if (v.id === selfId || v.id === closestVehicle!.id) continue;
          const vdx = v.x - pos.x;
          const vdz = v.z - pos.z;
          const vf = vdx * fwdX + vdz * fwdZ;
          const vl = vdx * rightX + vdz * rightZ;
          if (vf > -2 && vf < 15 && Math.abs(vl - sideSign * shift) < 2.05) {
            return false;
          }
        }
        return true;
      };

      const canLeft = isSideClear(1);
      const canRight = isSideClear(-1);
      if (canLeft || canRight) {
        const dir = canLeft ? 1 : -1;
        targetSteerBias += dir * (0.44 + recklessness * 0.14);
        if (closestGap < hardStopGap + 1.4) {
          speedCap = Math.min(speedCap, Math.max(4.5, closestVehicle.speed + 2.8));
        }
      } else {
        const safeLead = otherSameDir ? Math.max(0, closestVehicle.speed * 0.9) : 0;
        if (closestGap < hardStopGap) {
          speedCap = 0;
          vehicleBlocked = true;
        } else {
          speedCap = Math.min(speedCap, Math.max(safeLead, closestGap * 1.2));
        }
      }
    } else {
      const safeLead = otherSameDir ? Math.max(0, closestVehicle.speed * 0.88) : 0;
      if (closestGap < hardStopGap) {
        speedCap = 0;
        vehicleBlocked = true;
      } else if (closestGap < 7.5) {
        speedCap = Math.min(
          speedCap,
          Math.max(safeLead, (closestGap - hardStopGap * 0.75) * 1.3),
        );
      } else {
        speedCap = Math.min(speedCap, Math.max(safeLead + 2.5, closestGap * 0.9));
      }
    }
  }

  // 3. Pedestrian corridor yield (high urgency / reckless responders barely slow down)
  if (recklessness < 0.82) {
    for (const ped of pedestrians) {
      if (ped.ragdoll.active) continue;
      const dx = ped.pos.x - pos.x;
      const dz = ped.pos.z - pos.z;
      const fwdDist = dx * fwdX + dz * fwdZ;
      if (fwdDist < 1.0 || fwdDist > 10.0) continue;
      const lat = dx * rightX + dz * rightZ;
      if (Math.abs(lat) < selfHalfW + 0.65) {
        if (fwdDist < 4.5) {
          const pedCap =
            recklessness > 0.45
              ? THREE.MathUtils.lerp(2.5, 8.5, (recklessness - 0.45) / 0.37)
              : canOvertake
              ? 3.8
              : 0;
          speedCap = Math.min(speedCap, pedCap);
          if (pedCap <= 0.1) vehicleBlocked = true;
        } else {
          targetSteerBias += (lat >= 0 ? -1 : 1) * 0.28;
        }
        break;
      }
    }
  }

  const nextSteerBias = THREE.MathUtils.damp(prevSteerBias, targetSteerBias, 7.2, dt);
  const desiredYaw = normalizeAngle(
    wallBlocked ? yaw + targetSteerBias : baseDesiredYaw + nextSteerBias,
  );

  return {
    desiredYaw,
    speedCap: Math.max(0, speedCap),
    nextSteerBias,
    wallBlocked,
    vehicleBlocked,
    rearClear,
    preferredTurnDir,
  };
}

export interface ImpatienceReverseState {
  impatience: number;
  stuckTimer: number;
  reverseTimer: number;
  reverseSteerDir: 1 | -1;
}

/**
 * Tracks driver impatience and triggers a clean reverse-and-turn recovery
 * whenever a vehicle is boxed in by a wall or deadlocked in a jam.
 */
export function updateImpatienceAndReverse(
  state: ImpatienceReverseState,
  params: {
    baseGoalSpeed: number;
    actualSpeed: number;
    avoid: AvoidanceResult;
    patienceRate: number;
    reverseThresholdSec: number;
    reverseDurationSec: number;
    dt: number;
  },
): { isReversing: boolean; justFinishedReverse: boolean } {
  const {
    baseGoalSpeed,
    actualSpeed,
    avoid,
    patienceRate,
    reverseThresholdSec,
    reverseDurationSec,
    dt,
  } = params;

  if (state.reverseTimer > 0) {
    state.reverseTimer -= dt;
    if (state.reverseTimer <= 0) {
      state.reverseTimer = 0;
      state.stuckTimer = 0;
      state.impatience = Math.max(0.25, state.impatience - 0.45);
      return { isReversing: false, justFinishedReverse: true };
    }
    return { isReversing: true, justFinishedReverse: false };
  }

  const wantsToMove = baseGoalSpeed > 1.2;
  const stalled = actualSpeed < 1.15;

  if (wantsToMove && stalled) {
    const rateBoost = avoid.wallBlocked ? 1.85 : avoid.vehicleBlocked ? 1.15 : 1.0;
    state.stuckTimer += dt * (avoid.wallBlocked ? 1.6 : 1.0);
    state.impatience = Math.min(1, state.impatience + patienceRate * rateBoost * dt);

    const shouldReverse =
      avoid.rearClear &&
      (state.stuckTimer >= reverseThresholdSec ||
        (avoid.wallBlocked && state.stuckTimer >= reverseThresholdSec * 0.48));

    if (shouldReverse) {
      state.reverseTimer = reverseDurationSec;
      state.reverseSteerDir = avoid.preferredTurnDir;
      state.stuckTimer = 0;
      return { isReversing: true, justFinishedReverse: false };
    }
  } else if (actualSpeed > 3.2) {
    state.stuckTimer = Math.max(0, state.stuckTimer - dt * 1.8);
    state.impatience = Math.max(0, state.impatience - dt * 0.24);
  } else {
    state.stuckTimer = Math.max(0, state.stuckTimer - dt * 0.5);
  }

  return { isReversing: false, justFinishedReverse: false };
}
