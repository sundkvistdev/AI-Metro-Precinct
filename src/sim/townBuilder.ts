import * as THREE from 'three';
import {
  AssetIssue,
  CustomMapAsset,
  LoadedJsonAssets,
  MapBuildingDef,
  MapRoadSignDef,
  ProceduralTextureAsset,
} from '../assets/assetTypes';
import {
  buildJsonModel,
  buildMagentaCubeModel,
  BuiltJsonModel,
} from '../assets/jsonModelBuilder';
import { renderJsonTexture } from '../assets/jsonTextureRenderer';
import { TextureRegistry } from '../assets/textureRegistry';
import { makeObstacleBox, ObstacleAABB } from './bvh';
import { getSurfaceHeight, sampleEdgeBezier } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';

export interface TownEnvironmentHandles {
  obstacles: ObstacleAABB[];
  roadMaterials: THREE.MeshStandardMaterial[];
  sidewalkMaterial: THREE.MeshStandardMaterial;
  apronMaterial: THREE.MeshStandardMaterial;
  buildingMeshesById: Map<string, THREE.Object3D>;
  objectMeshesById: Map<string, THREE.Object3D>;
  signMeshesById: Map<string, THREE.Object3D>;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _box3 = new THREE.Box3();
const _size3 = new THREE.Vector3();

function freezeStatic(obj: THREE.Object3D): void {
  obj.updateMatrix();
  obj.matrixAutoUpdate = false;
}

export function buildTownEnvironment(
  hierarchy: SceneWorldHierarchy,
  map: CustomMapAsset,
  textures: TextureRegistry,
  treePalette: string[] = ['#2d5a27', '#3f7d32', '#4c8c3a', '#6b8e23'],
  assets?: LoadedJsonAssets,
  onAssetIssue?: (issue: AssetIssue) => void,
): TownEnvironmentHandles {
  const obstacles: ObstacleAABB[] = [];
  const buildingMeshesById = new Map<string, THREE.Object3D>();
  const objectMeshesById = new Map<string, THREE.Object3D>();
  const signMeshesById = new Map<string, THREE.Object3D>();
  const roadY = map.surfaceHeights.road;
  const roadWidth = map.roadNetwork.roadWidth;

  const terrainSpan = Math.max(860, map.bounds.halfSize * 4.4);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x364437,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.96,
    metalness: 0.0,
  });
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(terrainSpan, terrainSpan).rotateX(-Math.PI / 2),
    terrainMat,
  );
  terrain.position.y = map.surfaceHeights.terrain;
  terrain.receiveShadow = true;
  freezeStatic(terrain);
  hierarchy.world.terrain.add(terrain);

  const roadMatV = new THREE.MeshStandardMaterial({
    map: textures.asphaltRoadV,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.88,
    metalness: 0.05,
  });
  const roadMatH = new THREE.MeshStandardMaterial({
    map: textures.asphaltRoadH,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.88,
    metalness: 0.05,
  });
  const interMat = new THREE.MeshStandardMaterial({
    map: textures.intersectionPad,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.87,
    metalness: 0.05,
  });
  const plainRoadNodeMat = new THREE.MeshStandardMaterial({
    map: textures.plainAsphaltPad,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.87,
    metalness: 0.05,
  });

  const nodeById = new Map(map.roadNetwork.nodes.map((n) => [n.id, n]));

  const addRoadStrip = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    layerOffset: number,
  ): void => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(roadWidth, len + roadWidth * 0.1).rotateX(-Math.PI / 2),
      roadMatV,
    );
    mesh.position.set((x1 + x2) * 0.5, roadY - 0.02 + layerOffset, (z1 + z2) * 0.5);
    mesh.rotation.y = Math.atan2(dx, dz);
    mesh.receiveShadow = true;
    freezeStatic(mesh);
    hierarchy.world.roads.add(mesh);
  };

  const addCurvedRoadRibbon = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    ctrlX: number,
    ctrlZ: number,
    layerOffset: number,
  ): void => {
    const segs = 24;
    const halfW = roadWidth * 0.5;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let arcDist = 0;
    let prevX = x1;
    let prevZ = z1;
    const y = roadY - 0.02 + layerOffset;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const s = sampleEdgeBezier(x1, z1, x2, z2, ctrlX, ctrlZ, t);
      if (i > 0) {
        arcDist += Math.hypot(s.x - prevX, s.z - prevZ);
      }
      prevX = s.x;
      prevZ = s.z;

      const rx = -s.tz * halfW;
      const rz = s.tx * halfW;

      positions.push(s.x - rx, y, s.z - rz);
      positions.push(s.x + rx, y, s.z + rz);
      normals.push(0, 1, 0, 0, 1, 0);
      const v = arcDist / Math.max(4, roadWidth * 1.4);
      uvs.push(0, v, 1, v);

      if (i < segs) {
        const base = i * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mesh = new THREE.Mesh(geo, roadMatV);
    mesh.receiveShadow = true;
    freezeStatic(mesh);
    hierarchy.world.roads.add(mesh);
  };

  map.roadNetwork.edges.forEach((edge, idx) => {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) return;
    if (edge.ctrlX !== undefined && edge.ctrlZ !== undefined) {
      addCurvedRoadRibbon(a.x, a.z, b.x, b.z, edge.ctrlX, edge.ctrlZ, (idx % 3) * 0.002);
    } else {
      addRoadStrip(a.x, a.z, b.x, b.z, (idx % 3) * 0.002);
    }
  });

  if (map.roadNetwork.extraStrips) {
    map.roadNetwork.extraStrips.forEach((s, idx) => {
      addRoadStrip(s.x1, s.z1, s.x2, s.z2, 0.004 + (idx % 2) * 0.002);
    });
  }

  const padGeo = new THREE.CircleGeometry(roadWidth * 0.54, 16).rotateX(-Math.PI / 2);
  const stopBarGeo = new THREE.BoxGeometry(roadWidth * 0.44, 0.014, 0.42);
  const stopBarMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const yieldBarMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

  for (const node of map.roadNetwork.nodes) {
    const padMat = node.hasCrosswalk === true ? interMat : plainRoadNodeMat;
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(node.x, roadY - 0.005, node.z);
    pad.receiveShadow = true;
    freezeStatic(pad);
    hierarchy.world.roads.add(pad);

    if (
      node.nodeType !== 'join' &&
      (node.priority === 'stop' || node.priority === 'yield')
    ) {
      const barMat = node.priority === 'stop' ? stopBarMat : yieldBarMat;
      const barDist = roadWidth * 0.56;
      const laneOff = map.roadNetwork.laneOffset;
      for (const edge of map.roadNetwork.edges) {
        if (edge.from !== node.id && edge.to !== node.id) continue;
        const other = nodeById.get(edge.from === node.id ? edge.to : edge.from);
        if (!other) continue;
        const dx = other.x - node.x;
        const dz = other.z - node.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        // Approach right-hand lane entering this node
        const rx = uz * laneOff;
        const rz = -ux * laneOff;
        const bar = new THREE.Mesh(stopBarGeo, barMat);
        bar.position.set(
          node.x + ux * barDist + rx,
          roadY + 0.004,
          node.z + uz * barDist + rz,
        );
        bar.rotation.y = Math.atan2(ux, uz);
        freezeStatic(bar);
        hierarchy.world.roads.add(bar);
      }
    }
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: textures.sidewalkPaver,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.88,
    metalness: 0.03,
  });
  let apronMaterial = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.86,
  });

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const stripeGeo = new THREE.BoxGeometry(7.2, 0.02, 0.2);

  for (const zDef of map.zones) {
    if (zDef.kind === 'apron') {
      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(zDef.width, zDef.height, zDef.depth),
        apronMaterial,
      );
      apron.position.set(zDef.cx, zDef.height * 0.5, zDef.cz);
      apron.rotation.y = zDef.rotationY ?? 0;
      apron.receiveShadow = true;
      freezeStatic(apron);
      hierarchy.world.roads.add(apron);

      const bayX = zDef.cx + 3.0;
      const spanZ = Math.max(12, zDef.depth - 8);
      for (let i = 0; i < 8; i++) {
        const line = new THREE.Mesh(stripeGeo, stripeMat);
        const sz = zDef.cz - spanZ * 0.5 + (i + 0.5) * (spanZ / 8);
        line.position.set(bayX, zDef.height + 0.01, sz);
        freezeStatic(line);
        hierarchy.world.roads.add(line);
      }
    } else if (zDef.kind === 'park') {
      const lawn = new THREE.Mesh(
        new THREE.BoxGeometry(zDef.width, zDef.height, zDef.depth),
        new THREE.MeshStandardMaterial({
          color: zDef.color ? parseInt(zDef.color.replace('#', ''), 16) : 0x3f623d,
          roughnessMap: textures.roughnessConcrete,
          roughness: 0.95,
        }),
      );
      lawn.position.set(zDef.cx, zDef.height * 0.5 + 0.11, zDef.cz);
      lawn.rotation.y = zDef.rotationY ?? 0;
      lawn.receiveShadow = true;
      freezeStatic(lawn);
      hierarchy.world.terrain.add(lawn);
    } else {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(zDef.width, zDef.height, zDef.depth),
        sidewalkMat,
      );
      slab.position.set(zDef.cx, zDef.height * 0.5, zDef.cz);
      slab.rotation.y = zDef.rotationY ?? 0;
      slab.receiveShadow = true;
      freezeStatic(slab);
      hierarchy.world.terrain.add(slab);
    }
  }

  const buildingCacheMats = new Map<string, THREE.Material>();

  const instantiateBuildingFromPack = (
    b: MapBuildingDef,
    idx: number,
  ): THREE.Object3D | null => {
    if (!assets) return null;
    const styleKey = b.facadeStyle ?? 'concrete';
    const mappedModelId =
      b.modelRef ??
      assets.config.world.buildingModels?.[styleKey] ??
      assets.config.world.buildingModels?.concrete ??
      'building_concrete';
    const modelDef = assets.models[mappedModelId];
    if (!modelDef) {
      if (b.modelRef) {
        onAssetIssue?.({
          severity: 'error',
          category: 'model',
          id: b.modelRef,
          path: `map.building:${b.id}`,
          message: `Building "${b.id}" references missing model "${b.modelRef}"`,
        });
      }
      return null;
    }

    // Rotate facade textures cleanly per building index if generic style
    let texOverrides: Record<string, string> | undefined;
    if (!b.modelRef && styleKey === 'storefront' && !b.hasAwning) {
      const upperCycle = ['facade_concrete', 'facade_brick', 'facade_office'];
      texOverrides = { facade: upperCycle[idx % upperCycle.length] };
    } else if (
      !b.modelRef &&
      (styleKey === 'brick' || styleKey === 'concrete' || styleKey === 'limestone' || styleKey === 'office') &&
      Object.keys(modelDef.materials).length === 2
    ) {
      const matKeys = Object.keys(modelDef.materials);
      if (matKeys[0] && modelDef.materials[matKeys[0]].textureRef) {
        texOverrides = { [matKeys[0]]: modelDef.materials[matKeys[0]].textureRef! };
      }
    }

    const built = buildJsonModel(
      modelDef,
      textures.byId,
      undefined,
      texOverrides,
      textures.magentaFallback,
      (missingTex) => {
        onAssetIssue?.({
          severity: 'error',
          category: 'texture',
          id: missingTex,
          path: `map.building:${b.id}`,
          message: `Texture "${missingTex}" referenced by "${mappedModelId}" is missing`,
        });
      },
      assets.materials,
    );

    // Optional HVAC toggle on storefront/office roof if flagged false
    if (b.hasHvac === false) {
      const hvacObj = built.root.getObjectByName('rooftop_hvac') ?? built.root.getObjectByName('hvac_unit');
      if (hvacObj) hvacObj.visible = false;
    }

    // Fit model root to [b.width, b.height, b.depth] cleanly (keeping base at local y=0)
    const isBeacon = styleKey === 'beacon';
    const isFountain = styleKey === 'fountain' || b.kind === 'fountain';
    if (isBeacon) {
      built.root.scale.set(1, Math.max(0.5, b.height), 1);
    } else if (isFountain) {
      const rSpan = Math.min(b.width, b.depth);
      built.root.scale.set(rSpan, Math.max(2.5, b.height), rSpan);
    } else {
      built.root.updateMatrixWorld(true);
      _box3.setFromObject(built.root);
      _box3.getSize(_size3);
      const sx = _size3.x > 0.05 ? b.width / _size3.x : b.width;
      const sy = _size3.y > 0.05 ? b.height / _size3.y : b.height;
      const sz = _size3.z > 0.05 ? b.depth / _size3.z : b.depth;
      built.root.scale.set(sx, sy, sz);
    }

    built.root.traverse((ch) => {
      ch.userData.mapBuildingId = b.id;
    });
    return built.root;
  };

  const fallbackBrickMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.82,
  });
  buildingCacheMats.set('fallback', fallbackBrickMat);

  map.buildings.forEach((b, idx) => {
    const rotY = b.rotationY ?? 0;
    const baseY = b.baseY ?? map.surfaceHeights.sidewalk;

    const modelObj = instantiateBuildingFromPack(b, idx);
    if (modelObj) {
      modelObj.position.set(b.cx, baseY, b.cz);
      modelObj.rotation.y = rotY;
      modelObj.userData.mapBuildingId = b.id;
      freezeStatic(modelObj);
      hierarchy.world.buildings.add(modelObj);
      buildingMeshesById.set(b.id, modelObj);
    } else {
      const fallbackMesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.width, b.height, b.depth),
        fallbackBrickMat,
      );
      fallbackMesh.position.set(b.cx, baseY + b.height * 0.5, b.cz);
      fallbackMesh.rotation.y = rotY;
      fallbackMesh.castShadow = true;
      fallbackMesh.receiveShadow = true;
      fallbackMesh.userData.mapBuildingId = b.id;
      freezeStatic(fallbackMesh);
      hierarchy.world.buildings.add(fallbackMesh);
      buildingMeshesById.set(b.id, fallbackMesh);
    }

    if (b.collidable) {
      const obsW = b.hasAwning || b.facadeStyle === 'storefront' ? b.width + 0.5 : b.width;
      const obsD = b.hasAwning || b.facadeStyle === 'storefront' ? b.depth + 0.5 : b.depth;
      const obsKind =
        b.facadeStyle === 'fountain' || b.kind === 'fountain'
          ? 'fountain'
          : b.kind === 'station' || b.facadeStyle === 'station_hall' || b.facadeStyle === 'station_glass' || b.facadeStyle === 'trim'
          ? 'station'
          : 'building';
      obstacles.push(makeObstacleBox(b.cx, b.cz, obsW, obsD, obsKind, rotY));
    }
  });

  // Dynamic model-driven map objects (e.g. benches, bollards, barriers, custom buildings/props)
  if (map.objects && map.objects.length > 0) {
    for (const objDef of map.objects) {
      const modelDef = assets?.models[objDef.modelRef];
      const built = modelDef
        ? buildJsonModel(
            modelDef,
            textures.byId,
            undefined,
            undefined,
            textures.magentaFallback,
            (missingTex) => {
              onAssetIssue?.({
                severity: 'error',
                category: 'texture',
                id: missingTex,
                path: `map.object:${objDef.id}`,
                message: `Texture "${missingTex}" referenced by "${objDef.modelRef}" is missing (magenta fallback applied)`,
              });
            },
            assets?.materials,
          )
        : (() => {
            onAssetIssue?.({
              severity: 'error',
              category: 'model',
              id: objDef.modelRef,
              path: `map.object:${objDef.id}`,
              message: `Map object "${objDef.id}" references missing model "${objDef.modelRef}"`,
            });
            return buildMagentaCubeModel(objDef.modelRef, [1.5, 1.5, 1.5]);
          })();

      const scale = objDef.scale ?? 1;
      const baseY = objDef.y ?? getSurfaceHeight(objDef.x, objDef.z, map);
      const rotY = objDef.rotationY ?? 0;

      built.root.position.set(objDef.x, baseY, objDef.z);
      built.root.rotation.y = rotY;
      built.root.scale.setScalar(scale);
      built.root.userData.mapObjectId = objDef.id;
      built.root.traverse((ch) => {
        ch.userData.mapObjectId = objDef.id;
      });
      freezeStatic(built.root);
      hierarchy.world.buildings.add(built.root);
      objectMeshesById.set(objDef.id, built.root);

      const isCollidable =
        objDef.collidable ?? modelDef?.flags?.collidable ?? true;
      if (isCollidable) {
        let obsW = objDef.hitboxWidth;
        let obsD = objDef.hitboxDepth;
        if (obsW === undefined || obsD === undefined) {
          built.root.updateMatrixWorld(true);
          _box3.setFromObject(built.root);
          _box3.getSize(_size3);
          obsW = Math.max(0.5, _size3.x);
          obsD = Math.max(0.5, _size3.z);
        }
        obstacles.push(
          makeObstacleBox(objDef.x, objDef.z, obsW, obsD, 'prop', rotY),
        );
      }
    }
  }

  // Procedural road signs
  if (map.signs && map.signs.length > 0) {
    buildRoadSigns(hierarchy, map, signMeshesById, obstacles, assets, textures);
  }

  buildInstancedTrees(hierarchy, treePalette, map.trees, assets, textures);
  buildInstancedStreetlights(hierarchy, map.streetlights, textures, assets);

  return {
    obstacles,
    roadMaterials: [roadMatV, roadMatH, interMat, plainRoadNodeMat],
    sidewalkMaterial: sidewalkMat,
    apronMaterial,
    buildingMeshesById,
    objectMeshesById,
    signMeshesById,
  };
}

