import * as THREE from 'three';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { StaticObstacleBVH } from './bvh';
import { pruneLeadingWaypoints, resetOfficerPose } from './policeUnitSystem';
import {
  getSurfaceHeight,
  LANE_OFFSET,
  ROAD_WIDTH,
  STATION_BAYS,
  TownRoadGraph,
} from './roadGraph';
import {
  ActiveCrime,
  CivilianVehicle,
  NailMatActor,
  PoliceUnit,
} from './simActors';
import { DrivingMode, UnitStatus } from './types';
import { SimVfxManager, triggerRagdoll } from './vfx';

interface InterceptSpot {
  roadCenter: THREE.Vector3;
  roadDirX: number;
  roadDirZ: number;
  perpX: number;
  perpZ: number;
  stagingPos: THREE.Vector3;
  stagingYaw: number;
  curbSideSign: 1 | -1;
  targetNodeId: number;
  score: number;
}

let nailMatCounter = 1;

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}

function buildNailMatVisuals(
  roadCenter: THREE.Vector3,
  perpX: number,
  perpZ: number,
  curbSideSign: 1 | -1,
  halfSpan: number,
): {
  group: THREE.Group;
  stripPivot: THREE.Group;
  warningBeacon: THREE.Mesh;
} {
  const group = new THREE.Group();
  const curbX = roadCenter.x + perpX * (curbSideSign * halfSpan);
  const curbZ = roadCenter.z + perpZ * (curbSideSign * halfSpan);
  group.position.set(curbX, 0.044, curbZ);

  // Local +X points across the road toward the opposite curb (-curbSideSign * perp)
  const acrossX = -curbSideSign * perpX;
  const acrossZ = -curbSideSign * perpZ;
  group.rotation.y = Math.atan2(-acrossZ, acrossX);

  // Curbside deployment housing box
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xea580c,
    roughness: 0.45,
    metalness: 0.25,
  });
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.44), boxMat);
  boxMesh.position.set(-0.18, 0.08, 0);
  group.add(boxMesh);

  // Amber curb beacon LED
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const warningBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 8, 8),
    beaconMat,
  );
  warningBeacon.position.set(-0.18, 0.2, 0);
  group.add(warningBeacon);

  // Unrolling spike strip pivot anchored at curb (x = 0 .. totalLen)
  const totalLen = halfSpan * 2;
  const stripPivot = new THREE.Group();
  stripPivot.scale.set(0.06, 1, 1);
  group.add(stripPivot);

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.72,
    metalness: 0.3,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.48,
    metalness: 0.15,
  });
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.9,
  });

  // Main rubber-polymer sleeve
  const sleeve = new THREE.Mesh(
    new THREE.BoxGeometry(totalLen, 0.035, 0.34),
    baseMat,
  );
  sleeve.position.set(totalLen * 0.5, 0.018, 0);
  stripPivot.add(sleeve);

  // High-contrast yellow accordion slats + hollow steel quills
  const slatCount = 16;
  const slatGeo = new THREE.BoxGeometry(0.18, 0.042, 0.38);
  const spikeGeo = new THREE.ConeGeometry(0.032, 0.11, 4);

  for (let i = 0; i < slatCount; i++) {
    const sx = ((i + 0.5) / slatCount) * totalLen;
    if (i % 2 === 0) {
      const slat = new THREE.Mesh(slatGeo, hazardMat);
      slat.position.set(sx, 0.022, 0);
      stripPivot.add(slat);
    }
    for (const sz of [-0.09, 0.09]) {
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(sx, 0.075, sz);
      stripPivot.add(spike);
    }
  }

  return { group, stripPivot, warningBeacon };
}

/**
 * Predicts upcoming road mid-segments where the fleeing getaway car is likely to pass
 * and scores them by intercept feasibility for the deploying police cruiser.
 */
