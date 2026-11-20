import * as THREE from 'three';
import { CustomMapAsset, EngineConfigAsset } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import {
  collideOBB2D,
  computeVehicleOBB,
  DynamicVehicleBVH,
  OBB2D,
  StaticObstacleBVH,
} from './bvh';
import { playBoundAudioEvent } from './eventBindings';
import { getSurfaceHeight, WorldConfig } from './roadGraph';
import { DetachablePartRef, PoliceCruiserRig } from './vehicleModels';
import { RagdollState, SimVfxManager, triggerRagdoll } from './vfx';

export function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function applyVehicleWheelVisuals(
  wheels: THREE.Group[],
  frontWheels: THREE.Group[] | undefined,
  speed: number,
  steerAngle: number,
  radius: number,
  dt: number,
): void {
  const baseSpin = (speed * dt) / radius;
  for (const w of wheels) {
    const bent = (w.userData.bentAmount as number) || 0;
    w.rotation.z = bent;
    const spinScale = bent !== 0 ? Math.max(0.35, 1 - Math.abs(bent) * 2.2) : 1;
    w.rotation.x += baseSpin * spinScale;
  }
  if (frontWheels) {
    for (const fw of frontWheels) {
      fw.rotation.y = steerAngle;
    }
  }
}

export interface VehicleDynState {
  vx: number;
  vz: number;
  omega: number;
  bodyPitch: number;
  bodyRoll: number;
  pitchVel: number;
  rollVel: number;
  steerAngle: number;
}

export function createVehicleDynState(): VehicleDynState {
  return {
    vx: 0,
    vz: 0,
    omega: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    pitchVel: 0,
    rollVel: 0,
    steerAngle: 0,
  };
}

export interface VehicleDriveCommand {
  targetSpeed: number;
  desiredYaw: number;
  maxAccel: number;
  maxBrake: number;
  maxSteerRate: number;
  lateralGrip: number;
  mass: number;
  reverseTurnDir?: 1 | -1 | 0;
}

export function stepVehicleDynamics(
  pos: THREE.Vector3,
  yawRef: { yaw: number; speed: number },
  dyn: VehicleDynState,
  bodyGroup: THREE.Group,
  cmd: VehicleDriveCommand,
  dt: number,
): number {
  const fx = Math.sin(yawRef.yaw);
  const fz = Math.cos(yawRef.yaw);
  const rx = Math.cos(yawRef.yaw);
  const rz = -Math.sin(yawRef.yaw);

  let vForward = dyn.vx * fx + dyn.vz * fz;
  let vLateral = dyn.vx * rx + dyn.vz * rz;

  const isReverseCmd = cmd.targetSpeed < -0.05;
  const speedErr = cmd.targetSpeed - vForward;
  let longAccel = 0;
  if (isReverseCmd) {
    if (speedErr < -0.1) {
      longAccel = Math.max(-Math.max(4.8, cmd.maxAccel * 0.72), speedErr * 2.4);
    } else if (speedErr > 0.1) {
      longAccel = Math.min(cmd.maxBrake, speedErr * 2.5);
    }
  } else {
    if (speedErr > 0.15) {
      longAccel = Math.min(cmd.maxAccel, speedErr * 2.1);
    } else if (speedErr < -0.15) {
      longAccel = Math.max(-cmd.maxBrake, speedErr * 2.8);
    }
  }

  const drag = vForward * 0.18;
  vForward += (longAccel - drag) * dt;
    if (Math.abs(cmd.targetSpeed) <= 0.05 && Math.abs(vForward) < 0.25) {
      vForward = 0;
    }

    const yawDiff = normalizeAngle(cmd.desiredYaw - yawRef.yaw);
    let targetOmega = 0;
    let targetSteerAngle = 0;

    if (isReverseCmd || vForward < -0.25) {
      const revAuthority = THREE.MathUtils.clamp(Math.abs(vForward) / 1.4, 0.35, 1.0);
      const turnDir =
        cmd.reverseTurnDir === -1 || cmd.reverseTurnDir === 1
          ? cmd.reverseTurnDir
          : yawDiff >= 0
          ? -1
          : 1;
      targetOmega = turnDir * Math.min(1.65, cmd.maxSteerRate * 0.75) * revAuthority;
      targetSteerAngle = -turnDir * 0.42;
    } else {
      const speedAuthority = THREE.MathUtils.clamp(Math.abs(vForward) / 2.2, 0.22, 1.0);
      const highSpeedLimit = 1.0 / (1.0 + Math.abs(vForward) * 0.068);
      targetOmega =
        THREE.MathUtils.clamp(yawDiff * 1.95, -cmd.maxSteerRate, cmd.maxSteerRate) *
        speedAuthority *
        highSpeedLimit;
      targetSteerAngle = THREE.MathUtils.clamp(yawDiff * 0.48, -0.4, 0.4);
    }

    dyn.omega = THREE.MathUtils.damp(dyn.omega, targetOmega, 7.6, dt);
    yawRef.yaw = normalizeAngle(yawRef.yaw + dyn.omega * dt);

    vLateral *= Math.exp(-cmd.lateralGrip * dt);

    const nfx = Math.sin(yawRef.yaw);
    const nfz = Math.cos(yawRef.yaw);
    const nrx = Math.cos(yawRef.yaw);
    const nrz = -Math.sin(yawRef.yaw);

    dyn.vx = nfx * vForward + nrx * vLateral;
    dyn.vz = nfz * vForward + nrz * vLateral;
    yawRef.speed = Math.hypot(dyn.vx, dyn.vz);

    pos.x += dyn.vx * dt;
    pos.z += dyn.vz * dt;

    dyn.steerAngle = THREE.MathUtils.damp(dyn.steerAngle, targetSteerAngle, 7.5, dt);

    const targetPitch = THREE.MathUtils.clamp(-longAccel * 0.0052, -0.055, 0.06);
    const centripetal = vForward * dyn.omega;
    const targetRoll = THREE.MathUtils.clamp(-centripetal * 0.0042, -0.085, 0.085);

    dyn.pitchVel += ((targetPitch - dyn.bodyPitch) * 48 - dyn.pitchVel * 7.5) * dt;
    dyn.bodyPitch += dyn.pitchVel * dt;

    dyn.rollVel += ((targetRoll - dyn.bodyRoll) * 42 - dyn.rollVel * 7.0) * dt;
    dyn.bodyRoll += dyn.rollVel * dt;

    bodyGroup.rotation.x = dyn.bodyPitch;
    bodyGroup.rotation.z = dyn.bodyRoll;

    return vForward;
  }

