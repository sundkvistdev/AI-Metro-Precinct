import * as THREE from 'three';
import { TownRoadGraph } from './roadGraph';
import { ActiveCrime, CivilianVehicle, PoliceUnit } from './simActors';
import { AIDebugFlags, AIDebugStats, UnitStatus } from './types';

const MAX_LINE_VERTICES = 4096;
const MAX_NODE_INSTANCES = 512;
const MAX_STATUS_RINGS = 256;

class DynamicLineLayer {
  public readonly lineSegments: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private count = 0;

  constructor(colorHex: number, parent: THREE.Group) {
    this.positions = new Float32Array(MAX_LINE_VERTICES * 3);
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      depthTest: true,
    });
    this.lineSegments = new THREE.LineSegments(geo, mat);
    this.lineSegments.frustumCulled = false;
    this.lineSegments.renderOrder = 10;
    parent.add(this.lineSegments);
  }

  public begin(): void {
    this.count = 0;
  }

  public addSegment(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ): void {
    if (this.count + 2 > MAX_LINE_VERTICES) return;
    const base = this.count * 3;
    this.positions[base] = x1;
    this.positions[base + 1] = y1;
    this.positions[base + 2] = z1;
    this.positions[base + 3] = x2;
    this.positions[base + 4] = y2;
    this.positions[base + 5] = z2;
    this.count += 2;
  }

  public commit(): void {
    this.lineSegments.visible = this.count > 0;
    this.lineSegments.geometry.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.attr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.lineSegments.geometry.dispose();
    (this.lineSegments.material as THREE.Material).dispose();
  }
}

export class AIDebugVisualizer {
  private readonly root = new THREE.Group();
  private readonly policeLines: DynamicLineLayer;
  private readonly pursuitLines: DynamicLineLayer;
  private readonly trafficLines: DynamicLineLayer;
  private readonly avoidLines: DynamicLineLayer;

  private readonly nodeMarkers: THREE.InstancedMesh;
  private readonly crosswalkRings: THREE.InstancedMesh;
  private readonly statusRings: THREE.InstancedMesh;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.root.name = 'AIDebugVisualizerRoot';
    this.root.visible = false;
    scene.add(this.root);

    this.policeLines = new DynamicLineLayer(0x38bdf8, this.root);
    this.pursuitLines = new DynamicLineLayer(0xf97316, this.root);
    this.trafficLines = new DynamicLineLayer(0x34d399, this.root);
    this.avoidLines = new DynamicLineLayer(0xfef08a, this.root);

    const nodeGeo = new THREE.RingGeometry(0.9, 1.45, 18).rotateX(-Math.PI / 2);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.nodeMarkers = new THREE.InstancedMesh(nodeGeo, nodeMat, MAX_NODE_INSTANCES);
    this.nodeMarkers.count = 0;
    this.nodeMarkers.frustumCulled = false;
    this.nodeMarkers.renderOrder = 11;
    this.root.add(this.nodeMarkers);

