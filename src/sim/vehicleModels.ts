import * as THREE from 'three';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { buildJsonModel } from '../assets/jsonModelBuilder';
import { ProceduralTexturePack } from './textures';
import {
  LightbarMode,
  PoliceLiveryId,
  PoliceVehicleKind,
} from './types';

export interface BaseColorSwatch {
  id: string;
  label: string;
  hex: number;
}

export const VEHICLE_BASE_COLOR_PALETTE: BaseColorSwatch[] = [
  { id: 'obsidian', label: 'Obsidian', hex: 0x111827 },
  { id: 'pearl', label: 'Fleet White', hex: 0xe2e8f0 },
  { id: 'navy', label: 'Patrol Navy', hex: 0x1e3a8a },
  { id: 'pine', label: 'Sheriff Green', hex: 0x14532d },
  { id: 'slate', label: 'Steel Slate', hex: 0x475569 },
  { id: 'cobalt', label: 'Cobalt Blue', hex: 0x1d4ed8 },
  { id: 'maroon', label: 'Burgundy', hex: 0x7f1d1d },
  { id: 'sand', label: 'Desert Tan', hex: 0x8b7355 },
];

export interface PoliceLiverySpec {
  id: PoliceLiveryId;
  label: string;
  agencyLabel: string;
  callsignNum: string;
  primaryPaint: number;
  secondaryPaint: number;
  stripeHex: string;
  accentHex: string;
  chevronPrimary: string;
  chevronSecondary: string;
  doorTextureRef: string;
}

export const POLICE_LIVERIES: Record<PoliceLiveryId, PoliceLiverySpec> = {
  classic_bw: {
    id: 'classic_bw',
    label: 'Black & White',
    agencyLabel: 'METRO PD',
    callsignNum: '101',
    primaryPaint: 0x10141c,
    secondaryPaint: 0xf1f5f9,
    stripeHex: '#2563eb',
    accentHex: '#facc15',
    chevronPrimary: '#facc15',
    chevronSecondary: '#0f172a',
    doorTextureRef: 'police_door_decal',
  },
  navy_silver: {
    id: 'navy_silver',
    label: 'Navy & Silver',
    agencyLabel: 'INTERCEPTOR',
    callsignNum: '102',
    primaryPaint: 0x1e3a8a,
    secondaryPaint: 0xe2e8f0,
    stripeHex: '#38bdf8',
    accentHex: '#ffffff',
    chevronPrimary: '#fbbf24',
    chevronSecondary: '#1e3a8a',
    doorTextureRef: 'police_door_decal_navy',
  },
  forest_cream: {
    id: 'forest_cream',
    label: 'Sheriff Green',
    agencyLabel: 'COUNTY SHERIFF',
    callsignNum: '103',
    primaryPaint: 0x14532d,
    secondaryPaint: 0xfef3c7,
    stripeHex: '#d97706',
    accentHex: '#fef08a',
    chevronPrimary: '#f59e0b',
    chevronSecondary: '#14532d',
    doorTextureRef: 'police_door_decal_forest',
  },
  slate_cobalt: {
    id: 'slate_cobalt',
    label: 'Tactical Cobalt',
    agencyLabel: 'HIGHWAY K9',
    callsignNum: '104',
    primaryPaint: 0x334155,
    secondaryPaint: 0x1d4ed8,
    stripeHex: '#f8fafc',
    accentHex: '#38bdf8',
    chevronPrimary: '#f97316',
    chevronSecondary: '#1e293b',
    doorTextureRef: 'police_door_decal_slate',
  },
  transport_blue: {
    id: 'transport_blue',
    label: 'Transport Blue',
    agencyLabel: 'CORRECTIONS',
    callsignNum: '205',
    primaryPaint: 0x1d4ed8,
    secondaryPaint: 0xf8fafc,
    stripeHex: '#0f172a',
    accentHex: '#facc15',
    chevronPrimary: '#ef4444',
    chevronSecondary: '#f8fafc',
    doorTextureRef: 'police_door_decal_transport',
  },
  tactical_swat: {
    id: 'tactical_swat',
    label: 'SWAT Tactical',
    agencyLabel: 'METRO SWAT',
    callsignNum: '301',
    primaryPaint: 0x0f172a,
    secondaryPaint: 0x1e293b,
    stripeHex: '#94a3b8',
    accentHex: '#ef4444',
    chevronPrimary: '#dc2626',
    chevronSecondary: '#0f172a',
    doorTextureRef: 'police_door_decal_swat',
  },
};

