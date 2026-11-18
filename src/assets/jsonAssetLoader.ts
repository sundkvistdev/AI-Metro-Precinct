import JSZip from 'jszip';
import {
  AssetIssue,
  AssetLoadResult,
  AssetManifest,
  CustomMapAsset,
  EngineConfigAsset,
  ImportedMediaAsset,
  LightbarAssetDef,
  LoadedJsonAssets,
  MediaKind,
  ModelMaterialDef,
  ProceduralAudioAsset,
  ProceduralModelAsset,
  ProceduralTextureAsset,
  VehicleAssetDef,
} from './assetTypes';
import { simEventLog } from './simEventLog';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createBuiltinDefaultLightbars(): Record<string, LightbarAssetDef> {
  return {
    led_array: {
      format: 'jdata-lightbar-v3',
      id: 'led_array',
      name: 'LED Bar Array',
      hardwareStyle: 'standard_shell',
      patternType: 'led',
      rateMult: 1.0,
      hasTrafficAdvisor: false,
      hasCookies: false,
      hasGrilleStrobes: false,
      hasRearDeck: true,
      leftColor: '#ff2222',
      rightColor: '#2266ff',
      centerColor: '#f8fafc',
      haloOpacity: 0.72,
      pointLightRange: 22,
      pointLightIntensity: 16,
      emitters: [
        { id: 'led_l1', x: 0.28, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#ff2222', emissive: '#ff1a1a', phase: 0.0, duty: 0.36, freqHz: 2.2, mode: 'strobe', group: 'roof' },
        { id: 'led_l2', x: 0.46, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#ff2222', emissive: '#ff1a1a', phase: 0.14, duty: 0.22, freqHz: 2.2, mode: 'strobe', group: 'roof' },
        { id: 'led_l3', x: 0.64, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#ff2222', emissive: '#ff1a1a', phase: 0.0, duty: 0.36, freqHz: 2.2, mode: 'strobe', group: 'roof' },
        { id: 'led_r1', x: -0.28, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#2266ff', emissive: '#1d70ff', phase: 0.48, duty: 0.36, freqHz: 2.27, mode: 'strobe', group: 'roof' },
        { id: 'led_r2', x: -0.46, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#2266ff', emissive: '#1d70ff', phase: 0.62, duty: 0.22, freqHz: 2.27, mode: 'strobe', group: 'roof' },
        { id: 'led_r3', x: -0.64, y: 0.105, z: 0, w: 0.14, h: 0.065, d: 0.24, shape: 'box', color: '#2266ff', emissive: '#1d70ff', phase: 0.48, duty: 0.36, freqHz: 2.27, mode: 'strobe', group: 'roof' },
      ],
    },
    halogen_flash: {
      format: 'jdata-lightbar-v3',
      id: 'halogen_flash',
      name: 'Flashing Halogen',
      hardwareStyle: 'standard_shell',
      patternType: 'flashing_halogen',
      rateMult: 1.0,
      hasTrafficAdvisor: false,
      hasCookies: false,
      hasGrilleStrobes: false,
      hasRearDeck: true,
      leftColor: '#ff2b1a',
      rightColor: '#2563eb',
      centerColor: '#fbbf24',
      haloOpacity: 0.75,
      pointLightRange: 22,
      pointLightIntensity: 16,
      emitters: [
        { id: 'hal_l', x: 0.45, y: 0.105, z: 0, w: 0.12, h: 0.12, d: 0.12, shape: 'sphere', color: '#ff6b4a', emissive: '#ff2b1a', phase: 0.0, duty: 0.5, freqHz: 1.7, mode: 'halogen', group: 'roof' },
        { id: 'hal_r', x: -0.45, y: 0.105, z: 0, w: 0.12, h: 0.12, d: 0.12, shape: 'sphere', color: '#60a5fa', emissive: '#2563eb', phase: 0.5, duty: 0.5, freqHz: 1.75, mode: 'halogen', group: 'roof' },
        { id: 'hal_c', x: 0, y: 0.105, z: 0, w: 0.12, h: 0.12, d: 0.12, shape: 'sphere', color: '#fef3c7', emissive: '#fbbf24', phase: 0.25, duty: 0.4, freqHz: 2.5, mode: 'halogen', group: 'roof' },
      ],
    },
    rotator_classic: {
      format: 'jdata-lightbar-v3',
      id: 'rotator_classic',
      name: 'Classic Rotators',
      hardwareStyle: 'standard_shell',
      patternType: 'rotating_halogen',
      rateMult: 1.0,
      hasTrafficAdvisor: false,
      hasCookies: true,
      hasGrilleStrobes: false,
      hasRearDeck: true,
      leftColor: '#ff2828',
      rightColor: '#2674ff',
      centerColor: '#fff7ed',
      haloOpacity: 0.72,
      pointLightRange: 24,
      pointLightIntensity: 16,
      emitters: [
        { id: 'rot_l', x: 0.45, y: 0.105, z: 0, w: 0.12, h: 0.1, d: 0.12, shape: 'cylinder', color: '#fff7ed', emissive: '#ff2828', phase: 0.0, duty: 1.0, freqHz: 1.8, mode: 'rotator', group: 'roof' },
        { id: 'rot_r', x: -0.45, y: 0.105, z: 0, w: 0.12, h: 0.1, d: 0.12, shape: 'cylinder', color: '#fff7ed', emissive: '#2674ff', phase: 0.35, duty: 1.0, freqHz: 1.95, mode: 'rotator', group: 'roof' },
        { id: 'rot_c', x: 0, y: 0.105, z: 0, w: 0.12, h: 0.1, d: 0.12, shape: 'cylinder', color: '#fff7ed', emissive: '#fbbf24', phase: 0.7, duty: 1.0, freqHz: 1.4, mode: 'rotator', group: 'roof' },
      ],
    },
    vector_v_pods: {
      format: 'jdata-lightbar-v3',
      id: 'vector_v_pods',
      name: 'Vector V-Pods + Advisor',
      hardwareStyle: 'vector_pods',
      patternType: 'vector_pods',
      rateMult: 1.0,
      hasTrafficAdvisor: true,
      hasCookies: false,
      hasGrilleStrobes: false,
      hasRearDeck: true,
      leftColor: '#ff2020',
      rightColor: '#2070ff',
      centerColor: '#ffffff',
      haloOpacity: 0.74,
      pointLightRange: 22,
      pointLightIntensity: 16,
      emitters: [
        { id: 'vec_1', x: 0.66, y: 0.13, z: -0.06, w: 0.12, h: 0.12, d: 0.12, shape: 'cylinder', color: '#c8232c', emissive: '#ff2020', phase: 0.0, duty: 0.45, freqHz: 2.5, mode: 'sweep', group: 'roof' },
        { id: 'vec_2', x: 0.34, y: 0.13, z: 0.06, w: 0.12, h: 0.12, d: 0.12, shape: 'cylinder', color: '#c8232c', emissive: '#ff2828', phase: 0.2, duty: 0.45, freqHz: 2.5, mode: 'sweep', group: 'roof' },
        { id: 'vec_3', x: 0.0, y: 0.13, z: 0.18, w: 0.12, h: 0.12, d: 0.12, shape: 'cylinder', color: '#f8fafc', emissive: '#ffffff', phase: 0.4, duty: 0.45, freqHz: 2.5, mode: 'sweep', group: 'roof' },
        { id: 'vec_4', x: -0.34, y: 0.13, z: 0.06, w: 0.12, h: 0.12, d: 0.12, shape: 'cylinder', color: '#2558c9', emissive: '#2070ff', phase: 0.6, duty: 0.45, freqHz: 2.5, mode: 'sweep', group: 'roof' },
        { id: 'vec_5', x: -0.66, y: 0.13, z: -0.06, w: 0.12, h: 0.12, d: 0.12, shape: 'cylinder', color: '#2558c9', emissive: '#2070ff', phase: 0.8, duty: 0.45, freqHz: 2.5, mode: 'sweep', group: 'roof' },
      ],
    },
    visor_stealth: {
      format: 'jdata-lightbar-v3',
      id: 'visor_stealth',
      name: 'Stealth Visor & Grille',
      hardwareStyle: 'visor_stealth',
      patternType: 'visor_stealth',
      rateMult: 1.05,
      hasTrafficAdvisor: false,
      hasCookies: false,
      hasGrilleStrobes: true,
      hasRearDeck: true,
      leftColor: '#ff2222',
      rightColor: '#2266ff',
      centerColor: '#f8fafc',
      haloOpacity: 0.68,
      pointLightRange: 20,
      pointLightIntensity: 13,
      emitters: [
        { id: 'vis_l1', x: 0.18, y: 0, z: 0.03, w: 0.14, h: 0.05, d: 0.04, shape: 'box', color: '#ff2222', emissive: '#ff1a1a', phase: 0.0, duty: 0.35, freqHz: 3.1, mode: 'strobe', group: 'visor' },
        { id: 'vis_r1', x: -0.18, y: 0, z: 0.03, w: 0.14, h: 0.05, d: 0.04, shape: 'box', color: '#2266ff', emissive: '#1d70ff', phase: 0.5, duty: 0.35, freqHz: 3.1, mode: 'strobe', group: 'visor' },
        { id: 'gr_l', x: 0.24, y: 0, z: 0, w: 0.16, h: 0.055, d: 0.04, shape: 'box', color: '#ff2222', emissive: '#ff2020', phase: 0.0, duty: 0.4, freqHz: 3.1, mode: 'strobe', group: 'grille' },
        { id: 'gr_r', x: -0.24, y: 0, z: 0, w: 0.16, h: 0.055, d: 0.04, shape: 'box', color: '#2266ff', emissive: '#2070ff', phase: 0.5, duty: 0.4, freqHz: 3.1, mode: 'strobe', group: 'grille' },
      ],
    },
    mini_beacon: {
      format: 'jdata-lightbar-v3',
      id: 'mini_beacon',
      name: 'Mini Dual Beacon',
      hardwareStyle: 'mini_beacon',
      patternType: 'mini_beacon',
      rateMult: 1.0,
      hasTrafficAdvisor: false,
      hasCookies: false,
      hasGrilleStrobes: true,
      hasRearDeck: true,
      leftColor: '#ff2828',
      rightColor: '#2674ff',
      centerColor: '#f8fafc',
      haloOpacity: 0.72,
      pointLightRange: 20,
      pointLightIntensity: 15,
      emitters: [
        { id: 'mini_l', x: 0.16, y: 0.11, z: 0, w: 0.19, h: 0.14, d: 0.19, shape: 'cylinder', color: '#c8232c', emissive: '#ff2828', phase: 0.0, duty: 1.0, freqHz: 2.15, mode: 'rotator', group: 'roof' },
        { id: 'mini_r', x: -0.16, y: 0.11, z: 0, w: 0.19, h: 0.14, d: 0.19, shape: 'cylinder', color: '#2558c9', emissive: '#2674ff', phase: 0.4, duty: 1.0, freqHz: 2.26, mode: 'rotator', group: 'roof' },
      ],
    },
  };
}

export function validateEngineConfig(raw: unknown): raw is EngineConfigAsset {
  if (!isObjectRecord(raw)) return false;
  if (
    raw.format !== 'jdata-config-v1' &&
    raw.format !== 'jdata-config-v2' &&
    raw.format !== 'jdata-config-v3'
  ) {
    return false;
  }
  if (!isObjectRecord(raw.world) || !isObjectRecord(raw.simulation) || !isObjectRecord(raw.camera)) {
    return false;
  }
  if (!isObjectRecord(raw.vehicles) || !isObjectRecord(raw.weapons)) {
    return false;
  }
  if (!isObjectRecord(raw.weatherPresets) || !isObjectRecord(raw.backupPolicies)) {
    return false;
  }
  if (
    !isObjectRecord(raw.vehicles.chassis) ||
    !isObjectRecord(raw.vehicles.liveries)
  ) {
    return false;
  }
  for (const weapon of ['pistol', 'rifle'] as const) {
    if (!isObjectRecord(raw.weapons[weapon])) return false;
  }
  for (const weather of ['CLEAR', 'OVERCAST', 'RAIN', 'HEAVY_FOG'] as const) {
    if (!isObjectRecord(raw.weatherPresets[weather])) return false;
  }
  for (const policy of ['MINIMAL', 'STANDARD', 'PERIMETER', 'FULL_SCALE'] as const) {
    if (!isObjectRecord(raw.backupPolicies[policy])) return false;
  }
  return true;
}

export function validateMapAsset(raw: unknown): raw is CustomMapAsset {
  if (!isObjectRecord(raw)) return false;
  if (
    (raw.format !== 'jdata-map-v1' &&
      raw.format !== 'jdata-map-v2' &&
      raw.format !== 'jdata-map-v3') ||
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string'
  ) {
    return false;
  }
  if (!isObjectRecord(raw.bounds) || !isObjectRecord(raw.surfaceHeights) || !isObjectRecord(raw.roadNetwork)) {
    return false;
  }
  if (
    !Array.isArray(raw.roadNetwork.nodes) ||
    !Array.isArray(raw.roadNetwork.edges) ||
    raw.roadNetwork.nodes.length === 0 ||
    !Array.isArray(raw.zones) ||
    !Array.isArray(raw.buildings) ||
    !Array.isArray(raw.trees) ||
    !Array.isArray(raw.streetlights) ||
    !Array.isArray(raw.districts) ||
    !Array.isArray(raw.pedLoops)
  ) {
    return false;
  }
  if (raw.objects !== undefined && !Array.isArray(raw.objects)) return false;
  if (raw.signs !== undefined && !Array.isArray(raw.signs)) return false;
  return true;
}

export function validateTextureAsset(raw: unknown): raw is ProceduralTextureAsset {
  if (!isObjectRecord(raw)) return false;
  return (
    (raw.format === 'jdata-texture-v1' || raw.format === 'jdata-texture-v2') &&
    typeof raw.id === 'string' &&
    typeof raw.width === 'number' &&
    typeof raw.height === 'number' &&
    Array.isArray(raw.layers)
  );
}

export function validateModelAsset(raw: unknown): raw is ProceduralModelAsset {
  if (!isObjectRecord(raw)) return false;
  if (
    (raw.format !== 'jdata-model-v1' && raw.format !== 'jdata-model-v2') ||
    typeof raw.id !== 'string' ||
    !isObjectRecord(raw.materials) ||
    !Array.isArray(raw.parts)
  ) {
    return false;
  }
  if (raw.flags !== undefined && !isObjectRecord(raw.flags)) return false;
  return true;
}

export function validateAudioAsset(raw: unknown): raw is ProceduralAudioAsset {
  if (!isObjectRecord(raw)) return false;
  return (
    (raw.format === 'jdata-audio-v1' || raw.format === 'jdata-audio-v2') &&
    typeof raw.id === 'string' &&
    typeof raw.kind === 'string'
  );
}

export function validateLightbarAsset(raw: unknown): raw is LightbarAssetDef {
  if (!isObjectRecord(raw)) return false;
  return (
    raw.format === 'jdata-lightbar-v3' &&
    typeof raw.id === 'string' &&
    typeof raw.name === 'string' &&
    typeof raw.hardwareStyle === 'string' &&
    typeof raw.patternType === 'string' &&
    Array.isArray(raw.emitters)
  );
}

export function validateVehicleAsset(raw: unknown): raw is VehicleAssetDef {
  if (!isObjectRecord(raw)) return false;
  return (
    raw.format === 'jdata-vehicle-v3' &&
    typeof raw.id === 'string' &&
    typeof raw.vehicleKind === 'string' &&
    typeof raw.modelRef === 'string' &&
    isObjectRecord(raw.chassis)
  );
}

export function validateMaterialsRecord(raw: unknown): raw is Record<string, ModelMaterialDef> {
  if (!isObjectRecord(raw)) return false;
  for (const val of Object.values(raw)) {
    if (!isObjectRecord(val) || typeof val.color !== 'string') return false;
  }
  return true;
}

export function parseSingleModelJson(text: string): ProceduralModelAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateModelAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-model-v1/v2 model asset.');
  }
  return parsed;
}

export function parseSingleTextureJson(text: string): ProceduralTextureAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateTextureAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-texture-v1/v2 texture asset.');
  }
  return parsed;
}

export function parseSingleAudioJson(text: string): ProceduralAudioAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateAudioAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-audio-v1/v2 audio asset.');
  }
  return parsed;
}

