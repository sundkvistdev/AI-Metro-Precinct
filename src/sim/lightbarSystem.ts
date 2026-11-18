import * as THREE from 'three';
import { LightbarAssetDef, LightbarEmitterDef } from '../assets/assetTypes';
import { LightbarMode } from './types';
import { PoliceCruiserRig } from './vehicleModels';

export function lightbarModeToAssetId(mode: LightbarMode): string {
  switch (mode) {
    case LightbarMode.FlashingHalogen:
      return 'halogen_flash';
    case LightbarMode.RotatingHalogen:
      return 'rotator_classic';
    case LightbarMode.VectorPods:
      return 'vector_v_pods';
    case LightbarMode.VisorStealth:
      return 'visor_stealth';
    case LightbarMode.MiniBeacon:
      return 'mini_beacon';
    case LightbarMode.LED:
    default:
      return 'led_array';
  }
}

export function assetIdToLightbarMode(id: string, asset?: LightbarAssetDef): LightbarMode {
  const p = asset?.patternType ?? id;
  if (p === 'flashing_halogen' || id === 'halogen_flash') return LightbarMode.FlashingHalogen;
  if (p === 'rotating_halogen' || id === 'rotator_classic') return LightbarMode.RotatingHalogen;
  if (p === 'vector_pods' || id === 'vector_v_pods') return LightbarMode.VectorPods;
  if (p === 'visor_stealth' || id === 'visor_stealth') return LightbarMode.VisorStealth;
  if (p === 'mini_beacon' || id === 'mini_beacon') return LightbarMode.MiniBeacon;
  return LightbarMode.LED;
}

