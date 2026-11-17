import * as THREE from 'three';

export interface ObstacleAABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: 'building' | 'station' | 'fountain' | 'prop';
  cx?: number;
  cz?: number;
  halfW?: number;
  halfD?: number;
  rotationY?: number;
}

export function makeObstacleBox(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  kind: ObstacleAABB['kind'],
  rotationY = 0,
): ObstacleAABB {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const c = Math.abs(Math.cos(rotationY));
  const s = Math.abs(Math.sin(rotationY));
  const extX = c * halfW + s * halfD;
  const extZ = s * halfW + c * halfD;
  return {
    minX: cx - extX,
    maxX: cx + extX,
    minZ: cz - extZ,
    maxZ: cz + extZ,
    kind,
    cx,
    cz,
    halfW,
    halfD,
    rotationY,
  };
}

interface StaticBVHNode {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  left: number;
  right: number;
  start: number;
  count: number;
}

export interface CircleBVHResult {
  collided: boolean;
  hitX: number;
  hitZ: number;
  normalX: number;
  normalZ: number;
}

export interface RayBVHResult {
  clear: boolean;
  t: number;
  hitX: number;
  hitZ: number;
  normalX: number;
  normalZ: number;
}

function obstacleToOBB(b: ObstacleAABB): OBB2D {
  const cx = b.cx ?? (b.minX + b.maxX) * 0.5;
  const cz = b.cz ?? (b.minZ + b.maxZ) * 0.5;
  const halfW = b.halfW ?? (b.maxX - b.minX) * 0.5;
  const halfL = b.halfD ?? (b.maxZ - b.minZ) * 0.5;
  const yaw = b.rotationY ?? 0;
  return computeVehicleOBB(cx, cz, yaw, halfW, halfL);
}

/**
 * Balanced 2D BVH for static town geometry (axis-aligned or rotated buildings,
 * precinct hall, civic fountain). Supports O(log N) circle collision, exact
 * vehicle OBB-vs-OBB SAT resolution, and slab raycasting for gunfight LOS & bullets.
 */
export class StaticObstacleBVH {
  private nodes: StaticBVHNode[] = [];
  private items: ObstacleAABB[] = [];
  private stack = new Int32Array(64);

  constructor(obstacles: ObstacleAABB[] = []) {
    if (obstacles.length > 0) {
      this.build(obstacles);
    }
  }

  public build(obstacles: ObstacleAABB[]): void {
    this.items = obstacles.slice();
    this.nodes = [];
    if (this.items.length === 0) return;
    this.buildRecursive(0, this.items.length);
  }

