import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AssetIssue,
  AssetLoadResult,
  EngineConfigAsset,
  LoadedJsonAssets,
} from '../assets/assetTypes';
import { loadJsonAssetBundle } from '../assets/jsonAssetLoader';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { mulberry32 } from '../assets/prng';
import { TextureRegistry } from '../assets/textureRegistry';
import {
  evaluateCrimeBackupPolicy,
  getCrimeUnitCounts,
  requestManualBackup,
  requestManualNailMat,
} from './backupSystem';
import { StaticObstacleBVH } from './bvh';
import { SimCameraController } from './cameraController';
import { CombatSystem } from './combatSystem';
import { spawnCrime, updateCrimes } from './crimeSystem';
import { updateNailMats } from './nailMatSystem';
import {
  buildAllVehicleProxies,
  dismountUnit,
  spawnPoliceUnits,
  updatePoliceUnits,
} from './policeUnitSystem';
import { TownRoadGraph } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  ActiveCrime,
  CivilianVehicle,
  NailMatActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { buildTownEnvironment, TownEnvironmentHandles } from './townBuilder';
import {
  spawnCivilianTraffic,
  spawnPedestrians,
  updateCivilianTraffic,
  updatePedestrians,
} from './trafficSystem';
import {
  BackupMode,
  CameraMode,
  CrimeSummary,
  DrivingMode,
  LightbarMode,
  PaintSwatchSummary,
  SimSnapshot,
  SirenPattern,
  UnitStatus,
  WeatherCondition,
} from './types';
import { disposeLiveryTextureCache } from './vehicleModels';
import {
  VehicleCollisionEntry,
  VehicleCrashPhysicsSystem,
} from './vehiclePhysics';
import { SimVfxManager } from './vfx';
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
  audioEnabled?: boolean;
  simSpeed?: 1 | 2;
  weather?: WeatherCondition;
  backupMode?: BackupMode;
}

export class PoliceSimEngine {
  private container: HTMLElement;
  private onSnapshot: (snap: SimSnapshot) => void;
  private onWebGLContextLost: (lost: boolean) => void;

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

  private units: PoliceUnit[] = [];
  private crimes: ActiveCrime[] = [];
  private nailMats: NailMatActor[] = [];
  private civilianCars: CivilianVehicle[] = [];
  private pedestrians: PedestrianActor[] = [];
  private clickables: THREE.Object3D[] = [];
  private paintPalette: PaintSwatchSummary[] = [];

