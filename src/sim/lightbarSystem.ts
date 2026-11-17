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
  const isVector = mode === LightbarMode.VectorPods;
  const isVisor = mode === LightbarMode.VisorStealth;
  const isMini = mode === LightbarMode.MiniBeacon;

  lb.visorStealthActive = isVisor;

  // Toggle hardware assemblies (never force visible if detached from roof!)
  const roofAttached = !lb.detached;
  lb.standardShellGroup.visible = roofAttached && (isLed || isFlashing || isRotating);
  lb.vectorPodsGroup.visible = roofAttached && isVector;
  lb.miniBeaconGroup.visible = roofAttached && isMini;
  lb.visorStrobeGroup.visible = isVisor;
  lb.grilleStrobeGroup.visible = isVisor || isMini;

  lb.ledLeftPods.forEach((m) => (m.visible = isLed));
  lb.ledRightPods.forEach((m) => (m.visible = isLed));
  lb.ledCenterPods.forEach((m) => (m.visible = isLed));

  lb.halogenLeftBulb.visible = isFlashing;
  lb.halogenRightBulb.visible = isFlashing;
  lb.halogenCenterBulb.visible = isFlashing;

  lb.rotatorLeft.visible = isRotating;
  lb.rotatorRight.visible = isRotating;
  lb.rotatorCenter.visible = isRotating;

  const effectiveActive = active && (isVisor || roofAttached);

  if (lb.detached && !isVisor) {
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
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = 0;
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
    lb.vectorPodBulbs.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0),
    );
    lb.trafficAdvisorBulbs.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0),
    );
  }

  if (!effectiveActive) {
    lb.redPointLight.intensity = 0;
    lb.bluePointLight.intensity = 0;
    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    if (roofAttached) {
      lb.leftLensMat.emissiveIntensity = 0.08;
      lb.rightLensMat.emissiveIntensity = 0.08;
      lb.miniBeaconLeftMat.emissiveIntensity = 0.06;
      lb.miniBeaconRightMat.emissiveIntensity = 0.06;
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
      lb.vectorPodBulbs.forEach(
        (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08),
      );
      lb.trafficAdvisorBulbs.forEach(
        (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.04),
      );
    }
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = 0;
    lb.visorLeftPods.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05),
    );
    lb.visorRightPods.forEach(
      (p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05),
    );
    (lb.grilleStrobeLeft.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
    (lb.grilleStrobeRight.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;

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
  } else if (isVector) {
    const sweepIdx = Math.floor((t * 8.5) % 5);
    const pulseRed = (t * 2.5) % 1 < 0.48 ? 1.0 : 0.14;
    const pulseBlue = (t * 2.5 + 0.5) % 1 < 0.48 ? 1.0 : 0.14;

    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.redPointLight.position.set(0.48, 0.44, 0.05);
    lb.bluePointLight.position.set(-0.48, 0.44, 0.05);

    lb.vectorPodBulbs.forEach((bulb, idx) => {
      const isLit = idx === sweepIdx || (idx < 2 ? pulseRed > 0.5 : idx > 2 ? pulseBlue > 0.5 : false);
      (bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = isLit ? 5.2 : 0.2;
    });

    const advPhase = Math.floor((t * 9.0) % 7);
    lb.trafficAdvisorBulbs.forEach((bulb, idx) => {
      const activeIdx = idx <= advPhase && advPhase - idx <= 2;
      (bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = activeIdx ? 4.4 : 0.15;
    });

    leftRedPower = Math.max(pulseRed, sweepIdx <= 1 ? 0.95 : 0.15);
    rightBluePower = Math.max(pulseBlue, sweepIdx >= 3 ? 0.95 : 0.15);
    centerPower = sweepIdx === 2 ? 1.0 : 0.12;
  } else if (isVisor) {
    const cyc = (t * 3.1) % 1;
    const redOn = cyc < 0.14 || (cyc > 0.22 && cyc < 0.36);
    const blueOn = (cyc > 0.5 && cyc < 0.64) || (cyc > 0.72 && cyc < 0.86);

    leftRedPower = redOn ? 1.0 : 0.05;
    rightBluePower = blueOn ? 1.0 : 0.05;
    centerPower = 0;

    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.redPointLight.position.set(0.4, 0.25, 0.85);
    lb.bluePointLight.position.set(-0.4, 0.25, 0.85);

    lb.visorLeftPods.forEach((p, idx) => {
      const alt = idx === 1 ? !redOn && cyc < 0.44 : redOn;
      (p.material as THREE.MeshStandardMaterial).emissiveIntensity = alt ? 5.6 : 0.1;
    });
    lb.visorRightPods.forEach((p, idx) => {
      const alt = idx === 1 ? !blueOn && cyc > 0.48 : blueOn;
      (p.material as THREE.MeshStandardMaterial).emissiveIntensity = alt ? 5.6 : 0.1;
    });
    (lb.grilleStrobeLeft.material as THREE.MeshStandardMaterial).emissiveIntensity = redOn ? 5.2 : 0.08;
    (lb.grilleStrobeRight.material as THREE.MeshStandardMaterial).emissiveIntensity = blueOn ? 5.2 : 0.08;
  } else if (isMini) {
    const angL = t * 13.5;
    const angR = -t * 14.2 + 1.2;
    lb.miniRotatorLeft.rotation.y = angL;
    lb.miniRotatorRight.rotation.y = angR;

    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.redPointLight.position.set(0.22, 0.42, 0);
    lb.bluePointLight.position.set(-0.22, 0.42, 0);

    leftRedPower = 0.35 + 0.65 * Math.abs(Math.cos(angL));
    rightBluePower = 0.35 + 0.65 * Math.abs(Math.cos(angR));
    centerPower = 0.25;

    lb.miniBeaconLeftMat.emissiveIntensity = 0.25 + leftRedPower * 2.1;
    lb.miniBeaconRightMat.emissiveIntensity = 0.25 + rightBluePower * 2.1;

    const gPhase = (t * 4.2) % 1;
    (lb.grilleStrobeLeft.material as THREE.MeshStandardMaterial).emissiveIntensity =
      gPhase < 0.45 ? 4.2 : 0.1;
    (lb.grilleStrobeRight.material as THREE.MeshStandardMaterial).emissiveIntensity =
      gPhase >= 0.45 ? 4.2 : 0.1;
  }

  lb.leftLensMat.emissiveIntensity = isVisor ? 0 : 0.2 + leftRedPower * 1.85;
  lb.rightLensMat.emissiveIntensity = isVisor ? 0 : 0.2 + rightBluePower * 1.85;

  (lb.rearDeckRed.material as THREE.MeshStandardMaterial).emissiveIntensity = leftRedPower * 3.8;
  (lb.rearDeckBlue.material as THREE.MeshStandardMaterial).emissiveIntensity = rightBluePower * 3.8;

  lb.headlightLeftMat.emissiveIntensity = lb.headlightLeftDetached ? 0 : 1.2 + leftRedPower * 2.4;
  lb.headlightRightMat.emissiveIntensity = lb.headlightRightDetached
    ? 0
    : 1.2 + rightBluePower * 2.4;
  lb.taillightLeftMat.emissiveIntensity = lb.taillightLeftDetached ? 0 : 1.4;
  lb.taillightRightMat.emissiveIntensity = lb.taillightRightDetached ? 0 : 1.4;

  lb.redPointLight.intensity = leftRedPower * (isVisor ? 12 : 16);
  lb.bluePointLight.intensity = rightBluePower * (isVisor ? 12 : 16);

  if (isVisor) {
    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * 0.72 * haloBoost;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = rightBluePower * 0.72 * haloBoost;
  } else {
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = 0;

    const haloSpread = isMini ? 0.22 : 0.46;
    lb.haloLeft.position.x = haloSpread;
    lb.haloRight.position.x = -haloSpread;

    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * 0.72 * haloBoost;
    lb.haloLeft.scale.set(1.1 + leftRedPower * 0.7, 0.8 + leftRedPower * 0.45, 1);

    (lb.haloRight.material as THREE.SpriteMaterial).opacity = rightBluePower * 0.72 * haloBoost;
    lb.haloRight.scale.set(1.1 + rightBluePower * 0.7, 0.8 + rightBluePower * 0.45, 1);

    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = centerPower * 0.55 * haloBoost;
  }

  (lb.haloRearLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * 0.65 * haloBoost;
  (lb.haloRearRight.material as THREE.SpriteMaterial).opacity = rightBluePower * 0.65 * haloBoost;

  (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached
    ? 0
    : (0.3 + leftRedPower * 0.35) * haloBoost;
  (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached
    ? 0
    : (0.3 + rightBluePower * 0.35) * haloBoost;
}
