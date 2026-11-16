import * as THREE from 'three';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { StaticObstacleBVH } from './bvh';
import { getSurfaceHeight } from './roadGraph';
import {
  ActiveCrime,
  BulletTracer,
  CivilianVehicle,
  OfficerActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { WeaponKind } from './types';
import { SimVfxManager, stepRagdollPhysics, triggerRagdoll } from './vfx';

const _vDir = new THREE.Vector3();
const _vLook = new THREE.Vector3();
const _vHitPos = new THREE.Vector3();

interface WeaponBallisticSpec {
  speed: number;
  gravity: number;
  baseSpreadRad: number;
  suppressedSpreadRad: number;
  minDmg: number;
  maxDmg: number;
  armorPen: number;
  magSize: number;
  cooldownMin: number;
  cooldownJitter: number;
  reloadTime: number;
  maxRange: number;
}

const WEAPON_SPECS: Record<WeaponKind, WeaponBallisticSpec> = {
  pistol: {
    speed: 78,
    gravity: 7.5,
    baseSpreadRad: 0.085,
    suppressedSpreadRad: 0.19,
    minDmg: 17,
    maxDmg: 27,
    armorPen: 0.24,
    magSize: 12,
    cooldownMin: 0.34,
    cooldownJitter: 0.24,
    reloadTime: 1.35,
    maxRange: 30,
  },
  rifle: {
    speed: 118,
    gravity: 4.5,
    baseSpreadRad: 0.032,
    suppressedSpreadRad: 0.085,
    minDmg: 24,
    maxDmg: 35,
    armorPen: 0.62,
    magSize: 28,
    cooldownMin: 0.16,
    cooldownJitter: 0.09,
    reloadTime: 1.55,
    maxRange: 44,
  },
};

/**
 * Closest fraction t in [0, 1] along 3D segment P0 -> P1 against a vertical humanoid cylinder.
 */
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

/**
 * Tests 3D segment against a vehicle's oriented bounding box in local XZ + height.
 */
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
  private scene: THREE.Scene;
  private rng: () => number;
  private vfx: SimVfxManager;
  private tracers: BulletTracer[] = [];

  private pistolTracerGeo = new THREE.BoxGeometry(0.055, 0.055, 1.35);
  private rifleTracerGeo = new THREE.BoxGeometry(0.065, 0.065, 2.05);
  private policeTracerMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private rifleTracerMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd });
  private suspectTracerMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });

  constructor(scene: THREE.Scene, rng: () => number, vfx: SimVfxManager) {
    this.scene = scene;
    this.rng = rng;
    this.vfx = vfx;
  }

  public checkVehiclePedestrianStrike(
    vehPos: THREE.Vector3,
    vehYaw: number,
    vehSpeed: number,
    pedestrians: PedestrianActor[],
  ): void {
    const fwdX = Math.sin(vehYaw);
    const fwdZ = Math.cos(vehYaw);

    for (const ped of pedestrians) {
      if (ped.ragdoll.active) continue;
      const dx = ped.pos.x - vehPos.x;
      const dz = ped.pos.z - vehPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 2.05 * 2.05) {
        const dist = Math.sqrt(distSq) || 1;
        const knockSpd = Math.min(14, vehSpeed * 0.72);
        triggerRagdoll(
          ped.ragdoll,
          this.rng,
          fwdX * knockSpd + (dx / dist) * 3.5,
          3.8 + Math.min(3.2, vehSpeed * 0.16),
          fwdZ * knockSpd + (dz / dist) * 3.5,
          6.5,
        );
        if (vehSpeed > 6.2) {
          this.vfx.spawnBloodImpact(
            ped.pos.x,
            ped.pos.y + 0.85,
            ped.pos.z,
            fwdX,
            fwdZ,
            Math.min(1.4, vehSpeed / 11),
            vehSpeed > 9.0,
          );
        }
        ped.panicTimer = 9.0;
      }
    }
  }

  public updateOfficerCombat(
    off: OfficerActor,
    idx: number,
    crime: ActiveCrime,
    unit: PoliceUnit,
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    pedestrians: PedestrianActor[],
    audio: JsonAudioSynth | null,
    dt: number,
  ): void {
    if (off.hp <= 0) {
      if (off.ragdoll.active) {
        stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, dt);
      }
      if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
      return;
    }

    if (off.ragdoll.active) {
      stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, dt);
      off.ragdoll.recoverTimer -= dt;
      if (off.ragdoll.recoverTimer <= 0) {
        off.ragdoll.active = false;
        off.hp = Math.max(off.hp, 35);
        off.morale = off.isHeavy ? 65 : 15;
        off.cowardiceState = off.isHeavy ? 'steady' : 'fleeing';
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
        off.rig.root.rotation.set(0, off.yaw, 0);
        off.rig.torso.position.y = off.rig.torsoBaseY;
        off.rig.leftArm.rotation.set(0, 0, 0);
        off.rig.rightArm.rotation.set(0, 0, 0);
        off.rig.leftLeg.rotation.set(0, 0, 0);
        off.rig.rightLeg.rotation.set(0, 0, 0);
      }
      return;
    }

    const dx = crime.suspectPos.x - off.pos.x;
    const dz = crime.suspectPos.z - off.pos.z;
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
      const fleeDx = unit.pos.x - off.pos.x;
      const fleeDz = unit.pos.z - off.pos.z;
      const fleeDist = Math.hypot(fleeDx, fleeDz);
      let dirX = -ux;
      let dirZ = -uz;
      if (fleeDist > 1.8) {
        dirX = fleeDx / fleeDist;
        dirZ = fleeDz / fleeDist;
      }
      off.yaw = Math.atan2(dirX, dirZ);
      off.pos.x += dirX * 5.8 * dt;
      off.pos.z += dirZ * 5.8 * dt;
      staticBvh.resolveCircle(off.pos, 0.48);
      off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);

      off.walkPhase += dt * 15;
      const swing = Math.sin(off.walkPhase) * 0.68;
      off.rig.leftLeg.rotation.x = swing;
      off.rig.rightLeg.rotation.x = -swing;
      off.rig.leftArm.rotation.x = -swing * 0.9;
      off.rig.leftArm.rotation.z = 0;
      off.rig.rightArm.rotation.x = swing * 0.9;
      off.rig.rightArm.rotation.z = 0;
      off.rig.torso.position.y = THREE.MathUtils.damp(
        off.rig.torso.position.y,
        off.rig.torsoBaseY - 0.05,
        10,
        dt,
      );
      if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;

      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.y = off.yaw;
      return;
    }

    off.yaw = Math.atan2(ux, uz);
    const hasLos = staticBvh.raycastSegment(
      off.pos.x,
      off.pos.z,
      crime.suspectPos.x,
      crime.suspectPos.z,
    ).clear;

    off.strafeTimer -= dt;
    if (off.strafeTimer <= 0) {
      off.strafeTimer = 1.6 + this.rng() * 1.4;
      off.strafeSign = off.strafeSign === 1 ? -1 : 1;
    }

    const perpX = -uz * (idx === 0 ? 1 : -1) * off.strafeSign;
    const perpZ = ux * (idx === 0 ? 1 : -1) * off.strafeSign;

    let moveX = 0;
    let moveZ = 0;
    let moving = false;
    const isSuppressed = off.cowardiceState === 'suppressed';
    const preferredRange = off.weaponKind === 'rifle' ? (idx === 0 ? 14.5 : 17.5) : idx === 0 ? 9.5 : 12.0;

    if (isSuppressed) {
      off.rig.torso.position.y = THREE.MathUtils.damp(
        off.rig.torso.position.y,
        off.rig.torsoBaseY - 0.18,
        10,
        dt,
      );
      if (dist < 19) {
        moveX = -ux * 0.8 + perpX * 0.45;
        moveZ = -uz * 0.8 + perpZ * 0.45;
        moving = true;
      }
    } else {
      off.rig.torso.position.y = THREE.MathUtils.damp(
        off.rig.torso.position.y,
        off.rig.torsoBaseY,
        10,
        dt,
      );
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
      const swing = Math.sin(off.walkPhase) * 0.55;
      off.rig.leftLeg.rotation.x = swing;
      off.rig.rightLeg.rotation.x = -swing;
    } else {
      off.rig.leftLeg.rotation.x = THREE.MathUtils.damp(off.rig.leftLeg.rotation.x, 0, 10, dt);
      off.rig.rightLeg.rotation.x = THREE.MathUtils.damp(off.rig.rightLeg.rotation.x, 0, 10, dt);
    }

    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);

    const spec = WEAPON_SPECS[off.weaponKind];
    if (off.reloadTimer > 0) {
      off.reloadTimer -= dt;
      off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, -0.52, 10, dt);
      off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0.24, 10, dt);
      off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, -0.6, 10, dt);
      off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, -0.38, 10, dt);
      if (off.reloadTimer <= 0) off.ammo = spec.magSize;
    } else if (isSuppressed) {
      off.rig.rightArm.rotation.x = THREE.MathUtils.damp(
        off.rig.rightArm.rotation.x,
        -Math.PI * 0.36,
        10,
        dt,
      );
      off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0.22, 10, dt);
      off.rig.leftArm.rotation.x = THREE.MathUtils.damp(
        off.rig.leftArm.rotation.x,
        -Math.PI * 0.44,
        10,
        dt,
      );
      off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, -0.44, 10, dt);
    } else {
      off.recoilKick = THREE.MathUtils.damp(off.recoilKick, 0, 16, dt);
      off.rig.rightArm.rotation.x = THREE.MathUtils.damp(
        off.rig.rightArm.rotation.x,
        -Math.PI * 0.48 - off.recoilKick,
        16,
        dt,
      );
      off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0.22, 14, dt);
      off.rig.leftArm.rotation.x = THREE.MathUtils.damp(
        off.rig.leftArm.rotation.x,
        -Math.PI * 0.45 - off.recoilKick * 0.65,
        16,
        dt,
      );
      off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, -0.46, 14, dt);
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
        crime.suspectPos.x,
        crime.suspectPos.y + 1.24,
        crime.suspectPos.z,
        spread,
        off.weaponKind,
        dmg,
        spec.armorPen,
        false,
        unit.id,
      );
      audio?.playAssetAt(
        off.weaponKind === 'rifle' ? 'gunshot_rifle' : 'gunshot_police',
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
    unit: PoliceUnit,
    staticBvh: StaticObstacleBVH,
    dt: number,
  ): void {
    if (off.hp <= 0) {
      if (off.ragdoll.active) {
        stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, dt);
      }
      return;
    }

    if (off.ragdoll.active) {
      stepRagdollPhysics(off.ragdoll, off.pos, off.rig, staticBvh, dt);
      off.ragdoll.recoverTimer -= dt;
      if (off.ragdoll.recoverTimer <= 0) {
        off.ragdoll.active = false;
        off.hp = off.maxHp;
        off.morale = 85;
        off.cowardiceState = 'steady';
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
        off.rig.root.rotation.set(0, off.yaw, 0);
        off.rig.torso.position.y = off.rig.torsoBaseY;
        off.rig.leftArm.rotation.set(0, 0, 0);
        off.rig.rightArm.rotation.set(0, 0, 0);
        off.rig.leftLeg.rotation.set(0, 0, 0);
        off.rig.rightLeg.rotation.set(0, 0, 0);
      }
      return;
    }

    off.morale = Math.min(100, off.morale + 5.5 * dt);
    off.cowardiceState = 'steady';
    if (off.rig.muzzleFlash) off.rig.muzzleFlash.visible = false;
    off.rig.torso.position.y = THREE.MathUtils.damp(
      off.rig.torso.position.y,
      off.rig.torsoBaseY,
      10,
      dt,
    );

    if (off.roamPauseTimer > 0) {
      off.roamPauseTimer -= dt;
      off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
      off.rig.leftLeg.rotation.x = THREE.MathUtils.damp(off.rig.leftLeg.rotation.x, 0, 10, dt);
      off.rig.rightLeg.rotation.x = THREE.MathUtils.damp(off.rig.rightLeg.rotation.x, 0, 10, dt);
      off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, -0.4, 8, dt);
      off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0.2, 8, dt);
      off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, -0.36, 8, dt);
      off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, -0.4, 8, dt);
      off.rig.head.rotation.y = Math.sin(off.roamPauseTimer * 2.2 + idx) * 0.35;
      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.y = off.yaw;
      return;
    }

    off.roamTimer -= dt;
    if (!off.roamTarget || off.roamTimer <= 0) {
      const anchorX = THREE.MathUtils.lerp(off.pos.x, unit.pos.x, 0.2);
      const anchorZ = THREE.MathUtils.lerp(off.pos.z, unit.pos.z, 0.2);
      let picked: THREE.Vector3 | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const rad = 14 + this.rng() * 26;
        const cx = THREE.MathUtils.clamp(anchorX + Math.cos(ang) * rad, -164, 164);
        const cz = THREE.MathUtils.clamp(anchorZ + Math.sin(ang) * rad, -164, 164);
        const cand = new THREE.Vector3(cx, getSurfaceHeight(cx, cz), cz);
        staticBvh.resolveCircle(cand, 0.65);
        cand.y = getSurfaceHeight(cand.x, cand.z);
        if (cand.distanceToSquared(off.pos) > 8 * 8) {
          picked = cand;
          break;
        }
      }
      const fbX = THREE.MathUtils.clamp(off.pos.x + (idx === 0 ? 12 : -12), -160, 160);
      const fbZ = THREE.MathUtils.clamp(off.pos.z + 10, -160, 160);
      off.roamTarget = picked ?? new THREE.Vector3(fbX, getSurfaceHeight(fbX, fbZ), fbZ);
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
        const slideSign = idx === 0 ? 1 : -1;
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
      const swing = Math.sin(off.walkPhase) * 0.46;
      off.rig.leftLeg.rotation.x = swing;
      off.rig.rightLeg.rotation.x = -swing;
      off.rig.head.rotation.y = THREE.MathUtils.damp(off.rig.head.rotation.y, 0, 8, dt);

      off.rig.rightArm.rotation.x = THREE.MathUtils.damp(off.rig.rightArm.rotation.x, -0.4, 8, dt);
      off.rig.rightArm.rotation.z = THREE.MathUtils.damp(off.rig.rightArm.rotation.z, 0.2, 8, dt);
      off.rig.leftArm.rotation.x = THREE.MathUtils.damp(off.rig.leftArm.rotation.x, -0.35, 8, dt);
      off.rig.leftArm.rotation.z = THREE.MathUtils.damp(off.rig.leftArm.rotation.z, -0.38, 8, dt);
    }

    off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
    off.rig.root.position.copy(off.pos);
    off.rig.root.rotation.y = off.yaw;
  }

  public updateFootCrimeSuspect(
    c: ActiveCrime,
    units: PoliceUnit[],
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    audio: JsonAudioSynth | null,
    simTime: number,
    dt: number,
  ): void {
    if (c.suspectRig.threatRing) {
      const s = 1 + Math.sin(simTime * 5) * 0.12;
      c.suspectRig.threatRing.scale.set(s, s, 1);
    }

    let targetOfficer: OfficerActor | null = null;
    let minD = Infinity;
    for (const u of units) {
      if (!u.mounted) {
        for (const o of u.officers) {
          if (o.hp <= 0 || o.ragdoll.active) continue;
          const d = o.pos.distanceToSquared(c.suspectPos);
          if (d < minD) {
            minD = d;
            targetOfficer = o;
          }
        }
      }
    }

    c.suspectPos.y = getSurfaceHeight(c.suspectPos.x, c.suspectPos.z);

    if (targetOfficer && minD < 40 * 40) {
      const dx = targetOfficer.pos.x - c.suspectPos.x;
      const dz = targetOfficer.pos.z - c.suspectPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist;
      const uz = dz / dist;
      const hasLos = staticBvh.raycastSegment(
        c.suspectPos.x,
        c.suspectPos.z,
        targetOfficer.pos.x,
        targetOfficer.pos.z,
      ).clear;

      c.suspectYaw = Math.atan2(ux, uz);
      c.suspectRig.root.rotation.y = c.suspectYaw;

      c.suspectMoveTimer -= dt;
      if (c.suspectMoveTimer <= 0) {
        c.suspectMoveTimer = 1.4 + this.rng() * 1.6;
        c.suspectStrafeDir = c.suspectStrafeDir === 1 ? -1 : 1;
      }
      const perpX = -uz * c.suspectStrafeDir;
      const perpZ = ux * c.suspectStrafeDir;
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
      const spd = c.suspectHp < 45 ? 4.4 : 3.2;
      c.suspectPos.x += (moveX / mLen) * spd * dt;
      c.suspectPos.z += (moveZ / mLen) * spd * dt;
      staticBvh.resolveCircle(c.suspectPos, 0.5);
      c.suspectPos.x = THREE.MathUtils.clamp(c.suspectPos.x, -165, 165);
      c.suspectPos.z = THREE.MathUtils.clamp(c.suspectPos.z, -165, 165);
      c.suspectPos.y = getSurfaceHeight(c.suspectPos.x, c.suspectPos.z);
      c.suspectRig.root.position.copy(c.suspectPos);

      c.suspectWalkPhase += dt * 9;
      const legSwing = Math.sin(c.suspectWalkPhase) * 0.42;
      c.suspectRig.leftLeg.rotation.x = legSwing;
      c.suspectRig.rightLeg.rotation.x = -legSwing;

      const sSpec = WEAPON_SPECS[c.suspectWeaponKind];
      if (c.suspectReloadTimer > 0) {
        c.suspectReloadTimer -= dt;
        c.suspectRig.rightArm.rotation.x = THREE.MathUtils.damp(
          c.suspectRig.rightArm.rotation.x,
          -0.45,
          10,
          dt,
        );
        c.suspectRig.rightArm.rotation.z = THREE.MathUtils.damp(
          c.suspectRig.rightArm.rotation.z,
          0.2,
          10,
          dt,
        );
        if (c.suspectReloadTimer <= 0) c.suspectAmmo = sSpec.magSize;
      } else {
        c.suspectRecoil = THREE.MathUtils.damp(c.suspectRecoil, 0, 14, dt);
        c.suspectRig.rightArm.rotation.x = THREE.MathUtils.damp(
          c.suspectRig.rightArm.rotation.x,
          -Math.PI * 0.46 - c.suspectRecoil,
          12,
          dt,
        );
        c.suspectRig.rightArm.rotation.z = THREE.MathUtils.damp(
          c.suspectRig.rightArm.rotation.z,
          0.18,
          12,
          dt,
        );
        c.suspectRig.leftArm.rotation.x = THREE.MathUtils.damp(
          c.suspectRig.leftArm.rotation.x,
          -Math.PI * 0.4,
          12,
          dt,
        );
        c.suspectRig.leftArm.rotation.z = THREE.MathUtils.damp(
          c.suspectRig.leftArm.rotation.z,
          -0.38,
          12,
          dt,
        );
      }

      c.fireCooldown -= dt;
      if (hasLos && c.suspectReloadTimer <= 0 && c.fireCooldown <= 0) {
        c.fireCooldown =
          c.suspectWeaponKind === 'rifle'
            ? 0.28 + this.rng() * 0.28
            : 0.52 + this.rng() * 0.46;
        c.muzzleTimer = 0.06;
        c.suspectRecoil = 0.25;
        c.suspectAmmo--;
        if (c.suspectAmmo <= 0) c.suspectReloadTimer = sSpec.reloadTime;

        if (c.suspectRig.muzzleFlash) c.suspectRig.muzzleFlash.visible = true;
        const dmg = sSpec.minDmg + this.rng() * (sSpec.maxDmg - sSpec.minDmg);
        const spread = c.suspectWeaponKind === 'rifle' ? 0.068 : 0.11;

        this.spawnBallisticRound(
          c.suspectPos.x + Math.sin(c.suspectYaw) * 0.62,
          c.suspectPos.y + 1.38,
          c.suspectPos.z + Math.cos(c.suspectYaw) * 0.62,
          targetOfficer.pos.x,
          targetOfficer.pos.y + 1.24,
          targetOfficer.pos.z,
          spread,
          c.suspectWeaponKind,
          dmg,
          sSpec.armorPen,
          true,
          null,
        );
        audio?.playAssetAt(
          c.suspectWeaponKind === 'rifle' ? 'gunshot_rifle' : 'gunshot_suspect',
          c.suspectPos,
        );

        for (const u of units) {
          if (u.mounted) continue;
          const fearResist = u.isHeavyUnit ? 0.24 : 1.0;
          for (const o of u.officers) {
            if (o.hp <= 0) continue;
            const odSq = o.pos.distanceToSquared(targetOfficer.pos);
            if (odSq < 6.5 * 6.5) {
              const fearHit =
                (12 + this.rng() * 14) * (0.35 + cowardiceLevel * 1.35) * fearResist;
              o.morale = Math.max(0, o.morale - fearHit);
            }
          }
        }
      }
    } else {
      c.suspectRig.root.position.copy(c.suspectPos);
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
    _vDir.set(tx - x0, ty - y0, tz - z0);
    const dist = _vDir.length() || 1;
    _vDir.divideScalar(dist);

    const spec = WEAPON_SPECS[weaponKind];
    // Compensate slightly for ballistic drop over distance
    const flightT = dist / spec.speed;
    _vDir.y += (0.5 * spec.gravity * flightT * flightT) / dist;

    // Gaussian-like angular yaw and pitch spread so shots realistically miss or strike cover
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
    this.scene.add(mesh);

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
    civilianCars: CivilianVehicle[],
    pedestrians: PedestrianActor[],
    cowardiceLevel: number,
    staticBvh: StaticObstacleBVH,
    dt: number,
    onSuspectNeutralized: () => void,
  ): void {
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

      const groundAtNext = getSurfaceHeight(p1.x, p1.z);
      let destroyed = tr.life <= 0 || p1.y <= groundAtNext;

      if (p1.y <= groundAtNext) {
        this.vfx.spawnImpactSparks(p1.x, groundAtNext + 0.08, p1.z, 3, 0.55);
        destroyed = true;
      }

      // 1. Static building / wall obstruction (absorbs bullet)
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

      // 2. Vehicle cover & chassis interception (cars absorb gunfire + spark)
      if (!destroyed) {
        for (const u of units) {
          if (u.status === UnitStatusSkip) continue;
          // Give shooter 35ms clearance past their own cruiser door frame
          if (tr.shooterUnitId === u.id && age < 0.035) continue;
          const vehH =
            u.vehicleKind === 'apc'
              ? 2.34
              : u.vehicleKind === 'van'
              ? 2.15
              : u.vehicleKind === 'suv'
              ? 1.82
              : 1.52;
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

      // 3. Police rounds vs Suspect (with armor absorption)
      if (!destroyed && !tr.isSuspect) {
        for (const c of crimes) {
          if (!c.suspectAlive || c.inVehiclePursuit) continue;
          const hit = segmentHitsHumanoid(p0, p1, c.suspectPos, 0.56, 1.88);
          if (hit.hit) {
            const vLen = Math.hypot(tr.vel.x, tr.vel.z) || 1;
            const dirX = tr.vel.x / vLen;
            const dirZ = tr.vel.z / vLen;

            let dmg = tr.damage;
            if (c.suspectArmor > 0) {
              const absorbShare = 0.52 * (1 - tr.armorPen * 0.65);
              const absorbed = Math.min(c.suspectArmor, dmg * absorbShare);
              c.suspectArmor = Math.max(0, c.suspectArmor - absorbed);
              dmg -= absorbed;
              this.vfx.spawnImpactSparks(
                c.suspectPos.x,
                hit.hitY,
                c.suspectPos.z,
                4,
                0.7,
                -dirX * 3,
                -dirZ * 3,
              );
            } else {
              this.vfx.spawnImpactSparks(c.suspectPos.x, hit.hitY, c.suspectPos.z, 2, 0.45);
            }

            const finalDmg = Math.max(4, dmg);
            c.suspectHp = Math.max(0, c.suspectHp - finalDmg);
            c.lastHitDir.set(dirX, 0, dirZ);

            this.vfx.spawnBloodImpact(
              c.suspectPos.x,
              hit.hitY,
              c.suspectPos.z,
              dirX,
              dirZ,
              Math.min(1.5, finalDmg / 18),
              c.suspectHp <= 0 || finalDmg > 15,
            );

            if (c.suspectHp <= 0 && c.suspectAlive) {
              c.suspectAlive = false;
              onSuspectNeutralized();
              if (c.suspectRig.threatRing) c.suspectRig.threatRing.visible = false;
              if (c.suspectRig.muzzleFlash) c.suspectRig.muzzleFlash.visible = false;
              triggerRagdoll(
                c.suspectRagdoll,
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

      // 4. Suspect rounds vs Officers (with body armor absorption & casualties)
      if (!destroyed && tr.isSuspect) {
        for (const u of units) {
          if (u.mounted) continue;
          for (const off of u.officers) {
            if (off.ragdoll.active || off.hp <= 0) continue;
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
                // Vest / tactical plate spark
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
                for (const partner of u.officers) {
                  if (partner !== off && partner.hp > 0) {
                    const partnerShock = partner.isHeavy ? 14 : 46;
                    partner.morale = Math.max(
                      0,
                      partner.morale - partnerShock * (0.4 + cowardiceLevel),
                    );
                  }
                }
              }
              destroyed = true;
              break;
            }
          }
          if (destroyed) break;
        }
      }

      // 5. Stray bullets vs Pedestrians
      if (!destroyed) {
        for (const ped of pedestrians) {
          if (ped.ragdoll.active) continue;
          const hit = segmentHitsHumanoid(p0, p1, ped.pos, 0.5, 1.75);
          if (hit.hit) {
            const vLen = Math.hypot(tr.vel.x, tr.vel.z) || 1;
            triggerRagdoll(
              ped.ragdoll,
              this.rng,
              (tr.vel.x / vLen) * 5.2,
              2.6,
              (tr.vel.z / vLen) * 5.2,
              7.5,
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
        this.scene.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }

  public dispose(): void {
    this.pistolTracerGeo.dispose();
    this.rifleTracerGeo.dispose();
    this.policeTracerMat.dispose();
    this.rifleTracerMat.dispose();
    this.suspectTracerMat.dispose();
  }
}

const UnitStatusSkip = 'AT_STATION' as const;