function getSignVisualSpec(sign: MapRoadSignDef): {
  shape: 'octagon' | 'triangle' | 'rect' | 'circle';
  bgColor: string;
  borderColor: string;
  textColor: string;
  plateW: number;
  plateH: number;
} {
  switch (sign.style) {
    case 'stop':
      return {
        shape: 'octagon',
        bgColor: sign.bgColor ?? '#dc2626',
        borderColor: sign.borderColor ?? '#ffffff',
        textColor: sign.textColor ?? '#ffffff',
        plateW: 0.78,
        plateH: 0.78,
      };
    case 'yield':
      return {
        shape: 'triangle',
        bgColor: sign.bgColor ?? '#f8fafc',
        borderColor: sign.borderColor ?? '#dc2626',
        textColor: sign.textColor ?? '#0f172a',
        plateW: 0.82,
        plateH: 0.74,
      };
    case 'speed_limit':
      return {
        shape: 'rect',
        bgColor: sign.bgColor ?? '#f8fafc',
        borderColor: sign.borderColor ?? '#0f172a',
        textColor: sign.textColor ?? '#0f172a',
        plateW: 0.66,
        plateH: 0.86,
      };
    case 'one_way':
      return {
        shape: 'rect',
        bgColor: sign.bgColor ?? '#0f172a',
        borderColor: sign.borderColor ?? '#f8fafc',
        textColor: sign.textColor ?? '#ffffff',
        plateW: 0.92,
        plateH: 0.42,
      };
    case 'street_name':
      return {
        shape: 'rect',
        bgColor: sign.bgColor ?? '#15803d',
        borderColor: sign.borderColor ?? '#f8fafc',
        textColor: sign.textColor ?? '#ffffff',
        plateW: 1.15,
        plateH: 0.36,
      };
    case 'precinct':
      return {
        shape: 'rect',
        bgColor: sign.bgColor ?? '#1e3a8a',
        borderColor: sign.borderColor ?? '#fbbf24',
        textColor: sign.textColor ?? '#ffffff',
        plateW: 1.05,
        plateH: 0.54,
      };
    default:
      return {
        shape: 'rect',
        bgColor: sign.bgColor ?? '#d97706',
        borderColor: sign.borderColor ?? '#0f172a',
        textColor: sign.textColor ?? '#0f172a',
        plateW: 0.8,
        plateH: 0.72,
      };
  }
}