export interface DetachedPartDebris {
  object: THREE.Object3D;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  radius: number;
  spawnGrace: number;
  ownerVehicleId: string;
}

export interface DebrisHumanoidTarget {
  pos: THREE.Vector3;
  ragdoll: RagdollState;
  onHitByDebris: (impactSpeed: number, dirX: number, dirZ: number) => void;
}

export interface StepDebrisOptions {
  vehicles?: VehicleCollisionEntry[];
  humanoids?: DebrisHumanoidTarget[];
  vfx?: SimVfxManager;
  audio?: JsonAudioSynth | null;
  config?: EngineConfigAsset | null;
  surfaceSource?: CustomMapAsset | WorldConfig | null;
  debrisObstacles?: boolean;
  restitution?: number;
  humanImpactSpeed?: number;
}

export interface VehicleCollisionEntry {
  id: string;
  kind: 'police' | 'civilian' | 'getaway';
  pos: THREE.Vector3;
  yaw: number;
  dyn: VehicleDynState;
  mass: number;
  halfW: number;
  halfL: number;
  detachableParts: DetachablePartRef[];
  bodyGroup: THREE.Group;
  wheels?: THREE.Group[];
  frontWheels?: THREE.Group[];
  policeRig?: PoliceCruiserRig;
  applyState: (newYaw: number, newSpeed: number) => void;
  onImpact: (strikeSpeed: number, hitByPolice: boolean) => void;
  onWheelBroken?: (tiltSide: number) => void;
}

export type CollisionCauser = 'a' | 'b' | 'mutual';

export interface CollisionResolutionOptions {
  debrisObstacles?: boolean;
  crashIntensity?: number;
  onHeavyCrash?: (strikeSpeed: number) => void;
  onVehicleCollision?: (
    a: VehicleCollisionEntry,
    b: VehicleCollisionEntry,
    strikeSpeed: number,
    contactX: number,
    contactZ: number,
    causer: CollisionCauser,
  ) => void;
}

