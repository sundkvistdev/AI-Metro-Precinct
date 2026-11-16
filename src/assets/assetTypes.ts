export interface AssetManifest {
  formatVersion: string;
  packName: string;
  textures: Record<string, string>;
  models: Record<string, string>;
  audio: Record<string, string>;
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

export interface LoadedJsonAssets {
  manifest: AssetManifest;
  textures: Record<string, ProceduralTextureAsset>;
  models: Record<string, ProceduralModelAsset>;
  audio: Record<string, ProceduralAudioAsset>;
}