export function parseSingleMapJson(text: string): CustomMapAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateMapAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-map-v1/v2/v3 map asset.');
  }
  return parsed;
}

export function parseSingleLightbarJson(text: string): LightbarAssetDef {
  const parsed = JSON.parse(text) as unknown;
  if (!validateLightbarAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-lightbar-v3 lightbar asset.');
  }
  return parsed;
}

export function syncMapOwnedConfig(map: CustomMapAsset, config: EngineConfigAsset): void {
  if (map.stationBays && map.stationBays.length > 0) {
    config.vehicles.stationBays = map.stationBays.map((b) => ({
      ...b,
      parkPos: [...b.parkPos] as [number, number, number],
    }));
  } else if (!map.stationBays && config.vehicles.stationBays?.length) {
    map.stationBays = config.vehicles.stationBays.map((b) => ({
      ...b,
      parkPos: [...b.parkPos] as [number, number, number],
    }));
  }
  if (map.treePalette && map.treePalette.length > 0) {
    config.world.treePalette = [...map.treePalette];
  } else if (!map.treePalette && config.world.treePalette?.length) {
    map.treePalette = [...config.world.treePalette];
  }
  if (typeof map.trafficCount === 'number') {
    config.world.trafficCount = map.trafficCount;
  } else {
    map.trafficCount = config.world.trafficCount;
  }
  if (typeof map.pedestrianCount === 'number') {
    config.world.pedestrianCount = map.pedestrianCount;
  } else {
    map.pedestrianCount = config.world.pedestrianCount;
  }
  if (map.districts && map.districts.length > 0) {
    config.world.districts = [...map.districts];
  }
  config.world.surfaceHeights = { ...map.surfaceHeights };
  config.world.roadWidth = map.roadNetwork.roadWidth;
  config.world.laneOffset = map.roadNetwork.laneOffset;
  config.world.townHalfSize = map.bounds.halfSize;
  if (map.cameraOverview) {
    config.camera.overviewPos = [...map.cameraOverview.pos] as [number, number, number];
    config.camera.overviewTarget = [...map.cameraOverview.target] as [number, number, number];
  } else {
    map.cameraOverview = {
      pos: [...config.camera.overviewPos] as [number, number, number],
      target: [...config.camera.overviewTarget] as [number, number, number],
    };
  }
}