  private buildRecursive(start: number, end: number): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = start; i < end; i++) {
      const b = this.items[i];
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }

    const nodeIdx = this.nodes.length;
    const count = end - start;
    const node: StaticBVHNode = {
      minX,
      maxX,
      minZ,
      maxZ,
      left: -1,
      right: -1,
      start,
      count,
    };
    this.nodes.push(node);

    if (count <= 2) {
      return nodeIdx;
    }

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const splitX = spanX >= spanZ;

    const slice = this.items.slice(start, end);
    slice.sort((a, b) =>
      splitX
        ? (a.minX + a.maxX) * 0.5 - (b.minX + b.maxX) * 0.5
        : (a.minZ + a.maxZ) * 0.5 - (b.minZ + b.maxZ) * 0.5,
    );
    for (let i = 0; i < slice.length; i++) {
      this.items[start + i] = slice[i];
    }

    const mid = start + (count >> 1);
    node.left = this.buildRecursive(start, mid);
    node.right = this.buildRecursive(mid, end);
    return nodeIdx;
  }

  public resolveCircle(pos: THREE.Vector3, radius: number): CircleBVHResult {
    const out: CircleBVHResult = {
      collided: false,
      hitX: pos.x,
      hitZ: pos.z,
      normalX: 0,
      normalZ: 0,
    };
    if (this.nodes.length === 0) return out;

    let sp = 0;
    this.stack[sp++] = 0;
    const rSq = radius * radius;

    while (sp > 0) {
      const n = this.nodes[this.stack[--sp]];
      if (
        pos.x + radius < n.minX ||
        pos.x - radius > n.maxX ||
        pos.z + radius < n.minZ ||
        pos.z - radius > n.maxZ
      ) {
        continue;
      }

      if (n.left === -1) {
        for (let i = n.start; i < n.start + n.count; i++) {
          const b = this.items[i];
          const rot = b.rotationY ?? 0;

          if (Math.abs(rot) > 1e-4 && b.cx !== undefined && b.cz !== undefined && b.halfW !== undefined && b.halfD !== undefined) {
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);
            const rx = cosR;
            const rz = -sinR;
            const fx = sinR;
            const fz = cosR;
            const dcx = pos.x - b.cx;
            const dcz = pos.z - b.cz;
            const lx = dcx * rx + dcz * rz;
            const lz = dcx * fx + dcz * fz;

            const clx = THREE.MathUtils.clamp(lx, -b.halfW, b.halfW);
            const clz = THREE.MathUtils.clamp(lz, -b.halfD, b.halfD);
            const ldx = lx - clx;
            const ldz = lz - clz;
            const distSq = ldx * ldx + ldz * ldz;

            if (distSq < rSq) {
              out.collided = true;
              let lnx = 0;
              let lnz = 0;
              let push = 0;
              if (distSq > 1e-6) {
                const dist = Math.sqrt(distSq);
                lnx = ldx / dist;
                lnz = ldz / dist;
                push = radius - dist;
              } else {
                const dLeft = Math.abs(lx + b.halfW);
                const dRight = Math.abs(b.halfW - lx);
                const dTop = Math.abs(lz + b.halfD);
                const dBot = Math.abs(b.halfD - lz);
                const minD = Math.min(dLeft, dRight, dTop, dBot);
                if (minD === dLeft) lnx = -1;
                else if (minD === dRight) lnx = 1;
                else if (minD === dTop) lnz = -1;
                else lnz = 1;
                push = minD + radius;
              }
              const wnx = rx * lnx + fx * lnz;
              const wnz = rz * lnx + fz * lnz;
              pos.x += wnx * push;
              pos.z += wnz * push;
              out.hitX = b.cx + rx * clx + fx * clz;
              out.hitZ = b.cz + rz * clx + fz * clz;
              out.normalX = wnx;
              out.normalZ = wnz;
            }
            continue;
          }

          const closestX = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
          const closestZ = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
          const dx = pos.x - closestX;
          const dz = pos.z - closestZ;
          const distSq = dx * dx + dz * dz;

          if (distSq < rSq) {
            out.collided = true;
            if (distSq > 1e-6) {
              const dist = Math.sqrt(distSq);
              const nx = dx / dist;
              const nz = dz / dist;
              const push = radius - dist;
              pos.x += nx * push;
              pos.z += nz * push;
              out.hitX = closestX;
              out.hitZ = closestZ;
              out.normalX = nx;
              out.normalZ = nz;
            } else {
              const dLeft = Math.abs(pos.x - b.minX);
              const dRight = Math.abs(b.maxX - pos.x);
              const dTop = Math.abs(pos.z - b.minZ);
              const dBot = Math.abs(b.maxZ - pos.z);
              const minD = Math.min(dLeft, dRight, dTop, dBot);
              if (minD === dLeft) {
                pos.x = b.minX - radius;
                out.normalX = -1;
                out.normalZ = 0;
              } else if (minD === dRight) {
                pos.x = b.maxX + radius;
                out.normalX = 1;
                out.normalZ = 0;
              } else if (minD === dTop) {
                pos.z = b.minZ - radius;
                out.normalX = 0;
                out.normalZ = -1;
              } else {
                pos.z = b.maxZ + radius;
                out.normalX = 0;
                out.normalZ = 1;
              }
              out.hitX = pos.x;
              out.hitZ = pos.z;
            }
          }
        }
      } else {
        this.stack[sp++] = n.left;
        this.stack[sp++] = n.right;
      }
    }

    return out;
  }

  public resolveOBB(
    pos: THREE.Vector3,
    yaw: number,
    halfW: number,
    halfL: number,
  ): CircleBVHResult {
    const out: CircleBVHResult = {
      collided: false,
      hitX: pos.x,
      hitZ: pos.z,
      normalX: 0,
      normalZ: 0,
    };
    if (this.nodes.length === 0) return out;

    let vehOBB = computeVehicleOBB(pos.x, pos.z, yaw, halfW, halfL);
    let sp = 0;
    this.stack[sp++] = 0;
    let bestOverlap = 0;

    while (sp > 0) {
      const n = this.nodes[this.stack[--sp]];
      if (
        vehOBB.maxX < n.minX ||
        vehOBB.minX > n.maxX ||
        vehOBB.maxZ < n.minZ ||
        vehOBB.minZ > n.maxZ
      ) {
        continue;
      }

      if (n.left === -1) {
        for (let i = n.start; i < n.start + n.count; i++) {
          const b = this.items[i];
          if (
            vehOBB.maxX < b.minX ||
            vehOBB.minX > b.maxX ||
            vehOBB.maxZ < b.minZ ||
            vehOBB.minZ > b.maxZ
          ) {
            continue;
          }
          const obsOBB = obstacleToOBB(b);
          const sat = collideOBB2D(vehOBB, obsOBB);
          if (sat.hit && sat.overlap > 1e-4) {
            out.collided = true;
            // SAT normal points from A (vehicle) to B (obstacle), so push vehicle along -normal
            pos.x -= sat.normalX * sat.overlap;
            pos.z -= sat.normalZ * sat.overlap;
            vehOBB = computeVehicleOBB(pos.x, pos.z, yaw, halfW, halfL);
            if (sat.overlap >= bestOverlap) {
              bestOverlap = sat.overlap;
              out.hitX = sat.contactX;
              out.hitZ = sat.contactZ;
              out.normalX = -sat.normalX;
              out.normalZ = -sat.normalZ;
            }
          }
        }
      } else {
        this.stack[sp++] = n.left;
        this.stack[sp++] = n.right;
      }
    }

    return out;
  }

  public raycastSegment(x0: number, z0: number, x1: number, z1: number): RayBVHResult {
    const out: RayBVHResult = {
      clear: true,
      t: 1,
      hitX: x1,
      hitZ: z1,
      normalX: 0,
      normalZ: 0,
    };
    if (this.nodes.length === 0) return out;

    const dx = x1 - x0;
    const dz = z1 - z0;
    const invDx = Math.abs(dx) < 1e-7 ? 1e7 : 1 / dx;
    const invDz = Math.abs(dz) < 1e-7 ? 1e7 : 1 / dz;

    let bestT = 1.0;
    let sp = 0;
    this.stack[sp++] = 0;

    while (sp > 0) {
      const n = this.nodes[this.stack[--sp]];
      if (!this.slabHitsNode(x0, z0, dx, dz, invDx, invDz, n, bestT)) {
        continue;
      }

      if (n.left === -1) {
        for (let i = n.start; i < n.start + n.count; i++) {
          const b = this.items[i];
          const hit = this.slabHitBox(x0, z0, dx, dz, invDx, invDz, b, bestT);
          if (hit && hit.t < bestT) {
            bestT = hit.t;
            out.clear = false;
            out.t = hit.t;
            out.hitX = x0 + dx * hit.t;
            out.hitZ = z0 + dz * hit.t;
            out.normalX = hit.nx;
            out.normalZ = hit.nz;
          }
        }
      } else {
        this.stack[sp++] = n.left;
        this.stack[sp++] = n.right;
      }
    }

    return out;
  }

  private slabHitsNode(
    x0: number,
    z0: number,
    dx: number,
    dz: number,
    invDx: number,
    invDz: number,
    b: { minX: number; maxX: number; minZ: number; maxZ: number },
    maxT: number,
  ): boolean {
    let tmin = 0;
    let tmax = maxT;

    if (Math.abs(dx) < 1e-7) {
      if (x0 < b.minX || x0 > b.maxX) return false;
    } else {
      let t1 = (b.minX - x0) * invDx;
      let t2 = (b.maxX - x0) * invDx;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    if (Math.abs(dz) < 1e-7) {
      if (z0 < b.minZ || z0 > b.maxZ) return false;
    } else {
      let t1 = (b.minZ - z0) * invDz;
      let t2 = (b.maxZ - z0) * invDz;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    return true;
  }

  private slabHitBox(
    x0: number,
    z0: number,
    dx: number,
    dz: number,
    invDx: number,
    invDz: number,
    b: ObstacleAABB,
    maxT: number,
  ): { t: number; nx: number; nz: number } | null {
    const rot = b.rotationY ?? 0;
    if (
      Math.abs(rot) > 1e-4 &&
      b.cx !== undefined &&
      b.cz !== undefined &&
      b.halfW !== undefined &&
      b.halfD !== undefined
    ) {
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const rx = cosR;
      const rz = -sinR;
      const fx = sinR;
      const fz = cosR;

      const ox = x0 - b.cx;
      const oz = z0 - b.cz;
      const lx0 = ox * rx + oz * rz;
      const lz0 = ox * fx + oz * fz;
      const ldx = dx * rx + dz * rz;
      const ldz = dx * fx + dz * fz;

      let tmin = 0;
      let tmax = maxT;
      let lnx = 0;
      let lnz = 0;

      if (Math.abs(ldx) < 1e-7) {
        if (lx0 < -b.halfW || lx0 > b.halfW) return null;
      } else {
        let t1 = (-b.halfW - lx0) / ldx;
        let t2 = (b.halfW - lx0) / ldx;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          lnx = s;
          lnz = 0;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }

      if (Math.abs(ldz) < 1e-7) {
        if (lz0 < -b.halfD || lz0 > b.halfD) return null;
      } else {
        let t1 = (-b.halfD - lz0) / ldz;
        let t2 = (b.halfD - lz0) / ldz;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          lnx = 0;
          lnz = s;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }

      return {
        t: tmin,
        nx: rx * lnx + fx * lnz,
        nz: rz * lnx + fz * lnz,
      };
    }

    let tmin = 0;
    let tmax = maxT;
    let nx = 0;
    let nz = 0;

    if (Math.abs(dx) < 1e-7) {
      if (x0 < b.minX || x0 > b.maxX) return null;
    } else {
      let t1 = (b.minX - x0) * invDx;
      let t2 = (b.maxX - x0) * invDx;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = s;
        nz = 0;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    if (Math.abs(dz) < 1e-7) {
      if (z0 < b.minZ || z0 > b.maxZ) return null;
    } else {
      let t1 = (b.minZ - z0) * invDz;
      let t2 = (b.maxZ - z0) * invDz;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        nz = s;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }

    return { t: tmin, nx, nz };
  }
}

// --- Dynamic Vehicle BVH & 2D OBB Separating Axis Theorem (SAT) ---

export interface OBB2D {
  cx: number;
  cz: number;
  halfW: number;
  halfL: number;
  fx: number; // Forward unit X = sin(yaw)
  fz: number; // Forward unit Z = cos(yaw)
  rx: number; // Left/Right unit X = cos(yaw)
  rz: number; // Left/Right unit Z = -sin(yaw)
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function computeVehicleOBB(
  cx: number,
  cz: number,
  yaw: number,
  halfW: number,
  halfL: number,
): OBB2D {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  const extX = Math.abs(rx) * halfW + Math.abs(fx) * halfL;
  const extZ = Math.abs(rz) * halfW + Math.abs(fz) * halfL;

  return {
    cx,
    cz,
    halfW,
    halfL,
    fx,
    fz,
    rx,
    rz,
    minX: cx - extX,
    maxX: cx + extX,
    minZ: cz - extZ,
    maxZ: cz + extZ,
  };
}

export interface OBBSATResult {
  hit: boolean;
  overlap: number;
  normalX: number; // Points from A to B
  normalZ: number;
  contactX: number;
  contactZ: number;
}

/**
 * Exact 2D Separating Axis Theorem (SAT) test between two oriented vehicle bounding boxes.
 * Estimates the contact point on the colliding bumper/corner for lever-arm torque & part detachment.
 */
export function collideOBB2D(a: OBB2D, b: OBB2D): OBBSATResult {
  const dcx = b.cx - a.cx;
  const dcz = b.cz - a.cz;

  const axes: [number, number][] = [
    [a.rx, a.rz],
    [a.fx, a.fz],
    [b.rx, b.rz],
    [b.fx, b.fz],
  ];

  let minOverlap = Infinity;
  let bestNx = 1;
  let bestNz = 0;

  for (let i = 0; i < 4; i++) {
    const [ax, az] = axes[i];
    const projA =
      Math.abs(a.rx * ax + a.rz * az) * a.halfW +
      Math.abs(a.fx * ax + a.fz * az) * a.halfL;
    const projB =
      Math.abs(b.rx * ax + b.rz * az) * b.halfW +
      Math.abs(b.fx * ax + b.fz * az) * b.halfL;
    const centerDist = Math.abs(dcx * ax + dcz * az);
    const overlap = projA + projB - centerDist;

    if (overlap <= 0) {
      return { hit: false, overlap: 0, normalX: 0, normalZ: 0, contactX: 0, contactZ: 0 };
    }

    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = dcx * ax + dcz * az >= 0 ? 1 : -1;
      bestNx = ax * sign;
      bestNz = az * sign;
    }
  }

  // Find supporting boundary point of A toward +normal and B toward -normal, average for contact manifold
  const signAR = a.rx * bestNx + a.rz * bestNz >= 0 ? 1 : -1;
  const signAF = a.fx * bestNx + a.fz * bestNz >= 0 ? 1 : -1;
  const supAx = a.cx + a.rx * a.halfW * signAR + a.fx * a.halfL * signAF;
  const supAz = a.cz + a.rz * a.halfW * signAR + a.fz * a.halfL * signAF;

  const signBR = b.rx * -bestNx + b.rz * -bestNz >= 0 ? 1 : -1;
  const signBF = b.fx * -bestNx + b.fz * -bestNz >= 0 ? 1 : -1;
  const supBx = b.cx + b.rx * b.halfW * signBR + b.fx * b.halfL * signBF;
  const supBz = b.cz + b.rz * b.halfW * signBR + b.fz * b.halfL * signBF;

  return {
    hit: true,
    overlap: minOverlap,
    normalX: bestNx,
    normalZ: bestNz,
    contactX: (supAx + supBx) * 0.5,
    contactZ: (supAz + supBz) * 0.5,
  };
}

interface DynamicBVHNode {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  left: number;
  right: number;
  index: number; // >=0 for leaf entry index into obbs[]
}

/**
 * Per-frame Dynamic BVH for O(N log N) vehicle broadphase collision pruning.
 */
export class DynamicVehicleBVH {
  private nodes: DynamicBVHNode[] = [];
  private indices: number[] = [];
  private stack = new Int32Array(64);

  public build(obbs: OBB2D[]): void {
    this.nodes = [];
    if (obbs.length === 0) return;
    this.indices = obbs.map((_, i) => i);
    this.buildRecursive(obbs, 0, obbs.length);
  }

  private buildRecursive(obbs: OBB2D[], start: number, end: number): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = start; i < end; i++) {
      const b = obbs[this.indices[i]];
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }

    const nodeIdx = this.nodes.length;
    const count = end - start;
    if (count === 1) {
      this.nodes.push({
        minX,
        maxX,
        minZ,
        maxZ,
        left: -1,
        right: -1,
        index: this.indices[start],
      });
      return nodeIdx;
    }

    const node: DynamicBVHNode = {
      minX,
      maxX,
      minZ,
      maxZ,
      left: -1,
      right: -1,
      index: -1,
    };
    this.nodes.push(node);

    const splitX = maxX - minX >= maxZ - minZ;
    const sub = this.indices.slice(start, end);
    sub.sort((ia, ib) => (splitX ? obbs[ia].cx - obbs[ib].cx : obbs[ia].cz - obbs[ib].cz));
    for (let i = 0; i < sub.length; i++) {
      this.indices[start + i] = sub[i];
    }

    const mid = start + (count >> 1);
    node.left = this.buildRecursive(obbs, start, mid);
    node.right = this.buildRecursive(obbs, mid, end);
    return nodeIdx;
  }

  public queryPairs(obbs: OBB2D[], onPair: (i: number, j: number) => void): void {
    if (this.nodes.length === 0) return;

    for (let i = 0; i < obbs.length; i++) {
      const q = obbs[i];
      let sp = 0;
      this.stack[sp++] = 0;

      while (sp > 0) {
        const n = this.nodes[this.stack[--sp]];
        if (q.maxX < n.minX || q.minX > n.maxX || q.maxZ < n.minZ || q.minZ > n.maxZ) {
          continue;
        }
        if (n.index >= 0) {
          if (n.index > i) {
            onPair(i, n.index);
          }
        } else {
          this.stack[sp++] = n.left;
          this.stack[sp++] = n.right;
        }
      }
    }
  }
}
