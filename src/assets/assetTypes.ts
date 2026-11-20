export type MediaKind = 'image' | 'audio';

export interface ImportedMediaAsset {
  id: string;
  kind: MediaKind;
  path: string;
  mimeType: string;
  bytes: Uint8Array;
  objectUrl: string;
  filename?: string;
  width?: number;
  height?: number;
  imageElement?: HTMLImageElement;
}

export interface AssetManifest {
  formatVersion: string;
  packName: string;
  config: string;
  map: string;
  defaultMap?: string;
  maps?: Record<string, string>;
  materials?: string;
  lightbars?: Record<string, string>;
  vehicles?: Record<string, string>;
  textures: Record<string, string>;
  models: Record<string, string>;
  audio: Record<string, string>;
  media?: Record<
    string,
    {
      kind: MediaKind;
      path: string;
      mimeType?: string;
      filename?: string;
    }
  >;
}

export type LightbarHardwareStyle =
  | 'standard_shell'
  | 'vector_pods'
  | 'mini_beacon'
  | 'visor_stealth'
  | 'custom';

export type LightbarPatternType =
  | 'led'
  | 'flashing_halogen'
  | 'rotating_halogen'
  | 'vector_pods'
  | 'visor_stealth'
  | 'mini_beacon'
  | 'custom';

export type LightbarEmitterMode = 'strobe' | 'halogen' | 'rotator' | 'sweep' | 'steady';
export type LightbarEmitterGroup = 'roof' | 'visor' | 'grille' | 'rear' | 'advisor';

export interface LightbarEmitterDef {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  shape: 'box' | 'cylinder' | 'sphere';
  color: string;
  emissive: string;
  phase: number;
  duty: number;
  freqHz: number;
  mode: LightbarEmitterMode;
  group: LightbarEmitterGroup;
  intensity?: number;
}

export interface LightbarAssetDef {
  format: 'jdata-lightbar-v3';
  id: string;
  name: string;
  hardwareStyle: LightbarHardwareStyle;
  patternType: LightbarPatternType;
  rateMult: number;
  hasTrafficAdvisor: boolean;
  hasCookies: boolean;
  hasGrilleStrobes: boolean;
  hasRearDeck: boolean;
  leftColor: string;
  rightColor: string;
  centerColor: string;
  haloOpacity: number;
  pointLightRange: number;
  pointLightIntensity: number;
  emitters: LightbarEmitterDef[];
}

export interface VehicleChassisDef {
  modelRef: string;
  wheelRadius: number;
  halfW: number;
  halfL: number;
  mass: number;
  chassisScale: number;
  maxSteerScale: number;
  lightbarPos: [number, number, number];
  roofLightPos: [number, number, number];
  sideDecalX: number;
  sideDecalY: number;
  sideDecalZ: number;
  stripeW: number;
  stripeH: number;
  roofPlateY: number;
  roofPlateZ: number;
  rearChevronY: number;
  rearChevronZ: number;
  hitboxSize: [number, number, number];
  hitboxY: number;
  obbHeight: number;
  shadowSize: [number, number];
  shadowY: number;
}

export interface VehicleAssetDef {
  format: 'jdata-vehicle-v3';
  id: string;
  role: 'police' | 'civilian' | 'suspect';
  label: string;
  vehicleKind: string;
  modelRef: string;
  defaultLiveryId?: string;
  defaultLightbarId?: string;
  weaponKind?: 'pistol' | 'rifle';
  isHeavyUnit?: boolean;
  vehicleClass?: 0 | 1;
  maxHp?: number;
  maxArmor?: number;
  chassis: VehicleChassisDef;
}

export interface StationBayDef {
  id: string;
  callsign: string;
  vehicleKind: string;
  liveryId: string;
  lightbarId?: string;
  weaponKind: 'pistol' | 'rifle';
  isHeavyUnit: boolean;
  vehicleClass?: 0 | 1;
  parkPos: [number, number, number];
  parkYaw: number;
  exitRoadNodeId: number;
}

export type KeybindActionId =
  | 'toggleHud'
  | 'spawnCrime'
  | 'spawnPursuit'
  | 'cameraReset'
  | 'cameraOverview'
  | 'cameraFreeFly'
  | 'cameraFollow'
  | 'cameraLightbar'
  | 'camForward'
  | 'camBackward'
  | 'camLeft'
  | 'camRight'
  | 'camOrbitLeft'
  | 'camOrbitRight'
  | 'camUp'
  | 'camDown'
  | 'camZoomIn'
  | 'camZoomOut';

