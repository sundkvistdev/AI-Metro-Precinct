import * as THREE from 'three';
import { AssetIssue, CrashPartRole, EngineConfigAsset, LoadedJsonAssets } from '../assets/assetTypes';
import {
  buildJsonModel,
  buildMagentaCubeModel,
  BuiltJsonModel,
} from '../assets/jsonModelBuilder';
import { TextureRegistry } from '../assets/textureRegistry';
import { PoliceLiveryId, PoliceVehicleKind } from './types';

export type VehiclesConfig = EngineConfigAsset['vehicles'];
export type PoliceLiverySpec = VehiclesConfig['liveries'][string];

export interface DetachablePartRef {
  id: string;
  object: THREE.Object3D;
  localOffset: THREE.Vector3;
  role: CrashPartRole;
  minStrikeSpeed: number;
  hp: number;
  maxHp: number;
  radius: number;
  detached: boolean;
  isLightbar?: boolean;
  isWheel?: boolean;
}

export interface LightbarRig {
  group: THREE.Group;
  standardShellGroup: THREE.Group;
  vectorPodsGroup: THREE.Group;
  miniBeaconGroup: THREE.Group;
  visorStrobeGroup: THREE.Group;
  grilleStrobeGroup: THREE.Group;
  visorStealthActive: boolean;
  detached: boolean;
  headlightLeftDetached: boolean;
  headlightRightDetached: boolean;
  taillightLeftDetached: boolean;
  taillightRightDetached: boolean;
  redPointLight: THREE.PointLight;
  bluePointLight: THREE.PointLight;
  cookieLeft: THREE.Mesh;
  cookieRight: THREE.Mesh;
  ledLeftPods: THREE.Mesh[];
  ledRightPods: THREE.Mesh[];
  ledCenterPods: THREE.Mesh[];
  halogenLeftBulb: THREE.Mesh;
  halogenRightBulb: THREE.Mesh;
  halogenCenterBulb: THREE.Mesh;
  rotatorLeft: THREE.Group;
  rotatorRight: THREE.Group;
  rotatorCenter: THREE.Group;
  vectorPodBulbs: THREE.Mesh[];
  trafficAdvisorBulbs: THREE.Mesh[];
  miniRotatorLeft: THREE.Group;
  miniRotatorRight: THREE.Group;
  miniBeaconLeftMat: THREE.MeshPhysicalMaterial;
  miniBeaconRightMat: THREE.MeshPhysicalMaterial;
  visorLeftPods: THREE.Mesh[];
  visorRightPods: THREE.Mesh[];
  grilleStrobeLeft: THREE.Mesh;
  grilleStrobeRight: THREE.Mesh;
  rearDeckRed: THREE.Mesh;
  rearDeckBlue: THREE.Mesh;
  leftLensMat: THREE.MeshPhysicalMaterial;
  rightLensMat: THREE.MeshPhysicalMaterial;
  headlightLeftMat: THREE.MeshStandardMaterial;
  headlightRightMat: THREE.MeshStandardMaterial;
  taillightLeftMat: THREE.MeshStandardMaterial;
  taillightRightMat: THREE.MeshStandardMaterial;
  haloLeft: THREE.Sprite;
  haloRight: THREE.Sprite;
  haloCenter: THREE.Sprite;
  haloRearLeft: THREE.Sprite;
  haloRearRight: THREE.Sprite;
  haloHeadLeft: THREE.Sprite;
  haloHeadRight: THREE.Sprite;
  haloVisorLeft: THREE.Sprite;
  haloVisorRight: THREE.Sprite;
}

export interface PoliceCruiserRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  frontWheels: THREE.Group[];
  lightbar: LightbarRig;
  cabinCrewGroup: THREE.Group;
  clickableMesh: THREE.Mesh;
  detachableParts: DetachablePartRef[];
  setBaseColor: (colorHex: number) => void;
}

export interface CivilianCarRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  detachableParts: DetachablePartRef[];
}

export interface HumanoidRig {
  root: THREE.Group;
  torso: THREE.Group;
  torsoBaseY: number;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  head: THREE.Group;
  muzzleFlash: THREE.Mesh | null;
  threatRing: THREE.Mesh | null;
}

const liveryTexCache = new Map<string, THREE.CanvasTexture>();

export function disposeLiveryTextureCache(): void {
  for (const tex of liveryTexCache.values()) {
    tex.dispose();
  }
  liveryTexCache.clear();
}

function makeHaloSprite(
  texture: THREE.CanvasTexture,
  colorHex: number,
  scaleX: number,
  scaleY: number,
  opacity: number,
): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: texture,
    color: colorHex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.renderOrder = 6;
  return sprite;
}

function unitCallsignNum(livery: PoliceLiverySpec, unitNum: number): string {
  if (unitNum === 6) return '301';
  if (unitNum === 7) return '401';
  return livery.callsignNum;
}

