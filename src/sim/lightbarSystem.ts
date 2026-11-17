import * as THREE from 'three';
import { LightbarMode } from './types';
import { PoliceCruiserRig } from './vehicleModels';

export function updateLightbarVisuals(
  rig: PoliceCruiserRig,
  mode: LightbarMode,
  active: boolean,
  time: number,
  haloBoost = 1.0,
  phaseOffset = 0,
  rateMult = 1.0,
): void {
  const lb = rig.lightbar;

  const isLed = mode === LightbarMode.LED;
  const isFlashing = mode === LightbarMode.FlashingHalogen;
  const isRotating = mode === LightbarMode.RotatingHalogen;

  lb.ledLeftPods.forEach((m) => (m.visible = isLed));
  lb.ledRightPods.forEach((m) => (m.visible = isLed));
  lb.ledCenterPods.forEach((m) => (m.visible = isLed));

  lb.halogenLeftBulb.visible = isFlashing;
  lb.halogenRightBulb.visible = isFlashing;
  lb.halogenCenterBulb.visible = isFlashing;

  lb.rotatorLeft.visible = isRotating;
  lb.rotatorRight.visible = isRotating;
  lb.rotatorCenter.visible = isRotating;

  const effectiveActive = active && !lb.detached;

  if (lb.detached) {
    lb.redPointLight.intensity = 0;
    lb.bluePointLight.intensity = 0;
    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.leftLensMat.emissiveIntensity = 0;
    lb.rightLensMat.emissiveIntensity = 0;
    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
    lb.ledLeftPods.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0),
    );
    lb.ledRightPods.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0),
    );
    lb.ledCenterPods.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0),
    );
    (lb.halogenLeftBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.halogenRightBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.halogenCenterBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
  }

  if (!effectiveActive) {
    lb.redPointLight.intensity = 0;
    lb.bluePointLight.intensity = 0;
    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    if (!lb.detached) {
      lb.leftLensMat.emissiveIntensity = 0.08;
      lb.rightLensMat.emissiveIntensity = 0.08;
      (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
      (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
      (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
      lb.ledLeftPods.forEach(
        (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1),
      );
      lb.ledRightPods.forEach(
        (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1),
      );
      lb.ledCenterPods.forEach(
        (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05),
      );
      (lb.halogenLeftBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
      (lb.halogenRightBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
      (lb.halogenCenterBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
    }

    (lb.rearDeckRed.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.rearDeckBlue.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.haloRearLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloRearRight.material as THREE.SpriteMaterial).opacity = 0;

    lb.headlightLeftMat.emissiveIntensity = lb.headlightLeftDetached ? 0 : 1.3;
    lb.headlightRightMat.emissiveIntensity = lb.headlightRightDetached ? 0 : 1.3;
    lb.taillightLeftMat.emissiveIntensity = lb.taillightLeftDetached ? 0 : 1.3;
    lb.taillightRightMat.emissiveIntensity = lb.taillightRightDetached ? 0 : 1.3;
    (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached
      ? 0
      : 0.25 * haloBoost;
    (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached
      ? 0
      : 0.25 * haloBoost;
    return;
  }

  const t = time * rateMult + phaseOffset;

  let leftRedPower = 0;
  let rightBluePower = 0;
  let centerPower = 0;

  if (isLed) {
    const cycleL = (t * 2.2) % 1;
    const cycleR = (t * 2.27 + 0.17) % 1;
    const cycleC = (t * 2.11 + 0.31) % 1;

    const redBurst =
      cycleL < 0.08 ||
      (cycleL > 0.14 && cycleL < 0.22) ||
      (cycleL > 0.28 && cycleL < 0.36);
    const blueBurst =
      (cycleR > 0.48 && cycleR < 0.56) ||
      (cycleR > 0.62 && cycleR < 0.7) ||
      (cycleR > 0.76 && cycleR < 0.84);
    const takedownBurst =
      (cycleC > 0.38 && cycleC < 0.45) || (cycleC > 0.88 && cycleC < 0.95);

    leftRedPower = redBurst ? 1.0 : 0.05;
    rightBluePower = blueBurst ? 1.0 : 0.05;
    centerPower = takedownBurst ? 1.0 : 0.05;

    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.redPointLight.position.set(0.55, 0.42, 0);
    lb.bluePointLight.position.set(-0.55, 0.42, 0);

    lb.ledLeftPods.forEach((p, idx) => {
      const alt = idx === 1 ? (cycleL > 0.14 && cycleL < 0.36 ? 1.0 : 0.1) : leftRedPower;
      (p.material as THREE.MeshStandardMaterial).emissiveIntensity = alt * 5.2;
    });
    lb.ledRightPods.forEach((p, idx) => {
      const alt = idx === 1 ? (cycleR > 0.62 && cycleR < 0.84 ? 1.0 : 0.1) : rightBluePower;
      (p.material as THREE.MeshStandardMaterial).emissiveIntensity = alt * 5.2;
    });
    lb.ledCenterPods.forEach((p, idx) => {
      const alt = idx === 0 ? centerPower : cycleC > 0.42 && cycleC < 0.5 ? 1.0 : 0.06;
      (p.material as THREE.MeshStandardMaterial).emissiveIntensity = alt * 4.5;
    });
  } else if (isFlashing) {
    const phaseL = t * 5.35;
    const phaseR = t * 5.58 + Math.PI + 0.42;
    const phaseC = t * 7.85 + 1.15;
    leftRedPower = Math.pow(Math.max(0, Math.sin(phaseL) * 0.5 + 0.5), 2.1);
    rightBluePower = Math.pow(Math.max(0, Math.sin(phaseR) * 0.5 + 0.5), 2.1);
    centerPower = Math.pow(Math.max(0, Math.sin(phaseC) * 0.5 + 0.5), 3.0);

    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.redPointLight.position.set(0.55, 0.42, 0);
    lb.bluePointLight.position.set(-0.55, 0.42, 0);

    (lb.halogenLeftBulb.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.2 + leftRedPower * 5.5;
    (lb.halogenRightBulb.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.2 + rightBluePower * 5.5;
    (lb.halogenCenterBulb.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.1 + centerPower * 4.2;
  } else if (isRotating) {
    const angL = t * 11.2;
    const angR = -t * 12.35 + 1.45;
    const angC = t * 8.65 + 2.7;

    lb.rotatorLeft.rotation.y = angL;
    lb.rotatorRight.rotation.y = angR;
    lb.rotatorCenter.rotation.y = angC;

    lb.cookieLeft.visible = true;
    lb.cookieRight.visible = true;
    lb.cookieLeft.rotation.y = angL;
    lb.cookieRight.rotation.y = angR;
    (lb.cookieLeft.material as THREE.MeshBasicMaterial).opacity = 0.28 * haloBoost;
    (lb.cookieRight.material as THREE.MeshBasicMaterial).opacity = 0.28 * haloBoost;

    lb.redPointLight.position.set(0.45 + Math.sin(angL) * 1.1, 0.42, Math.cos(angL) * 1.1);
    lb.bluePointLight.position.set(-0.45 + Math.sin(angR) * 1.1, 0.42, Math.cos(angR) * 1.1);

    leftRedPower = 0.4 + 0.6 * Math.abs(Math.cos(angL));
    rightBluePower = 0.4 + 0.6 * Math.abs(Math.cos(angR));
    centerPower = 0.25 + 0.55 * Math.abs(Math.cos(angC));
  }

  lb.leftLensMat.emissiveIntensity = 0.2 + leftRedPower * 1.85;
  lb.rightLensMat.emissiveIntensity = 0.2 + rightBluePower * 1.85;

  (lb.rearDeckRed.material as THREE.MeshStandardMaterial).emissiveIntensity = leftRedPower * 3.8;
  (lb.rearDeckBlue.material as THREE.MeshStandardMaterial).emissiveIntensity = rightBluePower * 3.8;

  lb.headlightLeftMat.emissiveIntensity = lb.headlightLeftDetached ? 0 : 1.2 + leftRedPower * 2.4;
  lb.headlightRightMat.emissiveIntensity = lb.headlightRightDetached
    ? 0
    : 1.2 + rightBluePower * 2.4;
  lb.taillightLeftMat.emissiveIntensity = lb.taillightLeftDetached ? 0 : 1.4;
  lb.taillightRightMat.emissiveIntensity = lb.taillightRightDetached ? 0 : 1.4;

  lb.redPointLight.intensity = leftRedPower * 16;
  lb.bluePointLight.intensity = rightBluePower * 16;

  (lb.haloLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * 0.72 * haloBoost;
  lb.haloLeft.scale.set(1.1 + leftRedPower * 0.7, 0.8 + leftRedPower * 0.45, 1);

  (lb.haloRight.material as THREE.SpriteMaterial).opacity = rightBluePower * 0.72 * haloBoost;
  lb.haloRight.scale.set(1.1 + rightBluePower * 0.7, 0.8 + rightBluePower * 0.45, 1);

  (lb.haloCenter.material as THREE.SpriteMaterial).opacity = centerPower * 0.55 * haloBoost;
  (lb.haloRearLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * 0.65 * haloBoost;
  (lb.haloRearRight.material as THREE.SpriteMaterial).opacity = rightBluePower * 0.65 * haloBoost;

  (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached
    ? 0
    : (0.3 + leftRedPower * 0.35) * haloBoost;
  (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached
    ? 0
    : (0.3 + rightBluePower * 0.35) * haloBoost;
}