export function pickInterceptRoadSpot(
  crime: ActiveCrime,
  unit: PoliceUnit,
  units: PoliceUnit[],
  roadGraph: TownRoadGraph,
  existingMats: NailMatActor[],
): InterceptSpot | null {
  if (!crime.inVehiclePursuit || !crime.suspectAlive) return null;

  const currNode = roadGraph.nodes[crime.vehicleNodeId];
  const nextNode = roadGraph.nodes[crime.vehicleNextNodeId];
  if (!currNode || !nextNode) return null;

  const suspectFwdX = Math.sin(crime.vehicleYaw);
  const suspectFwdZ = Math.cos(crime.vehicleYaw);
  const suspectSpeed = Math.max(12.5, crime.vehicleSpeed);

  const rawCandidates: Array<{
    ax: number;
    az: number;
    bx: number;
    bz: number;
    t: number;
    nodeId: number;
    routeWeight: number;
  }> = [];

  // 0-hop: far end of current road segment if suspect still has >42m to reach nextNode
  const distToNext = Math.hypot(
    nextNode.x - crime.vehiclePos.x,
    nextNode.z - crime.vehiclePos.z,
  );
  if (distToNext > 42) {
    rawCandidates.push({
      ax: crime.vehiclePos.x,
      az: crime.vehiclePos.z,
      bx: nextNode.x,
      bz: nextNode.z,
      t: 0.72,
      nodeId: crime.vehicleNodeId,
      routeWeight: 1.15,
    });
  }

  // Rank 1-hop outgoing road segments from nextNode using getaway momentum & distance from cops
  const hop1Ids = nextNode.neighbors.filter((n) => n !== crime.vehicleNodeId);
  const hop1Pool = hop1Ids.length > 0 ? hop1Ids : nextNode.neighbors;

  const scoredHop1 = hop1Pool
    .map((id) => {
      const n = roadGraph.nodes[id];
      const dx = n.x - nextNode.x;
      const dz = n.z - nextNode.z;
      const len = Math.hypot(dx, dz) || 1;
      const momentum = (dx / len) * suspectFwdX + (dz / len) * suspectFwdZ;
      let minCopDist = Infinity;
      for (const u of units) {
        if (u.id === unit.id) continue;
        const d = Math.hypot(n.x - u.pos.x, n.z - u.pos.z);
        if (d < minCopDist) minCopDist = d;
      }
      const edgePenalty = Math.abs(n.x) >= 148 || Math.abs(n.z) >= 148 ? -20 : 0;
      const s = momentum * 40 + Math.min(80, minCopDist) * 0.45 + edgePenalty;
      return { id, score: s };
    })
    .sort((a, b) => b.score - a.score);

  for (let h1Idx = 0; h1Idx < Math.min(2, scoredHop1.length); h1Idx++) {
    const hop1 = roadGraph.nodes[scoredHop1[h1Idx].id];
    const w1 = h1Idx === 0 ? 1.25 : 0.72;
    rawCandidates.push({
      ax: nextNode.x,
      az: nextNode.z,
      bx: hop1.x,
      bz: hop1.z,
      t: 0.48,
      nodeId: nextNode.id,
      routeWeight: w1,
    });

    // 2-hop outgoing segments along primary continuation
    const hop2Ids = hop1.neighbors.filter((n) => n !== nextNode.id);
    const dir1X = hop1.x - nextNode.x;
    const dir1Z = hop1.z - nextNode.z;
    const len1 = Math.hypot(dir1X, dir1Z) || 1;
    const scoredHop2 = hop2Ids
      .map((id) => {
        const n2 = roadGraph.nodes[id];
        const dx2 = n2.x - hop1.x;
        const dz2 = n2.z - hop1.z;
        const l2 = Math.hypot(dx2, dz2) || 1;
        const align = (dx2 / l2) * (dir1X / len1) + (dz2 / l2) * (dir1Z / len1);
        return { id, score: align };
      })
      .sort((a, b) => b.score - a.score);

    for (let h2Idx = 0; h2Idx < Math.min(2, scoredHop2.length); h2Idx++) {
      const hop2 = roadGraph.nodes[scoredHop2[h2Idx].id];
      rawCandidates.push({
        ax: hop1.x,
        az: hop1.z,
        bx: hop2.x,
        bz: hop2.z,
        t: 0.42,
        nodeId: hop1.id,
        routeWeight: w1 * (h2Idx === 0 ? 1.05 : 0.65),
      });
    }
  }

  let bestSpot: InterceptSpot | null = null;
  let bestScore = -Infinity;

  for (const cand of rawCandidates) {
    const cx = THREE.MathUtils.lerp(cand.ax, cand.bx, cand.t);
    const cz = THREE.MathUtils.lerp(cand.az, cand.bz, cand.t);

    // Stay clear of station driveway apron & precinct perimeter
    if (cx < -74 && cz < 2) continue;

    // Avoid stacking two spike strips at the same block
    let overlapsExisting = false;
    for (const m of existingMats) {
      if (m.phase === 'recovering') continue;
      const d2 = (m.roadCenter.x - cx) ** 2 + (m.roadCenter.z - cz) ** 2;
      if (d2 < 24 * 24) {
        overlapsExisting = true;
        break;
      }
    }
    if (overlapsExisting) continue;

    const dx = cand.bx - cand.ax;
    const dz = cand.bz - cand.az;
    const segLen = Math.hypot(dx, dz) || 1;
    const roadDirX = dx / segLen;
    const roadDirZ = dz / segLen;
    const perpX = -roadDirZ;
    const perpZ = roadDirX;

    const suspectDist = Math.hypot(cx - crime.vehiclePos.x, cz - crime.vehiclePos.z);
    if (suspectDist < 28) continue;

    const copDist = Math.hypot(cx - unit.pos.x, cz - unit.pos.z);
    const suspectEta = suspectDist / suspectSpeed;
    const copEta = copDist / 16.5;
    const marginSec = suspectEta - copEta;

    // Prefer places the cruiser can reach ahead of the suspect
    if (marginSec < -2.4) continue;

    // Choose the curb shoulder closer to the cruiser's approach side
    const sideDot =
      (unit.pos.x - cx) * perpX + (unit.pos.z - cz) * perpZ;
    const curbSideSign: 1 | -1 = sideDot >= 0 ? 1 : -1;

    // Cruiser parks cleanly along the outer curb/shoulder just past the strip line
    const shoulderOffset = ROAD_WIDTH * 0.5 + 1.4;
    const stagX = cx + perpX * (curbSideSign * shoulderOffset) + roadDirX * 3.8;
    const stagZ = cz + perpZ * (curbSideSign * shoulderOffset) + roadDirZ * 3.8;

    const stagingPos = new THREE.Vector3(
      stagX,
      getSurfaceHeight(stagX, stagZ),
      stagZ,
    );
    const stagingYaw =
      Math.atan2(roadDirX, roadDirZ) - curbSideSign * 0.24;

    const timeWindowScore = THREE.MathUtils.clamp(marginSec, -2.5, 6.0) * 14;
    const idealDistScore = -Math.abs(suspectDist - 78) * 0.18;
    const score = cand.routeWeight * 48 + timeWindowScore + idealDistScore;

    if (score > bestScore) {
      bestScore = score;
      bestSpot = {
        roadCenter: new THREE.Vector3(cx, 0.035, cz),
        roadDirX,
        roadDirZ,
        perpX,
        perpZ,
        stagingPos,
        stagingYaw,
        curbSideSign,
        targetNodeId: cand.nodeId,
        score,
      };
    }
  }

  return bestSpot;
}

