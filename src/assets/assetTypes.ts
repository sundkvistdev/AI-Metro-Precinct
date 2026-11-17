export interface AssetManifest {
  formatVersion: string;
  packName: string;
  config: string;
  textures: Record<string, string>;
  models: Record<string, string>;
  audio: Record<string, string>;
}

export interface EngineConfigAsset {
  format: 'jdata-config-v1';
  version: string;
  world: {
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
    civilianVariants: Array<'sedan' | 'hatch' | 'taxi' | 'van'>;
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
    chassis: Record<
      'sedan' | 'suv' | 'van' | 'apc',
      {
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
    >;
    stationBays: Array<{
      id: string;
      callsign: string;
      vehicleKind: 'sedan' | 'suv' | 'van' | 'apc';
      liveryId: string;
      weaponKind: 'pistol' | 'rifle';
      isHeavyUnit: boolean;
      parkPos: [number, number, number];
      parkYaw: number;
      exitRoadNodeId: number;
    }>;
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
    };

export interface ProceduralTextureAsset {
  format: 'jdata-texture-v1';
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

export interface ModelPartDef {
  id: string;
  tag?: string;
  kind: 'group' | 'box' | 'cylinder' | 'sphere' | 'plane';
  dimensions?: [number, number, number];
  radiusSegments?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  materialRef?: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
  visible?: boolean;
  children?: ModelPartDef[];
}

export interface ProceduralModelAsset {
  format: 'jdata-model-v1';
  id: string;
  seed: number;
  materials: Record<string, ModelMaterialDef>;
  parts: ModelPartDef[];
}

export interface AudioEnvelopeDef {
  attack: number;
  decay: number;
  duration: number;
  curveExponent?: number;
}

export interface ProceduralAudioAsset {
  format: 'jdata-audio-v1';
  id: string;
  seed: number;
  kind: 'siren_sweep' | 'siren_hilo' | 'chirp_sequence' | 'filtered_noise_burst';
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
}

export type AssetIssueSeverity = 'fatal' | 'error';
export type AssetIssueCategory =
  | 'manifest'
  | 'config'
  | 'texture'
  | 'model'
  | 'audio';

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
  textures: Record<string, ProceduralTextureAsset>;
  models: Record<string, ProceduralModelAsset>;
  audio: Record<string, ProceduralAudioAsset>;
}

export interface AssetLoadResult {
  assets: LoadedJsonAssets | null;
  config: EngineConfigAsset | null;
  issues: AssetIssue[];
  fatalError: string | null;
  sourceLabel: string;
}