  private lightbarMode: LightbarMode = LightbarMode.LED;
  private sirenPattern: SirenPattern = SirenPattern.AutoCycle;
  private drivingMode: DrivingMode = DrivingMode.Standard;
  private backupMode: BackupMode = BackupMode.Standard;
  private weather: WeatherCondition = WeatherCondition.Clear;
  private selectedUnitId = 'unit-1';
  private crimeProbability = 0.25;
  private cowardiceLevel = 0.35;
  private audioWanted = true;
  private simSpeed: 1 | 2 = 1;
  private neutralizedCount = 0;

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
  ) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    this.onWebGLContextLost = onWebGLContextLost;

    if (initialSettings) {
      if (initialSettings.audioEnabled !== undefined) {
        this.audioWanted = initialSettings.audioEnabled;
      }
      if (initialSettings.simSpeed !== undefined) {
        this.simSpeed = initialSettings.simSpeed;
      }
      if (initialSettings.weather !== undefined) {
        this.weather = initialSettings.weather;
      }
      if (initialSettings.backupMode !== undefined) {
        this.backupMode = initialSettings.backupMode;
      }
    }

    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
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
    this.weatherSystem = new WeatherSystem(
      this.scene,
      this.hierarchy.world.atmosphere,
      this.renderer,
      this.isSoftwareGl,
      this.simRng,
    );

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
    this.assets = assets;
    this.config = config;
    this.simRng = mulberry32(20261116);

    this.paintPalette = config.vehicles.paintPalette.map((sw) => ({
      id: sw.id,
      label: sw.label,
      hex: parseInt(sw.color.replace('#', ''), 16),
    }));
    this.crimeProbability = config.simulation.defaultCrimeProbability;
    this.cowardiceLevel = config.simulation.defaultCowardiceLevel;

    const textures = new TextureRegistry(
      this.renderer,
      assets,
      this.recordAssetIssue,
    );
    this.textures = textures;
    this.vfx.configure(textures, config.world);
    this.combat.configure(config);

    if (!this.audio) {
      this.audio = new JsonAudioSynth(assets.audio, this.audioWanted);
      this.audio.unlockOnGesture();
    } else {
      this.audio.setAudioAssets(assets.audio);
      this.audio.setEnabled(this.audioWanted);
    }

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

    this.roadGraph = new TownRoadGraph(config.world);
    this.envHandles = buildTownEnvironment(
      this.hierarchy,
      config.world,
      textures,
    );
    this.staticBvh.build(this.envHandles.obstacles);

    this.units = spawnPoliceUnits(
      this.hierarchy,
      config,
      assets,
      textures,
      this.isSoftwareGl,
      this.simRng,
      this.clickables,
      this.recordAssetIssue,
    );
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
    );
    this.pedestrians = spawnPedestrians(
      this.hierarchy,
      config.world,
      this.staticBvh,
      assets,
      textures,
      this.simRng,
      this.recordAssetIssue,
    );

    this.weatherSystem.applyWeather(
      this.weather,
      config.weatherPresets,
      this.envHandles,
      this.audio,
    );

    if (!this.isSoftwareGl && this.cameraController) {
      this.renderer.compile(this.scene, this.cameraController.camera);
    }

    this.assetsLoaded = true;
    this.emitSnapshot();
    this.clock.getDelta();
    this.tick();
  }

  public getLoadedAssets(): LoadedJsonAssets | null {
    return this.assets;
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

  public setLightbarMode(mode: LightbarMode): void {
    this.lightbarMode = mode;
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

  public requestBackupNow(): void {
    if (!this.config || !this.roadGraph) return;
    const selected = this.units.find((u) => u.id === this.selectedUnitId);
    const preferredCrime = selected?.targetCrimeId
      ? this.crimes.find((c) => c.id === selected.targetCrimeId && c.suspectAlive)
      : undefined;
    const crime = preferredCrime ?? this.crimes.find((c) => c.suspectAlive);
    if (!crime) return;
    if (
      requestManualBackup(
        crime,
        this.units,
        this.roadGraph,
        this.config,
        this.drivingMode,
        this.audio,
      )
    ) {
      this.emitSnapshot();
    }
  }

  public deployNailMatNow(): void {
    if (!this.config || !this.roadGraph) return;
    const selected = this.units.find((u) => u.id === this.selectedUnitId);
    const preferredCrime = selected?.targetCrimeId
      ? this.crimes.find(
          (c) =>
            c.id === selected.targetCrimeId && c.suspectAlive && c.inVehiclePursuit,
        )
      : undefined;
    const crime =
      preferredCrime ?? this.crimes.find((c) => c.suspectAlive && c.inVehiclePursuit);
    if (!crime) return;
    if (
      requestManualNailMat(
        crime,
        this.units,
        this.nailMats,
        this.roadGraph,
        this.config,
        this.hierarchy.entities.nailMats,
        this.audio,
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
    this.crimeProbability = THREE.MathUtils.clamp(prob, 0, 1);
    this.emitSnapshot();
  }

  public setCowardiceLevel(level: number): void {
    this.cowardiceLevel = THREE.MathUtils.clamp(level, 0, 1);
    this.emitSnapshot();
  }

  public setAudioEnabled(enabled: boolean): void {
    this.audioWanted = enabled;
    this.audio?.setEnabled(enabled);
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

    if (unit.mounted) {
      dismountUnit(
        unit,
        this.cowardiceLevel,
        this.staticBvh,
        this.config,
        this.simRng,
        true,
      );
    } else if (
      !unit.immobilized &&
      (unit.status === UnitStatus.Dismounting || unit.status === UnitStatus.Engaging)
    ) {
      unit.freeRoam = false;
      unit.mountTimer = 0;
      unit.officers.forEach((o) => {
        o.mountPhase = 'walk';
        o.boardTimer = 0;
      });
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
      hierarchy: this.hierarchy,
      roadGraph: this.roadGraph,
      staticBvh: this.staticBvh,
      config: this.config,
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

    for (const c of this.crimes) {
      evaluateCrimeBackupPolicy(
        c,
        this.units,
        this.nailMats,
        roadGraph,
        config,
        this.hierarchy.entities.nailMats,
        this.backupMode,
        this.drivingMode,
        this.audio,
      );
    }

    const allVehicles = buildAllVehicleProxies(
      this.units,
      this.civilianCars,
      this.crimes,
    );

    updatePoliceUnits(
      {
        units: this.units,
        crimes: this.crimes,
        pedestrians: this.pedestrians,
        allVehicles,
        roadGraph,
        staticBvh: this.staticBvh,
        config,
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

    updateNailMats(
      this.nailMats,
      this.units,
      this.crimes,
      this.civilianCars,
      roadGraph,
      this.staticBvh,
      config,
      this.vfx,
      this.audio,
      this.hierarchy.entities.nailMats,
      this.simTime,
      this.simRng,
      dt,
    );

    updateCrimes(
      {
        crimes: this.crimes,
        units: this.units,
        pedestrians: this.pedestrians,
        allVehicles,
        nailMats: this.nailMats,
        hierarchy: this.hierarchy,
        roadGraph,
        staticBvh: this.staticBvh,
        config,
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
      config.world,
      this.combat,
      this.vfx,
      this.weather,
      this.simRng,
      dt,
    );

    this.resolveAllVehicleCollisions(dt);
    this.crashPhysics.stepDebris(this.staticBvh, dt);
    updatePedestrians(this.pedestrians, this.staticBvh, config.world, dt);
    this.combat.updateTracers(
      this.crimes,
      this.units,
      this.civilianCars,
      this.pedestrians,
      this.cowardiceLevel,
      this.staticBvh,
      dt,
      () => {
        this.neutralizedCount++;
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
      );
    }

    const selectedUnit =
      this.units.find((u) => u.id === this.selectedUnitId) ?? this.units[0];
    this.cameraController.update(rawDt, selectedUnit);

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

  private resolveAllVehicleCollisions(dt: number): void {
    const entries: VehicleCollisionEntry[] = [];

    for (const u of this.units) {
      if (u.status === UnitStatus.AtStation) continue;
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
            for (const o of u.officers) {
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
      if (c.inVehiclePursuit && c.vehicleRig && c.suspectAlive) {
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
    const unitsSummary = this.units.map((u) => {
      const avgMorale = Math.round((u.officers[0].morale + u.officers[1].morale) * 0.5);
      const fleeingOfficers = u.officers.filter(
        (o) => o.hp > 0 && o.cowardiceState === 'fleeing',
      ).length;
      const downedOfficers = u.officers.filter((o) => o.hp <= 0).length;
      return {
        id: u.id,
        callsign: u.callsign,
        vehicleKind: u.vehicleKind,
        liveryLabel: liveries?.[u.liveryId]?.label ?? u.liveryId,
        baseColorHex: u.baseColorHex,
        isHeavyUnit: u.isHeavyUnit,
        weaponKind: u.weaponKind,
        status: u.status,
        mounted: u.mounted,
        immobilized: u.immobilized,
        freeRoam: u.freeRoam,
        lightsActive: u.lightsActive,
        sirensActive: u.sirensActive,
        speedKmh: Math.round(u.speed * 3.6),
        morale: avgMorale,
        fleeingOfficers,
        downedOfficers,
        targetCrimeId: u.targetCrimeId,
      };
    });

    const crimesSummary: CrimeSummary[] = this.crimes.map((c) => {
      const assigned = this.units.find((u) => u.id === c.assignedUnitId);
      const counts = getCrimeUnitCounts(c, this.units, this.nailMats);
      return {
        id: c.id,
        type: c.type,
        district: c.district,
        suspectAlive: c.suspectAlive,
        suspectHp: Math.round(c.suspectHp),
        suspectWeaponKind: c.suspectWeaponKind,
        inVehiclePursuit: c.inVehiclePursuit,
        vehicleHp: Math.round(c.vehicleHp),
        assignedUnitCallsign: assigned ? assigned.callsign : null,
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
      civilianCarCount: this.civilianCars.length,
      pedestrianCount: this.pedestrians.length,
      activeNailMats: this.nailMats.filter((m) => m.phase !== 'recovering').length,
      selectedUnitId: this.selectedUnitId,
      lightbarMode: this.lightbarMode,
      sirenPattern: this.sirenPattern,
      drivingMode: this.drivingMode,
      backupMode: this.backupMode,
      weather: this.weather,
      cameraMode: this.cameraController?.mode ?? CameraMode.Overview,
      crimeProbability: this.crimeProbability,
      cowardiceLevel: this.cowardiceLevel,
      audioEnabled: this.audio?.isEnabled() ?? this.audioWanted,
      simSpeed: this.simSpeed,
      isSoftwareGl: this.isSoftwareGl,
      paintPalette: this.paintPalette,
      assetPackName: this.assets?.manifest.packName ?? 'unloaded',
      assetSourceLabel: this.assetSourceLabel,
      configVersion: this.config?.version ?? 'missing',
      assetCounts: {
        textures: this.assets ? Object.keys(this.assets.textures).length : 0,
        models: this.assets ? Object.keys(this.assets.models).length : 0,
        audio: this.assets ? Object.keys(this.assets.audio).length : 0,
      },
      assetsLoaded: this.assetsLoaded,
      assetIssues: this.assetIssues,
      fatalError: this.fatalError,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointerdown', this.handleGlobalGestureUnlock);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.cameraController?.dispose();
    this.audio?.dispose();
    this.textures?.dispose();
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