export function assignUnitToNailMat(
  crime: ActiveCrime,
  unit: PoliceUnit,
  units: PoliceUnit[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  scene: THREE.Scene,
  audio: JsonAudioSynth | null,
): boolean {
  if (!crime.inVehiclePursuit || !crime.suspectAlive) return false;
  if (!unit.mounted || unit.immobilized || unit.status === UnitStatus.DeployingSpikes) {
    return false;
  }

  const spot = pickInterceptRoadSpot(crime, unit, units, roadGraph, nailMats);
  if (!spot) return false;

  const matId = `mat-${nailMatCounter++}`;
  const halfSpan = 5.5;
  const visuals = buildNailMatVisuals(
    spot.roadCenter,
    spot.perpX,
    spot.perpZ,
    spot.curbSideSign,
    halfSpan,
  );
  visuals.group.visible = false;
  scene.add(visuals.group);

  const mat: NailMatActor = {
    id: matId,
    crimeId: crime.id,
    unitId: unit.id,
    officerIndex: 1,
    phase: 'en_route',
    roadCenter: spot.roadCenter,
    perpX: spot.perpX,
    perpZ: spot.perpZ,
    roadDirX: spot.roadDirX,
    roadDirZ: spot.roadDirZ,
    halfSpan,
    stagingPos: spot.stagingPos,
    stagingYaw: spot.stagingYaw,
    curbSideSign: spot.curbSideSign,
    deployProgress: 0,
    armedTimer: 22.0,
    recheckTimer: 1.1,
    triggeredBySuspect: false,
    group: visuals.group,
    stripPivot: visuals.stripPivot,
    warningBeacon: visuals.warningBeacon,
  };
  nailMats.push(mat);

  unit.targetCrimeId = crime.id;
  unit.pursuitRole = 'nail_mat';
  unit.status = UnitStatus.DeployingSpikes;
  unit.lightsActive = true;
  unit.sirensActive = true;
  unit.freeRoam = false;
  unit.repathTimer = 1.2;
  unit.avoidanceSteer = 0;

  routeUnitToInterceptSpot(unit, spot, roadGraph);
  crime.nailMatAttempts++;
  audio?.playAssetAt('dispatch_chirp');
  return true;
}

function routeUnitToInterceptSpot(
  unit: PoliceUnit,
  spot: InterceptSpot,
  roadGraph: TownRoadGraph,
): void {
  const bay = STATION_BAYS[unit.bayIndex];
  const wps: THREE.Vector3[] = [];
  let routeStartNodeId: number;

  if (unit.pos.x < -80) {
    const laneExitX =
      -75 + (spot.roadCenter.z > unit.pos.z ? -LANE_OFFSET : LANE_OFFSET);
    wps.push(new THREE.Vector3(laneExitX, 0.035, bay.parkPos.z));
    const pathN = roadGraph.findNodePath(6, spot.targetNodeId);
    const pathS = roadGraph.findNodePath(7, spot.targetNodeId);
    routeStartNodeId = pathN.length <= pathS.length ? 6 : 7;
  } else {
    const entry = roadGraph.findNearestRoadEntryPoint(unit.pos.x, unit.pos.z);
    if (unit.pos.distanceToSquared(entry.point) > 9) {
      wps.push(entry.point);
    }
    routeStartNodeId = entry.nearestNode.id;
  }

  const nodePath = roadGraph.findNodePath(routeStartNodeId, spot.targetNodeId);
  wps.push(...roadGraph.buildLaneWaypoints(nodePath, spot.stagingPos, true));
  if (unit.pos.x >= -80) {
    pruneLeadingWaypoints(unit.pos, unit.yaw, wps);
  }
  unit.waypoints = wps;
  unit.waypointIndex = 0;
}

function startNailMatRecovery(
  mat: NailMatActor,
  unit: PoliceUnit | undefined,
): void {
  mat.phase = 'recovering';
  if (unit) {
    unit.pursuitRole = 'direct';
    if (!unit.mounted && unit.status === UnitStatus.DeployingSpikes) {
      unit.holdTimer = 0;
      unit.mountTimer = 0;
      unit.officers.forEach((o) => {
        o.mountPhase = 'walk';
        o.boardTimer = 0;
      });
      unit.status = UnitStatus.Mounting;
    } else if (unit.status === UnitStatus.DeployingSpikes) {
      unit.status = unit.targetCrimeId ? UnitStatus.Pursuing : UnitStatus.Returning;
      unit.repathTimer = 0;
    }
  }
}

export function isPointNearArmedNailMat(
  x: number,
  z: number,
  fwdX: number,
  fwdZ: number,
  nailMats: NailMatActor[],
): boolean {
  for (const mat of nailMats) {
    if (mat.phase !== 'armed' && mat.phase !== 'deploying') continue;
    const dx = mat.roadCenter.x - x;
    const dz = mat.roadCenter.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq > 17 * 17) continue;
    const forwardDot = dx * fwdX + dz * fwdZ;
    if (forwardDot > 1.5 && forwardDot < 16.5) {
      return true;
    }
  }
  return false;
}