const _worldPos = new THREE.Vector3();

export class VehicleCrashPhysicsSystem {
  private debrisGroup: THREE.Group;
  private rng: () => number;
  private vehicleBvh = new DynamicVehicleBVH();
  private cooldowns = new Map<string, number>();
  private debris: DetachedPartDebris[] = [];
  private obbs: OBB2D[] = [];
  public maxPhysicsParts = 120;

  constructor(debrisGroup: THREE.Group, rng: () => number) {
    this.debrisGroup = debrisGroup;
    this.rng = rng;
  }

  public setMaxPhysicsParts(limit: number): void {
    this.maxPhysicsParts = Math.max(0, Math.round(limit));
    while (this.debris.length > this.maxPhysicsParts) {
      const oldest = this.debris.shift()!;
      this.debrisGroup.remove(oldest.object);
    }
  }

  public getDebrisCount(): number {
    return this.debris.length;
  }

  public evictOldestDebris(): boolean {
    const oldest = this.debris.shift();
    if (!oldest) return false;
    this.debrisGroup.remove(oldest.object);
    return true;
  }

  public resolveAllCollisions(
    vehicles: VehicleCollisionEntry[],
    staticBvh: StaticObstacleBVH,
    vfx: SimVfxManager,
    audio: JsonAudioSynth | null,
    dt: number,
    options?: CollisionResolutionOptions,
  ): void {
    const debrisObstacles = options?.debrisObstacles ?? true;
    const crashIntensity = options?.crashIntensity ?? 1.0;
    const onHeavyCrash = options?.onHeavyCrash;

    for (const [k, t] of this.cooldowns.entries()) {
      const next = t - dt;
      if (next <= 0) this.cooldowns.delete(k);
      else this.cooldowns.set(k, next);
    }

    for (const v of vehicles) {
      const res = staticBvh.resolveOBB(v.pos, v.yaw, v.halfW, v.halfL);
      if (res.collided) {
        const vn = v.dyn.vx * res.normalX + v.dyn.vz * res.normalZ;
        if (vn < 0) {
          const strikeSpeed = -vn;
          v.dyn.vx -= (1.28 + 0.12 * crashIntensity) * vn * res.normalX;
          v.dyn.vz -= (1.28 + 0.12 * crashIntensity) * vn * res.normalZ;
          v.dyn.vx *= 0.65;
          v.dyn.vz *= 0.65;
          v.dyn.pitchVel += strikeSpeed * 0.095 * crashIntensity;
          v.dyn.rollVel += (this.rng() - 0.5) * strikeSpeed * 0.07 * crashIntensity;

          if (strikeSpeed > 3.2) {
            vfx.spawnCollisionEffects(
              res.hitX,
              0.75,
              res.hitZ,
              strikeSpeed * crashIntensity,
              res.normalX * 3.8,
              res.normalZ * 3.8,
              audio,
            );
            this.tryDetachParts(
              v,
              res.hitX,
              res.hitZ,
              res.normalX,
              res.normalZ,
              strikeSpeed,
              crashIntensity,
              vfx,
            );
            v.onImpact(strikeSpeed, false);
            if (strikeSpeed >= 9.5) {
              onHeavyCrash?.(strikeSpeed * crashIntensity);
            }
          }
        }
        v.applyState(v.yaw, Math.hypot(v.dyn.vx, v.dyn.vz));
      }
    }

    this.obbs.length = vehicles.length;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      this.obbs[i] = computeVehicleOBB(v.pos.x, v.pos.z, v.yaw, v.halfW, v.halfL);
    }