function getLiveryStripeTexture(
  livery: PoliceLiverySpec,
  unitNum: number,
): THREE.CanvasTexture {
  const callsign = unitCallsignNum(livery, unitNum);
  const key = `stripe:${livery.id}:${callsign}`;
  const existing = liveryTexCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 96);
  ctx.fillStyle = livery.stripeHex;
  ctx.fillRect(0, 30, 512, 34);
  ctx.fillStyle = livery.accentHex;
  ctx.fillRect(0, 20, 512, 8);
  ctx.fillRect(0, 66, 512, 6);

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    const x = 356 + i * 30;
    ctx.moveTo(x, 8);
    ctx.lineTo(x + 18, 8);
    ctx.lineTo(x + 4, 88);
    ctx.lineTo(x - 14, 88);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(9, 13, 20, 0.9)';
  ctx.lineWidth = 4;
  ctx.font = 'bold 24px sans-serif';
  ctx.textBaseline = 'middle';
  const label = `${livery.agencyLabel} · ${callsign}`;
  ctx.strokeText(label, 22, 48);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 22, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  liveryTexCache.set(key, tex);
  return tex;
}

function getRoofCallsignTexture(
  livery: PoliceLiverySpec,
  unitNum: number,
): THREE.CanvasTexture {
  const callsign = unitCallsignNum(livery, unitNum);
  const key = `roof:${livery.id}:${callsign}`;
  const existing = liveryTexCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const secHex = parseInt(livery.secondaryPaint.replace('#', ''), 16);
  const darkPlate = secHex === 0x1e293b;
  ctx.fillStyle = darkPlate ? '#0f172a' : '#f8fafc';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = livery.stripeHex;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 232, 232);

  ctx.fillStyle = darkPlate ? '#f8fafc' : '#0f172a';
  ctx.font = '900 104px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(callsign, 128, 116);

  ctx.fillStyle = livery.stripeHex;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(livery.agencyLabel, 128, 198);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  liveryTexCache.set(key, tex);
  return tex;
}

function getRearChevronTexture(livery: PoliceLiverySpec): THREE.CanvasTexture {
  const key = `chevron:${livery.id}`;
  const existing = liveryTexCache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = livery.chevronSecondary;
  ctx.fillRect(0, 0, 256, 64);

  ctx.fillStyle = livery.chevronPrimary;
  for (let x = -40; x < 300; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 17, 64);
    ctx.lineTo(x + 36, 0);
    ctx.lineTo(x + 19, 0);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(74, 16, 108, 32);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POLICE', 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  liveryTexCache.set(key, tex);
  return tex;
}

