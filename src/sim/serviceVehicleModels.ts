import * as THREE from 'three';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { buildJsonModel } from '../assets/jsonModelBuilder';
import { ProceduralTexturePack } from './textures';

export interface AmbulanceRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  frontWheels: THREE.Group[];
  cabinCrewGroup: THREE.Group;
  redLeftPods: THREE.Mesh[];
  redRightPods: THREE.Mesh[];
  whiteCenterPods: THREE.Mesh[];
  boxFlashersLeft: THREE.Mesh[];
  boxFlashersRight: THREE.Mesh[];
  redPointLight: THREE.PointLight;
  whitePointLight: THREE.PointLight;
  haloLeft: THREE.Sprite;
  haloRight: THREE.Sprite;
  haloCenter: THREE.Sprite;
  haloRearLeft: THREE.Sprite;
  haloRearRight: THREE.Sprite;
}

export interface TowTruckRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  frontWheels: THREE.Group[];
  towBoom: THREE.Group;
  amberLeftPods: THREE.Mesh[];
  amberRightPods: THREE.Mesh[];
  amberPointLight: THREE.PointLight;
  haloLeft: THREE.Sprite;
  haloRight: THREE.Sprite;
}

function makeServiceHalo(
  texture: THREE.CanvasTexture,
  colorHex: number,
  scaleX: number,
  scaleY: number,
): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: texture,
    color: colorHex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(scaleX, scaleY, 1);
  sp.renderOrder = 6;
  return sp;
}

function makeAmbulanceSideTexture(unitNum: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 96);

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.lineWidth = 4;
  ctx.font = '900 32px sans-serif';
  ctx.textBaseline = 'middle';
  const label = `AMBULANCE · MEDIC 0${unitNum}`;
  ctx.strokeText(label, 20, 48);
  ctx.fillStyle = '#dc2626';
  ctx.fillText(label, 20, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeAmbulanceRoofTexture(unitNum: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 236, 236);

  // Red medical cross
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(104, 34, 48, 112);
  ctx.fillRect(72, 66, 112, 48);

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`M-0${unitNum}`, 128, 198);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTowDoorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 96);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(10, 14, 236, 68);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 14, 236, 68);

  ctx.fillStyle = '#facc15';
  ctx.font = '900 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('METRO RECOVERY', 128, 44);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('POLICE TOW · UNIT T1', 128, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAmbulanceRig(
  unitNum: number,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
): AmbulanceRig {
  const built = buildJsonModel(assets.models['ambulance_van'], textures.byId);
  const root = built.root;
  const bodyGroup = (built.tags['bodyGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const cabinCrewGroup = (built.tags['cabinCrewGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const frontWheels = (built.tags['frontWheel'] ?? []) as THREE.Group[];
  const rearWheels = (built.tags['rearWheel'] ?? []) as THREE.Group[];
  const wheels = [...frontWheels, ...rearWheels];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }

  // Contact shadow
  const shadowGeo = new THREE.PlaneGeometry(2.95, 5.95).rotateX(-Math.PI / 2);
  const shadowPlane = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.68,
    }),
  );
  shadowPlane.position.y = 0.03;
  root.add(shadowPlane);

  // Side & roof EMS decals
  const sideTex = makeAmbulanceSideTexture(unitNum);
  const sideMat = new THREE.MeshStandardMaterial({
    map: sideTex,
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.36), sideMat);
  sideL.position.set(1.122, 1.5, -0.86);
  sideL.rotation.y = Math.PI / 2;
  const sideR = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.36), sideMat);
  sideR.position.set(-1.122, 1.5, -0.86);
  sideR.rotation.y = -Math.PI / 2;

  const roofTex = makeAmbulanceRoofTexture(unitNum);
  const roofPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshStandardMaterial({
      map: roofTex,
      roughness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  roofPlate.rotation.x = -Math.PI / 2;
  roofPlate.position.set(0, 2.415, -0.86);
  bodyGroup.add(sideL, sideR, roofPlate);

  // Front cab/box brow EMS lightbar (Red / White / Red)
  const lbGroup = new THREE.Group();
  lbGroup.position.set(0, 2.43, 0.72);
  bodyGroup.add(lbGroup);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.05, 0.34), trimMat);
  lbGroup.add(basePlate);

  const redLeftPods: THREE.Mesh[] = [];
  const redRightPods: THREE.Mesh[] = [];
  const whiteCenterPods: THREE.Mesh[] = [];
  const podGeo = new THREE.BoxGeometry(0.18, 0.09, 0.26);

  for (const ox of [0.34, 0.56, 0.78]) {
    const pL = new THREE.Mesh(
      podGeo,
      new THREE.MeshStandardMaterial({
        color: 0xff2222,
        emissive: 0xff1a1a,
        emissiveIntensity: 0.12,
        roughness: 0.25,
      }),
    );
    pL.position.set(ox, 0.07, 0);
    lbGroup.add(pL);
    redLeftPods.push(pL);

    const pR = new THREE.Mesh(
      podGeo,
      new THREE.MeshStandardMaterial({
        color: 0xff2222,
        emissive: 0xff1a1a,
        emissiveIntensity: 0.12,
        roughness: 0.25,
      }),
    );
    pR.position.set(-ox, 0.07, 0);
    lbGroup.add(pR);
    redRightPods.push(pR);
  }

  for (const ox of [-0.11, 0.11]) {
    const pC = new THREE.Mesh(
      podGeo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.1,
        roughness: 0.22,
      }),
    );
    pC.position.set(ox, 0.07, 0);
    lbGroup.add(pC);
    whiteCenterPods.push(pC);
  }

  // Rear & side upper box perimeter warning flashers
  const boxFlashersLeft: THREE.Mesh[] = [];
  const boxFlashersRight: THREE.Mesh[] = [];
  const rearPodGeo = new THREE.BoxGeometry(0.28, 0.12, 0.06);
  const rearL = new THREE.Mesh(
    rearPodGeo,
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1a1a, emissiveIntensity: 0.1 }),
  );
  rearL.position.set(0.82, 2.22, -2.63);
  const rearR = new THREE.Mesh(
    rearPodGeo,
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.1 }),
  );
  rearR.position.set(-0.82, 2.22, -2.63);
  bodyGroup.add(rearL, rearR);
  boxFlashersLeft.push(rearL);
  boxFlashersRight.push(rearR);

  const haloLeft = makeServiceHalo(textures.lightHalo, 0xff2b2b, 1.45, 1.05);
  haloLeft.position.set(0.56, 0.12, 0);
  const haloRight = makeServiceHalo(textures.lightHalo, 0xff2b2b, 1.45, 1.05);
  haloRight.position.set(-0.56, 0.12, 0);
  const haloCenter = makeServiceHalo(textures.lightHalo, 0xffffff, 1.15, 0.85);
  haloCenter.position.set(0, 0.12, 0);
  lbGroup.add(haloLeft, haloRight, haloCenter);

  const haloRearLeft = makeServiceHalo(textures.lightHalo, 0xff2b2b, 0.85, 0.65);
  haloRearLeft.position.set(0.82, 2.22, -2.7);
  const haloRearRight = makeServiceHalo(textures.lightHalo, 0xfbbf24, 0.85, 0.65);
  haloRearRight.position.set(-0.82, 2.22, -2.7);
  bodyGroup.add(haloRearLeft, haloRearRight);

  const range = isSoftwareGl ? 14 : 20;
  const redPointLight = new THREE.PointLight(0xff2222, 0, range, 1.65);
  redPointLight.position.set(0.45, 0.42, 0);
  const whitePointLight = new THREE.PointLight(0xfff1f2, 0, range, 1.65);
  whitePointLight.position.set(-0.45, 0.42, 0);
  lbGroup.add(redPointLight, whitePointLight);

  return {
    root,
    bodyGroup,
    wheels,
    frontWheels,
    cabinCrewGroup,
    redLeftPods,
    redRightPods,
    whiteCenterPods,
    boxFlashersLeft,
    boxFlashersRight,
    redPointLight,
    whitePointLight,
    haloLeft,
    haloRight,
    haloCenter,
    haloRearLeft,
    haloRearRight,
  };
}

