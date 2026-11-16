import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { loadJsonAssetBundle } from '../assets/jsonAssetLoader';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { mulberry32 } from '../assets/prng';
import {
  evaluateCrimeBackupPolicy,
  getCrimeUnitCounts,
  requestManualBackup,
  requestManualNailMat,
} from './backupSystem';
import { StaticObstacleBVH } from './bvh';
import { SimCameraController } from './cameraController';
import { CombatSystem } from './combatSystem';
import { updateNailMats } from './nailMatSystem';
import {
  dispatchNearestUnit,
  dismountUnit,
  spawnPoliceUnits,
  updatePoliceUnits,
} from './policeUnitSystem';
import { getSurfaceHeight, LANE_OFFSET, TownRoadGraph } from './roadGraph';
import {
  ActiveCrime,
  CivilianVehicle,
  NailMatActor,
  PedestrianActor,
  PoliceUnit,
} from './simActors';
import { createTexturePackFromJson, ProceduralTexturePack } from './textures';
import { buildTownEnvironment, TownEnvironmentHandles } from './townBuilder';
import {
  spawnCivilianTraffic,
  spawnPedestrians,
  updateCivilianTraffic,
  updateGetawayVehicle,
  updatePedestrians,
} from './trafficSystem';
import {
  BackupMode,
  CameraMode,
  CrimeSummary,
  CrimeType,
  DrivingMode,
  LightbarMode,
  SimSnapshot,
  SirenPattern,
  UnitStatus,
  WeaponKind,
  WeatherCondition,
} from './types';
import {
  CivilianCarRig,
  createCivilianCar,
  createHumanoid,
  POLICE_LIVERIES,
} from './vehicleModels';
import {
  createVehicleDynState,
  VehicleCollisionEntry,
  VehicleCrashPhysicsSystem,
} from './vehiclePhysics';
import {
  createRagdollState,
  SimVfxManager,
  stepRagdollPhysics,
} from './vfx';
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

export class PoliceSimEngine {
  private container: HTMLElement;
  private onSnapshot: (snap: SimSnapshot) => void;
  private onWebGLContextLost: (lost: boolean) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  private assets: LoadedJsonAssets | null = null;
  private textures: ProceduralTexturePack | null = null;
  private audio: JsonAudioSynth | null = null;
  private envHandles: TownEnvironmentHandles | null = null;

  private staticBvh = new StaticObstacleBVH();
  private roadGraph = new TownRoadGraph();
  private simRng = mulberry32(20261116);

  private vfx: SimVfxManager;
  private combat: CombatSystem;
  private crashPhysics: VehicleCrashPhysicsSystem;
  private weatherSystem: WeatherSystem;
  private cameraController: SimCameraController;

  private units: PoliceUnit[] = [];
  private crimes: ActiveCrime[] = [];
  private nailMats: NailMatActor[] = [];
  private civilianCars: CivilianVehicle[] = [];
  private pedestrians: PedestrianActor[] = [];
  private clickables: THREE.Object3D[] = [];

  private lightbarMode: LightbarMode = LightbarMode.LED;
  private sirenPattern: SirenPattern = SirenPattern.AutoCycle;
  private drivingMode: DrivingMode = DrivingMode.Standard;
  private backupMode: BackupMode = BackupMode.Standard;
  private weather: WeatherCondition = WeatherCondition.Clear;
  private selectedUnitId = 'unit-1';
  private crimeProbability = 0.25;
  private cowardiceLevel = 0.35;
  private simSpeed: 1 | 2 = 1;
  private neutralizedCount = 0;

