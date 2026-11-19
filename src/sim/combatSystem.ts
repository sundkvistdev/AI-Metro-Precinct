import * as THREE from 'three';
import { CustomMapAsset, EngineConfigAsset } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { StaticObstacleBVH } from './bvh';
import { playBoundAudioEvent } from './eventBindings';
import { applyRigidHumanoidPose } from './humanoidAnim';
import { getSurfaceHeight, WorldConfig } from './roadGraph';
import {
  ActiveCrime,
  AssailantActor,
  BulletTracer,
  CivilianVehicle,
  OfficerActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { PoliceVehicleKind, UnitStatus, WeaponKind } from './types';
import { SimVfxManager, stepRagdollPhysics, triggerRagdoll } from './vfx';

export interface VehicleHumanoidCollider {
  id: string;
  kind: 'police' | 'civilian' | 'getaway';
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  halfW: number;
  halfL: number;
}

const _vDir = new THREE.Vector3();
const _vLook = new THREE.Vector3();

export type WeaponsConfig = EngineConfigAsset['weapons'];
export type ChassisConfigMap = EngineConfigAsset['vehicles']['chassis'];

function segmentHitsHumanoid(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  targetPos: THREE.Vector3,
  radius: number,
  height: number,
): { hit: boolean; t: number; hitY: number } {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const fx = p0.x - targetPos.x;
  const fz = p0.z - targetPos.z;

  const a = dx * dx + dz * dz;
  if (a < 1e-8) {
    const distSq = fx * fx + fz * fz;
    const minY = targetPos.y;
    const maxY = targetPos.y + height;
    const inY = p0.y >= minY && p0.y <= maxY;
    return { hit: distSq <= radius * radius && inY, t: 0, hitY: p0.y };
  }

  let t = -(fx * dx + fz * dz) / a;
  t = Math.max(0, Math.min(1, t));
  const cx = p0.x + dx * t - targetPos.x;
  const cz = p0.z + dz * t - targetPos.z;
  const distSq = cx * cx + cz * cz;
  if (distSq > radius * radius) {
    return { hit: false, t: 1, hitY: 0 };
  }
  const hitY = p0.y + (p1.y - p0.y) * t;
  if (hitY < targetPos.y + 0.05 || hitY > targetPos.y + height) {
    return { hit: false, t: 1, hitY: 0 };
  }
  return { hit: true, t, hitY };
}

function segmentHitsVehicleOBB(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  vehPos: THREE.Vector3,
  vehYaw: number,
  halfW: number,
  halfL: number,
  height: number,
): { hit: boolean; t: number; hitX: number; hitY: number; hitZ: number } {
  const midY = (p0.y + p1.y) * 0.5;
  if (Math.min(p0.y, p1.y) > vehPos.y + height || Math.max(p0.y, p1.y) < vehPos.y + 0.12) {
    return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  }

  const cosY = Math.cos(vehYaw);
  const sinY = Math.sin(vehYaw);

  const toLocalX = (wx: number, wz: number) => (wx - vehPos.x) * cosY - (wz - vehPos.z) * sinY;
  const toLocalZ = (wx: number, wz: number) => (wx - vehPos.x) * sinY + (wz - vehPos.z) * cosY;

  const lx0 = toLocalX(p0.x, p0.z);
  const lz0 = toLocalZ(p0.x, p0.z);
  const lx1 = toLocalX(p1.x, p1.z);
  const lz1 = toLocalZ(p1.x, p1.z);

  const dx = lx1 - lx0;
  const dz = lz1 - lz0;

  let tmin = 0;
  let tmax = 1;

  if (Math.abs(dx) < 1e-6) {
    if (lx0 < -halfW || lx0 > halfW) return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  } else {
    let t1 = (-halfW - lx0) / dx;
    let t2 = (halfW - lx0) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  }

  if (Math.abs(dz) < 1e-6) {
    if (lz0 < -halfL || lz0 > halfL) return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  } else {
    let t1 = (-halfL - lz0) / dz;
    let t2 = (halfL - lz0) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  }

  const hitY = THREE.MathUtils.lerp(p0.y, p1.y, tmin);
  if (hitY < vehPos.y + 0.1 || hitY > vehPos.y + height) {
    return { hit: false, t: 1, hitX: 0, hitY: 0, hitZ: 0 };
  }

  return {
    hit: true,
    t: tmin,
    hitX: THREE.MathUtils.lerp(p0.x, p1.x, tmin),
    hitY: Math.max(vehPos.y + 0.35, midY),
    hitZ: THREE.MathUtils.lerp(p0.z, p1.z, tmin),
  };
}

export class CombatSystem {
  private tracersGroup: THREE.Group;
  private rng: () => number;
  private vfx: SimVfxManager;
  private tracers: BulletTracer[] = [];

  private config: EngineConfigAsset | null = null;
  private weapons: WeaponsConfig | null = null;
  private world: WorldConfig | null = null;
  private map: CustomMapAsset | null = null;
  private chassis: ChassisConfigMap | null = null;

  private pistolTracerGeo = new THREE.BoxGeometry(0.055, 0.055, 1.35);
  private rifleTracerGeo = new THREE.BoxGeometry(0.065, 0.065, 2.05);
  private policeTracerMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private rifleTracerMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd });
  private suspectTracerMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });

  constructor(tracersGroup: THREE.Group, rng: () => number, vfx: SimVfxManager) {
    this.tracersGroup = tracersGroup;
    this.rng = rng;
    this.vfx = vfx;
  }

  public configure(config: EngineConfigAsset, map?: CustomMapAsset): void {
    this.config = config;
    this.weapons = config.weapons;
    this.world = config.world;
    this.map = map ?? null;
    this.chassis = config.vehicles.chassis;
  }

  private get surfaceSource(): CustomMapAsset | WorldConfig {
    return this.map ?? this.world!;
  }

  private get mapHalfSize(): number {
    return this.map?.bounds.halfSize ?? this.world?.townHalfSize ?? 150;
  }

  public clearTracers(): void {
    for (const tr of this.tracers) {
      this.tracersGroup.remove(tr.mesh);
    }
    this.tracers.length = 0;
  }

  public resolveVehicleHumanoidCollisions(
    vehicles: VehicleHumanoidCollider[],
    pedestrians: PedestrianActor[],
    officers: OfficerActor[],
    assailants: AssailantActor[],
    staticBvh: StaticObstacleBVH,
    audio: JsonAudioSynth | null,
    onPedCasualty?: () => void,
    onSuspectNeutralized?: (assailant: AssailantActor) => void,
    onVehicleHitHumanoid?: (veh: VehicleHumanoidCollider, hitPos: THREE.Vector3) => void,
  ): void {
    if (!this.world && !this.map) return;
    const surface = this.surfaceSource;
    const humRadius = 0.44;

    const testHitAndPush = (
      hPos: THREE.Vector3,
      v: VehicleHumanoidCollider,
    ): { hit: boolean; pushX: number; pushZ: number } => {
      const dx = hPos.x - v.pos.x;
      const dz = hPos.z - v.pos.z;
      const maxR = v.halfL + humRadius + 0.65;
      if (dx * dx + dz * dz > maxR * maxR) {
        return { hit: false, pushX: 0, pushZ: 0 };
      }

      const cosY = Math.cos(v.yaw);
      const sinY = Math.sin(v.yaw);
      const lx = dx * cosY - dz * sinY;
      const lz = dx * sinY + dz * cosY;

      const extW = v.halfW + humRadius;
      const extL = v.halfL + humRadius;
      if (Math.abs(lx) >= extW || Math.abs(lz) >= extL) {
        return { hit: false, pushX: 0, pushZ: 0 };
      }

      const penX = extW - Math.abs(lx);
      const penZ = extL - Math.abs(lz);
      let lnx = 0;
      let lnz = 0;
      let pen = 0;
      if (penX < penZ) {
        lnx = lx >= 0 ? 1 : -1;
        pen = penX + 0.04;
      } else {
        lnz = lz >= 0 ? 1 : -1;
        pen = penZ + 0.04;
      }

      const pushX = lnx * cosY + lnz * sinY;
      const pushZ = -lnx * sinY + lnz * cosY;
      hPos.x += pushX * pen;
      hPos.z += pushZ * pen;
      staticBvh.resolveCircle(hPos, 0.45);
      return { hit: true, pushX, pushZ };
    };

    for (const v of vehicles) {
      const fwdX = Math.sin(v.yaw);
      const fwdZ = Math.cos(v.yaw);

      // 1) Pedestrians
      for (const ped of pedestrians) {
        const res = testHitAndPush(ped.pos, v);
        if (!res.hit) continue;

        if (!ped.dead && !ped.ragdoll.active && v.speed >= 1.1) {
          const dmg = v.speed >= 8.5 ? 120 : (v.speed - 0.8) * 14.5;
          ped.hp = Math.max(0, ped.hp - dmg);
          const diedNow = ped.hp <= 0;
          ped.injured = ped.hp > 0 && ped.hp < ped.maxHp;
          ped.dead = diedNow;
          if (diedNow) {
            onPedCasualty?.();
          }

          const knockSpd = Math.min(14.5, v.speed * 0.78);
          triggerRagdoll(
            ped.ragdoll,
            this.rng,
            fwdX * knockSpd + res.pushX * 3.6,
            3.2 + Math.min(3.8, v.speed * 0.18),
            fwdZ * knockSpd + res.pushZ * 3.6,
            diedNow ? 9999 : 4.5,
          );
          this.vfx.spawnBloodImpact(
            ped.pos.x,
            ped.pos.y + 0.85,
            ped.pos.z,
            fwdX,
            fwdZ,
            Math.min(1.5, v.speed / 8.5),
            diedNow || v.speed > 5.0,
          );
          playBoundAudioEvent(audio, this.config, 'ped_impact', ped.pos);
          ped.panicTimer = 10.0;
        }
        if (v.speed >= 2.2) {
          onVehicleHitHumanoid?.(v, ped.pos);
        }
        if (!ped.ragdoll.active) {
          ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z, surface) + ped.jumpY;
          ped.rig.root.position.copy(ped.pos);
        }
      }

      // 2) Dismounted Police Officers (both unit-assigned & standalone)
      for (const off of officers) {
        if (off.boardingState !== 'dismounted' || off.mountPhase === 'boarding') continue;
        const res = testHitAndPush(off.pos, v);
        if (!res.hit) continue;

        if (off.hp > 0 && !off.ragdoll.active && v.speed >= 1.25) {
          const dmg = v.speed >= 10.5 ? 100 : (v.speed - 0.9) * 9.5;
          off.hp = Math.max(0, off.hp - dmg);
          off.morale = Math.max(0, off.morale - 36);
          const died = off.hp <= 0;
          const knockSpd = Math.min(13, v.speed * 0.72);
          triggerRagdoll(
            off.ragdoll,
            this.rng,
            fwdX * knockSpd + res.pushX * 3.4,
            2.8 + Math.min(3.4, v.speed * 0.16),
            fwdZ * knockSpd + res.pushZ * 3.4,
            died ? 9999 : 3.2,
          );
          this.vfx.spawnBloodImpact(
            off.pos.x,
            off.pos.y + 0.85,
            off.pos.z,
            fwdX,
            fwdZ,
            Math.min(1.4, v.speed / 9),
            died || v.speed > 5.5,
          );
          playBoundAudioEvent(audio, this.config, 'ped_impact', off.pos);

          if (died) {
            if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
            if (off.unitId) {
              for (const partner of officers) {
                if (partner.unitId === off.unitId && partner !== off && partner.hp > 0) {
                  partner.morale = Math.max(0, partner.morale - (partner.isHeavy ? 14 : 40));
                }
              }
            }
          }
        }
        if (v.speed >= 2.2) {
          onVehicleHitHumanoid?.(v, off.pos);
        }
        if (!off.ragdoll.active) {
          off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, surface);
          off.rig.root.position.copy(off.pos);
        }
      }

      // 3) Foot Assailants (crime-linked & standalone)
      for (const as of assailants) {
        if (!as.alive || as.inVehicle) continue;
        const res = testHitAndPush(as.pos, v);
        if (!res.hit) continue;

        if (!as.ragdoll.active && v.speed >= 1.15) {
          const dmg = v.speed >= 9.0 ? 130 : (v.speed - 0.8) * 12.5;
          as.hp = Math.max(0, as.hp - dmg);
          const knockedOut = as.hp <= 0;
          const knockSpd = Math.min(14, v.speed * 0.76);

          if (knockedOut) {
            as.alive = false;
            onSuspectNeutralized?.(as);
            if (as.rig.threatRing) as.rig.threatRing.visible = false;
            if (as.rig.muzzleFlash) as.rig.muzzleFlash.visible = false;
          }
          triggerRagdoll(
            as.ragdoll,
            this.rng,
            fwdX * knockSpd + res.pushX * 3.5,
            3.0 + Math.min(3.5, v.speed * 0.17),
            fwdZ * knockSpd + res.pushZ * 3.5,
            knockedOut ? 9999 : 2.6,
          );
          this.vfx.spawnBloodImpact(
            as.pos.x,
            as.pos.y + 0.85,
            as.pos.z,
            fwdX,
            fwdZ,
            Math.min(1.5, v.speed / 8.5),
            knockedOut || v.speed > 5.0,
          );
          playBoundAudioEvent(audio, this.config, 'ped_impact', as.pos);
        }
        if (!as.ragdoll.active) {
          as.pos.y = getSurfaceHeight(as.pos.x, as.pos.z, surface);
          as.rig.root.position.copy(as.pos);
        }
      }
    }
  }

  public resolveHumanoidMutualCollisions(
    pedestrians: PedestrianActor[],
    officers: OfficerActor[],
    assailants: AssailantActor[],
    staticBvh: StaticObstacleBVH,
  ): void {
    if (!this.world && !this.map) return;
    const surface = this.surfaceSource;
    const entries: Array<{ pos: THREE.Vector3; root: THREE.Object3D; mobile: boolean; yAdd: number }> = [];

    for (const p of pedestrians) {
      entries.push({
        pos: p.pos,
        root: p.rig.root,
        mobile: !p.dead && !p.ragdoll.active,
        yAdd: p.jumpY,
      });
    }
    for (const o of officers) {
      if (o.boardingState !== 'dismounted' || o.mountPhase === 'boarding') continue;
      entries.push({
        pos: o.pos,
        root: o.rig.root,
        mobile: o.hp > 0 && !o.ragdoll.active,
        yAdd: 0,
      });
    }
    for (const a of assailants) {
      if (a.inVehicle) continue;
      entries.push({
        pos: a.pos,
        root: a.rig.root,
        mobile: a.alive && !a.ragdoll.active,
        yAdd: 0,
      });
    }

    const minDist = 0.82;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (!a.mobile && !b.mobile) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDistSq) continue;

        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = minDist - dist;

        if (a.mobile && b.mobile) {
          a.pos.x -= nx * push * 0.5;
          a.pos.z -= nz * push * 0.5;
          b.pos.x += nx * push * 0.5;
          b.pos.z += nz * push * 0.5;
          staticBvh.resolveCircle(a.pos, 0.44);
          staticBvh.resolveCircle(b.pos, 0.44);
          a.pos.y = getSurfaceHeight(a.pos.x, a.pos.z, surface) + a.yAdd;
          b.pos.y = getSurfaceHeight(b.pos.x, b.pos.z, surface) + b.yAdd;
          a.root.position.copy(a.pos);
          b.root.position.copy(b.pos);
        } else if (a.mobile) {
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          staticBvh.resolveCircle(a.pos, 0.44);
          a.pos.y = getSurfaceHeight(a.pos.x, a.pos.z, surface) + a.yAdd;
          a.root.position.copy(a.pos);
        } else {
          b.pos.x += nx * push;
          b.pos.z += nz * push;
          staticBvh.resolveCircle(b.pos, 0.44);
          b.pos.y = getSurfaceHeight(b.pos.x, b.pos.z, surface) + b.yAdd;
          b.root.position.copy(b.pos);
        }
      }
    }
  }

  public updateOfficerCombat(
    off: OfficerActor,
    idx: number,
    targetAssailant: AssailantActor,
    anchorPos: THREE.Vector3 | null,
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    pedestrians: PedestrianActor[],
    audio: JsonAudioSynth | null,
    dt: number,
  ): void {
    if (!this.weapons || (!this.world && !this.map)) return;
    const world = this.surfaceSource;

    if (off.hp <= 0) {
      if (off.ragdoll.active) {
        stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
      } else {
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world) + 0.16;
        off.rig.root.position.copy(off.pos);
        off.rig.root.rotation.set(Math.PI * 0.5, off.yaw, 0);
        applyRigidHumanoidPose(off.rig, 'dead_flat', { snap: true });
      }
      if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
      return;
    }

    if (off.ragdoll.active) {
      stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
      off.ragdoll.recoverTimer -= dt;
      if (off.ragdoll.recoverTimer <= 0) {
        off.ragdoll.active = false;
        off.hp = Math.max(off.hp, 35);
        off.morale = off.isHeavy ? 65 : 15;
        off.cowardiceState = off.isHeavy ? 'steady' : 'fleeing';
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
        off.rig.root.rotation.set(0, off.yaw, 0);
        applyRigidHumanoidPose(off.rig, 'idle', { snap: true });
      }
      return;
    }

    const dx = targetAssailant.pos.x - off.pos.x;
    const dz = targetAssailant.pos.z - off.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist;
    const uz = dz / dist;

    const effectiveCowardice = off.isHeavy ? cowardiceLevel * 0.2 : cowardiceLevel;
    if (effectiveCowardice > 0.4 && dist < 13) {
      off.morale = Math.max(0, off.morale - effectiveCowardice * 7.0 * dt);
    } else if (off.cowardiceState === 'steady') {
      off.morale = Math.min(100, off.morale + (off.isHeavy ? 4.0 : 1.8) * dt);
    }

    if (off.isHeavy) {
      off.cowardiceState = off.morale < 30 ? 'suppressed' : 'steady';
    } else {
      if (off.morale < 25) off.cowardiceState = 'fleeing';
      else if (off.morale < 52) off.cowardiceState = 'suppressed';
      else off.cowardiceState = 'steady';
    }

    if (off.cowardiceState === 'fleeing') {
      let dirX = -ux;
      let dirZ = -uz;
      if (anchorPos) {
        const fleeDx = anchorPos.x - off.pos.x;
        const fleeDz = anchorPos.z - off.pos.z;
        const fleeDist = Math.hypot(fleeDx, fleeDz);
        if (fleeDist > 1.8) {
          dirX = fleeDx / fleeDist;
          dirZ = fleeDz / fleeDist;
        }
      }
      off.yaw = Math.atan2(dirX, dirZ);
      off.pos.x += dirX * 5.8 * dt;
      off.pos.z += dirZ * 5.8 * dt;
      staticBvh.resolveCircle(off.pos, 0.48);
      off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);

      off.walkPhase += dt * 15;
      applyRigidHumanoidPose(off.rig, 'run', { phase: off.walkPhase, dt });
      if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;

      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.set(0, off.yaw, 0);
      return;
    }

    off.yaw = Math.atan2(ux, uz);
    const hasLos = staticBvh.raycastSegment(
      off.pos.x,
      off.pos.z,
      targetAssailant.pos.x,
      targetAssailant.pos.z,
    ).clear;

    off.strafeTimer -= dt;
    if (off.strafeTimer <= 0) {
      off.strafeTimer = 1.6 + this.rng() * 1.4;
      off.strafeSign = off.strafeSign === 1 ? -1 : 1;
    }

    const perpX = -uz * (idx % 2 === 0 ? 1 : -1) * off.strafeSign;
    const perpZ = ux * (idx % 2 === 0 ? 1 : -1) * off.strafeSign;

    let moveX = 0;
    let moveZ = 0;
    let moving = false;
    const isSuppressed = off.cowardiceState === 'suppressed';
    const preferredRange =
      off.weaponKind === 'rifle' ? (idx % 2 === 0 ? 14.5 : 17.5) : idx % 2 === 0 ? 9.5 : 12.0;

    if (isSuppressed) {
      if (dist < 19) {
        moveX = -ux * 0.8 + perpX * 0.45;
        moveZ = -uz * 0.8 + perpZ * 0.45;
        moving = true;
      }
    } else {
      if (!hasLos) {
        moveX = ux * 0.45 + perpX * 0.88;
        moveZ = uz * 0.45 + perpZ * 0.88;
        moving = true;
      } else if (dist > preferredRange) {
        moveX = ux * 0.88 + perpX * 0.35;
        moveZ = uz * 0.88 + perpZ * 0.35;
        moving = true;
      } else if (dist < 6.0) {
        moveX = -ux * 0.6 + perpX * 0.6;
        moveZ = -uz * 0.6 + perpZ * 0.6;
        moving = true;
      } else if (off.reloadTimer > 0) {
        moveX = perpX * 0.65;
        moveZ = perpZ * 0.65;
        moving = true;
      }
    }

    if (moving) {
      const mLen = Math.hypot(moveX, moveZ) || 1;
      const moveSpd = isSuppressed ? 3.8 : !hasLos ? 5.6 : off.isHeavy ? 4.2 : 4.7;
      off.pos.x += (moveX / mLen) * moveSpd * dt;
      off.pos.z += (moveZ / mLen) * moveSpd * dt;
      staticBvh.resolveCircle(off.pos, 0.48);
      off.walkPhase += dt * 11;
    }

    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);

    const spec = this.weapons[off.weaponKind];
    if (off.reloadTimer > 0) {
      off.reloadTimer -= dt;
      if (off.reloadTimer <= 0) off.ammo = spec.magSize;
    } else if (!isSuppressed) {
      off.recoilKick = THREE.MathUtils.damp(off.recoilKick, 0, 16, dt);
    }

    const combatPoseMode =
      off.reloadTimer > 0
        ? 'reload'
        : isSuppressed
        ? 'suppressed'
        : off.weaponKind === 'rifle'
        ? 'aim_rifle'
        : 'aim_pistol';
    applyRigidHumanoidPose(off.rig, combatPoseMode, {
      phase: moving ? off.walkPhase : 0,
      dt,
      recoilKick: off.recoilKick,
      snap: !moving && off.reloadTimer <= 0 && !isSuppressed && off.recoilKick < 0.01 ? false : false,
    });
    if (!moving) {
      off.rig.leftLeg.rotation.x = THREE.MathUtils.damp(off.rig.leftLeg.rotation.x, 0, 12, dt);
      off.rig.rightLeg.rotation.x = THREE.MathUtils.damp(off.rig.rightLeg.rotation.x, 0, 12, dt);
    }

    if (off.muzzleTimer > 0) {
      off.muzzleTimer -= dt;
      if (off.muzzleTimer <= 0 && off.rig.muzzleFlash) {
        off.rig.muzzleFlash.visible = false;
      }
    }

    off.fireCooldown -= dt;
    const canFire =
      hasLos &&
      dist < spec.maxRange &&
      off.reloadTimer <= 0 &&
      off.fireCooldown <= 0 &&
      (!isSuppressed || this.rng() < 0.35);

    if (canFire) {
      off.fireCooldown = isSuppressed
        ? 0.85 + this.rng() * 0.6
        : spec.cooldownMin + this.rng() * spec.cooldownJitter;
      off.muzzleTimer = 0.06;
      off.recoilKick = off.weaponKind === 'rifle' ? 0.19 : 0.26;
      off.ammo--;
      if (off.ammo <= 0) off.reloadTimer = spec.reloadTime;

      if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = true;

      const movingPenalty = moving ? 0.038 : 0;
      const spread = (isSuppressed ? spec.suppressedSpreadRad : spec.baseSpreadRad) + movingPenalty;
      const dmg = spec.minDmg + this.rng() * (spec.maxDmg - spec.minDmg);
      const muzzleAdvance = off.weaponKind === 'rifle' ? 0.82 : 0.65;

      this.spawnBallisticRound(
        off.pos.x + Math.sin(off.yaw) * muzzleAdvance,
        off.pos.y + 1.38,
        off.pos.z + Math.cos(off.yaw) * muzzleAdvance,
        targetAssailant.pos.x,
        targetAssailant.pos.y + 1.24,
        targetAssailant.pos.z,
        spread,
        off.weaponKind,
        dmg,
        spec.armorPen,
        false,
        off.unitId,
      );
      playBoundAudioEvent(
        audio,
        this.config,
        off.weaponKind === 'rifle' ? 'weapon_fire_rifle' : 'weapon_fire_pistol',
        off.pos,
      );

      for (const ped of pedestrians) {
        if (ped.pos.distanceToSquared(off.pos) < 42 * 42) {
          ped.panicTimer = 6.5;
        }
      }
    }

    off.rig.root.position.copy(off.pos);
    off.rig.root.rotation.y = off.yaw;
  }

  public updateOfficerFreeRoam(
    off: OfficerActor,
    idx: number,
    anchorPos: THREE.Vector3 | null,
    staticBvh: StaticObstacleBVH,
    dt: number,
  ): void {
    if (!this.world && !this.map) return;
    const world = this.surfaceSource;
    const roamBound = Math.max(120, this.mapHalfSize - 36);

    if (off.hp <= 0) {
      if (off.ragdoll.active) {
        stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
      } else {
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world) + 0.16;
        off.rig.root.position.copy(off.pos);
        off.rig.root.rotation.set(Math.PI * 0.5, off.yaw, 0);
        applyRigidHumanoidPose(off.rig, 'dead_flat', { snap: true });
      }
      return;
    }

    if (off.ragdoll.active) {
      stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, world, dt);
      off.ragdoll.recoverTimer -= dt;
      if (off.ragdoll.recoverTimer <= 0) {
        off.ragdoll.active = false;
        off.hp = off.maxHp;
        off.morale = 85;
        off.cowardiceState = 'steady';
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
        off.rig.root.rotation.set(0, off.yaw, 0);
        applyRigidHumanoidPose(off.rig, 'idle', { snap: true });
      }
      return;
    }

    off.morale = Math.min(100, off.morale + 5.5 * dt);
    off.cowardiceState = 'steady';
    if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;

    if (off.roamPauseTimer > 0) {
      off.roamPauseTimer -= dt;
      off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
      applyRigidHumanoidPose(off.rig, 'idle', {
        dt,
        headLookYaw: Math.sin(off.roamPauseTimer * 2.2 + idx) * 0.35,
      });
      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.set(0, off.yaw, 0);
      return;
    }

    off.roamTimer -= dt;
    if (!off.roamTarget || off.roamTimer <= 0) {
      const baseAnchorX = anchorPos ? anchorPos.x : off.pos.x;
      const baseAnchorZ = anchorPos ? anchorPos.z : off.pos.z;
      const anchorX = THREE.MathUtils.lerp(off.pos.x, baseAnchorX, 0.2);
      const anchorZ = THREE.MathUtils.lerp(off.pos.z, baseAnchorZ, 0.2);
      let picked: THREE.Vector3 | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const rad = 14 + this.rng() * 26;
        const cx = THREE.MathUtils.clamp(anchorX + Math.cos(ang) * rad, -roamBound, roamBound);
        const cz = THREE.MathUtils.clamp(anchorZ + Math.sin(ang) * rad, -roamBound, roamBound);
        const cand = new THREE.Vector3(cx, getSurfaceHeight(cx, cz, world), cz);
        staticBvh.resolveCircle(cand, 0.65);
        cand.y = getSurfaceHeight(cand.x, cand.z, world);
        if (cand.distanceToSquared(off.pos) > 8 * 8) {
          picked = cand;
          break;
        }
      }
      const fbX = THREE.MathUtils.clamp(
        off.pos.x + (idx % 2 === 0 ? 12 : -12),
        -roamBound + 4,
        roamBound - 4,
      );
      const fbZ = THREE.MathUtils.clamp(off.pos.z + 10, -roamBound + 4, roamBound - 4);
      off.roamTarget = picked ?? new THREE.Vector3(fbX, getSurfaceHeight(fbX, fbZ, world), fbZ);
      off.roamTimer = 7 + this.rng() * 5;
    }

    const dx = off.roamTarget.x - off.pos.x;
    const dz = off.roamTarget.z - off.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.1) {
      off.roamTarget = null;
      off.roamPauseTimer = 1.0 + this.rng() * 1.6;
    } else {
      const spd = 2.45;
      const ux = dx / dist;
      const uz = dz / dist;
      const prevX = off.pos.x;
      const prevZ = off.pos.z;

      off.pos.x += ux * spd * dt;
      off.pos.z += uz * spd * dt;
      staticBvh.resolveCircle(off.pos, 0.48);

      const moved = Math.hypot(off.pos.x - prevX, off.pos.z - prevZ);
      if (moved < spd * dt * 0.25) {
        const slideSign = idx % 2 === 0 ? 1 : -1;
        off.pos.x += -uz * slideSign * spd * dt;
        off.pos.z += ux * slideSign * spd * dt;
        staticBvh.resolveCircle(off.pos, 0.48);
        if (Math.hypot(off.pos.x - prevX, off.pos.z - prevZ) < spd * dt * 0.15) {
          off.roamTarget = null;
        }
      }

      const stepDx = off.pos.x - prevX;
      const stepDz = off.pos.z - prevZ;
      off.yaw =
        stepDx * stepDx + stepDz * stepDz > 1e-6
          ? Math.atan2(stepDx, stepDz)
          : Math.atan2(ux, uz);

      off.walkPhase += dt * 7.5;
      applyRigidHumanoidPose(off.rig, 'walk', { phase: off.walkPhase, dt });
    }

    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, world);
    off.rig.root.position.copy(off.pos);
    off.rig.root.rotation.set(0, off.yaw, 0);
  }

  public updateAssailantCombat(
    assailant: AssailantActor,
    officers: OfficerActor[],
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    audio: JsonAudioSynth | null,
    simTime: number,
    dt: number,
  ): void {
    if (!this.weapons || (!this.world && !this.map)) return;
    const world = this.surfaceSource;
    const roamBound = Math.max(120, this.mapHalfSize - 35);

    if (assailant.muzzleTimer > 0) {
      assailant.muzzleTimer -= dt;
      if (assailant.muzzleTimer <= 0 && assailant.rig.muzzleFlash) {
        assailant.rig.muzzleFlash.visible = false;
      }
    }

    if (assailant.rig.threatRing) {
      assailant.rig.threatRing.visible = assailant.alive && !assailant.inVehicle;
      if (assailant.rig.threatRing.visible) {
        const s = 1 + Math.sin(simTime * 5) * 0.12;
        assailant.rig.threatRing.scale.set(s, s, 1);
      }
    }

    if (assailant.inVehicle) return;

    if (!assailant.alive) {
      if (assailant.ragdoll.active) {
        stepRagdollPhysics(assailant.ragdoll, assailant.pos, assailant.rig, staticBvh, world, dt);
      } else {
        assailant.pos.y = getSurfaceHeight(assailant.pos.x, assailant.pos.z, world) + 0.16;
        assailant.rig.root.position.copy(assailant.pos);
        assailant.rig.root.rotation.set(Math.PI * 0.5, assailant.yaw, 0);
        applyRigidHumanoidPose(assailant.rig, 'dead_flat', { snap: true });
      }
      return;
    }

    if (assailant.ragdoll.active) {
      stepRagdollPhysics(assailant.ragdoll, assailant.pos, assailant.rig, staticBvh, world, dt);
      assailant.ragdoll.recoverTimer -= dt;
      if (assailant.ragdoll.recoverTimer <= 0 && assailant.alive) {
        assailant.ragdoll.active = false;
        assailant.pos.y = getSurfaceHeight(assailant.pos.x, assailant.pos.z, world);
        assailant.rig.root.rotation.set(0, assailant.yaw, 0);
        applyRigidHumanoidPose(assailant.rig, 'idle', { snap: true });
      }
      return;
    }

    let targetOfficer: OfficerActor | null = null;
    let minD = Infinity;
    for (const o of officers) {
      if (o.boardingState !== 'dismounted' || o.hp <= 0 || o.ragdoll.active) continue;
      const d = o.pos.distanceToSquared(assailant.pos);
      if (d < minD) {
        minD = d;
        targetOfficer = o;
      }
    }

    assailant.pos.y = getSurfaceHeight(assailant.pos.x, assailant.pos.z, world);

    if (targetOfficer && minD < 44 * 44) {
      const dx = targetOfficer.pos.x - assailant.pos.x;
      const dz = targetOfficer.pos.z - assailant.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist;
      const uz = dz / dist;
      const hasLos = staticBvh.raycastSegment(
        assailant.pos.x,
        assailant.pos.z,
        targetOfficer.pos.x,
        targetOfficer.pos.z,
      ).clear;

      assailant.yaw = Math.atan2(ux, uz);
      assailant.rig.root.rotation.y = assailant.yaw;

      assailant.moveTimer -= dt;
      if (assailant.moveTimer <= 0) {
        assailant.moveTimer = 1.4 + this.rng() * 1.6;
        assailant.strafeDir = assailant.strafeDir === 1 ? -1 : 1;
      }
      const perpX = -uz * assailant.strafeDir;
      const perpZ = ux * assailant.strafeDir;
      let moveX = perpX * 0.85;
      let moveZ = perpZ * 0.85;
      if (dist < 7.5) {
        moveX -= ux * 0.7;
        moveZ -= uz * 0.7;
      } else if (!hasLos) {
        moveX += ux * 0.35;
        moveZ += uz * 0.35;
      }
      const mLen = Math.hypot(moveX, moveZ) || 1;
      const spd = assailant.hp < 45 ? 4.4 : 3.2;
      assailant.pos.x += (moveX / mLen) * spd * dt;
      assailant.pos.z += (moveZ / mLen) * spd * dt;
      staticBvh.resolveCircle(assailant.pos, 0.5);
      assailant.pos.x = THREE.MathUtils.clamp(assailant.pos.x, -roamBound, roamBound);
      assailant.pos.z = THREE.MathUtils.clamp(assailant.pos.z, -roamBound, roamBound);
      assailant.pos.y = getSurfaceHeight(assailant.pos.x, assailant.pos.z, world);
      assailant.rig.root.position.copy(assailant.pos);

      assailant.walkPhase += dt * 9;
      const sSpec = this.weapons[assailant.weaponKind];
      if (assailant.reloadTimer > 0) {
        assailant.reloadTimer -= dt;
        if (assailant.reloadTimer <= 0) assailant.ammo = sSpec.magSize;
      } else {
        assailant.recoilKick = THREE.MathUtils.damp(assailant.recoilKick, 0, 14, dt);
      }
      applyRigidHumanoidPose(
        assailant.rig,
        assailant.reloadTimer > 0
          ? 'reload'
          : assailant.weaponKind === 'rifle'
          ? 'aim_rifle'
          : 'aim_pistol',
        { phase: assailant.walkPhase, dt, recoilKick: assailant.recoilKick },
      );

      assailant.fireCooldown -= dt;
      if (hasLos && assailant.reloadTimer <= 0 && assailant.fireCooldown <= 0) {
        assailant.fireCooldown =
          assailant.weaponKind === 'rifle'
            ? 0.28 + this.rng() * 0.28
            : 0.52 + this.rng() * 0.46;
        assailant.muzzleTimer = 0.06;
        assailant.recoilKick = 0.25;
        assailant.ammo--;
        if (assailant.ammo <= 0) assailant.reloadTimer = sSpec.reloadTime;

        if (assailant.rig.muzzleFlash) assailant.rig.muzzleFlash.visible = true;
        const dmg = sSpec.minDmg + this.rng() * (sSpec.maxDmg - sSpec.minDmg);
        const spread = assailant.weaponKind === 'rifle' ? 0.068 : 0.11;

        this.spawnBallisticRound(
          assailant.pos.x + Math.sin(assailant.yaw) * 0.62,
          assailant.pos.y + 1.38,
          assailant.pos.z + Math.cos(assailant.yaw) * 0.62,
          targetOfficer.pos.x,
          targetOfficer.pos.y + 1.24,
          targetOfficer.pos.z,
          spread,
          assailant.weaponKind,
          dmg,
          sSpec.armorPen,
          true,
          null,
        );
        playBoundAudioEvent(
          audio,
          this.config,
          assailant.weaponKind === 'rifle' ? 'weapon_fire_rifle' : 'weapon_fire_suspect',
          assailant.pos,
        );

        for (const o of officers) {
          if (o.boardingState !== 'dismounted' || o.hp <= 0) continue;
          const fearResist = o.isHeavy ? 0.24 : 1.0;
          const odSq = o.pos.distanceToSquared(targetOfficer.pos);
          if (odSq < 6.5 * 6.5) {
            const fearHit =
              (12 + this.rng() * 14) * (0.35 + cowardiceLevel * 1.35) * fearResist;
            o.morale = Math.max(0, o.morale - fearHit);
          }
        }
      }
    } else if (!assailant.crimeId) {
      // Standalone spawned assailants prowl nearby until engaged
      assailant.roamTimer -= dt;
      if (!assailant.roamTarget || assailant.roamTimer <= 0) {
        const ang = this.rng() * Math.PI * 2;
        const rad = 6 + this.rng() * 14;
        const cx = THREE.MathUtils.clamp(assailant.pos.x + Math.cos(ang) * rad, -roamBound, roamBound);
        const cz = THREE.MathUtils.clamp(assailant.pos.z + Math.sin(ang) * rad, -roamBound, roamBound);
        assailant.roamTarget = new THREE.Vector3(cx, getSurfaceHeight(cx, cz, world), cz);
        assailant.roamTimer = 5 + this.rng() * 4;
      }
      const dx = assailant.roamTarget.x - assailant.pos.x;
      const dz = assailant.roamTarget.z - assailant.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.0) {
        assailant.yaw = Math.atan2(dx, dz);
        assailant.pos.x += (dx / dist) * 2.1 * dt;
        assailant.pos.z += (dz / dist) * 2.1 * dt;
        staticBvh.resolveCircle(assailant.pos, 0.5);
        assailant.walkPhase += dt * 7;
        applyRigidHumanoidPose(assailant.rig, 'walk', { phase: assailant.walkPhase, dt });
      } else {
        assailant.roamTarget = null;
        applyRigidHumanoidPose(assailant.rig, 'idle', { dt });
      }
      assailant.pos.y = getSurfaceHeight(assailant.pos.x, assailant.pos.z, world);
      assailant.rig.root.position.copy(assailant.pos);
      assailant.rig.root.rotation.set(0, assailant.yaw, 0);
    } else {
      applyRigidHumanoidPose(assailant.rig, 'idle', { dt });
      assailant.rig.root.position.copy(assailant.pos);
    }
  }

  public spawnBallisticRound(
    x0: number,
    y0: number,
    z0: number,
    tx: number,
    ty: number,
    tz: number,
    spreadRad: number,
    weaponKind: WeaponKind,
    damage: number,
    armorPen: number,
    isSuspect: boolean,
    shooterUnitId: string | null,
  ): void {
    if (!this.weapons) return;
    _vDir.set(tx - x0, ty - y0, tz - z0);
    const dist = _vDir.length() || 1;
    _vDir.divideScalar(dist);

    const spec = this.weapons[weaponKind];
    const flightT = dist / spec.speed;
    _vDir.y += (0.5 * spec.gravity * flightT * flightT) / dist;

    const yawJitter = ((this.rng() + this.rng()) * 0.5 - 0.5) * 2.2 * spreadRad;
    const pitchJitter = ((this.rng() + this.rng()) * 0.5 - 0.5) * 1.5 * spreadRad;

    const cosJ = Math.cos(yawJitter);
    const sinJ = Math.sin(yawJitter);
    const rx = _vDir.x * cosJ - _vDir.z * sinJ;
    const rz = _vDir.x * sinJ + _vDir.z * cosJ;
    _vDir.set(rx, _vDir.y + pitchJitter, rz).normalize();

    const mesh = new THREE.Mesh(
      weaponKind === 'rifle' ? this.rifleTracerGeo : this.pistolTracerGeo,
      isSuspect
        ? this.suspectTracerMat
        : weaponKind === 'rifle'
        ? this.rifleTracerMat
        : this.policeTracerMat,
    );
    mesh.position.set(x0, y0, z0);
    _vLook.set(x0 + _vDir.x, y0 + _vDir.y, z0 + _vDir.z);
    mesh.lookAt(_vLook);
    this.tracersGroup.add(mesh);

    this.tracers.push({
      mesh,
      prevPos: new THREE.Vector3(x0, y0, z0),
      vel: _vDir.clone().multiplyScalar(spec.speed),
      gravity: spec.gravity,
      life: 0.72,
      maxLife: 0.72,
      isSuspect,
      weaponKind,
      damage,
      armorPen,
      shooterUnitId,
    });
  }

  public updateTracers(
    crimes: ActiveCrime[],
    units: PoliceUnit[],
    officers: OfficerActor[],
    assailants: AssailantActor[],
    civilianCars: CivilianVehicle[],
    pedestrians: PedestrianActor[],
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    dt: number,
    onSuspectNeutralized: (assailant: AssailantActor) => void,
    onPedCasualty?: () => void,
  ): void {
    if ((!this.world && !this.map) || !this.chassis) return;
    const world = this.surfaceSource;

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      const age = tr.maxLife - tr.life;

      tr.prevPos.copy(tr.mesh.position);
      tr.vel.y -= tr.gravity * dt;
      tr.mesh.position.addScaledVector(tr.vel, dt);

      const p0 = tr.prevPos;
      const p1 = tr.mesh.position;

      _vLook.copy(p1).add(tr.vel);
      tr.mesh.lookAt(_vLook);

      const groundAtNext = getSurfaceHeight(p1.x, p1.z, world);
      let destroyed = tr.life <= 0 || p1.y <= groundAtNext;

      if (p1.y <= groundAtNext) {
        this.vfx.spawnImpactSparks(p1.x, groundAtNext + 0.08, p1.z, 3, 0.55);
        destroyed = true;
      }

      if (!destroyed) {
        const ray = staticBvh.raycastSegment(p0.x, p0.z, p1.x, p1.z);
        if (!ray.clear) {
          const hitY = THREE.MathUtils.lerp(p0.y, p1.y, ray.t);
          this.vfx.spawnImpactSparks(
            ray.hitX,
            Math.max(0.2, hitY),
            ray.hitZ,
            5,
            0.75,
            ray.normalX * 3,
            ray.normalZ * 3,
          );
          destroyed = true;
        }
      }

      if (!destroyed) {
        for (const u of units) {
          if (u.status === UnitStatus.AtStation) continue;
          if (tr.shooterUnitId === u.id && age < 0.035) continue;
          const vehH = this.chassis[u.vehicleKind as PoliceVehicleKind].obbHeight;
          const hit = segmentHitsVehicleOBB(p0, p1, u.pos, u.yaw, u.halfW, u.halfL, vehH);
          if (hit.hit) {
            this.vfx.spawnImpactSparks(hit.hitX, hit.hitY, hit.hitZ, 5, 0.85);
            destroyed = true;
            break;
          }
        }
      }

      if (!destroyed) {
        for (const civ of civilianCars) {
          const hit = segmentHitsVehicleOBB(p0, p1, civ.pos, civ.yaw, 0.92, 2.24, 1.55);
          if (hit.hit) {
            this.vfx.spawnImpactSparks(hit.hitX, hit.hitY, hit.hitZ, 5, 0.8);
            civ.stunTimer = Math.max(civ.stunTimer, 0.7);
            destroyed = true;
            break;
          }
        }
      }

      if (!destroyed) {
        for (const c of crimes) {
          if (c.inVehiclePursuit && c.vehicleRig) {
            const hit = segmentHitsVehicleOBB(p0, p1, c.vehiclePos, c.vehicleYaw, 0.92, 2.24, 1.55);
            if (hit.hit) {
              this.vfx.spawnImpactSparks(hit.hitX, hit.hitY, hit.hitZ, 6, 0.9);
              c.vehicleHp = Math.max(0, c.vehicleHp - (tr.weaponKind === 'rifle' ? 7 : 3));
              destroyed = true;
              break;
            }
          }
        }
      }

      if (!destroyed && !tr.isSuspect) {
        for (const as of assailants) {
          if (!as.alive || as.inVehicle) continue;
          const hit = segmentHitsHumanoid(p0, p1, as.pos, 0.56, 1.88);
          if (hit.hit) {
            const vLen = Math.hypot(tr.vel.x, tr.vel.z) || 1;
            const dirX = tr.vel.x / vLen;
            const dirZ = tr.vel.z / vLen;

            let dmg = tr.damage;
            if (as.armor > 0) {
              const absorbShare = 0.52 * (1 - tr.armorPen * 0.65);
              const absorbed = Math.min(as.armor, dmg * absorbShare);
              as.armor = Math.max(0, as.armor - absorbed);
              dmg -= absorbed;
              this.vfx.spawnImpactSparks(
                as.pos.x,
                hit.hitY,
                as.pos.z,
                4,
                0.7,
                -dirX * 3,
                -dirZ * 3,
              );
            } else {
              this.vfx.spawnImpactSparks(as.pos.x, hit.hitY, as.pos.z, 2, 0.45);
            }

            const finalDmg = Math.max(4, dmg);
            as.hp = Math.max(0, as.hp - finalDmg);
            as.lastHitDir.set(dirX, 0, dirZ);

            this.vfx.spawnBloodImpact(
              as.pos.x,
              hit.hitY,
              as.pos.z,
              dirX,
              dirZ,
              Math.min(1.5, finalDmg / 18),
              as.hp <= 0 || finalDmg > 15,
            );

            if (as.hp <= 0 && as.alive) {
              as.alive = false;
              onSuspectNeutralized(as);
              if (as.rig.threatRing) as.rig.threatRing.visible = false;
              if (as.rig.muzzleFlash) as.rig.muzzleFlash.visible = false;
              triggerRagdoll(
                as.ragdoll,
                this.rng,
                dirX * 6.5,
                3.4,
                dirZ * 6.5,
                999,
              );
            }
            destroyed = true;
            break;
          }
        }
      }

      if (!destroyed && tr.isSuspect) {
        for (const off of officers) {
          if (off.boardingState !== 'dismounted' || off.ragdoll.active || off.hp <= 0) continue;
          const hit = segmentHitsHumanoid(p0, p1, off.pos, 0.54, 1.84);
          if (hit.hit) {
            const vLen = Math.hypot(tr.vel.x, tr.vel.z) || 1;
            const dirX = tr.vel.x / vLen;
            const dirZ = tr.vel.z / vLen;

            let dmg = tr.damage;
            if (off.armor > 0) {
              const baseAbsorb = off.isHeavy ? 0.74 : 0.46;
              const effectiveAbsorb = Math.max(0.18, baseAbsorb * (1 - tr.armorPen * 0.45));
              const absorbed = Math.min(off.armor, dmg * effectiveAbsorb);
              off.armor = Math.max(0, off.armor - absorbed);
              dmg -= absorbed;
              this.vfx.spawnImpactSparks(
                off.pos.x,
                hit.hitY,
                off.pos.z,
                off.isHeavy ? 6 : 4,
                0.75,
                -dirX * 3.5,
                -dirZ * 3.5,
              );
            } else {
              this.vfx.spawnImpactSparks(off.pos.x, hit.hitY, off.pos.z, 2, 0.45);
            }

            const finalDmg = Math.max(3, dmg);
            off.hp = Math.max(0, off.hp - finalDmg);
            if (finalDmg > 4) {
              this.vfx.spawnBloodImpact(
                off.pos.x,
                hit.hitY,
                off.pos.z,
                dirX,
                dirZ,
                Math.min(1.3, finalDmg / 18),
                off.hp <= 0 || finalDmg > 14,
              );
            }
            const moraleShock = (off.isHeavy ? 8 : 30) * (0.45 + cowardiceLevel);
            off.morale = Math.max(0, off.morale - moraleShock);

            if (off.hp <= 0) {
              if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
              triggerRagdoll(
                off.ragdoll,
                this.rng,
                dirX * 4.8,
                2.6,
                dirZ * 4.8,
                999,
              );
              if (off.unitId) {
                for (const partner of officers) {
                  if (partner.unitId === off.unitId && partner !== off && partner.hp > 0) {
                    const partnerShock = partner.isHeavy ? 14 : 46;
                    partner.morale = Math.max(
                      0,
                      partner.morale - partnerShock * (0.4 + cowardiceLevel),
                    );
                  }
                }
              }
            }
            destroyed = true;
            break;
          }
        }
      }

      if (!destroyed) {
        for (const ped of pedestrians) {
          if (ped.ragdoll.active || ped.dead) continue;
          const hit = segmentHitsHumanoid(p0, p1, ped.pos, 0.5, 1.75);
          if (hit.hit) {
            const vLen = Math.hypot(tr.vel.x, tr.vel.z) || 1;
            ped.hp = Math.max(0, ped.hp - tr.damage);
            ped.injured = ped.hp > 0 && ped.hp < ped.maxHp;
            const died = ped.hp <= 0;
            if (died && !ped.dead) {
              ped.dead = true;
              onPedCasualty?.();
            }
            triggerRagdoll(
              ped.ragdoll,
              this.rng,
              (tr.vel.x / vLen) * 5.2,
              2.6,
              (tr.vel.z / vLen) * 5.2,
              died ? 9999 : 7.5,
            );
            ped.panicTimer = 9.0;
            this.vfx.spawnBloodImpact(
              ped.pos.x,
              hit.hitY,
              ped.pos.z,
              tr.vel.x / vLen,
              tr.vel.z / vLen,
              1.0,
              true,
            );
            destroyed = true;
            break;
          }
        }
      }

      if (destroyed) {
        this.tracersGroup.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }

  public dispose(): void {
    this.clearTracers();
    this.pistolTracerGeo.dispose();
    this.rifleTracerGeo.dispose();
    this.policeTracerMat.dispose();
    this.rifleTracerMat.dispose();
    this.suspectTracerMat.dispose();
  }
}
