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

const STEER_CANDIDATE_OFFSETS = [0, 0.14, -0.14, 0.3, -0.3, 0.48, -0.48, 0.68, -0.68];
const PREDICT_TIMES = [0.35, 0.72, 1.1];

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

/**
 * Goal-based predictive vehicle + obstacle collision avoidance with multi-arc scoring.
 */
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
  targetVehicleId?: string;
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
    targetVehicleId,
  } = params;

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let speedCap = baseSpeed;
  let wallBlocked = false;
  let vehicleBlocked = false;

  // 1. Volumetric bumper-width forward corridor + side feelers + rear left/right clearance
  const rayLen = 7.2 + selfHalfL + Math.min(10.5, speed * 0.56);
  const castFromOffset = (latFrac: number, angleOffset: number, len: number) => {
    const ox = pos.x + rightX * (latFrac * selfHalfW * 0.94) + fwdX * (selfHalfL * 0.55);
    const oz = pos.z + rightZ * (latFrac * selfHalfW * 0.94) + fwdZ * (selfHalfL * 0.55);
    const a = yaw + angleOffset;
    const tx = ox + Math.sin(a) * len;
    const tz = oz + Math.cos(a) * len;
    return staticBvh.raycastSegment(ox, oz, tx, tz);
  };

  const frontCorridor = staticBvh.sweepCorridor(
    pos.x + fwdX * (selfHalfL * 0.25),
    pos.z + fwdZ * (selfHalfL * 0.25),
    fwdX,
    fwdZ,
    rayLen,
    selfHalfW + 0.26,
  );
  const lbRay = castFromOffset(1, 0.14, rayLen * 0.85);
  const rbRay = castFromOffset(-1, -0.14, rayLen * 0.85);
  const lWideRay = castFromOffset(0.75, 0.58, rayLen * 0.72);
  const rWideRay = castFromOffset(-0.75, -0.58, rayLen * 0.72);

  const rearLen = selfHalfL + 3.8;
  const rearCenterRay = staticBvh.raycastSegment(
    pos.x,
    pos.z,
    pos.x - fwdX * rearLen,
    pos.z - fwdZ * rearLen,
  );
  const rearLeftRay = staticBvh.raycastSegment(
    pos.x,
    pos.z,
    pos.x - Math.sin(yaw + 0.45) * rearLen,
    pos.z - Math.cos(yaw + 0.45) * rearLen,
  );
  const rearRightRay = staticBvh.raycastSegment(
    pos.x,
    pos.z,
    pos.x - Math.sin(yaw - 0.45) * rearLen,
    pos.z - Math.cos(yaw - 0.45) * rearLen,
  );
  const rearClear = rearCenterRay.clear || rearLeftRay.clear || rearRightRay.clear;

  const minFrontT = Math.min(
    frontCorridor.clear ? 1 : frontCorridor.t,
    lbRay.clear ? 1 : lbRay.t,
    rbRay.clear ? 1 : rbRay.t,
  );
  const leftClear = Math.min(lbRay.clear ? 1 : lbRay.t, lWideRay.clear ? 1 : lWideRay.t);
  const rightClear = Math.min(rbRay.clear ? 1 : rbRay.t, rWideRay.clear ? 1 : rWideRay.t);
  const preferredTurnDir: 1 | -1 =
    !frontCorridor.clear && frontCorridor.kind === 'prop' && Math.abs(frontCorridor.hitLat) > 0.12
      ? frontCorridor.hitLat >= 0
        ? -1
        : 1
      : rearLeftRay.clear && !rearRightRay.clear
      ? -1
      : rearRightRay.clear && !rearLeftRay.clear
      ? 1
      : leftClear >= rightClear
      ? 1
      : -1;

  if (minFrontT < 1) {
    const wallDist = minFrontT * rayLen;
    if (wallDist < 2.35) {
      speedCap = 0;
      wallBlocked = true;
    } else if (wallDist < 5.4) {
      speedCap = Math.min(speedCap, Math.max(1.1, (wallDist - 1.85) * 1.7));
      wallBlocked = wallDist < 3.25;
    } else if (wallDist < 9.5) {
      speedCap = Math.min(speedCap, Math.max(4.6, wallDist * 1.05));
    }
  }

  // 2. Gather nearby vehicles for both immediate corridor & predictive TTC scan
  const relevantVehicles: AvoidanceVehicleProxy[] = [];
  const nearSearchSq = (26 + speed * 0.9) ** 2;
  for (const other of allVehicles) {
    if (other.id === selfId) continue;
    if (targetVehicleId && other.id === targetVehicleId && recklessness >= 0.7) {
      // Aggressive interceptor intentionally closes gap on pursued target
      continue;
    }
    const dx = other.x - pos.x;
    const dz = other.z - pos.z;
    if (dx * dx + dz * dz <= nearSearchSq) {
      relevantVehicles.push(other);
    }
  }

  // 3. Evaluate multi-candidate steering arcs relative to baseDesiredYaw
  const goalErr = normalizeAngle(baseDesiredYaw - yaw);
  const testSpeed = Math.max(5.5, Math.min(baseSpeed, speed + 4.5));
  const hardStopGap = THREE.MathUtils.lerp(2.1, 1.15, Math.max(recklessness * 0.85, impatience * 0.55));
  const probeArcLen = 6.2 + selfHalfL + Math.min(8.5, testSpeed * 0.48);

  let bestOffset = 0;
  let bestScore = -Infinity;
  const obstacleNearby = minFrontT < 0.82;
  const maxCandOffset =
    obstacleNearby
      ? 0.68
      : speed > 16
      ? 0.32
      : speed > 10
      ? 0.48
      : 0.68;

  for (const candOffset of STEER_CANDIDATE_OFFSETS) {
    // Disallow wide swerves if vehicle cannot overtake unless obstacle is ahead in corridor
    if (Math.abs(candOffset) > 0.3 && !canOvertake && !obstacleNearby) {
      continue;
    }
    if (Math.abs(candOffset) > maxCandOffset) {
      continue;
    }
    const candYaw = normalizeAngle(baseDesiredYaw + candOffset);
    const cFwdX = Math.sin(candYaw);
    const cFwdZ = Math.cos(candYaw);

    // Volumetric swept corridor check along candidate heading (catches thin streetlights, signs, bollards)
    const sweep = staticBvh.sweepCorridor(
      pos.x,
      pos.z,
      cFwdX,
      cFwdZ,
      probeArcLen,
      selfHalfW + 0.28,
    );
    const minWallT = sweep.clear ? 1 : sweep.t;

    // Score predictive Time-To-Collision clearance along candidate arc
    let minVehMargin = 6.0;
    for (const v of relevantVehicles) {
      const vFwdX = Math.sin(v.yaw);
      const vFwdZ = Math.cos(v.yaw);
      for (const t of PREDICT_TIMES) {
        const myX = pos.x + cFwdX * (testSpeed * t);
        const myZ = pos.z + cFwdZ * (testSpeed * t);
        const otX = v.x + vFwdX * (v.speed * t);
        const otZ = v.z + vFwdZ * (v.speed * t);
        const d = Math.hypot(otX - myX, otZ - myZ);
        const minSafe = selfHalfW + v.halfW + 0.85;
        const margin = d - minSafe;
        if (margin < minVehMargin) {
          minVehMargin = margin;
        }
      }
    }

    // Score prefers straight path toward goal, penalizes sign-reversing oscillation & wall/vehicle overlap
    const goalPenalty = Math.abs(candOffset) * (obstacleNearby ? 1.15 : 1.65);
    const signFlipPenalty =
      !obstacleNearby && Math.abs(prevSteerBias) > 0.08 && candOffset !== 0 && candOffset * prevSteerBias < 0
        ? 1.85
        : 0;
    const yawContinuity = Math.abs(candOffset - prevSteerBias) * (obstacleNearby ? 0.55 : 1.15) + signFlipPenalty;
    const wallScore = minWallT < 1 ? -(1 - minWallT) * 18.0 : 2.5;
    const vehScore = minVehMargin < 0 ? minVehMargin * 9.0 : Math.min(2.5, minVehMargin * 0.6);
    const score = vehScore + wallScore - goalPenalty - yawContinuity;

    if (score > bestScore) {
      bestScore = score;
      bestOffset = candOffset;
    }
  }

  // 4. Direct immediate forward vehicle corridor speed cap + emergency brake
  const scanRange = 9.0 + Math.min(13.5, speed * 0.7);
  let closestVehicle: AvoidanceVehicleProxy | null = null;
  let closestGap = Infinity;

  for (const other of relevantVehicles) {
    const dx = other.x - pos.x;
    const dz = other.z - pos.z;
    const fwdDist = dx * fwdX + dz * fwdZ;
    if (fwdDist < 0.35 || fwdDist > scanRange) continue;

    const latDist = Math.abs(dx * rightX + dz * rightZ);
    const corridorTightness = THREE.MathUtils.lerp(0.5, 0.22, Math.max(recklessness, impatience * 0.6));
    const corridorHalf = selfHalfW + other.halfW + corridorTightness;
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
    const safeLead = otherSameDir ? Math.max(0, closestVehicle.speed * 0.92) : 0;
    const hasCleanEscape = Math.abs(bestOffset) >= 0.24 && bestScore > -1.5;

    if (closestGap < hardStopGap && !hasCleanEscape) {
      speedCap = 0;
      vehicleBlocked = true;
    } else if (closestGap < hardStopGap && hasCleanEscape) {
      speedCap = Math.min(speedCap, Math.max(4.8, closestVehicle.speed + 2.5));
    } else if (closestGap < 8.0) {
      speedCap = Math.min(
        speedCap,
        Math.max(safeLead, (closestGap - hardStopGap * 0.7) * 1.45),
      );
      if (speedCap < 1.2 && !hasCleanEscape) vehicleBlocked = true;
    } else {
      speedCap = Math.min(speedCap, Math.max(safeLead + 3.0, closestGap * 0.95));
    }
  }

  // 5. Pedestrian corridor yield (high urgency / reckless responders yield less)
  if (recklessness < 0.85) {
    for (const ped of pedestrians) {
      if (ped.ragdoll.active) continue;
      const dx = ped.pos.x - pos.x;
      const dz = ped.pos.z - pos.z;
      const fwdDist = dx * fwdX + dz * fwdZ;
      if (fwdDist < 0.9 || fwdDist > 10.5) continue;
      const lat = dx * rightX + dz * rightZ;
      if (Math.abs(lat) < selfHalfW + 0.68) {
        if (fwdDist < 4.8) {
          const pedCap =
            recklessness > 0.45
              ? THREE.MathUtils.lerp(2.5, 8.8, (recklessness - 0.45) / 0.4)
              : canOvertake
              ? 4.0
              : 0;
          speedCap = Math.min(speedCap, pedCap);
          if (pedCap <= 0.1) vehicleBlocked = true;
        } else if (bestOffset === 0) {
          bestOffset += (lat >= 0 ? -1 : 1) * 0.28;
        }
        break;
      }
    }
  }

  let targetBias = bestOffset;
  if (wallBlocked && Math.abs(goalErr) < 0.65) {
    targetBias = preferredTurnDir * 0.88;
  } else {
    if (!frontCorridor.clear && frontCorridor.t < 0.75 && Math.abs(targetBias) < 0.14) {
      const pushDir = frontCorridor.hitLat >= 0 ? -1 : 1;
      targetBias += pushDir * (0.75 - frontCorridor.t) * 0.65;
    }
    if (!lWideRay.clear && lWideRay.t < 0.55) {
      targetBias -= (0.55 - lWideRay.t) * 0.55;
    }
    if (!rWideRay.clear && rWideRay.t < 0.55) {
      targetBias += (0.55 - rWideRay.t) * 0.55;
    }
  }
  const speedCapBias = obstacleNearby ? 0.68 : speed > 14 ? 0.36 : 0.72;
  targetBias = wallBlocked
    ? targetBias
    : THREE.MathUtils.clamp(targetBias, -speedCapBias, speedCapBias);

  const dampRate = obstacleNearby ? 9.5 : speed > 13 ? 4.8 : 7.2;
  const nextSteerBias = THREE.MathUtils.damp(prevSteerBias, targetBias, dampRate, dt);
  const desiredYaw = normalizeAngle(
    wallBlocked ? yaw + targetBias : baseDesiredYaw + nextSteerBias,
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
  stallCount?: number;
}