export type SimEventId =
  | 'weapon_fire_pistol'
  | 'weapon_fire_rifle'
  | 'weapon_fire_suspect'
  | 'ped_impact'
  | 'vehicle_crash'
  | 'dispatch_chirp'
  | 'siren_wail'
  | 'siren_yelp'
  | 'siren_phaser'
  | 'siren_hilo';

export interface EventBindingDef {
  audioId: string;
  gainScale?: number;
  enabled?: boolean;
}

export interface AIGoalRuleDef {
  id: string;
  label?: string;
  enabled: boolean;
  priority: number;
  params?: Record<string, number>;
}

export interface PhysicsConfigDef {
  defaultMaxPhysicsParts: number;
  debrisRestitution?: number;
  debrisHumanImpactSpeed?: number;
}

export interface EngineConfigAsset {
  format: 'jdata-config-v1' | 'jdata-config-v2' | 'jdata-config-v3';
  version: string;
  keybinds?: Partial<Record<KeybindActionId, string>>;
  eventBindings?: Partial<Record<SimEventId, EventBindingDef>>;
  aiGoals?: {
    police: AIGoalRuleDef[];
    pedestrian: AIGoalRuleDef[];
  };
  physics?: PhysicsConfigDef;
  world: {
    buildingModels?: Record<string, string>;
    propModels?: {
      tree?: string;
      streetlight?: string;
      fountain?: string;
      sign?: string;
      beacon?: string;
      roadSign?: string;
    };
    roadCoords: number[];
    roadWidth: number;
    laneOffset: number;
    sidewalkWidth: number;
    townHalfSize: number;
    blockCenters: number[];
    stationBounds: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      centerX: number;
      centerZ: number;
    };
    apronBounds: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      centerX: number;
      centerZ: number;
      width: number;
      depth: number;
      height: number;
    };
    parkBlock: {
      bxIdx: number;
      bzIdx: number;
      centerX: number;
      centerZ: number;
      innerHalf: number;
    };
    surfaceHeights: {
      terrain: number;
      road: number;
      sidewalk: number;
      apron: number;
      park: number;
    };
    districts: string[];
    treePalette: string[];
    trafficCount: number;
    pedestrianCount: number;
    civilianVariants: string[];
    pedestrianModels?: string[];
    civilianColors: string[];
    getawayColors: string[];
    pedestrianShirtColors: string[];
  };
  simulation: {
    initialCrimeDelaySec: number;
    crimeCheckIntervalSec: number;
    maxActiveCrimes: number;
    autoCrimeMaxConcurrent: number;
    autoCrimeChanceScale: number;
    crimeCooldownSec: number;
    pursuitTriggerChance: number;
    suspectRifleChance: number;
    sirenKeepOnAtSceneChance: number;
    defaultCrimeProbability: number;
    defaultCowardiceLevel: number;
    snapshotIntervalSec: number;
  };
  camera: {
    fov: number;
    near: number;
    far: number;
    overviewPos: [number, number, number];
    overviewTarget: [number, number, number];
    freeFlySpeed: number;
    overviewPanSpeed: number;
    minDistance: number;
    maxDistance: number;
  };
  vehicles: {
    paintPalette: Array<{
      id: string;
      label: string;
      color: string;
    }>;
    liveries: Record<
      string,
      {
        id: string;
        label: string;
        agencyLabel: string;
        callsignNum: string;
        primaryPaint: string;
        secondaryPaint: string;
        stripeHex: string;
        accentHex: string;
        chevronPrimary: string;
        chevronSecondary: string;
        doorTextureRef: string;
      }
    >;
    chassis: Record<string, VehicleChassisDef>;
    stationBays: StationBayDef[];
  };
  weapons: Record<
    'pistol' | 'rifle',
    {
      speed: number;
      gravity: number;
      baseSpreadRad: number;
      suppressedSpreadRad: number;
      minDmg: number;
      maxDmg: number;
      armorPen: number;
      magSize: number;
      cooldownMin: number;
      cooldownJitter: number;
      reloadTime: number;
      maxRange: number;
    }
  >;
  weatherPresets: Record<
    'CLEAR' | 'OVERCAST' | 'RAIN' | 'HEAVY_FOG',
    {
      skyColor: string;
      fogDensity: number;
      sunIntensity: number;
      sunColor: string;
      hemiIntensity: number;
      rimIntensity: number;
      exposure: number;
      roadRoughness: number;
      roadMetalness: number;
      sidewalkRoughness: number;
      rainIntensity: number;
    }
  >;
  backupPolicies: Record<
    'MINIMAL' | 'STANDARD' | 'PERIMETER' | 'FULL_SCALE',
    {
      maxRegularUnits: number;
      maxHeavyUnits: number;
      maxConcurrentNailMats: number;
      maxNailMatAttempts: number;
      regularDelaySec: number;
      heavyDelaySec: number;
      prolongedPursuitSec: number;
      prolongedFootSec: number;
      forceAggressive: boolean;
    }
  >;
}