function attachLiveryDecals(
  bodyGroup: THREE.Group,
  livery: PoliceLiverySpec,
  chassis: VehiclesConfig['chassis'][PoliceVehicleKind],
  unitNumber: number,
): void {
  const stripeTex = getLiveryStripeTexture(livery, unitNumber);
  const roofTex = getRoofCallsignTexture(livery, unitNumber);
  const chevronTex = getRearChevronTexture(livery);

  const stripeMat = new THREE.MeshStandardMaterial({
    map: stripeTex,
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.34,
    metalness: 0.15,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const sideGeo = new THREE.PlaneGeometry(chassis.stripeW, chassis.stripeH);
  const sideL = new THREE.Mesh(sideGeo, stripeMat);
  sideL.position.set(chassis.sideDecalX, chassis.sideDecalY, chassis.sideDecalZ);
  sideL.rotation.y = Math.PI / 2;

  const sideR = new THREE.Mesh(sideGeo, stripeMat);
  sideR.position.set(-chassis.sideDecalX, chassis.sideDecalY, chassis.sideDecalZ);
  sideR.rotation.y = -Math.PI / 2;

  const roofPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 0.95),
    new THREE.MeshStandardMaterial({
      map: roofTex,
      roughness: 0.42,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  roofPlate.rotation.x = -Math.PI / 2;
  roofPlate.position.set(0, chassis.roofPlateY, chassis.roofPlateZ);

  const rearPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.58, 0.24),
    new THREE.MeshStandardMaterial({
      map: chevronTex,
      roughness: 0.36,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  rearPanel.rotation.y = Math.PI;
  rearPanel.position.set(0, chassis.rearChevronY, chassis.rearChevronZ);

  bodyGroup.add(sideL, sideR, roofPlate, rearPanel);
}

function collectCrashPartsFromBuilt(
  root: THREE.Group,
  built: BuiltJsonModel,
): DetachablePartRef[] {
  const parts: DetachablePartRef[] = [];
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const wp = new THREE.Vector3();

  for (const cp of built.crashParts) {
    cp.object.getWorldPosition(wp).applyMatrix4(invRoot);
    parts.push({
      id: cp.id,
      object: cp.object,
      localOffset: wp.clone(),
      role: cp.spec.role,
      minStrikeSpeed: cp.spec.minStrikeSpeed,
      hp: cp.spec.health,
      maxHp: cp.spec.health,
      radius: cp.spec.radius ?? 0.45,
      detached: false,
      isWheel: cp.spec.isWheel ?? cp.spec.role === 'wheel',
      isLightbar: cp.spec.isLightbar ?? cp.spec.role === 'lightbar',
    });
  }
  return parts;
}

function buildModelOrMagentaCube(
  modelKey: string,
  fallbackSize: [number, number, number],
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  colorOverrides?: Record<string, number>,
  textureOverrides?: Record<string, string>,
  onAssetIssue?: (issue: AssetIssue) => void,
): BuiltJsonModel {
  const modelDef = assets.models[modelKey];
  if (!modelDef) {
    console.error(`[MISSING MODEL] "${modelKey}" not found; spawning magenta cube fallback.`);
    onAssetIssue?.({
      severity: 'error',
      category: 'model',
      id: modelKey,
      path: assets.manifest.models[modelKey] ?? modelKey,
      message: 'Model missing from pack (magenta cube fallback rendered)',
    });
    return buildMagentaCubeModel(modelKey, fallbackSize);
  }

  return buildJsonModel(
    modelDef,
    textures.byId,
    colorOverrides,
    textureOverrides,
    textures.magentaFallback,
    (missingTexRef) => {
      console.error(
        `[MISSING MODEL TEXTURE] Model "${modelKey}" references missing texture "${missingTexRef}".`,
      );
      onAssetIssue?.({
        severity: 'error',
        category: 'texture',
        id: missingTexRef,
        path: `model:${modelKey}`,
        message: `Texture "${missingTexRef}" referenced by "${modelKey}" is missing (magenta texture fallback applied)`,
      });
    },
  );
}

export function createPoliceCruiser(
  unitNumber: number,
  vehicleKind: PoliceVehicleKind,
  liveryId: PoliceLiveryId,
  vehiclesConfig: VehiclesConfig,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  isSoftwareGl: boolean,
  baseColorHex?: number,
  onAssetIssue?: (issue: AssetIssue) => void,
): PoliceCruiserRig {
  const chassis = vehiclesConfig.chassis[vehicleKind] ?? vehiclesConfig.chassis['sedan'];
  const livery =
    vehiclesConfig.liveries[liveryId] ?? Object.values(vehiclesConfig.liveries)[0];
  const initialBaseColor =
    baseColorHex ?? parseInt(livery.primaryPaint.replace('#', ''), 16);

  const built = buildModelOrMagentaCube(
    chassis.modelRef,
    [chassis.halfW * 2, chassis.obbHeight, chassis.halfL * 2],
    assets,
    textures,
    {
      black_paint: initialBaseColor,
      white_paint: initialBaseColor,
    },
    {
      door_decal: livery.doorTextureRef,
    },
    onAssetIssue,
  );
  const root = built.root;

  const doorDecalMat = built.materials['door_decal'] as THREE.MeshPhysicalMaterial | undefined;
  if (doorDecalMat) {
    doorDecalMat.transparent = true;
    doorDecalMat.alphaTest = 0.04;
    doorDecalMat.polygonOffset = true;
    doorDecalMat.polygonOffsetFactor = -2;
    doorDecalMat.needsUpdate = true;
  }

  const paintMatKeys = ['black_paint', 'white_paint'];
  const setBaseColor = (colorHex: number): void => {
    for (const k of paintMatKeys) {
      const mat = built.materials[k] as THREE.MeshStandardMaterial | undefined;
      if (mat && mat.color) {
        mat.color.setHex(colorHex);
      }
    }
  };

  const bodyGroup = (built.tags['bodyGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  if (!built.isFallbackCube) {
    attachLiveryDecals(bodyGroup, livery, chassis, unitNumber);
  }

  const cabinCrewGroup = (built.tags['cabinCrewGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const frontWheels = (built.tags['frontWheel'] ?? []) as THREE.Group[];
  const rearWheels = (built.tags['rearWheel'] ?? []) as THREE.Group[];
  const wheels = [...frontWheels, ...rearWheels];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }

  const headY =
    vehicleKind === 'apc'
      ? 1.06
      : vehicleKind === 'suv' || vehicleKind === 'van'
      ? 0.9
      : 0.78;
  const headZ =
    vehicleKind === 'apc'
      ? 2.58
      : vehicleKind === 'van'
      ? 2.52
      : vehicleKind === 'suv'
      ? 2.41
      : 2.38;

  const headlightLeftMesh = root.getObjectByName('headlight_l') as THREE.Mesh | undefined;
  const headlightRightMesh = root.getObjectByName('headlight_r') as THREE.Mesh | undefined;
  const taillightLeftMesh = root.getObjectByName('taillight_l') as THREE.Mesh | undefined;
  const taillightRightMesh = root.getObjectByName('taillight_r') as THREE.Mesh | undefined;

  const headlightLeftMat = headlightLeftMesh
    ? (headlightLeftMesh.material as THREE.MeshStandardMaterial).clone()
    : new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe2e8f0, emissiveIntensity: 1.5 });
  const headlightRightMat = headlightRightMesh
    ? (headlightRightMesh.material as THREE.MeshStandardMaterial).clone()
    : headlightLeftMat.clone();
  const taillightLeftMat = taillightLeftMesh
    ? (taillightLeftMesh.material as THREE.MeshStandardMaterial).clone()
    : new THREE.MeshStandardMaterial({ color: 0xb91c1c, emissive: 0xef4444, emissiveIntensity: 1.4 });
  const taillightRightMat = taillightRightMesh
    ? (taillightRightMesh.material as THREE.MeshStandardMaterial).clone()
    : taillightLeftMat.clone();

  if (headlightLeftMesh) headlightLeftMesh.material = headlightLeftMat;
  if (headlightRightMesh) headlightRightMesh.material = headlightRightMat;
  if (taillightLeftMesh) taillightLeftMesh.material = taillightLeftMat;
  if (taillightRightMesh) taillightRightMesh.material = taillightRightMat;

  const haloHeadLeft = makeHaloSprite(textures.lightHalo, 0xfef3c7, 0.9, 0.75, 0.35);
  haloHeadLeft.position.set(0.68, headY - 0.12, headZ);
  const haloHeadRight = makeHaloSprite(textures.lightHalo, 0xfef3c7, 0.9, 0.75, 0.35);
  haloHeadRight.position.set(-0.68, headY - 0.12, headZ);
  bodyGroup.add(haloHeadLeft, haloHeadRight);

  const shadowGeo = new THREE.PlaneGeometry(chassis.shadowSize[0], chassis.shadowSize[1]);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowPlane = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.68,
    }),
  );
  shadowPlane.position.y = chassis.shadowY;
  root.add(shadowPlane);

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x1e242d,
    roughness: 0.76,
    metalness: 0.25,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd1d8e0,
    roughness: 0.22,
    metalness: 0.9,
  });

  const [lbX, lbY, lbZ] = chassis.lightbarPos;
  const lbGroup = new THREE.Group();
  lbGroup.name = 'roof_lightbar';
  lbGroup.position.set(lbX, lbY, lbZ);
  bodyGroup.add(lbGroup);

  const standardShellGroup = new THREE.Group();
  standardShellGroup.name = 'lightbar_standard_shell';
  lbGroup.add(standardShellGroup);

  const mountGeo = new THREE.BoxGeometry(0.14, 0.08, 0.24);
  const mountL = new THREE.Mesh(mountGeo, trimMat);
  mountL.position.set(0.54, -0.02, 0);
  const mountR = new THREE.Mesh(mountGeo, trimMat);
  mountR.position.set(-0.54, -0.02, 0);
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.04, 0.34), trimMat);
  basePlate.position.set(0, 0.03, 0);
  const centerHousing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.34), trimMat);
  centerHousing.position.set(0, 0.1, 0);
  standardShellGroup.add(mountL, mountR, basePlate, centerHousing);

  const leftLensMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8232c,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.18,
    roughness: 0.48,
    metalness: 0.04,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
  });
  const rightLensMat = new THREE.MeshPhysicalMaterial({
    color: 0x2558c9,
    emissive: 0x1e3a8a,
    emissiveIntensity: 0.18,
    roughness: 0.48,
    metalness: 0.04,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
  });
  const centerLensMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbe3ec,
    roughness: 0.46,
    metalness: 0.02,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
  });

  const leftDome = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.32), leftLensMat);
  leftDome.position.set(0.45, 0.11, 0);
  leftDome.renderOrder = 3;
  const rightDome = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.14, 0.32), rightLensMat);
  rightDome.position.set(-0.45, 0.11, 0);
  rightDome.renderOrder = 3;
  const centerDome = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.32), centerLensMat);
  centerDome.position.set(0, 0.11, 0);
  centerDome.renderOrder = 3;
  standardShellGroup.add(leftDome, rightDome, centerDome);

  const ledLeftPods: THREE.Mesh[] = [];
  const ledRightPods: THREE.Mesh[] = [];
  const ledCenterPods: THREE.Mesh[] = [];
  const ledPodGeo = new THREE.BoxGeometry(0.14, 0.065, 0.24);

  for (const offset of [0.28, 0.46, 0.64]) {
    const podL = new THREE.Mesh(
      ledPodGeo,
      new THREE.MeshStandardMaterial({
        color: 0xff2222,
        emissive: 0xff1a1a,
        emissiveIntensity: 0.2,
        roughness: 0.25,
      }),
    );
    podL.position.set(offset, 0.105, 0);
    standardShellGroup.add(podL);
    ledLeftPods.push(podL);

    const podR = new THREE.Mesh(
      ledPodGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2266ff,
        emissive: 0x1d70ff,
        emissiveIntensity: 0.2,
        roughness: 0.25,
      }),
    );
    podR.position.set(-offset, 0.105, 0);
    standardShellGroup.add(podR);
    ledRightPods.push(podR);
  }

  for (const offset of [-0.07, 0.07]) {
    const podC = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.06, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0xffffff,
        emissiveIntensity: 0.15,
        roughness: 0.25,
      }),
    );
    podC.position.set(offset, 0.105, 0);
    standardShellGroup.add(podC);
    ledCenterPods.push(podC);
  }

  const halogenGeo = new THREE.SphereGeometry(0.058, 12, 10);
  const halogenLeftBulb = new THREE.Mesh(
    halogenGeo,
    new THREE.MeshStandardMaterial({ color: 0xff6b4a, emissive: 0xff2b1a, emissiveIntensity: 0.1 }),
  );
  halogenLeftBulb.position.set(0.45, 0.105, 0);

  const halogenRightBulb = new THREE.Mesh(
    halogenGeo,
    new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x2563eb, emissiveIntensity: 0.1 }),
  );
  halogenRightBulb.position.set(-0.45, 0.105, 0);

  const halogenCenterBulb = new THREE.Mesh(
    halogenGeo,
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfbbf24, emissiveIntensity: 0.1 }),
  );
  halogenCenterBulb.position.set(0, 0.105, 0);
  standardShellGroup.add(halogenLeftBulb, halogenRightBulb, halogenCenterBulb);

  const buildRotator = (parent: THREE.Group, xPos: number, yPos = 0.105, zPos = 0): THREE.Group => {
    const rot = new THREE.Group();
    rot.position.set(xPos, yPos, zPos);

    const dish = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.062, 0.092, 12, 1, true, 0, Math.PI),
      chromeMat,
    );
    dish.rotation.z = Math.PI / 2;
    dish.rotation.y = Math.PI / 2;
    rot.add(dish);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff7ed }),
    );
    bulb.position.z = 0.022;
    rot.add(bulb);

    parent.add(rot);
    return rot;
  };

  const rotatorLeft = buildRotator(standardShellGroup, 0.45);
  const rotatorRight = buildRotator(standardShellGroup, -0.45);
  const rotatorCenter = buildRotator(standardShellGroup, 0);

  // 4) Vector V-Pods + rear amber traffic advisor
  const vectorPodsGroup = new THREE.Group();
  vectorPodsGroup.name = 'lightbar_vector_pods';
  vectorPodsGroup.visible = false;
  lbGroup.add(vectorPodsGroup);

  const vFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 0.12), trimMat);
  vFrameL.position.set(0.35, 0.03, 0.04);
  vFrameL.rotation.y = -0.34;
  const vFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 0.12), trimMat);
  vFrameR.position.set(-0.35, 0.03, 0.04);
  vFrameR.rotation.y = 0.34;
  const advisorHousing = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.07, 0.1), trimMat);
  advisorHousing.position.set(0, 0.05, -0.18);
  vectorPodsGroup.add(vFrameL, vFrameR, advisorHousing);

  const vectorPodConfigs: Array<{ x: number; z: number; color: number; emissive: number }> = [
    { x: 0.66, z: -0.06, color: 0xc8232c, emissive: 0xff2020 },
    { x: 0.34, z: 0.06, color: 0xc8232c, emissive: 0xff2828 },
    { x: 0.0, z: 0.18, color: 0xf8fafc, emissive: 0xffffff },
    { x: -0.34, z: 0.06, color: 0x2558c9, emissive: 0x2070ff },
    { x: -0.66, z: -0.06, color: 0x2558c9, emissive: 0x2070ff },
  ];
  const vectorPodBulbs: THREE.Mesh[] = [];
  for (const cfg of vectorPodConfigs) {
    const podHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.04, 10), trimMat);
    podHousing.position.set(cfg.x, 0.06, cfg.z);
    const dome = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.105, 0.12, 10),
      new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        clearcoat: 0.65,
      }),
    );
    dome.position.set(cfg.x, 0.13, cfg.z);
    dome.renderOrder = 3;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshStandardMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 0.15,
      }),
    );
    bulb.position.set(cfg.x, 0.13, cfg.z);
    vectorPodsGroup.add(podHousing, dome, bulb);
    vectorPodBulbs.push(bulb);
  }

  const trafficAdvisorBulbs: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const ax = (i - 3) * 0.18;
    const isEnd = i === 0 || i === 6;
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.045, 0.03),
      new THREE.MeshStandardMaterial({
        color: isEnd ? (i === 0 ? 0xef4444 : 0x3b82f6) : 0xf59e0b,
        emissive: isEnd ? (i === 0 ? 0xff2020 : 0x2070ff) : 0xf59e0b,
        emissiveIntensity: 0.1,
      }),
    );
    bulb.position.set(ax, 0.055, -0.235);
    vectorPodsGroup.add(bulb);
    trafficAdvisorBulbs.push(bulb);
  }

  // 5) Mini Dual Beacon
  const miniBeaconGroup = new THREE.Group();
  miniBeaconGroup.name = 'lightbar_mini_beacon';
  miniBeaconGroup.visible = false;
  lbGroup.add(miniBeaconGroup);

  const miniBase = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 0.28), trimMat);
  miniBase.position.set(0, 0.03, 0);
  const miniCenterCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.24), chromeMat);
  miniCenterCap.position.set(0, 0.095, 0);
  miniBeaconGroup.add(miniBase, miniCenterCap);

  const miniBeaconLeftMat = leftLensMat.clone();
  const miniBeaconRightMat = rightLensMat.clone();
  const miniDomeL = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.14, 12), miniBeaconLeftMat);
  miniDomeL.position.set(0.16, 0.11, 0);
  miniDomeL.renderOrder = 3;
  const miniDomeR = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.14, 12), miniBeaconRightMat);
  miniDomeR.position.set(-0.16, 0.11, 0);
  miniDomeR.renderOrder = 3;
  miniBeaconGroup.add(miniDomeL, miniDomeR);
  const miniRotatorLeft = buildRotator(miniBeaconGroup, 0.16, 0.105, 0);
  const miniRotatorRight = buildRotator(miniBeaconGroup, -0.16, 0.105, 0);

  // 6) Interior Visor Stealth Pods + Front Grille Strobes (mounted on bodyGroup)
  const visorPos =
    vehicleKind === 'apc'
      ? [0, 2.02, 1.04]
      : vehicleKind === 'van'
      ? [0, 1.98, 1.24]
      : vehicleKind === 'suv'
      ? [0, 1.72, 0.56]
      : [0, 1.37, 0.42];
  const visorStrobeGroup = new THREE.Group();
  visorStrobeGroup.name = 'lightbar_visor_stealth';
  visorStrobeGroup.position.set(visorPos[0], visorPos[1], visorPos[2]);
  visorStrobeGroup.visible = false;
  bodyGroup.add(visorStrobeGroup);

  const visorBackL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.065, 0.08), trimMat);
  visorBackL.position.set(0.28, 0, -0.02);
  const visorBackR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.065, 0.08), trimMat);
  visorBackR.position.set(-0.28, 0, -0.02);
  visorStrobeGroup.add(visorBackL, visorBackR);

  const visorLeftPods: THREE.Mesh[] = [];
  const visorRightPods: THREE.Mesh[] = [];
  for (const offset of [0.18, 0.36]) {
    const vpL = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.05, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1a1a, emissiveIntensity: 0.1 }),
    );
    vpL.position.set(offset, 0, 0.03);
    visorStrobeGroup.add(vpL);
    visorLeftPods.push(vpL);

    const vpR = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.05, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x1d70ff, emissiveIntensity: 0.1 }),
    );
    vpR.position.set(-offset, 0, 0.03);
    visorStrobeGroup.add(vpR);
    visorRightPods.push(vpR);
  }

  const grillePos =
    vehicleKind === 'apc'
      ? [0, 0.92, 2.61]
      : vehicleKind === 'van'
      ? [0, 0.78, 2.55]
      : vehicleKind === 'suv'
      ? [0, 0.78, 2.45]
      : [0, 0.65, 2.43];
  const grilleStrobeGroup = new THREE.Group();
  grilleStrobeGroup.name = 'lightbar_grille_strobes';
  grilleStrobeGroup.position.set(grillePos[0], grillePos[1], grillePos[2]);
  grilleStrobeGroup.visible = false;
  bodyGroup.add(grilleStrobeGroup);

  const grilleStrobeLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.055, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2020, emissiveIntensity: 0.1 }),
  );
  grilleStrobeLeft.position.set(0.24, 0, 0);
  const grilleStrobeRight = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.055, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x2070ff, emissiveIntensity: 0.1 }),
  );
  grilleStrobeRight.position.set(-0.24, 0, 0);
  grilleStrobeGroup.add(grilleStrobeLeft, grilleStrobeRight);

  const cookieGeo = new THREE.PlaneGeometry(13.5, 13.5).rotateX(-Math.PI / 2);
  const cookieLeft = new THREE.Mesh(
    cookieGeo,
    new THREE.MeshBasicMaterial({
      map: textures.lightCookieRotator,
      color: 0xff2828,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  cookieLeft.position.set(0.45, 0.055, lbZ);
  cookieLeft.visible = false;
  cookieLeft.renderOrder = 2;

  const cookieRight = new THREE.Mesh(
    cookieGeo,
    new THREE.MeshBasicMaterial({
      map: textures.lightCookieRotator,
      color: 0x2674ff,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  cookieRight.position.set(-0.45, 0.055, lbZ);
  cookieRight.visible = false;
  cookieRight.renderOrder = 2;
  root.add(cookieLeft, cookieRight);

  const rearDeckY =
    vehicleKind === 'apc'
      ? 2.15
      : vehicleKind === 'van'
      ? 2.02
      : vehicleKind === 'suv'
      ? 1.66
      : 1.18;
  const rearDeckZ =
    vehicleKind === 'apc'
      ? -2.51
      : vehicleKind === 'van'
      ? -2.42
      : vehicleKind === 'suv'
      ? -2.24
      : -1.16;
  const rearDeckRed = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.055, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff1111, emissiveIntensity: 0 }),
  );
  rearDeckRed.position.set(0.32, rearDeckY, rearDeckZ);
  const rearDeckBlue = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.055, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d6eff, emissiveIntensity: 0 }),
  );
  rearDeckBlue.position.set(-0.32, rearDeckY, rearDeckZ);
  bodyGroup.add(rearDeckRed, rearDeckBlue);

  const haloLeft = makeHaloSprite(textures.lightHalo, 0xff2b2b, 1.4, 1.0, 0);
  haloLeft.position.set(0.46, 0.14, 0);
  const haloRight = makeHaloSprite(textures.lightHalo, 0x2b7fff, 1.4, 1.0, 0);
  haloRight.position.set(-0.46, 0.14, 0);
  const haloCenter = makeHaloSprite(textures.lightHalo, 0xfef3c7, 0.95, 0.75, 0);
  haloCenter.position.set(0, 0.14, 0);
  lbGroup.add(haloLeft, haloRight, haloCenter);

  const haloVisorLeft = makeHaloSprite(textures.lightHalo, 0xff2b2b, 0.9, 0.65, 0);
  haloVisorLeft.position.set(0.28, 0, 0.1);
  const haloVisorRight = makeHaloSprite(textures.lightHalo, 0x2b7fff, 0.9, 0.65, 0);
  haloVisorRight.position.set(-0.28, 0, 0.1);
  visorStrobeGroup.add(haloVisorLeft, haloVisorRight);

  const haloRearLeft = makeHaloSprite(textures.lightHalo, 0xff2b2b, 0.7, 0.55, 0);
  haloRearLeft.position.set(0.32, rearDeckY, rearDeckZ - 0.08);
  const haloRearRight = makeHaloSprite(textures.lightHalo, 0x2b7fff, 0.7, 0.55, 0);
  haloRearRight.position.set(-0.32, rearDeckY, rearDeckZ - 0.08);
  bodyGroup.add(haloRearLeft, haloRearRight);

  const lightRange = isSoftwareGl ? 15 : 22;
  const redPointLight = new THREE.PointLight(0xff2020, 0, lightRange, 1.65);
  redPointLight.position.set(0.55, 0.42, 0);
  const bluePointLight = new THREE.PointLight(0x2070ff, 0, lightRange, 1.65);
  bluePointLight.position.set(-0.55, 0.42, 0);
  lbGroup.add(redPointLight, bluePointLight);

  const clickableMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      chassis.hitboxSize[0],
      chassis.hitboxSize[1],
      chassis.hitboxSize[2],
    ),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  clickableMesh.position.y = chassis.hitboxY;
  clickableMesh.userData.unitId = vehiclesConfig.stationBays[unitNumber - 1]?.id ?? `unit-${unitNumber}`;
  root.add(clickableMesh);

  const detachableParts = collectCrashPartsFromBuilt(root, built);
  detachableParts.push({
    id: 'roof_lightbar',
    object: lbGroup,
    localOffset: new THREE.Vector3(lbX, lbY, lbZ),
    role: 'lightbar',
    minStrikeSpeed: 15.2,
    hp: 42,
    maxHp: 42,
    radius: 0.65,
    detached: false,
    isLightbar: true,
  });

  return {
    root,
    bodyGroup,
    wheels,
    frontWheels,
    cabinCrewGroup,
    clickableMesh,
    detachableParts,
    setBaseColor,
    lightbar: {
      group: lbGroup,
      standardShellGroup,
      vectorPodsGroup,
      miniBeaconGroup,
      visorStrobeGroup,
      grilleStrobeGroup,
      visorStealthActive: false,
      detached: false,
      headlightLeftDetached: false,
      headlightRightDetached: false,
      taillightLeftDetached: false,
      taillightRightDetached: false,
      redPointLight,
      bluePointLight,
      cookieLeft,
      cookieRight,
      ledLeftPods,
      ledRightPods,
      ledCenterPods,
      halogenLeftBulb,
      halogenRightBulb,
      halogenCenterBulb,
      rotatorLeft,
      rotatorRight,
      rotatorCenter,
      vectorPodBulbs,
      trafficAdvisorBulbs,
      miniRotatorLeft,
      miniRotatorRight,
      miniBeaconLeftMat,
      miniBeaconRightMat,
      visorLeftPods,
      visorRightPods,
      grilleStrobeLeft,
      grilleStrobeRight,
      rearDeckRed,
      rearDeckBlue,
      leftLensMat,
      rightLensMat,
      headlightLeftMat,
      headlightRightMat,
      taillightLeftMat,
      taillightRightMat,
      haloLeft,
      haloRight,
      haloCenter,
      haloRearLeft,
      haloRearRight,
      haloHeadLeft,
      haloHeadRight,
      haloVisorLeft,
      haloVisorRight,
    },
  };
}

