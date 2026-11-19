import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetIssue, AssetLoadResult } from './assets/assetTypes';
import {
  exportAssetBundleToZip,
  loadJsonAssetBundle,
  loadJsonAssetBundleFromZip,
} from './assets/jsonAssetLoader';
import { validateAssetPackLive, ValidationIssue } from './assets/packValidator';
import { simEventLog } from './assets/simEventLog';
import { BottomControlBar } from './components/BottomControlBar';
import { ErrorDialog } from './components/ErrorDialog';
import { EventLogDialog } from './components/EventLogDialog';
import { MainMenu, MainMenuSettings } from './components/MainMenu';
import { SidebarPaneId, SidebarPanel } from './components/SidebarPanel';
import { TopStatusHud } from './components/TopStatusHud';
import { ValidatorDialog } from './components/ValidatorDialog';
import { DevEditorState } from './sim/devEditorController';
import { eventBindingStore } from './sim/eventBindings';
import { keybindStore } from './sim/keybinds';
import { PoliceSimEngine } from './sim/PoliceSimEngine';
import {
  BackupMode,
  CameraMode,
  DrivingMode,
  LightbarMode,
  SimSnapshot,
  SirenPattern,
  WeatherCondition,
} from './sim/types';

type ScreenState = 'menu' | 'playing' | 'exited';

