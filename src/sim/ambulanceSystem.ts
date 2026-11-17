import * as THREE from 'three';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { StaticObstacleBVH } from './bvh';
import {
  computeAvoidanceSteerAndSpeed,
  computePurePursuitLookahead,
} from './drivingAvoidance';
import {
  applyVehicleWheelVisuals,
  buildAllVehicleProxies,
  pruneLeadingWaypoints,
} from './policeUnitSystem';
import {
  CLINIC_BAYS,
  getSurfaceHeight,
  LANE_OFFSET,
  TownRoadGraph,
} from './roadGraph';
import { createAmbulanceRig, updateAmbulanceLightbar } from './serviceVehicleModels';
import {
  ActiveCrime,
  AmbulanceActor,
  CasualtyTarget,
  CivilianVehicle,
  ParamedicActor,
  PedestrianActor,
  PoliceUnit,
  TowTruckActor,
} from './simActors';
import { ProceduralTexturePack } from './textures';
import { SirenPattern, WeatherCondition } from './types';
import { createHumanoid } from './vehicleModels';
import {
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';

function createStretcherMesh(): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.85,
    roughness: 0.25,
  });
  const padMat = new THREE.MeshStandardMaterial({
    color: 0xea580c,
    roughness: 0.65,
  });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.8,
  });

  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 1.82), padMat);
  pad.position.y = 0.42;
  pad.castShadow = true;
  group.add(pad);

  for (const sx of [-0.3, 0.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.04), frameMat);
    rail.position.set(sx, 0.4, 0);
    group.add(rail);
  }
  for (const [lx, lz] of [
    [-0.26, -0.72],
    [0.26, -0.72],
    [-0.26, 0.72],
    [0.26, 0.72],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.38, 0.035), frameMat);
    leg.position.set(lx, 0.2, lz);
    group.add(leg);
  }
  for (const sz of [-0.42, 0.42]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.025, 0.07), strapMat);
    strap.position.set(0, 0.475, sz);
    group.add(strap);
  }

  group.visible = false;
  return group;
}

function resetParamedicPose(med: ParamedicActor, yaw: number): void {
  med.rig.root.rotation.set(0, yaw, 0);
  med.rig.torso.position.y = med.rig.torsoBaseY;
  med.rig.head.rotation.set(0, 0, 0);
  med.rig.leftArm.rotation.set(0, 0, 0);
  med.rig.rightArm.rotation.set(0, 0, 0);
  med.rig.leftLeg.rotation.set(0, 0, 0);
  med.rig.rightLeg.rotation.set(0, 0, 0);
}

/**
 * Ambulances strongly prefer the two-tone Hi-Lo siren (~82% probability),
 * occasionally cycling brief Yelp or Wail bursts when clearing intersections.
 */
function pickAmbulanceSirenPattern(rng: () => number): {
  pattern: SirenPattern;
  duration: number;
} {
  const roll = rng();
  if (roll < 0.82) {
    return { pattern: SirenPattern.HiLo, duration: 4.8 + rng() * 3.6 };
  }
  if (roll < 0.93) {
    return { pattern: SirenPattern.Yelp, duration: 1.5 + rng() * 1.1 };
  }
  return { pattern: SirenPattern.Wail, duration: 1.9 + rng() * 1.3 };
}

export function spawnClinicAmbulances(
  scene: THREE.Scene,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
): AmbulanceActor[] {
  const ambulances: AmbulanceActor[] = [];

  CLINIC_BAYS.forEach((bay, idx) => {
    const rig = createAmbulanceRig(idx + 1, assets, textures, isSoftwareGl);
    rig.root.position.copy(bay.parkPos);
    rig.root.rotation.y = bay.parkYaw;
    scene.add(rig.root);

    const makeParamedic = (): ParamedicActor => {
      const mRig = createHumanoid('paramedic', assets, textures);
      mRig.root.visible = false;
      scene.add(mRig.root);
      return {
        rig: mRig,
        pos: bay.parkPos.clone(),
        yaw: bay.parkYaw,
        walkPhase: 0,
      };
    };

    const stretcherGroup = createStretcherMesh();
    scene.add(stretcherGroup);

    ambulances.push({
      id: bay.id,
      callsign: bay.callsign,
      bayIndex: idx,
      rig,
      pos: bay.parkPos.clone(),
      yaw: bay.parkYaw,
      speed: 0,
      dyn: createVehicleDynState(),
      status: 'At Clinic',
      lightsActive: false,
      sirensActive: false,
      activeSirenPattern: SirenPattern.HiLo,
      sirenModeTimer: 5.5,
      lightPhaseOffset: idx * 0.61,
      waypoints: [],
      waypointIndex: 0,
      avoidanceSteer: 0,
      stuckTimer: 0,
      target: null,
      targetPos: new THREE.Vector3(),
      scenePhase: 'walking_to_patient',
      treatTimer: 0,
      paramedics: [makeParamedic(), makeParamedic()],
      stretcherGroup,
    });
  });

  return ambulances;
}

