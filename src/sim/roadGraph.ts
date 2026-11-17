import * as THREE from 'three';
import { EngineConfigAsset } from '../assets/assetTypes';

export type WorldConfig = EngineConfigAsset['world'];

export function getSurfaceHeight(x: number, z: number, world: WorldConfig): number {
  const {
    roadCoords,
    roadWidth,
    townHalfSize,
    blockCenters,
    apronBounds,
    parkBlock,
    surfaceHeights,
  } = world;
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
): void {
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  while (waypoints.length > 1) {
    const wp = waypoints[0];
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const dot = dx * fwdX + dz * fwdZ;
    if (dist < 5.5 || (dist < 20 && dot < 2.0)) {
      waypoints.shift();
    } else {
      break;
    }
  }
}

export interface RoadNode {
  id: number;
  gx: number;
  gz: number;
  x: number;
  z: number;
  neighbors: number[];
}

export interface CrimeSpot {
  x: number;
  z: number;
  district: string;
  nearestNodeId: number;
  roadPullOverPos: THREE.Vector3;
  roadPullOverYaw: number;
}

export class TownRoadGraph {
  public readonly world: WorldConfig;
  public readonly nodes: RoadNode[] = [];
  public readonly gridToNode = new Map<string, number>();

  constructor(world: WorldConfig) {
    this.world = world;
    const coords = world.roadCoords;
    const n = coords.length;
    for (let gx = 0; gx < n; gx++) {
      for (let gz = 0; gz < n; gz++) {
        const id = this.nodes.length;
        this.nodes.push({
          id,
          gx,
          gz,
          x: coords[gx],
          z: coords[gz],
          neighbors: [],
        });
        this.gridToNode.set(`${gx},${gz}`, id);
      }
    }

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
        }
      }
    }
  }

  public getNodeAt(gx: number, gz: number): RoadNode {
    const id = this.gridToNode.get(`${gx},${gz}`) ?? 0;
    return this.nodes[id];
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

  public findNearestRoadEntryPoint(x: number, z: number): {
    point: THREE.Vector3;
    nearestNode: RoadNode;
  } {
    const coords = this.world.roadCoords;
    const minCoord = coords[0];
    const maxCoord = coords[coords.length - 1];

    let bestRoadX = coords[0];
    let minDx = Infinity;
    for (const rx of coords) {
      const d = Math.abs(x - rx);
      if (d < minDx) {
        minDx = d;
        bestRoadX = rx;
      }
    }

    let bestRoadZ = coords[0];
    let minDz = Infinity;
    for (const rz of coords) {
      const d = Math.abs(z - rz);
      if (d < minDz) {
        minDz = d;
        bestRoadZ = rz;
      }
    }

    const pt =
      minDx <= minDz
        ? new THREE.Vector3(bestRoadX, 0, THREE.MathUtils.clamp(z, minCoord, maxCoord))
        : new THREE.Vector3(THREE.MathUtils.clamp(x, minCoord, maxCoord), 0, bestRoadZ);

    return {
      point: pt,
      nearestNode: this.findNearestNode(pt.x, pt.z),
    };
  }

  public findNodePath(startId: number, goalId: number): RoadNode[] {
    if (startId === goalId) return [this.nodes[startId]];

    const open = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[startId, 0]]);
    const fScore = new Map<number, number>([
      [startId, this.heuristic(startId, goalId)],
    ]);

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
        const path: RoadNode[] = [this.nodes[current]];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(this.nodes[current]);
        }
        return path;
      }

      open.delete(current);
      const currNode = this.nodes[current];

      for (const neighborId of currNode.neighbors) {
        const nNode = this.nodes[neighborId];
        const stepCost = Math.hypot(nNode.x - currNode.x, nNode.z - currNode.z);
        const tentativeG = (gScore.get(current) ?? Infinity) + stepCost;

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.heuristic(neighborId, goalId));
          open.add(neighborId);
        }
      }
    }

    return [this.nodes[startId], this.nodes[goalId]];
  }

  private heuristic(aId: number, bId: number): number {
    const a = this.nodes[aId];
    const b = this.nodes[bId];
    return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  }

  public buildLaneWaypoints(
    nodePath: RoadNode[],
    finalSpot?: THREE.Vector3,
    aggressive = false,
  ): THREE.Vector3[] {
    if (nodePath.length === 0) return [];
    if (nodePath.length === 1) {
      return finalSpot
        ? [finalSpot.clone()]
        : [new THREE.Vector3(nodePath[0].x, 0, nodePath[0].z)];
    }

    const offset = aggressive ? this.world.laneOffset * 0.78 : this.world.laneOffset;
    const waypoints: THREE.Vector3[] = [];

    for (let i = 0; i < nodePath.length - 1; i++) {
      const a = nodePath[i];
      const b = nodePath[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const rx = -uz * offset;
      const rz = ux * offset;

      const trim = 8.5;
      waypoints.push(new THREE.Vector3(a.x + ux * trim + rx, 0, a.z + uz * trim + rz));
      waypoints.push(new THREE.Vector3(b.x - ux * trim + rx, 0, b.z - uz * trim + rz));

      if (i < nodePath.length - 2) {
        const c = nodePath[i + 2];
        const ndx = c.x - b.x;
        const ndz = c.z - b.z;
        const nlen = Math.hypot(ndx, ndz) || 1;
        const nux = ndx / nlen;
        const nuz = ndz / nlen;
        const nrx = -nuz * offset;
        const nrz = nux * offset;
        waypoints.push(
          new THREE.Vector3(b.x + (rx + nrx) * 0.5, 0, b.z + (rz + nrz) * 0.5),
        );
      }
    }

    if (finalSpot) {
      const last = waypoints[waypoints.length - 1];
      if (last) {
        const dx = Math.abs(finalSpot.x - last.x);
        const dz = Math.abs(finalSpot.z - last.z);
        if (dx > 8 && dz > 8) {
          const finalNode = nodePath[nodePath.length - 1];
          waypoints.push(new THREE.Vector3(finalNode.x, 0, finalNode.z));
        }
      }
      waypoints.push(finalSpot.clone());
    }

    return waypoints;
  }

  public generateRandomCrimeSpot(rng: () => number = Math.random): CrimeSpot {
    const candidates: CrimeSpot[] = [];
    const { roadCoords, roadWidth, laneOffset, districts, stationBounds } = this.world;

    for (let gx = 0; gx < roadCoords.length; gx++) {
      for (let gz = 0; gz < roadCoords.length; gz++) {
        if (gx < roadCoords.length - 1) {
          const x1 = roadCoords[gx];
          const x2 = roadCoords[gx + 1];
          const z = roadCoords[gz];
          const midX = (x1 + x2) * 0.5 + (rng() - 0.5) * 26;
          const side = rng() < 0.5 ? 1 : -1;
          const crimeZ = z + side * (roadWidth * 0.5 + 2.4);
          if (
            !(
              midX > stationBounds.minX - 7 &&
              midX < stationBounds.maxX + 18 &&
              crimeZ > stationBounds.minZ - 7 &&
              crimeZ < stationBounds.maxZ + 8
            )
          ) {
            const roadPullOverPos = new THREE.Vector3(
              midX,
              0,
              z + side * (laneOffset + 1.0),
            );
            const nearest = side > 0 ? this.getNodeAt(gx, gz) : this.getNodeAt(gx + 1, gz);
            candidates.push({
              x: midX,
              z: crimeZ,
              district: districts[(gx * 3 + gz * 5) % districts.length],
              nearestNodeId: nearest.id,
              roadPullOverPos,
              roadPullOverYaw: side > 0 ? Math.PI / 2 : -Math.PI / 2,
            });
          }
        }
        if (gz < roadCoords.length - 1) {
          const x = roadCoords[gx];
          const z1 = roadCoords[gz];
          const z2 = roadCoords[gz + 1];
          const midZ = (z1 + z2) * 0.5 + (rng() - 0.5) * 26;
          const side = rng() < 0.5 ? 1 : -1;
          const crimeX = x + side * (roadWidth * 0.5 + 2.4);
          if (
            !(
              crimeX > stationBounds.minX - 7 &&
              crimeX < stationBounds.maxX + 18 &&
              midZ > stationBounds.minZ - 7 &&
              midZ < stationBounds.maxZ + 8
            )
          ) {
            const roadPullOverPos = new THREE.Vector3(
              x + side * (laneOffset + 1.0),
              0,
              midZ,
            );
            const nearest = side < 0 ? this.getNodeAt(gx, gz) : this.getNodeAt(gx, gz + 1);
            candidates.push({
              x: crimeX,
              z: midZ,
              district: districts[(gx * 5 + gz * 2 + 1) % districts.length],
              nearestNodeId: nearest.id,
              roadPullOverPos,
              roadPullOverYaw: side < 0 ? 0 : Math.PI,
            });
          }
        }
      }
    }

    return candidates[Math.floor(rng() * candidates.length)];
  }
}