export function updateAmbulanceLightbar(
  rig: AmbulanceRig,
  active: boolean,
  time: number,
  haloBoost: number,
  phaseOffset: number,
): void {
  if (!active) {
    rig.redPointLight.intensity = 0;
    rig.whitePointLight.intensity = 0;
    rig.redLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
    rig.redRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
    rig.whiteCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08));
    rig.boxFlashersLeft.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08));
    rig.boxFlashersRight.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.08));
    (rig.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (rig.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    (rig.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
    (rig.haloRearLeft.material as THREE.SpriteMaterial).opacity = 0;
    (rig.haloRearRight.material as THREE.SpriteMaterial).opacity = 0;
    return;
  }

  const t = time * 2.15 + phaseOffset;
  const cycL = t % 1;
  const cycR = (t + 0.5) % 1;
  const cycC = (t * 1.35 + 0.22) % 1;

  const pwrL = cycL < 0.14 || (cycL > 0.22 && cycL < 0.36) ? 1.0 : 0.06;
  const pwrR = cycR < 0.14 || (cycR > 0.22 && cycR < 0.36) ? 1.0 : 0.06;
  const pwrC = cycC < 0.12 || (cycC > 0.5 && cycC < 0.62) ? 1.0 : 0.05;

  rig.redLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrL * 5.2));
  rig.redRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrR * 5.2));
  rig.whiteCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrC * 4.8));
  rig.boxFlashersLeft.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrL * 4.5));
  rig.boxFlashersRight.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrR * 4.5));

  rig.redPointLight.intensity = Math.max(pwrL, pwrR) * 15;
  rig.whitePointLight.intensity = pwrC * 12;

  (rig.haloLeft.material as THREE.SpriteMaterial).opacity = pwrL * 0.72 * haloBoost;
  (rig.haloRight.material as THREE.SpriteMaterial).opacity = pwrR * 0.72 * haloBoost;
  (rig.haloCenter.material as THREE.SpriteMaterial).opacity = pwrC * 0.62 * haloBoost;
  (rig.haloRearLeft.material as THREE.SpriteMaterial).opacity = pwrL * 0.68 * haloBoost;
  (rig.haloRearRight.material as THREE.SpriteMaterial).opacity = pwrR * 0.68 * haloBoost;
}

