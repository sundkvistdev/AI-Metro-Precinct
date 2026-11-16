import * as THREE from 'three';
import { ObstacleAABB } from './bvh';
import {
  ROAD_COORDS,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  STATION_BOUNDS,
} from './roadGraph';
import { ProceduralTexturePack } from './textures';

export interface TownEnvironmentHandles {
  obstacles: ObstacleAABB[];
  roadMaterials: THREE.MeshStandardMaterial[];
  sidewalkMaterial: THREE.MeshStandardMaterial;
  apronMaterial: THREE.MeshStandardMaterial;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export function buildTownEnvironment(
  scene: THREE.Scene,
  textures: ProceduralTexturePack,
): TownEnvironmentHandles {
  const obstacles: ObstacleAABB[] = [];

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x364437,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.96,
    metalness: 0.0,
  });
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(860, 860).rotateX(-Math.PI / 2),
    terrainMat,
  );
  terrain.position.y = 0;
  terrain.receiveShadow = true;
  scene.add(terrain);

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

  for (const coord of ROAD_COORDS) {
    const roadV = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_WIDTH, 400).rotateX(-Math.PI / 2),
      roadMatV,
    );
    roadV.position.set(coord, 0.02, 0);
    roadV.receiveShadow = true;
    scene.add(roadV);

    const roadH = new THREE.Mesh(
      new THREE.PlaneGeometry(400, ROAD_WIDTH).rotateX(-Math.PI / 2),
      roadMatH,
    );
    roadH.position.set(0, 0.025, coord);
    roadH.receiveShadow = true;
    scene.add(roadH);
  }

  for (const rx of ROAD_COORDS) {
    for (const rz of ROAD_COORDS) {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_WIDTH).rotateX(-Math.PI / 2),
        interMat,
      );
      pad.position.set(rx, 0.035, rz);
      pad.receiveShadow = true;
      scene.add(pad);
    }
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: textures.sidewalkPaver,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.88,
    metalness: 0.03,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x3b424d,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.92,
  });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.48, metalness: 0.55 });
  const awningMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.62 });

  const treePositions: [number, number, number][] = [];
  const streetlightPositions: [number, number, number][] = [];

  const blockCenters = [-112.5, -37.5, 37.5, 112.5];
  const blockSize = 75 - ROAD_WIDTH;

  let apronMaterial = sidewalkMat;

  for (let bxIdx = 0; bxIdx < blockCenters.length; bxIdx++) {
    for (let bzIdx = 0; bzIdx < blockCenters.length; bzIdx++) {
      const cx = blockCenters[bxIdx];
      const cz = blockCenters[bzIdx];

      const slab = new THREE.Mesh(new THREE.BoxGeometry(blockSize, 0.14, blockSize), sidewalkMat);
      slab.position.set(cx, 0.07, cz);
      slab.receiveShadow = true;
      scene.add(slab);

      streetlightPositions.push([cx - blockSize * 0.46, 0.14, cz - blockSize * 0.46]);
      streetlightPositions.push([cx + blockSize * 0.46, 0.14, cz + blockSize * 0.46]);

      if (bxIdx === 0 && bzIdx === 1) {
        apronMaterial = buildPoliceStation(scene, textures, obstacles);
        continue;
      }

      if (bxIdx === 2 && bzIdx === 2) {
        buildCivicPark(scene, cx, cz, blockSize, treePositions, textures, obstacles);
        continue;
      }

      const innerSpan = blockSize - SIDEWALK_WIDTH * 2;
      const subOffsets = [
        [-innerSpan * 0.26, -innerSpan * 0.26],
        [innerSpan * 0.26, -innerSpan * 0.26],
        [-innerSpan * 0.26, innerSpan * 0.26],
        [innerSpan * 0.26, innerSpan * 0.26],
      ];

      for (let s = 0; s < subOffsets.length; s++) {
        const [ox, oz] = subOffsets[s];
        const seed = (bxIdx * 7 + bzIdx * 13 + s * 5) % 17;
        const w = 18 + (seed % 5) * 1.4;
        const d = 18 + ((seed * 3) % 5) * 1.4;
        const floors = 3 + (seed % 4);
        const upperH = floors * 3.2;
        const groundH = 4.2;
        const bx = cx + ox;
        const bz = cz + oz;

        const ground = new THREE.Mesh(
          new THREE.BoxGeometry(w + 0.5, groundH, d + 0.5),
          new THREE.MeshStandardMaterial({
            map: textures.storefrontFacade,
            roughnessMap: textures.roughnessConcrete,
            roughness: 0.52,
            metalness: 0.16,
          }),
        );
        ground.position.set(bx, 0.14 + groundH * 0.5, bz);
        ground.castShadow = true;
        ground.receiveShadow = true;
        scene.add(ground);

        obstacles.push({
          minX: bx - (w + 0.5) * 0.5,
          maxX: bx + (w + 0.5) * 0.5,
          minZ: bz - (d + 0.5) * 0.5,
          maxZ: bz + (d + 0.5) * 0.5,
          kind: 'building',
        });

        const awning = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.28, d + 1.2), awningMat);
        awning.position.set(bx, 0.14 + groundH + 0.14, bz);
        scene.add(awning);

        const facadeTex =
          textures.buildingFacades[(bxIdx + bzIdx + s) % textures.buildingFacades.length];
        const upperMat = new THREE.MeshStandardMaterial({
          map: facadeTex,
          roughnessMap: textures.roughnessConcrete,
          roughness: 0.74,
          metalness: 0.08,
        });
        const upper = new THREE.Mesh(new THREE.BoxGeometry(w, upperH, d), upperMat);
        upper.position.set(bx, 0.14 + groundH + upperH * 0.5, bz);
        upper.castShadow = true;
        upper.receiveShadow = true;
        scene.add(upper);

        const roofCap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.45, d + 0.4), roofMat);
        roofCap.position.set(bx, 0.14 + groundH + upperH + 0.22, bz);
        scene.add(roofCap);

        const hvac = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 2.4), hvacMat);
        hvac.position.set(bx + (seed % 3) - 1, 0.14 + groundH + upperH + 1.0, bz);
        hvac.castShadow = true;
        scene.add(hvac);
      }
    }
  }

  const outerRings: [number, number][] = [];
  for (const x of [-178, -112.5, -37.5, 37.5, 112.5, 178]) {
    outerRings.push([x, -178], [x, 178]);
  }
  for (const z of [-112.5, -37.5, 37.5, 112.5]) {
    outerRings.push([-178, z], [178, z]);
  }
  outerRings.forEach(([ox, oz], idx) => {
    if (idx % 3 === 0) {
      treePositions.push([ox - 8, 0, oz - 6], [ox + 8, 0, oz + 6]);
      return;
    }
    const h = 9 + (idx % 4) * 3.5;
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(24, h, 24),
      new THREE.MeshStandardMaterial({
        map: textures.buildingFacades[idx % textures.buildingFacades.length],
        roughnessMap: textures.roughnessConcrete,
        roughness: 0.78,
      }),
    );
    b.position.set(ox, h * 0.5, oz);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);

    obstacles.push({
      minX: ox - 12,
      maxX: ox + 12,
      minZ: oz - 12,
      maxZ: oz + 12,
      kind: 'building',
    });
  });

  for (let i = 0; i < 90; i++) {
    const angle = (i / 90) * Math.PI * 2;
    const radius = 225 + (i % 5) * 18;
    treePositions.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
  }

  buildInstancedTrees(scene, treePositions);
  buildInstancedStreetlights(scene, streetlightPositions, textures);

  return {
    obstacles,
    roadMaterials: [roadMatV, roadMatH, interMat],
    sidewalkMaterial: sidewalkMat,
    apronMaterial,
  };
}

