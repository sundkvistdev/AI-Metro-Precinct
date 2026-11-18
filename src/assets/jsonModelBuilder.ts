import * as THREE from 'three';
import {
  CrashPartSpec,
  HingePartSpec,
  ModelMaterialDef,
  ModelPartDef,
  ProceduralModelAsset,
  SeatPartSpec,
  UVTransformSpec,
} from './assetTypes';

let experimentalComplexMeshesRuntime = false;

export function setExperimentalComplexMeshesEnabled(enabled: boolean): void {
  experimentalComplexMeshesRuntime = Boolean(enabled);
}

export function isExperimentalComplexMeshesEnabled(): boolean {
  return experimentalComplexMeshesRuntime;
}

export interface BuiltCrashPart {
  id: string;
  object: THREE.Object3D;
  spec: CrashPartSpec;
}

export interface BuiltHingeRef {
  id: string;
  object: THREE.Object3D;
  spec: HingePartSpec;
  currentAngle: number;
  targetAngle: number;
}

export interface BuiltSeatRef {
  id: string;
  object: THREE.Object3D;
  spec: SeatPartSpec;
  localOffset: THREE.Vector3;
}

export interface BuiltJsonModel {
  root: THREE.Group;
  materials: Record<string, THREE.Material>;
  tags: Record<string, THREE.Object3D[]>;
  crashParts: BuiltCrashPart[];
  hinges: Record<string, BuiltHingeRef>;
  seats: BuiltSeatRef[];
  isFallbackCube?: boolean;
}

export interface BuildJsonModelOptions {
  experimentalEnabled?: boolean;
  showSeatMarkers?: boolean;
}

export function buildMagentaCubeModel(
  modelId: string,
  size: [number, number, number] = [1.5, 1.5, 1.5],
): BuiltJsonModel {
  const root = new THREE.Group();
  root.name = `missing_model_${modelId}`;

  const mat = new THREE.MeshStandardMaterial({
    color: 0xff00ff,
    emissive: 0x660066,
    emissiveIntensity: 0.45,
    roughness: 0.65,
    metalness: 0.0,
  });

  const cube = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  cube.position.y = size[1] * 0.5;
  cube.castShadow = true;
  cube.receiveShadow = true;
  root.add(cube);

  return {
    root,
    materials: { fallbackMagenta: mat },
    tags: {},
    crashParts: [],
    hinges: {},
    seats: [],
    isFallbackCube: true,
  };
}

function resolveTextureOrFallback(
  ref: string | undefined,
  textureMap: Record<string, THREE.Texture>,
  fallbackTexture?: THREE.Texture,
  onMissingTexture?: (ref: string) => void,
): THREE.Texture | undefined {
  if (!ref) return undefined;
  const found = textureMap[ref];
  if (found) return found;
  onMissingTexture?.(ref);
  return fallbackTexture;
}

