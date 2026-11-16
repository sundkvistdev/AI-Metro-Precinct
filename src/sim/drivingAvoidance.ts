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
}

/**
 * Computes pure-pursuit path lookahead + multi-ray static obstacle feelers +
 * forward vehicle/pedestrian braking & safe lane-shift overtaking.
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

  for (let i = waypointIndex; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (accum + segLen >= lookaheadDist) {
      const t = THREE.MathUtils.clamp((lookaheadDist - accum) / Math.max(0.01, segLen), 0, 1);
      return {
        targetX: a.x + (b.x - a.x) * t,
        targetZ: a.z + (b.z - a.z) * t,
      };
    }
    accum += segLen;
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
  } = params;

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let speedCap = baseSpeed;
  let targetSteerBias = 0;

  // 1. Static building / obstacle multi-ray feelers (center, left, right)
  const rayLen = 6.2 + Math.min(7.5, speed * 0.45);
  const castRay = (angleOffset: number, len: number) => {
    const a = yaw + angleOffset;
    const tx = pos.x + Math.sin(a) * len;
    const tz = pos.z + Math.cos(a) * len;
    return staticBvh.raycastSegment(pos.x, pos.z, tx, tz);
  };

  const cRay = castRay(0, rayLen);
  const lRay = castRay(0.42, rayLen * 0.85);
  const rRay = castRay(-0.42, rayLen * 0.85);

  if (!cRay.clear) {
    const wallDist = cRay.t * rayLen;
    if (wallDist < 4.5) {
      speedCap = Math.min(speedCap, 2.5);
    } else {
      speedCap = Math.min(speedCap, Math.max(4.5, wallDist * 0.85));
    }
    const leftClear = lRay.clear ? 1.0 : lRay.t;
    const rightClear = rRay.clear ? 1.0 : rRay.t;
    targetSteerBias += leftClear >= rightClear ? 0.58 : -0.58;
  } else if (!lRay.clear && lRay.t < 0.72) {
    targetSteerBias -= (1 - lRay.t) * 0.48;
  } else if (!rRay.clear && rRay.t < 0.72) {
    targetSteerBias += (1 - rRay.t) * 0.48;
  }

  // 2. Forward vehicle corridor check + clean physical lane overtaking
  const scanRange = 8.5 + Math.min(13, speed * 0.65);
  let closestVehicle: AvoidanceVehicleProxy | null = null;
  let closestGap = Infinity;

  for (const other of allVehicles) {
    if (other.id === selfId) continue;
    const dx = other.x - pos.x;
    const dz = other.z - pos.z;
    const fwdDist = dx * fwdX + dz * fwdZ;
    if (fwdDist < 0.5 || fwdDist > scanRange) continue;

    const latDist = Math.abs(dx * rightX + dz * rightZ);
    const corridorHalf = selfHalfW + other.halfW + 0.52;
    if (latDist < corridorHalf) {
      const gap = fwdDist - (selfHalfL + other.halfL);
      if (gap < closestGap) {
        closestGap = gap;
        closestVehicle = other;
      }
    }
  }

  if (closestVehicle) {
    const otherSameDir =
      Math.sin(closestVehicle.yaw) * fwdX + Math.cos(closestVehicle.yaw) * fwdZ > 0.35;

    if (canOvertake && closestGap > 1.8 && closestGap < 15.0) {
      // Check whether +3.2m (left) or -3.2m (right) adjacent lane is clear of cars & buildings
      const isSideClear = (sideSign: number): boolean => {
        const probeX = pos.x + fwdX * 6.5 + rightX * (sideSign * 3.1);
        const probeZ = pos.z + fwdZ * 6.5 + rightZ * (sideSign * 3.1);
        if (!staticBvh.raycastSegment(pos.x, pos.z, probeX, probeZ).clear) {
          return false;
        }
        for (const v of allVehicles) {
          if (v.id === selfId || v.id === closestVehicle!.id) continue;
          const vdx = v.x - pos.x;
          const vdz = v.z - pos.z;
          const vf = vdx * fwdX + vdz * fwdZ;
          const vl = vdx * rightX + vdz * rightZ;
          if (vf > -2 && vf < 16 && Math.abs(vl - sideSign * 3.1) < 2.2) {
            return false;
          }
        }
        return true;
      };

      const canLeft = isSideClear(1);
      const canRight = isSideClear(-1);
      if (canLeft || canRight) {
        const dir = canLeft ? 1 : -1;
        targetSteerBias += dir * 0.42;
        if (closestGap < 3.6) {
          speedCap = Math.min(speedCap, Math.max(4.8, closestVehicle.speed + 2.5));
        }
      } else {
        const safeLead = otherSameDir ? Math.max(0, closestVehicle.speed * 0.9) : 0;
        speedCap = Math.min(speedCap, closestGap < 2.2 ? 0 : Math.max(safeLead, closestGap * 1.15));
      }
    } else {
      const safeLead = otherSameDir ? Math.max(0, closestVehicle.speed * 0.88) : 0;
      if (closestGap < 2.1) {
        speedCap = 0;
      } else if (closestGap < 7.5) {
        speedCap = Math.min(speedCap, Math.max(safeLead, (closestGap - 1.6) * 1.25));
      } else {
        speedCap = Math.min(speedCap, Math.max(safeLead + 2.5, closestGap * 0.9));
      }
    }
  }

  // 3. Pedestrian corridor yield (prevent plowing sidewalks/crosswalks needlessly)
  for (const ped of pedestrians) {
    if (ped.ragdoll.active) continue;
    const dx = ped.pos.x - pos.x;
    const dz = ped.pos.z - pos.z;
    const fwdDist = dx * fwdX + dz * fwdZ;
    if (fwdDist < 1.0 || fwdDist > 10.5) continue;
    const lat = dx * rightX + dz * rightZ;
    if (Math.abs(lat) < selfHalfW + 0.72) {
      if (fwdDist < 4.5) {
        speedCap = Math.min(speedCap, canOvertake ? 4.5 : 0);
      } else {
        targetSteerBias += (lat >= 0 ? -1 : 1) * 0.25;
      }
      break;
    }
  }

  const nextSteerBias = THREE.MathUtils.damp(prevSteerBias, targetSteerBias, 6.5, dt);
  const desiredYaw = normalizeAngle(baseDesiredYaw + nextSteerBias);

  return {
    desiredYaw,
    speedCap: Math.max(0, speedCap),
    nextSteerBias,
  };
}