function buildPoliceStation(
  scene: THREE.Scene,
  textures: ProceduralTexturePack,
  obstacles: ObstacleAABB[],
): THREE.MeshStandardMaterial {
  const { centerX, centerZ } = STATION_BOUNDS;

  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughnessMap: textures.roughnessAsphalt,
    roughness: 0.86,
  });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(24, 0.18, 58), apronMat);
  apron.position.set(-93, 0.09, -36);
  apron.receiveShadow = true;
  scene.add(apron);

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (const sz of [-62, -54, -46, -38, -30, -22, -14, -6]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.02, 0.2), stripeMat);
    line.position.set(-92, 0.19, sz);
    scene.add(line);
  }

  const brickMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.82,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e3a5f,
    roughness: 0.12,
    metalness: 0.2,
    clearcoat: 0.8,
  });

  const mainHall = new THREE.Mesh(new THREE.BoxGeometry(22, 11.5, 42), brickMat);
  mainHall.position.set(centerX - 8, 5.85, centerZ);
  mainHall.castShadow = true;
  mainHall.receiveShadow = true;
  scene.add(mainHall);

  obstacles.push({
    minX: centerX - 8 - 11,
    maxX: centerX - 8 + 11,
    minZ: centerZ - 21,
    maxZ: centerZ + 21,
    kind: 'station',
  });

  const glassLobby = new THREE.Mesh(new THREE.BoxGeometry(2.5, 5.2, 16), glassMat);
  glassLobby.position.set(centerX + 3.2, 2.75, centerZ);
  scene.add(glassLobby);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 22), trimMat);
  canopy.position.set(centerX + 5.5, 4.9, centerZ);
  canopy.castShadow = true;
  scene.add(canopy);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(14, 2.6, 0.4),
    new THREE.MeshStandardMaterial({
      map: textures.precinctSign,
      emissiveMap: textures.precinctSign,
      emissive: 0xffffff,
      emissiveIntensity: 0.45,
      roughness: 0.3,
    }),
  );
  sign.position.set(centerX + 3.4, 9.2, centerZ);
  sign.rotation.y = Math.PI / 2;
  scene.add(sign);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.45, 11, 8),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 }),
  );
  mast.position.set(centerX - 10, 17, centerZ - 10);
  scene.add(mast);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff2222, emissiveIntensity: 2.2 }),
  );
  beacon.position.set(centerX - 10, 22.6, centerZ - 10);
  scene.add(beacon);

  return apronMat;
}

