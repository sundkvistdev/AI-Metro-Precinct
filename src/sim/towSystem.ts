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
  resetOfficerPose,
  resetPoliceUnitAtStation,
} from './policeUnitSystem';
import {
  getSurfaceHeight,
  LANE_OFFSET,
  STATION_BAYS,
  TOW_BAY,
  TownRoadGraph,
} from './roadGraph';
import { createTowTruckRig, updateTowLightbar } from './serviceVehicleModels';
import {
  ActiveCrime,
  AmbulanceActor,
  CivilianVehicle,
  PedestrianActor,
  PoliceUnit,
  TowTruckActor,
} from './simActors';
import { ProceduralTexturePack } from './textures';
import { UnitStatus, WeatherCondition } from './types';
import {
  createVehicleDynState,
  normalizeAngle,
  stepVehicleDynamics,
} from './vehiclePhysics';

export function spawnTowTruck(
  scene: THREE.Scene,
  assets: LoadedJsonAssets,
  textures: ProceduralTexturePack,
  isSoftwareGl: boolean,
): TowTruckActor {
  const rig = createTowTruckRig(assets, textures, isSoftwareGl);
  rig.root.position.copy(TOW_BAY.parkPos);
  rig.root.rotation.y = TOW_BAY.parkYaw;
  scene.add(rig.root);

  return {
    id: TOW_BAY.id,
    callsign: TOW_BAY.callsign,
    rig,
    pos: TOW_BAY.parkPos.clone(),
    yaw: TOW_BAY.parkYaw,
    speed: 0,
    dyn: createVehicleDynState(),
    status: 'Standby',
    beaconsActive: false,
    targetUnitId: null,
    hookTimer: 0,
    waypoints: [],
    waypointIndex: 0,
    avoidanceSteer: 0,
    stuckTimer: 0,
  };
}

function buildRouteFromCurrentPos(
  startPos: THREE.Vector3,
  startYaw: number,
  goalPos: THREE.Vector3,
  roadGraph: TownRoadGraph,
): THREE.Vector3[] {
  const wps: THREE.Vector3[] = [];
  let startNodeId: number;

  if (startPos.x < -80 && startPos.z > -70 && startPos.z < -5) {
    const laneExitX = -75 + (goalPos.z > startPos.z ? -LANE_OFFSET : LANE_OFFSET);
    wps.push(new THREE.Vector3(laneExitX, 0.035, startPos.z));
    const goalNearest = roadGraph.findNearestNode(goalPos.x, goalPos.z).id;
    const pathN = roadGraph.findNodePath(6, goalNearest);
    const pathS = roadGraph.findNodePath(7, goalNearest);
    startNodeId = pathN.length <= pathS.length ? 6 : 7;
  } else {
    const entry = roadGraph.findNearestRoadEntryPoint(startPos.x, startPos.z);
    if (startPos.distanceToSquared(entry.point) > 9) {
      wps.push(entry.point);
    }
    startNodeId = entry.nearestNode.id;
  }

  const goalEntry = roadGraph.findNearestRoadEntryPoint(goalPos.x, goalPos.z);
  const nodePath = roadGraph.findNodePath(startNodeId, goalEntry.nearestNode.id);
  wps.push(...roadGraph.buildLaneWaypoints(nodePath, goalPos, false));
  if (!(startPos.x < -80 && startPos.z > -70 && startPos.z < -5)) {
    pruneLeadingWaypoints(startPos, startYaw, wps);
  }
  return wps;
}

function buildRouteToStationBay(
  startPos: THREE.Vector3,
  startYaw: number,
  bayPos: THREE.Vector3,
  roadGraph: TownRoadGraph,
): THREE.Vector3[] {
  const wps: THREE.Vector3[] = [];
  const entry = roadGraph.findNearestRoadEntryPoint(startPos.x, startPos.z);
  if (startPos.distanceToSquared(entry.point) > 9) {
    wps.push(entry.point);
  }
  const pathN = roadGraph.findNodePath(entry.nearestNode.id, 6);
  const pathS = roadGraph.findNodePath(entry.nearestNode.id, 7);
  const chosen = pathN.length <= pathS.length ? pathN : pathS;
  wps.push(...roadGraph.buildLaneWaypoints(chosen, undefined, false));
  pruneLeadingWaypoints(startPos, startYaw, wps);
  wps.push(new THREE.Vector3(-75 - LANE_OFFSET, 0.035, bayPos.z));
  wps.push(new THREE.Vector3(-85, 0.18, bayPos.z));
  wps.push(bayPos.clone());
  return wps;
}