export interface DetachablePartRef {
  id: string;
  object: THREE.Object3D;
  localOffset: THREE.Vector3;
  minStrikeSpeed: number;
  detached: boolean;
  isLightbar?: boolean;
  isWheel?: boolean;
}

export interface LightbarRig {
  group: THREE.Group;
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

function makeLiveryStripeTexture(livery: PoliceLiverySpec, unitNum: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 96);
  // Crisp lower rocker beltline stripe placed below door emblem so zero overlap occurs
  ctx.fillStyle = livery.stripeHex;
  ctx.fillRect(0, 30, 512, 34);
  ctx.fillStyle = livery.accentHex;
  ctx.fillRect(0, 20, 512, 8);
  ctx.fillRect(0, 66, 512, 6);

  // Diagonal slashes near rear quarter
  ctx.fillStyle = livery.accentHex;
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

  // Unit callsign lettering on quarter rocker
  ctx.strokeStyle = 'rgba(9, 13, 20, 0.9)';
  ctx.lineWidth = 4;
  ctx.font = 'bold 24px sans-serif';
  ctx.textBaseline = 'middle';
  const label = `${livery.agencyLabel} · ${unitCallsignNum(livery, unitNum)}`;
  ctx.strokeText(label, 22, 48);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 22, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoofCallsignTexture(livery: PoliceLiverySpec, unitNum: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const darkPlate = livery.secondaryPaint === 0x1e293b;
  ctx.fillStyle = darkPlate ? '#0f172a' : '#f8fafc';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = livery.stripeHex;
  ctx.lineWidth = 14;
  ctx.strokeRect(12, 12, 232, 232);

  ctx.fillStyle = darkPlate ? '#f8fafc' : '#0f172a';
  ctx.font = '900 104px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(unitCallsignNum(livery, unitNum), 128, 116);

  ctx.fillStyle = livery.stripeHex;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(livery.agencyLabel, 128, 198);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRearChevronTexture(livery: PoliceLiverySpec): THREE.CanvasTexture {
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
  return tex;
}

function attachLiveryDecals(
  bodyGroup: THREE.Group,
  livery: PoliceLiverySpec,
  vehicleKind: PoliceVehicleKind,
  unitNumber: number,
): void {
  const stripeTex = makeLiveryStripeTexture(livery, unitNumber);
  const roofTex = makeRoofCallsignTexture(livery, unitNumber);
  const chevronTex = makeRearChevronTexture(livery);

  const stripeMat = new THREE.MeshStandardMaterial({
    map: stripeTex,
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.34,
    metalness: 0.15,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  // Position side rocker stripe below the door emblem planes so decals never collide or overlap
  const sideX =
    vehicleKind === 'apc'
      ? 1.125
      : vehicleKind === 'van'
      ? 1.045
      : vehicleKind === 'suv'
      ? 0.995
      : 1.005;
  const sideY =
    vehicleKind === 'apc'
      ? 0.88
      : vehicleKind === 'van'
      ? 0.64
      : vehicleKind === 'suv'
      ? 0.67
      : 0.59;
  const sideZ =
    vehicleKind === 'apc' ? -0.15 : vehicleKind === 'van' ? -0.05 : -0.1;
  const stripeW =
    vehicleKind === 'apc' ? 4.4 : vehicleKind === 'van' ? 4.45 : 3.95;
  const stripeH =
    vehicleKind === 'apc' ? 0.16 : vehicleKind === 'van' ? 0.13 : 0.12;

  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(stripeW, stripeH), stripeMat);
  sideL.position.set(sideX, sideY, sideZ);
  sideL.rotation.y = Math.PI / 2;

  const sideR = new THREE.Mesh(new THREE.PlaneGeometry(stripeW, stripeH), stripeMat);
  sideR.position.set(-sideX, sideY, sideZ);
  sideR.rotation.y = -Math.PI / 2;

  // Roof aerial callsign plate
  const roofY =
    vehicleKind === 'apc'
      ? 2.295
      : vehicleKind === 'van'
      ? 2.115
      : vehicleKind === 'suv'
      ? 1.815
      : 1.535;
  const roofZ =
    vehicleKind === 'apc'
      ? -1.96
      : vehicleKind === 'van'
      ? -0.75
      : vehicleKind === 'suv'
      ? -1.12
      : -0.78;
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
  roofPlate.position.set(0, roofY, roofZ);

  // Rear high-visibility safety chevron bumper/tailgate panel
  const rearY =
    vehicleKind === 'apc'
      ? 0.92
      : vehicleKind === 'van'
      ? 0.78
      : vehicleKind === 'suv'
      ? 0.74
      : 0.72;
  const rearZ =
    vehicleKind === 'apc'
      ? -2.578
      : vehicleKind === 'van'
      ? -2.445
      : vehicleKind === 'suv'
      ? -2.385
      : -2.358;
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
  rearPanel.position.set(0, rearY, rearZ);

  bodyGroup.add(sideL, sideR, roofPlate, rearPanel);
}

function collectDetachableParts(
  root: THREE.Group,
  rules: Array<{ name: string; minStrikeSpeed: number; isWheel?: boolean }>,
): DetachablePartRef[] {
  const parts: DetachablePartRef[] = [];
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const wp = new THREE.Vector3();

  for (const rule of rules) {
    const obj = root.getObjectByName(rule.name);
    if (!obj) continue;
    obj.getWorldPosition(wp).applyMatrix4(invRoot);
    parts.push({
      id: rule.name,
      object: obj,
      localOffset: wp.clone(),
      minStrikeSpeed: rule.minStrikeSpeed,
      detached: false,
      isWheel: rule.isWheel,
    });
  }
  return parts;
}

const POLICE_DETACH_RULES: Array<{ name: string; minStrikeSpeed: number; isWheel?: boolean }> = [
  { name: 'mirror_l', minStrikeSpeed: 7.2 },
  { name: 'mirror_r', minStrikeSpeed: 7.2 },
  { name: 'antenna', minStrikeSpeed: 7.6 },
  { name: 'roof_rail_l', minStrikeSpeed: 8.6 },
  { name: 'roof_rail_r', minStrikeSpeed: 8.6 },
  { name: 'exhaust_l', minStrikeSpeed: 8.2 },
  { name: 'exhaust_r', minStrikeSpeed: 8.2 },
  { name: 'front_bumper', minStrikeSpeed: 9.8 },
  { name: 'rear_bumper', minStrikeSpeed: 9.8 },
  { name: 'push_cross_top', minStrikeSpeed: 10.4 },
  { name: 'push_cross_mid', minStrikeSpeed: 10.4 },
  { name: 'push_upright_l', minStrikeSpeed: 11.4 },
  { name: 'push_upright_r', minStrikeSpeed: 11.4 },
  { name: 'headlight_l', minStrikeSpeed: 9.2 },
  { name: 'headlight_r', minStrikeSpeed: 9.2 },
  { name: 'taillight_l', minStrikeSpeed: 9.2 },
  { name: 'taillight_r', minStrikeSpeed: 9.2 },
  { name: 'door_left', minStrikeSpeed: 13.8 },
  { name: 'door_right', minStrikeSpeed: 13.8 },
  { name: 'wheel_fl', minStrikeSpeed: 15.6, isWheel: true },
  { name: 'wheel_fr', minStrikeSpeed: 15.6, isWheel: true },
  { name: 'wheel_rl', minStrikeSpeed: 15.6, isWheel: true },
  { name: 'wheel_rr', minStrikeSpeed: 15.6, isWheel: true },
];

const CIVILIAN_DETACH_RULES: Array<{ name: string; minStrikeSpeed: number; isWheel?: boolean }> = [
  { name: 'sign', minStrikeSpeed: 7.0 },
  { name: 'f_bump', minStrikeSpeed: 8.8 },
  { name: 'r_bump', minStrikeSpeed: 8.8 },
  { name: 'hl_l', minStrikeSpeed: 9.0 },
  { name: 'hl_r', minStrikeSpeed: 9.0 },
  { name: 'tl_l', minStrikeSpeed: 9.0 },
  { name: 'tl_r', minStrikeSpeed: 9.0 },
  { name: 'roof', minStrikeSpeed: 14.8 },
  { name: 'w_fl', minStrikeSpeed: 14.8, isWheel: true },
  { name: 'w_fr', minStrikeSpeed: 14.8, isWheel: true },
  { name: 'w_rl', minStrikeSpeed: 14.8, isWheel: true },
  { name: 'w_rr', minStrikeSpeed: 14.8, isWheel: true },
];

/**
 * Police vehicle (Sedan Cruiser, Interceptor SUV, Transport/SWAT Van, or Tactical APC) built from JSON models
 * + non-overlapping door/rocker/roof/chevron liveries + changeable unified base color + 3-mode roof lightbar.
 */
export function createPoliceCruiser(
  unitNumber: number,
  vehicleKind: PoliceVehicleKind,
  liveryId: PoliceLiveryId,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
  baseColorHex?: number,
): PoliceCruiserRig {
  const modelKey =
    vehicleKind === 'apc'
      ? 'police_apc'
      : vehicleKind === 'suv'
      ? 'police_suv'
      : vehicleKind === 'van'
      ? 'police_van'
      : 'police_cruiser';
  const livery = POLICE_LIVERIES[liveryId];
  const initialBaseColor = baseColorHex ?? livery.primaryPaint;
  const modelDef = assets.models[modelKey];
  const built = buildJsonModel(
    modelDef,
    textures.byId,
    {
      black_paint: initialBaseColor,
      white_paint: initialBaseColor,
    },
    {
      door_decal: livery.doorTextureRef,
    },
  );
  const root = built.root;

  // Ensure transparent door decal never z-fights against mid_body door paint
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
  attachLiveryDecals(bodyGroup, livery, vehicleKind, unitNumber);

  const cabinCrewGroup = (built.tags['cabinCrewGroup']?.[0] as THREE.Group) ?? new THREE.Group();
  const frontWheels = (built.tags['frontWheel'] ?? []) as THREE.Group[];
  const rearWheels = (built.tags['rearWheel'] ?? []) as THREE.Group[];
  const wheels = [...frontWheels, ...rearWheels];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }

  // Clone headlight and taillight materials individually per lamp so detaching one never affects others
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

  const shadowGeo = new THREE.PlaneGeometry(
    vehicleKind === 'apc' ? 3.1 : vehicleKind === 'sedan' ? 2.7 : 2.85,
    vehicleKind === 'apc' ? 5.95 : vehicleKind === 'van' ? 5.75 : 5.45,
  );
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
  shadowPlane.position.y = 0.03;
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

  const lbY =
    vehicleKind === 'apc'
      ? 2.31
      : vehicleKind === 'van'
      ? 2.14
      : vehicleKind === 'suv'
      ? 1.82
      : 1.56;
  const lbZ =
    vehicleKind === 'apc'
      ? 0.56
      : vehicleKind === 'van'
      ? 1.12
      : vehicleKind === 'suv'
      ? -0.18
      : -0.14;
  const lbGroup = new THREE.Group();
  lbGroup.name = 'roof_lightbar';
  lbGroup.position.set(0, lbY, lbZ);
  bodyGroup.add(lbGroup);

  const mountGeo = new THREE.BoxGeometry(0.14, 0.08, 0.24);
  const mountL = new THREE.Mesh(mountGeo, trimMat);
  mountL.position.set(0.54, -0.02, 0);
  const mountR = new THREE.Mesh(mountGeo, trimMat);
  mountR.position.set(-0.54, -0.02, 0);
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.04, 0.34), trimMat);
  basePlate.position.set(0, 0.03, 0);
  const centerHousing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.34), trimMat);
  centerHousing.position.set(0, 0.1, 0);
  lbGroup.add(mountL, mountR, basePlate, centerHousing);

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
  lbGroup.add(leftDome, rightDome, centerDome);

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
    lbGroup.add(podL);
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
    lbGroup.add(podR);
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
    lbGroup.add(podC);
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
  lbGroup.add(halogenLeftBulb, halogenRightBulb, halogenCenterBulb);

  const buildRotator = (xPos: number): THREE.Group => {
    const rot = new THREE.Group();
    rot.position.set(xPos, 0.105, 0);

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

    lbGroup.add(rot);
    return rot;
  };

  const rotatorLeft = buildRotator(0.45);
  const rotatorRight = buildRotator(-0.45);
  const rotatorCenter = buildRotator(0);

  // Additive rotating ground-projected beam cookies (zero SpotLight sampler cost -> prevents WebGL2 shader crash)
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

  const clickH =
    vehicleKind === 'apc'
      ? 2.7
      : vehicleKind === 'van'
      ? 2.4
      : vehicleKind === 'suv'
      ? 2.1
      : 1.9;
  const clickL =
    vehicleKind === 'apc' ? 5.5 : vehicleKind === 'van' ? 5.25 : 5.0;
  const clickableMesh = new THREE.Mesh(
    new THREE.BoxGeometry(vehicleKind === 'apc' ? 2.55 : 2.35, clickH, clickL),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  clickableMesh.position.y = clickH * 0.5;
  clickableMesh.userData.unitId = `unit-${unitNumber}`;
  root.add(clickableMesh);

  const detachableParts = collectDetachableParts(root, POLICE_DETACH_RULES);
  detachableParts.push({
    id: 'roof_lightbar',
    object: lbGroup,
    localOffset: new THREE.Vector3(0, lbY, lbZ),
    minStrikeSpeed: 15.2,
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
    },
  };
}

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
    // Strictly zero every light emitter on a detached roof lightbar
    lb.redPointLight.intensity = 0;
    lb.bluePointLight.intensity = 0;
    lb.cookieLeft.visible = false;
    lb.cookieRight.visible = false;
    lb.leftLensMat.emissiveIntensity = 0;
    lb.rightLensMat.emissiveIntensity = 0;
    (lb.haloLeft.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloRight.material as THREE.SpriteMaterial).opacity = 0;
    (lb.haloCenter.material as THREE.SpriteMaterial).opacity = 0;
    lb.ledLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.ledRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
    lb.ledCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0));
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
      lb.ledLeftPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
      lb.ledRightPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1));
      lb.ledCenterPods.forEach((p) => ((p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05));
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
    (lb.haloHeadLeft.material as THREE.SpriteMaterial).opacity = lb.headlightLeftDetached ? 0 : 0.25 * haloBoost;
    (lb.haloHeadRight.material as THREE.SpriteMaterial).opacity = lb.headlightRightDetached ? 0 : 0.25 * haloBoost;
    return;
  }

  // Per-unit + internal flasher oscillator desync for authentic fleet lighting
  const t = time * rateMult + phaseOffset;

  let leftRedPower = 0;
  let rightBluePower = 0;
  let centerPower = 0;

  if (isLed) {
    const cycleL = (t * 2.2) % 1;
    const cycleR = (t * 2.27 + 0.17) % 1;
    const cycleC = (t * 2.11 + 0.31) % 1;

    const redBurst =
      cycleL < 0.08 || (cycleL > 0.14 && cycleL < 0.22) || (cycleL > 0.28 && cycleL < 0.36);
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

    // Sweep point lights slightly along rotator beam directions
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
  lb.headlightRightMat.emissiveIntensity = lb.headlightRightDetached ? 0 : 1.2 + rightBluePower * 2.4;
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

/**
 * Civilian vehicle compiled deterministically from JSON model definitions.
 */
export function createCivilianCar(
  variant: 'sedan' | 'hatch' | 'taxi' | 'van',
  colorHex: number,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
): CivilianCarRig {
  const modelKey =
    variant === 'sedan'
      ? 'civilian_sedan'
      : variant === 'hatch'
      ? 'civilian_hatch'
      : variant === 'taxi'
      ? 'civilian_taxi'
      : 'civilian_van';

  const overrides = variant === 'taxi' ? undefined : { paint: colorHex };
  const built = buildJsonModel(assets.models[modelKey], textures.byId, overrides);
  const root = built.root;

  const shadowGeo = new THREE.PlaneGeometry(2.3, 4.6);
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
  const wheels = (built.tags['wheel'] ?? []) as THREE.Group[];
  for (const w of wheels) {
    w.rotation.order = 'YXZ';
    w.userData.bentAmount = 0;
  }
  const detachableParts = collectDetachableParts(root, CIVILIAN_DETACH_RULES);

  return { root, bodyGroup, wheels, detachableParts };
}

/**
 * Multi-part articulated humanoid compiled deterministically from JSON model definitions.
 */
export function createHumanoid(
  role: 'officer' | 'heavy_officer' | 'suspect' | 'pedestrian',
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  shirtHex?: number,
): HumanoidRig {
  const modelKey =
    role === 'heavy_officer'
      ? 'heavy_officer_humanoid'
      : role === 'officer'
      ? 'officer_humanoid'
      : role === 'suspect'
      ? 'suspect_humanoid'
      : 'pedestrian_humanoid';

  const overrides =
    role === 'pedestrian' && shirtHex !== undefined ? { shirt: shirtHex } : undefined;
  const built = buildJsonModel(assets.models[modelKey], textures.byId, overrides);
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