export type TextureLayerOp =
  | {
      op: 'fill';
      color: string;
    }
  | {
      op: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      op: 'circle';
      cx: number;
      cy: number;
      r: number;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      op: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation?: number;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      op: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      color: string;
      opacity?: number;
    }
  | {
      op: 'polygon';
      points: Array<[number, number]>;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      op: 'text';
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fontWeight?: string;
      align?: CanvasTextAlign;
      color: string;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
    }
  | {
      op: 'image_stamp';
      mediaId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      opacity?: number;
    }
  | {
      op: 'noise_speckle';
      seedOffset?: number;
      count: number;
      size: number;
      minRgb: [number, number, number];
      maxRgb: [number, number, number];
      alpha?: number;
    }
  | {
      op: 'dashed_line';
      orientation: 'horizontal' | 'vertical';
      position: number;
      dashLength: number;
      gapLength: number;
      thickness: number;
      color: string;
      start?: number;
      end?: number;
    }
  | {
      op: 'crosswalk_ring';
      margin: number;
      stripeWidth: number;
      stripeLength: number;
      step: number;
      color: string;
    }
  | {
      op: 'grid_lines';
      stepX: number;
      stepY: number;
      lineWidth: number;
      color: string;
    }
  | {
      op: 'radial_gradient';
      cx: number;
      cy: number;
      rInner: number;
      rOuter: number;
      stops: Array<{ offset: number; color: string }>;
    }
  | {
      op: 'light_cookie_lobe';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      hotRadius: number;
      fluteCount: number;
    }
  | {
      op: 'roughness_grain';
      seedOffset?: number;
      baseValue: number;
      variance: number;
      patchCount: number;
      patchRadius: number;
    }
  | {
      op: 'facade_windows';
      seedOffset?: number;
      cols: number;
      rows: number;
      trimColor: string;
      frameColor: string;
      litChance: number;
      litColor: string;
      coolColors: [string, string];
    }
  | {
      op: 'storefront_bays';
      bays: Array<{ name: string; awningColor: string }>;
    }
  | {
      op: 'police_door_emblem';
      title: string;
      subtitle: string;
      bgColor?: string;
      stripeColor?: string;
      accentColor?: string;
      badgeColor?: string;
      badgeCenterColor?: string;
      textColor?: string;
      subtitleColor?: string;
    }
  | {
      op: 'precinct_sign_plate';
      title: string;
      subtitle: string;
      bgColor?: string;
      borderColor?: string;
      medicalCross?: boolean;
      titleColor?: string;
      subtitleColor?: string;
    }
  | {
      op: 'road_sign_plate';
      shape: 'octagon' | 'triangle' | 'rect' | 'circle';
      title: string;
      subtitle?: string;
      bgColor?: string;
      borderColor?: string;
      textColor?: string;
    };

export interface ProceduralTextureAsset {
  format: 'jdata-texture-v1' | 'jdata-texture-v2';
  id: string;
  seed: number;
  width: number;
  height: number;
  colorSpace: 'srgb' | 'linear';
  repeat?: [number, number];
  anisotropy?: number;
  layers: TextureLayerOp[];
}

export interface ModelMaterialDef {
  type: 'standard' | 'physical' | 'basic';
  color: string;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  textureRef?: string;
  emissiveTextureRef?: string;
  roughnessTextureRef?: string;
}

export type CrashPartRole =
  | 'bumper'
  | 'headlight_l'
  | 'headlight_r'
  | 'taillight_l'
  | 'taillight_r'
  | 'lightbar'
  | 'wheel'
  | 'door'
  | 'trim'
  | 'sign'
  | 'roof';

export interface CrashPartSpec {
  role: CrashPartRole;
  minStrikeSpeed: number;
  health: number;
  radius?: number;
  isWheel?: boolean;
  isLightbar?: boolean;
}

