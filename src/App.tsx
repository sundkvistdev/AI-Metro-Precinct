import { useCallback, useEffect, useRef, useState } from 'react';
import { AssetIssue, AssetLoadResult } from './assets/assetTypes';
import {
  exportAssetBundleToZip,
  loadJsonAssetBundle,
  loadJsonAssetBundleFromZip,
} from './assets/jsonAssetLoader';
import { ErrorDialog } from './components/ErrorDialog';
import { MainMenu, MainMenuSettings } from './components/MainMenu';
import { SidebarPaneId, SidebarPanel } from './components/SidebarPanel';
import { TopStatusHud } from './components/TopStatusHud';
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
  civilianCarCount: 0,
  pedestrianCount: 0,
  activeNailMats: 0,
  selectedUnitId: 'unit-1',
  lightbarMode: LightbarMode.LED,
  sirenPattern: SirenPattern.AutoCycle,
  drivingMode: DrivingMode.Standard,
  backupMode: BackupMode.Standard,
  weather: WeatherCondition.Clear,
  cameraMode: CameraMode.Overview,
  crimeProbability: 0.25,
  cowardiceLevel: 0.35,
  audioEnabled: true,
  simSpeed: 1,
  isSoftwareGl: false,
  paintPalette: [],
  assetPackName: 'unloaded',
  assetSourceLabel: '/jdataassets/manifest.json',
  configVersion: '1.0.0',
  assetCounts: { textures: 0, models: 0, audio: 0 },
  assetsLoaded: false,
  assetIssues: [],
  fatalError: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PoliceSimEngine | null>(null);

  const [screen, setScreen] = useState<ScreenState>('menu');
  const [menuSettings, setMenuSettings] = useState<MainMenuSettings>({
    audioEnabled: true,
    simSpeed: 1,
    weather: WeatherCondition.Clear,
    backupMode: BackupMode.Standard,
  });

  const [preflightResult, setPreflightResult] = useState<AssetLoadResult | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [snapshot, setSnapshot] = useState<SimSnapshot>(INITIAL_SNAPSHOT);
  const [activePane, setActivePane] = useState<SidebarPaneId | null>('units');
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const applyNewAssetResult = useCallback(
    (result: AssetLoadResult) => {
      setPreflightResult(result);
      if (result.fatalError || result.issues.length > 0) {
        setErrorDialogOpen(true);
      }
      if (engineRef.current) {
        engineRef.current.applyAssetLoadResult(result);
      }
    },
    [],
  );

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
    );
    engineRef.current = engine;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setActivePane((prev) => (prev ? null : 'units'));
      } else if (e.code === 'Space') {
        e.preventDefault();
        engine.triggerCrimeNow();
      } else if (e.key === '0') {
        engine.resetCameraView();
      } else if (e.key === '1') {
        engine.setCameraMode(CameraMode.Overview);
      } else if (e.key === '2') {
        engine.setCameraMode(CameraMode.FreeFly);
      } else if (e.key === '3') {
        engine.setCameraMode(CameraMode.FollowUnit);
      } else if (e.key === '4') {
        engine.setCameraMode(CameraMode.RearLightbar);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      engine.dispose();
      engineRef.current = null;
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
    a.download = `${assets.manifest.packName || 'metro_precinct_pack'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [preflightResult]);

  const handleTogglePane = useCallback((pane: SidebarPaneId) => {
    setActivePane((prev) => (prev === pane ? null : pane));
  }, []);

  const handleSelectUnit = useCallback((id: string) => {
    engineRef.current?.selectUnit(id);
  }, []);

  const handleSetUnitBaseColor = useCallback((unitId: string, colorHex: number) => {
    engineRef.current?.setUnitBaseColor(unitId, colorHex);
  }, []);

  const handleSetLightbarMode = useCallback((mode: LightbarMode) => {
    engineRef.current?.setLightbarMode(mode);
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

  const handleRequestBackup = useCallback(() => {
    engineRef.current?.requestBackupNow();
  }, []);

  const handleDeployNailMat = useCallback(() => {
    engineRef.current?.deployNailMatNow();
  }, []);

  const handleSetWeather = useCallback((weather: WeatherCondition) => {
    engineRef.current?.setWeather(weather);
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

  const handleToggleSimSpeed = useCallback(() => {
    const curr = engineRef.current;
    if (!curr) return;
    curr.setSimSpeed(snapshot.simSpeed === 1 ? 2 : 1);
  }, [snapshot.simSpeed]);

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

          <div className="pointer-events-none fixed inset-0 z-10 flex flex-col gap-1.5 p-1.5">
            <TopStatusHud
              snapshot={snapshot}
              onOpenErrorDialog={() => setErrorDialogOpen(true)}
              onReturnToMenu={() => setScreen('menu')}
            />
            <SidebarPanel
              snapshot={snapshot}
              activePane={activePane}
              loadedAssets={engineRef.current?.getLoadedAssets() ?? preflightResult?.assets ?? null}
              assetBusy={loadingAssets}
              onTogglePane={handleTogglePane}
              onSelectUnit={handleSelectUnit}
              onSetUnitBaseColor={handleSetUnitBaseColor}
              onSetLightbarMode={handleSetLightbarMode}
              onSetSirenPattern={handleSetSirenPattern}
              onSetDrivingMode={handleSetDrivingMode}
              onSetBackupMode={handleSetBackupMode}
              onRequestBackup={handleRequestBackup}
              onDeployNailMat={handleDeployNailMat}
              onSetWeather={handleSetWeather}
              onSetCameraMode={handleSetCameraMode}
              onResetCamera={handleResetCamera}
              onSetCrimeProbability={handleSetCrimeProbability}
              onSetCowardiceLevel={handleSetCowardiceLevel}
              onTriggerCrime={handleTriggerCrime}
              onTriggerPursuit={handleTriggerPursuit}
              onToggleMount={handleToggleMount}
              onToggleAudio={handleToggleAudio}
              onToggleSimSpeed={handleToggleSimSpeed}
              onLoadZipPack={(file) => void handleLoadZipPack(file)}
              onExportZipPack={() => void handleExportZipPack()}
              onReloadDefaultPack={() => void loadDefaultPack()}
              onOpenErrorDialog={() => setErrorDialogOpen(true)}
            />
          </div>
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
    </div>
  );
}