    const cwGeo = new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2);
    const cwMat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.9,
    });
    this.crosswalkRings = new THREE.InstancedMesh(cwGeo, cwMat, MAX_NODE_INSTANCES);
    this.crosswalkRings.count = 0;
    this.crosswalkRings.frustumCulled = false;
    this.crosswalkRings.renderOrder = 12;
    this.root.add(this.crosswalkRings);

    const statusGeo = new THREE.RingGeometry(1.7, 2.25, 20).rotateX(-Math.PI / 2);
    const statusMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.statusRings = new THREE.InstancedMesh(statusGeo, statusMat, MAX_STATUS_RINGS);
    this.statusRings.count = 0;
    this.statusRings.frustumCulled = false;
    this.statusRings.renderOrder = 12;
    this.root.add(this.statusRings);
  }

  public computeStats(data: {
    units: PoliceUnit[];
    civilianCars: CivilianVehicle[];
    crimes: ActiveCrime[];
    roadGraph: TownRoadGraph | null;
  }): AIDebugStats {
    let activePoliceRoutes = 0;
    let activePursuits = 0;
    let impatientCount = 0;
    let reversingCount = 0;
    let avoidingCount = 0;

    for (const u of data.units) {
      if (u.status !== UnitStatus.AtStation && u.waypointIndex < u.waypoints.length) {
        activePoliceRoutes++;
      }
      if (u.status === UnitStatus.Pursuing) activePursuits++;
      if (u.impatience >= 0.45) impatientCount++;
      if (u.reverseTimer > 0) reversingCount++;
      if (u.debugAvoidActive) avoidingCount++;
    }

    let activeTrafficRoutes = 0;
    for (const c of data.civilianCars) {
      if (!c.immobilized) activeTrafficRoutes++;
      if (c.impatience >= 0.45) impatientCount++;
      if (c.reverseTimer > 0) reversingCount++;
      if (c.debugAvoidActive) avoidingCount++;
    }

    return {
      activePoliceRoutes,
      activePursuits,
      activeTrafficRoutes,
      impatientCount,
      reversingCount,
      avoidingCount,
      roadNodeCount: data.roadGraph?.nodes.length ?? 0,
      roadEdgeCount: data.roadGraph?.edges.length ?? 0,
    };
  }

  public update(
    flags: AIDebugFlags,
    data: {
      units: PoliceUnit[];
      civilianCars: CivilianVehicle[];
      crimes: ActiveCrime[];
      roadGraph: TownRoadGraph | null;
    },
  ): void {
    const anyOn =
      flags.showPolicePaths ||
      flags.showPursuitPaths ||
      flags.showTrafficRoutes ||
      flags.showNodesAndPriority ||
      flags.showAvoidanceAndStuck;

    this.root.visible = anyOn;
    if (!anyOn) return;

    const roadY = (data.roadGraph?.roadSurfaceY ?? 0.035) + 0.55;

    // 1. Police A* Waypoints
    this.policeLines.begin();
    if (flags.showPolicePaths) {
      for (const u of data.units) {
        if (u.status === UnitStatus.AtStation || u.waypointIndex >= u.waypoints.length) {
          continue;
        }
        let px = u.pos.x;
        let pz = u.pos.z;
        for (let i = u.waypointIndex; i < u.waypoints.length; i++) {
          const wp = u.waypoints[i];
          this.policeLines.addSegment(px, roadY, pz, wp.x, roadY, wp.z);
          // Tiny cross tick at each waypoint
          this.policeLines.addSegment(wp.x - 0.5, roadY, wp.z, wp.x + 0.5, roadY, wp.z);
          px = wp.x;
          pz = wp.z;
        }
      }
    }
    this.policeLines.commit();

    // 2. Pursuits (interceptor target & getaway route)
    this.pursuitLines.begin();
    if (flags.showPursuitPaths) {
      for (const cr of data.crimes) {
        if (!cr.inVehiclePursuit || !cr.suspectAlive) continue;
        const curr = data.roadGraph?.getNodeById(cr.vehicleNodeId);
        const next = data.roadGraph?.getNodeById(cr.vehicleNextNodeId);
        if (next) {
          this.pursuitLines.addSegment(
            cr.vehiclePos.x,
            roadY + 0.15,
            cr.vehiclePos.z,
            next.x,
            roadY + 0.15,
            next.z,
          );
        }
        if (curr && next) {
          this.pursuitLines.addSegment(curr.x, roadY + 0.15, curr.z, next.x, roadY + 0.15, next.z);
        }
        for (const u of data.units) {
          if (u.targetCrimeId === cr.id && u.status === UnitStatus.Pursuing) {
            this.pursuitLines.addSegment(
              u.pos.x,
              roadY + 0.25,
              u.pos.z,
              cr.vehiclePos.x,
              roadY + 0.25,
              cr.vehiclePos.z,
            );
          }
        }
      }
    }
    this.pursuitLines.commit();

    // 3. Civilian Traffic A* Route Queue
    this.trafficLines.begin();
    if (flags.showTrafficRoutes && data.roadGraph) {
      for (const car of data.civilianCars) {
        if (car.immobilized) continue;
        let px = car.pos.x;
        let pz = car.pos.z;
        if (car.debugNextTarget) {
          this.trafficLines.addSegment(
            px,
            roadY - 0.1,
            pz,
            car.debugNextTarget.x,
            roadY - 0.1,
            car.debugNextTarget.z,
          );
          px = car.debugNextTarget.x;
          pz = car.debugNextTarget.z;
        }
        const nextNode = data.roadGraph.getNodeById(car.nextNodeId);
        if (nextNode) {
          this.trafficLines.addSegment(px, roadY - 0.1, pz, nextNode.x, roadY - 0.1, nextNode.z);
          px = nextNode.x;
          pz = nextNode.z;
        }
        for (let k = 0; k < Math.min(4, car.routeQueue.length); k++) {
          const qn = data.roadGraph.getNodeById(car.routeQueue[k]);
          if (!qn) continue;
          this.trafficLines.addSegment(px, roadY - 0.1, pz, qn.x, roadY - 0.1, qn.z);
          px = qn.x;
          pz = qn.z;
        }
      }
    }
    this.trafficLines.commit();

    // 4. Road Nodes, Node Types, Crosswalks & Priorities
    let nodeCount = 0;
    let cwCount = 0;
    if (flags.showNodesAndPriority && data.roadGraph) {
      for (const n of data.roadGraph.nodes) {
        if (nodeCount >= MAX_NODE_INSTANCES) break;
        this.dummy.position.set(n.x, roadY - 0.2, n.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.nodeMarkers.setMatrixAt(nodeCount, this.dummy.matrix);

        if (n.nodeType === 'join') {
          this.tmpColor.setHex(0x38bdf8);
        } else if (n.priority === 'stop') {
          this.tmpColor.setHex(0xef4444);
        } else if (n.priority === 'yield') {
          this.tmpColor.setHex(0xf59e0b);
        } else if (n.priority === 'major') {
          this.tmpColor.setHex(0x22c55e);
        } else {
          this.tmpColor.setHex(0xa78bfa);
        }
        this.nodeMarkers.setColorAt(nodeCount, this.tmpColor);
        nodeCount++;

        if (n.hasCrosswalk && cwCount < MAX_NODE_INSTANCES) {
          this.dummy.position.set(n.x, roadY - 0.18, n.z);
          this.dummy.updateMatrix();
          this.crosswalkRings.setMatrixAt(cwCount, this.dummy.matrix);
          cwCount++;
        }
      }
    }
    this.nodeMarkers.count = nodeCount;
    this.nodeMarkers.visible = nodeCount > 0;
    this.nodeMarkers.instanceMatrix.needsUpdate = true;
    if (this.nodeMarkers.instanceColor) this.nodeMarkers.instanceColor.needsUpdate = true;

    this.crosswalkRings.count = cwCount;
    this.crosswalkRings.visible = cwCount > 0;
    this.crosswalkRings.instanceMatrix.needsUpdate = true;

    // 5. Avoidance / Impatience / Reversing / Stuck Highlights
    this.avoidLines.begin();
    let statusCount = 0;
    if (flags.showAvoidanceAndStuck) {
      const addStatus = (
        x: number,
        z: number,
        yaw: number,
        impatience: number,
        reversing: boolean,
        avoidActive?: boolean,
      ) => {
        if (reversing || impatience >= 0.45) {
          if (statusCount < MAX_STATUS_RINGS) {
            this.dummy.position.set(x, roadY - 0.1, z);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            this.statusRings.setMatrixAt(statusCount, this.dummy.matrix);
            this.tmpColor.setHex(reversing ? 0xef4444 : 0xf59e0b);
            this.statusRings.setColorAt(statusCount, this.tmpColor);
            statusCount++;
          }
        }
        if (avoidActive) {
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          this.avoidLines.addSegment(x, roadY + 0.3, z, x + fx * 5.2, roadY + 0.3, z + fz * 5.2);
        }
      };

      for (const u of data.units) {
        if (u.status === UnitStatus.AtStation) continue;
        addStatus(u.pos.x, u.pos.z, u.yaw, u.impatience, u.reverseTimer > 0, u.debugAvoidActive);
      }
      for (const car of data.civilianCars) {
        if (car.immobilized) continue;
        addStatus(
          car.pos.x,
          car.pos.z,
          car.yaw,
          car.impatience,
          car.reverseTimer > 0,
          car.debugAvoidActive,
        );
      }
    }
    this.avoidLines.commit();
    this.statusRings.count = statusCount;
    this.statusRings.visible = statusCount > 0;
    this.statusRings.instanceMatrix.needsUpdate = true;
    if (this.statusRings.instanceColor) this.statusRings.instanceColor.needsUpdate = true;
  }

  public dispose(): void {
    this.policeLines.dispose();
    this.pursuitLines.dispose();
    this.trafficLines.dispose();
    this.avoidLines.dispose();
    this.nodeMarkers.geometry.dispose();
    (this.nodeMarkers.material as THREE.Material).dispose();
    this.crosswalkRings.geometry.dispose();
    (this.crosswalkRings.material as THREE.Material).dispose();
    this.statusRings.geometry.dispose();
    (this.statusRings.material as THREE.Material).dispose();
    this.root.parent?.remove(this.root);
  }
}
