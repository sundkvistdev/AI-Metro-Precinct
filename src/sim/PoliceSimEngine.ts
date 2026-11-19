import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AssetIssue,
  AssetLoadResult,
  EngineConfigAsset,
  LoadedJsonAssets,
} from '../assets/assetTypes';
import { loadJsonAssetBundle, revokeMediaObjectUrls, syncMapOwnedConfig } from '../assets/jsonAssetLoader';
import { JsonAudioSynth, AudioVoiceQuality } from '../assets/jsonAudioSynth';
import { isExperimentalComplexMeshesEnabled, setExperimentalComplexMeshesEnabled } from '../assets/jsonModelBuilder';
import { mulberry32 } from '../assets/prng';
import { simEventLog } from '../assets/simEventLog';
import { TextureRegistry } from '../assets/textureRegistry';
import {
  evaluateCrimeBackupPolicy,
  getCrimeUnitCounts,
  requestManualBackup,
  requestManualNailMat,
} from './backupSystem';
import { StaticObstacleBVH } from './bvh';
import { SimCameraController } from './cameraController';
import { CombatSystem, VehicleHumanoidCollider } from './combatSystem';
import { promoteCivilianToPursuit, spawnCrime, updateCrimes } from './crimeSystem';
import { AIDebugVisualizer } from './debugVisualizer';
import { DevEditorController, DevEditorState } from './devEditorController';
import { eventBindingStore, playBoundAudioEvent } from './eventBindings';
import { keybindStore } from './keybinds';
import { assetIdToLightbarMode, lightbarModeToAssetId } from './lightbarSystem';
import { updateNailMats } from './nailMatSystem';
import {
  assignOfficerToUnitSeat,
  buildAllVehicleProxies,
  dismountUnit,
  ejectOfficerFromSeat,
  resetOfficerPose,
  spawnPoliceUnits,
  updatePoliceUnits,
} from './policeUnitSystem';
import { getSurfaceHeight, TownRoadGraph } from './roadGraph';
import { disposeGroupContents, SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  AssailantActor,
  CivilianVehicle,
  NailMatActor,
  OfficerActor,
  PedestrianActor,
  PoliceUnit,
  resolveCrimePrimaryAssailant,
  resolveUnitOfficers,
} from './simActors';
import {
  buildTownEnvironment,
  getPrecinctDoorPos,
  stepBreakableProps,
  TownEnvironmentHandles,
  triggerBreakablePropFall,
} from './townBuilder';
import {
  spawnCivilianTraffic,
  spawnPedestrians,
  updateCivilianTraffic,
  updatePedestrians,
} from './trafficSystem';
import {
  AIDebugFlags,
  AIDebugStats,
  BackupMode,
  CameraMode,
  CaseAssignedUnitBadge,
  CrimeSummary,
  DrivingMode,
  LightbarMode,
  PaintSwatchSummary,
  PoliceVehicleKind,
  SimSnapshot,
  SirenPattern,
  UnitStatus,
  WeatherCondition,
  WorldEntityKind,
  WorldEntitySummary,
} from './types';
import {
  createCivilianCar,
  createHumanoid,
  createPoliceCruiser,
  disposeLiveryTextureCache,
} from './vehicleModels';
import {
  createVehicleDynState,
  DebrisHumanoidTarget,
  VehicleCollisionEntry,
  VehicleCrashPhysicsSystem,
} from './vehiclePhysics';
import { createRagdollState, SimVfxManager, triggerRagdoll } from './vfx';
import { WeatherSystem } from './weatherSystem';

const _camFwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

export interface PoliceSimInitialSettings {
  initialMapId?: string;
  audioEnabled?: boolean;
  audioVolume?: number;
  audioQuality?: AudioVoiceQuality;
  simSpeed?: 1 | 2;
  weather?: WeatherCondition;
  backupMode?: BackupMode;
  drivingMode?: DrivingMode;
  lightbarMode?: LightbarMode;
  activeLightbarId?: string;
  sirenPattern?: SirenPattern;
  trafficScale?: number;
  pedScale?: number;
  crimeProbability?: number;
  cowardiceLevel?: number;
  shadowsEnabled?: boolean;
  debrisObstacles?: boolean;
  renderScale?: 0.75 | 1 | 1.5;
  crashIntensity?: number;
  maxPhysicsParts?: number;
  experimentalComplexMeshes?: boolean;
}

export class PoliceSimEngine {
  private container: HTMLElement;
  private onSnapshot: (snap: SimSnapshot) => void;
  private onWebGLContextLost: (lost: boolean) => void;
  private onDevState?: (state: DevEditorState) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private hierarchy: SceneWorldHierarchy;

  private assets: LoadedJsonAssets | null = null;
  private config: EngineConfigAsset | null = null;
  private textures: TextureRegistry | null = null;
  private audio: JsonAudioSynth | null = null;
  private envHandles: TownEnvironmentHandles | null = null;

  private staticBvh = new StaticObstacleBVH();
  private roadGraph: TownRoadGraph | null = null;
  private simRng = mulberry32(20261116);

  private vfx: SimVfxManager;
  private combat: CombatSystem;
  private crashPhysics: VehicleCrashPhysicsSystem;
  private weatherSystem: WeatherSystem;
  private cameraController: SimCameraController | null = null;
  private devEditor: DevEditorController | null = null;
  private aiDebugVisualizer: AIDebugVisualizer;
  private aiDebugFlags: AIDebugFlags = {
    showPolicePaths: false,
    showPursuitPaths: false,
    showTrafficRoutes: false,
    showNodesAndPriority: false,
    showAvoidanceAndStuck: false,
  };

  private units: PoliceUnit[] = [];
  private officers: OfficerActor[] = [];
  private assailants: AssailantActor[] = [];
  private crimes: ActiveCrime[] = [];
  private nailMats: NailMatActor[] = [];
  private civilianCars: CivilianVehicle[] = [];
  private pedestrians: PedestrianActor[] = [];
  private clickables: THREE.Object3D[] = [];
  private paintPalette: PaintSwatchSummary[] = [];
  private standaloneActorSeq = 1;

  private lightbarMode: LightbarMode = LightbarMode.LED;
  private activeLightbarId = 'led_array';
  private pendingMapId: string | undefined;
  private sirenPattern: SirenPattern = SirenPattern.AutoCycle;
  private drivingMode: DrivingMode = DrivingMode.Standard;
  private backupMode: BackupMode = BackupMode.Standard;
  private weather: WeatherCondition = WeatherCondition.Clear;
  private selectedUnitId = 'unit-1';
  private crimeProbability = 0.25;
  private cowardiceLevel = 0.35;
  private customCrimeProb: number | undefined;
  private customCowardice: number | undefined;
  private audioWanted = true;
  private audioVolume = 0.85;
  private audioQuality: AudioVoiceQuality = 'normal';
  private trafficScale = 1.0;
  private pedScale = 1.0;
  private shadowsEnabled = true;
  private debrisObstacles = true;
  private renderScale: 0.75 | 1 | 1.5 = 1;
  private crashIntensity = 1.0;
  private maxPhysicsParts = 42;
  private customMaxPhysicsParts: number | undefined;
  private experimentalComplexMeshes = false;
  private simSpeed: 1 | 2 = 1;
  private neutralizedCount = 0;
  private casualtyCount = 0;

  private crimeCheckAccum = 0;
  private crimeCooldownTimer = 0;
  private crimeCounter = 1;
  private simTime = 0;
  private snapshotAccum = 0;
  private initialCrimeTriggered = false;
  private assetsLoaded = false;

