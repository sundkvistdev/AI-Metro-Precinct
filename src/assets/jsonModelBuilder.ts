import * as THREE from 'three';
import {
  ModelMaterialDef,
  ModelPartDef,
  ProceduralModelAsset,
} from './assetTypes';

export interface BuiltJsonModel {
  root: THREE.Group;
  materials: Record<string, THREE.Material>;
  tags: Record<string, THREE.Object3D[]>;
  isFallbackCube?: boolean;
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
  });
}

function buildPart(
  part: ModelPartDef,
  materials: Record<string, THREE.Material>,
  tags: Record<string, THREE.Object3D[]>,
): THREE.Object3D {
  let obj: THREE.Object3D;

  if (part.kind === 'group') {
    obj = new THREE.Group();
  } else {
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
    } else {
      geo = new THREE.PlaneGeometry(dims[0], dims[1]);
    }

    const mat =
      (part.materialRef && materials[part.materialRef]) ||
      new THREE.MeshStandardMaterial({ color: 0xff00ff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = Boolean(part.castShadow);
    mesh.receiveShadow = Boolean(part.receiveShadow);
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

  if (part.tag) {
    if (!tags[part.tag]) tags[part.tag] = [];
    tags[part.tag].push(obj);
  }

  if (part.children) {
    for (const child of part.children) {
      obj.add(buildPart(child, materials, tags));
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
): BuiltJsonModel {
  const root = new THREE.Group();
  root.name = asset.id;

  const materials: Record<string, THREE.Material> = {};
  for (const [key, def] of Object.entries(asset.materials)) {
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

  const tags: Record<string, THREE.Object3D[]> = {};
  for (const part of asset.parts) {
    root.add(buildPart(part, materials, tags));
  }

  return { root, materials, tags };
}