export function createTowTruckRig(
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
): TowTruckRig {
  const built = buildJsonModel(assets.models['tow_truck'], textures.byId);
  const root = built.root;
  const bodyGroup = (built.tags['bodyGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const towBoom = (built.tags['towBoom']?.[0] as THREE.Group) ?? new THREE.Group();
  const frontWheels = (built.tags['frontWheel'] ?? []) as THREE.Group[];
  const rearWheels = (built.tags['rearWheel'] ?? []) as THREE.Group[];
  const wheels = [...frontWheels, ...rearWheels];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }

  const shadowGeo = new THREE.PlaneGeometry(2.9, 5.9).rotateX(-Math.PI / 2);
  const shadowPlane = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.68,
    }),
  );
  shadowPlane.position.y = 0.03;
  root.add(shadowPlane);

  // Door plates
  const doorTex = makeTowDoorTexture();
  const doorMat = new THREE.MeshStandardMaterial({
    map: doorTex,
    roughness: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const doorL = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.42), doorMat);
  doorL.position.set(1.036, 0.96, 0.54);
  doorL.rotation.y = Math.PI / 2;
  const doorR = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.42), doorMat);
  doorR.position.set(-1.036, 0.96, 0.54);
  doorR.rotation.y = -Math.PI / 2;
  bodyGroup.add(doorL, doorR);

  // Rooftop Amber Recovery Lightbar
  const lbGroup = new THREE.Group();
  lbGroup.position.set(0, 2.13, 0.48);
  bodyGroup.add(lbGroup);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 });
  lbGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 0.32), trimMat));

  const amberLeftPods: THREE.Mesh[] = [];
  const amberRightPods: THREE.Mesh[] = [];
  const podGeo = new THREE.BoxGeometry(0.22, 0.1, 0.24);
  for (const ox of [0.26, 0.56]) {
    const pL = new THREE.Mesh(
      podGeo,
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xfbbf24,
        emissiveIntensity: 0.12,
        roughness: 0.25,
      }),
    );
    pL.position.set(ox, 0.075, 0);
    lbGroup.add(pL);
    amberLeftPods.push(pL);

    const pR = new THREE.Mesh(
      podGeo,
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xfbbf24,
        emissiveIntensity: 0.12,
        roughness: 0.25,
      }),
    );
    pR.position.set(-ox, 0.075, 0);
    lbGroup.add(pR);
    amberRightPods.push(pR);
  }

  const haloLeft = makeServiceHalo(textures.lightHalo, 0xfbbf24, 1.35, 0.95);
  haloLeft.position.set(0.45, 0.12, 0);
  const haloRight = makeServiceHalo(textures.lightHalo, 0xfbbf24, 1.35, 0.95);
  haloRight.position.set(-0.45, 0.12, 0);
  lbGroup.add(haloLeft, haloRight);

  const amberPointLight = new THREE.PointLight(0xfbbf24, 0, isSoftwareGl ? 13 : 19, 1.7);
  amberPointLight.position.set(0, 0.42, 0);
  lbGroup.add(amberPointLight);

  return {
    root,
    bodyGroup,
    wheels,
    frontWheels,
    towBoom,
    amberLeftPods,
    amberRightPods,
    amberPointLight,
    haloLeft,
    haloRight,
  };
}

export function updateTowLightbar(
  rig: TowTruckRig,
  active: boolean,
  time: number,
  haloBoost: number,
): void {
  if (!active) {
    rig.amberPointLight.intensity = 0;
    rig.amberLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
    rig.amberRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
    (rig.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (rig.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    return;
  }

  const cycL = (time * 2.4) % 1;
  const cycR = (time * 2.4 + 0.5) % 1;
  const pwrL = cycL < 0.16 || (cycL > 0.24 && cycL < 0.4) ? 1.0 : 0.08;
  const pwrR = cycR < 0.16 || (cycR > 0.24 && cycR < 0.4) ? 1.0 : 0.08;

  rig.amberLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrL * 5.0));
  rig.amberRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = pwrR * 5.0));
  rig.amberPointLight.intensity = Math.max(pwrL, pwrR) * 14;
  (rig.haloLeft.material as THREE.SpriteMaterial).opacity = pwrL * 0.68 * haloBoost;
  (rig.haloRight.material as THREE.SpriteMaterial).opacity = pwrR * 0.68 * haloBoost;
}
