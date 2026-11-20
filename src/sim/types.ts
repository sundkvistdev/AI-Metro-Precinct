import { AssetIssue } from '../assets/assetTypes';

export enum LightbarMode {
  LED = 'LED',
  FlashingHalogen = 'FLASHING_HALOGEN',
  RotatingHalogen = 'ROTATING_HALOGEN',
  VectorPods = 'VECTOR_PODS',
  VisorStealth = 'VISOR_STEALTH',
  MiniBeacon = 'MINI_BEACON',
}

export enum SirenPattern {
  AutoCycle = 'AUTO_CYCLE',
  Wail = 'WAIL',
  Yelp = 'YELP',
  Phaser = 'PHASER',
  HiLo = 'HI_LO',
}

export enum DrivingMode {
  Standard = 'STANDARD',
  Aggressive = 'AGGRESSIVE',
}

export enum BackupMode {
  Minimal = 'MINIMAL',
  Standard = 'STANDARD',
  Perimeter = 'PERIMETER',
  FullScale = 'FULL_SCALE',
}

export enum WeatherCondition {
  Clear = 'CLEAR',
  Overcast = 'OVERCAST',
  Rain = 'RAIN',
  HeavyFog = 'HEAVY_FOG',
}

export enum CameraMode {
  Overview = 'OVERVIEW',
  FreeFly = 'FREE_FLY',
  FollowUnit = 'FOLLOW_UNIT',
  RearLightbar = 'REAR_LIGHTBAR',
}

export enum UnitStatus {
  AtStation = 'AT_STATION',
  Responding = 'RESPONDING',
  Pursuing = 'PURSUING',
  DeployingSpikes = 'DEPLOYING_SPIKES',
  Dismounting = 'DISMOUNTING',
  Engaging = 'ENGAGING',
  Mounting = 'MOUNTING',
  Retreating = 'RETREATING',
  Returning = 'RETURNING',
}

export type PoliceUnitGoalId =
  | 'IMMOBILIZED_HOLD'
  | 'RETREAT_TO_STATION'
  | 'DEPLOY_SPIKES'
  | 'ENGAGE_ON_FOOT'
  | 'PURSUE_VEHICLE'
  | 'RESPOND_TO_CALL'
  | 'MANUAL_FOOT_PATROL'
  | 'MOUNT_CREW'
  | 'PATROL_STREETS'
  | 'RETURN_TO_STATION'
  | 'STATION_STANDBY';

export enum CrimeType {
  ArmedRobbery = 'Armed Robbery',
  ShotsFired = 'Shots Fired',
  StorefrontHeist = 'Storefront Heist',
  StreetAssault = 'Armed Assault',
  VehiclePursuit = 'Vehicle Pursuit',
}

export type PoliceVehicleKind = 'sedan' | 'suv' | 'van' | 'apc' | (string & {});

export type WeaponKind = 'pistol' | 'rifle';

export type IncidentStatus =
  | 'reported'
  | 'dispatched'
  | 'on_scene'
  | 'pursuit'
  | 'resolved';

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export type CaseAssignmentRole = 'primary' | 'backup' | 'tactical' | 'spikes';

export type PoliceLiveryId =
  | 'classic_bw'
  | 'navy_silver'
  | 'forest_cream'
  | 'slate_cobalt'
  | 'transport_blue'
  | 'tactical_swat'
  | string;

export interface PaintSwatchSummary {
  id: string;
  label: string;
  hex: number;
}

export interface CaseAssignedUnitBadge {
  unitId: string;
  callsign: string;
  role: CaseAssignmentRole;
  status: UnitStatus;
  reversing: boolean;
}

export interface UnitSummary {
  id: string;
  callsign: string;
  vehicleKind: PoliceVehicleKind;
  liveryLabel: string;
  lightbarId: string;
  baseColorHex: number;
  isHeavyUnit: boolean;
  weaponKind: WeaponKind;
  status: UnitStatus;
  activeGoal: PoliceUnitGoalId;
  goalReason: string;
  mounted: boolean;
  freeRoam: boolean;
  lightsActive: boolean;
  sirensActive: boolean;
  speedKmh: number;
  morale: number;
  fleeingOfficers: number;
  downedOfficers: number;
  immobilized: boolean;
  targetCrimeId: string | null;
  assignedCaseNumber: number | null;
  assignedRole: CaseAssignmentRole | null;
  impatience: number;
  reversing: boolean;
  seatedCount?: number;
  seatCapacity?: number;
}

export interface CrimeSummary {
  id: string;
  caseNumber: number;
  type: CrimeType;
  district: string;
  incidentStatus: IncidentStatus;
  urgency: number;
  urgencyLevel: UrgencyLevel;
  suspectAlive: boolean;
  suspectHp: number;
  suspectWeaponKind: WeaponKind;
  inVehiclePursuit: boolean;
  vehicleHp: number;
  assignedUnitCallsign: string | null;
  assignedUnits: CaseAssignedUnitBadge[];
  backupDispatched: boolean;
  backupCount: number;
  heavyDeployed: boolean;
  apcDeployed: boolean;
  nailMatDeployed: boolean;
  elapsedSec: number;
  sightStatus: 'visual' | 'predicted' | 'lost';
  showQuestionMark: boolean;
  hasLineOfSight: boolean;
}