function buildRoadSigns(
  hierarchy: SceneWorldHierarchy,
  map: CustomMapAsset,
  signMeshesById: Map<string, THREE.Object3D>,
  obstacles: ObstacleAABB[],
  assets?: LoadedJsonAssets,
  textures?: TextureRegistry,
): void {
  const signs = map.signs ?? [];
  if (signs.length === 0) return;

  const texCache = new Map<string, THREE.CanvasTexture>();
  const poleBackMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.65,
    roughness: 0.38,
  });
  const defaultSignModelId = assets?.config.world.propModels?.roadSign ?? 'prop_road_sign';

  for (const sign of signs) {
    const spec = getSignVisualSpec(sign);
    const poleH = Math.max(1.2, sign.height ?? 2.6);
    const baseY = sign.y ?? getSurfaceHeight(sign.x, sign.z, map);
    const rotY = sign.rotationY ?? 0;

    const group = new THREE.Group();
    group.position.set(sign.x, baseY, sign.z);
    group.rotation.y = rotY;
    group.userData.mapSignId = sign.id;

    const signModelId = sign.modelRef ?? defaultSignModelId;
    const signModelDef = assets?.models[signModelId];
    if (signModelDef && textures) {
      const builtPost = buildJsonModel(
        signModelDef,
        textures.byId,
        sign.poleColor
          ? { pole: parseInt(sign.poleColor.replace('#', ''), 16) }
          : undefined,
        undefined,
        textures.magentaFallback,
        undefined,
        assets.materials,
      );
      builtPost.root.scale.set(1, poleH, 1);
      builtPost.root.traverse((ch) => {
        ch.userData.mapSignId = sign.id;
      });
      group.add(builtPost.root);
    } else {
      const poleMat = sign.poleColor
        ? new THREE.MeshStandardMaterial({
            color: parseInt(sign.poleColor.replace('#', ''), 16),
            metalness: 0.65,
            roughness: 0.38,
          })
        : poleBackMat;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.055, poleH, 8),
        poleMat,
      );
      pole.position.y = poleH * 0.5;
      pole.castShadow = true;
      pole.userData.mapSignId = sign.id;
      group.add(pole);
    }

    const cacheKey = `${spec.shape}:${sign.text}:${sign.subtext ?? ''}:${spec.bgColor}:${spec.borderColor}:${spec.textColor}`;
    let plateTex = texCache.get(cacheKey);
    if (!plateTex) {
      const texAsset: ProceduralTextureAsset = {
        format: 'jdata-texture-v1',
        id: `sign_tex_${sign.id}`,
        seed: 1,
        width: 256,
        height: 256,
        colorSpace: 'srgb',
        layers: [
          {
            op: 'road_sign_plate',
            shape: spec.shape,
            title: sign.text || 'SIGN',
            subtitle: sign.subtext,
            bgColor: spec.bgColor,
            borderColor: spec.borderColor,
            textColor: spec.textColor,
          },
        ],
      };
      plateTex = renderJsonTexture(texAsset, 4);
      texCache.set(cacheKey, plateTex);
    }

    const plateMat = new THREE.MeshStandardMaterial({
      map: plateTex,
      transparent: spec.shape === 'octagon' || spec.shape === 'triangle' || spec.shape === 'circle',
      alphaTest: 0.15,
      roughness: 0.36,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.plateW, spec.plateH),
      plateMat,
    );
    plate.position.set(0, poleH - spec.plateH * 0.25, 0.055);
    plate.castShadow = true;
    plate.userData.mapSignId = sign.id;
    group.add(plate);

    const backPlate = new THREE.Mesh(
      new THREE.BoxGeometry(spec.plateW * 0.9, spec.plateH * 0.9, 0.025),
      poleBackMat,
    );
    backPlate.position.set(0, poleH - spec.plateH * 0.25, 0.04);
    backPlate.userData.mapSignId = sign.id;
    group.add(backPlate);

    freezeStatic(group);
    hierarchy.world.buildings.add(group);
    signMeshesById.set(sign.id, group);

    if (sign.collidable !== false) {
      obstacles.push(makeObstacleBox(sign.x, sign.z, 0.42, 0.42, 'prop', rotY));
    }
  }
}