function finalizeConfigNormalization(
  config: EngineConfigAsset,
  vehicleDefs: Record<string, VehicleAssetDef>,
  lightbars: Record<string, LightbarAssetDef>,
  activeMap: CustomMapAsset,
): void {
  // Ensure default lightbars exist
  const defaults = createBuiltinDefaultLightbars();
  for (const [k, def] of Object.entries(defaults)) {
    if (!lightbars[k]) {
      lightbars[k] = def;
    }
  }

  // Merge vehicleDefs chassis into runtime config.vehicles.chassis and synthesize missing vehicleDefs
  for (const veh of Object.values(vehicleDefs)) {
    if (!config.vehicles.chassis[veh.vehicleKind]) {
      config.vehicles.chassis[veh.vehicleKind] = veh.chassis;
    }
  }
  for (const [kind, chassis] of Object.entries(config.vehicles.chassis)) {
    const policeId = `police_${kind}`;
    if (!vehicleDefs[policeId]) {
      vehicleDefs[policeId] = {
        format: 'jdata-vehicle-v3',
        id: policeId,
        role: 'police',
        label: `Police ${kind.toUpperCase()}`,
        vehicleKind: kind,
        modelRef: chassis.modelRef,
        defaultLiveryId: kind === 'van' || kind === 'apc' ? 'tactical_swat' : 'classic_bw',
        defaultLightbarId: 'led_array',
        weaponKind: kind === 'suv' || kind === 'apc' ? 'rifle' : 'pistol',
        isHeavyUnit: kind === 'apc',
        chassis,
      };
    }
  }

  if (!Array.isArray(config.world.roadCoords)) config.world.roadCoords = [-150, -75, 0, 75, 150];
  if (!Array.isArray(config.world.blockCenters)) config.world.blockCenters = [-112.5, -37.5, 37.5, 112.5];
  if (!Array.isArray(config.world.civilianVariants)) config.world.civilianVariants = ['sedan', 'hatch', 'taxi', 'van'];
  if (!Array.isArray(config.world.civilianColors)) config.world.civilianColors = ['#94a3b8', '#3b82f6', '#10b981'];
  if (!Array.isArray(config.world.getawayColors)) config.world.getawayColors = ['#991b1b', '#1e293b', '#7c2d12'];
  if (!Array.isArray(config.world.pedestrianShirtColors)) config.world.pedestrianShirtColors = ['#475569', '#0f766e'];
  if (!Array.isArray(config.vehicles.stationBays)) config.vehicles.stationBays = [];

  if (!config.physics) {
    config.physics = {
      defaultMaxPhysicsParts: 120,
      debrisRestitution: 0.36,
      debrisHumanImpactSpeed: 6.2,
    };
  }
  if (!config.aiGoals) {
    config.aiGoals = {
      police: [
        { id: 'AWAIT_TOW', label: 'Await Roadside Recovery', enabled: true, priority: 100 },
        { id: 'RETREAT_TO_PRECINCT', label: 'Retreat / Casualties', enabled: true, priority: 90 },
        { id: 'MANUAL_FOOT_PATROL', label: 'Free-Roam Patrol / Combat', enabled: true, priority: 80 },
        { id: 'DISMOUNT_COMBAT', label: 'Dismount & Engage Foot Target', enabled: true, priority: 75, params: { dismountDist: 22 } },
        { id: 'PURSUE_INTERCEPT', label: 'Vehicle Pursuit & PIT', enabled: true, priority: 70, params: { ramRange: 20 } },
        { id: 'DEPLOY_NAIL_MAT', label: 'Deploy Road Spike Strip', enabled: true, priority: 65 },
        { id: 'RESPOND_TO_CALL', label: 'Code-3 Respond to Scene', enabled: true, priority: 60, params: { approachDist: 16 } },
        { id: 'BOARD_CRUISER', label: 'Board Vehicle After Scene', enabled: true, priority: 50 },
        { id: 'RETURN_TO_PRECINCT', label: 'RTB & Park in Station Bay', enabled: true, priority: 35 },
        { id: 'PARKED_STANDBY', label: 'Standby at Precinct', enabled: true, priority: 10 },
      ],
      pedestrian: [
        { id: 'RAGDOLL_INCAPACITATED', label: 'Ragdoll / Downed', enabled: true, priority: 100 },
        { id: 'EVADE_VEHICLE', label: 'Dodge & Dive Approaching Vehicle', enabled: true, priority: 90, params: { ttcHorizon: 1.85, detectRadius: 22, sprintSpeed: 6.4, jumpThresholdTtc: 0.95 } },
        { id: 'FLEE_THREAT', label: 'Flee Active Shootout', enabled: true, priority: 75, params: { fleeRadius: 34, fleeSpeed: 5.2 } },
        { id: 'AVOID_OBSTACLE', label: 'Avoid Pedestrians & Obstacles', enabled: true, priority: 55, params: { crowdRadius: 1.65, lookahead: 2.4 } },
        { id: 'SIDEWALK_STROLL', label: 'Normal Sidewalk Patrol', enabled: true, priority: 20, params: { walkSpeed: 1.8 } },
      ],
    };
  }
  if (!config.world.buildingModels) {
    config.world.buildingModels = {
      storefront: 'building_storefront',
      brick: 'building_brick',
      concrete: 'building_concrete',
      limestone: 'building_limestone',
      office: 'building_office',
      station_hall: 'building_station_hall',
      station_glass: 'building_station_glass',
      trim: 'building_trim',
      fountain: 'prop_fountain',
      sign: 'prop_sign',
      beacon: 'prop_beacon',
    };
  }
  if (!config.world.propModels) {
    config.world.propModels = {
      tree: 'prop_tree',
      streetlight: 'prop_streetlight',
      fountain: 'prop_fountain',
      sign: 'prop_sign',
      beacon: 'prop_beacon',
      roadSign: 'prop_road_sign',
    };
  }

  syncMapOwnedConfig(activeMap, config);
}

