import * as THREE from 'three';
import { PoliceLiveryId, PoliceVehicleKind, WeaponKind } from './types';

/**
 * 400m x 400m Small Town Grid (-200..+200)
 * 5 North-South Avenues and 5 East-West Streets at:
 * [-150, -75, 0, 75, 150]
 * Road width = 14m (±7m), lane center offset = 3.5m from road center.
 * Sidewalk ring = 7m..11m from road center (4m wide sidewalk).
 */
export const ROAD_COORDS = [-150, -75, 0, 75, 150] as const;
export const ROAD_WIDTH = 14;
export const LANE_OFFSET = 3.5;
export const SIDEWALK_WIDTH = 4.0;
export const TOWN_HALF_SIZE = 200;

const BLOCK_CENTERS = [-112.5, -37.5, 37.5, 112.5] as const;
const BLOCK_HALF = (75 - ROAD_WIDTH) * 0.5; // 30.5m

/**
 * Exact surface elevation at world (x, z) matching townBuilder slab/apron/road geometry
 * so dismounted officers, suspects, pedestrians, ragdolls, and parked units never sink.
 */
export function getSurfaceHeight(x: number, z: number): number {
  if (Math.abs(x) <= TOWN_HALF_SIZE && Math.abs(z) <= TOWN_HALF_SIZE) {
    for (let i = 0; i < ROAD_COORDS.length; i++) {
      const c = ROAD_COORDS[i];
      if (Math.abs(x - c) <= ROAD_WIDTH * 0.5 || Math.abs(z - c) <= ROAD_WIDTH * 0.5) {
        return 0.035;
      }
    }

    // Station concrete apron: BoxGeometry(24, 0.18, 58) centered at (-93, 0.09, -36)
    if (x >= -105 && x <= -81 && z >= -65 && z <= -7) {
      return 0.18;
    }

    // Civic park inner lawn at block (2, 2) centered at (37.5, 37.5), half = 26.5
    if (Math.abs(x - 37.5) <= 26.5 && Math.abs(z - 37.5) <= 26.5) {
      return 0.21;
    }

    for (let bx = 0; bx < BLOCK_CENTERS.length; bx++) {
      if (Math.abs(x - BLOCK_CENTERS[bx]) <= BLOCK_HALF) {
        for (let bz = 0; bz < BLOCK_CENTERS.length; bz++) {
          if (Math.abs(z - BLOCK_CENTERS[bz]) <= BLOCK_HALF) {
            return 0.14;
          }
        }
      }
    }
  }
  return 0.0;
}

export interface RoadNode {
  id: number;
  gx: number;
  gz: number;
  x: number;
  z: number;
  neighbors: number[];
}

export interface StationBay {
  id: string;
  callsign: string;
  vehicleKind: PoliceVehicleKind;
  liveryId: PoliceLiveryId;
  weaponKind: WeaponKind;
  isHeavyUnit: boolean;
  parkPos: THREE.Vector3;
  parkYaw: number;
  exitRoadNodeId: number;
  exitPoint: THREE.Vector3;
}

export interface CrimeSpot {
  x: number;
  z: number;
  district: string;
  nearestNodeId: number;
  roadPullOverPos: THREE.Vector3;
  roadPullOverYaw: number;
}

export const STATION_BOUNDS = {
  minX: -138,
  maxX: -88,
  minZ: -63,
  maxZ: -13,
  centerX: -113,
  centerZ: -38,
};

export const STATION_BAYS: StationBay[] = [
  {
    id: 'unit-1',
    callsign: 'UNIT 101',
    vehicleKind: 'sedan',
    liveryId: 'classic_bw',
    weaponKind: 'pistol',
    isHeavyUnit: false,
    parkPos: new THREE.Vector3(-92, 0.18, -58),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 6,
    exitPoint: new THREE.Vector3(-75, 0.035, -58),
  },
  {
    id: 'unit-2',
    callsign: 'UNIT 102',
    vehicleKind: 'suv',
    liveryId: 'navy_silver',
    weaponKind: 'rifle',
    isHeavyUnit: false,
    parkPos: new THREE.Vector3(-92, 0.18, -50),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 6,
    exitPoint: new THREE.Vector3(-75, 0.035, -50),
  },
  {
    id: 'unit-3',
    callsign: 'UNIT 103',
    vehicleKind: 'sedan',
    liveryId: 'forest_cream',
    weaponKind: 'pistol',
    isHeavyUnit: false,
    parkPos: new THREE.Vector3(-92, 0.18, -42),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 7,
    exitPoint: new THREE.Vector3(-75, 0.035, -42),
  },
  {
    id: 'unit-4',
    callsign: 'UNIT 104',
    vehicleKind: 'suv',
    liveryId: 'slate_cobalt',
    weaponKind: 'rifle',
    isHeavyUnit: false,
    parkPos: new THREE.Vector3(-92, 0.18, -34),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 7,
    exitPoint: new THREE.Vector3(-75, 0.035, -34),
  },
  {
    id: 'unit-5',
    callsign: 'VAN 205',
    vehicleKind: 'van',
    liveryId: 'transport_blue',
    weaponKind: 'pistol',
    isHeavyUnit: false,
    parkPos: new THREE.Vector3(-92, 0.18, -26),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 7,
    exitPoint: new THREE.Vector3(-75, 0.035, -26),
  },
  {
    id: 'unit-6',
    callsign: 'SWAT 301',
    vehicleKind: 'van',
    liveryId: 'tactical_swat',
    weaponKind: 'rifle',
    isHeavyUnit: true,
    parkPos: new THREE.Vector3(-92, 0.18, -18),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 7,
    exitPoint: new THREE.Vector3(-75, 0.035, -18),
  },
  {
    id: 'unit-7',
    callsign: 'APC 401',
    vehicleKind: 'apc',
    liveryId: 'tactical_swat',
    weaponKind: 'rifle',
    isHeavyUnit: true,
    parkPos: new THREE.Vector3(-92, 0.18, -10),
    parkYaw: Math.PI / 2,
    exitRoadNodeId: 7,
    exitPoint: new THREE.Vector3(-75, 0.035, -10),
  },
];

