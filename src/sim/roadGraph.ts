import * as THREE from 'three';
import {
  CustomMapAsset,
  EngineConfigAsset,
  MapZoneDef,
  RoadNodePriority,
  RoadNodeType,
} from '../assets/assetTypes';
import { StaticObstacleBVH } from './bvh';

export type WorldConfig = EngineConfigAsset['world'];

function isCustomMap(src: CustomMapAsset | WorldConfig): src is CustomMapAsset {
  return 'roadNetwork' in src;
}

export function sampleEdgeBezier(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ctrlX: number,
  ctrlZ: number,
  t: number,
): { x: number; z: number; tx: number; tz: number } {
  const mt = 1 - t;
  const x = mt * mt * ax + 2 * mt * t * ctrlX + t * t * bx;
  const z = mt * mt * az + 2 * mt * t * ctrlZ + t * t * bz;
  const dx = 2 * mt * (ctrlX - ax) + 2 * t * (bx - ctrlX);
  const dz = 2 * mt * (ctrlZ - az) + 2 * t * (bz - ctrlZ);
  const len = Math.hypot(dx, dz) || 1;
  return { x, z, tx: dx / len, tz: dz / len };
}

function distToSegmentSq2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distSq: number; projX: number; projZ: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) {
    return { distSq: (px - ax) ** 2 + (pz - az) ** 2, projX: ax, projZ: az, t: 0 };
  }
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  const projX = ax + dx * t;
  const projZ = az + dz * t;
  return { distSq: (px - projX) ** 2 + (pz - projZ) ** 2, projX, projZ, t };
}

export function distToEdge2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ctrlX?: number,
  ctrlZ?: number,
): { distSq: number; projX: number; projZ: number; t: number } {
  if (ctrlX === undefined || ctrlZ === undefined) {
    return distToSegmentSq2D(px, pz, ax, az, bx, bz);
  }
  const steps = 16;
  let bestDistSq = Infinity;
  let bestX = ax;
  let bestZ = az;
  let bestT = 0;
  let prevX = ax;
  let prevZ = az;
  for (let i = 1; i <= steps; i++) {
    const t1 = i / steps;
    const p = sampleEdgeBezier(ax, az, bx, bz, ctrlX, ctrlZ, t1);
    const seg = distToSegmentSq2D(px, pz, prevX, prevZ, p.x, p.z);
    if (seg.distSq < bestDistSq) {
      bestDistSq = seg.distSq;
      bestX = seg.projX;
      bestZ = seg.projZ;
      bestT = ((i - 1) + seg.t) / steps;
    }
    prevX = p.x;
    prevZ = p.z;
  }
  return { distSq: bestDistSq, projX: bestX, projZ: bestZ, t: bestT };
}

function computeBezierArcLength(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ctrlX: number,
  ctrlZ: number,
): number {
  const steps = 12;
  let len = 0;
  let px = ax;
  let pz = az;
  for (let i = 1; i <= steps; i++) {
    const p = sampleEdgeBezier(ax, az, bx, bz, ctrlX, ctrlZ, i / steps);
    len += Math.hypot(p.x - px, p.z - pz);
    px = p.x;
    pz = p.z;
  }
  return len || 1;
}

function pointInZone(x: number, z: number, zone: MapZoneDef): boolean {
  const dx = x - zone.cx;
  const dz = z - zone.cz;
  const rot = zone.rotationY ?? 0;
  if (Math.abs(rot) > 1e-4) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.abs(lx) <= zone.width * 0.5 && Math.abs(lz) <= zone.depth * 0.5;
  }
  return Math.abs(dx) <= zone.width * 0.5 && Math.abs(dz) <= zone.depth * 0.5;
}