function buildAmbulanceRouteToSpot(
  amb: AmbulanceActor,
  goalPos: THREE.Vector3,
  roadGraph: TownRoadGraph,
): THREE.Vector3[] {
  const wps: THREE.Vector3[] = [];
  let startNodeId: number;

  // Exiting Clinic Apron at block (3, 3) onto Avenue x = 75
  if (amb.pos.x > 80 && amb.pos.z > 88 && amb.pos.z < 136) {
    const laneExitX = 75 + (goalPos.z < amb.pos.z ? -LANE_OFFSET : LANE_OFFSET);
    wps.push(new THREE.Vector3(laneExitX, 0.035, amb.pos.z));
    const goalNearest = roadGraph.findNearestNode(goalPos.x, goalPos.z).id;
    const path18 = roadGraph.findNodePath(18, goalNearest);
    const path19 = roadGraph.findNodePath(19, goalNearest);
    startNodeId = path18.length <= path19.length ? 18 : 19;
  } else {
    const entry = roadGraph.findNearestRoadEntryPoint(amb.pos.x, amb.pos.z);
    if (amb.pos.distanceToSquared(entry.point) > 9) {
      wps.push(entry.point);
    }
    startNodeId = entry.nearestNode.id;
  }

  const roadGoal = roadGraph.findNearestRoadEntryPoint(goalPos.x, goalPos.z);
  const nodePath = roadGraph.findNodePath(startNodeId, roadGoal.nearestNode.id);
  wps.push(...roadGraph.buildLaneWaypoints(nodePath, roadGoal.point, true));
  if (!(amb.pos.x > 80 && amb.pos.z > 88 && amb.pos.z < 136)) {
    pruneLeadingWaypoints(amb.pos, amb.yaw, wps);
  }
  return wps;
}

function buildAmbulanceRouteToClinic(
  amb: AmbulanceActor,
  roadGraph: TownRoadGraph,
): THREE.Vector3[] {
  const bay = CLINIC_BAYS[amb.bayIndex];
  const wps: THREE.Vector3[] = [];
  const entry = roadGraph.findNearestRoadEntryPoint(amb.pos.x, amb.pos.z);
  if (amb.pos.distanceToSquared(entry.point) > 9) {
    wps.push(entry.point);
  }
  const path18 = roadGraph.findNodePath(entry.nearestNode.id, 18);
  const path19 = roadGraph.findNodePath(entry.nearestNode.id, 19);
  const chosen = path18.length <= path19.length ? path18 : path19;
  wps.push(...roadGraph.buildLaneWaypoints(chosen, undefined, false));
  pruneLeadingWaypoints(amb.pos, amb.yaw, wps);
  wps.push(new THREE.Vector3(75 + LANE_OFFSET, 0.035, bay.parkPos.z));
  wps.push(new THREE.Vector3(85, 0.18, bay.parkPos.z));
  wps.push(bay.parkPos.clone());
  return wps;
}

function resolveCasualtyPosition(
  target: CasualtyTarget,
  units: PoliceUnit[],
  crimes: ActiveCrime[],
  pedestrians: PedestrianActor[],
  outPos: THREE.Vector3,
): boolean {
  if (target.kind === 'officer') {
    const u = units.find((unit) => unit.id === target.unitId);
    const off = u?.officers[target.officerIndex];
    if (!u || !off || off.hp > 0 || !off.rig.root.visible) return false;
    outPos.copy(off.pos);
    return true;
  }
  if (target.kind === 'suspect') {
    const cr = crimes.find((c) => c.id === target.crimeId);
    if (!cr || cr.suspectAlive || !cr.suspectRig.root.visible) return false;
    // Keep body on scene until paramedics finish loading
    cr.cleanupTimer = Math.max(cr.cleanupTimer, 18.0);
    outPos.copy(cr.suspectPos);
    return true;
  }
  const ped = pedestrians[target.pedIndex];
  if (!ped || !ped.ragdoll.active) return false;
  ped.ragdoll.recoverTimer = Math.max(ped.ragdoll.recoverTimer, 6.0);
  outPos.copy(ped.pos);
  return true;
}