export function updateNailMats(
  nailMats: NailMatActor[],
  units: PoliceUnit[],
  crimes: ActiveCrime[],
  civilianCars: CivilianVehicle[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  vfx: SimVfxManager,
  audio: JsonAudioSynth | null,
  scene: THREE.Scene,
  simTime: number,
  rng: () => number,
  dt: number,
): void {
  for (let i = nailMats.length - 1; i >= 0; i--) {
    const mat = nailMats[i];
    const unit = units.find((u) => u.id === mat.unitId);
    const crime = crimes.find((c) => c.id === mat.crimeId);

    // Blink amber safety beacon
    const beaconBlink = Math.sin(simTime * 11 + i * 1.3) > 0;
    const beaconMat = mat.warningBeacon.material as THREE.MeshBasicMaterial;
    beaconMat.color.setHex(beaconBlink ? 0xfbbf24 : 0x78350f);

    if (
      !unit ||
      unit.immobilized ||
      unit.status === UnitStatus.Retreating ||
      unit.status === UnitStatus.AtStation
    ) {
      scene.remove(mat.group);
      disposeGroup(mat.group);
      nailMats.splice(i, 1);
      continue;
    }

    if (mat.phase === 'en_route') {
      if (!crime || !crime.suspectAlive || !crime.inVehiclePursuit) {
        scene.remove(mat.group);
        disposeGroup(mat.group);
        nailMats.splice(i, 1);
        unit.pursuitRole = 'direct';
        if (unit.status === UnitStatus.DeployingSpikes) {
          unit.status = crime && crime.suspectAlive ? UnitStatus.Responding : UnitStatus.Returning;
          unit.repathTimer = 0;
        }
        continue;
      }

      // Check arrival at curb staging spot
      const distToStage = Math.hypot(
        mat.stagingPos.x - unit.pos.x,
        mat.stagingPos.z - unit.pos.z,
      );
      if (distToStage < 4.8 || unit.waypointIndex >= unit.waypoints.length) {
        // Park cleanly along curb and dismount officer with nail mat
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
        unit.dyn.omega = 0;
        unit.sirensActive = false;
        unit.lightsActive = true;
        unit.mounted = false;

        const off = unit.officers[mat.officerIndex];
        const curbX = mat.roadCenter.x + mat.perpX * (mat.curbSideSign * (mat.halfSpan + 0.55));
        const curbZ = mat.roadCenter.z + mat.perpZ * (mat.curbSideSign * (mat.halfSpan + 0.55));
        off.pos.set(curbX, 0, curbZ);
        staticBvh.resolveCircle(off.pos, 0.42);
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
        off.yaw = Math.atan2(
          mat.roadCenter.x - off.pos.x,
          mat.roadCenter.z - off.pos.z,
        );
        off.ragdoll.active = false;
        resetOfficerPose(off, off.yaw);
        off.rig.torso.position.y = off.rig.torsoBaseY - 0.16;
        off.rig.root.position.copy(off.pos);
        off.rig.root.rotation.y = off.yaw;
        off.rig.root.visible = true;

        mat.phase = 'deploying';
        mat.deployProgress = 0;
        mat.group.visible = true;
        mat.stripPivot.scale.set(0.06, 1, 1);
        continue;
      }

      // Re-evaluate if suspect drove completely past or turned onto an opposite road
      mat.recheckTimer -= dt;
      if (mat.recheckTimer <= 0) {
        mat.recheckTimer = 1.25;
        const toMatX = mat.roadCenter.x - crime.vehiclePos.x;
        const toMatZ = mat.roadCenter.z - crime.vehiclePos.z;
        const suspectDist = Math.hypot(toMatX, toMatZ);
        const suspectFwdX = Math.sin(crime.vehicleYaw);
        const suspectFwdZ = Math.cos(crime.vehicleYaw);
        const movingToward =
          (toMatX / (suspectDist || 1)) * suspectFwdX +
          (toMatZ / (suspectDist || 1)) * suspectFwdZ;

        if (suspectDist > 34 && movingToward < -0.25 && distToStage > 18) {
          const better = pickInterceptRoadSpot(crime, unit, units, roadGraph, nailMats);
          if (better) {
            scene.remove(mat.group);
            disposeGroup(mat.group);
            const visuals = buildNailMatVisuals(
              better.roadCenter,
              better.perpX,
              better.perpZ,
              better.curbSideSign,
              mat.halfSpan,
            );
            visuals.group.visible = false;
            scene.add(visuals.group);

            mat.roadCenter.copy(better.roadCenter);
            mat.roadDirX = better.roadDirX;
            mat.roadDirZ = better.roadDirZ;
            mat.perpX = better.perpX;
            mat.perpZ = better.perpZ;
            mat.stagingPos.copy(better.stagingPos);
            mat.stagingYaw = better.stagingYaw;
            mat.curbSideSign = better.curbSideSign;
            mat.group = visuals.group;
            mat.stripPivot = visuals.stripPivot;
            mat.warningBeacon = visuals.warningBeacon;
            routeUnitToInterceptSpot(unit, better, roadGraph);
          } else {
            // Fall back to direct pursuit
            scene.remove(mat.group);
            disposeGroup(mat.group);
            nailMats.splice(i, 1);
            unit.pursuitRole = 'direct';
            unit.status = UnitStatus.Pursuing;
            unit.repathTimer = 0;
          }
        }
      }
      continue;
    }

    const off = unit.officers[mat.officerIndex];

    if (mat.phase === 'deploying') {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;

      // Suspect can strike the deploying officer if arriving mid-toss
      if (crime && crime.inVehiclePursuit && crime.vehicleSpeed > 4.2 && !off.ragdoll.active) {
        const dxS = off.pos.x - crime.vehiclePos.x;
        const dzS = off.pos.z - crime.vehiclePos.z;
        if (dxS * dxS + dzS * dzS < 2.2 * 2.2) {
          const hitDirX = Math.sin(crime.vehicleYaw);
          const hitDirZ = Math.cos(crime.vehicleYaw);
          triggerRagdoll(
            off.ragdoll,
            rng,
            hitDirX * crime.vehicleSpeed * 0.55,
            4.2,
            hitDirZ * crime.vehicleSpeed * 0.55,
            2.6,
          );
          vfx.spawnBloodImpact(off.pos.x, off.pos.y + 1.0, off.pos.z, hitDirX, hitDirZ, 0.85, true);
          off.hp = Math.max(15, off.hp - 36);
          startNailMatRecovery(mat, unit);
          continue;
        }
      }

      if (!crime || !crime.suspectAlive || !crime.inVehiclePursuit || off.hp <= 0 || off.ragdoll.active) {
        startNailMatRecovery(mat, unit);
        continue;
      }

      mat.deployProgress = Math.min(1, mat.deployProgress + dt / 0.85);
      const ease = mat.deployProgress * mat.deployProgress * (3 - 2 * mat.deployProgress);
      mat.stripPivot.scale.set(0.06 + 0.94 * ease, 1, 1);

      off.rig.torso.position.y = THREE.MathUtils.lerp(
        off.rig.torsoBaseY - 0.24,
        off.rig.torsoBaseY - 0.08,
        ease,
      );
      off.rig.rightArm.rotation.x = THREE.MathUtils.lerp(-0.95, -0.3, ease);
      off.rig.leftArm.rotation.x = -0.35;
      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.y = off.yaw;

      // Check early hit once 70% unrolled across the road
      if (mat.deployProgress >= 0.72) {
        const hit = checkSuspectOverNailMat(
          mat,
          crime,
          vfx,
          audio,
          rng,
        );
        if (hit) {
          startNailMatRecovery(mat, unit);
          continue;
        }
      }

      if (mat.deployProgress >= 1) {
        mat.phase = 'armed';
        mat.armedTimer = 22.0;
        off.rig.torso.position.y = off.rig.torsoBaseY;
        off.rig.rightArm.rotation.x = -0.42;
        off.rig.leftArm.rotation.x = -0.22;
      }
      continue;
    }

    if (mat.phase === 'armed') {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;
      mat.armedTimer -= dt;

      if (!crime || !crime.suspectAlive || !crime.inVehiclePursuit || mat.armedTimer <= 0 || off.hp <= 0) {
        startNailMatRecovery(mat, unit);
        continue;
      }

      // Officer stands ready on sidewalk watching suspect approach
      off.yaw = Math.atan2(
        crime.vehiclePos.x - off.pos.x,
        crime.vehiclePos.z - off.pos.z,
      );
      off.rig.torso.position.y = off.rig.torsoBaseY;
      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.y = off.yaw;

      // Friendly pull-cord: retract strip briefly when a friendly cruiser passes through while suspect is far
      const suspectDistSq = crime.vehiclePos.distanceToSquared(mat.roadCenter);
      let friendlyPassing = false;
      if (suspectDistSq > 16 * 16) {
        for (const u of units) {
          if (u.id === unit.id || u.status === UnitStatus.AtStation) continue;
          if (u.pos.distanceToSquared(mat.roadCenter) < 9.5 * 9.5) {
            friendlyPassing = true;
            break;
          }
        }
      }

      const targetStripScale = friendlyPassing ? 0.16 : 1.0;
      mat.stripPivot.scale.x = THREE.MathUtils.damp(
        mat.stripPivot.scale.x,
        targetStripScale,
        14,
        dt,
      );

      if (!friendlyPassing) {
        if (checkSuspectOverNailMat(mat, crime, vfx, audio, rng)) {
          startNailMatRecovery(mat, unit);
          continue;
        }

        // Civilian vehicle crossing an armed strip at speed
        let civHit = false;
        for (const civ of civilianCars) {
          if (civ.immobilized || civ.speed < 3.5) continue;
          if (isVehicleTouchingStrip(civ.pos, mat)) {
            civ.immobilized = true;
            civ.immobilizeTilt = (rng() < 0.5 ? 1 : -1) * 0.14;
            civ.damageSmokeTimer = Math.max(civ.damageSmokeTimer, 12);
            vfx.spawnImpactSparks(civ.pos.x, 0.35, civ.pos.z, 9, 1.0, 0, 0);
            audio?.playTireBlowoutAt(civ.pos);
            civHit = true;
            break;
          }
        }
        if (civHit) {
          startNailMatRecovery(mat, unit);
          continue;
        }
      }
      continue;
    }

    // 'recovering': retract strip quickly and clean up mesh
    mat.stripPivot.scale.x = THREE.MathUtils.damp(mat.stripPivot.scale.x, 0.04, 16, dt);
    if (mat.stripPivot.scale.x < 0.1) {
      scene.remove(mat.group);
      disposeGroup(mat.group);
      nailMats.splice(i, 1);
    }
  }
}

function isVehicleTouchingStrip(pos: THREE.Vector3, mat: NailMatActor): boolean {
  const dx = pos.x - mat.roadCenter.x;
  const dz = pos.z - mat.roadCenter.z;
  const along = dx * mat.roadDirX + dz * mat.roadDirZ;
  const across = dx * mat.perpX + dz * mat.perpZ;
  return Math.abs(along) < 1.35 && Math.abs(across) < mat.halfSpan * mat.stripPivot.scale.x;
}

function checkSuspectOverNailMat(
  mat: NailMatActor,
  crime: ActiveCrime,
  vfx: SimVfxManager,
  audio: JsonAudioSynth | null,
  rng: () => number,
): boolean {
  if (!crime.inVehiclePursuit || crime.vehicleImmobilized || crime.vehicleTireBlowoutTimer > 0) {
    return false;
  }
  if (!isVehicleTouchingStrip(crime.vehiclePos, mat)) {
    return false;
  }

  // Punctured! Shred tires -> sparks, blowout pop/hiss, violent swerve, then immobilization & bailout
  mat.triggeredBySuspect = true;
  crime.vehicleTireBlowoutTimer = 1.15;
  crime.vehicleHp = Math.max(0, crime.vehicleHp - 44);
  crime.vehicleSmokeTimer = Math.max(crime.vehicleSmokeTimer, 16);
  crime.vehicleDyn.omega += (rng() < 0.5 ? 1 : -1) * (2.6 + rng() * 1.9);

  for (const side of [-0.88, 0.88]) {
    for (const end of [-1.25, 1.25]) {
      const fx = Math.sin(crime.vehicleYaw);
      const fz = Math.cos(crime.vehicleYaw);
      const rx = Math.cos(crime.vehicleYaw);
      const rz = -Math.sin(crime.vehicleYaw);
      const wx = crime.vehiclePos.x + rx * side + fx * end;
      const wz = crime.vehiclePos.z + rz * side + fz * end;
      vfx.spawnImpactSparks(wx, 0.25, wz, 5, 1.2, -fx * 4, -fz * 4);
    }
  }

  audio?.playTireBlowoutAt(crime.vehiclePos);
  return true;
}