export function getSurfaceHeight(
  x: number,
  z: number,
  source: CustomMapAsset | WorldConfig,
): number {
  if (isCustomMap(source)) {
    const { bounds, surfaceHeights, roadNetwork, zones } = source;
    if (Math.abs(x) <= bounds.halfSize + 40 && Math.abs(z) <= bounds.halfSize + 40) {
      const roadHalf = roadNetwork.roadWidth * 0.5;
      const roadHalfSq = roadHalf * roadHalf;

      // Fast node check first
      const nodeById = new Map<number, { x: number; z: number }>();
      for (let i = 0; i < roadNetwork.nodes.length; i++) {
        const n = roadNetwork.nodes[i];
        nodeById.set(n.id, n);
        const dx = x - n.x;
        const dz = z - n.z;
        if (dx * dx + dz * dz <= roadHalfSq * 1.15) {
          return surfaceHeights.road;
        }
      }

      for (let i = 0; i < roadNetwork.edges.length; i++) {
        const e = roadNetwork.edges[i];
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) continue;
        if (
          distToEdge2D(x, z, a.x, a.z, b.x, b.z, e.ctrlX, e.ctrlZ).distSq <= roadHalfSq
        ) {
          return surfaceHeights.road;
        }
      }

      if (roadNetwork.extraStrips) {
        for (let i = 0; i < roadNetwork.extraStrips.length; i++) {
          const s = roadNetwork.extraStrips[i];
          if (distToSegmentSq2D(x, z, s.x1, s.z1, s.x2, s.z2).distSq <= roadHalfSq) {
            return surfaceHeights.road;
          }
        }
      }

      // Check priority zones: apron & park override generic sidewalk slabs
      for (let i = 0; i < zones.length; i++) {
        const zDef = zones[i];
        if (zDef.kind === 'apron' && pointInZone(x, z, zDef)) {
          return surfaceHeights.apron;
        }
      }
      for (let i = 0; i < zones.length; i++) {
        const zDef = zones[i];
        if (zDef.kind === 'park' && pointInZone(x, z, zDef)) {
          return surfaceHeights.park;
        }
      }
      for (let i = 0; i < zones.length; i++) {
        const zDef = zones[i];
        if (zDef.kind === 'sidewalk' && pointInZone(x, z, zDef)) {
          return surfaceHeights.sidewalk;
        }
      }
    }
    return surfaceHeights.terrain;
  }

  const {
    roadCoords,
    roadWidth,
    townHalfSize,
    blockCenters,
    apronBounds,
    parkBlock,
    surfaceHeights,
  } = source;
  const blockHalf = (75 - roadWidth) * 0.5;
  const roadHalf = roadWidth * 0.5;

  if (Math.abs(x) <= townHalfSize && Math.abs(z) <= townHalfSize) {
    for (let i = 0; i < roadCoords.length; i++) {
      const c = roadCoords[i];
      if (Math.abs(x - c) <= roadHalf || Math.abs(z - c) <= roadHalf) {
        return surfaceHeights.road;
      }
    }

    if (
      x >= apronBounds.minX &&
      x <= apronBounds.maxX &&
      z >= apronBounds.minZ &&
      z <= apronBounds.maxZ
    ) {
      return surfaceHeights.apron;
    }

    if (
      Math.abs(x - parkBlock.centerX) <= parkBlock.innerHalf &&
      Math.abs(z - parkBlock.centerZ) <= parkBlock.innerHalf
    ) {
      return surfaceHeights.park;
    }

    for (let bx = 0; bx < blockCenters.length; bx++) {
      if (Math.abs(x - blockCenters[bx]) <= blockHalf) {
        for (let bz = 0; bz < blockCenters.length; bz++) {
          if (Math.abs(z - blockCenters[bz]) <= blockHalf) {
            return surfaceHeights.sidewalk;
          }
        }
      }
    }
  }
  return surfaceHeights.terrain;
}

export function pruneLeadingWaypoints(
  pos: THREE.Vector3,
  yaw: number,
  waypoints: THREE.Vector3[],
  staticBvh?: StaticObstacleBVH,
): void {
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  while (waypoints.length > 1) {
    const wp = waypoints[0];
    const nextWp = waypoints[1];
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const dot = dx * fwdX + dz * fwdZ;
    const shouldDrop = dist < 4.8 || (dist < 18 && dot < 1.2);
    if (!shouldDrop) break;

    if (
      staticBvh &&
      nextWp &&
      !staticBvh.raycastSegment(pos.x, pos.z, nextWp.x, nextWp.z).clear
    ) {
      break;
    }
    waypoints.shift();
  }
}