export function requestTowForUnit(
  unit: PoliceUnit,
  towTruck: TowTruckActor | null,
  crimes: ActiveCrime[],
  roadGraph: TownRoadGraph,
  audio: JsonAudioSynth | null,
): boolean {
  if (
    unit.status === UnitStatus.AtStation ||
    unit.beingTowed ||
    unit.status === UnitStatus.BeingTowed
  ) {
    return false;
  }

  if (unit.targetCrimeId) {
    const cr = crimes.find((c) => c.id === unit.targetCrimeId);
    if (cr && cr.assignedUnitId === unit.id) {
      cr.assignedUnitId = null;
    }
    unit.targetCrimeId = null;
  }

  unit.towRequested = true;
  unit.freeRoam = false;
  unit.sirensActive = false;
  unit.lightsActive = true;

  if (!unit.mounted) {
    unit.holdTimer = 0;
    unit.mountTimer = 0;
    unit.officers.forEach((o) => {
      o.mountPhase = 'walk';
      o.boardTimer = 0;
    });
    unit.status = UnitStatus.Mounting;
  } else {
    unit.status = UnitStatus.AwaitingTow;
    unit.waypoints = [];
    unit.waypointIndex = 0;
  }

  if (towTruck && (towTruck.status === 'Standby' || towTruck.status === 'Returning')) {
    dispatchTowTruckToUnit(towTruck, unit, roadGraph, audio);
  } else {
    audio?.playAssetAt('dispatch_chirp', unit.pos);
  }
  return true;
}

function dispatchTowTruckToUnit(
  towTruck: TowTruckActor,
  unit: PoliceUnit,
  roadGraph: TownRoadGraph,
  audio: JsonAudioSynth | null,
): void {
  towTruck.targetUnitId = unit.id;
  towTruck.status = 'En Route';
  towTruck.beaconsActive = true;
  towTruck.hookTimer = 0;
  towTruck.stuckTimer = 0;
  towTruck.avoidanceSteer = 0;

  // Aim just ahead of the disabled cruiser so the rear boom pulls up cleanly
  const pickupSpot = new THREE.Vector3(
    unit.pos.x + Math.sin(unit.yaw) * 5.4,
    getSurfaceHeight(unit.pos.x, unit.pos.z),
    unit.pos.z + Math.cos(unit.yaw) * 5.4,
  );
  towTruck.waypoints = buildRouteFromCurrentPos(
    towTruck.pos,
    towTruck.yaw,
    pickupSpot,
    roadGraph,
  );
  towTruck.waypointIndex = 0;
  audio?.playAssetAt('dispatch_chirp', towTruck.pos);
}

export interface TowUpdateContext {
  towTruck: TowTruckActor;
  units: PoliceUnit[];
  crimes: ActiveCrime[];
  civilianCars: CivilianVehicle[];
  pedestrians: PedestrianActor[];
  ambulances: AmbulanceActor[];
  roadGraph: TownRoadGraph;
  staticBvh: StaticObstacleBVH;
  audio: JsonAudioSynth | null;
  onClearDebris?: (obj: THREE.Object3D) => void;
  onVehicleTowed?: () => void;
  weather: WeatherCondition;
  simTime: number;
}

