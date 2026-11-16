export enum LightbarMode {
  LED = 'LED',
  FlashingHalogen = 'FLASHING_HALOGEN',
  RotatingHalogen = 'ROTATING_HALOGEN',
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

export type PoliceVehicleKind = 'sedan' | 'suv' | 'van' | 'apc';

export type WeaponKind = 'pistol' | 'rifle';

export type PoliceLiveryId =
  | 'classic_bw'
  | 'navy_silver'
  | 'forest_cream'
  | 'slate_cobalt'
  | 'transport_blue'
  | 'tactical_swat';

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
}

export interface CrimeSummary {
  id: string;
  type: CrimeType;
  district: string;
  suspectAlive: boolean;
  suspectHp: number;
  suspectWeaponKind: WeaponKind;
  inVehiclePursuit: boolean;
  vehicleHp: number;
  assignedUnitCallsign: string | null;
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
  simSpeed: 1 | 2;
  isSoftwareGl: boolean;
  assetPackName: string;
  assetCounts: {
    textures: number;
    models: number;
    audio: number;
  };
  assetsLoaded: boolean;
}