/**
 * Multi-stage unstick & 3-point turn recovery whenever a vehicle is boxed in or deadlocked.
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
      state.impatience = Math.max(0.2, state.impatience - 0.35);
      return { isReversing: false, justFinishedReverse: true };
    }
    return { isReversing: true, justFinishedReverse: false };
  }

  const wantsToMove = baseGoalSpeed > 1.0;
  const stalled = Math.abs(actualSpeed) < 1.25;

  if (wantsToMove && stalled) {
    const rateBoost = avoid.wallBlocked ? 2.1 : avoid.vehicleBlocked ? 1.3 : 1.0;
    state.stuckTimer += dt * (avoid.wallBlocked ? 1.8 : 1.15);
    state.impatience = Math.min(1, state.impatience + patienceRate * rateBoost * dt);

    const effThreshold = avoid.wallBlocked
      ? reverseThresholdSec * 0.42
      : reverseThresholdSec;

    if (avoid.rearClear && state.stuckTimer >= effThreshold) {
      const stalls = (state.stallCount ?? 0) + 1;
      state.stallCount = stalls;
      state.reverseTimer = reverseDurationSec * (stalls >= 2 ? 1.25 : 1.0);
      // Alternate turn direction on repeated consecutive stalls to break symmetry deadlocks
      state.reverseSteerDir =
        stalls % 2 === 0
          ? (avoid.preferredTurnDir === 1 ? -1 : 1)
          : avoid.preferredTurnDir;
      state.stuckTimer = 0;
      return { isReversing: true, justFinishedReverse: false };
    }
  } else if (actualSpeed > 3.6) {
    state.stuckTimer = Math.max(0, state.stuckTimer - dt * 2.0);
    state.impatience = Math.max(0, state.impatience - dt * 0.28);
    state.stallCount = 0;
  } else {
    state.stuckTimer = Math.max(0, state.stuckTimer - dt * 0.55);
  }

  return { isReversing: false, justFinishedReverse: false };
}