function logAssetIssue(issue: AssetIssue): void {
  const prefix = issue.severity === 'fatal' ? '[FATAL ASSET ERROR]' : '[ASSET ERROR]';
  console.error(`${prefix} (${issue.category}:${issue.id}) ${issue.path} -> ${issue.message}`);
  simEventLog.log(
    issue.severity === 'fatal' ? 'fatal' : 'error',
    'asset',
    `${issue.category}:${issue.id}`,
    issue.message,
    issue.path,
  );
}

async function fetchJsonStrict<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} loading ${url}`);
  }
  return (await res.json()) as T;
}

function guessMimeType(path: string, kind: MediaKind, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  const lower = path.toLowerCase();
  if (kind === 'image') {
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'image/png';
  }
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/wav';
}

function sanitizeMediaId(rawName: string): string {
  const base = rawName.replace(/\.[^/.]+$/, '').toLowerCase();
  const clean = base.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || `media_${Date.now()}`;
}

function decodeImageElement(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image asset'));
    img.src = objectUrl;
  });
}

async function createMediaAssetFromBytes(
  id: string,
  kind: MediaKind,
  path: string,
  bytes: Uint8Array,
  mimeType?: string,
  filename?: string,
): Promise<ImportedMediaAsset> {
  const resolvedMime = guessMimeType(path, kind, mimeType);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: resolvedMime });
  const objectUrl = URL.createObjectURL(blob);
  const asset: ImportedMediaAsset = {
    id,
    kind,
    path,
    mimeType: resolvedMime,
    bytes: copy,
    objectUrl,
    filename: filename ?? path.split('/').pop() ?? `${id}.${kind === 'image' ? 'png' : 'wav'}`,
  };
  if (kind === 'image') {
    const img = await decodeImageElement(objectUrl);
    asset.imageElement = img;
    asset.width = img.naturalWidth || img.width;
    asset.height = img.naturalHeight || img.height;
  }
  return asset;
}

export async function importMediaImageFile(
  file: File,
  customId?: string,
): Promise<ImportedMediaAsset> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const id = customId || sanitizeMediaId(file.name);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `media/${id}.${ext}`;
  return await createMediaAssetFromBytes(id, 'image', path, bytes, file.type, file.name);
}

export async function importMediaAudioFile(
  file: File,
  customId?: string,
): Promise<ImportedMediaAsset> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const id = customId || sanitizeMediaId(file.name);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'wav';
  const path = `media/${id}.${ext}`;
  return await createMediaAssetFromBytes(id, 'audio', path, bytes, file.type, file.name);
}

export function revokeMediaObjectUrls(media: Record<string, ImportedMediaAsset>): void {
  for (const item of Object.values(media)) {
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }
  }
}

export async function loadJsonAssetBundle(
  manifestUrl = '/jdataassets/manifest.json',
): Promise<AssetLoadResult> {
  const issues: AssetIssue[] = [];

  let manifest: AssetManifest;
  try {
    manifest = await fetchJsonStrict<AssetManifest>(manifestUrl);
    if (!isObjectRecord(manifest) || typeof manifest.config !== 'string') {
      throw new Error('Manifest missing required "config" JSON reference.');
    }
    if (typeof manifest.map !== 'string' && (!isObjectRecord(manifest.maps) || Object.keys(manifest.maps).length === 0)) {
      throw new Error('Manifest missing required "map" or "maps" JSON reference.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: manifestUrl,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Manifest Failure (${manifestUrl}): ${msg}`,
      sourceLabel: manifestUrl,
    };
  }

  let config: EngineConfigAsset;
  try {
    const rawConfig = await fetchJsonStrict<unknown>(manifest.config);
    if (!validateEngineConfig(rawConfig)) {
      throw new Error('Engine config JSON failed schema validation (missing required sections).');
    }
    config = rawConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Failure (${manifest.config}): ${msg}`,
      sourceLabel: manifest.packName || manifestUrl,
    };
  }

  const maps: Record<string, CustomMapAsset> = {};
  const mapPathsToLoad: Record<string, string> = {};
  if (isObjectRecord(manifest.maps)) {
    for (const [k, v] of Object.entries(manifest.maps)) {
      if (typeof v === 'string') mapPathsToLoad[k] = v;
    }
  }
  if (typeof manifest.map === 'string' && manifest.map.trim()) {
    const primaryKey = manifest.defaultMap || 'metro_default';
    if (!Object.values(mapPathsToLoad).includes(manifest.map)) {
      mapPathsToLoad[primaryKey] = manifest.map;
    }
  }

  await Promise.all(
    Object.entries(mapPathsToLoad).map(async ([mapKey, mapPath]) => {
      try {
        const rawMap = await fetchJsonStrict<unknown>(mapPath);
        if (!validateMapAsset(rawMap)) {
          throw new Error('Map JSON failed schema validation.');
        }
        const resolvedId = rawMap.id || mapKey;
        maps[resolvedId] = rawMap;
      } catch (err) {
        const issue: AssetIssue = {
          severity: 'error',
          category: 'map',
          id: mapKey,
          path: mapPath,
          message: err instanceof Error ? err.message : String(err),
        };
        logAssetIssue(issue);
        issues.push(issue);
      }
    }),
  );

  const mapIds = Object.keys(maps);
  if (mapIds.length === 0) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'map',
      id: 'world_map',
      path: manifest.map || manifestUrl,
      message: 'Failed to load any valid map JSON.',
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config,
      issues,
      fatalError: `Fatal Map Failure: no playable maps loaded from ${manifest.packName || manifestUrl}.`,
      sourceLabel: manifest.packName || manifestUrl,
    };
  }

  const activeMapId =
    manifest.defaultMap && maps[manifest.defaultMap] ? manifest.defaultMap : mapIds[0];
  const map = maps[activeMapId];

  const materials: Record<string, ModelMaterialDef> = {};
  if (typeof manifest.materials === 'string' && manifest.materials.trim()) {
    try {
      const rawMats = await fetchJsonStrict<unknown>(manifest.materials);
      if (!validateMaterialsRecord(rawMats)) {
        throw new Error('Invalid shared materials JSON format.');
      }
      Object.assign(materials, rawMats);
    } catch (err) {
      const issue: AssetIssue = {
        severity: 'error',
        category: 'material',
        id: 'materials',
        path: manifest.materials,
        message: err instanceof Error ? err.message : String(err),
      };
      logAssetIssue(issue);
      issues.push(issue);
    }
  }

  const lightbars: Record<string, LightbarAssetDef> = {};
  const vehicleDefs: Record<string, VehicleAssetDef> = {};
  const textures: Record<string, ProceduralTextureAsset> = {};
  const models: Record<string, ProceduralModelAsset> = {};
  const audio: Record<string, ProceduralAudioAsset> = {};
  const media: Record<string, ImportedMediaAsset> = {};

  await Promise.all([
    Promise.all(
      Object.entries(manifest.lightbars ?? {}).map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateLightbarAsset(data)) throw new Error('Invalid jdata-lightbar-v3 format.');
          lightbars[data.id || key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'lightbar',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.vehicles ?? {}).map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateVehicleAsset(data)) throw new Error('Invalid jdata-vehicle-v3 format.');
          vehicleDefs[data.id || key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'vehicle',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.textures ?? {}).map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateTextureAsset(data)) throw new Error('Invalid jdata-texture format.');
          textures[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'texture',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.models ?? {}).map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateModelAsset(data)) throw new Error('Invalid jdata-model format.');
          models[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'model',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta cube fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.audio ?? {}).map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateAudioAsset(data)) throw new Error('Invalid jdata-audio format.');
          audio[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'audio',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.media ?? {}).map(async ([key, meta]) => {
        try {
          const res = await fetch(meta.path, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status} loading media ${meta.path}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          media[key] = await createMediaAssetFromBytes(
            key,
            meta.kind,
            meta.path,
            bytes,
            meta.mimeType,
            meta.filename,
          );
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'media',
            id: key,
            path: meta.path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
  ]);

  finalizeConfigNormalization(config, vehicleDefs, lightbars, map);
  simEventLog.info(
    'asset',
    'Pack Loaded',
    `Loaded "${manifest.packName}" (${manifest.formatVersion}) with ${mapIds.length} map(s), ${Object.keys(lightbars).length} lightbar(s).`,
    manifestUrl,
  );

  return {
    assets: {
      manifest,
      config,
      activeMapId,
      map,
      maps,
      materials,
      lightbars,
      vehicleDefs,
      textures,
      models,
      audio,
      media,
    },
    config,
    issues,
    fatalError: null,
    sourceLabel: `Built-in (${manifest.packName} v${manifest.formatVersion})`,
  };
}

function normalizeZipLookupCandidates(manifestDir: string, assetPath: string): string[] {
  const clean = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const strippedPrefix = clean.replace(/^jdataassets\//, '');
  const candidates = new Set<string>([
    clean,
    strippedPrefix,
    manifestDir ? `${manifestDir}/${clean}` : clean,
    manifestDir ? `${manifestDir}/${strippedPrefix}` : strippedPrefix,
  ]);
  const basename = clean.split('/').pop();
  if (basename) {
    candidates.add(basename);
  }
  return Array.from(candidates);
}

function findZipEntry(
  zip: JSZip,
  manifestDir: string,
  assetPath: string,
): JSZip.JSZipObject | null {
  const candidates = normalizeZipLookupCandidates(manifestDir, assetPath);
  for (const c of candidates) {
    const direct = zip.file(c);
    if (direct && !direct.dir) return direct;
  }

  const cleanLower = assetPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const strippedLower = cleanLower.replace(/^jdataassets\//, '');
  let matched: JSZip.JSZipObject | null = null;
  zip.forEach((relativePath, entry) => {
    if (matched || entry.dir) return;
    const norm = relativePath.replace(/\\/g, '/').toLowerCase();
    if (
      norm.endsWith(`/${cleanLower}`) ||
      norm === cleanLower ||
      norm.endsWith(`/${strippedLower}`) ||
      norm === strippedLower
    ) {
      matched = entry;
    }
  });
  return matched;
}

export async function loadJsonAssetBundleFromZip(file: File): Promise<AssetLoadResult> {
  const issues: AssetIssue[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'zip_archive',
      path: file.name,
      message: `Unable to open ZIP archive: ${msg}`,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal ZIP Error (${file.name}): ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let manifestEntry: JSZip.JSZipObject | null = zip.file('manifest.json');
  let manifestDir = '';
  if (!manifestEntry) {
    zip.forEach((relPath, entry) => {
      if (manifestEntry || entry.dir) return;
      if (
        relPath.replace(/\\/g, '/').toLowerCase().endsWith('/manifest.json') ||
        relPath.toLowerCase() === 'manifest.json'
      ) {
        manifestEntry = entry;
        const idx = relPath.lastIndexOf('/');
        manifestDir = idx >= 0 ? relPath.slice(0, idx) : '';
      }
    });
  }

  if (!manifestEntry) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: `${file.name}/manifest.json`,
      message: 'ZIP pack does not contain a manifest.json file.',
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Pack Error: "${file.name}" is missing manifest.json.`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let manifest: AssetManifest;
  try {
    const rawText = await manifestEntry.async('string');
    manifest = JSON.parse(rawText) as AssetManifest;
    if (!isObjectRecord(manifest) || typeof manifest.config !== 'string') {
      throw new Error('Manifest inside ZIP is missing required "config" path.');
    }
    if (typeof manifest.map !== 'string' && (!isObjectRecord(manifest.maps) || Object.keys(manifest.maps).length === 0)) {
      throw new Error('Manifest inside ZIP is missing required "map" or "maps" path.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: `${file.name}/manifest.json`,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Manifest Error in "${file.name}": ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let config: EngineConfigAsset;
  const configEntry = findZipEntry(zip, manifestDir, manifest.config);
  if (!configEntry) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: `Missing required engine config file "${manifest.config}" inside ZIP.`,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Missing in "${file.name}": ${manifest.config}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  try {
    const rawConfig = JSON.parse(await configEntry.async('string')) as unknown;
    if (!validateEngineConfig(rawConfig)) {
      throw new Error('Engine config inside ZIP failed schema validation.');
    }
    config = rawConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Error in "${file.name}": ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  const maps: Record<string, CustomMapAsset> = {};
  const mapPathsToLoad: Record<string, string> = {};
  if (isObjectRecord(manifest.maps)) {
    for (const [k, v] of Object.entries(manifest.maps)) {
      if (typeof v === 'string') mapPathsToLoad[k] = v;
    }
  }
  if (typeof manifest.map === 'string' && manifest.map.trim()) {
    const primaryKey = manifest.defaultMap || 'metro_default';
    if (!Object.values(mapPathsToLoad).includes(manifest.map)) {
      mapPathsToLoad[primaryKey] = manifest.map;
    }
  }

  await Promise.all(
    Object.entries(mapPathsToLoad).map(async ([mapKey, mapPath]) => {
      try {
        const entry = findZipEntry(zip, manifestDir, mapPath);
        if (!entry) throw new Error(`Map "${mapPath}" not found in ZIP.`);
        const rawMap = JSON.parse(await entry.async('string')) as unknown;
        if (!validateMapAsset(rawMap)) throw new Error('Invalid map JSON schema.');
        const resolvedId = rawMap.id || mapKey;
        maps[resolvedId] = rawMap;
      } catch (err) {
        const issue: AssetIssue = {
          severity: 'error',
          category: 'map',
          id: mapKey,
          path: mapPath,
          message: err instanceof Error ? err.message : String(err),
        };
        logAssetIssue(issue);
        issues.push(issue);
      }
    }),
  );

  const mapIds = Object.keys(maps);
  if (mapIds.length === 0) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'map',
      id: 'world_map',
      path: manifest.map || file.name,
      message: 'No valid map files could be loaded from ZIP.',
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config,
      issues,
      fatalError: `Fatal Map Error in "${file.name}": no valid maps loaded.`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  const activeMapId =
    manifest.defaultMap && maps[manifest.defaultMap] ? manifest.defaultMap : mapIds[0];
  const map = maps[activeMapId];

  const materials: Record<string, ModelMaterialDef> = {};
  if (typeof manifest.materials === 'string' && manifest.materials.trim()) {
    try {
      const matEntry = findZipEntry(zip, manifestDir, manifest.materials);
      if (matEntry) {
        const parsed = JSON.parse(await matEntry.async('string')) as unknown;
        if (!validateMaterialsRecord(parsed)) throw new Error('Invalid materials JSON schema');
        Object.assign(materials, parsed);
      }
    } catch (err) {
      const issue: AssetIssue = {
        severity: 'error',
        category: 'material',
        id: 'materials',
        path: manifest.materials,
        message: err instanceof Error ? err.message : String(err),
      };
      logAssetIssue(issue);
      issues.push(issue);
    }
  }

  const lightbars: Record<string, LightbarAssetDef> = {};
  const vehicleDefs: Record<string, VehicleAssetDef> = {};
  const textures: Record<string, ProceduralTextureAsset> = {};
  const models: Record<string, ProceduralModelAsset> = {};
  const audio: Record<string, ProceduralAudioAsset> = {};
  const media: Record<string, ImportedMediaAsset> = {};

  await Promise.all([
    Promise.all(
      Object.entries(manifest.lightbars ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateLightbarAsset(parsed)) throw new Error('Invalid lightbar JSON schema');
          lightbars[parsed.id || key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'lightbar',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.vehicles ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateVehicleAsset(parsed)) throw new Error('Invalid vehicle JSON schema');
          vehicleDefs[parsed.id || key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'vehicle',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.textures ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateTextureAsset(parsed)) throw new Error('Invalid texture JSON schema');
          textures[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'texture',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.models ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateModelAsset(parsed)) throw new Error('Invalid model JSON schema');
          models[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'model',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta cube fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.audio ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateAudioAsset(parsed)) throw new Error('Invalid audio JSON schema');
          audio[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'audio',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.media ?? {}).map(async ([key, meta]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, meta.path);
          if (!entry) throw new Error(`Media "${meta.path}" not found in ZIP`);
          const bytes = await entry.async('uint8array');
          media[key] = await createMediaAssetFromBytes(
            key,
            meta.kind,
            meta.path,
            bytes,
            meta.mimeType,
            meta.filename,
          );
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'media',
            id: key,
            path: meta.path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
  ]);

  finalizeConfigNormalization(config, vehicleDefs, lightbars, map);
  simEventLog.info(
    'asset',
    'ZIP Pack Imported',
    `Imported "${manifest.packName}" from ${file.name} (${mapIds.length} map(s)).`,
    file.name,
  );

  return {
    assets: {
      manifest,
      config,
      activeMapId,
      map,
      maps,
      materials,
      lightbars,
      vehicleDefs,
      textures,
      models,
      audio,
      media,
    },
    config,
    issues,
    fatalError: null,
    sourceLabel: `ZIP: ${file.name} (${manifest.packName})`,
  };
}

export async function exportAssetBundleToZip(assets: LoadedJsonAssets): Promise<Blob> {
  const zip = new JSZip();

  syncMapOwnedConfig(assets.map, assets.config);
  const allMaps: Record<string, CustomMapAsset> = {
    ...assets.maps,
    [assets.activeMapId || assets.map.id]: assets.map,
  };
  const primaryId = assets.activeMapId || assets.map.id || Object.keys(allMaps)[0] || 'metro_default';
  const primaryMapRel = `maps/${primaryId}.json`;

  const hasMaterials = Object.keys(assets.materials ?? {}).length > 0;
  const hasMedia = Object.keys(assets.media ?? {}).length > 0;
  const hasLightbars = Object.keys(assets.lightbars ?? {}).length > 0;
  const hasVehicles = Object.keys(assets.vehicleDefs ?? {}).length > 0;

  const exportedManifest: AssetManifest = {
    formatVersion: '1.5.0',
    packName: assets.manifest.packName,
    config: 'engine_config.json',
    map: primaryMapRel,
    defaultMap: primaryId,
    maps: {},
    ...(hasMaterials ? { materials: 'materials.json' } : {}),
    ...(hasLightbars ? { lightbars: {} } : {}),
    ...(hasVehicles ? { vehicles: {} } : {}),
    textures: {},
    models: {},
    audio: {},
    ...(hasMedia ? { media: {} } : {}),
  };

  const exportedConfig: EngineConfigAsset = {
    ...assets.config,
    format: 'jdata-config-v3',
    version: '1.5.0',
  };
  zip.file('engine_config.json', JSON.stringify(exportedConfig, null, 2));

  for (const [id, mapAsset] of Object.entries(allMaps)) {
    const rel = `maps/${id}.json`;
    exportedManifest.maps![id] = rel;
    zip.file(rel, JSON.stringify({ ...mapAsset, format: 'jdata-map-v3' }, null, 2));
  }

  if (hasMaterials) {
    zip.file('materials.json', JSON.stringify(assets.materials, null, 2));
  }

  if (hasLightbars && exportedManifest.lightbars) {
    for (const [id, lb] of Object.entries(assets.lightbars)) {
      const rel = `lightbars/${id}.json`;
      exportedManifest.lightbars[id] = rel;
      zip.file(rel, JSON.stringify({ ...lb, format: 'jdata-lightbar-v3' }, null, 2));
    }
  }

  if (hasVehicles && exportedManifest.vehicles) {
    for (const [id, veh] of Object.entries(assets.vehicleDefs)) {
      const rel = `vehicles/${id}.json`;
      exportedManifest.vehicles[id] = rel;
      zip.file(rel, JSON.stringify({ ...veh, format: 'jdata-vehicle-v3' }, null, 2));
    }
  }

  for (const [id, tex] of Object.entries(assets.textures)) {
    const rel = `textures/${id}.json`;
    exportedManifest.textures[id] = rel;
    zip.file(rel, JSON.stringify(tex, null, 2));
  }

  for (const [id, model] of Object.entries(assets.models)) {
    const rel = `models/${id}.json`;
    exportedManifest.models[id] = rel;
    zip.file(rel, JSON.stringify(model, null, 2));
  }

  for (const [id, audio] of Object.entries(assets.audio)) {
    const rel = `audio/${id}.json`;
    exportedManifest.audio[id] = rel;
    zip.file(rel, JSON.stringify(audio, null, 2));
  }

  if (hasMedia && exportedManifest.media) {
    for (const [id, item] of Object.entries(assets.media)) {
      const safeName = (item.filename || `${id}.${item.kind === 'image' ? 'png' : 'wav'}`)
        .replace(/[^a-zA-Z0-9._-]+/g, '_');
      const rel = item.path.startsWith('media/') ? item.path : `media/${safeName}`;
      exportedManifest.media[id] = {
        kind: item.kind,
        path: rel,
        mimeType: item.mimeType,
        filename: item.filename,
      };
      zip.file(rel, item.bytes);
    }
  }

  zip.file('manifest.json', JSON.stringify(exportedManifest, null, 2));
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
