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
  baseColorHex: number;
  isHeavyUnit: boolean;
  weaponKind: WeaponKind;
  status: UnitStatus;
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
}

export interface SimSnapshot {
  units: UnitSummary[];
  activeCrimes: CrimeSummary[];
  neutralizedCount: number;
  casualtyCount: number;
  debrisCount: number;
  civilianCarCount: number;
  pedestrianCount: number;
  activeNailMats: number;
  selectedUnitId: string;
  lightbarMode: LightbarMode;
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
  simSpeed: 1 | 2;
  isSoftwareGl: boolean;
  paintPalette: PaintSwatchSummary[];
  assetPackName: string;
  assetSourceLabel: string;
  configVersion: string;
  mapName: string;
  assetCounts: {
    textures: number;
    models: number;
    audio: number;
    materials: number;
    media: number;
  };
  assetsLoaded: boolean;
  assetIssues: AssetIssue[];
  fatalError: string | null;
}

export type DevEditorMode = 'world' | 'asset';
export type DevWorldTab = 'hierarchy' | 'spawn' | 'debug';
export type DevAssetTab =
  | 'hierarchy'
  | 'map'
  | 'model'
  | 'materials'
  | 'texture'
  | 'audio'
  | 'prefabs';

export type WorldEntityKind = 'police' | 'traffic' | 'ped' | 'crime' | 'nail_mat';

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
