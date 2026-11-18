import * as THREE from 'three';
import { CustomMapAsset, EngineConfigAsset } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { StaticObstacleBVH } from './bvh';
import { playBoundAudioEvent } from './eventBindings';
import { resetOfficerPose } from './policeUnitSystem';
import {
  getSurfaceHeight,
  pruneLeadingWaypoints,
  TownRoadGraph,
} from './roadGraph';
import { disposeGroupContents, SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  AssailantActor,
  CivilianVehicle,
  NailMatActor,
  OfficerActor,
  PoliceUnit,
  resolveCrimePrimaryAssailant,
  resolveUnitOfficers,
} from './simActors';
import { UnitStatus } from './types';
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

function disposeNailMatObject(group: THREE.Group): void {
  const wrapper = new THREE.Group();
  wrapper.add(group);
  disposeGroupContents(wrapper);
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

  const acrossX = -curbSideSign * perpX;
  const acrossZ = -curbSideSign * perpZ;
  group.rotation.y = Math.atan2(-acrossZ, acrossX);

  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xea580c,
    roughness: 0.45,
    metalness: 0.25,
  });
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.44), boxMat);
  boxMesh.position.set(-0.18, 0.08, 0);
  group.add(boxMesh);

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  const warningBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 8, 8),
    beaconMat,
  );
  warningBeacon.position.set(-0.18, 0.2, 0);
  group.add(warningBeacon);

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

  const sleeve = new THREE.Mesh(
    new THREE.BoxGeometry(totalLen, 0.035, 0.34),
    baseMat,
  );
  sleeve.position.set(totalLen * 0.5, 0.018, 0);
  stripPivot.add(sleeve);

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