const INITIAL_SNAPSHOT: SimSnapshot = {
  units: [],
  activeCrimes: [],
  neutralizedCount: 0,
  casualtyCount: 0,
  debrisCount: 0,
  civilianCarCount: 0,
  pedestrianCount: 0,
  activeNailMats: 0,
  selectedUnitId: 'unit-1',
  lightbarMode: LightbarMode.LED,
  activeLightbarId: 'led_array',
  availableLightbars: [],
  sirenPattern: SirenPattern.AutoCycle,
  drivingMode: DrivingMode.Standard,
  backupMode: BackupMode.Standard,
  weather: WeatherCondition.Clear,
  cameraMode: CameraMode.Overview,
  crimeProbability: 0.25,
  cowardiceLevel: 0.35,
  audioEnabled: true,
  audioVolume: 0.85,
  audioQuality: 'normal',
  shadowsEnabled: true,
  debrisObstacles: true,
  renderScale: 1,
  crashIntensity: 1.0,
  maxPhysicsParts: 120,
  experimentalComplexMeshes: false,
  simSpeed: 1,
  isSoftwareGl: false,
  paintPalette: [],
  assetPackName: 'unloaded',
  assetSourceLabel: '/jdataassets/manifest.json',
  configVersion: '3.0.0',
  activeMapId: 'metro_default',
  mapName: 'Metro Grid',
  availableMaps: [],
  assetCounts: {
    textures: 0,
    models: 0,
    audio: 0,
    materials: 0,
    media: 0,
    lightbars: 0,
    maps: 0,
  },
  assetsLoaded: false,
  assetIssues: [],
  fatalError: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PoliceSimEngine | null>(null);

  const [screen, setScreen] = useState<ScreenState>('menu');
  const [menuSettings, setMenuSettings] = useState<MainMenuSettings>({
    initialMapId: 'metro_default',
    activeLightbarId: 'led_array',
    audioEnabled: true,
    audioVolume: 0.85,
    audioQuality: 'normal',
    simSpeed: 1,
    weather: WeatherCondition.Clear,
    backupMode: BackupMode.Standard,
    drivingMode: DrivingMode.Standard,
    lightbarMode: LightbarMode.LED,
    sirenPattern: SirenPattern.AutoCycle,
    trafficScale: 1.0,
    pedScale: 1.0,
    crimeProbability: 0.25,
    cowardiceLevel: 0.35,
    shadowsEnabled: true,
    debrisObstacles: true,
    renderScale: 1,
    crashIntensity: 1.0,
    maxPhysicsParts: 120,
    experimentalComplexMeshes: false,
  });

  const [preflightResult, setPreflightResult] = useState<AssetLoadResult | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [snapshot, setSnapshot] = useState<SimSnapshot>(INITIAL_SNAPSHOT);
  const [devState, setDevState] = useState<DevEditorState | null>(null);
  const [activePane, setActivePane] = useState<SidebarPaneId | null>('units');
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [validatorOpen, setValidatorOpen] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const applyNewAssetResult = useCallback((result: AssetLoadResult) => {
    setPreflightResult(result);
    if (result.config) {
      keybindStore.applyPackDefaults(result.config.keybinds);
      eventBindingStore.applyPackDefaults(result.config.eventBindings);
    }
    if (result.assets) {
      const firstMapId =
        result.assets.activeMapId || Object.keys(result.assets.maps ?? {})[0];
      const packMaxParts = result.config?.physics?.defaultMaxPhysicsParts;
      setMenuSettings((prev) => {
        const nextMap =
          firstMapId && !result.assets?.maps?.[prev.initialMapId]
            ? firstMapId
            : prev.initialMapId;
        const nextParts =
          typeof packMaxParts === 'number' && packMaxParts >= 8
            ? Math.round(packMaxParts)
            : prev.maxPhysicsParts;
        return {
          ...prev,
          initialMapId: nextMap,
          maxPhysicsParts: nextParts,
        };
      });
      simEventLog.info(
        'asset',
        `Loaded pack "${result.assets.manifest.packName}" (v${result.assets.manifest.formatVersion})`,
        `${Object.keys(result.assets.maps ?? {}).length} map(s), ${Object.keys(result.assets.lightbars ?? {}).length} lightbar(s)`,
        result.sourceLabel,
      );
    }
    if (result.fatalError || result.issues.length > 0) {
      setErrorDialogOpen(true);
      simEventLog.error(
        'asset',
        result.fatalError ? 'Fatal Pack Error' : 'Asset Pack Load Warnings',
        result.fatalError || `${result.issues.length} issue(s) detected`,
        result.sourceLabel,
      );
    }
    if (engineRef.current) {
      engineRef.current.applyAssetLoadResult(result);
    }
  }, []);

  const loadDefaultPack = useCallback(async () => {
    setLoadingAssets(true);
    const result = await loadJsonAssetBundle('/jdataassets/manifest.json');
    setLoadingAssets(false);
    applyNewAssetResult(result);
    if (!result.fatalError && result.issues.length === 0) {
      setErrorDialogOpen(false);
    }
  }, [applyNewAssetResult]);

  useEffect(() => {
    void loadDefaultPack();
  }, [loadDefaultPack]);

  useEffect(() => {
    if (screen !== 'playing') return;
    const container = mountRef.current;
    if (!container || !preflightResult || preflightResult.fatalError || !preflightResult.config) {
      return;
    }

    const engine = new PoliceSimEngine(
      container,
      (nextSnap) => {
        setSnapshot(nextSnap);
        if (nextSnap.fatalError) {
          setErrorDialogOpen(true);
        }
      },
      (lost) => setContextLost(lost),
      preflightResult,
      menuSettings,
      (nextDev) => setDevState(nextDev),
    );
    engineRef.current = engine;
    engine.getDevEditor()?.setActive(activePane === 'devtools');

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (keybindStore.matchesEvent(e, 'toggleHud')) {
        setActivePane((prev) => {
          engine.getDevEditor()?.setActive(false);
          return prev ? null : 'units';
        });
      } else if (keybindStore.matchesEvent(e, 'spawnCrime')) {
        e.preventDefault();
        engine.triggerCrimeNow(false);
      } else if (keybindStore.matchesEvent(e, 'spawnPursuit')) {
        e.preventDefault();
        engine.triggerCrimeNow(true);
      } else if (keybindStore.matchesEvent(e, 'cameraReset')) {
        engine.resetCameraView();
      } else if (keybindStore.matchesEvent(e, 'cameraOverview')) {
        engine.setCameraMode(CameraMode.Overview);
      } else if (keybindStore.matchesEvent(e, 'cameraFreeFly')) {
        engine.setCameraMode(CameraMode.FreeFly);
      } else if (keybindStore.matchesEvent(e, 'cameraFollow')) {
        engine.setCameraMode(CameraMode.FollowUnit);
      } else if (keybindStore.matchesEvent(e, 'cameraLightbar')) {
        engine.setCameraMode(CameraMode.RearLightbar);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      engine.dispose();
      engineRef.current = null;
      setDevState(null);
    };
    // Intentionally initialize once per 'playing' session; live pack swaps go through engineRef.current.applyAssetLoadResult
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const handleLoadZipPack = useCallback(
    async (file: File) => {
      setLoadingAssets(true);
      const result = await loadJsonAssetBundleFromZip(file);
      setLoadingAssets(false);
      applyNewAssetResult(result);
    },
    [applyNewAssetResult],
  );

  const handleExportZipPack = useCallback(async () => {
    const assets = engineRef.current?.getLoadedAssets() ?? preflightResult?.assets;
    if (!assets) return;
    const blob = await exportAssetBundleToZip(assets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assets.manifest.packName || 'metro_precinct_pack'}_v3.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    simEventLog.info('asset', `Exported Pack V3 ZIP`, `${a.download}`);
  }, [preflightResult]);

  const handleTogglePane = useCallback((pane: SidebarPaneId) => {
    setActivePane((prev) => {
      const next = prev === pane ? null : pane;
      engineRef.current?.getDevEditor()?.setActive(next === 'devtools');
      return next;
    });
  }, []);

  const handleSelectUnit = useCallback((id: string) => {
    engineRef.current?.selectUnit(id);
  }, []);

  const handleSetUnitBaseColor = useCallback((unitId: string, colorHex: number) => {
    engineRef.current?.setUnitBaseColor(unitId, colorHex);
  }, []);

  const handleSetLightbarById = useCallback((lightbarId: string) => {
    engineRef.current?.setLightbarById(lightbarId);
  }, []);

  const handleSetSirenPattern = useCallback((pattern: SirenPattern) => {
    engineRef.current?.setSirenPattern(pattern);
  }, []);

  const handleSetDrivingMode = useCallback((mode: DrivingMode) => {
    engineRef.current?.setDrivingMode(mode);
  }, []);

  const handleSetBackupMode = useCallback((mode: BackupMode) => {
    engineRef.current?.setBackupMode(mode);
  }, []);

  const handleRequestBackup = useCallback((crimeId?: string) => {
    engineRef.current?.requestBackupNow(crimeId);
  }, []);

  const handleDeployNailMat = useCallback(() => {
    engineRef.current?.deployNailMatNow();
  }, []);

  const handleSetWeather = useCallback((weather: WeatherCondition) => {
    engineRef.current?.setWeather(weather);
  }, []);

  const handleSwitchMap = useCallback((mapId: string) => {
    engineRef.current?.switchMap(mapId);
  }, []);

  const handleSetCameraMode = useCallback((mode: CameraMode) => {
    engineRef.current?.setCameraMode(mode);
  }, []);

  const handleResetCamera = useCallback(() => {
    engineRef.current?.resetCameraView();
  }, []);

  const handleSetCrimeProbability = useCallback((prob: number) => {
    engineRef.current?.setCrimeProbability(prob);
  }, []);

  const handleSetCowardiceLevel = useCallback((level: number) => {
    engineRef.current?.setCowardiceLevel(level);
  }, []);

  const handleTriggerCrime = useCallback(() => {
    engineRef.current?.triggerCrimeNow(false);
  }, []);

  const handleTriggerPursuit = useCallback(() => {
    engineRef.current?.triggerCrimeNow(true);
  }, []);

  const handleToggleMount = useCallback(() => {
    engineRef.current?.toggleSelectedUnitMount();
  }, []);

  const handleToggleAudio = useCallback(() => {
    const curr = engineRef.current;
    if (!curr) return;
    curr.setAudioEnabled(!snapshot.audioEnabled);
  }, [snapshot.audioEnabled]);

  const handleSetAudioVolume = useCallback((volume: number) => {
    engineRef.current?.setAudioVolume(volume);
  }, []);

  const handleToggleSimSpeed = useCallback(() => {
    const curr = engineRef.current;
    if (!curr) return;
    curr.setSimSpeed(snapshot.simSpeed === 1 ? 2 : 1);
  }, [snapshot.simSpeed]);

  const handleSetDebrisObstacles = useCallback((enabled: boolean) => {
    engineRef.current?.setDebrisObstacles(enabled);
  }, []);

  const handleSetCrashIntensity = useCallback((intensity: number) => {
    engineRef.current?.setCrashIntensity(intensity);
  }, []);

  const handleSetMaxPhysicsParts = useCallback((limit: number) => {
    engineRef.current?.setMaxPhysicsParts(limit);
  }, []);

  const handleJumpToValidationIssue = useCallback((issue: ValidationIssue) => {
    setActivePane('devtools');
    const dev = engineRef.current?.getDevEditor();
    if (!dev) return;
    dev.setActive(true);
    dev.setMode('asset');
    if (issue.jumpTab) {
      dev.setAssetTab(issue.jumpTab);
    }
    if (issue.jumpTarget) {
      if (issue.jumpTab === 'map') {
        if (issue.category === 'map' && issue.assetId) {
          dev.switchMap(issue.assetId);
        }
        dev.selectObject(issue.jumpTarget);
      } else if (issue.jumpTab === 'model') {
        dev.selectModel(issue.jumpTarget);
      } else if (issue.jumpTab === 'lightbars') {
        dev.selectLightbar(issue.jumpTarget);
      } else if (issue.jumpTab === 'materials') {
        dev.selectPackMaterial(issue.jumpTarget);
      } else if (issue.jumpTab === 'texture') {
        dev.selectTexture(issue.jumpTarget);
      } else if (issue.jumpTab === 'audio') {
        dev.selectAudio(issue.jumpTarget);
      }
    }
  }, []);

  const activeFatalError =
    screen === 'playing'
      ? snapshot.fatalError ?? preflightResult?.fatalError ?? null
      : preflightResult?.fatalError ?? null;
  const activeIssues: AssetIssue[] =
    screen === 'playing' && snapshot.assetIssues.length > 0
      ? snapshot.assetIssues
      : preflightResult?.issues ?? [];
  const activeSourceLabel =
    screen === 'playing' && snapshot.assetsLoaded
      ? snapshot.assetSourceLabel
      : preflightResult?.sourceLabel ?? '/jdataassets/manifest.json';

  const currentAssets =
    screen === 'playing'
      ? engineRef.current?.getLoadedAssets() ?? preflightResult?.assets ?? null
      : preflightResult?.assets ?? null;

  const liveValidationIssues = useMemo(() => {
    if (devState?.validationIssues) return devState.validationIssues;
    return validateAssetPackLive(currentAssets);
  }, [devState?.validationIssues, currentAssets]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-zinc-800 text-zinc-100">
      {screen === 'menu' && (
        <MainMenu
          assetResult={preflightResult}
          loadingAssets={loadingAssets}
          settings={menuSettings}
          onChangeSettings={setMenuSettings}
          onStart={() => {
            if (!preflightResult?.fatalError && preflightResult?.config) {
              setScreen('playing');
            }
          }}
          onExit={() => setScreen('exited')}
          onOpenErrorDialog={() => setErrorDialogOpen(true)}
          onLoadZipPack={(file) => void handleLoadZipPack(file)}
          onReloadDefaultPack={() => void loadDefaultPack()}
        />
      )}

      {screen === 'exited' && (
        <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-zinc-800">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-20 opacity-85 blur-3xl"
            style={{
              background:
                'radial-gradient(circle at 30% 35%, rgba(71, 85, 105, 0.65), transparent 55%), linear-gradient(135deg, #272b33 0%, #373d49 55%, #22262e 100%)',
            }}
          />
          <div className="relative z-10 w-[min(320px,90vw)] border border-zinc-500 bg-zinc-800/85 p-5 text-center shadow-2xl rounded-none">
            <h1 className="font-display text-xl font-bold tracking-wider uppercase text-zinc-100">
              Metro Precinct
            </h1>
            <p className="mt-2 text-xs text-zinc-300">Simulation session closed.</p>
            <button
              type="button"
              onClick={() => setScreen('menu')}
              className="mt-4 w-full border border-zinc-400 bg-zinc-200 px-4 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-white cursor-pointer rounded-none"
            >
              Return to Menu
            </button>
          </div>
        </div>
      )}

      {screen === 'playing' && (
        <>
          <div ref={mountRef} className="h-full w-full" />

          {contextLost && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-900/85 p-4 text-center">
              <div className="border border-zinc-500 bg-zinc-800 px-5 py-4 rounded-none">
                <p className="font-display text-sm font-semibold text-zinc-100">
                  3D Graphics Context Suspended
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Waiting for WebGL context restoration.
                </p>
              </div>
            </div>
          )}

          <TopStatusHud
            snapshot={snapshot}
            validationIssueCount={liveValidationIssues.length}
            onOpenErrorDialog={() => setErrorDialogOpen(true)}
            onOpenEventLog={() => setEventLogOpen(true)}
            onOpenValidator={() => setValidatorOpen(true)}
            onReturnToMenu={() => {
              engineRef.current?.getDevEditor()?.setActive(false);
              setScreen('menu');
            }}
          />

          <SidebarPanel
            snapshot={snapshot}
            activePane={activePane}
            loadedAssets={currentAssets}
            assetBusy={loadingAssets}
            onTogglePane={handleTogglePane}
            onSelectUnit={handleSelectUnit}
            onSetUnitBaseColor={handleSetUnitBaseColor}
            onSetLightbarById={handleSetLightbarById}
            onSetSirenPattern={handleSetSirenPattern}
            onSetDrivingMode={handleSetDrivingMode}
            onSetBackupMode={handleSetBackupMode}
            onRequestBackup={handleRequestBackup}
            onDeployNailMat={handleDeployNailMat}
            onSetWeather={handleSetWeather}
            onSwitchMap={handleSwitchMap}
            onSetCameraMode={handleSetCameraMode}
            onResetCamera={handleResetCamera}
            onSetCrimeProbability={handleSetCrimeProbability}
            onSetCowardiceLevel={handleSetCowardiceLevel}
            onTriggerCrime={handleTriggerCrime}
            onTriggerPursuit={handleTriggerPursuit}
            onToggleMount={handleToggleMount}
            onToggleAudio={handleToggleAudio}
            onSetAudioVolume={handleSetAudioVolume}
            onToggleSimSpeed={handleToggleSimSpeed}
            onSetDebrisObstacles={handleSetDebrisObstacles}
            onSetCrashIntensity={handleSetCrashIntensity}
            onSetMaxPhysicsParts={handleSetMaxPhysicsParts}
            onLoadZipPack={(file) => void handleLoadZipPack(file)}
            onExportZipPack={() => void handleExportZipPack()}
            onReloadDefaultPack={() => void loadDefaultPack()}
            onOpenErrorDialog={() => setErrorDialogOpen(true)}
            onOpenValidator={() => setValidatorOpen(true)}
            devTools={{
              controller: engineRef.current?.getDevEditor() ?? null,
              state: devState,
            }}
          />

          <BottomControlBar
            snapshot={snapshot}
            onSetCameraMode={handleSetCameraMode}
            onResetCamera={handleResetCamera}
            onToggleSimSpeed={handleToggleSimSpeed}
            onToggleAudio={handleToggleAudio}
            onTriggerCrime={handleTriggerCrime}
            onTriggerPursuit={handleTriggerPursuit}
          />
        </>
      )}

      <ErrorDialog
        open={errorDialogOpen}
        fatalError={activeFatalError}
        issues={activeIssues}
        sourceLabel={activeSourceLabel}
        onDismiss={() => setErrorDialogOpen(false)}
        onReloadDefault={() => void loadDefaultPack()}
      />

      <EventLogDialog
        open={eventLogOpen}
        onClose={() => setEventLogOpen(false)}
      />

      <ValidatorDialog
        open={validatorOpen}
        packName={currentAssets?.manifest.packName ?? snapshot.assetPackName}
        issues={liveValidationIssues}
        onClose={() => setValidatorOpen(false)}
        onJumpToIssue={handleJumpToValidationIssue}
      />
    </div>
  );
}