export interface RoadNode {
  id: number;
  gx: number;
  gz: number;
  x: number;
  z: number;
  neighbors: number[];
  nodeType: RoadNodeType;
  hasCrosswalk: boolean;
  priority: RoadNodePriority;
}

export interface RoadEdge {
  a: number;
  b: number;
  dirX: number;
  dirZ: number;
  length: number;
  ctrlX?: number;
  ctrlZ?: number;
}

export interface CrimeSpot {
  x: number;
  z: number;
  district: string;
  nearestNodeId: number;
  segmentNodeA: number;
  segmentNodeB: number;
  roadPullOverPos: THREE.Vector3;
  roadPullOverYaw: number;
}

export class TownRoadGraph {
  public readonly nodes: RoadNode[] = [];
  public readonly edges: RoadEdge[] = [];
  public readonly gridToNode = new Map<string, number>();
  private nodeIndexById = new Map<number, number>();
  private edgeLookup = new Map<string, RoadEdge>();
  public readonly roadWidth: number;
  public readonly laneOffset: number;
  public readonly roadSurfaceY: number;
  public readonly districts: string[];
  public readonly townHalfSize: number;
  public readonly stationExitPoint: [number, number];
  public readonly stationZones: MapZoneDef[];

  constructor(source: CustomMapAsset | WorldConfig) {
    if (isCustomMap(source)) {
      this.roadWidth = source.roadNetwork.roadWidth;
      this.laneOffset = source.roadNetwork.laneOffset;
      this.roadSurfaceY = source.surfaceHeights.road;
      this.districts = source.districts.length > 0 ? source.districts : ['Metro District'];
      this.townHalfSize = source.bounds.halfSize;
      this.stationExitPoint = source.stationExit?.apronPoint ?? [-82.5, -36];
      this.stationZones = source.zones.filter((z) => z.kind === 'apron');

      const defById = new Map(source.roadNetwork.nodes.map((d) => [d.id, d]));

      for (let i = 0; i < source.roadNetwork.nodes.length; i++) {
        const def = source.roadNetwork.nodes[i];
        this.nodeIndexById.set(def.id, this.nodes.length);
        this.nodes.push({
          id: def.id,
          gx: -1,
          gz: -1,
          x: def.x,
          z: def.z,
          neighbors: [],
          nodeType: def.nodeType ?? 'junction',
          hasCrosswalk: def.hasCrosswalk === true,
          priority: def.priority ?? 'none',
        });
      }

      const seen = new Set<string>();
      for (const e of source.roadNetwork.edges) {
        const aNode = this.getNodeById(e.from);
        const bNode = this.getNodeById(e.to);
        if (!aNode || !bNode || aNode.id === bNode.id) continue;
        const key = aNode.id < bNode.id ? `${aNode.id}:${bNode.id}` : `${bNode.id}:${aNode.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!aNode.neighbors.includes(bNode.id)) aNode.neighbors.push(bNode.id);
        if (!bNode.neighbors.includes(aNode.id)) bNode.neighbors.push(aNode.id);

        const dx = bNode.x - aNode.x;
        const dz = bNode.z - aNode.z;
        const straightLen = Math.hypot(dx, dz) || 1;
        const hasCtrl = e.ctrlX !== undefined && e.ctrlZ !== undefined;
        const len = hasCtrl
          ? computeBezierArcLength(aNode.x, aNode.z, bNode.x, bNode.z, e.ctrlX!, e.ctrlZ!)
          : straightLen;
        const edgeObj: RoadEdge = {
          a: aNode.id,
          b: bNode.id,
          dirX: dx / straightLen,
          dirZ: dz / straightLen,
          length: len,
          ctrlX: e.ctrlX,
          ctrlZ: e.ctrlZ,
        };
        this.edges.push(edgeObj);
        this.edgeLookup.set(key, edgeObj);
      }

      for (const node of this.nodes) {
        const def = defById.get(node.id);
        if (def && !def.nodeType) {
          node.nodeType = node.neighbors.length <= 2 ? 'join' : 'junction';
        }
      }
      return;
    }

    this.roadWidth = source.roadWidth;
    this.laneOffset = source.laneOffset;
    this.roadSurfaceY = source.surfaceHeights.road;
    this.districts = source.districts;
    this.townHalfSize = source.townHalfSize;
    this.stationExitPoint = [-82.5, -36];
    this.stationZones = [
      {
        id: 'station_apron',
        kind: 'apron',
        cx: source.apronBounds.centerX,
        cz: source.apronBounds.centerZ,
        width: source.apronBounds.width,
        depth: source.apronBounds.depth,
        height: source.apronBounds.height,
      },
    ];

    const coords = source.roadCoords;
    const n = coords.length;
    for (let gx = 0; gx < n; gx++) {
      for (let gz = 0; gz < n; gz++) {
        const id = this.nodes.length;
        this.nodeIndexById.set(id, id);
        this.nodes.push({
          id,
          gx,
          gz,
          x: coords[gx],
          z: coords[gz],
          neighbors: [],
          nodeType: 'junction',
          hasCrosswalk: false,
          priority: 'none',
        });
        this.gridToNode.set(`${gx},${gz}`, id);
      }
    }

    const seen = new Set<string>();
    for (const node of this.nodes) {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dz] of dirs) {
        const nid = this.gridToNode.get(`${node.gx + dx},${node.gz + dz}`);
        if (nid !== undefined) {
          node.neighbors.push(nid);
          const key = node.id < nid ? `${node.id}:${nid}` : `${nid}:${node.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            const nb = this.nodes[nid];
            const ex = nb.x - node.x;
            const ez = nb.z - node.z;
            const len = Math.hypot(ex, ez) || 1;
            const edgeObj: RoadEdge = {
              a: node.id,
              b: nid,
              dirX: ex / len,
              dirZ: ez / len,
              length: len,
            };
            this.edges.push(edgeObj);
            this.edgeLookup.set(key, edgeObj);
          }
        }
      }
      node.nodeType = node.neighbors.length <= 2 ? 'join' : 'junction';
    }
  }

  public getEdge(aId: number, bId: number): RoadEdge | undefined {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
    return this.edgeLookup.get(key);
  }

  public sampleDirectedEdge(
    fromNode: RoadNode,
    toNode: RoadNode,
    t: number,
  ): { x: number; z: number; tx: number; tz: number; isCurved: boolean } {
    const edge = this.getEdge(fromNode.id, toNode.id);
    if (edge && edge.ctrlX !== undefined && edge.ctrlZ !== undefined) {
      const sampled = sampleEdgeBezier(
        fromNode.x,
        fromNode.z,
        toNode.x,
        toNode.z,
        edge.ctrlX,
        edge.ctrlZ,
        THREE.MathUtils.clamp(t, 0, 1),
      );
      return { ...sampled, isCurved: true };
    }
    const dx = toNode.x - fromNode.x;
    const dz = toNode.z - fromNode.z;
    const len = Math.hypot(dx, dz) || 1;
    const tc = THREE.MathUtils.clamp(t, 0, 1);
    return {
      x: THREE.MathUtils.lerp(fromNode.x, toNode.x, tc),
      z: THREE.MathUtils.lerp(fromNode.z, toNode.z, tc),
      tx: dx / len,
      tz: dz / len,
      isCurved: false,
    };
  }

  public findDirectedEdgeProgress(
    px: number,
    pz: number,
    fromNode: RoadNode,
    toNode: RoadNode,
  ): { t: number; projX: number; projZ: number; tx: number; tz: number; isCurved: boolean } {
    const edge = this.getEdge(fromNode.id, toNode.id);
    const ctrlX = edge?.ctrlX;
    const ctrlZ = edge?.ctrlZ;
    const proj = distToEdge2D(px, pz, fromNode.x, fromNode.z, toNode.x, toNode.z, ctrlX, ctrlZ);
    const sampled = this.sampleDirectedEdge(fromNode, toNode, proj.t);
    return {
      t: proj.t,
      projX: proj.projX,
      projZ: proj.projZ,
      tx: sampled.tx,
      tz: sampled.tz,
      isCurved: sampled.isCurved,
    };
  }

  public getNodeById(id: number): RoadNode | undefined {
    const idx = this.nodeIndexById.get(id);
    if (idx !== undefined) return this.nodes[idx];
    return this.nodes[id];
  }

  public getNodeAt(gx: number, gz: number): RoadNode {
    const id = this.gridToNode.get(`${gx},${gz}`) ?? (this.nodes[0]?.id ?? 0);
    return this.getNodeById(id) ?? this.nodes[0];
  }

  public findStationExitNodeIds(): { primary: number; secondary: number } {
    if (this.nodes.length === 0) return { primary: 0, secondary: 0 };
    const [ex, ez] = this.stationExitPoint;
    const nearest = this.findNearestNode(ex, ez);
    if (nearest.neighbors.length === 0) {
      return { primary: nearest.id, secondary: nearest.id };
    }
    let bestSec = nearest.neighbors[0];
    let bestScore = Infinity;
    for (const nid of nearest.neighbors) {
      const n = this.getNodeById(nid);
      if (!n) continue;
      const distSq = (n.x - ex) ** 2 + (n.z - ez) ** 2;
      if (distSq < bestScore) {
        bestScore = distSq;
        bestSec = nid;
      }
    }
    return { primary: nearest.id, secondary: bestSec };
  }

  public findNearestNode(x: number, z: number): RoadNode {
    let best = this.nodes[0];
    let bestDist = Infinity;
    for (const node of this.nodes) {
      const dx = node.x - x;
      const dz = node.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  public findNearestRoadEntryPoint(
    x: number,
    z: number,
    staticBvh?: StaticObstacleBVH,
  ): {
    point: THREE.Vector3;
    nearestNode: RoadNode;
  } {
    const roadY = this.roadSurfaceY;
    const candidates: THREE.Vector3[] = [];

    for (const e of this.edges) {
      const a = this.getNodeById(e.a);
      const b = this.getNodeById(e.b);
      if (!a || !b) continue;
      const proj = distToEdge2D(x, z, a.x, a.z, b.x, b.z, e.ctrlX, e.ctrlZ);
      candidates.push(new THREE.Vector3(proj.projX, roadY, proj.projZ));
    }
    for (const n of this.nodes) {
      candidates.push(new THREE.Vector3(n.x, roadY, n.z));
    }

    if (candidates.length === 0) {
      const pt = new THREE.Vector3(x, roadY, z);
      return {
        point: pt,
        nearestNode: {
          id: 0,
          gx: 0,
          gz: 0,
          x,
          z,
          neighbors: [],
          nodeType: 'junction',
          hasCrosswalk: false,
          priority: 'none',
        },
      };
    }

    candidates.sort((a, b) => {
      const da = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
      const db = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
      return da - db;
    });

    let chosen = candidates[0];
    if (staticBvh) {
      for (const c of candidates) {
        if (staticBvh.raycastSegment(x, z, c.x, c.z).clear) {
          chosen = c;
          break;
        }
      }
      if (!staticBvh.raycastSegment(x, z, chosen.x, chosen.z).clear) {
        for (const node of this.nodes) {
          if (staticBvh.raycastSegment(x, z, node.x, node.z).clear) {
            chosen = new THREE.Vector3(node.x, roadY, node.z);
            break;
          }
        }
      }
    }

    return {
      point: chosen,
      nearestNode: this.findNearestNode(chosen.x, chosen.z),
    };
  }

  public getReachableNodeIds(startId: number): number[] {
    const start = this.getNodeById(startId);
    if (!start) return [];
    const visited = new Set<number>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const node = this.getNodeById(cur);
      if (!node) continue;
      for (const nid of node.neighbors) {
        if (!visited.has(nid)) {
          visited.add(nid);
          queue.push(nid);
        }
      }
    }
    return Array.from(visited);
  }

  public findNearestReachableNode(x: number, z: number, fromStartId: number): RoadNode | undefined {
    const reachable = this.getReachableNodeIds(fromStartId);
    let best: RoadNode | undefined;
    let bestDistSq = Infinity;
    for (const id of reachable) {
      const node = this.getNodeById(id);
      if (!node) continue;
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDistSq) {
        bestDistSq = d;
        best = node;
      }
    }
    return best;
  }

  public findNodePath(startId: number, goalId: number): RoadNode[] {
    const startNode = this.getNodeById(startId);
    const goalNode = this.getNodeById(goalId);
    if (!startNode || !goalNode) return [];
    if (startId === goalId) return [startNode];

    const open = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[startId, 0]]);
    const fScore = new Map<number, number>([[startId, this.heuristic(startId, goalId)]]);

    while (open.size > 0) {
      let current = -1;
      let lowestF = Infinity;
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = id;
        }
      }

      if (current === goalId) {
        const path: RoadNode[] = [this.getNodeById(current)!];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(this.getNodeById(current)!);
        }
        return path;
      }

      open.delete(current);
      const currNode = this.getNodeById(current);
      if (!currNode) continue;

      for (const neighborId of currNode.neighbors) {
        const nNode = this.getNodeById(neighborId);
        if (!nNode) continue;
        const edge = this.getEdge(current, neighborId);
        const stepCost = edge ? edge.length : Math.hypot(nNode.x - currNode.x, nNode.z - currNode.z);
        const tentativeG = (gScore.get(current) ?? Infinity) + stepCost;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.heuristic(neighborId, goalId));
          open.add(neighborId);
        }
      }
    }

    return [];
  }

  private heuristic(aId: number, bId: number): number {
    const a = this.getNodeById(aId);
    const b = this.getNodeById(bId);
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private pathDistance(nodes: RoadNode[]): number {
    let total = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      const e = this.getEdge(nodes[i].id, nodes[i + 1].id);
      total += e ? e.length : Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].z - nodes[i].z);
    }
    return total;
  }

  public buildRouteToSegmentSpot(
    startNodeId: number,
    nodeAId: number,
    nodeBId: number,
    finalSpot: THREE.Vector3,
    aggressive = false,
  ): THREE.Vector3[] {
    const nodeA = this.getNodeById(nodeAId) ?? this.nodes[0];
    const nodeB = this.getNodeById(nodeBId) ?? nodeA;
    if (!nodeA || !nodeB) return [finalSpot.clone()];

    let pathA = this.findNodePath(startNodeId, nodeA.id);
    let pathB =
      nodeB.id !== nodeA.id ? this.findNodePath(startNodeId, nodeB.id) : pathA;

    if (pathA.length === 0 && pathB.length === 0) {
      const nearestReachable = this.findNearestReachableNode(finalSpot.x, finalSpot.z, startNodeId);
      if (!nearestReachable) return [finalSpot.clone()];
      const fallbackPath = this.findNodePath(startNodeId, nearestReachable.id);
      return this.buildLaneWaypoints(fallbackPath, finalSpot, aggressive);
    }

    const costA =
      pathA.length > 0
        ? this.pathDistance(pathA) + Math.hypot(finalSpot.x - nodeA.x, finalSpot.z - nodeA.z)
        : Infinity;
    const costB =
      pathB.length > 0
        ? this.pathDistance(pathB) + Math.hypot(finalSpot.x - nodeB.x, finalSpot.z - nodeB.z)
        : Infinity;

    let chosenPath = costA <= costB ? pathA : pathB;
    const entryNode = costA <= costB ? nodeA : nodeB;
    const farNode = costA <= costB ? nodeB : nodeA;

    if (
      chosenPath.length >= 2 &&
      chosenPath[chosenPath.length - 2].id === farNode.id &&
      chosenPath[chosenPath.length - 1].id === entryNode.id
    ) {
      chosenPath = chosenPath.slice(0, chosenPath.length - 1);
    }

    const wps = this.buildLaneWaypoints(chosenPath, undefined, aggressive);
    const roadY = this.roadSurfaceY;
    const approachNode = chosenPath[chosenPath.length - 1] ?? entryNode;
    const targetEnd = approachNode.id === nodeA.id ? nodeB : nodeA;
    const edge = this.getEdge(approachNode.id, targetEnd.id);
    const offset = aggressive ? this.laneOffset * 0.72 : this.laneOffset;

    if (edge && edge.ctrlX !== undefined && edge.ctrlZ !== undefined) {
      const proj = distToEdge2D(
        finalSpot.x,
        finalSpot.z,
        approachNode.x,
        approachNode.z,
        targetEnd.x,
        targetEnd.z,
        edge.ctrlX,
        edge.ctrlZ,
      );
      const steps = Math.max(2, Math.round(proj.t * 6));
      for (let s = 1; s <= steps; s++) {
        const ts = (proj.t * s) / steps;
        const p = sampleEdgeBezier(
          approachNode.x,
          approachNode.z,
          targetEnd.x,
          targetEnd.z,
          edge.ctrlX,
          edge.ctrlZ,
          ts,
        );
        const rx = -p.tz * offset;
        const rz = p.tx * offset;
        wps.push(new THREE.Vector3(p.x + rx, roadY, p.z + rz));
      }
    } else {
      const segDx = targetEnd.x - approachNode.x;
      const segDz = targetEnd.z - approachNode.z;
      const segLen = Math.hypot(segDx, segDz);

      if (segLen > 1) {
        const ux = segDx / segLen;
        const uz = segDz / segLen;
        const rx = -uz * offset;
        const rz = ux * offset;
        const proj = THREE.MathUtils.clamp(
          (finalSpot.x - approachNode.x) * ux + (finalSpot.z - approachNode.z) * uz,
          0,
          segLen,
        );
        if (proj > 10) {
          wps.push(
            new THREE.Vector3(
              approachNode.x + ux * 8.0 + rx,
              roadY,
              approachNode.z + uz * 8.0 + rz,
            ),
          );
        }
        wps.push(
          new THREE.Vector3(
            approachNode.x + ux * proj + rx,
            roadY,
            approachNode.z + uz * proj + rz,
          ),
        );
      }
    }

    wps.push(finalSpot.clone());
    return wps;
  }

  public buildLaneWaypoints(
    nodePath: RoadNode[],
    finalSpot?: THREE.Vector3,
    aggressive = false,
  ): THREE.Vector3[] {
    if (nodePath.length === 0) return [];
    const roadY = this.roadSurfaceY;
    if (nodePath.length === 1) {
      const res = [new THREE.Vector3(nodePath[0].x, roadY, nodePath[0].z)];
      if (finalSpot) res.push(finalSpot.clone());
      return res;
    }

    const offset = aggressive ? this.laneOffset * 0.72 : this.laneOffset;
    const waypoints: THREE.Vector3[] = [];

    for (let i = 0; i < nodePath.length - 1; i++) {
      const a = nodePath[i];
      const b = nodePath[i + 1];
      const edge = this.getEdge(a.id, b.id);

      let exitRx = 0;
      let exitRz = 0;

      if (edge && edge.ctrlX !== undefined && edge.ctrlZ !== undefined) {
        const subCount = 6;
        for (let s = 1; s < subCount; s++) {
          const t = THREE.MathUtils.lerp(0.1, 0.9, (s - 1) / (subCount - 2));
          const p = sampleEdgeBezier(a.x, a.z, b.x, b.z, edge.ctrlX, edge.ctrlZ, t);
          const rx = -p.tz * offset;
          const rz = p.tx * offset;
          waypoints.push(new THREE.Vector3(p.x + rx, roadY, p.z + rz));
          exitRx = rx;
          exitRz = rz;
        }
      } else {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const rx = -uz * offset;
        const rz = ux * offset;
        const trim = Math.min(10.2, len * 0.28);

        waypoints.push(new THREE.Vector3(a.x + ux * trim + rx, roadY, a.z + uz * trim + rz));
        waypoints.push(new THREE.Vector3(b.x - ux * trim + rx, roadY, b.z - uz * trim + rz));
        exitRx = rx;
        exitRz = rz;
      }

      if (i < nodePath.length - 2) {
        const c = nodePath[i + 2];
        const nextSample = this.sampleDirectedEdge(b, c, 0.05);
        const nrx = -nextSample.tz * offset;
        const nrz = nextSample.tx * offset;
        if (b.nodeType === 'join') {
          const avgRx = (exitRx + nrx) * 0.5;
          const avgRz = (exitRz + nrz) * 0.5;
          waypoints.push(new THREE.Vector3(b.x + avgRx, roadY, b.z + avgRz));
        } else {
          waypoints.push(
            new THREE.Vector3(b.x + (exitRx + nrx) * 0.44, roadY, b.z + (exitRz + nrz) * 0.44),
          );
        }
      }
    }

    if (finalSpot) {
      const last = waypoints[waypoints.length - 1];
      const finalNode = nodePath[nodePath.length - 1];
      if (last) {
        const dx = Math.abs(finalSpot.x - last.x);
        const dz = Math.abs(finalSpot.z - last.z);
        if (dx > 6.5 && dz > 6.5) {
          waypoints.push(new THREE.Vector3(finalNode.x, roadY, finalNode.z));
        }
      }
      waypoints.push(finalSpot.clone());
    }

    return waypoints;
  }

  public generateRandomCrimeSpot(rng: () => number = Math.random): CrimeSpot {
    const candidates: CrimeSpot[] = [];

    for (let idx = 0; idx < this.edges.length; idx++) {
      const e = this.edges[idx];
      if (e.length < 20) continue;
      const nodeA = this.getNodeById(e.a);
      const nodeB = this.getNodeById(e.b);
      if (!nodeA || !nodeB) continue;

      const t = 0.25 + rng() * 0.5;
      const sampled = this.sampleDirectedEdge(nodeA, nodeB, t);
      const baseX = sampled.x;
      const baseZ = sampled.z;
      const side = rng() < 0.5 ? 1 : -1;

      const perpX = -sampled.tz;
      const perpZ = sampled.tx;
      const crimeX = baseX + perpX * side * (this.roadWidth * 0.5 + 2.4);
      const crimeZ = baseZ + perpZ * side * (this.roadWidth * 0.5 + 2.4);

      const nearApron = this.stationZones.some(
        (z) =>
          Math.abs(crimeX - z.cx) < z.width * 0.85 &&
          Math.abs(crimeZ - z.cz) < z.depth * 0.72,
      );
      if (nearApron) continue;

      const roadPullOverPos = new THREE.Vector3(
        baseX + perpX * side * (this.laneOffset + 1.0),
        this.roadSurfaceY,
        baseZ + perpZ * side * (this.laneOffset + 1.0),
      );
      const dirSign = side > 0 ? 1 : -1;
      const roadPullOverYaw = Math.atan2(sampled.tx * dirSign, sampled.tz * dirSign);

      candidates.push({
        x: crimeX,
        z: crimeZ,
        district: this.districts[idx % this.districts.length],
        nearestNodeId: t < 0.5 ? nodeA.id : nodeB.id,
        segmentNodeA: nodeA.id,
        segmentNodeB: nodeB.id,
        roadPullOverPos,
        roadPullOverYaw,
      });
    }

    if (candidates.length === 0) {
      const fallback = this.nodes[0] ?? { id: 0, x: 0, z: 0 };
      return {
        x: fallback.x + 8,
        z: fallback.z + 8,
        district: this.districts[0] ?? 'Metro District',
        nearestNodeId: fallback.id,
        segmentNodeA: fallback.id,
        segmentNodeB: fallback.id,
        roadPullOverPos: new THREE.Vector3(fallback.x, this.roadSurfaceY, fallback.z),
        roadPullOverYaw: 0,
      };
    }

    return candidates[Math.floor(rng() * candidates.length)];
  }
}