function findUnclaimedCasualty(
  ambPos: THREE.Vector3,
  claimedKeys: Set<string>,
  units: PoliceUnit[],
  crimes: ActiveCrime[],
  pedestrians: PedestrianActor[],
): { target: CasualtyTarget; pos: THREE.Vector3 } | null {
  let best: { target: CasualtyTarget; pos: THREE.Vector3; score: number } | null = null;

  // Priority 1: Downed officers on scene
  for (const u of units) {
    for (let oi = 0; oi < 2; oi++) {
      const off = u.officers[oi as 0 | 1];
      if (off.hp <= 0 && off.rig.root.visible) {
        const key = `officer:${u.id}:${oi}`;
        if (claimedKeys.has(key)) continue;
        const d = ambPos.distanceTo(off.pos);
        const score = 1000 - d;
        if (!best || score > best.score) {
          best = {
            target: { kind: 'officer', unitId: u.id, officerIndex: oi as 0 | 1, key },
            pos: off.pos.clone(),
            score,
          };
        }
      }
    }
  }

  // Priority 2: Neutralized crime suspects
  for (const c of crimes) {
    if (!c.suspectAlive && c.suspectRig.root.visible && c.cleanupTimer > 0.3) {
      const key = `suspect:${c.id}`;
      if (claimedKeys.has(key)) continue;
      const d = ambPos.distanceTo(c.suspectPos);
      const score = 600 - d;
      if (!best || score > best.score) {
        best = {
          target: { kind: 'suspect', crimeId: c.id, key },
          pos: c.suspectPos.clone(),
          score,
        };
      }
    }
  }

  // Priority 3: Struck / shot ragdolled pedestrians
  for (let pi = 0; pi < pedestrians.length; pi++) {
    const ped = pedestrians[pi];
    if (ped.ragdoll.active && ped.ragdoll.recoverTimer > 0.9) {
      const key = `ped:${pi}`;
      if (claimedKeys.has(key)) continue;
      const d = ambPos.distanceTo(ped.pos);
      const score = 400 - d;
      if (!best || score > best.score) {
        best = {
          target: { kind: 'pedestrian', pedIndex: pi, key },
          pos: ped.pos.clone(),
          score,
        };
      }
    }
  }

  return best ? { target: best.target, pos: best.pos } : null;
}

function completeCasualtyLoad(
  target: CasualtyTarget,
  units: PoliceUnit[],
  crimes: ActiveCrime[],
  pedestrians: PedestrianActor[],
): void {
  if (target.kind === 'officer') {
    const u = units.find((unit) => unit.id === target.unitId);
    const off = u?.officers[target.officerIndex];
    if (off) {
      off.hp = Math.max(65, Math.round(off.maxHp * 0.75));
      off.armor = Math.max(off.armor, Math.round(off.maxArmor * 0.5));
      off.morale = Math.max(off.morale, 75);
      off.cowardiceState = 'steady';
      off.ragdoll.active = false;
      off.pos.y = getSurfaceHeight(off.pos.x, off.pos.z);
      off.rig.root.rotation.set(0, off.yaw, 0);
    }
  } else if (target.kind === 'suspect') {
    const cr = crimes.find((c) => c.id === target.crimeId);
    if (cr) {
      cr.suspectRig.root.visible = false;
      cr.cleanupTimer = Math.min(cr.cleanupTimer, 0.35);
    }
  } else {
    const ped = pedestrians[target.pedIndex];
    if (ped) {
      ped.ragdoll.active = false;
      ped.ragdoll.recoverTimer = 0;
      ped.pos.y = getSurfaceHeight(ped.pos.x, ped.pos.z);
      ped.rig.root.rotation.set(0, ped.yaw, 0);
      ped.rig.leftArm.rotation.set(0, 0, 0);
      ped.rig.rightArm.rotation.set(0, 0, 0);
      ped.rig.leftLeg.rotation.set(0, 0, 0);
      ped.rig.rightLeg.rotation.set(0, 0, 0);
    }
  }
}