function buildMaterial(
  def: ModelMaterialDef,
  textureMap: Record<string, THREE.Texture>,
  colorOverrides?: Record<string, number>,
  matKey?: string,
  textureOverrides?: Record<string, string>,
  fallbackTexture?: THREE.Texture,
  onMissingTexture?: (ref: string) => void,
): THREE.Material {
  const colorVal =
    matKey && colorOverrides && colorOverrides[matKey] !== undefined
      ? colorOverrides[matKey]
      : def.color;

  const texRef =
    matKey && textureOverrides && textureOverrides[matKey]
      ? textureOverrides[matKey]
      : def.textureRef;
  const mapTex = resolveTextureOrFallback(
    texRef,
    textureMap,
    fallbackTexture,
    onMissingTexture,
  );
  const emissiveMapTex = resolveTextureOrFallback(
    def.emissiveTextureRef,
    textureMap,
    fallbackTexture,
    onMissingTexture,
  );
  const roughnessMapTex = resolveTextureOrFallback(
    def.roughnessTextureRef,
    textureMap,
    fallbackTexture,
    onMissingTexture,
  );

  if (def.type === 'basic') {
    return new THREE.MeshBasicMaterial({
      color: colorVal,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1,
      depthWrite: def.depthWrite ?? true,
      map: mapTex,
    });
  }

  if (def.type === 'physical') {
    return new THREE.MeshPhysicalMaterial({
      color: colorVal,
      roughness: def.roughness ?? 0.5,
      metalness: def.metalness ?? 0.0,
      clearcoat: def.clearcoat ?? 0,
      clearcoatRoughness: def.clearcoatRoughness ?? 0.1,
      emissive: def.emissive ?? 0x000000,
      emissiveIntensity: def.emissiveIntensity ?? 1,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1,
      depthWrite: def.depthWrite ?? true,
      map: mapTex,
      emissiveMap: emissiveMapTex,
      roughnessMap: roughnessMapTex,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: colorVal,
    roughness: def.roughness ?? 0.5,
    metalness: def.metalness ?? 0.0,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 1,
    transparent: def.transparent ?? false,
    opacity: def.opacity ?? 1,
    depthWrite: def.depthWrite ?? true,
    map: mapTex,
    emissiveMap: emissiveMapTex,
    roughnessMap: roughnessMapTex,
  });
}

function applyUvTransform(geo: THREE.BufferGeometry, uv: UVTransformSpec): void {
  const attr = geo.getAttribute('uv');
  if (!attr) return;
  const repX = uv.repeat?.[0] ?? 1;
  const repY = uv.repeat?.[1] ?? 1;
  const offX = uv.offset?.[0] ?? 0;
  const offY = uv.offset?.[1] ?? 0;
  const rot = uv.rotation ?? 0;
  const cx = uv.center?.[0] ?? 0.5;
  const cy = uv.center?.[1] ?? 0.5;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  for (let i = 0; i < attr.count; i++) {
    let u = attr.getX(i) * repX + offX;
    let v = attr.getY(i) * repY + offY;
    if (rot !== 0) {
      const du = u - cx;
      const dv = v - cy;
      u = du * cos - dv * sin + cx;
      v = du * sin + dv * cos + cy;
    }
    attr.setXY(i, u, v);
  }
  attr.needsUpdate = true;
}

function buildGeometryForPart(
  part: ModelPartDef,
  experimentalEnabled: boolean,
): THREE.BufferGeometry {
  const dims = part.dimensions ?? [1, 1, 1];
  let geo: THREE.BufferGeometry;

  if (part.kind === 'box') {
    geo = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
  } else if (part.kind === 'cylinder') {
    geo = new THREE.CylinderGeometry(
      dims[0],
      dims[1],
      dims[2],
      part.radiusSegments ?? 12,
    );
  } else if (part.kind === 'sphere') {
    geo = new THREE.SphereGeometry(
      dims[0],
      Math.round(dims[1] || 12),
      Math.round(dims[2] || 10),
    );
  } else if (part.kind === 'extrude' && experimentalEnabled && part.extrude && part.extrude.points.length >= 3) {
    const shape = new THREE.Shape();
    shape.moveTo(part.extrude.points[0][0], part.extrude.points[0][1]);
    for (let i = 1; i < part.extrude.points.length; i++) {
      shape.lineTo(part.extrude.points[i][0], part.extrude.points[i][1]);
    }
    shape.closePath();
    geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.02, part.extrude.depth),
      bevelEnabled: part.extrude.bevelEnabled ?? false,
      bevelSize: part.extrude.bevelSize ?? 0.02,
      bevelThickness: part.extrude.bevelSize ?? 0.02,
      bevelSegments: 2,
    });
    geo.center();
  } else if (part.kind === 'lathe' && experimentalEnabled && part.lathe && part.lathe.points.length >= 2) {
    const pts = part.lathe.points.map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y));
    geo = new THREE.LatheGeometry(pts, Math.max(6, Math.round(part.lathe.segments ?? 16)));
  } else if (part.kind === 'mesh' && experimentalEnabled && part.customMesh && part.customMesh.positions.length >= 9) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(part.customMesh.positions, 3),
    );
    if (part.customMesh.indices && part.customMesh.indices.length >= 3) {
      geo.setIndex(part.customMesh.indices);
    }
    if (part.customMesh.uvs && part.customMesh.uvs.length >= 6) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(part.customMesh.uvs, 2));
    }
    if (part.customMesh.normals && part.customMesh.normals.length === part.customMesh.positions.length) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(part.customMesh.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
  } else if (part.kind === 'extrude' || part.kind === 'lathe' || part.kind === 'mesh') {
    // Experimental flag is disabled -> safe proxy box fallback
    geo = new THREE.BoxGeometry(dims[0] || 0.6, dims[1] || 0.6, dims[2] || 0.6);
  } else {
    geo = new THREE.PlaneGeometry(dims[0], dims[1]);
  }

  if (experimentalEnabled && part.uv) {
    applyUvTransform(geo, part.uv);
  }
  return geo;
}

