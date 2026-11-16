import * as THREE from 'three';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import {
  collideOBB2D,
  computeVehicleOBB,
  DynamicVehicleBVH,
  OBB2D,
  StaticObstacleBVH,
} from './bvh';
import { DetachablePartRef, PoliceCruiserRig } from './vehicleModels';
import { SimVfxManager } from './vfx';

export function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
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
}

/**
 * Deliberate, weighty 2D rigid-body vehicle dynamics with separate velocity vector,
 * tire slip / lateral grip, speed-sensitive steering, and suspension pitch/roll.
 */
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

  // Engine throttle / deliberate braking curve
  const speedErr = cmd.targetSpeed - vForward;
  let longAccel = 0;
  if (speedErr > 0.15) {
    longAccel = Math.min(cmd.maxAccel, speedErr * 2.1);
  } else if (speedErr < -0.15) {
    longAccel = Math.max(-cmd.maxBrake, speedErr * 2.8);
  }

  // Rolling drag
  const drag = vForward * 0.18;
  vForward += (longAccel - drag) * dt;
  if (cmd.targetSpeed <= 0.05 && Math.abs(vForward) < 0.25) {
    vForward = 0;
  }

  // Speed-sensitive damped steering (smooth tracking without high-speed S-swerving)
  const yawDiff = normalizeAngle(cmd.desiredYaw - yawRef.yaw);
  const speedAuthority = THREE.MathUtils.clamp(Math.abs(vForward) / 2.2, 0.22, 1.0);
  const highSpeedLimit = 1.0 / (1.0 + Math.abs(vForward) * 0.048);
  const targetOmega =
    THREE.MathUtils.clamp(yawDiff * 2.15, -cmd.maxSteerRate, cmd.maxSteerRate) *
    speedAuthority *
    highSpeedLimit;

  // Blend steering omega against any crash-induced spin angular velocity
  dyn.omega = THREE.MathUtils.damp(dyn.omega, targetOmega, 9.2, dt);
  yawRef.yaw = normalizeAngle(yawRef.yaw + dyn.omega * dt);

  // Lateral tire friction (wet streets reduce grip cleanly)
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

  // Front wheel visual angle
  dyn.steerAngle = THREE.MathUtils.damp(
    dyn.steerAngle,
    THREE.MathUtils.clamp(yawDiff * 0.55, -0.42, 0.42),
    7.5,
    dt,
  );

  // 2nd-order spring-damper suspension for pitch (squat/dive) and roll (cornering lean)
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
  life: number;
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

const _worldPos = new THREE.Vector3();

/**
 * Resolves vehicle-to-vehicle OBB SAT collisions pruned by DynamicVehicleBVH,
 * transferring linear & angular momentum, spawning velocity-scaled sparks/smoke,
 * and detaching physical vehicle parts on large impacts.
 */
export class VehicleCrashPhysicsSystem {
  private scene: THREE.Scene;
  private rng: () => number;
  private vehicleBvh = new DynamicVehicleBVH();
  private cooldowns = new Map<string, number>();
  private debris: DetachedPartDebris[] = [];
  private obbs: OBB2D[] = [];

  constructor(scene: THREE.Scene, rng: () => number) {
    this.scene = scene;
    this.rng = rng;
  }