function extractPartGeoAndMat(
  built: BuiltJsonModel | null,
  tagName: string,
  fallbackGeo: THREE.BufferGeometry,
  fallbackMat: THREE.Material,
): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  if (built) {
    const tagged = built.tags[tagName]?.[0] as THREE.Mesh | undefined;
    const candidate = tagged ?? (built.root.getObjectByName(tagName) as THREE.Mesh | undefined);
    if (candidate && candidate instanceof THREE.Mesh && candidate.geometry) {
      const geo = candidate.geometry.clone();
      geo.translate(candidate.position.x, candidate.position.y, candidate.position.z);
      const mat = Array.isArray(candidate.material) ? candidate.material[0] : candidate.material;
      return { geo, mat: mat ?? fallbackMat };
    }
  }
  return { geo: fallbackGeo, mat: fallbackMat };
}

function buildInstancedTrees(
  hierarchy: SceneWorldHierarchy,
  treePalette: string[],
  trees: CustomMapAsset['trees'],
  assets?: LoadedJsonAssets,
  textures?: TextureRegistry,
): void {
  if (trees.length === 0) return;

  const treeModelId = assets?.config.world.propModels?.tree ?? 'prop_tree';
  const treeModelDef = assets?.models[treeModelId];
  const builtTree =
    treeModelDef && textures
      ? buildJsonModel(
          treeModelDef,
          textures.byId,
          undefined,
          undefined,
          textures.magentaFallback,
          undefined,
          assets.materials,
        )
      : null;

  const fallbackTrunkGeo = new THREE.CylinderGeometry(0.24, 0.34, 2.6, 7);
  fallbackTrunkGeo.translate(0, 1.3, 0);
  const fallbackTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92 });

  const fallbackCrownGeo = new THREE.DodecahedronGeometry(2.3, 1);
  fallbackCrownGeo.translate(0, 4.1, 0);
  const fallbackCrownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

  const trunkSpec = extractPartGeoAndMat(builtTree, 'trunk', fallbackTrunkGeo, fallbackTrunkMat);
  const crownSpec = extractPartGeoAndMat(builtTree, 'crown', fallbackCrownGeo, fallbackCrownMat);

  const trunks = new THREE.InstancedMesh(trunkSpec.geo, trunkSpec.mat, trees.length);
  const crowns = new THREE.InstancedMesh(crownSpec.geo, crownSpec.mat, trees.length);
  trunks.castShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;

  const palette = treePalette.map((hex) => parseInt(hex.replace('#', ''), 16));

  trees.forEach((t, i) => {
    const scale = t.scale ?? 0.85 + ((i * 37) % 30) / 100;
    _dummy.position.set(t.x, t.y, t.z);
    _dummy.rotation.set(0, (i * 1.1) % (Math.PI * 2), 0);
    _dummy.scale.set(scale, scale, scale);
    _dummy.updateMatrix();
    trunks.setMatrixAt(i, _dummy.matrix);
    crowns.setMatrixAt(i, _dummy.matrix);

    _color.setHex(palette[i % palette.length]);
    crowns.setColorAt(i, _color);
  });

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  freezeStatic(trunks);
  freezeStatic(crowns);

  hierarchy.world.buildings.add(trunks, crowns);
}