export function updateTowTruck(ctx: TowUpdateContext, dt: number): void {
  const {
    towTruck,
    units,
    crimes,
    civilianCars,
    pedestrians,
    ambulances,
    roadGraph,
    staticBvh,
    audio,
    onClearDebris,
    onVehicleTowed,
    weather,
    simTime,
  } = ctx;

  const haloBoost =
    weather === WeatherCondition.Rain || weather === WeatherCondition.HeavyFog ? 1.35 : 1.0;
  updateTowLightbar(towTruck.rig, towTruck.beaconsActive, simTime, haloBoost);

  // Auto-dispatch when idle or returning if any unit needs recovery
  if (towTruck.status === 'Standby' || (towTruck.status === 'Returning' && !towTruck.targetUnitId)) {
    let bestUnit: PoliceUnit | null = null;
    let bestDist = Infinity;
    for (const u of units) {
      if (
        (u.towRequested || u.status === UnitStatus.AwaitingTow) &&
        !u.beingTowed &&
        u.status !== UnitStatus.AtStation
      ) {
        const d = towTruck.pos.distanceToSquared(u.pos);
        if (d < bestDist) {
          bestDist = d;
          bestUnit = u;
        }
      }
    }
    if (bestUnit) {
      dispatchTowTruckToUnit(towTruck, bestUnit, roadGraph, audio);
    }
  }

  if (towTruck.status === 'Standby') {
    towTruck.rig.towBoom.rotation.x = THREE.MathUtils.damp(
      towTruck.rig.towBoom.rotation.x,
      0,
      8,
      dt,
    );
    towTruck.rig.root.position.copy(towTruck.pos);
    towTruck.rig.root.rotation.y = towTruck.yaw;
    return;
  }

  const targetUnit = towTruck.targetUnitId
    ? units.find((u) => u.id === towTruck.targetUnitId)
    : undefined;

  // If target unit was somehow already reset or vanished while En Route, return to depot
  if (
    (towTruck.status === 'En Route' || towTruck.status === 'Hooking') &&
    (!targetUnit || targetUnit.status === UnitStatus.AtStation)
  ) {
    towTruck.targetUnitId = null;
    towTruck.status = 'Returning';
    towTruck.waypoints = buildRouteToStationBay(
      towTruck.pos,
      towTruck.yaw,
      TOW_BAY.parkPos,
      roadGraph,
    );
    towTruck.waypointIndex = 0;
  }

  if (towTruck.status === 'Hooking' && targetUnit) {
    towTruck.speed = 0;
    towTruck.dyn.vx = 0;
    towTruck.dyn.vz = 0;
    towTruck.dyn.omega = 0;
    towTruck.hookTimer += dt;

    // Lower then lift the hydraulic boom/wheel-lift cradle
    const p = THREE.MathUtils.clamp(towTruck.hookTimer / 1.5, 0, 1);
    const boomAngle = p < 0.5 ? THREE.MathUtils.lerp(0, 0.22, p * 2) : THREE.MathUtils.lerp(0.22, -0.06, (p - 0.5) * 2);
    towTruck.rig.towBoom.rotation.x = boomAngle;

    // Ensure all crew of the disabled cruiser are safely aboard
    targetUnit.mounted = true;
    targetUnit.freeRoam = false;
    targetUnit.rig.cabinCrewGroup.visible = true;
    targetUnit.officers.forEach((off) => {
      off.rig.root.visible = false;
      off.ragdoll.active = false;
      resetOfficerPose(off, targetUnit.yaw);
    });

    // Smoothly align cruiser nose behind the tow truck's rear wheel-lift hitch
    const hitchX = towTruck.pos.x - Math.sin(towTruck.yaw) * 2.85;
    const hitchZ = towTruck.pos.z - Math.cos(towTruck.yaw) * 2.85;
    const goalCruiserX = hitchX - Math.sin(towTruck.yaw) * 2.95;
    const goalCruiserZ = hitchZ - Math.cos(towTruck.yaw) * 2.95;
    targetUnit.pos.x = THREE.MathUtils.lerp(targetUnit.pos.x, goalCruiserX, Math.min(1, dt * 6));
    targetUnit.pos.z = THREE.MathUtils.lerp(targetUnit.pos.z, goalCruiserZ, Math.min(1, dt * 6));
    targetUnit.pos.y = getSurfaceHeight(targetUnit.pos.x, targetUnit.pos.z) + p * 0.08;
    const yawDiff = normalizeAngle(towTruck.yaw - targetUnit.yaw);
    targetUnit.yaw = normalizeAngle(targetUnit.yaw + yawDiff * Math.min(1, dt * 6));
    targetUnit.rig.bodyGroup.rotation.x = THREE.MathUtils.lerp(0, -0.095, p);
    targetUnit.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
      targetUnit.rig.bodyGroup.rotation.z,
      0,
      8,
      dt,
    );
    targetUnit.rig.root.position.copy(targetUnit.pos);
    targetUnit.rig.root.rotation.y = targetUnit.yaw;

    if (towTruck.hookTimer >= 1.5) {
      targetUnit.beingTowed = true;
      targetUnit.status = UnitStatus.BeingTowed;
      targetUnit.lightsActive = false;
      targetUnit.sirensActive = false;
      towTruck.status = 'Towing';
      towTruck.stuckTimer = 0;
      const bay = STATION_BAYS[targetUnit.bayIndex];
      towTruck.waypoints = buildRouteToStationBay(
        towTruck.pos,
        towTruck.yaw,
        bay.parkPos,
        roadGraph,
      );
      towTruck.waypointIndex = 0;
    }

    towTruck.rig.root.position.copy(towTruck.pos);
    towTruck.rig.root.rotation.y = towTruck.yaw;
    return;
  }

  // Driving logic for 'En Route', 'Towing', and 'Returning'
  const gripScale = weather === WeatherCondition.Rain ? 0.7 : 1.0;
  const maxCruise = towTruck.status === 'Towing' ? 11.4 : 13.8;

  // Check arrival at disabled cruiser when En Route
  if (towTruck.status === 'En Route' && targetUnit) {
    const distToTarget = Math.hypot(
      targetUnit.pos.x - towTruck.pos.x,
      targetUnit.pos.z - towTruck.pos.z,
    );
    if (distToTarget < 8.4 || towTruck.waypointIndex >= towTruck.waypoints.length) {
      if (distToTarget < 14.0) {
        towTruck.status = 'Hooking';
        towTruck.hookTimer = 0;
        towTruck.speed = 0;
        towTruck.dyn.vx = 0;
        towTruck.dyn.vz = 0;
        return;
      } else {
        // Re-route closer to cruiser if it drifted before stopping
        dispatchTowTruckToUnit(towTruck, targetUnit, roadGraph, null);
      }
    }
  }

  if (towTruck.waypointIndex >= towTruck.waypoints.length) {
    if (towTruck.status === 'Towing' && targetUnit) {
      // Unhook and fully restore the towed cruiser in its station bay!
      resetPoliceUnitAtStation(targetUnit, onClearDebris);
      onVehicleTowed?.();
      towTruck.targetUnitId = null;
      towTruck.rig.towBoom.rotation.x = 0;

      // Park tow truck at its adjacent precinct Tow Bay
      towTruck.status = 'Returning';
      towTruck.waypoints = [
        new THREE.Vector3(-83, 0.18, TOW_BAY.parkPos.z),
        TOW_BAY.parkPos.clone(),
      ];
      towTruck.waypointIndex = 0;
    } else {
      // Arrived back at Tow Bay
      towTruck.pos.copy(TOW_BAY.parkPos);
      towTruck.yaw = TOW_BAY.parkYaw;
      towTruck.speed = 0;
      towTruck.dyn.vx = 0;
      towTruck.dyn.vz = 0;
      towTruck.dyn.omega = 0;
      towTruck.dyn.bodyPitch = 0;
      towTruck.dyn.bodyRoll = 0;
      towTruck.rig.bodyGroup.rotation.set(0, 0, 0);
      towTruck.rig.towBoom.rotation.x = 0;
      towTruck.beaconsActive = false;
      towTruck.status = 'Standby';
      towTruck.targetUnitId = null;
      towTruck.waypoints = [];
      towTruck.waypointIndex = 0;
    }
  } else {
    const wp = towTruck.waypoints[towTruck.waypointIndex];
    const dx = wp.x - towTruck.pos.x;
    const dz = wp.z - towTruck.pos.z;
    const dist = Math.hypot(dx, dz);
    const isFinalWp = towTruck.waypointIndex === towTruck.waypoints.length - 1;
    const fwdX = Math.sin(towTruck.yaw);
    const fwdZ = Math.cos(towTruck.yaw);
    const forwardDot = dx * fwdX + dz * fwdZ;

    if (
      dist < (isFinalWp ? 3.6 : 5.6) ||
      (!isFinalWp && dist < 16 && forwardDot < 1.2)
    ) {
      towTruck.waypointIndex++;
    } else {
      const lookDist = isFinalWp ? dist : 8.5 + Math.min(4.0, towTruck.speed * 0.25);
      const aim = computePurePursuitLookahead(
        towTruck.pos,
        towTruck.waypoints,
        towTruck.waypointIndex,
        lookDist,
      );
      const baseDesiredYaw = Math.atan2(
        aim.targetX - towTruck.pos.x,
        aim.targetZ - towTruck.pos.z,
      );
      const absYawDiff = Math.abs(normalizeAngle(baseDesiredYaw - towTruck.yaw));
      const turnFactor =
        absYawDiff > 1.1 ? 0.3 : absYawDiff > 0.6 ? 0.5 : absYawDiff > 0.28 ? 0.75 : 1.0;

      const allVehicles = buildAllVehicleProxies(
        units,
        civilianCars,
        crimes,
        towTruck,
        ambulances,
      ).filter((v) => v.id !== towTruck.targetUnitId);

      const avoid = computeAvoidanceSteerAndSpeed({
        selfId: towTruck.id,
        pos: towTruck.pos,
        yaw: towTruck.yaw,
        speed: towTruck.speed,
        selfHalfW: 1.08,
        selfHalfL: 2.68,
        baseDesiredYaw,
        baseSpeed: maxCruise * turnFactor,
        prevSteerBias: towTruck.avoidanceSteer,
        canOvertake: !isFinalWp,
        allVehicles,
        pedestrians,
        staticBvh,
        dt,
      });
      towTruck.avoidanceSteer = avoid.nextSteerBias;

      const yawState = { yaw: towTruck.yaw, speed: towTruck.speed };
      stepVehicleDynamics(
        towTruck.pos,
        yawState,
        towTruck.dyn,
        towTruck.rig.bodyGroup,
        {
          targetSpeed: avoid.speedCap,
          desiredYaw: avoid.desiredYaw,
          maxAccel: 5.8,
          maxBrake: 11.5,
          maxSteerRate: 1.85,
          lateralGrip: 6.5 * gripScale,
          mass: 2.35,
        },
        dt,
      );
      towTruck.yaw = yawState.yaw;
      towTruck.speed = yawState.speed;
      towTruck.pos.y = THREE.MathUtils.damp(
        towTruck.pos.y,
        getSurfaceHeight(towTruck.pos.x, towTruck.pos.z),
        12,
        dt,
      );

      // Gentle self-unwedge if blocked by traffic wreck
      if (towTruck.speed < 0.7 && avoid.speedCap > 1.5) {
        towTruck.stuckTimer += dt;
        if (towTruck.stuckTimer > 2.2) {
          towTruck.pos.x -= Math.sin(towTruck.yaw) * 3.2 * dt;
          towTruck.pos.z -= Math.cos(towTruck.yaw) * 3.2 * dt;
          staticBvh.resolveCircle(towTruck.pos, 1.55);
          towTruck.yaw = normalizeAngle(towTruck.yaw + 0.9 * dt);
          if (towTruck.stuckTimer > 4.2) {
            towTruck.stuckTimer = 0;
          }
        }
      } else if (towTruck.speed > 1.5) {
        towTruck.stuckTimer = 0;
      }

      applyVehicleWheelVisuals(
        towTruck.rig.wheels,
        towTruck.rig.frontWheels,
        towTruck.speed,
        towTruck.dyn.steerAngle,
        0.42,
        dt,
      );
    }
  }

  // Update articulated trailer-hitch follow for the hooked cruiser during Towing
  if (towTruck.status === 'Towing' && targetUnit) {
    const hitchX = towTruck.pos.x - Math.sin(towTruck.yaw) * 2.85;
    const hitchZ = towTruck.pos.z - Math.cos(towTruck.yaw) * 2.85;
    const drawbarLen = 2.95;

    const dxH = hitchX - targetUnit.pos.x;
    const dzH = hitchZ - targetUnit.pos.z;
    const desiredCruiserYaw =
      dxH * dxH + dzH * dzH > 1e-4 ? Math.atan2(dxH, dzH) : towTruck.yaw;
    // Clamp jackknife angle to realistic wheel-lift articulation (±58 deg)
    const relAngle = THREE.MathUtils.clamp(
      normalizeAngle(desiredCruiserYaw - towTruck.yaw),
      -1.02,
      1.02,
    );
    targetUnit.yaw = normalizeAngle(towTruck.yaw + relAngle);
    targetUnit.pos.x = hitchX - Math.sin(targetUnit.yaw) * drawbarLen;
    targetUnit.pos.z = hitchZ - Math.cos(targetUnit.yaw) * drawbarLen;
    targetUnit.pos.y = getSurfaceHeight(targetUnit.pos.x, targetUnit.pos.z) + 0.08;
    targetUnit.speed = towTruck.speed;
    targetUnit.dyn.vx = towTruck.dyn.vx;
    targetUnit.dyn.vz = towTruck.dyn.vz;
    targetUnit.dyn.omega = 0;

    targetUnit.rig.bodyGroup.rotation.x = -0.095;
    targetUnit.rig.bodyGroup.rotation.z = towTruck.rig.bodyGroup.rotation.z * 0.5;
    targetUnit.rig.root.position.copy(targetUnit.pos);
    targetUnit.rig.root.rotation.y = targetUnit.yaw;

    applyVehicleWheelVisuals(
      targetUnit.rig.wheels,
      targetUnit.rig.frontWheels,
      towTruck.speed,
      0,
      targetUnit.wheelRadius,
      dt,
    );
  }

  towTruck.rig.root.position.copy(towTruck.pos);
  towTruck.rig.root.rotation.y = towTruck.yaw;
}