export function createCivilianCar(
  variant: string,
  colorHex: number,
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  onAssetIssue?: (issue: AssetIssue) => void,
): CivilianCarRig {
  const shorthandMap: Record<string, string> = {
    sedan: 'civilian_sedan',
    hatch: 'civilian_hatch',
    taxi: 'civilian_taxi',
    van: 'civilian_van',
  };
  const modelKey = shorthandMap[variant] ?? variant;

  const overrides =
    variant === 'taxi'
      ? undefined
      : { paint: colorHex, black_paint: colorHex, white_paint: colorHex };
  const built = buildModelOrMagentaCube(
    modelKey,
    [1.85, 1.45, 4.4],
    assets,
    textures,
    overrides,
    undefined,
    onAssetIssue,
  );
  const root = built.root;

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const shadowW = THREE.MathUtils.clamp((size.x || 1.9) * 1.18, 1.8, 4.2);
  const shadowL = THREE.MathUtils.clamp((size.z || 4.3) * 1.05, 3.2, 8.0);

  const shadowGeo = new THREE.PlaneGeometry(shadowW, shadowL);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowPlane = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    }),
  );
  shadowPlane.position.y = 0.025;
  root.add(shadowPlane);

  const bodyGroup = (built.tags['bodyGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const taggedWheels = built.tags['wheel'] ?? [];
  const frontRear = [
    ...(built.tags['frontWheel'] ?? []),
    ...(built.tags['rearWheel'] ?? []),
  ];
  const wheels = (taggedWheels.length > 0 ? taggedWheels : frontRear) as THREE.Group[];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }
  const detachableParts = collectCrashPartsFromBuilt(root, built);

  return { root, bodyGroup, wheels, detachableParts };
}