  private assetSourceLabel = 'Unloaded';
  private assetIssues: AssetIssue[] = [];
  private fatalError: string | null = null;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onSnapshot: (snap: SimSnapshot) => void,
    onWebGLContextLost: (lost: boolean) => void,
    initialAssetResult?: AssetLoadResult,
    initialSettings?: PoliceSimInitialSettings,
    onDevState?: (state: DevEditorState) => void,
  ) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    this.onWebGLContextLost = onWebGLContextLost;
    this.onDevState = onDevState;
    this.isSoftwareGl = detectSoftwareWebGL();
    this.shadowsEnabled = !this.isSoftwareGl;

    if (initialSettings) {
      if (initialSettings.initialMapId) this.pendingMapId = initialSettings.initialMapId;
      if (initialSettings.audioEnabled !== undefined) this.audioWanted = initialSettings.audioEnabled;
      if (initialSettings.audioVolume !== undefined) this.audioVolume = initialSettings.audioVolume;
      if (initialSettings.audioQuality !== undefined) this.audioQuality = initialSettings.audioQuality;
      if (initialSettings.simSpeed !== undefined) this.simSpeed = initialSettings.simSpeed;
      if (initialSettings.weather !== undefined) this.weather = initialSettings.weather;
      if (initialSettings.backupMode !== undefined) this.backupMode = initialSettings.backupMode;
      if (initialSettings.drivingMode !== undefined) this.drivingMode = initialSettings.drivingMode;
      if (initialSettings.lightbarMode !== undefined) {
        this.lightbarMode = initialSettings.lightbarMode;
        this.activeLightbarId = lightbarModeToAssetId(initialSettings.lightbarMode);
      }
      if (initialSettings.activeLightbarId) {
        this.activeLightbarId = initialSettings.activeLightbarId;
      }
      if (initialSettings.sirenPattern !== undefined) this.sirenPattern = initialSettings.sirenPattern;
      if (initialSettings.trafficScale !== undefined) {
        this.trafficScale = THREE.MathUtils.clamp(initialSettings.trafficScale, 0, 2);
      }
      if (initialSettings.pedScale !== undefined) {
        this.pedScale = THREE.MathUtils.clamp(initialSettings.pedScale, 0, 2);
      }
      if (initialSettings.crimeProbability !== undefined) {
        this.customCrimeProb = THREE.MathUtils.clamp(initialSettings.crimeProbability, 0, 1);
        this.crimeProbability = this.customCrimeProb;
      }
      if (initialSettings.cowardiceLevel !== undefined) {
        this.customCowardice = THREE.MathUtils.clamp(initialSettings.cowardiceLevel, 0, 1);
        this.cowardiceLevel = this.customCowardice;
      }
      if (initialSettings.shadowsEnabled !== undefined) {
        this.shadowsEnabled = initialSettings.shadowsEnabled && !this.isSoftwareGl;
      }
      if (initialSettings.debrisObstacles !== undefined) {
        this.debrisObstacles = initialSettings.debrisObstacles;
      }
      if (initialSettings.renderScale !== undefined) {
        this.renderScale = initialSettings.renderScale;
      }
      if (initialSettings.crashIntensity !== undefined) {
        this.crashIntensity = THREE.MathUtils.clamp(initialSettings.crashIntensity, 0.5, 1.5);
      }
      if (initialSettings.maxPhysicsParts !== undefined) {
        this.customMaxPhysicsParts = THREE.MathUtils.clamp(
          Math.round(initialSettings.maxPhysicsParts),
          8,
          250,
        );
        this.maxPhysicsParts = this.customMaxPhysicsParts;
      }
      if (initialSettings.experimentalComplexMeshes !== undefined) {
        this.experimentalComplexMeshes = Boolean(initialSettings.experimentalComplexMeshes);
      }
    }
    setExperimentalComplexMeshesEnabled(this.experimentalComplexMeshes);
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio * this.renderScale, 2.25),
    );
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    this.renderer.shadowMap.enabled = this.shadowsEnabled && !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.hierarchy = new SceneWorldHierarchy(this.scene);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.vfx = new SimVfxManager(this.hierarchy.effects.vfx, this.simRng);
    this.combat = new CombatSystem(this.hierarchy.effects.tracers, this.simRng, this.vfx);
    this.crashPhysics = new VehicleCrashPhysicsSystem(
      this.hierarchy.effects.debris,
      this.simRng,
    );
    this.crashPhysics.setMaxPhysicsParts(this.maxPhysicsParts);
    this.weatherSystem = new WeatherSystem(
      this.scene,
      this.hierarchy.world.atmosphere,
      this.renderer,
      this.isSoftwareGl,
      this.simRng,
    );
    this.weatherSystem.setHighQualityLighting(this.shadowsEnabled && this.renderScale >= 1);
    this.aiDebugVisualizer = new AIDebugVisualizer(this.scene);

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointerdown', this.handleGlobalGestureUnlock);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    if (initialAssetResult) {
      this.applyAssetLoadResult(initialAssetResult);
    } else {
      this.emitSnapshot();
      void loadJsonAssetBundle('/jdataassets/manifest.json').then((res) => {
        if (!this.disposed) {
          this.applyAssetLoadResult(res);
        }
      });
    }
  }

  private recordAssetIssue = (issue: AssetIssue): void => {
    const exists = this.assetIssues.some(
      (i) => i.category === issue.category && i.id === issue.id && i.message === issue.message,
    );
    if (!exists) {
      this.assetIssues = [...this.assetIssues, issue];
      if (issue.severity === 'error') {
        simEventLog.error('asset', `[${issue.category}] ${issue.id}: ${issue.message}`, issue.path);
      } else {
        simEventLog.warn('asset', `[${issue.category}] ${issue.id}: ${issue.message}`, issue.path);
      }
    }
  };

  public applyAssetLoadResult(result: AssetLoadResult): void {
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    this.assetSourceLabel = result.sourceLabel;
    this.assetIssues = [...result.issues];
    this.fatalError = result.fatalError;

    // Reset transient simulation state before teardown/rebuild
    this.vfx.clearActiveParticles();
    this.combat.clearTracers();
    this.crashPhysics.clearDebris();
    this.units = [];
    this.officers = [];
    this.assailants = [];
    this.crimes = [];
    this.nailMats = [];
    this.civilianCars = [];
    this.pedestrians = [];
    this.clickables = [];
    this.crimeCheckAccum = 0;
    this.crimeCooldownTimer = 0;
    this.initialCrimeTriggered = false;
    this.simTime = 0;

    this.hierarchy.clearAllLayers();
    disposeLiveryTextureCache();
    this.textures?.dispose();
    this.textures = null;
    if (this.assets?.media && (!result.assets || result.assets.media !== this.assets.media)) {
      revokeMediaObjectUrls(this.assets.media);
    }

    if (result.fatalError || !result.assets || !result.config) {
      this.assets = null;
      this.config = null;
      this.assetsLoaded = false;
      this.paintPalette = [];
      this.emitSnapshot();
      return;
    }

    const assets = result.assets;
    const config = result.config;
    if (this.pendingMapId && assets.maps[this.pendingMapId]) {
      assets.activeMapId = this.pendingMapId;
      assets.map = assets.maps[this.pendingMapId];
      this.pendingMapId = undefined;
    }
    syncMapOwnedConfig(assets.map, config);
    if (assets.map.cameraOverview) {
      config.camera.overviewPos = [...assets.map.cameraOverview.pos];
      config.camera.overviewTarget = [...assets.map.cameraOverview.target];
    }
    this.assets = assets;
    this.config = config;
    if (assets.lightbars[this.activeLightbarId]) {
      this.lightbarMode = assetIdToLightbarMode(
        this.activeLightbarId,
        assets.lightbars[this.activeLightbarId],
      );
    } else {
      const fallbackLbId = lightbarModeToAssetId(this.lightbarMode);
      this.activeLightbarId = assets.lightbars[fallbackLbId]
        ? fallbackLbId
        : Object.keys(assets.lightbars)[0] ?? 'led_array';
    }
    this.simRng = mulberry32(20261116);
    simEventLog.info(
      'system',
      `Loaded pack "${assets.manifest.packName}" (v${assets.manifest.formatVersion ?? '1.5.0'})`,
      `Map: ${assets.map.name} (${Object.keys(assets.maps).length} maps, ${Object.keys(assets.lightbars).length} lightbars)`,
    );

    this.casualtyCount = 0;
    this.paintPalette = config.vehicles.paintPalette.map((sw) => ({
      id: sw.id,
      label: sw.label,
      hex: parseInt(sw.color.replace('#', ''), 16),
    }));
    this.crimeProbability = this.customCrimeProb ?? config.simulation.defaultCrimeProbability;
    this.cowardiceLevel = this.customCowardice ?? config.simulation.defaultCowardiceLevel;

    keybindStore.applyPackDefaults(config.keybinds);
    eventBindingStore.applyPackDefaults(config.eventBindings);
    if (config.physics?.defaultMaxPhysicsParts !== undefined) {
      this.maxPhysicsParts =
        this.customMaxPhysicsParts ??
        THREE.MathUtils.clamp(Math.round(config.physics.defaultMaxPhysicsParts), 8, 250);
      this.crashPhysics.setMaxPhysicsParts(this.maxPhysicsParts);
    }

    const textures = new TextureRegistry(
      this.renderer,
      assets,
      this.recordAssetIssue,
    );
    this.textures = textures;
    this.vfx.configure(textures, assets.map);
    this.combat.configure(config, assets.map);

    if (!this.audio) {
      this.audio = new JsonAudioSynth(assets.audio, this.audioWanted, assets.media);
      this.audio.unlockOnGesture();
    } else {
      this.audio.setMediaAssets(assets.media);
      this.audio.setAudioAssets(assets.audio);
      this.audio.setEnabled(this.audioWanted);
    }
    this.audio.setMasterVolume(this.audioVolume);
    this.audio.setVoiceQuality(this.audioQuality);

    if (!this.cameraController) {
      this.cameraController = new SimCameraController(
        this.container,
        this.renderer.domElement,
        this.isSoftwareGl,
        config.camera,
        {
          onSelectUnit: (uid) => this.selectUnit(uid),
          onUnlockAudio: () => this.audio?.unlockOnGesture(),
          onModeAutoFallback: () => this.emitSnapshot(),
          getClickables: () => this.clickables,
        },
      );
    } else {
      this.cameraController.applyConfig(config.camera);
    }

    if (!this.devEditor) {
      this.devEditor = new DevEditorController(
        this.scene,
        this.hierarchy,
        this.cameraController,
        this.renderer.domElement,
        {
          onStateChange: (st) => this.onDevState?.(st),
          onRebuildMap: () => this.rebuildMapAndWorld(),
          onRebuildModels: () => this.rebuildDynamicActors(),
          getBuildingMesh: (bid) => this.envHandles?.buildingMeshesById.get(bid),
          getObjectMesh: (oid) => this.envHandles?.objectMeshesById.get(oid),
          getSignMesh: (sid) => this.envHandles?.signMeshesById.get(sid),
          getWorldEntities: () => this.getWorldEntitiesSnapshot(),
          spawnWorldEntity: (kind, pos) => this.spawnWorldEntity(kind, pos),
          deleteWorldEntity: (kind, id) => this.deleteWorldEntity(kind, id),
          modifyWorldEntity: (kind, id, action, transform) =>
            this.modifyWorldEntity(kind, id, action, transform),
          getWorldEntityObject: (kind, id) => this.getWorldEntityObject(kind, id),
          findWorldEntityByObject: (obj) => this.findWorldEntityByObject(obj),
          focusWorldEntity: (kind, id) => this.focusWorldEntity(kind, id),
          getAIDebugFlags: () => this.getAIDebugFlags(),
          setAIDebugFlags: (patch) => this.setAIDebugFlags(patch),
          getAIDebugStats: () => this.getAIDebugStats(),
          onSwitchMap: (mapId) => this.switchMap(mapId),
        },
      );
    }

    this.buildWorldAndEntities();
    this.devEditor.setAssets(assets, textures, this.audio);

    if (!this.isSoftwareGl && this.cameraController) {
      this.renderer.compile(this.scene, this.cameraController.camera);
    }

    this.assetsLoaded = true;
    this.emitSnapshot();
    this.clock.getDelta();
    this.tick();
  }

  private buildWorldAndEntities(): void {
    if (!this.assets || !this.config || !this.textures) return;
    const assets = this.assets;
    const config = this.config;
    const textures = this.textures;

    this.roadGraph = new TownRoadGraph(assets.map);
    this.envHandles = buildTownEnvironment(
      this.hierarchy,
      assets.map,
      textures,
      config.world.treePalette,
      assets,
      this.recordAssetIssue,
    );
    this.staticBvh.build(this.envHandles.obstacles);

    const spawned = spawnPoliceUnits(
      this.hierarchy,
      config,
      assets,
      textures,
      this.isSoftwareGl,
      this.simRng,
      this.clickables,
      this.recordAssetIssue,
      assets.map,
    );
    this.units = spawned.units;
    this.officers = spawned.officers;
    this.assailants = [];
    if (this.units.length > 0 && !this.units.some((u) => u.id === this.selectedUnitId)) {
      this.selectedUnitId = this.units[0].id;
    }

    this.civilianCars = spawnCivilianTraffic(
      this.hierarchy,
      config.world,
      this.roadGraph,
      assets,
      textures,
      this.recordAssetIssue,
      this.trafficScale,
      assets.map,
    );
    this.pedestrians = spawnPedestrians(
      this.hierarchy,
      assets.map,
      config.world,
      this.staticBvh,
      assets,
      textures,
      this.simRng,
      this.recordAssetIssue,
      this.pedScale,
    );

    this.weatherSystem.applyWeather(
      this.weather,
      config.weatherPresets,
      this.envHandles,
      this.audio,
    );
  }

  public rebuildMapAndWorld(): void {
    if (!this.assets || !this.config || !this.textures) return;
    this.vfx.clearActiveParticles();
    this.combat.clearTracers();
    this.crashPhysics.clearDebris();
    this.crimes = [];
    this.nailMats = [];
    this.clickables = [];
    this.hierarchy.clearAllLayers();
    this.vfx.configure(this.textures, this.assets.map);
    this.combat.configure(this.config, this.assets.map);
    this.buildWorldAndEntities();
    this.devEditor?.refreshVisuals();
    this.emitSnapshot();
  }

  private getOfficersById(): Map<string, OfficerActor> {
    const map = new Map<string, OfficerActor>();
    for (const o of this.officers) map.set(o.id, o);
    return map;
  }

  private getAssailantsById(): Map<string, AssailantActor> {
    const map = new Map<string, AssailantActor>();
    for (const a of this.assailants) map.set(a.id, a);
    return map;
  }

  private isCrimeActive(
    crime: ActiveCrime,
    assailantsById: Map<string, AssailantActor>,
  ): boolean {
    return crime.assailantRefs.some((aid) => assailantsById.get(aid)?.alive);
  }

  public rebuildDynamicActors(): void {
    if (!this.assets || !this.config || !this.textures || !this.roadGraph) return;
    this.vfx.clearActiveParticles();
    this.combat.clearTracers();
    this.crashPhysics.clearDebris();
    this.crimes = [];
    this.assailants = [];
    this.officers = [];
    this.nailMats = [];
    this.clickables = [];
    disposeGroupContents(this.hierarchy.entitiesRoot);

    const spawned = spawnPoliceUnits(
      this.hierarchy,
      this.config,
      this.assets,
      this.textures,
      this.isSoftwareGl,
      this.simRng,
      this.clickables,
      this.recordAssetIssue,
      this.assets.map,
    );
    this.units = spawned.units;
    this.officers = spawned.officers;
    this.civilianCars = spawnCivilianTraffic(
      this.hierarchy,
      this.config.world,
      this.roadGraph,
      this.assets,
      this.textures,
      this.recordAssetIssue,
      this.trafficScale,
      this.assets.map,
    );
    this.pedestrians = spawnPedestrians(
      this.hierarchy,
      this.assets.map,
      this.config.world,
      this.staticBvh,
      this.assets,
      this.textures,
      this.simRng,
      this.recordAssetIssue,
      this.pedScale,
    );
    this.emitSnapshot();
  }

  public getLoadedAssets(): LoadedJsonAssets | null {
    return this.assets;
  }

  public getDevEditor(): DevEditorController | null {
    return this.devEditor;
  }

  private handleGlobalGestureUnlock = (): void => {
    this.audio?.unlockOnGesture();
  };

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.onWebGLContextLost(true);
  };

  private handleContextRestored = (): void => {
    this.onWebGLContextLost(false);
  };

  private handleResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.cameraController?.resize(w, h);
    this.renderer.setSize(w, h);
  };

  // --- Public Controls API ---

  public switchMap(mapId: string): boolean {
    if (!this.assets || !this.config) return false;
    const nextMap = this.assets.maps[mapId];
    if (!nextMap) return false;

    this.assets.activeMapId = mapId;
    this.assets.map = nextMap;
    syncMapOwnedConfig(nextMap, this.config);
    if (nextMap.cameraOverview) {
      this.config.camera.overviewPos = [...nextMap.cameraOverview.pos];
      this.config.camera.overviewTarget = [...nextMap.cameraOverview.target];
      this.cameraController?.applyConfig(this.config.camera);
      this.cameraController?.resetView();
    }
    this.rebuildMapAndWorld();
    this.devEditor?.setAssets(this.assets, this.textures, this.audio);
    simEventLog.info('map', `Switched map to "${nextMap.name}"`, `ID: ${mapId}`);
    this.emitSnapshot();
    return true;
  }

  public setLightbarMode(mode: LightbarMode): void {
    this.lightbarMode = mode;
    this.activeLightbarId = lightbarModeToAssetId(mode);
    for (const u of this.units) {
      u.lightbarId = this.activeLightbarId;
    }
    this.emitSnapshot();
  }

  public setLightbarById(lightbarId: string): void {
    const asset = this.assets?.lightbars[lightbarId];
    this.activeLightbarId = lightbarId;
    this.lightbarMode = assetIdToLightbarMode(lightbarId, asset);
    for (const u of this.units) {
      u.lightbarId = lightbarId;
    }
    this.emitSnapshot();
  }

  public setUnitLightbar(unitId: string, lightbarId: string): void {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return;
    unit.lightbarId = lightbarId;
    this.emitSnapshot();
  }

  public setSirenPattern(pattern: SirenPattern): void {
    this.sirenPattern = pattern;
    this.emitSnapshot();
  }

  public setDrivingMode(mode: DrivingMode): void {
    this.drivingMode = mode;
    this.emitSnapshot();
  }

  public setBackupMode(mode: BackupMode): void {
    this.backupMode = mode;
    this.emitSnapshot();
  }

  public requestBackupNow(crimeId?: string): void {
    if (!this.config || !this.roadGraph) return;
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();
    const explicitCrime = crimeId
      ? this.crimes.find((c) => c.id === crimeId && this.isCrimeActive(c, assailantsById))
      : undefined;
    const selected = this.units.find((u) => u.id === this.selectedUnitId);
    const preferredCrime = selected?.targetCrimeId
      ? this.crimes.find(
          (c) => c.id === selected.targetCrimeId && this.isCrimeActive(c, assailantsById),
        )
      : undefined;
    const crime =
      explicitCrime ??
      preferredCrime ??
      this.crimes.find((c) => this.isCrimeActive(c, assailantsById));
    if (!crime) return;
    if (
      requestManualBackup(
        crime,
        this.units,
        officersById,
        assailantsById,
        this.roadGraph,
        this.config,
        this.drivingMode,
        this.audio,
        this.staticBvh,
        this.assets?.map,
      )
    ) {
      this.emitSnapshot();
    }
  }

  public deployNailMatNow(): void {
    if (!this.config || !this.roadGraph) return;
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();
    const selected = this.units.find((u) => u.id === this.selectedUnitId);
    const preferredCrime = selected?.targetCrimeId
      ? this.crimes.find(
          (c) =>
            c.id === selected.targetCrimeId &&
            this.isCrimeActive(c, assailantsById) &&
            c.inVehiclePursuit,
        )
      : undefined;
    const crime =
      preferredCrime ??
      this.crimes.find((c) => this.isCrimeActive(c, assailantsById) && c.inVehiclePursuit);
    if (!crime) return;
    if (
      requestManualNailMat(
        crime,
        this.units,
        officersById,
        assailantsById,
        this.nailMats,
        this.roadGraph,
        this.config,
        this.hierarchy,
        this.audio,
        this.staticBvh,
        this.assets?.map,
      )
    ) {
      this.emitSnapshot();
    }
  }

  public setWeather(weather: WeatherCondition): void {
    this.weather = weather;
    if (this.config) {
      this.weatherSystem.applyWeather(
        weather,
        this.config.weatherPresets,
        this.envHandles,
        this.audio,
      );
    }
    this.emitSnapshot();
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraController?.setMode(mode);
    this.emitSnapshot();
  }

  public resetCameraView(): void {
    this.cameraController?.resetView();
    this.emitSnapshot();
  }

  public selectUnit(unitId: string): void {
    if (this.units.some((u) => u.id === unitId)) {
      this.selectedUnitId = unitId;
      this.cameraController?.requestSnap();
      this.emitSnapshot();
    }
  }

  public setUnitBaseColor(unitId: string, colorHex: number): void {
    const unit = this.units.find((u) => u.id === unitId);
    if (!unit) return;
    unit.baseColorHex = colorHex;
    unit.rig.setBaseColor(colorHex);
    this.emitSnapshot();
  }

  public setCrimeProbability(prob: number): void {
    this.customCrimeProb = THREE.MathUtils.clamp(prob, 0, 1);
    this.crimeProbability = this.customCrimeProb;
    this.emitSnapshot();
  }

  public setCowardiceLevel(level: number): void {
    this.customCowardice = THREE.MathUtils.clamp(level, 0, 1);
    this.cowardiceLevel = this.customCowardice;
    this.emitSnapshot();
  }

  public setAudioEnabled(enabled: boolean): void {
    this.audioWanted = enabled;
    this.audio?.setEnabled(enabled);
    this.emitSnapshot();
  }

  public setAudioVolume(volume: number): void {
    this.audioVolume = THREE.MathUtils.clamp(volume, 0, 1);
    this.audio?.setMasterVolume(this.audioVolume);
    this.emitSnapshot();
  }

  public setAudioQuality(quality: AudioVoiceQuality): void {
    this.audioQuality = quality;
    this.audio?.setVoiceQuality(quality);
    this.emitSnapshot();
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled && !this.isSoftwareGl;
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    this.renderer.shadowMap.needsUpdate = true;
    this.weatherSystem.setHighQualityLighting(this.shadowsEnabled && this.renderScale >= 1);
    this.emitSnapshot();
  }

  public setDebrisObstacles(enabled: boolean): void {
    this.debrisObstacles = enabled;
    this.emitSnapshot();
  }

  public setRenderScale(scale: 0.75 | 1 | 1.5): void {
    this.renderScale = scale;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio * scale, 2.25),
    );
    this.weatherSystem.setHighQualityLighting(this.shadowsEnabled && this.renderScale >= 1);
    this.handleResize();
    this.emitSnapshot();
  }

  public setCrashIntensity(intensity: number): void {
    this.crashIntensity = THREE.MathUtils.clamp(intensity, 0.5, 1.5);
    this.emitSnapshot();
  }

  public setMaxPhysicsParts(limit: number): void {
    const clamped = THREE.MathUtils.clamp(Math.round(limit), 8, 250);
    this.customMaxPhysicsParts = clamped;
    this.maxPhysicsParts = clamped;
    this.crashPhysics.setMaxPhysicsParts(clamped);
    this.emitSnapshot();
  }

  public setTrafficDensityScale(scale: number): void {
    this.trafficScale = THREE.MathUtils.clamp(scale, 0, 2);
    if (this.assets && this.config && this.textures && this.roadGraph) {
      for (const car of this.civilianCars) {
        this.hierarchy.removeEntity(car.rig.root);
      }
      this.civilianCars = spawnCivilianTraffic(
        this.hierarchy,
        this.config.world,
        this.roadGraph,
        this.assets,
        this.textures,
        this.recordAssetIssue,
        this.trafficScale,
        this.assets.map,
      );
    }
    this.emitSnapshot();
  }

  public setPedestrianCountScale(scale: number): void {
    this.pedScale = THREE.MathUtils.clamp(scale, 0, 2);
    if (this.assets && this.config && this.textures) {
      for (const ped of this.pedestrians) {
        this.hierarchy.removeEntity(ped.rig.root);
      }
      this.pedestrians = spawnPedestrians(
        this.hierarchy,
        this.assets.map,
        this.config.world,
        this.staticBvh,
        this.assets,
        this.textures,
        this.simRng,
        this.recordAssetIssue,
        this.pedScale,
      );
    }
    this.emitSnapshot();
  }

  public setSimSpeed(speed: 1 | 2): void {
    this.simSpeed = speed;
    this.emitSnapshot();
  }

  public toggleSelectedUnitMount(): void {
    if (!this.config) return;
    const unit = this.units.find((u) => u.id === this.selectedUnitId);
    if (!unit) return;
    const officersById = this.getOfficersById();

    if (unit.mounted) {
      dismountUnit(
        unit,
        officersById,
        this.cowardiceLevel,
        this.staticBvh,
        this.config,
        this.simRng,
        true,
        this.assets?.map,
        this.hierarchy,
      );
    } else if (
      !unit.immobilized &&
      (unit.status === UnitStatus.AtStation ||
        unit.status === UnitStatus.Dismounting ||
        unit.status === UnitStatus.Engaging)
    ) {
      unit.freeRoam = false;
      unit.mountTimer = 0;
      const doorPos = getPrecinctDoorPos(this.assets?.map, this.config);
      for (let i = 0; i < unit.officerRefs.length; i++) {
        const o = officersById.get(unit.officerRefs[i]);
        if (!o || o.hp <= 0) continue;
        if (o.locationState === 'in_precinct' || o.locationState === 'entering_precinct') {
          o.locationState = 'exiting_precinct';
          o.rig.root.visible = true;
          o.pos.set(doorPos.x + 1.2 + i * 0.45, doorPos.y, doorPos.z + (i - 0.5) * 0.7);
          o.rig.root.position.copy(o.pos);
        }
        o.mountPhase = 'walk';
        o.boardTimer = 0;
      }
      unit.status = UnitStatus.Mounting;
    }
    this.emitSnapshot();
  }

  public triggerCrimeNow(forcePursuit = false): void {
    if (!this.assets || !this.config || !this.textures || !this.roadGraph) return;
    const created = spawnCrime({
      forcePursuit,
      crimes: this.crimes,
      crimeCounter: this.crimeCounter,
      units: this.units,
      officersById: this.getOfficersById(),
      assailants: this.assailants,
      hierarchy: this.hierarchy,
      roadGraph: this.roadGraph,
      staticBvh: this.staticBvh,
      config: this.config,
      map: this.assets.map,
      assets: this.assets,
      textures: this.textures,
      drivingMode: this.drivingMode,
      audio: this.audio,
      rng: this.simRng,
      onAssetIssue: this.recordAssetIssue,
    });
    if (created) {
      this.crimeCounter++;
      this.crimeCooldownTimer = Math.max(
        this.crimeCooldownTimer,
        this.config.simulation.crimeCooldownSec,
      );
      this.emitSnapshot();
    }
  }

  // --- Simulation Tick Loop ---

  private tick = (): void => {
    if (this.disposed || this.fatalError || !this.config || !this.roadGraph || !this.cameraController) {
      return;
    }
    const config = this.config;
    const roadGraph = this.roadGraph;

    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    const dt = rawDt * this.simSpeed;
    this.simTime += dt;

    if (!this.initialCrimeTriggered && this.simTime > config.simulation.initialCrimeDelaySec) {
      this.initialCrimeTriggered = true;
      this.triggerCrimeNow(false);
    }

    if (this.crimeCooldownTimer > 0) {
      this.crimeCooldownTimer = Math.max(0, this.crimeCooldownTimer - dt);
    } else {
      this.crimeCheckAccum += dt;
      if (this.crimeCheckAccum >= config.simulation.crimeCheckIntervalSec) {
        this.crimeCheckAccum = 0;
        if (
          this.crimeProbability > 0 &&
          this.crimes.length < config.simulation.autoCrimeMaxConcurrent
        ) {
          const chance = this.crimeProbability * config.simulation.autoCrimeChanceScale;
          if (this.simRng() < chance) {
            this.triggerCrimeNow(false);
          }
        }
      }
    }

    const map = this.assets?.map;
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();
    this.audio?.ensureRunningIfEnabled();

    for (const c of this.crimes) {
      evaluateCrimeBackupPolicy(
        c,
        this.units,
        this.officers,
        officersById,
        assailantsById,
        this.nailMats,
        roadGraph,
        config,
        this.hierarchy,
        this.backupMode,
        this.drivingMode,
        this.audio,
        this.staticBvh,
        map,
      );
    }

    const allVehicles = buildAllVehicleProxies(
      this.units,
      this.civilianCars,
      this.crimes,
      assailantsById,
    );

    updatePoliceUnits(
      {
        units: this.units,
        officersById,
        crimes: this.crimes,
        assailants: this.assailants,
        assailantsById,
        pedestrians: this.pedestrians,
        allVehicles,
        roadGraph,
        staticBvh: this.staticBvh,
        config,
        map,
        lightbars: this.assets?.lightbars,
        combat: this.combat,
        vfx: this.vfx,
        audio: this.audio,
        lightbarMode: this.lightbarMode,
        drivingMode: this.drivingMode,
        weather: this.weather,
        cowardiceLevel: this.cowardiceLevel,
        simTime: this.simTime,
        rng: this.simRng,
      },
      dt,
    );

    // Update standalone officers spawned without an owning PoliceUnit
    let standaloneOffIdx = 0;
    for (const off of this.officers) {
      if (off.unitId !== null) continue;
      if (off.boardingState !== 'dismounted') continue;
      let nearestTarget: AssailantActor | null = null;
      let nearestSq = 58 * 58;
      for (const a of this.assailants) {
        if (!a.alive || a.inVehicle) continue;
        const dSq = a.pos.distanceToSquared(off.pos);
        if (dSq < nearestSq) {
          nearestSq = dSq;
          nearestTarget = a;
        }
      }
      if (nearestTarget) {
        this.combat.updateOfficerCombat(
          off,
          standaloneOffIdx++,
          nearestTarget,
          null,
          this.cowardiceLevel,
          this.staticBvh,
          this.pedestrians,
          this.audio,
          dt,
        );
      } else {
        this.combat.updateOfficerFreeRoam(
          off,
          standaloneOffIdx++,
          null,
          this.staticBvh,
          dt,
        );
      }
    }

    // Update standalone assailants spawned outside a crime container
    for (const as of this.assailants) {
      if (as.crimeId !== null) continue;
      this.combat.updateAssailantCombat(
        as,
        this.officers,
        this.cowardiceLevel,
        this.staticBvh,
        this.audio,
        this.simTime,
        dt,
      );
    }

    updateNailMats(
      this.nailMats,
      this.units,
      officersById,
      this.crimes,
      assailantsById,
      this.civilianCars,
      roadGraph,
      this.staticBvh,
      config,
      this.vfx,
      this.audio,
      this.hierarchy,
      this.simTime,
      this.simRng,
      dt,
      map,
    );

    updateCrimes(
      {
        crimes: this.crimes,
        units: this.units,
        officers: this.officers,
        officersById,
        assailants: this.assailants,
        assailantsById,
        pedestrians: this.pedestrians,
        allVehicles,
        nailMats: this.nailMats,
        hierarchy: this.hierarchy,
        roadGraph,
        staticBvh: this.staticBvh,
        config,
        map,
        combat: this.combat,
        vfx: this.vfx,
        audio: this.audio,
        weather: this.weather,
        cowardiceLevel: this.cowardiceLevel,
        simTime: this.simTime,
        rng: this.simRng,
        onCrimeCleared: () => {
          this.crimeCooldownTimer = Math.max(
            this.crimeCooldownTimer,
            config.simulation.crimeCooldownSec,
          );
        },
      },
      dt,
    );

    updateCivilianTraffic(
      this.civilianCars,
      this.units,
      this.pedestrians,
      allVehicles,
      this.nailMats,
      roadGraph,
      this.staticBvh,
      map ?? config.world,
      this.vfx,
      this.weather,
      this.simRng,
      dt,
    );

    this.resolveAllVehicleCollisions(dt, officersById, assailantsById);
    this.resolveBreakablePropImpacts(dt);
    this.resolveHumanoidCollisions(assailantsById);

    const debrisHumanoids: DebrisHumanoidTarget[] = [];
    for (const ped of this.pedestrians) {
      if (ped.dead || ped.ragdoll.active) continue;
      debrisHumanoids.push({
        pos: ped.pos,
        ragdoll: ped.ragdoll,
        onHitByDebris: (impactSpeed) => {
          ped.hp = Math.max(0, ped.hp - Math.min(60, impactSpeed * 2.4));
          ped.injured = ped.hp > 0 && ped.hp < ped.maxHp;
          ped.panicTimer = 9;
          if (ped.hp <= 0 && !ped.dead) {
            ped.dead = true;
            this.casualtyCount++;
          }
        },
      });
    }
    for (const off of this.officers) {
      if (off.boardingState !== 'dismounted' || off.hp <= 0 || off.ragdoll.active) continue;
      debrisHumanoids.push({
        pos: off.pos,
        ragdoll: off.ragdoll,
        onHitByDebris: (impactSpeed) => {
          off.hp = Math.max(0, off.hp - Math.min(35, impactSpeed * 1.4));
          off.morale = Math.max(0, off.morale - 15);
          if (off.hp <= 0) {
            off.ragdoll.recoverTimer = 999;
          }
        },
      });
    }
    for (const as of this.assailants) {
      if (!as.alive || as.inVehicle || as.ragdoll.active) continue;
      debrisHumanoids.push({
        pos: as.pos,
        ragdoll: as.ragdoll,
        onHitByDebris: (impactSpeed) => {
          as.hp = Math.max(0, as.hp - Math.min(40, impactSpeed * 1.6));
          if (as.hp <= 0 && as.alive) {
            as.alive = false;
            this.neutralizedCount++;
          }
        },
      });
    }

    this.crashPhysics.stepDebris(this.staticBvh, dt, {
      humanoids: debrisHumanoids,
      vfx: this.vfx,
      audio: this.audio,
      config,
      surfaceSource: map ?? config.world,
    });
    updatePedestrians(
      this.pedestrians,
      allVehicles,
      this.officers,
      this.assailants,
      this.staticBvh,
      map ?? config.world,
      config,
      dt,
    );
    this.combat.updateTracers(
      this.crimes,
      this.units,
      this.officers,
      this.assailants,
      this.civilianCars,
      this.pedestrians,
      this.cowardiceLevel,
      this.staticBvh,
      dt,
      () => {
        this.neutralizedCount++;
        simEventLog.info('combat', `Suspect neutralized (Total: ${this.neutralizedCount})`);
      },
      () => {
        this.casualtyCount++;
        simEventLog.warn('combat', `Civilian casualty reported (Total: ${this.casualtyCount})`);
      },
    );
    this.vfx.update(dt);

    const cam = this.cameraController.camera;
    cam.getWorldDirection(_camFwd);
    _camUp.set(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
    this.weatherSystem.update(rawDt, cam.position, _camFwd);
    this.audio?.updateListener(cam.position, _camFwd, _camUp);

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      this.audio?.updateUnitSiren(
        u.id,
        i,
        u.sirensActive && !u.rig.lightbar.detached,
        u.pos,
        this.sirenPattern,
        this.simTime,
        rawDt,
        config,
      );
    }

    const selectedUnit =
      this.units.find((u) => u.id === this.selectedUnitId) ?? this.units[0];
    this.cameraController.update(rawDt, selectedUnit, officersById);
    this.aiDebugVisualizer.update(this.aiDebugFlags, {
      units: this.units,
      civilianCars: this.civilianCars,
      crimes: this.crimes,
      assailantsById,
      pedestrians: this.pedestrians,
      roadGraph: this.roadGraph,
    });
    this.devEditor?.update(rawDt);

    this.snapshotAccum += rawDt;
    if (this.snapshotAccum >= config.simulation.snapshotIntervalSec) {
      this.snapshotAccum = 0;
      this.emitSnapshot();
    }

    this.renderer.render(this.scene, cam);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private isLocationWitnessedByPolice(
    x: number,
    z: number,
    officersById: Map<string, OfficerActor>,
  ): boolean {
    const maxOfficerDistSq = 58 * 58;
    for (const off of this.officers) {
      if (off.hp <= 0 || off.locationState === 'in_precinct') continue;
      const dx = off.pos.x - x;
      const dz = off.pos.z - z;
      if (dx * dx + dz * dz > maxOfficerDistSq) continue;
      if (this.staticBvh.raycastSegment(off.pos.x, off.pos.z, x, z).clear) {
        return true;
      }
    }
    const maxUnitDistSq = 62 * 62;
    for (const u of this.units) {
      if (u.status === UnitStatus.AtStation || u.immobilized) continue;
      const hasLiving = u.officerRefs.some((oid) => (officersById.get(oid)?.hp ?? 0) > 0);
      if (!hasLiving) continue;
      const dx = u.pos.x - x;
      const dz = u.pos.z - z;
      if (dx * dx + dz * dz > maxUnitDistSq) continue;
      if (this.staticBvh.raycastSegment(u.pos.x, u.pos.z, x, z).clear) {
        return true;
      }
    }
    return false;
  }

  private promoteCivilianDriverIfWitnessed(
    civilianId: string,
    x: number,
    z: number,
    reason: string,
    officersById: Map<string, OfficerActor>,
  ): void {
    if (!this.assets || !this.config || !this.textures || !this.roadGraph) return;
    const civ = this.civilianCars.find((c) => c.id === civilianId);
    if (!civ || civ.immobilized) return;
    if (!this.isLocationWitnessedByPolice(x, z, officersById)) return;

    const created = promoteCivilianToPursuit({
      civilian: civ,
      civilianCars: this.civilianCars,
      crimeCounter: this.crimeCounter,
      crimes: this.crimes,
      units: this.units,
      officersById,
      assailants: this.assailants,
      hierarchy: this.hierarchy,
      roadGraph: this.roadGraph,
      staticBvh: this.staticBvh,
      config: this.config,
      assets: this.assets,
      textures: this.textures,
      drivingMode: this.drivingMode,
      audio: this.audio,
      rng: this.simRng,
      reason,
      map: this.assets.map,
      onAssetIssue: this.recordAssetIssue,
    });
    if (created) {
      this.crimeCounter++;
    }
  }

  private resolveAllVehicleCollisions(
    dt: number,
    officersById: Map<string, OfficerActor>,
    assailantsById: Map<string, AssailantActor>,
  ): void {
    const entries: VehicleCollisionEntry[] = [];

    for (const u of this.units) {
      entries.push({
        id: u.id,
        kind: 'police',
        pos: u.pos,
        yaw: u.yaw,
        dyn: u.dyn,
        mass: u.mass,
        halfW: u.halfW,
        halfL: u.halfL,
        detachableParts: u.rig.detachableParts,
        bodyGroup: u.rig.bodyGroup,
        wheels: u.rig.wheels,
        frontWheels: u.rig.frontWheels,
        policeRig: u.rig,
        applyState: (y, s) => {
          u.yaw = y;
          u.speed = s;
        },
        onImpact: (strikeSpeed) => {
          if (strikeSpeed > 11) {
            u.damageSmokeTimer = Math.max(u.damageSmokeTimer, 7.5);
          }
          if (strikeSpeed > 13 && this.cowardiceLevel > 0.3) {
            for (const o of resolveUnitOfficers(u, officersById)) {
              o.morale = Math.max(0, o.morale - 22 * this.cowardiceLevel);
            }
          }
        },
        onWheelBroken: (tiltSide) => {
          u.immobilized = true;
          u.immobilizeTilt = tiltSide * 0.14;
          u.damageSmokeTimer = Math.max(u.damageSmokeTimer, 14);
        },
      });
    }

    for (const civ of this.civilianCars) {
      entries.push({
        id: civ.id,
        kind: 'civilian',
        pos: civ.pos,
        yaw: civ.yaw,
        dyn: civ.dyn,
        mass: 1.0,
        halfW: 0.92,
        halfL: 2.24,
        detachableParts: civ.rig.detachableParts,
        bodyGroup: civ.rig.bodyGroup,
        wheels: civ.rig.wheels,
        applyState: (y, s) => {
          civ.yaw = y;
          civ.speed = s;
        },
        onImpact: (strikeSpeed) => {
          if (strikeSpeed > 5.5) {
            civ.stunTimer = Math.max(civ.stunTimer, 1.5 + Math.min(2.5, strikeSpeed * 0.12));
          }
          if (strikeSpeed > 9.5) {
            civ.damageSmokeTimer = Math.max(civ.damageSmokeTimer, 9.0);
          }
        },
        onWheelBroken: (tiltSide) => {
          civ.immobilized = true;
          civ.immobilizeTilt = tiltSide * 0.14;
          civ.damageSmokeTimer = Math.max(civ.damageSmokeTimer, 14);
        },
      });
    }

    for (const c of this.crimes) {
      const primarySuspect = resolveCrimePrimaryAssailant(c, assailantsById);
      if (c.inVehiclePursuit && c.vehicleRig && primarySuspect?.alive) {
        entries.push({
          id: `getaway-${c.id}`,
          kind: 'getaway',
          pos: c.vehiclePos,
          yaw: c.vehicleYaw,
          dyn: c.vehicleDyn,
          mass: 1.15,
          halfW: 0.92,
          halfL: 2.24,
          detachableParts: c.vehicleRig.detachableParts,
          bodyGroup: c.vehicleRig.bodyGroup,
          wheels: c.vehicleRig.wheels,
          applyState: (y, s) => {
            c.vehicleYaw = y;
            c.vehicleSpeed = s;
          },
          onImpact: (strikeSpeed, hitByPolice) => {
            if (strikeSpeed > 4.2) {
              const dmg = hitByPolice ? 18 + strikeSpeed * 2.1 : 8 + strikeSpeed * 1.1;
              c.vehicleHp = Math.max(0, c.vehicleHp - dmg);
              if (c.vehicleHp < 55 || strikeSpeed > 9) {
                c.vehicleSmokeTimer = Math.max(c.vehicleSmokeTimer, 12);
              }
            }
          },
          onWheelBroken: (tiltSide) => {
            c.vehicleImmobilized = true;
            c.vehicleImmobilizeTilt = tiltSide * 0.14;
            c.vehicleSmokeTimer = Math.max(c.vehicleSmokeTimer, 14);
          },
        });
      }
    }

    this.crashPhysics.resolveAllCollisions(
      entries,
      this.staticBvh,
      this.vfx,
      this.audio,
      dt,
      {
        debrisObstacles: this.debrisObstacles,
        crashIntensity: this.crashIntensity,
        onHeavyCrash: (mag) => {
          this.cameraController?.triggerImpactShake(Math.min(0.6, mag * 0.024));
          if (mag > 14) {
            simEventLog.warn('crash', `High-energy vehicle collision (${Math.round(mag)} m/s)`);
          }
        },
        onVehicleCollision: (a, b, strikeSpeed, contactX, contactZ) => {
          if (a.kind === 'civilian' && b.kind === 'civilian' && strikeSpeed >= 4.2) {
            const spdA = Math.hypot(a.dyn.vx, a.dyn.vz);
            const spdB = Math.hypot(b.dyn.vx, b.dyn.vz);
            const culprit = spdA >= spdB ? a : b;
            this.promoteCivilianDriverIfWitnessed(
              culprit.id,
              contactX,
              contactZ,
              'Reckless collision',
              officersById,
            );
          } else if (a.kind === 'civilian' && b.kind === 'police' && strikeSpeed >= 2.6) {
            this.promoteCivilianDriverIfWitnessed(
              a.id,
              contactX,
              contactZ,
              'Struck police cruiser',
              officersById,
            );
          } else if (b.kind === 'civilian' && a.kind === 'police' && strikeSpeed >= 2.6) {
            this.promoteCivilianDriverIfWitnessed(
              b.id,
              contactX,
              contactZ,
              'Struck police cruiser',
              officersById,
            );
          }
        },
      },
    );
  }

  private resolveBreakablePropImpacts(dt: number): void {
    const props = this.envHandles?.breakableProps;
    if (!props || props.length === 0) return;

    const movers: Array<{ pos: THREE.Vector3; speed: number; halfW: number; dyn: { vx: number; vz: number } }> = [];
    for (const u of this.units) {
      if (u.status === UnitStatus.AtStation) continue;
      const spd = Math.hypot(u.dyn.vx, u.dyn.vz);
      if (spd >= 4.2) movers.push({ pos: u.pos, speed: spd, halfW: u.halfW, dyn: u.dyn });
    }
    for (const c of this.civilianCars) {
      const spd = Math.hypot(c.dyn.vx, c.dyn.vz);
      if (spd >= 4.2) movers.push({ pos: c.pos, speed: spd, halfW: 0.92, dyn: c.dyn });
    }
    for (const cr of this.crimes) {
      if (cr.inVehiclePursuit && cr.vehicleRig) {
        const spd = Math.hypot(cr.vehicleDyn.vx, cr.vehicleDyn.vz);
        if (spd >= 4.2) {
          movers.push({ pos: cr.vehiclePos, speed: spd, halfW: 0.92, dyn: cr.vehicleDyn });
        }
      }
    }

    if (movers.length > 0) {
      for (const prop of props) {
        if (prop.broken) continue;
        for (const m of movers) {
          const hitR = prop.radius + m.halfW + 0.35;
          const dx = prop.x - m.pos.x;
          const dz = prop.z - m.pos.z;
          if (dx * dx + dz * dz <= hitR * hitR && m.speed >= prop.minStrikeSpeed) {
            const len = Math.hypot(m.dyn.vx, m.dyn.vz) || 1;
            const dirX = m.dyn.vx / len;
            const dirZ = m.dyn.vz / len;
            triggerBreakablePropFall(prop, dirX, dirZ, m.speed);
            this.vfx.spawnImpactSparks(prop.x, prop.y + 1.1, prop.z, 6, 0.85, dirX * 3, dirZ * 3);
            playBoundAudioEvent(this.audio, this.config, 'vehicle_crash', prop.group.position);
            m.dyn.vx *= 0.84;
            m.dyn.vz *= 0.84;
            break;
          }
        }
      }
    }

    stepBreakableProps(props, dt);
  }

  private resolveHumanoidCollisions(assailantsById: Map<string, AssailantActor>): void {
    const officersById = this.getOfficersById();
    const humVehicles: VehicleHumanoidCollider[] = [];
    for (const u of this.units) {
      humVehicles.push({
        id: u.id,
        kind: 'police',
        pos: u.pos,
        yaw: u.yaw,
        speed: u.speed,
        halfW: u.halfW,
        halfL: u.halfL,
      });
    }
    for (const c of this.civilianCars) {
      humVehicles.push({
        id: c.id,
        kind: 'civilian',
        pos: c.pos,
        yaw: c.yaw,
        speed: c.speed,
        halfW: 0.92,
        halfL: 2.24,
      });
    }
    for (const cr of this.crimes) {
      const primarySuspect = resolveCrimePrimaryAssailant(cr, assailantsById);
      if (cr.inVehiclePursuit && cr.vehicleRig && primarySuspect?.alive) {
        humVehicles.push({
          id: `getaway-${cr.id}`,
          kind: 'getaway',
          pos: cr.vehiclePos,
          yaw: cr.vehicleYaw,
          speed: cr.vehicleSpeed,
          halfW: 0.92,
          halfL: 2.24,
        });
      }
    }

    this.combat.resolveVehicleHumanoidCollisions(
      humVehicles,
      this.pedestrians,
      this.officers,
      this.assailants,
      this.staticBvh,
      this.audio,
      () => {
        this.casualtyCount++;
      },
      () => {
        this.neutralizedCount++;
      },
      (veh, hitPos) => {
        if (veh.kind === 'civilian' && veh.speed >= 2.2) {
          this.promoteCivilianDriverIfWitnessed(
            veh.id,
            hitPos.x,
            hitPos.z,
            'Hit pedestrian/officer',
            officersById,
          );
        }
      },
    );
    this.combat.resolveHumanoidMutualCollisions(
      this.pedestrians,
      this.officers,
      this.assailants,
      this.staticBvh,
    );
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private emitSnapshot(): void {
    const liveries = this.config?.vehicles.liveries;
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();

    const unitsSummary = this.units.map((u) => {
      const crew = resolveUnitOfficers(u, officersById);
      const avgMorale =
        crew.length > 0
          ? Math.round(crew.reduce((acc, o) => acc + o.morale, 0) / crew.length)
          : 100;
      const fleeingOfficers = crew.filter(
        (o) => o.hp > 0 && o.cowardiceState === 'fleeing',
      ).length;
      const downedOfficers = crew.filter((o) => o.hp <= 0).length;
      const seatedCount = u.seats.filter((s) => s.occupantOfficerId !== null).length;
      return {
        id: u.id,
        callsign: u.callsign,
        vehicleKind: u.vehicleKind,
        liveryLabel: liveries?.[u.liveryId]?.label ?? u.liveryId,
        lightbarId: u.lightbarId,
        baseColorHex: u.baseColorHex,
        isHeavyUnit: u.isHeavyUnit,
        weaponKind: u.weaponKind,
        status: u.status,
        activeGoal: u.activeGoal,
        goalReason: u.goalReason,
        mounted: u.mounted,
        immobilized: u.immobilized,
        freeRoam: u.freeRoam,
        lightsActive: u.lightsActive,
        sirensActive: u.sirensActive,
        speedKmh: Math.round(Math.abs(u.speed) * 3.6),
        morale: avgMorale,
        fleeingOfficers,
        downedOfficers,
        targetCrimeId: u.targetCrimeId,
        assignedCaseNumber: u.assignedCaseNumber,
        assignedRole: u.assignedRole,
        impatience: Math.round(u.impatience * 100),
        reversing: u.reverseTimer > 0,
        seatedCount,
        seatCapacity: u.seats.length,
      };
    });

    const crimesSummary: CrimeSummary[] = this.crimes.map((c) => {
      const assigned = this.units.find((u) => u.id === c.assignedUnitId);
      const counts = getCrimeUnitCounts(c, this.units, this.nailMats);
      const primarySuspect = resolveCrimePrimaryAssailant(c, assailantsById);
      const anyAlive = this.isCrimeActive(c, assailantsById);
      const assignedUnits: CaseAssignedUnitBadge[] = this.units
        .filter((u) => u.targetCrimeId === c.id && u.status !== UnitStatus.Retreating)
        .map((u) => ({
          unitId: u.id,
          callsign: u.callsign,
          role: u.assignedRole ?? (u.id === c.assignedUnitId ? 'primary' : 'backup'),
          status: u.status,
          reversing: u.reverseTimer > 0,
        }));
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        type: c.type,
        district: c.district,
        incidentStatus: c.incidentStatus,
        urgency: c.urgency,
        urgencyLevel: c.urgencyLevel,
        suspectAlive: anyAlive,
        suspectHp: Math.round(primarySuspect?.hp ?? 0),
        suspectWeaponKind: primarySuspect?.weaponKind ?? 'pistol',
        inVehiclePursuit: c.inVehiclePursuit,
        vehicleHp: Math.round(c.vehicleHp),
        assignedUnitCallsign: assigned ? assigned.callsign : null,
        assignedUnits,
        backupDispatched: c.backupDispatched,
        backupCount: Math.max(0, counts.regularCount - 1),
        heavyDeployed: c.heavyDeployed || counts.vanDeployed,
        apcDeployed: counts.apcDeployed,
        nailMatDeployed: counts.activeNailMats > 0,
        elapsedSec: Math.round(c.elapsedSec),
      };
    });

    this.onSnapshot({
      units: unitsSummary,
      activeCrimes: crimesSummary,
      neutralizedCount: this.neutralizedCount,
      casualtyCount: this.casualtyCount,
      debrisCount: this.crashPhysics.getDebrisCount(),
      civilianCarCount: this.civilianCars.length,
      pedestrianCount: this.pedestrians.length,
      activeNailMats: this.nailMats.filter((m) => m.phase !== 'recovering').length,
      selectedUnitId: this.selectedUnitId,
      lightbarMode: this.lightbarMode,
      activeLightbarId: this.activeLightbarId,
      availableLightbars: this.assets
        ? Object.values(this.assets.lightbars).map((lb) => ({ id: lb.id, name: lb.name }))
        : [],
      sirenPattern: this.sirenPattern,
      drivingMode: this.drivingMode,
      backupMode: this.backupMode,
      weather: this.weather,
      cameraMode: this.cameraController?.mode ?? CameraMode.Overview,
      crimeProbability: this.crimeProbability,
      cowardiceLevel: this.cowardiceLevel,
      audioEnabled: this.audio?.isEnabled() ?? this.audioWanted,
      audioVolume: this.audioVolume,
      audioQuality: this.audioQuality,
      shadowsEnabled: this.shadowsEnabled,
      debrisObstacles: this.debrisObstacles,
      renderScale: this.renderScale,
      crashIntensity: this.crashIntensity,
      maxPhysicsParts: this.maxPhysicsParts,
      experimentalComplexMeshes: this.experimentalComplexMeshes,
      simSpeed: this.simSpeed,
      isSoftwareGl: this.isSoftwareGl,
      paintPalette: this.paintPalette,
      assetPackName: this.assets?.manifest.packName ?? 'unloaded',
      assetSourceLabel: this.assetSourceLabel,
      configVersion: this.config?.version ?? 'missing',
      activeMapId: this.assets?.activeMapId ?? this.assets?.map.id ?? 'metro_default',
      mapName: this.assets?.map.name ?? 'Unloaded',
      availableMaps: this.assets
        ? Object.values(this.assets.maps).map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
          }))
        : [],
      assetCounts: {
        textures: this.assets ? Object.keys(this.assets.textures).length : 0,
        models: this.assets ? Object.keys(this.assets.models).length : 0,
        audio: this.assets ? Object.keys(this.assets.audio).length : 0,
        materials: this.assets ? Object.keys(this.assets.materials).length : 0,
        media: this.assets ? Object.keys(this.assets.media).length : 0,
        lightbars: this.assets ? Object.keys(this.assets.lightbars).length : 0,
        maps: this.assets ? Object.keys(this.assets.maps).length : 0,
      },
      assetsLoaded: this.assetsLoaded,
      assetIssues: this.assetIssues,
      fatalError: this.fatalError,
    });
  }

  // --- AI Debug & World Instance Editor Live Bridge ---

  public getAIDebugFlags(): AIDebugFlags {
    return { ...this.aiDebugFlags };
  }

  public setAIDebugFlags(patch: Partial<AIDebugFlags>): void {
    this.aiDebugFlags = { ...this.aiDebugFlags, ...patch };
    this.aiDebugVisualizer.update(this.aiDebugFlags, {
      units: this.units,
      civilianCars: this.civilianCars,
      crimes: this.crimes,
      assailantsById: this.getAssailantsById(),
      pedestrians: this.pedestrians,
      roadGraph: this.roadGraph,
    });
  }

  public getAIDebugStats(): AIDebugStats {
    return this.aiDebugVisualizer.computeStats({
      units: this.units,
      civilianCars: this.civilianCars,
      crimes: this.crimes,
      roadGraph: this.roadGraph,
    });
  }

  public getWorldEntitiesSnapshot(): WorldEntitySummary[] {
    const out: WorldEntitySummary[] = [];
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();

    for (const u of this.units) {
      const crew = resolveUnitOfficers(u, officersById);
      const avgHp =
        crew.length > 0
          ? Math.round(crew.reduce((acc, o) => acc + o.hp, 0) / crew.length)
          : 100;
      const maxHp =
        crew.length > 0
          ? Math.round(crew.reduce((acc, o) => acc + o.maxHp, 0) / crew.length)
          : 100;
      const seated = u.seats.filter((s) => s.occupantOfficerId !== null).length;
      out.push({
        uid: `police:${u.id}`,
        kind: 'police',
        id: u.id,
        label: `${u.callsign} (${u.vehicleKind.toUpperCase()})`,
        statusText: `${u.status}${u.immobilized ? ' • IMMOB' : ''}${u.reverseTimer > 0 ? ' • REV' : ''} • ${seated}/${u.seats.length} seated`,
        x: Math.round(u.pos.x * 100) / 100,
        y: Math.round(u.pos.y * 100) / 100,
        z: Math.round(u.pos.z * 100) / 100,
        yaw: Math.round(u.yaw * 1000) / 1000,
        hp: avgHp,
        maxHp,
        immobilized: u.immobilized,
        lightsActive: u.lightsActive,
        sirensActive: u.sirensActive,
        mounted: u.mounted,
        extra: u.assignedCaseNumber ? `Case #${u.assignedCaseNumber}` : undefined,
      });
    }

    for (const off of this.officers) {
      out.push({
        uid: `officer:${off.id}`,
        kind: 'officer',
        id: off.id,
        label: `${off.isHeavy ? 'SWAT Cop' : 'Patrol Cop'} (${off.id})`,
        statusText:
          off.hp <= 0
            ? 'Incapacitated'
            : off.boardingState === 'seated'
            ? `Seated (${off.occupiedUnitId ?? 'unit'})`
            : `${off.weaponKind.toUpperCase()} • ${off.cowardiceState}`,
        x: Math.round(off.pos.x * 100) / 100,
        y: Math.round(off.pos.y * 100) / 100,
        z: Math.round(off.pos.z * 100) / 100,
        yaw: Math.round(off.yaw * 1000) / 1000,
        hp: Math.round(off.hp),
        maxHp: off.maxHp,
        mounted: off.boardingState === 'seated',
        extra: off.unitId ?? 'Standalone',
      });
    }

    for (const as of this.assailants) {
      out.push({
        uid: `assailant:${as.id}`,
        kind: 'assailant',
        id: as.id,
        label: `Assailant (${as.weaponKind.toUpperCase()}) • ${as.id}`,
        statusText: !as.alive
          ? 'Neutralized'
          : as.inVehicle
          ? 'In Getaway Vehicle'
          : 'Armed / Hostile',
        x: Math.round(as.pos.x * 100) / 100,
        y: Math.round(as.pos.y * 100) / 100,
        z: Math.round(as.pos.z * 100) / 100,
        yaw: Math.round(as.yaw * 1000) / 1000,
        hp: Math.round(as.hp),
        maxHp: as.maxHp,
        extra: as.crimeId ?? 'Standalone',
      });
    }

    for (const c of this.civilianCars) {
      out.push({
        uid: `traffic:${c.id}`,
        kind: 'traffic',
        id: c.id,
        label: `Traffic ${c.id}`,
        statusText: c.immobilized
          ? 'Immobilized'
          : c.reverseTimer > 0
          ? 'Reversing'
          : `${Math.round(Math.abs(c.speed) * 3.6)} km/h`,
        x: Math.round(c.pos.x * 100) / 100,
        y: Math.round(c.pos.y * 100) / 100,
        z: Math.round(c.pos.z * 100) / 100,
        yaw: Math.round(c.yaw * 1000) / 1000,
        immobilized: c.immobilized,
        extra: c.destinationNodeId !== undefined ? `-> Node ${c.destinationNodeId}` : undefined,
      });
    }

    this.pedestrians.forEach((p, idx) => {
      const pid = p.id || `ped-${idx + 1}`;
      out.push({
        uid: `ped:${pid}`,
        kind: 'ped',
        id: pid,
        label: `Pedestrian #${idx + 1}`,
        statusText: p.dead
          ? 'Deceased'
          : p.injured
          ? 'Injured'
          : `${p.activeGoal.replace(/_/g, ' ')}`,
        x: Math.round(p.pos.x * 100) / 100,
        y: Math.round(p.pos.y * 100) / 100,
        z: Math.round(p.pos.z * 100) / 100,
        yaw: Math.round(p.yaw * 1000) / 1000,
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
      });
    });

    for (const cr of this.crimes) {
      const primary = resolveCrimePrimaryAssailant(cr, assailantsById);
      const anyAlive = this.isCrimeActive(cr, assailantsById);
      const pos = cr.inVehiclePursuit && cr.vehicleRig ? cr.vehiclePos : primary?.pos ?? cr.pos;
      const yaw = cr.inVehiclePursuit && cr.vehicleRig ? cr.vehicleYaw : primary?.yaw ?? 0;
      out.push({
        uid: `crime:${cr.id}`,
        kind: 'crime',
        id: cr.id,
        label: `Case #${cr.caseNumber} (${cr.type})`,
        statusText: !anyAlive
          ? 'Neutralized'
          : cr.inVehiclePursuit
          ? `Pursuit • ${cr.urgencyLevel.toUpperCase()}`
          : `${cr.incidentStatus} • ${cr.urgencyLevel.toUpperCase()}`,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        z: Math.round(pos.z * 100) / 100,
        yaw: Math.round(yaw * 1000) / 1000,
        hp: Math.round(cr.inVehiclePursuit ? cr.vehicleHp : primary?.hp ?? 0),
        maxHp: 100,
        extra: cr.district,
      });
    }

    for (const nm of this.nailMats) {
      out.push({
        uid: `nail_mat:${nm.id}`,
        kind: 'nail_mat',
        id: nm.id,
        label: `Spike Strip (${nm.unitId})`,
        statusText: nm.phase,
        x: Math.round(nm.roadCenter.x * 100) / 100,
        y: Math.round(nm.roadCenter.y * 100) / 100,
        z: Math.round(nm.roadCenter.z * 100) / 100,
        yaw: nm.stagingYaw,
      });
    }

    return out;
  }

  public getWorldEntityObject(kind: WorldEntityKind, id: string): THREE.Object3D | undefined {
    if (kind === 'police') return this.units.find((u) => u.id === id)?.rig.root;
    if (kind === 'officer') return this.officers.find((o) => o.id === id)?.rig.root;
    if (kind === 'assailant') return this.assailants.find((a) => a.id === id)?.rig.root;
    if (kind === 'traffic') return this.civilianCars.find((c) => c.id === id)?.rig.root;
    if (kind === 'ped') {
      return (
        this.pedestrians.find((p) => p.id === id)?.rig.root ??
        this.pedestrians[Number(id.replace('ped-', '')) - 1]?.rig.root
      );
    }
    if (kind === 'crime') {
      const cr = this.crimes.find((c) => c.id === id);
      if (!cr) return undefined;
      if (cr.inVehiclePursuit && cr.vehicleRig) return cr.vehicleRig.root;
      return resolveCrimePrimaryAssailant(cr, this.getAssailantsById())?.rig.root;
    }
    if (kind === 'nail_mat') return this.nailMats.find((n) => n.id === id)?.group;
    return undefined;
  }

  public findWorldEntityByObject(obj: THREE.Object3D): { kind: WorldEntityKind; id: string } | null {
    const isAncestor = (root: THREE.Object3D | undefined): boolean => {
      if (!root) return false;
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (cur === root) return true;
        cur = cur.parent;
      }
      return false;
    };

    for (const o of this.officers) {
      if (o.boardingState === 'dismounted' && isAncestor(o.rig.root)) {
        return { kind: 'officer', id: o.id };
      }
    }
    for (const u of this.units) {
      if (isAncestor(u.rig.root)) return { kind: 'police', id: u.id };
    }
    for (const a of this.assailants) {
      if (isAncestor(a.rig.root)) return { kind: 'assailant', id: a.id };
    }
    for (const c of this.civilianCars) {
      if (isAncestor(c.rig.root)) return { kind: 'traffic', id: c.id };
    }
    for (let i = 0; i < this.pedestrians.length; i++) {
      if (isAncestor(this.pedestrians[i].rig.root)) {
        return { kind: 'ped', id: this.pedestrians[i].id || `ped-${i + 1}` };
      }
    }
    const assailantsById = this.getAssailantsById();
    for (const cr of this.crimes) {
      const primary = resolveCrimePrimaryAssailant(cr, assailantsById);
      if (isAncestor(cr.vehicleRig?.root) || isAncestor(primary?.rig.root)) {
        return { kind: 'crime', id: cr.id };
      }
    }
    for (const nm of this.nailMats) {
      if (isAncestor(nm.group)) return { kind: 'nail_mat', id: nm.id };
    }
    return null;
  }

  public spawnWorldEntity(
    kind:
      | 'police_sedan'
      | 'police_suv'
      | 'police_van'
      | 'police_apc'
      | 'officer_patrol'
      | 'officer_swat'
      | 'assailant_pistol'
      | 'assailant_rifle'
      | 'civilian'
      | 'pedestrian'
      | 'crime'
      | 'pursuit',
    pos?: { x: number; z: number },
  ): WorldEntitySummary | null {
    if (!this.assets || !this.config || !this.textures || !this.roadGraph) return null;
    const camTarget = this.cameraController?.controls.target;
    const x = pos?.x ?? camTarget?.x ?? 0;
    const z = pos?.z ?? camTarget?.z ?? 0;
    const surface = this.assets.map;
    const y = getSurfaceHeight(x, z, surface);

    if (kind === 'crime' || kind === 'pursuit') {
      const created = spawnCrime({
        forcePursuit: kind === 'pursuit',
        crimes: this.crimes,
        crimeCounter: this.crimeCounter,
        units: this.units,
        officersById: this.getOfficersById(),
        assailants: this.assailants,
        hierarchy: this.hierarchy,
        roadGraph: this.roadGraph,
        staticBvh: this.staticBvh,
        config: this.config,
        map: this.assets.map,
        assets: this.assets,
        textures: this.textures,
        drivingMode: this.drivingMode,
        audio: this.audio,
        rng: this.simRng,
        onAssetIssue: this.recordAssetIssue,
      });
      if (!created) return null;
      this.crimeCounter++;
      this.emitSnapshot();
      return this.getWorldEntitiesSnapshot().find((e) => e.id === created.id) ?? null;
    }

    if (kind === 'officer_patrol' || kind === 'officer_swat') {
      const isHeavy = kind === 'officer_swat';
      const weaponKind: 'pistol' | 'rifle' = isHeavy ? 'rifle' : 'pistol';
      const maxHp = isHeavy ? 150 : 100;
      const maxArmor = isHeavy ? 110 : 45;
      const id = `officer-spawn-${this.standaloneActorSeq++}`;
      const rig = createHumanoid(
        isHeavy ? 'heavy_officer' : 'officer',
        this.assets,
        this.textures,
        undefined,
        this.recordAssetIssue,
      );
      const spawnPos = new THREE.Vector3(x, y, z);
      this.staticBvh.resolveCircle(spawnPos, 0.45);
      spawnPos.y = getSurfaceHeight(spawnPos.x, spawnPos.z, surface);
      rig.root.position.copy(spawnPos);
      rig.root.userData.officerId = id;
      this.hierarchy.addEntity(rig.root);

      const officer: OfficerActor = {
        id,
        unitId: null,
        occupiedUnitId: null,
        occupiedSeatIndex: null,
        boardingState: 'dismounted',
        targetUnitId: null,
        targetSeatIndex: null,
        assignedCrimeId: null,
        rig,
        pos: spawnPos,
        yaw: 0,
        hp: maxHp,
        maxHp,
        armor: maxArmor,
        maxArmor,
        weaponKind,
        isHeavy,
        morale: 100,
        cowardiceState: 'steady',
        ragdoll: createRagdollState(),
        fireCooldown: 0.2,
        muzzleTimer: 0,
        walkPhase: 0,
        ammo: this.config.weapons[weaponKind].magSize,
        reloadTimer: 0,
        recoilKick: 0,
        strafeSign: 1,
        strafeTimer: 1.5,
        roamTarget: null,
        roamTimer: 0,
        roamPauseTimer: 0,
        mountPhase: 'walk',
        boardTimer: 0,
        locationState: 'field',
      };
      this.officers.push(officer);
      this.emitSnapshot();
      return this.getWorldEntitiesSnapshot().find((e) => e.id === id) ?? null;
    }

    if (kind === 'assailant_pistol' || kind === 'assailant_rifle') {
      const weaponKind: 'pistol' | 'rifle' = kind === 'assailant_rifle' ? 'rifle' : 'pistol';
      const maxArmor = weaponKind === 'rifle' ? 40 : 15;
      const id = `assailant-spawn-${this.standaloneActorSeq++}`;
      const rig = createHumanoid(
        'suspect',
        this.assets,
        this.textures,
        undefined,
        this.recordAssetIssue,
      );
      const spawnPos = new THREE.Vector3(x, y, z);
      this.staticBvh.resolveCircle(spawnPos, 0.48);
      spawnPos.y = getSurfaceHeight(spawnPos.x, spawnPos.z, surface);
      rig.root.position.copy(spawnPos);
      rig.root.userData.assailantId = id;
      this.hierarchy.addEntity(rig.root);

      const assailant: AssailantActor = {
        id,
        crimeId: null,
        rig,
        pos: spawnPos,
        yaw: 0,
        hp: 100,
        maxHp: 100,
        armor: maxArmor,
        maxArmor,
        weaponKind,
        alive: true,
        inVehicle: false,
        ammo: this.config.weapons[weaponKind].magSize,
        reloadTimer: 0,
        recoilKick: 0,
        strafeDir: 1,
        moveTimer: 1.5,
        walkPhase: 0,
        ragdoll: createRagdollState(),
        lastHitDir: new THREE.Vector3(0, 0, 1),
        fireCooldown: 0.45,
        muzzleTimer: 0,
        roamTarget: null,
        roamTimer: 0,
      };
      this.assailants.push(assailant);
      this.emitSnapshot();
      return this.getWorldEntitiesSnapshot().find((e) => e.id === id) ?? null;
    }

    if (kind === 'pedestrian') {
      const pool = this.config.world.pedestrianModels ?? ['pedestrian_humanoid'];
      const pedModel = pool[this.pedestrians.length % pool.length];
      const shirtHex = parseInt(
        (this.config.world.pedestrianShirtColors[0] ?? '#475569').replace('#', ''),
        16,
      );
      const rig = createHumanoid(
        'pedestrian',
        this.assets,
        this.textures,
        pedModel === 'pedestrian_humanoid' ? shirtHex : undefined,
        this.recordAssetIssue,
        pedModel,
      );
      const spawnPos = new THREE.Vector3(x, y, z);
      this.staticBvh.resolveCircle(spawnPos, 0.45);
      spawnPos.y = getSurfaceHeight(spawnPos.x, spawnPos.z, surface);
      rig.root.position.copy(spawnPos);
      this.hierarchy.addEntity(rig.root);
      const pid = `ped-spawn-${this.standaloneActorSeq++}`;
      this.pedestrians.push({
        id: pid,
        rig,
        pos: spawnPos,
        yaw: 0,
        velX: 0,
        velZ: 0,
        jumpY: 0,
        jumpVelY: 0,
        activeGoal: 'SIDEWALK_STROLL',
        blockCx: spawnPos.x,
        blockCz: spawnPos.z,
        loopRadius: 12,
        loopRect: { cx: spawnPos.x, cz: spawnPos.z, halfW: 12, halfD: 12 },
        cornerIdx: 0,
        dir: 1,
        walkPhase: 0,
        panicTimer: 0,
        hp: 100,
        maxHp: 100,
        injured: false,
        dead: false,
        ragdoll: createRagdollState(),
      });
      this.emitSnapshot();
      return this.getWorldEntitiesSnapshot().find((e) => e.id === pid) ?? null;
    }

    if (kind === 'civilian') {
      const variants = this.config.world.civilianVariants;
      const variant = variants[this.civilianCars.length % variants.length] ?? 'sedan';
      const colors = this.config.world.civilianColors;
      const colorHex = parseInt(
        (colors[this.civilianCars.length % colors.length] ?? '#94a3b8').replace('#', ''),
        16,
      );
      const rig = createCivilianCar(
        variant,
        colorHex,
        this.assets,
        this.textures,
        this.recordAssetIssue,
      );
      const nearest = this.roadGraph.findNearestNode(x, z);
      const nextId = nearest.neighbors[0] ?? nearest.id;
      const spawnPos = new THREE.Vector3(x, y, z);
      rig.root.position.copy(spawnPos);
      this.hierarchy.addEntity(rig.root);
      const id = `civ-spawn-${this.standaloneActorSeq++}`;
      const reachable = this.roadGraph
        .getReachableNodeIds(nearest.id)
        .filter((nid) => nid !== nearest.id && nid !== nextId);
      const destId = reachable[0] ?? nextId;
      const plan = destId !== nextId ? this.roadGraph.findNodePath(nextId, destId) : [];

      this.civilianCars.push({
        id,
        rig,
        pos: spawnPos,
        yaw: 0,
        speed: 4,
        dyn: createVehicleDynState(),
        maxSpeed: 10,
        currentNodeId: nearest.id,
        nextNodeId: nextId,
        prevNodeId: nearest.id,
        routeQueue: plan.slice(1).map((n) => n.id),
        destinationNodeId: destId,
        junctionPauseTimer: 0,
        junctionWaitNodeId: undefined,
        turnApex: null,
        lateralYield: 0,
        stunTimer: 0,
        impatience: 0,
        patienceRate: 0.2,
        stuckTimer: 0,
        reverseTimer: 0,
        reverseSteerDir: 1,
        stallCount: 0,
        immobilized: false,
        immobilizeTilt: 0,
        damageSmokeTimer: 0,
        smokeAccum: 0,
      });
      this.emitSnapshot();
      return this.getWorldEntitiesSnapshot().find((e) => e.id === id) ?? null;
    }

    // Spawn Police Unit with real seated crew & vehicle seats/hinges
    const vehicleKind: PoliceVehicleKind =
      kind === 'police_apc'
        ? 'apc'
        : kind === 'police_van'
        ? 'van'
        : kind === 'police_suv'
        ? 'suv'
        : 'sedan';
    const isHeavy = vehicleKind === 'van' || vehicleKind === 'apc';
    const liveryId = isHeavy ? 'tactical_swat' : 'classic_bw';
    const weaponKind: 'rifle' | 'pistol' = isHeavy ? 'rifle' : 'pistol';
    const unitNum = this.units.length + 1;
    const id = `unit-spawn-${this.standaloneActorSeq++}`;
    const rig = createPoliceCruiser(
      unitNum,
      vehicleKind,
      liveryId,
      this.config.vehicles,
      this.assets,
      this.textures,
      this.isSoftwareGl,
      undefined,
      this.recordAssetIssue,
    );
    rig.cabinCrewGroup.visible = false;
    const spawnPos = new THREE.Vector3(x, y, z);
    rig.root.position.copy(spawnPos);
    rig.clickableMesh.userData.unitId = id;
    this.hierarchy.addEntity(rig.root);
    this.clickables.push(rig.clickableMesh);

    const chassis =
      this.config.vehicles.chassis[vehicleKind] ?? this.config.vehicles.chassis.sedan;
    const maxHp = vehicleKind === 'apc' ? 185 : isHeavy ? 160 : 100;
    const maxArmor = vehicleKind === 'apc' ? 150 : isHeavy ? 120 : 45;
    const magSize = this.config.weapons[weaponKind].magSize;

    const seats = rig.seats.map((s, idx) => ({
      slotIndex: idx,
      role: s.spec.role,
      spec: s.spec,
      localOffset: s.localOffset.clone(),
      enterOffset: new THREE.Vector3(
        ...(s.spec.enterOffset ?? [s.localOffset.x >= 0 ? 1.45 : -1.45, 0, s.localOffset.z]),
      ),
      exitOffset: new THREE.Vector3(
        ...(s.spec.exitOffset ?? [s.localOffset.x >= 0 ? 1.45 : -1.45, 0, s.localOffset.z]),
      ),
      hingePartId: s.spec.hingePartId,
      hingeRef: s.spec.hingePartId ? rig.hinges[s.spec.hingePartId] : undefined,
      seatedPitch: s.spec.seatedPitch ?? -1.48,
      occupantOfficerId: null as string | null,
      doorOpenTimer: 0,
    }));

    const refBayIdx = Math.max(0, Math.min(this.config.vehicles.stationBays.length - 1, 0));
    const unit: PoliceUnit = {
      id,
      callsign: `UNIT-${unitNum}`,
      bayIndex: refBayIdx,
      vehicleKind,
      liveryId,
      lightbarId: this.activeLightbarId,
      baseColorHex: 0x0f172a,
      isHeavyUnit: isHeavy,
      weaponKind,
      wheelRadius: chassis.wheelRadius,
      halfW: chassis.halfW,
      halfL: chassis.halfL,
      mass: chassis.mass,
      rig,
      pos: spawnPos,
      yaw: 0,
      speed: 0,
      dyn: createVehicleDynState(),
      lateralOffset: 0,
      status: UnitStatus.Engaging,
      activeGoal: 'MANUAL_FOOT_PATROL',
      goalReason: 'Spawned in world editor',
      mounted: true,
      freeRoam: true,
      dismountTimer: 0,
      mountTimer: 0,
      immobilized: false,
      immobilizeTilt: 0,
      lightsActive: true,
      sirensActive: false,
      waypoints: [],
      waypointIndex: 0,
      repathTimer: 0,
      avoidanceSteer: 0,
      damageSmokeTimer: 0,
      smokeAccum: 0,
      lightPhaseOffset: unitNum * 0.4,
      lightRateMult: 1,
      targetCrimeId: null,
      assignedCaseNumber: null,
      assignedRole: null,
      pursuitRole: 'direct',
      officerRefs: [],
      seats,
      hinges: rig.hinges,
      holdTimer: 0,
      stuckTimer: 0,
      impatience: 0,
      reverseTimer: 0,
      reverseSteerDir: 1,
      stallCount: 0,
      towRequested: false,
      beingTowed: false,
      patrolTimer: 0,
      patrolTargetNodeId: null,
      stalledGoalTimer: 0,
      bayApproachTimer: 0,
    };

    const crewCount = Math.min(2, Math.max(1, seats.length || 2));
    for (let sIdx = 0; sIdx < crewCount; sIdx++) {
      const offId = `officer-spawn-${this.standaloneActorSeq++}`;
      const oRig = createHumanoid(
        isHeavy ? 'heavy_officer' : 'officer',
        this.assets,
        this.textures,
        undefined,
        this.recordAssetIssue,
      );
      oRig.root.userData.unitId = id;
      oRig.root.userData.officerId = offId;
      this.hierarchy.addEntity(oRig.root);
      const officer: OfficerActor = {
        id: offId,
        unitId: id,
        occupiedUnitId: null,
        occupiedSeatIndex: null,
        boardingState: 'dismounted',
        targetUnitId: id,
        targetSeatIndex: sIdx,
        assignedCrimeId: null,
        rig: oRig,
        pos: spawnPos.clone(),
        yaw: 0,
        hp: maxHp,
        maxHp,
        armor: maxArmor,
        maxArmor,
        weaponKind,
        isHeavy,
        morale: 100,
        cowardiceState: 'steady',
        ragdoll: createRagdollState(),
        fireCooldown: 0.25,
        muzzleTimer: 0,
        walkPhase: 0,
        ammo: magSize,
        reloadTimer: 0,
        recoilKick: 0,
        strafeSign: sIdx % 2 === 0 ? 1 : -1,
        strafeTimer: 1.5,
        roamTarget: null,
        roamTimer: 0,
        roamPauseTimer: 0,
        mountPhase: 'walk',
        boardTimer: 0,
        locationState: 'field',
      };
      this.officers.push(officer);
      unit.officerRefs.push(offId);
      assignOfficerToUnitSeat(officer, unit, sIdx < seats.length ? sIdx : undefined);
    }

    this.units.push(unit);
    this.emitSnapshot();
    return this.getWorldEntitiesSnapshot().find((e) => e.id === id) ?? null;
  }

  public deleteWorldEntity(kind: WorldEntityKind, id: string): boolean {
    if (kind === 'police') {
      const idx = this.units.findIndex((u) => u.id === id);
      if (idx < 0) return false;
      const [u] = this.units.splice(idx, 1);
      for (const oid of u.officerRefs) {
        const oIdx = this.officers.findIndex((o) => o.id === oid);
        if (oIdx >= 0) {
          const [off] = this.officers.splice(oIdx, 1);
          this.hierarchy.removeEntity(off.rig.root);
        }
      }
      this.hierarchy.removeEntity(u.rig.root);
      if (this.selectedUnitId === id && this.units.length > 0) {
        this.selectedUnitId = this.units[0].id;
      }
      this.emitSnapshot();
      return true;
    }
    if (kind === 'officer') {
      const idx = this.officers.findIndex((o) => o.id === id);
      if (idx < 0) return false;
      const [off] = this.officers.splice(idx, 1);
      if (off.occupiedUnitId) {
        const owner = this.units.find((u) => u.id === off.occupiedUnitId);
        if (owner) {
          for (const seat of owner.seats) {
            if (seat.occupantOfficerId === off.id) seat.occupantOfficerId = null;
          }
          owner.officerRefs = owner.officerRefs.filter((oid) => oid !== off.id);
        }
      }
      if (off.unitId) {
        const unit = this.units.find((u) => u.id === off.unitId);
        if (unit) unit.officerRefs = unit.officerRefs.filter((oid) => oid !== off.id);
      }
      this.hierarchy.removeEntity(off.rig.root);
      this.emitSnapshot();
      return true;
    }
    if (kind === 'assailant') {
      const idx = this.assailants.findIndex((a) => a.id === id);
      if (idx < 0) return false;
      const [as] = this.assailants.splice(idx, 1);
      if (as.crimeId) {
        const cr = this.crimes.find((c) => c.id === as.crimeId);
        if (cr) {
          cr.assailantRefs = cr.assailantRefs.filter((aid) => aid !== as.id);
          if (cr.primaryAssailantId === as.id) {
            cr.primaryAssailantId = cr.assailantRefs[0] ?? null;
          }
        }
      }
      this.hierarchy.removeEntity(as.rig.root);
      this.emitSnapshot();
      return true;
    }
    if (kind === 'traffic') {
      const idx = this.civilianCars.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      const [car] = this.civilianCars.splice(idx, 1);
      this.hierarchy.removeEntity(car.rig.root);
      this.emitSnapshot();
      return true;
    }
    if (kind === 'ped') {
      let idx = this.pedestrians.findIndex((p) => p.id === id);
      if (idx < 0) idx = Number(id.replace('ped-', '')) - 1;
      if (idx < 0 || idx >= this.pedestrians.length) return false;
      const [ped] = this.pedestrians.splice(idx, 1);
      this.hierarchy.removeEntity(ped.rig.root);
      this.emitSnapshot();
      return true;
    }
    if (kind === 'crime') {
      const idx = this.crimes.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      const [cr] = this.crimes.splice(idx, 1);
      for (const aid of cr.assailantRefs) {
        const aIdx = this.assailants.findIndex((a) => a.id === aid);
        if (aIdx >= 0) {
          const [as] = this.assailants.splice(aIdx, 1);
          this.hierarchy.removeEntity(as.rig.root);
        }
      }
      if (cr.vehicleRig) this.hierarchy.removeEntity(cr.vehicleRig.root);
      for (const u of this.units) {
        if (u.targetCrimeId === id) {
          u.targetCrimeId = null;
          u.assignedCaseNumber = null;
        }
      }
      this.emitSnapshot();
      return true;
    }
    if (kind === 'nail_mat') {
      const idx = this.nailMats.findIndex((n) => n.id === id);
      if (idx < 0) return false;
      const [nm] = this.nailMats.splice(idx, 1);
      this.hierarchy.removeEntity(nm.group);
      this.emitSnapshot();
      return true;
    }
    return false;
  }

  public modifyWorldEntity(
    kind: WorldEntityKind,
    id: string,
    action:
      | 'repair_heal'
      | 'toggle_lights'
      | 'toggle_siren'
      | 'toggle_mount'
      | 'clear_impatience'
      | 'board_nearest_unit'
      | 'eject_seat'
      | 'set_transform',
    transform?: { x?: number; y?: number; z?: number; yaw?: number },
  ): boolean {
    const officersById = this.getOfficersById();
    const assailantsById = this.getAssailantsById();

    if (kind === 'police') {
      const u = this.units.find((item) => item.id === id);
      if (!u) return false;
      if (action === 'set_transform' && transform) {
        if (transform.x !== undefined) u.pos.x = transform.x;
        if (transform.y !== undefined) u.pos.y = transform.y;
        if (transform.z !== undefined) u.pos.z = transform.z;
        if (transform.yaw !== undefined) u.yaw = transform.yaw;
        u.rig.root.position.copy(u.pos);
        u.rig.root.rotation.y = u.yaw;
        return true;
      }
      if (action === 'repair_heal') {
        u.immobilized = false;
        u.immobilizeTilt = 0;
        u.damageSmokeTimer = 0;
        u.rig.bodyGroup.rotation.set(0, 0, 0);
        u.rig.lightbar.detached = false;
        u.rig.lightbar.group.visible = true;
        u.rig.wheels.forEach((w) => {
          w.userData.bentAmount = 0;
          w.rotation.z = 0;
        });
        resolveUnitOfficers(u, officersById).forEach((o) => {
          o.hp = o.maxHp;
          o.armor = o.maxArmor;
          o.morale = 100;
          o.cowardiceState = 'steady';
          o.ragdoll.active = false;
          if (o.boardingState === 'dismounted') {
            resetOfficerPose(o, u.yaw);
          }
        });
      } else if (action === 'toggle_lights') {
        u.lightsActive = !u.lightsActive;
      } else if (action === 'toggle_siren') {
        u.sirensActive = !u.sirensActive;
      } else if (action === 'toggle_mount' && this.config) {
        if (u.mounted) {
          dismountUnit(
            u,
            officersById,
            this.cowardiceLevel,
            this.staticBvh,
            this.config,
            this.simRng,
            true,
            this.assets?.map,
            this.hierarchy,
          );
        } else {
          u.mounted = true;
          u.freeRoam = false;
          resolveUnitOfficers(u, officersById).forEach((o, sIdx) => {
            o.ragdoll.active = false;
            assignOfficerToUnitSeat(o, u, sIdx < u.seats.length ? sIdx : undefined);
          });
          u.status = UnitStatus.Engaging;
        }
      } else if (action === 'clear_impatience') {
        u.impatience = 0;
        u.stuckTimer = 0;
        u.reverseTimer = 0;
      }
      this.emitSnapshot();
      return true;
    }

    if (kind === 'officer') {
      const off = this.officers.find((item) => item.id === id);
      if (!off) return false;
      if (action === 'set_transform' && transform) {
        if (off.boardingState === 'seated' && off.occupiedUnitId) {
          const unit = this.units.find((u) => u.id === off.occupiedUnitId);
          if (unit && this.assets) {
            ejectOfficerFromSeat(off, unit, this.staticBvh, this.assets.map, this.hierarchy);
          }
        }
        if (transform.x !== undefined) off.pos.x = transform.x;
        if (transform.y !== undefined) off.pos.y = transform.y;
        if (transform.z !== undefined) off.pos.z = transform.z;
        if (transform.yaw !== undefined) off.yaw = transform.yaw;
        off.rig.root.position.copy(off.pos);
        off.rig.root.rotation.y = off.yaw;
        return true;
      }
      if (action === 'repair_heal') {
        off.hp = off.maxHp;
        off.armor = off.maxArmor;
        off.morale = 100;
        off.cowardiceState = 'steady';
        off.ragdoll.active = false;
        if (off.boardingState === 'dismounted') {
          resetOfficerPose(off, off.yaw);
        }
      } else if (action === 'eject_seat' && off.occupiedUnitId && this.assets) {
        const unit = this.units.find((u) => u.id === off.occupiedUnitId);
        if (unit) {
          ejectOfficerFromSeat(off, unit, this.staticBvh, this.assets.map, this.hierarchy);
        }
      } else if (action === 'board_nearest_unit') {
        let bestUnit: PoliceUnit | null = null;
        let bestDistSq = Infinity;
        for (const u of this.units) {
          if (u.seats.every((s) => s.occupantOfficerId !== null)) continue;
          const dSq = u.pos.distanceToSquared(off.pos);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestUnit = u;
          }
        }
        if (bestUnit) {
          assignOfficerToUnitSeat(off, bestUnit);
        }
      }
      this.emitSnapshot();
      return true;
    }

    if (kind === 'assailant') {
      const as = this.assailants.find((item) => item.id === id);
      if (!as) return false;
      if (action === 'set_transform' && transform) {
        if (transform.x !== undefined) as.pos.x = transform.x;
        if (transform.y !== undefined) as.pos.y = transform.y;
        if (transform.z !== undefined) as.pos.z = transform.z;
        if (transform.yaw !== undefined) as.yaw = transform.yaw;
        as.rig.root.position.copy(as.pos);
        as.rig.root.rotation.y = as.yaw;
        return true;
      }
      if (action === 'repair_heal') {
        as.hp = as.maxHp;
        as.armor = as.maxArmor;
        as.alive = true;
        as.ragdoll.active = false;
        as.rig.root.rotation.set(0, as.yaw, 0);
        if (as.rig.threatRing) as.rig.threatRing.visible = !as.inVehicle;
      }
      this.emitSnapshot();
      return true;
    }

    if (kind === 'traffic') {
      const car = this.civilianCars.find((c) => c.id === id);
      if (!car) return false;
      if (action === 'set_transform' && transform) {
        if (transform.x !== undefined) car.pos.x = transform.x;
        if (transform.y !== undefined) car.pos.y = transform.y;
        if (transform.z !== undefined) car.pos.z = transform.z;
        if (transform.yaw !== undefined) car.yaw = transform.yaw;
        car.rig.root.position.copy(car.pos);
        car.rig.root.rotation.y = car.yaw;
        return true;
      }
      if (action === 'repair_heal') {
        car.immobilized = false;
        car.stunTimer = 0;
        car.damageSmokeTimer = 0;
        car.rig.bodyGroup.rotation.set(0, 0, 0);
      } else if (action === 'clear_impatience') {
        car.impatience = 0;
        car.stuckTimer = 0;
        car.reverseTimer = 0;
      }
      this.emitSnapshot();
      return true;
    }

    if (kind === 'ped') {
      const idx = Number(id.replace('ped-', '')) - 1;
      const ped = this.pedestrians.find((p) => p.id === id) ?? this.pedestrians[idx];
      if (!ped) return false;
      if (action === 'set_transform' && transform) {
        if (transform.x !== undefined) ped.pos.x = transform.x;
        if (transform.y !== undefined) ped.pos.y = transform.y;
        if (transform.z !== undefined) ped.pos.z = transform.z;
        if (transform.yaw !== undefined) ped.yaw = transform.yaw;
        ped.rig.root.position.copy(ped.pos);
        ped.rig.root.rotation.y = ped.yaw;
        return true;
      }
      if (action === 'repair_heal') {
        ped.hp = ped.maxHp;
        ped.dead = false;
        ped.injured = false;
        ped.ragdoll.active = false;
        ped.rig.root.rotation.set(0, ped.yaw, 0);
      }
      this.emitSnapshot();
      return true;
    }

    if (kind === 'crime') {
      const cr = this.crimes.find((c) => c.id === id);
      if (!cr) return false;
      const primary = resolveCrimePrimaryAssailant(cr, assailantsById);
      if (action === 'set_transform' && transform) {
        if (cr.inVehiclePursuit && cr.vehicleRig) {
          if (transform.x !== undefined) cr.vehiclePos.x = transform.x;
          if (transform.y !== undefined) cr.vehiclePos.y = transform.y;
          if (transform.z !== undefined) cr.vehiclePos.z = transform.z;
          if (transform.yaw !== undefined) cr.vehicleYaw = transform.yaw;
          cr.vehicleRig.root.position.copy(cr.vehiclePos);
          cr.vehicleRig.root.rotation.y = cr.vehicleYaw;
        } else if (primary) {
          if (transform.x !== undefined) primary.pos.x = transform.x;
          if (transform.y !== undefined) primary.pos.y = transform.y;
          if (transform.z !== undefined) primary.pos.z = transform.z;
          if (transform.yaw !== undefined) primary.yaw = transform.yaw;
          primary.rig.root.position.copy(primary.pos);
          primary.rig.root.rotation.y = primary.yaw;
        }
        return true;
      }
      if (action === 'repair_heal') {
        for (const aid of cr.assailantRefs) {
          const as = assailantsById.get(aid);
          if (as) {
            as.hp = as.maxHp;
            as.armor = as.maxArmor;
            as.alive = true;
            as.ragdoll.active = false;
            as.rig.root.rotation.set(0, as.yaw, 0);
          }
        }
        cr.vehicleHp = 100;
        cr.vehicleImmobilized = false;
      }
      this.emitSnapshot();
      return true;
    }

    return false;
  }

  public focusWorldEntity(kind: WorldEntityKind, id: string): void {
    const obj = this.getWorldEntityObject(kind, id);
    if (!obj || !this.cameraController) return;
    const p = obj.position;
    this.cameraController.focusTarget(p.x, p.y + 0.8, p.z, p.x + 14, p.y + 11, p.z + 14);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointerdown', this.handleGlobalGestureUnlock);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.devEditor?.dispose();
    this.aiDebugVisualizer.dispose();
    this.cameraController?.dispose();
    this.audio?.dispose();
    this.textures?.dispose();
    if (this.assets?.media) {
      revokeMediaObjectUrls(this.assets.media);
    }
    disposeLiveryTextureCache();
    this.vfx.dispose();
    this.combat.dispose();
    this.crashPhysics.dispose();
    this.hierarchy.clearAllLayers();

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