export interface HingePartSpec {
  axis: 'x' | 'y' | 'z';
  closedAngle: number;
  openAngle: number;
  speed?: number;
  role?:
    | 'driver_door'
    | 'passenger_door'
    | 'rear_left_door'
    | 'rear_right_door'
    | 'rear_door'
    | 'hood'
    | 'trunk'
    | 'custom';
}

export interface SeatPartSpec {
  slotIndex: number;
  role: 'driver' | 'passenger' | 'rear_left' | 'rear_right' | 'crew';
  hingePartId?: string;
  enterOffset?: [number, number, number];
  exitOffset?: [number, number, number];
  seatedPitch?: number;
}

export interface UVTransformSpec {
  repeat?: [number, number];
  offset?: [number, number];
  rotation?: number;
  center?: [number, number];
}

export interface ExtrudeMeshSpec {
  points: Array<[number, number]>;
  depth: number;
  bevelEnabled?: boolean;
  bevelSize?: number;
}

export interface LatheMeshSpec {
  points: Array<[number, number]>;
  segments?: number;
}

export interface CustomBufferMeshSpec {
  positions: number[];
  indices?: number[];
  uvs?: number[];
  normals?: number[];
}

export interface ModelPartDef {
  id: string;
  tag?: string;
  kind: 'group' | 'box' | 'cylinder' | 'sphere' | 'plane' | 'extrude' | 'lathe' | 'mesh';
  dimensions?: [number, number, number];
  radiusSegments?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  materialRef?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  visible?: boolean;
  crashPart?: CrashPartSpec;
  hinge?: HingePartSpec;
  seat?: SeatPartSpec;
  uv?: UVTransformSpec;
  extrude?: ExtrudeMeshSpec;
  lathe?: LatheMeshSpec;
  customMesh?: CustomBufferMeshSpec;
  children?: ModelPartDef[];
}

export type ModelCategory =
  | 'vehicle'
  | 'humanoid'
  | 'sign'
  | 'prop'
  | 'building'
  | 'custom';

export interface ModelFlagsDef {
  category?: ModelCategory;
  collidable?: boolean;
  destructible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  isEmergencyVehicle?: boolean;
  useBasePaint?: boolean;
  pedestrianTemplate?: boolean;
  customTags?: string[];
}

export interface ProceduralModelAsset {
  format: 'jdata-model-v1' | 'jdata-model-v2';
  id: string;
  seed: number;
  flags?: ModelFlagsDef;
  materials: Record<string, ModelMaterialDef>;
  parts: ModelPartDef[];
}

export type RoadNodeType = 'join' | 'junction';
export type RoadNodePriority = 'none' | 'yield' | 'stop' | 'major';

export interface MapRoadNodeDef {
  id: number;
  x: number;
  z: number;
  label?: string;
  nodeType?: RoadNodeType;
  hasCrosswalk?: boolean;
  priority?: RoadNodePriority;
}

export interface MapRoadEdgeDef {
  from: number;
  to: number;
  ctrlX?: number;
  ctrlZ?: number;
}

export interface MapZoneDef {
  id: string;
  kind: 'apron' | 'park' | 'sidewalk';
  cx: number;
  cz: number;
  width: number;
  depth: number;
  height: number;
  rotationY?: number;
  color?: string;
}

export interface MapBuildingDef {
  id: string;
  kind: 'building' | 'station' | 'fountain' | 'prop';
  cx: number;
  cz: number;
  width: number;
  depth: number;
  height: number;
  baseY?: number;
  rotationY?: number;
  modelRef?: string;
  facadeStyle?:
    | 'storefront'
    | 'brick'
    | 'concrete'
    | 'limestone'
    | 'office'
    | 'station_hall'
    | 'station_glass'
    | 'trim'
    | 'fountain'
    | 'sign'
    | 'beacon';
  color?: string;
  collidable: boolean;
  groundHeight?: number;
  hasAwning?: boolean;
  hasHvac?: boolean;
}

export interface MapTreeDef {
  x: number;
  y: number;
  z: number;
  scale?: number;
}

export interface MapStreetlightDef {
  x: number;
  y: number;
  z: number;
  hasHalo?: boolean;
}

export interface MapPedLoopDef {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
}

export type RoadSignStyle =
  | 'stop'
  | 'speed_limit'
  | 'yield'
  | 'one_way'
  | 'street_name'
  | 'precinct'
  | 'custom';