function rebuildCustomEmitters(rig: PoliceCruiserRig, asset: LightbarAssetDef): void {
  const lb = rig.lightbar;
  const sig = `${asset.id}:${asset.emitters.length}:${asset.emitters.map((e) => `${e.id}:${e.shape}:${e.x}:${e.y}:${e.z}:${e.color}:${e.emissive}:${e.mode}`).join('|')}`;
  if (lb.customSignature === sig) return;
  lb.customSignature = sig;

  while (lb.customEmittersGroup.children.length > 0) {
    const child = lb.customEmittersGroup.children[0] as THREE.Mesh;
    lb.customEmittersGroup.remove(child);
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
    else child.material?.dispose();
  }
  lb.customEmitterMeshes = [];

  for (const em of asset.emitters) {
    const geo =
      em.shape === 'sphere'
        ? new THREE.SphereGeometry(Math.max(0.03, em.w * 0.5), 10, 8)
        : em.shape === 'cylinder'
        ? new THREE.CylinderGeometry(Math.max(0.03, em.w * 0.5), Math.max(0.03, em.w * 0.52), Math.max(0.04, em.h), 10)
        : new THREE.BoxGeometry(Math.max(0.04, em.w), Math.max(0.03, em.h), Math.max(0.04, em.d));
    const mat = new THREE.MeshStandardMaterial({
      color: em.color,
      emissive: em.emissive,
      emissiveIntensity: 0.2,
      roughness: 0.28,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(em.x, em.y, em.z);
    lb.customEmittersGroup.add(mesh);
    lb.customEmitterMeshes.push({ mesh, def: em });
  }
}

export function updateLightbarVisuals(
  rig: PoliceCruiserRig,
  mode: LightbarMode,
  active: boolean,
  time: number,
  haloBoost = 1.0,
  phaseOffset = 0,
  rateMult = 1.0,
  lightbarAsset?: LightbarAssetDef,
): void {
  const lb = rig.lightbar;

  const hw = lightbarAsset?.hardwareStyle;
  const pattern = lightbarAsset?.patternType;

  const isCustom = hw === 'custom' || pattern === 'custom';
  const isLed = !isCustom && (pattern ? pattern === 'led' : mode === LightbarMode.LED);
  const isFlashing = !isCustom && (pattern ? pattern === 'flashing_halogen' : mode === LightbarMode.FlashingHalogen);
  const isRotating = !isCustom && (pattern ? pattern === 'rotating_halogen' : mode === LightbarMode.RotatingHalogen);
  const isVector = !isCustom && (pattern ? pattern === 'vector_pods' : mode === LightbarMode.VectorPods);
  const isVisor = !isCustom && (pattern ? pattern === 'visor_stealth' : mode === LightbarMode.VisorStealth);
  const isMini = !isCustom && (pattern ? pattern === 'mini_beacon' : mode === LightbarMode.MiniBeacon);

  lb.visorStealthActive = isVisor;

  // Apply data-driven colors & light parameters from asset pack definition
  if (lightbarAsset) {
    const leftHex = lightbarAsset.leftColor;
    const rightHex = lightbarAsset.rightColor;
    const centerHex = lightbarAsset.centerColor;

    lb.leftLensMat.color.set(leftHex);
    lb.leftLensMat.emissive.set(leftHex);
    lb.rightLensMat.color.set(rightHex);
    lb.rightLensMat.emissive.set(rightHex);
    lb.miniBeaconLeftMat.color.set(leftHex);
    lb.miniBeaconLeftMat.emissive.set(leftHex);
    lb.miniBeaconRightMat.color.set(rightHex);
    lb.miniBeaconRightMat.emissive.set(rightHex);
    lb.redPointLight.color.set(leftHex);
    lb.bluePointLight.color.set(rightHex);
    lb.redPointLight.distance = lightbarAsset.pointLightRange;
    lb.bluePointLight.distance = lightbarAsset.pointLightRange;
    (lb.haloLeft.material as THREE.SpriteMaterial).color.set(leftHex);
    (lb.haloRight.material as THREE.SpriteMaterial).color.set(rightHex);
    (lb.haloCenter.material as THREE.SpriteMaterial).color.set(centerHex);
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).color.set(leftHex);
    (lb.haloVisorRight.material as THREE.SpriteMaterial).color.set(rightHex);
    (lb.haloRearLeft.material as THREE.SpriteMaterial).color.set(leftHex);
    (lb.haloRearRight.material as THREE.SpriteMaterial).color.set(rightHex);
    (lb.cookieLeft.material as THREE.MeshBasicMaterial).color.set(leftHex);
    (lb.cookieRight.material as THREE.MeshBasicMaterial).color.set(rightHex);
  }

  // Toggle hardware assemblies (never force visible if detached from roof!)
  const roofAttached = !lb.detached;
  lb.standardShellGroup.visible = roofAttached && (isLed || isFlashing || isRotating);
  lb.vectorPodsGroup.visible = roofAttached && isVector;
  lb.miniBeaconGroup.visible = roofAttached && isMini;
  lb.visorStrobeGroup.visible = isVisor;
  lb.grilleStrobeGroup.visible = lightbarAsset ? lightbarAsset.hasGrilleStrobes : (isVisor || isMini);
  lb.customEmittersGroup.visible = roofAttached && isCustom;
  if (isCustom && lightbarAsset) {
    rebuildCustomEmitters(rig, lightbarAsset);
  }

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
    lb.ledLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.ledRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.ledCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    (lb.halogenLeftBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.halogenRightBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    (lb.halogenCenterBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    lb.vectorPodBulbs.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.trafficAdvisorBulbs.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.customEmitterMeshes.forEach((item) => ((item.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
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
      lb.ledLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
      lb.ledRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
      lb.ledCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05));
      (lb.halogenLeftBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
      (lb.halogenRightBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
      (lb.halogenCenterBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
      lb.vectorPodBulbs.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08));
      lb.trafficAdvisorBulbs.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.04));
      lb.customEmitterMeshes.forEach((item) => ((item.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08));
    }
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = 0;
    lb.visorLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05));
    lb.visorRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05));
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
    (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached ? 0 : 0.25 * haloBoost;
    (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached ? 0 : 0.25 * haloBoost;
    return;
  }

  const effectiveRate = rateMult * (lightbarAsset?.rateMult ?? 1.0);
  const t = time * effectiveRate + phaseOffset;

  let leftRedPower = 0;
  let rightBluePower = 0;
  let centerPower = 0;

  if (isCustom && lightbarAsset) {
    lb.cookieLeft.visible = lightbarAsset.hasCookies;
    lb.cookieRight.visible = lightbarAsset.hasCookies;
    lb.redPointLight.position.set(0.45, 0.42, 0);
    lb.bluePointLight.position.set(-0.45, 0.42, 0);

    let lAcc = 0;
    let rAcc = 0;
    let cAcc = 0;
    for (const item of lb.customEmitterMeshes) {
      const def: LightbarEmitterDef = item.def;
      const cyc = (t * Math.max(0.1, def.freqHz) + def.phase) % 1;
      let val = 0.08;
      if (def.mode === 'steady') {
        val = 1.0;
      } else if (def.mode === 'rotator') {
        item.mesh.rotation.y = t * def.freqHz * Math.PI * 2 + def.phase * Math.PI * 2;
        val = 0.35 + 0.65 * Math.abs(Math.cos(item.mesh.rotation.y));
      } else if (def.mode === 'halogen') {
        val = Math.pow(Math.max(0, Math.sin(cyc * Math.PI * 2) * 0.5 + 0.5), 2.1);
      } else if (def.mode === 'sweep') {
        val = cyc < def.duty ? 1.0 : 0.1;
      } else {
        // strobe double pulse
        val = cyc < def.duty * 0.45 || (cyc > def.duty * 0.55 && cyc < def.duty) ? 1.0 : 0.06;
      }
      const mult = def.intensity ?? 5.2;
      (item.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = val * mult;
      if (def.x > 0.12) lAcc = Math.max(lAcc, val);
      else if (def.x < -0.12) rAcc = Math.max(rAcc, val);
      else cAcc = Math.max(cAcc, val);
    }
    leftRedPower = lAcc;
    rightBluePower = rAcc;
    centerPower = cAcc;
    if (lightbarAsset.hasCookies) {
      lb.cookieLeft.rotation.y = t * 11.2;
      lb.cookieRight.rotation.y = -t * 12.1;
      (lb.cookieLeft.material as THREE.MeshBasicMaterial).opacity = 0.26 * haloBoost;
      (lb.cookieRight.material as THREE.MeshBasicMaterial).opacity = 0.26 * haloBoost;
    }
  } else if (isLed) {
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

    const showCookies = lightbarAsset ? lightbarAsset.hasCookies : true;
    lb.cookieLeft.visible = showCookies;
    lb.cookieRight.visible = showCookies;
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

    const advEnabled = lightbarAsset ? lightbarAsset.hasTrafficAdvisor : true;
    const advPhase = Math.floor((t * 9.0) % 7);
    lb.trafficAdvisorBulbs.forEach((bulb, idx) => {
      const activeIdx = advEnabled && idx <= advPhase && advPhase - idx <= 2;
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

  const rearEnabled = lightbarAsset ? lightbarAsset.hasRearDeck : true;
  (lb.rearDeckRed.material as THREE.MeshStandardMaterial).emissiveIntensity = rearEnabled ? leftRedPower * 3.8 : 0;
  (lb.rearDeckBlue.material as THREE.MeshStandardMaterial).emissiveIntensity = rearEnabled ? rightBluePower * 3.8 : 0;

  lb.headlightLeftMat.emissiveIntensity = lb.headlightLeftDetached ? 0 : 1.2 + leftRedPower * 2.4;
  lb.headlightRightMat.emissiveIntensity = lb.headlightRightDetached
    ? 0
    : 1.2 + rightBluePower * 2.4;
  lb.taillightLeftMat.emissiveIntensity = lb.taillightLeftDetached ? 0 : 1.4;
  lb.taillightRightMat.emissiveIntensity = lb.taillightRightDetached ? 0 : 1.4;

  const ptBase = lightbarAsset?.pointLightIntensity ?? (isVisor ? 12 : 16);
  lb.redPointLight.intensity = leftRedPower * ptBase;
  lb.bluePointLight.intensity = rightBluePower * ptBase;

  const hOp = (lightbarAsset?.haloOpacity ?? 0.72) * haloBoost;
  if (isVisor) {
    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * hOp;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = rightBluePower * hOp;
  } else {
    (lb.haloVisorLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloVisorRight.material as THREE.SpriteMaterial).opacity = 0;

    const haloSpread = isMini ? 0.22 : 0.46;
    lb.haloLeft.position.x = haloSpread;
    lb.haloRight.position.x = -haloSpread;

    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = leftRedPower * hOp;
    lb.haloLeft.scale.set(1.1 + leftRedPower * 0.7, 0.8 + leftRedPower * 0.45, 1);

    (lb.haloRight.material as THREE.SpriteMaterial).opacity = rightBluePower * hOp;
    lb.haloRight.scale.set(1.1 + rightBluePower * 0.7, 0.8 + rightBluePower * 0.45, 1);

    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = centerPower * (hOp * 0.76);
  }

  (lb.haloRearLeft.material as THREE.SpriteMaterial).opacity = rearEnabled ? leftRedPower * (hOp * 0.9) : 0;
  (lb.haloRearRight.material as THREE.SpriteMaterial).opacity = rearEnabled ? rightBluePower * (hOp * 0.9) : 0;

  (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached
    ? 0
    : (0.3 + leftRedPower * 0.35) * haloBoost;
  (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached
    ? 0
    : (0.3 + rightBluePower * 0.35) * haloBoost;
}