  private crimeCheckAccum = 0;
  private crimeCooldownTimer = 0;
  private crimeCounter = 1;
  private simTime = 0;
  private snapshotAccum = 0;
  private initialCrimeTriggered = false;
  private assetsLoaded = false;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onSnapshot: (snap: SimSnapshot) => void,
    onWebGLContextLost: (lost: boolean) => void,
  ) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    this.onWebGLContextLost = onWebGLContextLost;

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

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.vfx = new SimVfxManager(this.scene, this.simRng);
    this.combat = new CombatSystem(this.scene, this.simRng, this.vfx);
    this.crashPhysics = new VehicleCrashPhysicsSystem(this.scene, this.simRng);
    this.weatherSystem = new WeatherSystem(
      this.scene,
      this.renderer,
      this.isSoftwareGl,
      this.simRng,
    );
    this.cameraController = new SimCameraController(
      container,
      canvas,
      this.isSoftwareGl,
      {
        onSelectUnit: (uid) => this.selectUnit(uid),
        onUnlockAudio: () => this.audio?.unlockOnGesture(),
        onModeAutoFallback: () => this.emitSnapshot(),
        getClickables: () => this.clickables,
      },
    );

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointerdown', this.handleGlobalGestureUnlock);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.emitSnapshot();
    void this.initAssetsAndWorld();
  }

  private async initAssetsAndWorld(): Promise<void> {
    try {
      const assets = await loadJsonAssetBundle('/jdataassets/manifest.json');
      if (this.disposed) return;

      this.assets = assets;
      this.textures = createTexturePackFromJson(this.renderer, assets);
      this.vfx.setTextures(this.textures);
      this.audio = new JsonAudioSynth(assets.audio, true);
      this.audio.unlockOnGesture();

      this.envHandles = buildTownEnvironment(this.scene, this.textures);
      this.staticBvh.build(this.envHandles.obstacles);

      this.units = spawnPoliceUnits(
        this.scene,
        assets,
        this.textures,
        this.isSoftwareGl,
        this.simRng,
        this.clickables,
      );
      this.civilianCars = spawnCivilianTraffic(
        14,
        this.scene,
        this.roadGraph,
        assets,
        this.textures,
      );
      this.pedestrians = spawnPedestrians(
        32,
        this.scene,
        this.staticBvh,
        assets,
        this.textures,
        this.simRng,
      );

      this.weatherSystem.applyWeather(this.weather, this.envHandles, this.audio);

      if (!this.isSoftwareGl) {
        this.renderer.compile(this.scene, this.cameraController.camera);
      }

      this.assetsLoaded = true;
      this.emitSnapshot();
      this.clock.getDelta();
      this.tick();
    } catch (err) {
      console.error('Failed to initialize JSON assets:', err);
    }
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
    this.cameraController.resize(w, h);
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
        this.drivingMode,
        this.audio,
      )
    ) {
      this.emitSnapshot();
    }
  }

  public deployNailMatNow(): void {
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
        this.scene,
        this.audio,
      )
    ) {
      this.emitSnapshot();
    }
  }

  public setWeather(weather: WeatherCondition): void {
    this.weather = weather;
    this.weatherSystem.applyWeather(weather, this.envHandles, this.audio);
    this.emitSnapshot();
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraController.setMode(mode);
    this.emitSnapshot();
  }

  public resetCameraView(): void {
    this.cameraController.resetView();
    this.emitSnapshot();
  }

  public selectUnit(unitId: string): void {
    if (this.units.some((u) => u.id === unitId)) {
      this.selectedUnitId = unitId;
      this.cameraController.requestSnap();
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
    this.audio?.setEnabled(enabled);
    this.emitSnapshot();
  }

  public setSimSpeed(speed: 1 | 2): void {
    this.simSpeed = speed;
    this.emitSnapshot();
  }

  public toggleSelectedUnitMount(): void {
    const unit = this.units.find((u) => u.id === this.selectedUnitId);
    if (!unit) return;

    if (unit.mounted) {
      dismountUnit(unit, this.cowardiceLevel, this.staticBvh, this.simRng, true);
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
    if (!this.assets || !this.textures || this.crimes.length >= 4) return;
    const isPursuit = forcePursuit || this.simRng() < 0.36;
    const spot = this.roadGraph.generateRandomCrimeSpot(this.simRng);
    const footTypes = [
      CrimeType.ArmedRobbery,
      CrimeType.ShotsFired,
      CrimeType.StorefrontHeist,
      CrimeType.StreetAssault,
    ];
    const type = isPursuit
      ? CrimeType.VehiclePursuit
      : footTypes[this.crimeCounter % footTypes.length];
    const id = `crime-${this.crimeCounter++}`;

    const suspectRig = createHumanoid('suspect', this.assets, this.textures);
    const pos = new THREE.Vector3(spot.x, 0, spot.z);
    this.staticBvh.resolveCircle(pos, 0.52);
    pos.y = getSurfaceHeight(pos.x, pos.z);
    suspectRig.root.position.copy(pos);
    suspectRig.root.visible = !isPursuit;
    this.scene.add(suspectRig.root);

    const suspectWeaponKind: WeaponKind =
      !isPursuit && (type === CrimeType.ArmedRobbery || this.simRng() < 0.34)
        ? 'rifle'
        : 'pistol';
    const suspectArmor = suspectWeaponKind === 'rifle' ? 40 : 15;

    let vehicleRig: CivilianCarRig | null = null;
    let vehicleThreatRing: THREE.Mesh | null = null;
    const vehiclePos = new THREE.Vector3();
    const vehicleDyn = createVehicleDynState();
    let vehicleYaw = 0;
    let vehicleNodeId = spot.nearestNodeId;
    let vehicleNextNodeId = spot.nearestNodeId;

    if (isPursuit) {
      const startNode = this.roadGraph.nodes[spot.nearestNodeId];
      vehicleNextNodeId =
        startNode.neighbors[Math.floor(this.simRng() * startNode.neighbors.length)];
      const nextNode = this.roadGraph.nodes[vehicleNextNodeId];
      const dx = nextNode.x - startNode.x;
      const dz = nextNode.z - startNode.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const vx0 = startNode.x + ux * 16 - uz * LANE_OFFSET;
      const vz0 = startNode.z + uz * 16 + ux * LANE_OFFSET;
      vehiclePos.set(vx0, getSurfaceHeight(vx0, vz0), vz0);
      vehicleYaw = Math.atan2(ux, uz);
      vehicleDyn.vx = ux * 11;
      vehicleDyn.vz = uz * 11;
      vehicleNodeId = startNode.id;

      const variants: ('sedan' | 'hatch')[] = ['sedan', 'hatch'];
      const colors = [0x991b1b, 0x1e293b, 0x7c2d12];
      vehicleRig = createCivilianCar(
        variants[this.crimeCounter % variants.length],
        colors[this.crimeCounter % colors.length],
        this.assets,
        this.textures,
      );
      vehicleRig.root.position.copy(vehiclePos);
      vehicleRig.root.rotation.y = vehicleYaw;

      vehicleThreatRing = new THREE.Mesh(
        new THREE.RingGeometry(1.75, 2.25, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xef4444,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
        }),
      );
      vehicleThreatRing.position.y = 0.06;
      vehicleRig.root.add(vehicleThreatRing);
      this.scene.add(vehicleRig.root);
    }

    const crime: ActiveCrime = {
      id,
      type,
      district: spot.district,
      pos: isPursuit ? vehiclePos.clone() : pos.clone(),
      roadPullOverPos: isPursuit ? vehiclePos.clone() : spot.roadPullOverPos.clone(),
      roadPullOverYaw: spot.roadPullOverYaw,
      nearestNodeId: spot.nearestNodeId,
      suspectRig,
      suspectPos: isPursuit ? vehiclePos.clone() : pos.clone(),
      suspectYaw: this.simRng() * Math.PI * 2,
      suspectHp: 100,
      suspectArmor,
      suspectWeaponKind,
      suspectAlive: true,
      suspectAmmo: suspectWeaponKind === 'rifle' ? 28 : 10,
      suspectReloadTimer: 0,
      suspectRecoil: 0,
      suspectStrafeDir: this.simRng() < 0.5 ? 1 : -1,
      suspectMoveTimer: 1.5,
      suspectWalkPhase: 0,
      suspectRagdoll: createRagdollState(),
      lastHitDir: new THREE.Vector3(0, 0, 1),
      inVehiclePursuit: isPursuit,
      vehicleRig,
      vehicleThreatRing,
      vehiclePos,
      vehicleYaw,
      vehicleSpeed: isPursuit ? 11 : 0,
      vehicleDyn,
      vehicleMaxSpeed: 18.2 + this.simRng() * 2.4,
      vehicleHp: 100,
      vehicleNodeId,
      vehicleNextNodeId,
      vehicleTurnApex: null,
      vehiclePinnedTimer: 0,
      vehicleStuckTimer: 0,
      vehicleImmobilized: false,
      vehicleImmobilizeTilt: 0,
      vehicleTireBlowoutTimer: 0,
      vehicleSmokeTimer: 0,
      vehicleSmokeAccum: 0,
      assignedUnitId: null,
      backupDispatched: false,
      heavyDeployed: false,
      nailMatAttempts: 0,
      fireCooldown: 1.1,
      muzzleTimer: 0,
      cleanupTimer: 4.5,
      elapsedSec: 0,
      engagedSec: 0,
    };

    this.crimes.push(crime);
    this.crimeCooldownTimer = Math.max(this.crimeCooldownTimer, 10.0);
    dispatchNearestUnit(crime, this.units, this.roadGraph, this.drivingMode, this.audio);
    this.emitSnapshot();
  }

  // --- Simulation Tick Loop ---

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    const dt = rawDt * this.simSpeed;
    this.simTime += dt;

    if (!this.initialCrimeTriggered && this.simTime > 1.4) {
      this.initialCrimeTriggered = true;
      this.triggerCrimeNow(false);
    }

    if (this.crimeCooldownTimer > 0) {
      this.crimeCooldownTimer = Math.max(0, this.crimeCooldownTimer - dt);
    } else {
      this.crimeCheckAccum += dt;
      if (this.crimeCheckAccum >= 5.0) {
        this.crimeCheckAccum = 0;
        if (this.crimeProbability > 0 && this.crimes.length < 2) {
          const chance = this.crimeProbability * 0.22;
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
        this.roadGraph,
        this.scene,
        this.backupMode,
        this.drivingMode,
        this.audio,
      );
    }

    updatePoliceUnits(
      {
        units: this.units,
        crimes: this.crimes,
        civilianCars: this.civilianCars,
        pedestrians: this.pedestrians,
        roadGraph: this.roadGraph,
        staticBvh: this.staticBvh,
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
      this.roadGraph,
      this.staticBvh,
      this.vfx,
      this.audio,
      this.scene,
      this.simTime,
      this.simRng,
      dt,
    );

    this.updateCrimes(dt);

    updateCivilianTraffic(
      this.civilianCars,
      this.units,
      this.crimes,
      this.pedestrians,
      this.nailMats,
      this.roadGraph,
      this.staticBvh,
      this.combat,
      this.vfx,
      this.weather,
      this.simRng,
      dt,
    );

    this.resolveAllVehicleCollisions(dt);
    this.crashPhysics.stepDebris(this.staticBvh, dt);
    updatePedestrians(this.pedestrians, this.staticBvh, dt);
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
    if (this.snapshotAccum >= 0.12) {
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

  private updateCrimes(dt: number): void {
    for (let i = this.crimes.length - 1; i >= 0; i--) {
      const c = this.crimes[i];
      c.elapsedSec += dt;

      if (c.suspectAlive) {
        const activelyEngaged = this.units.some(
          (u) =>
            u.targetCrimeId === c.id &&
            (u.status === UnitStatus.Dismounting ||
              u.status === UnitStatus.Engaging ||
              (u.status === UnitStatus.Pursuing &&
                u.pos.distanceToSquared(c.vehiclePos) < 28 * 28)),
        );
        if (activelyEngaged) {
          c.engagedSec += dt;
        }
      }

      if (c.muzzleTimer > 0) {
        c.muzzleTimer -= dt;
        if (c.muzzleTimer <= 0 && c.suspectRig.muzzleFlash) {
          c.suspectRig.muzzleFlash.visible = false;
        }
      }

      if (c.vehicleRig && c.vehicleSmokeTimer > 0) {
        c.vehicleSmokeTimer -= dt;
        c.vehicleSmokeAccum += dt;
        if (c.vehicleSmokeAccum >= 0.12) {
          c.vehicleSmokeAccum = 0;
          const hoodX = c.vehiclePos.x + Math.sin(c.vehicleYaw) * 1.65;
          const hoodZ = c.vehiclePos.z + Math.cos(c.vehicleYaw) * 1.65;
          this.vfx.spawnSmokePuff(hoodX, 1.0, hoodZ, 0.95, 0.48, 0.78, 2.5);
        }
      }

      if (c.suspectAlive && c.inVehiclePursuit && c.vehicleRig) {
        updateGetawayVehicle(
          c,
          this.units,
          this.civilianCars,
          this.crimes,
          this.pedestrians,
          this.nailMats,
          this.roadGraph,
          this.staticBvh,
          this.combat,
          this.vfx,
          this.weather,
          this.cowardiceLevel,
          this.simTime,
          this.simRng,
          dt,
        );
        continue;
      }

      if (c.suspectAlive) {
        this.combat.updateFootCrimeSuspect(
          c,
          this.units,
          this.cowardiceLevel,
          this.staticBvh,
          this.audio,
          this.simTime,
          dt,
        );
      } else {
        stepRagdollPhysics(c.suspectRagdoll, c.suspectPos, c.suspectRig, this.staticBvh, dt);
        c.cleanupTimer -= dt;
        if (c.cleanupTimer <= 0) {
          this.scene.remove(c.suspectRig.root);
          if (c.vehicleRig) {
            this.scene.remove(c.vehicleRig.root);
          }
          this.crimes.splice(i, 1);
          this.crimeCooldownTimer = Math.max(this.crimeCooldownTimer, 12.0);
        }
      }
    }
  }

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
        liveryLabel: POLICE_LIVERIES[u.liveryId].label,
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
      cameraMode: this.cameraController.mode,
      crimeProbability: this.crimeProbability,
      cowardiceLevel: this.cowardiceLevel,
      audioEnabled: this.audio?.isEnabled() ?? true,
      simSpeed: this.simSpeed,
      isSoftwareGl: this.isSoftwareGl,
      assetPackName: this.assets?.manifest.packName ?? 'loading',
      assetCounts: {
        textures: this.assets ? Object.keys(this.assets.textures).length : 0,
        models: this.assets ? Object.keys(this.assets.models).length : 0,
        audio: this.assets ? Object.keys(this.assets.audio).length : 0,
      },
      assetsLoaded: this.assetsLoaded,
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

    this.cameraController.dispose();
    this.audio?.dispose();
    this.textures?.dispose();
    this.vfx.dispose();
    this.combat.dispose();
    this.crashPhysics.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