export interface MapRoadSignDef {
  id: string;
  style: RoadSignStyle;
  modelRef?: string;
  text: string;
  subtext?: string;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  height?: number;
  collidable?: boolean;
  poleColor?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
}

export interface MapDynamicObjectDef {
  id: string;
  modelRef: string;
  x: number;
  y?: number;
  z: number;
  rotationY?: number;
  scale?: number;
  collidable?: boolean;
  hitboxWidth?: number;
  hitboxDepth?: number;
  label?: string;
  flags?: Record<string, boolean | string | number>;
}

export interface CustomMapAsset {
  format: 'jdata-map-v1' | 'jdata-map-v2' | 'jdata-map-v3';
  id: string;
  version: string;
  name: string;
  description?: string;
  bounds: {
    halfSize: number;
  };
  surfaceHeights: {
    terrain: number;
    road: number;
    sidewalk: number;
    apron: number;
    park: number;
  };
  roadNetwork: {
    roadWidth: number;
    laneOffset: number;
    nodes: MapRoadNodeDef[];
    edges: MapRoadEdgeDef[];
    extraStrips?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  };
  stationExit?: {
    apronPoint: [number, number];
  };
  precinctDoors?: {
    x: number;
    y?: number;
    z: number;
    rotationY?: number;
  };
  stationBays?: StationBayDef[];
  treePalette?: string[];
  trafficCount?: number;
  pedestrianCount?: number;
  defaultWeather?: 'CLEAR' | 'OVERCAST' | 'RAIN' | 'HEAVY_FOG';
  cameraOverview?: {
    pos: [number, number, number];
    target: [number, number, number];
  };
  zones: MapZoneDef[];
  buildings: MapBuildingDef[];
  objects?: MapDynamicObjectDef[];
  signs?: MapRoadSignDef[];
  trees: MapTreeDef[];
  streetlights: MapStreetlightDef[];
  districts: string[];
  pedLoops: MapPedLoopDef[];
}

export interface AudioEnvelopeDef {
  attack: number;
  decay: number;
  duration: number;
  curveExponent?: number;
}

export interface ProceduralAudioAsset {
  format: 'jdata-audio-v1' | 'jdata-audio-v2';
  id: string;
  seed: number;
  kind:
    | 'siren_sweep'
    | 'siren_hilo'
    | 'chirp_sequence'
    | 'filtered_noise_burst'
    | 'audio_clip';
  gain: number;
  siren?: {
    waveform1: OscillatorType;
    waveform2: OscillatorType;
    detuneRatio: number;
    minFreq: number;
    maxFreq: number;
    sweepRateHz: number;
    bandpassFreq: number;
    bandpassQ: number;
    hiloAlternationHz?: number;
  };
  chirp?: {
    waveform: OscillatorType;
    steps: Array<{ time: number; freq: number }>;
    duration: number;
    endGain: number;
  };
  noiseBurst?: {
    duration: number;
    envelope: AudioEnvelopeDef;
    filterType: BiquadFilterType;
    freqStart: number;
    freqEnd: number;
  };
  clip?: {
    mediaId: string;
    playbackRate?: number;
    loop?: boolean;
  };
}

export type AssetIssueSeverity = 'fatal' | 'error';
export type AssetIssueCategory =
  | 'manifest'
  | 'config'
  | 'map'
  | 'material'
  | 'texture'
  | 'model'
  | 'lightbar'
  | 'vehicle'
  | 'audio'
  | 'media';

export interface AssetIssue {
  severity: AssetIssueSeverity;
  category: AssetIssueCategory;
  id: string;
  path: string;
  message: string;
}

export interface LoadedJsonAssets {
  manifest: AssetManifest;
  config: EngineConfigAsset;
  activeMapId: string;
  map: CustomMapAsset;
  maps: Record<string, CustomMapAsset>;
  materials: Record<string, ModelMaterialDef>;
  lightbars: Record<string, LightbarAssetDef>;
  vehicleDefs: Record<string, VehicleAssetDef>;
  textures: Record<string, ProceduralTextureAsset>;
  models: Record<string, ProceduralModelAsset>;
  audio: Record<string, ProceduralAudioAsset>;
  media: Record<string, ImportedMediaAsset>;
}

export interface AssetLoadResult {
  assets: LoadedJsonAssets | null;
  config: EngineConfigAsset | null;
  issues: AssetIssue[];
  fatalError: string | null;
  sourceLabel: string;
}