function buildCivicPark(
  scene: THREE.Scene,
  cx: number,
  cz: number,
  blockSize: number,
  treePositions: [number, number, number][],
  textures: ProceduralTexturePack,
  obstacles: ObstacleAABB[],
): void {
  const lawn = new THREE.Mesh(
    new THREE.BoxGeometry(blockSize - 8, 0.1, blockSize - 8),
    new THREE.MeshStandardMaterial({
      color: 0x3f623d,
      roughnessMap: textures.roughnessConcrete,
      roughness: 0.95,
    }),
  );
  lawn.position.set(cx, 0.16, cz);
  lawn.receiveShadow = true;
  scene.add(lawn);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughnessMap: textures.roughnessConcrete,
    roughness: 0.74,
  });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.0, 0.85, 20), stoneMat);
  basin.position.set(cx, 0.58, cz);
  basin.castShadow = true;
  basin.receiveShadow = true;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(5.0, 5.0, 0.15, 20),
    new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.08, clearcoat: 1.0 }),
  );
  water.position.set(cx, 0.92, cz);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 2.8, 12), stoneMat);
  spire.position.set(cx, 1.8, cz);
  scene.add(basin, water, spire);

  obstacles.push({
    minX: cx - 6.0,
    maxX: cx + 6.0,
    minZ: cz - 6.0,
    maxZ: cz + 6.0,
    kind: 'fountain',
  });

  for (const [dx, dz] of [
    [-19, -19],
    [19, -19],
    [-19, 19],
    [19, 19],
    [-19, 0],
    [19, 0],
    [0, -19],
    [0, 19],
  ]) {
    treePositions.push([cx + dx, 0.2, cz + dz]);
  }
}

function buildInstancedTrees(
  scene: THREE.Scene,
  positions: [number, number, number][],
): void {
  if (positions.length === 0) return;

  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.34, 2.6, 7);
  trunkGeo.translate(0, 1.3, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.92 });

  const crownGeo = new THREE.DodecahedronGeometry(2.3, 1);
  crownGeo.translate(0, 4.1, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, positions.length);
  trunks.castShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;

  const palette = [0x3d6b41, 0x4a7c44, 0x2f5a38, 0x568247];

  positions.forEach(([x, y, z], i) => {
    const scale = 0.85 + ((i * 37) % 30) / 100;
    _dummy.position.set(x, y, z);
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

  scene.add(trunks, crowns);
}

function buildInstancedStreetlights(
  scene: THREE.Scene,
  positions: [number, number, number][],
  textures: ProceduralTexturePack,
): void {
  if (positions.length === 0) return;

  const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 6.2, 8);
  poleGeo.translate(0, 3.1, 0);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.35,
  });

  const bulbGeo = new THREE.BoxGeometry(0.45, 0.16, 0.45);
  bulbGeo.translate(0, 6.2, 0);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfde68a,
    emissiveIntensity: 1.5,
  });

  const poles = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, positions.length);

  const haloMat = new THREE.SpriteMaterial({
    map: textures.lightHalo,
    color: 0xfde68a,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  positions.forEach(([x, y, z], i) => {
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    poles.setMatrixAt(i, _dummy.matrix);
    bulbs.setMatrixAt(i, _dummy.matrix);

    if (i % 2 === 0) {
      const sp = new THREE.Sprite(haloMat);
      sp.position.set(x, y + 6.15, z);
      sp.scale.set(2.8, 2.8, 1);
      scene.add(sp);
    }
  });

  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  bulbs.computeBoundingSphere();
  scene.add(poles, bulbs);
}
