import * as THREE from 'three';
import { SeatPartSpec } from '../assets/assetTypes';
import { BuiltHingeRef } from '../assets/jsonModelBuilder';
import {
  CaseAssignmentRole,
  CrimeType,
  IncidentStatus,
  PoliceLiveryId,
  PoliceUnitGoalId,
  PoliceVehicleKind,
  UnitStatus,
  UrgencyLevel,
  WeaponKind,
} from './types';
import { CivilianCarRig, HumanoidRig, PoliceCruiserRig } from './vehicleModels';
import { VehicleDynState } from './vehiclePhysics';
import { RagdollState } from './vfx';

export type CowardiceState = 'steady' | 'suppressed' | 'fleeing';

export type BoardingState = 'dismounted' | 'entering' | 'seated' | 'exiting';

export interface VehicleSeatState {
  slotIndex: number;
  role: SeatPartSpec['role'];
  spec: SeatPartSpec;
  localOffset: THREE.Vector3;
  enterOffset: THREE.Vector3;
  exitOffset: THREE.Vector3;
  hingePartId?: string;
  hingeRef?: BuiltHingeRef;
  seatedPitch: number;
  occupantOfficerId: string | null;
  doorOpenTimer: number;
}

export interface OfficerActor {
  id: string;
  unitId: string | null;
  occupiedUnitId: string | null;
  occupiedSeatIndex: number | null;
  boardingState: BoardingState;
  targetUnitId: string | null;
  targetSeatIndex: number | null;
  assignedCrimeId: string | null;
  rig: HumanoidRig;
  pos: THREE.Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  weaponKind: WeaponKind;
  isHeavy: boolean;
  morale: number;
  cowardiceState: CowardiceState;
  ragdoll: RagdollState;
  fireCooldown: number;
  muzzleTimer: number;
  walkPhase: number;
  ammo: number;
  reloadTimer: number;
  recoilKick: number;
  strafeSign: 1 | -1;
  strafeTimer: number;
  roamTarget: THREE.Vector3 | null;
  roamTimer: number;
  roamPauseTimer: number;
  mountPhase: 'walk' | 'boarding';
  boardTimer: number;
}

export interface AssailantActor {
  id: string;
  crimeId: string | null;
  rig: HumanoidRig;
  pos: THREE.Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  weaponKind: WeaponKind;
  alive: boolean;
  inVehicle: boolean;
  ammo: number;
  reloadTimer: number;
  recoilKick: number;
  strafeDir: 1 | -1;
  moveTimer: number;
  walkPhase: number;
  ragdoll: RagdollState;
  lastHitDir: THREE.Vector3;
  fireCooldown: number;
  muzzleTimer: number;
  roamTarget: THREE.Vector3 | null;
  roamTimer: number;
}

export interface PoliceUnit {
  id: string;
  callsign: string;
  bayIndex: number;
  vehicleKind: PoliceVehicleKind;
  liveryId: PoliceLiveryId;
  lightbarId: string;
  baseColorHex: number;
  isHeavyUnit: boolean;
  weaponKind: WeaponKind;
  wheelRadius: number;
  halfW: number;
  halfL: number;
  mass: number;
  rig: PoliceCruiserRig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  dyn: VehicleDynState;
  lateralOffset: number;
  status: UnitStatus;
  activeGoal: PoliceUnitGoalId;
  goalReason: string;
  mounted: boolean;
  freeRoam: boolean;
  dismountTimer: number;
  mountTimer: number;
  immobilized: boolean;
  immobilizeTilt: number;
  lightsActive: boolean;
  sirensActive: boolean;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  repathTimer: number;
  avoidanceSteer: number;
  damageSmokeTimer: number;
  smokeAccum: number;
  lightPhaseOffset: number;
  lightRateMult: number;
  targetCrimeId: string | null;
  assignedCaseNumber: number | null;
  assignedRole: CaseAssignmentRole | null;
  pursuitRole: 'direct' | 'nail_mat';
  officerRefs: string[];
  seats: VehicleSeatState[];
  hinges: Record<string, BuiltHingeRef>;
  holdTimer: number;
  stuckTimer: number;
  impatience: number;
  reverseTimer: number;
  reverseSteerDir: 1 | -1;
  stallCount: number;
  towRequested: boolean;
  beingTowed: boolean;
  debugAvoidActive?: boolean;
}

export type NailMatPhase = 'en_route' | 'deploying' | 'armed' | 'recovering';