export function pickInterceptRoadSpot(
  crime: ActiveCrime,
  unit: PoliceUnit,
  units: PoliceUnit[],
  assailantsById: Map<string, AssailantActor>,
  roadGraph: TownRoadGraph,
  existingMats: NailMatActor[],
  config?: EngineConfigAsset,
  map?: CustomMapAsset,
): InterceptSpot | null {
  const primarySuspect = resolveCrimePrimaryAssailant(crime, assailantsById);
  if (!crime.inVehiclePursuit || !primarySuspect?.alive) return null;

  const surface = map ?? config?.world;
  const currNode = roadGraph.getNodeById(crime.vehicleNodeId);
  const nextNode = roadGraph.getNodeById(crime.vehicleNextNodeId);
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

  const hop1Ids = nextNode.neighbors.filter((n) => n !== crime.vehicleNodeId);
  const hop1Pool = hop1Ids.length > 0 ? hop1Ids : nextNode.neighbors;

  const edgeBound = Math.max(80, roadGraph.townHalfSize - 2);
  const scoredHop1 = hop1Pool
    .map((id) => {
      const n = roadGraph.getNodeById(id);
      if (!n) return { id, score: -999 };
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
      const edgePenalty = Math.abs(n.x) >= edgeBound || Math.abs(n.z) >= edgeBound ? -20 : 0;
      const s = momentum * 40 + Math.min(80, minCopDist) * 0.45 + edgePenalty;
      return { id, score: s };
    })
    .sort((a, b) => b.score - a.score);

  for (let h1Idx = 0; h1Idx < Math.min(2, scoredHop1.length); h1Idx++) {
    const hop1 = roadGraph.getNodeById(scoredHop1[h1Idx].id);
    if (!hop1) continue;
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

    const hop2Ids = hop1.neighbors.filter((n) => n !== nextNode.id);
    const dir1X = hop1.x - nextNode.x;
    const dir1Z = hop1.z - nextNode.z;
    const len1 = Math.hypot(dir1X, dir1Z) || 1;
    const scoredHop2 = hop2Ids
      .map((id) => {
        const n2 = roadGraph.getNodeById(id);
        if (!n2) return { id, score: -999 };
        const dx2 = n2.x - hop1.x;
        const dz2 = n2.z - hop1.z;
        const l2 = Math.hypot(dx2, dz2) || 1;
        const align = (dx2 / l2) * (dir1X / len1) + (dz2 / l2) * (dir1Z / len1);
        return { id, score: align };
      })
      .sort((a, b) => b.score - a.score);

    for (let h2Idx = 0; h2Idx < Math.min(2, scoredHop2.length); h2Idx++) {
      const hop2 = roadGraph.getNodeById(scoredHop2[h2Idx].id);
      if (!hop2) continue;
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

    const nearApron = roadGraph.stationZones.some(
      (z) =>
        Math.abs(cx - z.cx) < z.width * 0.55 + 7 &&
        Math.abs(cz - z.cz) < z.depth * 0.55 + 4,
    );
    if (nearApron) continue;

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
    if (marginSec < -2.4) continue;

    const sideDot =
      (unit.pos.x - cx) * perpX + (unit.pos.z - cz) * perpZ;
    const curbSideSign: 1 | -1 = sideDot >= 0 ? 1 : -1;

    const shoulderOffset = roadGraph.roadWidth * 0.5 + 1.4;
    const stagX = cx + perpX * (curbSideSign * shoulderOffset) + roadDirX * 3.8;
    const stagZ = cz + perpZ * (curbSideSign * shoulderOffset) + roadDirZ * 3.8;

    const stagingY = surface ? getSurfaceHeight(stagX, stagZ, surface) : roadGraph.roadSurfaceY;
    const stagingPos = new THREE.Vector3(stagX, stagingY, stagZ);
    const stagingYaw =
      Math.atan2(roadDirX, roadDirZ) - curbSideSign * 0.24;

    const timeWindowScore = THREE.MathUtils.clamp(marginSec, -2.5, 6.0) * 14;
    const idealDistScore = -Math.abs(suspectDist - 78) * 0.18;
    const score = cand.routeWeight * 48 + timeWindowScore + idealDistScore;

    if (score > bestScore) {
      bestScore = score;
      bestSpot = {
        roadCenter: new THREE.Vector3(cx, roadGraph.roadSurfaceY, cz),
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
  assailantsById: Map<string, AssailantActor>,
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  config: EngineConfigAsset,
  hierarchy: SceneWorldHierarchy,
  audio: JsonAudioSynth | null,
  staticBvh?: StaticObstacleBVH,
  map?: CustomMapAsset,
): boolean {
  const primarySuspect = resolveCrimePrimaryAssailant(crime, assailantsById);
  if (!crime.inVehiclePursuit || !primarySuspect?.alive) return false;
  if (!unit.mounted || unit.immobilized || unit.status === UnitStatus.DeployingSpikes) {
    return false;
  }

  const spot = pickInterceptRoadSpot(
    crime,
    unit,
    units,
    assailantsById,
    roadGraph,
    nailMats,
    config,
    map,
  );
  if (!spot) return false;

  const matId = `mat-${nailMatCounter++}`;
  const halfSpan = Math.max(4.4, roadGraph.roadWidth * 0.46);
  const visuals = buildNailMatVisuals(
    spot.roadCenter,
    spot.perpX,
    spot.perpZ,
    spot.curbSideSign,
    halfSpan,
  );
  visuals.group.visible = false;
  hierarchy.addEntity(visuals.group);

  const officerId = unit.officerRefs[1] ?? unit.officerRefs[0] ?? '';

  const mat: NailMatActor = {
    id: matId,
    crimeId: crime.id,
    unitId: unit.id,
    officerId,
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
  unit.assignedCaseNumber = crime.caseNumber;
  unit.assignedRole = 'spikes';
  if (!crime.assignedUnitIds.includes(unit.id)) {
    crime.assignedUnitIds.push(unit.id);
  }
  unit.pursuitRole = 'nail_mat';
  unit.status = UnitStatus.DeployingSpikes;
  unit.lightsActive = true;
  unit.sirensActive = true;
  unit.freeRoam = false;
  unit.repathTimer = 1.2;
  unit.avoidanceSteer = 0;
  unit.stuckTimer = 0;
  unit.reverseTimer = 0;

  routeUnitToInterceptSpot(unit, spot, roadGraph, config, staticBvh, map);
  crime.nailMatAttempts++;
  playBoundAudioEvent(audio, config, 'dispatch_chirp');
  return true;
}

function routeUnitToInterceptSpot(
  unit: PoliceUnit,
  spot: InterceptSpot,
  roadGraph: TownRoadGraph,
  config: EngineConfigAsset,
  staticBvh?: StaticObstacleBVH,
  map?: CustomMapAsset,
): void {
  const surface = map ?? config.world;
  const laneOffset = roadGraph.laneOffset;
  const { primary, secondary } = roadGraph.findStationExitNodeIds();
  const primaryNode = roadGraph.getNodeById(primary);
  const secondaryNode = roadGraph.getNodeById(secondary);
  const exitRoadX = primaryNode?.x ?? config.world.roadCoords[1] ?? -75;
  const [apronExitX] = roadGraph.stationExitPoint;
  const primaryApron = roadGraph.stationZones[0];
  const apronThresholdX = primaryApron
    ? primaryApron.cx + primaryApron.width * 0.5 + 1
    : config.world.apronBounds.maxX + 1;
  const bays = map?.stationBays?.length ? map.stationBays : config.vehicles.stationBays;
  const bay = bays[unit.bayIndex] ?? bays[0];
  const wps: THREE.Vector3[] = [];

  if (bay && unit.pos.x < apronThresholdX) {
    const headingSouth = spot.roadCenter.z >= bay.parkPos[2];
    const laneExitX = exitRoadX + (headingSouth ? -laneOffset : laneOffset);
    wps.push(new THREE.Vector3(apronExitX, surface.surfaceHeights.apron, bay.parkPos[2]));
    wps.push(new THREE.Vector3(laneExitX, roadGraph.roadSurfaceY, bay.parkPos[2]));
    let startNodeId = primary;
    if (primaryNode && secondaryNode) {
      if (headingSouth) {
        startNodeId = secondaryNode.z >= primaryNode.z ? secondaryNode.id : primaryNode.id;
      } else {
        startNodeId = primaryNode.z <= secondaryNode.z ? primaryNode.id : secondaryNode.id;
      }
    }
    const nodePath = roadGraph.findNodePath(startNodeId, spot.targetNodeId);
    const roadWps = roadGraph.buildLaneWaypoints(nodePath, spot.stagingPos, true);
    for (const wp of roadWps) {
      if (Math.abs(wp.x - exitRoadX) < 6) {
        if (headingSouth && wp.z < bay.parkPos[2] - 2) continue;
        if (!headingSouth && wp.z > bay.parkPos[2] + 2) continue;
      }
      wps.push(wp);
    }
  } else {
    const entry = roadGraph.findNearestRoadEntryPoint(unit.pos.x, unit.pos.z, staticBvh);
    if (unit.pos.distanceToSquared(entry.point) > 9) {
      wps.push(entry.point);
    }
    const nodePath = roadGraph.findNodePath(entry.nearestNode.id, spot.targetNodeId);
    wps.push(...roadGraph.buildLaneWaypoints(nodePath, spot.stagingPos, true));
    pruneLeadingWaypoints(unit.pos, unit.yaw, wps, staticBvh);
  }
  unit.waypoints = wps;
  unit.waypointIndex = 0;
}

function startNailMatRecovery(
  mat: NailMatActor,
  unit: PoliceUnit | undefined,
  officersById: Map<string, OfficerActor>,
): void {
  mat.phase = 'recovering';
  if (unit) {
    unit.pursuitRole = 'direct';
    if (!unit.mounted && unit.status === UnitStatus.DeployingSpikes) {
      unit.holdTimer = 0;
      unit.mountTimer = 0;
      for (const o of resolveUnitOfficers(unit, officersById)) {
        o.mountPhase = 'walk';
        o.boardTimer = 0;
      }
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
  officersById: Map<string, OfficerActor>,
  crimes: ActiveCrime[],
  assailantsById: Map<string, AssailantActor>,
  civilianCars: CivilianVehicle[],
  roadGraph: TownRoadGraph,
  staticBvh: StaticObstacleBVH,
  config: EngineConfigAsset,
  vfx: SimVfxManager,
  audio: JsonAudioSynth | null,
  hierarchy: SceneWorldHierarchy,
  simTime: number,
  rng: () => number,
  dt: number,
  map?: CustomMapAsset,
): void {
  const surface = map ?? config.world;

  for (let i = nailMats.length - 1; i >= 0; i--) {
    const mat = nailMats[i];
    const unit = units.find((u) => u.id === mat.unitId);
    const crime = crimes.find((c) => c.id === mat.crimeId);
    const primarySuspect = crime ? resolveCrimePrimaryAssailant(crime, assailantsById) : undefined;
    const suspectAlive = Boolean(primarySuspect?.alive);

    const beaconBlink = Math.sin(simTime * 11 + i * 1.3) > 0;
    const beaconMat = mat.warningBeacon.material as THREE.MeshBasicMaterial;
    beaconMat.color.setHex(beaconBlink ? 0xfbbf24 : 0x78350f);

    if (
      !unit ||
      unit.immobilized ||
      unit.status === UnitStatus.Retreating ||
      unit.status === UnitStatus.AtStation
    ) {
      hierarchy.removeEntity(mat.group);
      disposeNailMatObject(mat.group);
      nailMats.splice(i, 1);
      continue;
    }

    if (mat.phase === 'en_route') {
      if (!crime || !suspectAlive || !crime.inVehiclePursuit) {
        hierarchy.removeEntity(mat.group);
        disposeNailMatObject(mat.group);
        nailMats.splice(i, 1);
        unit.pursuitRole = 'direct';
        if (unit.status === UnitStatus.DeployingSpikes) {
          unit.status = crime && suspectAlive ? UnitStatus.Responding : UnitStatus.Returning;
          unit.repathTimer = 0;
        }
        continue;
      }

      const distToStage = Math.hypot(
        mat.stagingPos.x - unit.pos.x,
        mat.stagingPos.z - unit.pos.z,
      );
      if (distToStage < 4.8 || unit.waypointIndex >= unit.waypoints.length) {
        unit.speed = 0;
        unit.dyn.vx = 0;
        unit.dyn.vz = 0;
        unit.dyn.omega = 0;
        unit.sirensActive = false;
        unit.lightsActive = true;
        unit.mounted = false;

        const off =
          officersById.get(mat.officerId) ?? resolveUnitOfficers(unit, officersById)[0];
        if (!off) {
          startNailMatRecovery(mat, unit, officersById);
          continue;
        }
        if (off.occupiedSeatIndex !== null && unit.seats[off.occupiedSeatIndex]) {
          unit.seats[off.occupiedSeatIndex].occupantOfficerId = null;
          unit.seats[off.occupiedSeatIndex].doorOpenTimer = 1.2;
        }
        off.occupiedUnitId = null;
        off.occupiedSeatIndex = null;
        off.boardingState = 'dismounted';

        const curbX = mat.roadCenter.x + mat.perpX * (mat.curbSideSign * (mat.halfSpan + 0.55));
        const curbZ = mat.roadCenter.z + mat.perpZ * (mat.curbSideSign * (mat.halfSpan + 0.55));
        off.pos.set(curbX, 0, curbZ);
        staticBvh.resolveCircle(off.pos, 0.42);
        off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z, surface);
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
          const better = pickInterceptRoadSpot(
            crime,
            unit,
            units,
            assailantsById,
            roadGraph,
            nailMats,
            config,
            map,
          );
          if (better) {
            hierarchy.removeEntity(mat.group);
            disposeNailMatObject(mat.group);
            const visuals = buildNailMatVisuals(
              better.roadCenter,
              better.perpX,
              better.perpZ,
              better.curbSideSign,
              mat.halfSpan,
            );
            visuals.group.visible = false;
            hierarchy.addEntity(visuals.group);

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
            routeUnitToInterceptSpot(unit, better, roadGraph, config, staticBvh, map);
          } else {
            hierarchy.removeEntity(mat.group);
            disposeNailMatObject(mat.group);
            nailMats.splice(i, 1);
            unit.pursuitRole = 'direct';
            unit.status = UnitStatus.Pursuing;
            unit.repathTimer = 0;
          }
        }
      }
      continue;
    }

    const off =
      officersById.get(mat.officerId) ?? resolveUnitOfficers(unit, officersById)[0];
    if (!off) {
      startNailMatRecovery(mat, unit, officersById);
      continue;
    }

    if (mat.phase === 'deploying') {
      unit.speed = 0;
      unit.dyn.vx = 0;
      unit.dyn.vz = 0;

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
          startNailMatRecovery(mat, unit, officersById);
          continue;
        }
      }

      if (!crime || !suspectAlive || !crime.inVehiclePursuit || off.hp <= 0 || off.ragdoll.active) {
        startNailMatRecovery(mat, unit, officersById);
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

      if (mat.deployProgress >= 0.72) {
        const hit = checkSuspectOverNailMat(mat, crime, config, vfx, audio, rng);
        if (hit) {
          startNailMatRecovery(mat, unit, officersById);
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

      if (!crime || !suspectAlive || !crime.inVehiclePursuit || mat.armedTimer <= 0 || off.hp <= 0) {
        startNailMatRecovery(mat, unit, officersById);
        continue;
      }

      off.yaw = Math.atan2(
        crime.vehiclePos.x - off.pos.x,
        crime.vehiclePos.z - off.pos.z,
      );
      off.rig.torso.position.y = off.rig.torsoBaseY;
      off.rig.root.position.copy(off.pos);
      off.rig.root.rotation.y = off.yaw;

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
        if (checkSuspectOverNailMat(mat, crime, config, vfx, audio, rng)) {
          startNailMatRecovery(mat, unit, officersById);
          continue;
        }

        let civHit = false;
        for (const civ of civilianCars) {
          if (civ.immobilized || civ.speed < 3.5) continue;
          if (isVehicleTouchingStrip(civ.pos, mat)) {
            civ.immobilized = true;
            civ.immobilizeTilt = (rng() < 0.5 ? 1 : -1) * 0.14;
            civ.damageSmokeTimer = Math.max(civ.damageSmokeTimer, 12);
            vfx.spawnImpactSparks(civ.pos.x, 0.35, civ.pos.z, 9, 1.0, 0, 0);
            playBoundAudioEvent(audio, config, 'vehicle_crash', civ.pos);
            civHit = true;
            break;
          }
        }
        if (civHit) {
          startNailMatRecovery(mat, unit, officersById);
          continue;
        }
      }
      continue;
    }

    mat.stripPivot.scale.x = THREE.MathUtils.damp(mat.stripPivot.scale.x, 0.04, 16, dt);
    if (mat.stripPivot.scale.x < 0.1) {
      hierarchy.removeEntity(mat.group);
      disposeNailMatObject(mat.group);
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
  config: EngineConfigAsset,
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

  playBoundAudioEvent(audio, config, 'vehicle_crash', crime.vehiclePos);
  return true;
}