export function createHumanoid(
  role: 'officer' | 'heavy_officer' | 'suspect' | 'pedestrian',
  assets: LoadedJsonAssets,
  textures: TextureRegistry,
  shirtHex?: number,
  onAssetIssue?: (issue: AssetIssue) => void,
  modelKeyOverride?: string,
): HumanoidRig {
  const modelKey =
    modelKeyOverride ??
    (role === 'heavy_officer'
      ? 'heavy_officer_humanoid'
      : role === 'officer'
      ? 'officer_humanoid'
      : role === 'suspect'
      ? 'suspect_humanoid'
      : 'pedestrian_humanoid');

  const overrides =
    role === 'pedestrian' && shirtHex !== undefined ? { shirt: shirtHex } : undefined;
  const built = buildModelOrMagentaCube(
    modelKey,
    [0.65, 1.75, 0.45],
    assets,
    textures,
    overrides,
    undefined,
    onAssetIssue,
  );
  const root = built.root;

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    }),
  );
  shadowPlane.position.y = 0.03;
  root.add(shadowPlane);

  let threatRing: THREE.Mesh | null = null;
  if (role === 'suspect') {
    threatRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    threatRing.position.y = 0.06;
    root.add(threatRing);
  }

  const torso = (built.tags['torso']?.[0] as THREE.Group) ?? new THREE.Group();
  return {
    root,
    torso,
    torsoBaseY: torso.position.y,
    leftLeg: (built.tags['leftLeg']?.[0] as THREE.Group) ?? new THREE.Group(),
    rightLeg: (built.tags['rightLeg']?.[0] as THREE.Group) ?? new THREE.Group(),
    leftArm: (built.tags['leftArm']?.[0] as THREE.Group) ?? new THREE.Group(),
    rightArm: (built.tags['rightArm']?.[0] as THREE.Group) ?? new THREE.Group(),
    head: (built.tags['head']?.[0] as THREE.Group) ?? new THREE.Group(),
    muzzleFlash: (built.tags['muzzleFlash']?.[0] as THREE.Mesh) ?? null,
    threatRing,
  };
}