export interface AmbulanceUpdateContext {
  ambulances: AmbulanceActor[];
  units: PoliceUnit[];
  crimes: ActiveCrime[];
  civilianCars: CivilianVehicle[];
  pedestrians: PedestrianActor[];
  towTruck: TowTruckActor | null;
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  audio: JsonAudioSynth | null;
  onPatientTreated?: () => void;
  weather: WeatherCondition;
  simTime: number;
  rng: () => number;
}

export function updateAmbulances(ctx: AmbulanceUpdateContext, dt: number): void {
  const {
    ambulances,
    units,
    crimes,
    civilianCars,
    pedestrians,
    towTruck,
    roadGraph,
    staticBvh,
    audio,
    onPatientTreated,
    weather,
    simTime,
    rng,
  } = ctx;

  const haloBoost =
    weather === WeatherCondition.Rain || weather === WeatherCondition.HeavyFog ? 1.35 : 1.0;
  const gripScale = weather === WeatherCondition.Rain ? 0.7 : 1.0;

  const claimedKeys = new Set<string>();
  for (const amb of ambulances) {
    if (amb.target) {
      claimedKeys.add(amb.target.key);
    }
  }

  for (const amb of ambulances) {
    updateAmbulanceLightbar(
      amb.rig,
      amb.lightsActive,
      simTime,
      haloBoost,
      amb.lightPhaseOffset,
    );

    // Cycle siren pattern with strong Hi-Lo preference (~82% Hi-Lo)
    if (amb.sirensActive) {
      amb.sirenModeTimer -= dt;
      if (amb.sirenModeTimer <= 0) {
        const next = pickAmbulanceSirenPattern(rng);
        amb.activeSirenPattern = next.pattern;
        amb.sirenModeTimer = next.duration;
      }
    }

    // Dispatch idle or empty-returning ambulance when a casualty occurs
    if (amb.status === 'At Clinic' || amb.status === 'Returning') {
      const found = findUnclaimedCasualty(
        amb.pos,
        claimedKeys,
        units,
        crimes,
        pedestrians,
      );
      if (found) {
        claimedKeys.add(found.target.key);
        amb.target = found.target;
        amb.targetPos.copy(found.pos);
        amb.status = 'Responding';
        amb.lightsActive = true;
        amb.sirensActive = true;
        amb.activeSirenPattern = SirenPattern.HiLo;
        amb.sirenModeTimer = 6.0 + rng() * 2.5;
        amb.stuckTimer = 0;
        amb.avoidanceSteer = 0;
        amb.waypoints = buildAmbulanceRouteToSpot(amb, found.pos, roadGraph);
        amb.waypointIndex = 0;
        if (found.target.kind === 'suspect') {
          const suspectCrimeId = found.target.crimeId;
          const cr = crimes.find((c) => c.id === suspectCrimeId);
          if (cr) cr.cleanupTimer = Math.max(cr.cleanupTimer, 28.0);
        }
        audio?.playAssetAt('dispatch_chirp', amb.pos);
      }
    }

    if (amb.status === 'At Clinic') {
      amb.rig.root.position.copy(amb.pos);
      amb.rig.root.rotation.y = amb.yaw;
      continue;
    }

    if (amb.status === 'Responding') {
      if (
        !amb.target ||
        !resolveCasualtyPosition(amb.target, units, crimes, pedestrians, amb.targetPos)
      ) {
        // Casualty already recovered or cleared; return calmly to clinic
        amb.target = null;
        amb.status = 'Returning';
        amb.lightsActive = false;
        amb.sirensActive = false;
        amb.waypoints = buildAmbulanceRouteToClinic(amb, roadGraph);
        amb.waypointIndex = 0;
      } else {
        const distToPatient = Math.hypot(
          amb.targetPos.x - amb.pos.x,
          amb.targetPos.z - amb.pos.z,
        );
        if (distToPatient < 14.5 || amb.waypointIndex >= amb.waypoints.length) {
          if (distToPatient < 24.0) {
            // Arrive at casualty scene: cut siren, keep warning lights on, dismount paramedics
            amb.status = 'At Scene';
            amb.sirensActive = false;
            amb.lightsActive = true;
            amb.speed = 0;
            amb.dyn.vx = 0;
            amb.dyn.vz = 0;
            amb.dyn.omega = 0;
            amb.scenePhase = 'walking_to_patient';
            amb.treatTimer = 0;
            amb.rig.cabinCrewGroup.visible = false;

            const rearX = amb.pos.x - Math.sin(amb.yaw) * 3.1;
            const rearZ = amb.pos.z - Math.cos(amb.yaw) * 3.1;
            const rightX = Math.cos(amb.yaw);
            const rightZ = -Math.sin(amb.yaw);

            amb.paramedics.forEach((med, idx) => {
              const side = idx === 0 ? 0.65 : -0.65;
              med.pos.set(rearX + rightX * side, 0, rearZ + rightZ * side);
              staticBvh.resolveCircle(med.pos, 0.42);
              med.pos.y = getSurfaceHeight(med.pos.x, med.pos.z);
              med.yaw = Math.atan2(
                amb.targetPos.x - med.pos.x,
                amb.targetPos.z - med.pos.z,
              );
              resetParamedicPose(med, med.yaw);
              med.rig.root.position.copy(med.pos);
              med.rig.root.visible = true;
            });

            amb.stretcherGroup.position.set(
              rearX,
              getSurfaceHeight(rearX, rearZ),
              rearZ,
            );
            amb.stretcherGroup.rotation.y = amb.yaw;
            amb.stretcherGroup.visible = true;
            amb.rig.root.position.copy(amb.pos);
            amb.rig.root.rotation.y = amb.yaw;
            continue;
          } else {
            amb.waypoints = buildAmbulanceRouteToSpot(amb, amb.targetPos, roadGraph);
            amb.waypointIndex = 0;
          }
        }
      }
    }

    if (amb.status === 'At Scene') {
      amb.speed = 0;
      amb.dyn.vx = 0;
      amb.dyn.vz = 0;
      amb.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(amb.rig.bodyGroup.rotation.x, 0, 8, dt);
      amb.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(amb.rig.bodyGroup.rotation.z, 0, 8, dt);

      const targetStillValid =
        amb.target !== null &&
        resolveCasualtyPosition(amb.target, units, crimes, pedestrians, amb.targetPos);

      if (!targetStillValid && amb.scenePhase !== 'returning_to_rig') {
        amb.scenePhase = 'returning_to_rig';
      }

      if (amb.scenePhase === 'walking_to_patient') {
        let bothArrived = true;
        amb.paramedics.forEach((med, idx) => {
          const offsetAngle = idx === 0 ? 0.8 : -0.8;
          const goalX = amb.targetPos.x + Math.cos(offsetAngle) * 0.85;
          const goalZ = amb.targetPos.z + Math.sin(offsetAngle) * 0.85;
          const dx = goalX - med.pos.x;
          const dz = goalZ - med.pos.z;
          const dist = Math.hypot(dx, dz);

          if (dist > 0.55) {
            bothArrived = false;
            const spd = 4.8;
            med.pos.x += (dx / dist) * spd * dt;
            med.pos.z += (dz / dist) * spd * dt;
            staticBvh.resolveCircle(med.pos, 0.4);
            med.pos.y = getSurfaceHeight(med.pos.x, med.pos.z);
            med.yaw = Math.atan2(dx, dz);
            med.walkPhase += dt * 11;
            const swing = Math.sin(med.walkPhase) * 0.55;
            med.rig.leftLeg.rotation.x = swing;
            med.rig.rightLeg.rotation.x = -swing;
            med.rig.leftArm.rotation.x = -swing * 0.6;
            med.rig.rightArm.rotation.x = swing * 0.4;
          } else {
            med.yaw = Math.atan2(
              amb.targetPos.x - med.pos.x,
              amb.targetPos.z - med.pos.z,
            );
            med.rig.leftLeg.rotation.x = 0;
            med.rig.rightLeg.rotation.x = 0;
          }
          med.rig.root.position.copy(med.pos);
          med.rig.root.rotation.y = med.yaw;
        });

        // Stretcher moves with paramedics
        const midX = (amb.paramedics[0].pos.x + amb.paramedics[1].pos.x) * 0.5;
        const midZ = (amb.paramedics[0].pos.z + amb.paramedics[1].pos.z) * 0.5;
        amb.stretcherGroup.position.set(midX, getSurfaceHeight(midX, midZ), midZ);
        amb.stretcherGroup.rotation.y = amb.paramedics[0].yaw;

        if (bothArrived) {
          amb.scenePhase = 'treating';
          amb.treatTimer = 0;
        }
      } else if (amb.scenePhase === 'treating') {
        amb.treatTimer += dt;
        const compress = Math.sin(amb.treatTimer * 12) * 0.18;
        amb.paramedics.forEach((med) => {
          med.yaw = Math.atan2(
            amb.targetPos.x - med.pos.x,
            amb.targetPos.z - med.pos.z,
          );
          med.rig.torso.position.y = med.rig.torsoBaseY - 0.34;
          med.rig.leftLeg.rotation.x = -0.65;
          med.rig.rightLeg.rotation.x = 0.45;
          med.rig.leftArm.rotation.x = -0.85 + compress;
          med.rig.rightArm.rotation.x = -0.85 - compress;
          med.rig.root.position.copy(med.pos);
          med.rig.root.rotation.y = med.yaw;
        });

        if (amb.treatTimer >= 2.6) {
          if (amb.target) {
            completeCasualtyLoad(amb.target, units, crimes, pedestrians);
            onPatientTreated?.();
          }
          amb.scenePhase = 'returning_to_rig';
          amb.paramedics.forEach((med) => resetParamedicPose(med, med.yaw));
        }
      } else {
        // 'returning_to_rig'
        const rearX = amb.pos.x - Math.sin(amb.yaw) * 3.0;
        const rearZ = amb.pos.z - Math.cos(amb.yaw) * 3.0;
        let bothBack = true;

        amb.paramedics.forEach((med) => {
          const dx = rearX - med.pos.x;
          const dz = rearZ - med.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.9) {
            bothBack = false;
            const spd = 4.6;
            med.pos.x += (dx / dist) * spd * dt;
            med.pos.z += (dz / dist) * spd * dt;
            staticBvh.resolveCircle(med.pos, 0.4);
            med.pos.y = getSurfaceHeight(med.pos.x, med.pos.z);
            med.yaw = Math.atan2(dx, dz);
            med.walkPhase += dt * 10.5;
            const swing = Math.sin(med.walkPhase) * 0.5;
            med.rig.leftLeg.rotation.x = swing;
            med.rig.rightLeg.rotation.x = -swing;
            med.rig.leftArm.rotation.x = -0.35;
            med.rig.rightArm.rotation.x = -0.35;
            med.rig.root.position.copy(med.pos);
            med.rig.root.rotation.y = med.yaw;
          }
        });

        const midX = (amb.paramedics[0].pos.x + amb.paramedics[1].pos.x) * 0.5;
        const midZ = (amb.paramedics[0].pos.z + amb.paramedics[1].pos.z) * 0.5;
        amb.stretcherGroup.position.set(midX, getSurfaceHeight(midX, midZ), midZ);
        amb.stretcherGroup.rotation.y = amb.paramedics[0].yaw;

        if (bothBack) {
          amb.paramedics.forEach((med) => {
            med.rig.root.visible = false;
            resetParamedicPose(med, amb.yaw);
          });
          amb.stretcherGroup.visible = false;
          amb.rig.cabinCrewGroup.visible = true;
          const hadPatient = amb.target !== null;
          amb.target = null;
          amb.status = hadPatient ? 'Transporting' : 'Returning';
          amb.lightsActive = hadPatient;
          amb.sirensActive = hadPatient;
          amb.activeSirenPattern = SirenPattern.HiLo;
          amb.sirenModeTimer = 6.5;
          amb.stuckTimer = 0;
          amb.waypoints = buildAmbulanceRouteToClinic(amb, roadGraph);
          amb.waypointIndex = 0;
        }
      }

      amb.rig.root.position.copy(amb.pos);
      amb.rig.root.rotation.y = amb.yaw;
      continue;
    }

    // Driving logic for 'Responding', 'Transporting', and 'Returning'
    const emergency = amb.status === 'Responding' || amb.status === 'Transporting';
    const maxCruise = emergency ? 15.8 : 11.8;

    if (amb.waypointIndex >= amb.waypoints.length) {
      const bay = CLINIC_BAYS[amb.bayIndex];
      amb.pos.copy(bay.parkPos);
      amb.yaw = bay.parkYaw;
      amb.speed = 0;
      amb.dyn.vx = 0;
      amb.dyn.vz = 0;
      amb.dyn.omega = 0;
      amb.dyn.bodyPitch = 0;
      amb.dyn.bodyRoll = 0;
      amb.rig.bodyGroup.rotation.set(0, 0, 0);
      amb.lightsActive = false;
      amb.sirensActive = false;
      amb.status = 'At Clinic';
      amb.target = null;
      amb.waypoints = [];
      amb.waypointIndex = 0;
    } else {
      const wp = amb.waypoints[amb.waypointIndex];
      const dx = wp.x - amb.pos.x;
      const dz = wp.z - amb.pos.z;
      const dist = Math.hypot(dx, dz);
      const isFinalWp = amb.waypointIndex === amb.waypoints.length - 1;
      const fwdX = Math.sin(amb.yaw);
      const fwdZ = Math.cos(amb.yaw);
      const forwardDot = dx * fwdX + dz * fwdZ;

      if (
        dist < (isFinalWp ? 3.5 : 5.5) ||
        (!isFinalWp && dist < 16 && forwardDot < 1.2)
      ) {
        amb.waypointIndex++;
      } else {
        const lookDist = isFinalWp ? dist : 8.5 + Math.min(4.2, amb.speed * 0.25);
        const aim = computePurePursuitLookahead(
          amb.pos,
          amb.waypoints,
          amb.waypointIndex,
          lookDist,
        );
        const baseDesiredYaw = Math.atan2(
          aim.targetX - amb.pos.x,
          aim.targetZ - amb.pos.z,
        );
        const absYawDiff = Math.abs(normalizeAngle(baseDesiredYaw - amb.yaw));
        const turnFactor =
          absYawDiff > 1.1 ? 0.3 : absYawDiff > 0.6 ? 0.5 : absYawDiff > 0.28 ? 0.74 : 1.0;

        const allVehicles = buildAllVehicleProxies(
          units,
          civilianCars,
          crimes,
          towTruck,
          ambulances,
        );

        const avoid = computeAvoidanceSteerAndSpeed({
          selfId: amb.id,
          pos: amb.pos,
          yaw: amb.yaw,
          speed: amb.speed,
          selfHalfW: 1.12,
          selfHalfL: 2.66,
          baseDesiredYaw,
          baseSpeed: maxCruise * turnFactor,
          prevSteerBias: amb.avoidanceSteer,
          canOvertake: emergency && !isFinalWp,
          allVehicles,
          pedestrians,
          staticBvh,
          dt,
        });
        amb.avoidanceSteer = avoid.nextSteerBias;

        const yawState = { yaw: amb.yaw, speed: amb.speed };
        stepVehicleDynamics(
          amb.pos,
          yawState,
          amb.dyn,
          amb.rig.bodyGroup,
          {
            targetSpeed: avoid.speedCap,
            desiredYaw: avoid.desiredYaw,
            maxAccel: emergency ? 7.4 : 5.4,
            maxBrake: 11.6,
            maxSteerRate: 1.95,
            lateralGrip: 6.4 * gripScale,
            mass: 2.05,
          },
          dt,
        );
        amb.yaw = yawState.yaw;
        amb.speed = yawState.speed;
        amb.pos.y = THREE.MathUtils.damp(
          amb.pos.y,
          getSurfaceHeight(amb.pos.x, amb.pos.z),
          12,
          dt,
        );

        // Self-unwedge if blocked by wrecked traffic
        if (amb.speed < 0.7 && avoid.speedCap > 1.5) {
          amb.stuckTimer += dt;
          if (amb.stuckTimer > 2.2) {
            amb.pos.x -= Math.sin(amb.yaw) * 3.2 * dt;
            amb.pos.z -= Math.cos(amb.yaw) * 3.2 * dt;
            staticBvh.resolveCircle(amb.pos, 1.55);
            amb.yaw = normalizeAngle(
              amb.yaw + (amb.bayIndex === 0 ? 1 : -1) * 0.9 * dt,
            );
            if (amb.stuckTimer > 4.2) {
              amb.stuckTimer = 0;
            }
          }
        } else if (amb.speed > 1.5) {
          amb.stuckTimer = 0;
        }

        applyVehicleWheelVisuals(
          amb.rig.wheels,
          amb.rig.frontWheels,
          amb.speed,
          amb.dyn.steerAngle,
          0.4,
          dt,
        );
      }
    }

    amb.rig.root.position.copy(amb.pos);
    amb.rig.root.rotation.y = amb.yaw;
  }
}