export const DISTRICTS = [
  'North Market',
  'Civic Plaza',
  'Oakwood Flats',
  'Station Row',
  'Midtown Arcade',
  'Eastgate Lofts',
  'South Commerce',
  'Harbor Terrace',
];

export class TownRoadGraph {
  public readonly nodes: RoadNode[] = [];
  public readonly gridToNode = new Map<string, number>();

  constructor() {
    const n = ROAD_COORDS.length;
    for (let gx = 0; gx < n; gx++) {
      for (let gz = 0; gz < n; gz++) {
        const id = this.nodes.length;
        this.nodes.push({
          id,
          gx,
          gz,
          x: ROAD_COORDS[gx],
          z: ROAD_COORDS[gz],
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
    let bestRoadX = ROAD_COORDS[0] as number;
    let minDx = Infinity;
    for (const rx of ROAD_COORDS) {
      const d = Math.abs(x - rx);
      if (d < minDx) {
        minDx = d;
        bestRoadX = rx;
      }
    }

    let bestRoadZ = ROAD_COORDS[0] as number;
    let minDz = Infinity;
    for (const rz of ROAD_COORDS) {
      const d = Math.abs(z - rz);
      if (d < minDz) {
        minDz = d;
        bestRoadZ = rz;
      }
    }

    const pt =
      minDx <= minDz
        ? new THREE.Vector3(bestRoadX, 0, THREE.MathUtils.clamp(z, -150, 150))
        : new THREE.Vector3(THREE.MathUtils.clamp(x, -150, 150), 0, bestRoadZ);

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

    const offset = aggressive ? LANE_OFFSET * 0.78 : LANE_OFFSET;
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

    for (let gx = 0; gx < ROAD_COORDS.length; gx++) {
      for (let gz = 0; gz < ROAD_COORDS.length; gz++) {
        if (gx < ROAD_COORDS.length - 1) {
          const x1 = ROAD_COORDS[gx];
          const x2 = ROAD_COORDS[gx + 1];
          const z = ROAD_COORDS[gz];
          const midX = (x1 + x2) * 0.5 + (rng() - 0.5) * 26;
          const side = rng() < 0.5 ? 1 : -1;
          const crimeZ = z + side * (ROAD_WIDTH * 0.5 + 2.4);
          if (!(midX > -145 && midX < -70 && crimeZ > -70 && crimeZ < -5)) {
            const roadPullOverPos = new THREE.Vector3(midX, 0, z + side * (LANE_OFFSET + 1.0));
            const nearest = side > 0 ? this.getNodeAt(gx, gz) : this.getNodeAt(gx + 1, gz);
            candidates.push({
              x: midX,
              z: crimeZ,
              district: DISTRICTS[(gx * 3 + gz * 5) % DISTRICTS.length],
              nearestNodeId: nearest.id,
              roadPullOverPos,
              roadPullOverYaw: side > 0 ? Math.PI / 2 : -Math.PI / 2,
            });
          }
        }
        if (gz < ROAD_COORDS.length - 1) {
          const x = ROAD_COORDS[gx];
          const z1 = ROAD_COORDS[gz];
          const z2 = ROAD_COORDS[gz + 1];
          const midZ = (z1 + z2) * 0.5 + (rng() - 0.5) * 26;
          const side = rng() < 0.5 ? 1 : -1;
          const crimeX = x + side * (ROAD_WIDTH * 0.5 + 2.4);
          if (!(crimeX > -145 && crimeX < -70 && midZ > -70 && midZ < -5)) {
            const roadPullOverPos = new THREE.Vector3(x + side * (LANE_OFFSET + 1.0), 0, midZ);
            const nearest = side < 0 ? this.getNodeAt(gx, gz) : this.getNodeAt(gx, gz + 1);
            candidates.push({
              x: crimeX,
              z: midZ,
              district: DISTRICTS[(gx * 5 + gz * 2 + 1) % DISTRICTS.length],
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