export interface NailMatActor {
  id: string;
  crimeId: string;
  unitId: string;
  officerId: string;
  phase: NailMatPhase;
  roadCenter: THREE.Vector3;
  perpX: number;
  perpZ: number;
  roadDirX: number;
  roadDirZ: number;
  halfSpan: number;
  stagingPos: THREE.Vector3;
  stagingYaw: number;
  curbSideSign: 1 | -1;
  deployProgress: number;
  armedTimer: number;
  recheckTimer: number;
  triggeredBySuspect: boolean;
  group: THREE.Group;
  stripPivot: THREE.Group;
  warningBeacon: THREE.Mesh;
}

export interface ActiveCrime {
  id: string;
  caseNumber: number;
  type: CrimeType;
  district: string;
  incidentStatus: IncidentStatus;
  baseUrgency: number;
  urgency: number;
  urgencyLevel: UrgencyLevel;
  pos: THREE.Vector3;
  roadPullOverPos: THREE.Vector3;
  roadPullOverYaw: number;
  nearestNodeId: number;
  segmentNodeA: number;
  segmentNodeB: number;
  assailantRefs: string[];
  primaryAssailantId: string | null;
  assignedOfficerRefs: string[];
  inVehiclePursuit: boolean;
  vehicleRig: CivilianCarRig | null;
  vehicleThreatRing: THREE.Mesh | null;
  vehiclePos: THREE.Vector3;
  vehicleYaw: number;
  vehicleSpeed: number;
  vehicleDyn: VehicleDynState;
  vehicleMaxSpeed: number;
  vehicleHp: number;
  vehicleNodeId: number;
  vehicleNextNodeId: number;
  vehicleTurnApex: THREE.Vector3 | null;
  vehiclePinnedTimer: number;
  vehicleStuckTimer: number;
  vehicleImpatience: number;
  vehicleReverseTimer: number;
  vehicleReverseSteerDir: 1 | -1;
  vehicleImmobilized: boolean;
  vehicleImmobilizeTilt: number;
  vehicleTireBlowoutTimer: number;
  vehicleSmokeTimer: number;
  vehicleSmokeAccum: number;
  assignedUnitId: string | null;
  assignedUnitIds: string[];
  backupDispatched: boolean;
  heavyDeployed: boolean;
  nailMatAttempts: number;
  cleanupTimer: number;
  elapsedSec: number;
  engagedSec: number;
}

export interface CivilianVehicle {
  id: string;
  rig: CivilianCarRig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  dyn: VehicleDynState;
  maxSpeed: number;
  currentNodeId: number;
  nextNodeId: number;
  prevNodeId: number;
  routeQueue: number[];
  destinationNodeId?: number;
  junctionPauseTimer: number;
  junctionWaitNodeId?: number;
  debugNextTarget?: THREE.Vector3;
  debugAvoidActive?: boolean;
  turnApex: THREE.Vector3 | null;
  lateralYield: number;
  stunTimer: number;
  impatience: number;
  patienceRate: number;
  stuckTimer: number;
  reverseTimer: number;
  reverseSteerDir: 1 | -1;
  stallCount: number;
  immobilized: boolean;
  immobilizeTilt: number;
  damageSmokeTimer: number;
  smokeAccum: number;
}

export interface PedestrianActor {
  id: string;
  rig: HumanoidRig;
  pos: THREE.Vector3;
  yaw: number;
  velX: number;
  velZ: number;
  jumpY: number;
  jumpVelY: number;
  activeGoal: string;
  blockCx: number;
  blockCz: number;
  loopRadius: number;
  loopRect?: { cx: number; cz: number; halfW: number; halfD: number };
  cornerIdx: number;
  dir: 1 | -1;
  walkPhase: number;
  panicTimer: number;
  hp: number;
  maxHp: number;
  injured: boolean;
  dead: boolean;
  ragdoll: RagdollState;
}

export interface BulletTracer {
  mesh: THREE.Mesh;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  maxLife: number;
  isSuspect: boolean;
  weaponKind: WeaponKind;
  damage: number;
  armorPen: number;
  shooterUnitId: string | null;
}

export function resolveUnitOfficers(
  unit: PoliceUnit,
  officersById: Map<string, OfficerActor>,
): OfficerActor[] {
  const result: OfficerActor[] = [];
  for (const oid of unit.officerRefs) {
    const off = officersById.get(oid);
    if (off) result.push(off);
  }
  return result;
}

export function resolveCrimePrimaryAssailant(
  crime: ActiveCrime,
  assailantsById: Map<string, AssailantActor>,
): AssailantActor | undefined {
  if (crime.primaryAssailantId) {
    const a = assailantsById.get(crime.primaryAssailantId);
    if (a) return a;
  }
  for (const aid of crime.assailantRefs) {
    const a = assailantsById.get(aid);
    if (a && a.alive) return a;
  }
  for (const aid of crime.assailantRefs) {
    const a = assailantsById.get(aid);
    if (a) return a;
  }
  return undefined;
}