function buildPart(
  part: ModelPartDef,
  materials: Record<string, THREE.Material>,
  tags: Record<string, THREE.Object3D[]>,
  crashParts: BuiltCrashPart[],
  hinges: Record<string, BuiltHingeRef>,
  seats: BuiltSeatRef[],
  defaultCastShadow: boolean,
  defaultReceiveShadow: boolean,
  experimentalEnabled: boolean,
  showSeatMarkers: boolean,
): THREE.Object3D {
  let obj: THREE.Object3D;

  if (part.kind === 'group') {
    obj = new THREE.Group();
  } else if (part.seat && !showSeatMarkers) {
    obj = new THREE.Group();
  } else {
    const geo = buildGeometryForPart(part, experimentalEnabled);
    const mat =
      (part.materialRef && materials[part.materialRef]) ||
      new THREE.MeshStandardMaterial({
        color:
          (part.kind === 'extrude' || part.kind === 'lathe' || part.kind === 'mesh') &&
          !experimentalEnabled
            ? 0xf59e0b
            : 0xff00ff,
        wireframe:
          (part.kind === 'extrude' || part.kind === 'lathe' || part.kind === 'mesh') &&
          !experimentalEnabled,
      });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = part.seat ? false : (part.castShadow ?? defaultCastShadow);
    mesh.receiveShadow = part.seat ? false : (part.receiveShadow ?? defaultReceiveShadow);
    obj = mesh;
  }

  obj.name = part.id;
  if (part.position) {
    obj.position.set(part.position[0], part.position[1], part.position[2]);
  }
  if (part.rotation) {
    obj.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
  }
  if (part.visible === false) {
    obj.visible = false;
  }

  if (part.hinge) {
    const axis = part.hinge.axis;
    const closedAngle = part.hinge.closedAngle ?? 0;
    obj.rotation[axis] = closedAngle;
    hinges[part.id] = {
      id: part.id,
      object: obj,
      spec: part.hinge,
      currentAngle: closedAngle,
      targetAngle: closedAngle,
    };
  }

  if (part.seat) {
    seats.push({
      id: part.id,
      object: obj,
      spec: part.seat,
      localOffset: new THREE.Vector3(
        part.position?.[0] ?? 0,
        part.position?.[1] ?? 0.55,
        part.position?.[2] ?? 0,
      ),
    });
  }

  if (part.tag) {
    if (!tags[part.tag]) tags[part.tag] = [];
    tags[part.tag].push(obj);
  }

  if (part.crashPart) {
    crashParts.push({
      id: part.id,
      object: obj,
      spec: part.crashPart,
    });
  }

  if (part.children) {
    for (const child of part.children) {
      obj.add(
        buildPart(
          child,
          materials,
          tags,
          crashParts,
          hinges,
          seats,
          defaultCastShadow,
          defaultReceiveShadow,
          experimentalEnabled,
          showSeatMarkers,
        ),
      );
    }
  }

  return obj;
}

export function buildJsonModel(
  asset: ProceduralModelAsset,
  textureMap: Record<string, THREE.Texture>,
  colorOverrides?: Record<string, number>,
  textureOverrides?: Record<string, string>,
  fallbackTexture?: THREE.Texture,
  onMissingTexture?: (ref: string) => void,
  sharedMaterials?: Record<string, ModelMaterialDef>,
  options?: BuildJsonModelOptions,
): BuiltJsonModel {
  const experimentalEnabled = options?.experimentalEnabled ?? experimentalComplexMeshesRuntime;
  const showSeatMarkers = options?.showSeatMarkers ?? false;

  const root = new THREE.Group();
  root.name = asset.id;
  if (asset.flags) {
    root.userData.modelFlags = asset.flags;
  }

  const materials: Record<string, THREE.Material> = {};
  const mergedDefs: Record<string, ModelMaterialDef> = {
    ...(sharedMaterials ?? {}),
    ...asset.materials,
  };
  for (const [key, def] of Object.entries(mergedDefs)) {
    materials[key] = buildMaterial(
      def,
      textureMap,
      colorOverrides,
      key,
      textureOverrides,
      fallbackTexture,
      onMissingTexture,
    );
  }

  const defaultCastShadow = asset.flags?.castShadow ?? false;
  const defaultReceiveShadow = asset.flags?.receiveShadow ?? false;
  const tags: Record<string, THREE.Object3D[]> = {};
  const crashParts: BuiltCrashPart[] = [];
  const hinges: Record<string, BuiltHingeRef> = {};
  const seats: BuiltSeatRef[] = [];

  for (const part of asset.parts) {
    root.add(
      buildPart(
        part,
        materials,
        tags,
        crashParts,
        hinges,
        seats,
        defaultCastShadow,
        defaultReceiveShadow,
        experimentalEnabled,
        showSeatMarkers,
      ),
    );
  }

  seats.sort((a, b) => a.spec.slotIndex - b.spec.slotIndex);

  return { root, materials, tags, crashParts, hinges, seats };
}
