import { useCallback, useEffect, useRef, useState } from 'react';
import { SimHud } from './components/SimHud';
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
  crimeProbability: 0.35,
  cowardiceLevel: 0.35,
  audioEnabled: true,
  simSpeed: 1,
  isSoftwareGl: false,
  assetPackName: 'metro_precinct_core',
  assetCounts: { textures: 0, models: 0, audio: 0 },
  assetsLoaded: false,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PoliceSimEngine | null>(null);
  const [snapshot, setSnapshot] = useState<SimSnapshot>(INITIAL_SNAPSHOT);
  const [collapsed, setCollapsed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new PoliceSimEngine(
      container,
      (nextSnap) => setSnapshot(nextSnap),
      (lost) => setContextLost(lost),
    );
    engineRef.current = engine;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setCollapsed((c) => !c);
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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={mountRef} className="h-full w-full" />

      {!snapshot.assetsLoaded && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/85">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4 text-center">
            <p className="font-display text-sm font-semibold text-slate-100">
              Loading JSON Procedural Assets
            </p>
            <p className="mt-1 text-xs text-slate-400 font-mono-tabular">
              /jdataassets/manifest.json
            </p>
          </div>
        </div>
      )}

      {contextLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 text-center p-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-4">
            <p className="font-display text-base font-semibold text-slate-100">
              3D Graphics Context Suspended
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Waiting for WebGL context restoration.
            </p>
          </div>
        </div>
      )}

      <SimHud
        snapshot={snapshot}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
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
      />
    </div>
  );
}