function buildInstancedStreetlights(
  hierarchy: SceneWorldHierarchy,
  streetlights: CustomMapAsset['streetlights'],
  textures: TextureRegistry,
  assets?: LoadedJsonAssets,
): void {
  if (streetlights.length === 0) return;

  const lightModelId = assets?.config.world.propModels?.streetlight ?? 'prop_streetlight';
  const lightModelDef = assets?.models[lightModelId];
  const builtLight = lightModelDef
    ? buildJsonModel(
        lightModelDef,
        textures.byId,
        undefined,
        undefined,
        textures.magentaFallback,
        undefined,
        assets.materials,
      )
    : null;

  const fallbackPoleGeo = new THREE.CylinderGeometry(0.11, 0.16, 6.2, 8);
  fallbackPoleGeo.translate(0, 3.1, 0);
  const fallbackPoleMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.35,
  });

  const fallbackBulbGeo = new THREE.BoxGeometry(0.45, 0.16, 0.45);
  fallbackBulbGeo.translate(0, 6.2, 0);
  const fallbackBulbMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfde68a,
    emissiveIntensity: 1.5,
  });

  const poleSpec = extractPartGeoAndMat(builtLight, 'pole', fallbackPoleGeo, fallbackPoleMat);
  const bulbSpec = extractPartGeoAndMat(builtLight, 'bulb', fallbackBulbGeo, fallbackBulbMat);

  const poles = new THREE.InstancedMesh(poleSpec.geo, poleSpec.mat, streetlights.length);
  const bulbs = new THREE.InstancedMesh(bulbSpec.geo, bulbSpec.mat, streetlights.length);

  const haloMat = new THREE.SpriteMaterial({
    map: textures.lightHalo,
    color: 0xfde68a,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  streetlights.forEach((s, i) => {
    _dummy.position.set(s.x, s.y, s.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    poles.setMatrixAt(i, _dummy.matrix);
    bulbs.setMatrixAt(i, _dummy.matrix);

    if (s.hasHalo ?? i % 2 === 0) {
      const sp = new THREE.Sprite(haloMat);
      sp.position.set(s.x, s.y + 6.15, s.z);
      sp.scale.set(2.8, 2.8, 1);
      freezeStatic(sp);
      hierarchy.world.buildings.add(sp);
    }
  });

  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  bulbs.computeBoundingSphere();
  freezeStatic(poles);
  freezeStatic(bulbs);
  hierarchy.world.buildings.add(poles, bulbs);
}