export interface RadarStaticMapData {
  halfSize: number;
  roadWidth: number;
  roadPolylines: Array<Array<[number, number]>>;
  extraStrips: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  buildings: Array<{
    x: number;
    z: number;
    w: number;
    d: number;
    rotY: number;
    isStation?: boolean;
  }>;
  zones: Array<{
    kind: string;
    cx: number;
    cz: number;
    w: number;
    d: number;
    rotY: number;
  }>;
}

export interface RadarCopBlip {
  id: string;
  callsign: string;
  x: number;
  z: number;
  yaw: number;
  immobilized: boolean;
  followed: boolean;
  isHeavyUnit: boolean;
}

export interface RadarOfficerBlip {
  id: string;
  unitId: string | null;
  x: number;
  z: number;
  yaw: number;
  dead: boolean;
  incapacitated: boolean;
  followedCrew: boolean;
}

export interface RadarIncidentBlip {
  id: string;
  caseNumber: number;
  x: number;
  z: number;
  yaw?: number;
  isVehicle: boolean;
  hasLineOfSight: boolean;
  showQuestionMark: boolean;
  alive: boolean;
}

export interface RadarLiveSnapshot {
  cops: RadarCopBlip[];
  officers: RadarOfficerBlip[];
  incidents: RadarIncidentBlip[];
  deadSuspects: Array<{ id: string; x: number; z: number }>;
  wreckedSuspectVehicles: Array<{ id: string; x: number; z: number; yaw: number }>;
  followedUnitId: string;
  followedCrewDismounted: boolean;
}

export interface SimSnapshot {
  units: UnitSummary[];
  activeCrimes: CrimeSummary[];
  neutralizedCount: number;
  casualtyCount: number;
  debrisCount: number;
  persistentWreckCount: number;
  persistentBodyCount: number;
  civilianCarCount: number;
  pedestrianCount: number;
  activeNailMats: number;
  selectedUnitId: string;
  lightbarMode: LightbarMode;
  activeLightbarId: string;
  availableLightbars: Array<{ id: string; name: string }>;
  sirenPattern: SirenPattern;
  drivingMode: DrivingMode;
  backupMode: BackupMode;
  weather: WeatherCondition;
  cameraMode: CameraMode;
  crimeProbability: number;
  cowardiceLevel: number;
  audioEnabled: boolean;
  audioVolume: number;
  audioQuality: 'low' | 'normal' | 'high';
  shadowsEnabled: boolean;
  debrisObstacles: boolean;
  renderScale: 0.75 | 1 | 1.5;
  crashIntensity: number;
  maxPhysicsParts: number;
  experimentalComplexMeshes: boolean;
  simSpeed: 1 | 2;
  isSoftwareGl: boolean;
  paintPalette: PaintSwatchSummary[];
  assetPackName: string;
  assetSourceLabel: string;
  configVersion: string;
  activeMapId: string;
  mapName: string;
  availableMaps: Array<{ id: string; name: string; description?: string }>;
  assetCounts: {
    textures: number;
    models: number;
    audio: number;
    materials: number;
    media: number;
    lightbars: number;
    maps: number;
  };
  assetsLoaded: boolean;
  assetIssues: AssetIssue[];
  fatalError: string | null;
  radarMap: RadarStaticMapData | null;
  radar: RadarLiveSnapshot;
}

export type DevEditorMode = 'world' | 'asset';
export type DevWorldTab = 'hierarchy' | 'spawn' | 'debug';
export type DevAssetTab =
  | 'hierarchy'
  | 'map'
  | 'model'
  | 'lightbars'
  | 'materials'
  | 'texture'
  | 'audio'
  | 'prefabs';

export type WorldEntityKind =
  | 'police'
  | 'officer'
  | 'assailant'
  | 'traffic'
  | 'ped'
  | 'crime'
  | 'nail_mat';

export interface WorldEntitySummary {
  uid: string;
  kind: WorldEntityKind;
  id: string;
  label: string;
  statusText: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp?: number;
  maxHp?: number;
  immobilized?: boolean;
  lightsActive?: boolean;
  sirensActive?: boolean;
  mounted?: boolean;
  extra?: string;
}

export interface AIDebugFlags {
  showPolicePaths: boolean;
  showPursuitPaths: boolean;
  showTrafficRoutes: boolean;
  showNodesAndPriority: boolean;
  showAvoidanceAndStuck: boolean;
}

export interface AIDebugStats {
  activePoliceRoutes: number;
  activePursuits: number;
  activeTrafficRoutes: number;
  impatientCount: number;
  reversingCount: number;
  avoidingCount: number;
  roadNodeCount: number;
  roadEdgeCount: number;
}
