import * as THREE from 'three';
import { HumanoidRig } from './vehicleModels';

export type HumanoidAnimMode =
  | 'idle'
  | 'walk'
  | 'run'
  | 'seated'
  | 'aim_pistol'
  | 'aim_rifle'
  | 'reload'
  | 'suppressed'
  | 'jump'
  | 'dead_flat';

export interface RigidPoseOptions {
  phase?: number;
  dt?: number;
  recoilKick?: number;
  headLookYaw?: number;
  isDriver?: boolean;
  seatedPitch?: number;
  torsoScaleY?: number;
  hipY?: number;
  snap?: boolean;
}

function dampOrSet(cur: number, target: number, lambda: number, dt: number, snap: boolean): number {
  if (snap || dt <= 0) return target;
  return THREE.MathUtils.damp(cur, target, lambda, dt);
}

/**
 * Deterministic rigid-body humanoid pose & animation controller.
 * Keeps torso scale and hip pivots cleanly normalized on standing modes,
 * prevents limb drift across mode changes, and guarantees dead humanoids lie flat.
 */
export function applyRigidHumanoidPose(
  rig: HumanoidRig,
  mode: HumanoidAnimMode,
  opts: RigidPoseOptions = {},
): void {
  const phase = opts.phase ?? 0;
  const dt = opts.dt ?? 0.016;
  const snap = Boolean(opts.snap);
  const recoil = opts.recoilKick ?? 0;
  const headLookYaw = opts.headLookYaw ?? 0;

  if (mode === 'dead_flat') {
    rig.torso.scale.set(1, 1, 1);
    rig.torso.position.y = rig.torsoBaseY;
    rig.leftLeg.position.y = rig.torsoBaseY;
    rig.rightLeg.position.y = rig.torsoBaseY;
    rig.torso.rotation.set(0, 0, 0);
    rig.head.rotation.set(0.15, 0.12, 0);
    rig.leftLeg.rotation.set(0.12, 0.08, 0.06);
    rig.rightLeg.rotation.set(-0.08, -0.08, -0.06);
    rig.leftArm.rotation.set(-0.22, 0, 0.42);
    rig.rightArm.rotation.set(-0.18, 0, -0.42);
    if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
    return;
  }

  if (mode === 'seated') {
    const hipY = opts.hipY ?? Math.max(0.44, rig.torsoBaseY - 0.34);
    const torsoScaleY = opts.torsoScaleY ?? 0.84;
    const seatedPitch = opts.seatedPitch ?? -1.46;
    const isDriver = Boolean(opts.isDriver);

    rig.root.rotation.set(0, 0, 0);
    rig.torso.scale.set(0.92, torsoScaleY, 0.92);
    rig.torso.position.y = hipY;
    rig.leftLeg.position.y = hipY;
    rig.rightLeg.position.y = hipY;
    rig.torso.rotation.set(0.06, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    rig.leftLeg.rotation.set(seatedPitch, 0, 0);
    rig.rightLeg.rotation.set(seatedPitch, 0, 0);
    rig.leftArm.rotation.set(isDriver ? -0.82 : -0.48, 0, isDriver ? -0.18 : 0.06);
    rig.rightArm.rotation.set(isDriver ? -0.82 : -0.48, 0, isDriver ? 0.18 : -0.06);
    if (rig.muzzleFlash) rig.muzzleFlash.visible = false;
    return;
  }

  // Restore standing proportions & pivots cleanly
  rig.torso.scale.set(1, 1, 1);
  rig.leftLeg.position.y = rig.torsoBaseY;
  rig.rightLeg.position.y = rig.torsoBaseY;

  const armBlend = 14;
  const legBlend = 15;

  let targetTorsoY = rig.torsoBaseY;
  let targetTorsoPitch = 0;
  let targetLLegX = 0;
  let targetRLegX = 0;
  let targetLArmX = 0;
  let targetLArmZ = 0;
  let targetRArmX = 0;
  let targetRArmZ = 0;

  switch (mode) {
    case 'idle': {
      targetLArmX = -0.08;
      targetRArmX = -0.08;
      targetLArmZ = 0.05;
      targetRArmZ = -0.05;
      break;
    }
    case 'walk': {
      const swing = Math.sin(phase) * 0.48;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetLArmX = -swing * 0.72;
      targetRArmX = swing * 0.72;
      targetTorsoPitch = 0.03;
      break;
    }
    case 'run': {
      const swing = Math.sin(phase) * 0.72;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetLArmX = -swing * 0.92;
      targetRArmX = swing * 0.92;
      targetTorsoY = rig.torsoBaseY - 0.04;
      targetTorsoPitch = 0.1;
      break;
    }
    case 'jump': {
      targetLLegX = -0.65;
      targetRLegX = 0.55;
      targetLArmX = -1.2;
      targetRArmX = -1.2;
      targetLArmZ = 0.22;
      targetRArmZ = -0.22;
      break;
    }
    case 'suppressed': {
      const swing = Math.sin(phase) * 0.42;
      targetTorsoY = rig.torsoBaseY - 0.18;
      targetTorsoPitch = 0.16;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetRArmX = -Math.PI * 0.36;
      targetRArmZ = 0.22;
      targetLArmX = -Math.PI * 0.44;
      targetLArmZ = -0.44;
      break;
    }
    case 'reload': {
      const swing = Math.sin(phase) * 0.36;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetRArmX = -0.52;
      targetRArmZ = 0.24;
      targetLArmX = -0.6;
      targetLArmZ = -0.38;
      break;
    }
    case 'aim_pistol': {
      const swing = Math.sin(phase) * 0.48;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetRArmX = -Math.PI * 0.48 - recoil;
      targetRArmZ = 0.22;
      targetLArmX = -Math.PI * 0.45 - recoil * 0.65;
      targetLArmZ = -0.46;
      break;
    }
    case 'aim_rifle': {
      const swing = Math.sin(phase) * 0.44;
      targetLLegX = swing;
      targetRLegX = -swing;
      targetTorsoPitch = 0.04;
      targetRArmX = -Math.PI * 0.47 - recoil;
      targetRArmZ = 0.2;
      targetLArmX = -Math.PI * 0.48 - recoil * 0.7;
      targetLArmZ = -0.48;
      break;
    }
  }

  rig.torso.position.y = dampOrSet(rig.torso.position.y, targetTorsoY, 12, dt, snap);
  rig.torso.rotation.x = dampOrSet(rig.torso.rotation.x, targetTorsoPitch, 12, dt, snap);
  rig.head.rotation.y = dampOrSet(rig.head.rotation.y, headLookYaw, 10, dt, snap);

  rig.leftLeg.rotation.x = dampOrSet(rig.leftLeg.rotation.x, targetLLegX, legBlend, dt, snap);
  rig.rightLeg.rotation.x = dampOrSet(rig.rightLeg.rotation.x, targetRLegX, legBlend, dt, snap);
  rig.leftLeg.rotation.z = dampOrSet(rig.leftLeg.rotation.z, 0, legBlend, dt, snap);
  rig.rightLeg.rotation.z = dampOrSet(rig.rightLeg.rotation.z, 0, legBlend, dt, snap);

  rig.leftArm.rotation.x = dampOrSet(rig.leftArm.rotation.x, targetLArmX, armBlend, dt, snap);
  rig.leftArm.rotation.z = dampOrSet(rig.leftArm.rotation.z, targetLArmZ, armBlend, dt, snap);
  rig.rightArm.rotation.x = dampOrSet(rig.rightArm.rotation.x, targetRArmX, armBlend, dt, snap);
  rig.rightArm.rotation.z = dampOrSet(rig.rightArm.rotation.z, targetRArmZ, armBlend, dt, snap);
}