    this.vehicleBvh.build(this.obbs);
    this.vehicleBvh.queryPairs(this.obbs, (i, j) => {
      const a = vehicles[i];
      const b = vehicles[j];
      const sat = collideOBB2D(this.obbs[i], this.obbs[j]);
      if (!sat.hit) return;

      const totalMass = a.mass + b.mass;
      const invMassA = 1 / a.mass;
      const invMassB = 1 / b.mass;
      const shareA = b.mass / totalMass;
      const shareB = a.mass / totalMass;

      const sep = sat.overlap * 0.78;
      a.pos.x -= sat.normalX * sep * shareA;
      a.pos.z -= sat.normalZ * sep * shareA;
      b.pos.x += sat.normalX * sep * shareB;
      b.pos.z += sat.normalZ * sep * shareB;
      staticBvh.resolveOBB(a.pos, a.yaw, a.halfW, a.halfL);
      staticBvh.resolveOBB(b.pos, b.yaw, b.halfW, b.halfL);

      const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (this.cooldowns.has(pairKey)) return;

      const rAx = sat.contactX - a.pos.x;
      const rAz = sat.contactZ - a.pos.z;
      const rBx = sat.contactX - b.pos.x;
      const rBz = sat.contactZ - b.pos.z;

      const vAx = a.dyn.vx - a.dyn.omega * rAz;
      const vAz = a.dyn.vz + a.dyn.omega * rAx;
      const vBx = b.dyn.vx - b.dyn.omega * rBz;
      const vBz = b.dyn.vz + b.dyn.omega * rBx;

      const relVx = vBx - vAx;
      const relVz = vBz - vAz;
      const velAlongNormal = relVx * sat.normalX + relVz * sat.normalZ;

      if (velAlongNormal > 0.25) return;

      const strikeSpeed = Math.max(
        -velAlongNormal,
        Math.hypot(a.dyn.vx - b.dyn.vx, a.dyn.vz - b.dyn.vz) * 0.45,
      );
      if (strikeSpeed < 1.8) return;

      this.cooldowns.set(pairKey, 0.34);

      // Compute fault/causer strictly from PRE-IMPULSE velocity toward the other vehicle & front-bumper orientation
      const sepDx = b.pos.x - a.pos.x;
      const sepDz = b.pos.z - a.pos.z;
      const sepLen = Math.hypot(sepDx, sepDz) || 1;
      const dirX = sepDx / sepLen;
      const dirZ = sepDz / sepLen;
      const approachA = Math.max(0, a.dyn.vx * dirX + a.dyn.vz * dirZ);
      const approachB = Math.max(0, -(b.dyn.vx * dirX + b.dyn.vz * dirZ));
      const frontAlignA = Math.max(0, Math.sin(a.yaw) * dirX + Math.cos(a.yaw) * dirZ);
      const frontAlignB = Math.max(0, -(Math.sin(b.yaw) * dirX + Math.cos(b.yaw) * dirZ));
      const scoreA = approachA * (0.35 + 0.85 * frontAlignA);
      const scoreB = approachB * (0.35 + 0.85 * frontAlignB);
      let causer: CollisionCauser = 'mutual';
      if (scoreA > Math.max(1.8, scoreB * 1.2)) {
        causer = 'a';
      } else if (scoreB > Math.max(1.8, scoreA * 1.2)) {
        causer = 'b';
      } else if (scoreA > scoreB + 0.6) {
        causer = 'a';
      } else if (scoreB > scoreA + 0.6) {
        causer = 'b';
      }

      const invInertiaA = 1 / (a.mass * 2.2);
      const invInertiaB = 1 / (b.mass * 2.2);
      const rACrossN = rAx * sat.normalZ - rAz * sat.normalX;
      const rBCrossN = rBx * sat.normalZ - rBz * sat.normalX;

      const restitution = 0.26 + 0.08 * Math.min(1.5, crashIntensity);
      const denom =
        invMassA +
        invMassB +
        rACrossN * rACrossN * invInertiaA +
        rBCrossN * rBCrossN * invInertiaB;
      const impulseMag = (-(1 + restitution) * velAlongNormal) / Math.max(0.001, denom);

      const jx = impulseMag * sat.normalX;
      const jz = impulseMag * sat.normalZ;

      a.dyn.vx -= jx * invMassA;
      a.dyn.vz -= jz * invMassA;
      b.dyn.vx += jx * invMassB;
      b.dyn.vz += jz * invMassB;

      a.dyn.omega = THREE.MathUtils.clamp(
        a.dyn.omega - rACrossN * impulseMag * invInertiaA * 0.9,
        -6.8,
        6.8,
      );
      b.dyn.omega = THREE.MathUtils.clamp(
        b.dyn.omega + rBCrossN * impulseMag * invInertiaB * 0.9,
        -6.8,
        6.8,
      );

      a.dyn.pitchVel += (this.rng() - 0.5) * strikeSpeed * 0.075 * crashIntensity;
      b.dyn.pitchVel += (this.rng() - 0.5) * strikeSpeed * 0.075 * crashIntensity;
      a.dyn.rollVel += (this.rng() - 0.5) * strikeSpeed * 0.095 * crashIntensity;
      b.dyn.rollVel += (this.rng() - 0.5) * strikeSpeed * 0.095 * crashIntensity;

      a.applyState(a.yaw, Math.hypot(a.dyn.vx, a.dyn.vz));
      b.applyState(b.yaw, Math.hypot(b.dyn.vx, b.dyn.vz));

      vfx.spawnCollisionEffects(
        sat.contactX,
        0.78,
        sat.contactZ,
        strikeSpeed * crashIntensity,
        sat.normalX * 3.8,
        sat.normalZ * 3.8,
        audio,
      );

      this.tryDetachParts(
        a,
        sat.contactX,
        sat.contactZ,
        -sat.normalX,
        -sat.normalZ,
        strikeSpeed,
        crashIntensity,
        vfx,
      );
      this.tryDetachParts(
        b,
        sat.contactX,
        sat.contactZ,
        sat.normalX,
        sat.normalZ,
        strikeSpeed,
        crashIntensity,
        vfx,
      );

      a.onImpact(strikeSpeed, b.kind === 'police');
      b.onImpact(strikeSpeed, a.kind === 'police');
      options?.onVehicleCollision?.(a, b, strikeSpeed, sat.contactX, sat.contactZ, causer);
      if (strikeSpeed >= 9.5) {
        onHeavyCrash?.(strikeSpeed * crashIntensity);
      }
    });