  public resolveAllCollisions(
    vehicles: VehicleCollisionEntry[],
    staticBvh: StaticObstacleBVH,
    vfx: SimVfxManager,
    audio: JsonAudioSynth | null,
    dt: number,
  ): void {
    for (const [k, t] of this.cooldowns.entries()) {
      const next = t - dt;
      if (next <= 0) this.cooldowns.delete(k);
      else this.cooldowns.set(k, next);
    }

    // 1. Static BVH obstacle collision response for every vehicle
    for (const v of vehicles) {
      const res = staticBvh.resolveCircle(v.pos, 1.52);
      if (res.collided) {
        const vn = v.dyn.vx * res.normalX + v.dyn.vz * res.normalZ;
        if (vn < 0) {
          const strikeSpeed = -vn;
          // Reflect normal velocity with low concrete restitution
          v.dyn.vx -= 1.32 * vn * res.normalX;
          v.dyn.vz -= 1.32 * vn * res.normalZ;
          v.dyn.vx *= 0.65;
          v.dyn.vz *= 0.65;
          v.dyn.pitchVel += strikeSpeed * 0.08;

          if (strikeSpeed > 3.5) {
            vfx.spawnCollisionEffects(
              res.hitX,
              0.75,
              res.hitZ,
              strikeSpeed,
              res.normalX * 3.5,
              res.normalZ * 3.5,
              audio,
            );
            this.tryDetachParts(v, res.hitX, res.hitZ, res.normalX, res.normalZ, strikeSpeed);
            v.onImpact(strikeSpeed, false);
          }
        }
        v.applyState(v.yaw, Math.hypot(v.dyn.vx, v.dyn.vz));
      }
    }

    // 2. Dynamic BVH broadphase + exact 2D OBB SAT narrowphase
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

      // Positional separation
      const sep = sat.overlap * 0.72;
      a.pos.x -= sat.normalX * sep * shareA;
      a.pos.z -= sat.normalZ * sep * shareA;
      b.pos.x += sat.normalX * sep * shareB;
      b.pos.z += sat.normalZ * sep * shareB;
      staticBvh.resolveCircle(a.pos, 1.5);
      staticBvh.resolveCircle(b.pos, 1.5);

      const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (this.cooldowns.has(pairKey)) return;

      // Relative velocity at contact point (including yaw angular velocity r x omega)
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

      if (velAlongNormal > 0.25) return; // Separating

      const strikeSpeed = Math.max(-velAlongNormal, Math.hypot(a.dyn.vx - b.dyn.vx, a.dyn.vz - b.dyn.vz) * 0.45);
      if (strikeSpeed < 2.0) return;

      this.cooldowns.set(pairKey, 0.34);

      // Rigid-body rotational inertia approx for sedan rectangle
      const invInertiaA = 1 / (a.mass * 2.2);
      const invInertiaB = 1 / (b.mass * 2.2);
      const rACrossN = rAx * sat.normalZ - rAz * sat.normalX;
      const rBCrossN = rBx * sat.normalZ - rBz * sat.normalX;

      const restitution = 0.26;
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

      // Torque-induced yaw spin (PIT maneuver spin on off-center rear/front strikes)
      a.dyn.omega = THREE.MathUtils.clamp(
        a.dyn.omega - rACrossN * impulseMag * invInertiaA * 0.85,
        -6.5,
        6.5,
      );
      b.dyn.omega = THREE.MathUtils.clamp(
        b.dyn.omega + rBCrossN * impulseMag * invInertiaB * 0.85,
        -6.5,
        6.5,
      );

      // Suspension crash jolt
      a.dyn.pitchVel += (this.rng() - 0.5) * strikeSpeed * 0.06;
      b.dyn.pitchVel += (this.rng() - 0.5) * strikeSpeed * 0.06;
      a.dyn.rollVel += (this.rng() - 0.5) * strikeSpeed * 0.08;
      b.dyn.rollVel += (this.rng() - 0.5) * strikeSpeed * 0.08;

      a.applyState(a.yaw, Math.hypot(a.dyn.vx, a.dyn.vz));
      b.applyState(b.yaw, Math.hypot(b.dyn.vx, b.dyn.vz));

      vfx.spawnCollisionEffects(
        sat.contactX,
        0.78,
        sat.contactZ,
        strikeSpeed,
        sat.normalX * 3.5,
        sat.normalZ * 3.5,
        audio,
      );

      // Part detachment on heavy collisions
      this.tryDetachParts(a, sat.contactX, sat.contactZ, -sat.normalX, -sat.normalZ, strikeSpeed);
      this.tryDetachParts(b, sat.contactX, sat.contactZ, sat.normalX, sat.normalZ, strikeSpeed);

      a.onImpact(strikeSpeed, b.kind === 'police');
      b.onImpact(strikeSpeed, a.kind === 'police');
    });
  }

  private tryDetachParts(
    veh: VehicleCollisionEntry,
    contactX: number,
    contactZ: number,
    outNx: number,
    outNz: number,
    strikeSpeed: number,
  ): void {
    if (strikeSpeed < 7.2 || veh.detachableParts.length === 0) return;

    // Convert contact point to local vehicle space
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
      const ddx = p.localOffset.x - localX;
      const ddz = p.localOffset.z - localZ;
      const distSq = ddx * ddx + ddz * ddz;

      // Wheels can suffer bent axle / broken rotation on impacts near that corner
      if (p.isWheel) {
        if (strikeSpeed >= 8.2 && distSq < 1.85) {
          const sign = p.localOffset.x >= 0 ? 1 : -1;
          const severity = THREE.MathUtils.clamp((strikeSpeed - 7.5) * 0.028, 0.09, 0.3);
          p.object.userData.bentAmount = sign * severity;
          if (Math.abs(severity) >= 0.21) {
            veh.onWheelBroken?.(sign);
          }
        }
        if (distSq > 1.85) continue;
      }

      if (strikeSpeed < p.minStrikeSpeed) continue;
      // Only break off parts near impact zone (or top roof accessories on huge crashes)
      if (distSq < 4.4 || (strikeSpeed >= 15.0 && distSq < 8.5)) {
        candidates.push({ part: p, distSq });
      }
    }

    if (candidates.length === 0) return;
    candidates.sort((c1, c2) => c1.distSq - c2.distSq);

    const maxToDetach = strikeSpeed >= 15 ? 3 : strikeSpeed >= 11 ? 2 : 1;
    const count = Math.min(maxToDetach, candidates.length);

    for (let k = 0; k < count; k++) {
      const part = candidates[k].part;
      part.detached = true;

      if (part.isLightbar && veh.policeRig) {
        const lb = veh.policeRig.lightbar;
        lb.detached = true;
        lb.redPointLight.intensity = 0;
        lb.bluePointLight.intensity = 0;
        lb.cookieLeft.visible = false;
        lb.cookieRight.visible = false;
        lb.leftLensMat.emissiveIntensity = 0;
        lb.rightLensMat.emissiveIntensity = 0;
        (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
        (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
        (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
      }

      if (veh.policeRig) {
        const lb = veh.policeRig.lightbar;
        if (part.id === 'headlight_l') {
          lb.headlightLeftDetached = true;
          lb.headlightLeftMat.emissiveIntensity = 0;
          (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = 0;
        } else if (part.id === 'headlight_r') {
          lb.headlightRightDetached = true;
          lb.headlightRightMat.emissiveIntensity = 0;
          (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = 0;
        } else if (part.id === 'taillight_l') {
          lb.taillightLeftDetached = true;
          lb.taillightLeftMat.emissiveIntensity = 0;
        } else if (part.id === 'taillight_r') {
          lb.taillightRightDetached = true;
          lb.taillightRightMat.emissiveIntensity = 0;
        }
      }

      // Detached lights / lamps must never continue glowing as debris
      if (
        part.isLightbar ||
        part.id.startsWith('headlight') ||
        part.id.startsWith('taillight') ||
        part.id.startsWith('hl_') ||
        part.id.startsWith('tl_')
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

      if (part.isWheel) {
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

      // Preserve exact world position/orientation while reparenting to scene
      part.object.updateMatrixWorld(true);
      this.scene.attach(part.object);
      part.object.getWorldPosition(_worldPos);

      const blast = 3.2 + strikeSpeed * 0.42;
      const vx = veh.dyn.vx * 0.72 + outNx * blast + (this.rng() - 0.5) * 4.5;
      const vy = 3.6 + this.rng() * (strikeSpeed * 0.28);
      const vz = veh.dyn.vz * 0.72 + outNz * blast + (this.rng() - 0.5) * 4.5;

      this.debris.push({
        object: part.object,
        vel: new THREE.Vector3(vx, vy, vz),
        angVel: new THREE.Vector3(
          (this.rng() - 0.5) * 14,
          (this.rng() - 0.5) * 14,
          (this.rng() - 0.5) * 14,
        ),
        life: 16.0,
      });

      if (this.debris.length > 55) {
        const oldest = this.debris.shift()!;
        this.scene.remove(oldest.object);
      }
    }
  }

  public stepDebris(staticBvh: StaticObstacleBVH, dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.object);
        this.debris.splice(i, 1);
        continue;
      }

      d.vel.y -= 22.0 * dt;
      d.object.position.addScaledVector(d.vel, dt);

      const res = staticBvh.resolveCircle(d.object.position, 0.35);
      if (res.collided) {
        const vn = d.vel.x * res.normalX + d.vel.z * res.normalZ;
        if (vn < 0) {
          d.vel.x -= 1.45 * vn * res.normalX;
          d.vel.z -= 1.45 * vn * res.normalZ;
        }
      }

      if (d.object.position.y <= 0.14) {
        d.object.position.y = 0.14;
        if (d.vel.y < -1.4) {
          d.vel.y = -d.vel.y * 0.36;
        } else {
          d.vel.y = 0;
        }
        const groundDamp = Math.exp(-5.8 * dt);
        d.vel.x *= groundDamp;
        d.vel.z *= groundDamp;
        d.angVel.multiplyScalar(Math.exp(-6.5 * dt));
      }

      d.object.rotation.x += d.angVel.x * dt;
      d.object.rotation.y += d.angVel.y * dt;
      d.object.rotation.z += d.angVel.z * dt;
    }
  }

  public dispose(): void {
    for (const d of this.debris) {
      this.scene.remove(d.object);
    }
    this.debris = [];
    this.cooldowns.clear();
  }
}
