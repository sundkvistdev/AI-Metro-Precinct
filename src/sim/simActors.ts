import * as THREE from 'three';
import {
  AmbulanceStatus,
  CrimeType,
  PoliceLiveryId,
  PoliceVehicleKind,
  SirenPattern,
  TowTruckStatus,
  UnitStatus,
  WeaponKind,
} from './types';
import { AmbulanceRig, TowTruckRig } from './serviceVehicleModels';
import { CivilianCarRig, HumanoidRig, PoliceCruiserRig } from './vehicleModels';
import { VehicleDynState } from './vehiclePhysics';
import { RagdollState } from './vfx';

export type CowardiceState = 'steady' | 'suppressed' | 'fleeing';

export interface OfficerActor {
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

export interface PoliceUnit {
  id: string;
  callsign: string;
  bayIndex: number;
  vehicleKind: PoliceVehicleKind;
  liveryId: PoliceLiveryId;
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
  pursuitRole: 'direct' | 'nail_mat';
  officers: [OfficerActor, OfficerActor];
  holdTimer: number;
  stuckTimer: number;
  towRequested: boolean;
  beingTowed: boolean;
}

export interface TowTruckActor {
  id: string;
  callsign: string;
  rig: TowTruckRig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  dyn: VehicleDynState;
  status: TowTruckStatus;
  beaconsActive: boolean;
  targetUnitId: string | null;
  hookTimer: number;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  avoidanceSteer: number;
  stuckTimer: number;
}

export type CasualtyTarget =
  | { kind: 'officer'; unitId: string; officerIndex: 0 | 1; key: string }
  | { kind: 'suspect'; crimeId: string; key: string }
  | { kind: 'pedestrian'; pedIndex: number; key: string };

export interface ParamedicActor {
  rig: HumanoidRig;
  pos: THREE.Vector3;
  yaw: number;
  walkPhase: number;
}

export interface AmbulanceActor {
  id: string;
  callsign: string;
  bayIndex: number;
  rig: AmbulanceRig;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  dyn: VehicleDynState;
  status: AmbulanceStatus;
  lightsActive: boolean;
  sirensActive: boolean;
  activeSirenPattern: SirenPattern;
  sirenModeTimer: number;
  lightPhaseOffset: number;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  avoidanceSteer: number;
  stuckTimer: number;
  target: CasualtyTarget | null;
  targetPos: THREE.Vector3;
  scenePhase: 'walking_to_patient' | 'treating' | 'returning_to_rig';
  treatTimer: number;
  paramedics: [ParamedicActor, ParamedicActor];
  stretcherGroup: THREE.Group;
}

export type NailMatPhase = 'en_route' | 'deploying' | 'armed' | 'recovering';

export interface NailMatActor {
  id: string;
  crimeId: string;
  unitId: string;
  officerIndex: 0 | 1;
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
  type: CrimeType;
  district: string;
  pos: THREE.Vector3;
  roadPullOverPos: THREE.Vector3;
  roadPullOverYaw: number;
  nearestNodeId: number;
  suspectRig: HumanoidRig;
  suspectPos: THREE.Vector3;
  suspectYaw: number;
  suspectHp: number;
  suspectArmor: number;
  suspectWeaponKind: WeaponKind;
  suspectAlive: boolean;
  suspectAmmo: number;
  suspectReloadTimer: number;
  suspectRecoil: number;
  suspectStrafeDir: 1 | -1;
  suspectMoveTimer: number;
  suspectWalkPhase: number;
  suspectRagdoll: RagdollState;
  lastHitDir: THREE.Vector3;
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
  vehicleImmobilized: boolean;
  vehicleImmobilizeTilt: number;
  vehicleTireBlowoutTimer: number;
  vehicleSmokeTimer: number;
  vehicleSmokeAccum: number;
  assignedUnitId: string | null;
  backupDispatched: boolean;
  heavyDeployed: boolean;
  nailMatAttempts: number;
  fireCooldown: number;
  muzzleTimer: number;
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
  turnApex: THREE.Vector3 | null;
  lateralYield: number;
  stunTimer: number;
  immobilized: boolean;
  immobilizeTilt: number;
  damageSmokeTimer: number;
  smokeAccum: number;
}

export interface PedestrianActor {
  rig: HumanoidRig;
  pos: THREE.Vector3;
  yaw: number;
  blockCx: number;
  blockCz: number;
  loopRadius: number;
  cornerIdx: number;
  dir: 1 | -1;
  walkPhase: number;
  panicTimer: number;
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