    // Dynamic interaction against all low-lying debris parts (active & resting)
    if (debrisObstacles && this.debris.length > 0 && vehicles.length > 0) {
      for (const d of this.debris) {
        if (d.object.position.y > 1.25) continue;

        for (let i = 0; i < vehicles.length; i++) {
          const v = vehicles[i];
          if (d.spawnGrace > 0 && d.ownerVehicleId === v.id) continue;
          const spd = Math.hypot(v.dyn.vx, v.dyn.vz);
          if (spd < 0.9) continue;

          const dx = d.object.position.x - v.pos.x;
          const dz = d.object.position.z - v.pos.z;
          if (dx * dx + dz * dz > (v.halfL + d.radius + 0.7) ** 2) continue;

          const cosY = Math.cos(v.yaw);
          const sinY = Math.sin(v.yaw);
          const lx = dx * cosY - dz * sinY;
          const lz = dx * sinY + dz * cosY;

          if (Math.abs(lx) < v.halfW + d.radius && Math.abs(lz) < v.halfL + d.radius) {
            const kickSpeed = Math.max(4.8, spd * 0.92);
            const fwdX = Math.sin(v.yaw);
            const fwdZ = Math.cos(v.yaw);
            d.vel.x = fwdX * kickSpeed + (this.rng() - 0.5) * 4.2 + (lx >= 0 ? cosY : -cosY) * 2.8;
            d.vel.y = 2.2 + Math.min(4.2, spd * 0.24);
            d.vel.z = fwdZ * kickSpeed + (this.rng() - 0.5) * 4.2 + (lx >= 0 ? -sinY : sinY) * 2.8;
            d.angVel.set(
              (this.rng() - 0.5) * 16,
              (this.rng() - 0.5) * 16,
              (this.rng() - 0.5) * 16,
            );
            d.object.position.y = Math.max(d.object.position.y, 0.28);

            // Push debris cleanly outside bumper envelope so it doesn't buzz-collide continuously
            const pushSign = lx >= 0 ? 1 : -1;
            d.object.position.x += cosY * pushSign * 0.22 + fwdX * 0.18;
            d.object.position.z += -sinY * pushSign * 0.22 + fwdZ * 0.18;

            // Impart noticeable physical bump and momentum drag to vehicle running over debris
            v.dyn.vx *= 0.93;
            v.dyn.vz *= 0.93;
            v.dyn.pitchVel += (this.rng() > 0.5 ? 1 : -1) * Math.min(1.8, spd * 0.12);
            v.dyn.rollVel += (lx >= 0 ? -1 : 1) * Math.min(2.0, spd * 0.13);
            v.applyState(v.yaw, Math.hypot(v.dyn.vx, v.dyn.vz));

            if (spd > 5.0) {
              vfx.spawnImpactSparks(
                d.object.position.x,
                0.28,
                d.object.position.z,
                3,
                0.65,
              );
            }
          }
        }
      }
    }
  }

  private tryDetachParts(
    veh: VehicleCollisionEntry,
    contactX: number,
    contactZ: number,
    outNx: number,
    outNz: number,
    strikeSpeed: number,
    crashIntensity: number,
    vfx: SimVfxManager,
  ): void {
    const effectiveStrike = strikeSpeed * crashIntensity;
    if (effectiveStrike < 6.4 || veh.detachableParts.length === 0) return;

    const dx = contactX - veh.pos.x;
    const dz = contactZ - veh.pos.z;
    const fx = Math.sin(veh.yaw);
    const fz = Math.cos(veh.yaw);
    const rx = Math.cos(veh.yaw);
    const rz = -Math.sin(veh.yaw);
    const localX = dx * rx + dz * rz;
    const localZ = dx * fx + dz * fz;

    const candidates: Array<{ part: DetachablePartRef; distSq: number }> = [];
    for (const p of veh.detachableParts) {
      if (p.detached) continue;
      if (p.isLightbar && veh.policeRig?.lightbar.visorStealthActive) continue;

      const ddx = p.localOffset.x - localX;
      const ddz = p.localOffset.z - localZ;
      const distSq = ddx * ddx + ddz * ddz;

      if (p.isWheel) {
        if (effectiveStrike >= 8.2 && distSq < 1.95) {
          const sign = p.localOffset.x >= 0 ? 1 : -1;
          const severity = THREE.MathUtils.clamp((effectiveStrike - 7.5) * 0.028, 0.09, 0.3);
          p.object.userData.bentAmount = sign * severity;
          if (Math.abs(severity) >= 0.21) {
            veh.onWheelBroken?.(sign);
          }
        }
        if (distSq > 1.95) continue;
      }

      const proximityLimit = effectiveStrike >= 14.5 ? 8.5 : 4.6;
      if (distSq > proximityLimit) continue;

      // Progressive structural damage based on part HP
      const dmgFactor = Math.max(0.25, 1.0 - distSq / proximityLimit);
      if (effectiveStrike >= p.minStrikeSpeed * 0.72) {
        const partDmg = (effectiveStrike - p.minStrikeSpeed * 0.55) * 4.4 * dmgFactor;
        p.hp = Math.max(0, p.hp - partDmg);

        if (p.hp > 0 && p.hp < p.maxHp * 0.65 && !p.isWheel) {
          // Visible structural bend/crumple before snapping free
          p.object.rotation.x += (this.rng() - 0.5) * 0.09;
          p.object.rotation.z += (this.rng() - 0.5) * 0.11;
        }
      }

      if (p.hp <= 0 || effectiveStrike >= p.minStrikeSpeed * 1.15) {
        candidates.push({ part: p, distSq });
      }
    }

    if (candidates.length === 0) return;
    candidates.sort((c1, c2) => c1.distSq - c2.distSq);

    const maxToDetach = effectiveStrike >= 15 ? 3 : effectiveStrike >= 10.5 ? 2 : 1;
    const count = Math.min(maxToDetach, candidates.length);

    for (let k = 0; k < count; k++) {
      const part = candidates[k].part;
      part.detached = true;

      if (part.role === 'lightbar' && veh.policeRig) {
        const lb = veh.policeRig.lightbar;
        lb.detached = true;
        lb.redPointLight.intensity = 0;
        lb.bluePointLight.intensity = 0;
        lb.cookieLeft.visible = false;
        lb.cookieRight.visible = false;
        lb.leftLensMat.emissiveIntensity = 0;
        lb.rightLensMat.emissiveIntensity = 0;
        lb.miniBeaconLeftMat.emissiveIntensity = 0;
        lb.miniBeaconRightMat.emissiveIntensity = 0;
        (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
        (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
        (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
      }

      if (veh.policeRig) {
        const lb = veh.policeRig.lightbar;
        if (part.role === 'headlight_l') {
          lb.headlightLeftDetached = true;
          lb.headlightLeftMat.emissiveIntensity = 0;
          (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = 0;
        } else if (part.role === 'headlight_r') {
          lb.headlightRightDetached = true;
          lb.headlightRightMat.emissiveIntensity = 0;
          (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = 0;
        } else if (part.role === 'taillight_l') {
          lb.taillightLeftDetached = true;
          lb.taillightLeftMat.emissiveIntensity = 0;
        } else if (part.role === 'taillight_r') {
          lb.taillightRightDetached = true;
          lb.taillightRightMat.emissiveIntensity = 0;
        }
      }

      if (
        part.role === 'lightbar' ||
        part.role === 'headlight_l' ||
        part.role === 'headlight_r' ||
        part.role === 'taillight_l' ||
        part.role === 'taillight_r'
      ) {
        part.object.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = mats.map((m) => {
              const copy = m.clone();
              if ('emissiveIntensity' in copy) {
                (copy as THREE.MeshStandardMaterial).emissiveIntensity = 0;
                (copy as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
              }
              return copy;
            });
            child.material = Array.isArray(child.material) ? cloned : cloned[0];
          }
        });
      }

      if (part.isWheel || part.role === 'wheel') {
        veh.onWheelBroken?.(part.localOffset.x >= 0 ? 1 : -1);
        if (veh.wheels) {
          const idx = veh.wheels.indexOf(part.object as THREE.Group);
          if (idx >= 0) veh.wheels.splice(idx, 1);
        }
        if (veh.frontWheels) {
          const idx = veh.frontWheels.indexOf(part.object as THREE.Group);
          if (idx >= 0) veh.frontWheels.splice(idx, 1);
        }
      }

      part.object.updateMatrixWorld(true);
      this.debrisGroup.attach(part.object);
      part.object.getWorldPosition(_worldPos);

      if (effectiveStrike > 10.5) {
        vfx.spawnImpactSparks(
          _worldPos.x,
          Math.max(0.35, _worldPos.y),
          _worldPos.z,
          5,
          0.95,
          outNx * 4,
          outNz * 4,
        );
      }

      const blast = 3.4 + effectiveStrike * 0.44;
      const vx = veh.dyn.vx * 0.74 + outNx * blast + (this.rng() - 0.5) * 4.8;
      const vy = 3.8 + this.rng() * (effectiveStrike * 0.3);
      const vz = veh.dyn.vz * 0.74 + outNz * blast + (this.rng() - 0.5) * 4.8;

      this.debris.push({
        object: part.object,
        vel: new THREE.Vector3(vx, vy, vz),
        angVel: new THREE.Vector3(
          (this.rng() - 0.5) * 14,
          (this.rng() - 0.5) * 14,
          (this.rng() - 0.5) * 14,
        ),
        radius: part.radius,
        spawnGrace: 0.65,
        ownerVehicleId: veh.id,
      });

      while (this.debris.length > this.maxPhysicsParts) {
        const oldest = this.debris.shift()!;
        this.debrisGroup.remove(oldest.object);
      }
    }
  }

  public stepDebris(
    staticBvh: StaticObstacleBVH,
    dt: number,
    options?: StepDebrisOptions,
  ): void {
    const restitution = options?.restitution ?? options?.config?.physics?.debrisRestitution ?? 0.36;
    const humanImpactSpeed =
      options?.humanImpactSpeed ?? options?.config?.physics?.debrisHumanImpactSpeed ?? 6.2;
    const surfaceSource = options?.surfaceSource;
    const humanoids = options?.humanoids;

    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      if (d.spawnGrace > 0) d.spawnGrace = Math.max(0, d.spawnGrace - dt);

      const groundY =
        (surfaceSource ? getSurfaceHeight(d.object.position.x, d.object.position.z, surfaceSource) : 0.04) +
        0.12;
      const speedSq = d.vel.lengthSq() + d.angVel.lengthSq();
      const onGround = d.object.position.y <= groundY + 0.015 && Math.abs(d.vel.y) < 0.05;

      // Skip unnecessary integration when settled at rest until struck by a vehicle or part
      if (onGround && speedSq < 0.002) {
        d.vel.set(0, 0, 0);
        d.angVel.set(0, 0, 0);
        d.object.position.y = groundY;
        continue;
      }

      d.vel.y -= 22.0 * dt;
      d.object.position.addScaledVector(d.vel, dt);

      const res = staticBvh.resolveCircle(d.object.position, d.radius * 0.75);
      if (res.collided) {
        const vn = d.vel.x * res.normalX + d.vel.z * res.normalZ;
        if (vn < 0) {
          d.vel.x -= (1.1 + restitution) * vn * res.normalX;
          d.vel.z -= (1.1 + restitution) * vn * res.normalZ;
          d.angVel.multiplyScalar(0.75);
        }
      }

      if (d.object.position.y <= groundY) {
        d.object.position.y = groundY;
        if (d.vel.y < -1.4) {
          d.vel.y = -d.vel.y * restitution;
        } else {
          d.vel.y = 0;
        }
        const groundDamp = Math.exp(-4.6 * dt);
        d.vel.x *= groundDamp;
        d.vel.z *= groundDamp;
        d.angVel.multiplyScalar(Math.exp(-5.4 * dt));
      }

      d.object.rotation.x += d.angVel.x * dt;
      d.object.rotation.y += d.angVel.y * dt;
      d.object.rotation.z += d.angVel.z * dt;

      // Fast flying or tumbling debris strikes humanoids physically
      if (humanoids && humanoids.length > 0 && d.object.position.y < 2.2) {
        const dSpeed = Math.hypot(d.vel.x, d.vel.z);
        if (dSpeed >= humanImpactSpeed) {
          for (let h = 0; h < humanoids.length; h++) {
            const hum = humanoids[h];
            if (hum.ragdoll.active) continue;
            const dx = hum.pos.x - d.object.position.x;
            const dz = hum.pos.z - d.object.position.z;
            const hitR = d.radius + 0.48;
            if (dx * dx + dz * dz < hitR * hitR) {
              const dist = Math.hypot(dx, dz) || 1;
              const nx = dx / dist;
              const nz = dz / dist;
              hum.onHitByDebris(dSpeed, nx, nz);
              triggerRagdoll(
                hum.ragdoll,
                this.rng,
                d.vel.x * 0.55 + nx * 2.4,
                2.5 + Math.min(3.5, dSpeed * 0.2),
                d.vel.z * 0.55 + nz * 2.4,
                3.6,
              );
              d.vel.multiplyScalar(0.65);
              if (options?.audio) {
                playBoundAudioEvent(options.audio, options.config ?? null, 'ped_impact', hum.pos);
              }
              options?.vfx?.spawnBloodImpact(
                hum.pos.x,
                1.0,
                hum.pos.z,
                nx,
                nz,
                Math.min(1.0, dSpeed * 0.08),
                false,
              );
            }
          }
        }
      }
    }

    // Debris-to-debris dynamic collisions for parts in motion
    const len = this.debris.length;
    if (len > 1) {
      for (let i = 0; i < len; i++) {
        const a = this.debris[i];
        const aMoving = a.vel.lengthSq() > 0.2;
        for (let j = i + 1; j < len; j++) {
          const b = this.debris[j];
          if (!aMoving && b.vel.lengthSq() <= 0.2) continue;
          const dx = b.object.position.x - a.object.position.x;
          const dy = b.object.position.y - a.object.position.y;
          const dz = b.object.position.z - a.object.position.z;
          const minD = (a.radius + b.radius) * 0.72;
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq >= minD * minD || dSq < 0.0001) continue;
          const d = Math.sqrt(dSq);
          const nx = dx / d;
          const ny = dy / d;
          const nz = dz / d;
          const overlap = (minD - d) * 0.5;
          a.object.position.x -= nx * overlap;
          a.object.position.y -= ny * overlap;
          a.object.position.z -= nz * overlap;
          b.object.position.x += nx * overlap;
          b.object.position.y += ny * overlap;
          b.object.position.z += nz * overlap;

          const rvx = b.vel.x - a.vel.x;
          const rvy = b.vel.y - a.vel.y;
          const rvz = b.vel.z - a.vel.z;
          const vn = rvx * nx + rvy * ny + rvz * nz;
          if (vn < 0) {
            const jImp = -(1 + restitution) * vn * 0.5;
            a.vel.x -= nx * jImp;
            a.vel.y -= ny * jImp;
            a.vel.z -= nz * jImp;
            b.vel.x += nx * jImp;
            b.vel.y += ny * jImp;
            b.vel.z += nz * jImp;
          }
        }
      }
    }
  }

  public clearDebris(): void {
    for (const d of this.debris) {
      this.debrisGroup.remove(d.object);
    }
    this.debris = [];
    this.cooldowns.clear();
  }

  public dispose(): void {
    this.clearDebris();
  }
}
