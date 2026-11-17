import React, { useRef, useState } from 'react';
import { AlertTriangle, FolderArchive, RefreshCw } from 'lucide-react';
import { AssetLoadResult } from '../assets/assetTypes';
import { AudioVoiceQuality } from '../assets/jsonAudioSynth';
import {
  BackupMode,
  DrivingMode,
  LightbarMode,
  SirenPattern,
  WeatherCondition,
} from '../sim/types';

export interface MainMenuSettings {
  audioEnabled: boolean;
  audioVolume: number;
  audioQuality: AudioVoiceQuality;
  simSpeed: 1 | 2;
  weather: WeatherCondition;
  backupMode: BackupMode;
  drivingMode: DrivingMode;
  lightbarMode: LightbarMode;
  sirenPattern: SirenPattern;
  trafficScale: number;
  pedScale: number;
  crimeProbability: number;
  cowardiceLevel: number;
  shadowsEnabled: boolean;
  debrisObstacles: boolean;
  renderScale: 0.75 | 1 | 1.5;
  crashIntensity: number;
}

export interface MainMenuProps {
  assetResult: AssetLoadResult | null;
  loadingAssets: boolean;
  settings: MainMenuSettings;
  onChangeSettings: (next: MainMenuSettings) => void;
  onStart: () => void;
  onExit: () => void;
  onOpenErrorDialog: () => void;
  onLoadZipPack: (file: File) => void;
  onReloadDefaultPack: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  assetResult,
  loadingAssets,
  settings,
  onChangeSettings,
  onStart,
  onExit,
  onOpenErrorDialog,
  onLoadZipPack,
  onReloadDefaultPack,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fatalError = assetResult?.fatalError ?? null;
  const issueCount = assetResult?.issues.length ?? 0;
  const canStart = Boolean(!loadingAssets && assetResult && !fatalError && assetResult.config);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-zinc-800 text-zinc-100">
      {/* Blurry gradient backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-20 opacity-90 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at 22% 28%, rgba(71, 85, 105, 0.72), transparent 52%), radial-gradient(circle at 78% 72%, rgba(30, 58, 138, 0.45), transparent 55%), linear-gradient(135deg, #272b33 0%, #373d49 48%, #22262e 100%)',
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onLoadZipPack(file);
          }
          e.target.value = '';
        }}
      />

      <div
        className={`relative z-10 border border-zinc-500/80 bg-zinc-800/85 backdrop-blur-md p-5 shadow-2xl rounded-none transition-all ${
          showSettings
            ? 'w-[min(480px,94vw)] max-h-[90vh] overflow-y-auto'
            : 'w-[min(360px,92vw)]'
        }`}
      >
        <h1 className="font-display text-2xl font-bold tracking-wider text-zinc-100 uppercase text-center">
          Metro Precinct
        </h1>

        {fatalError && (
          <div className="mt-3 border border-red-500/70 bg-red-950/60 p-2 text-xs text-red-200">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                Fatal Config Failure
              </span>
              <button
                type="button"
                onClick={onOpenErrorDialog}
                className="border border-red-400/60 bg-red-900/60 px-2 py-0.5 text-[11px] text-red-100 hover:bg-red-800 cursor-pointer rounded-none"
              >
                Inspect
              </button>
            </div>
          </div>
        )}

        {!fatalError && issueCount > 0 && (
          <div className="mt-3 flex items-center justify-between border border-amber-500/60 bg-zinc-700/80 px-2.5 py-1.5 text-xs text-amber-200">
            <span>{issueCount} asset issue(s) logged</span>
            <button
              type="button"
              onClick={onOpenErrorDialog}
              className="border border-amber-400/60 bg-zinc-800 px-2 py-0.5 text-[11px] hover:bg-zinc-600 cursor-pointer rounded-none"
            >
              Details
            </button>
          </div>
        )}

        {!showSettings ? (
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={!canStart}
              onClick={onStart}
              className={`w-full border px-4 py-2 text-sm font-semibold tracking-wide transition-colors rounded-none ${
                canStart
                  ? 'border-zinc-400 bg-zinc-200 text-zinc-900 hover:bg-white cursor-pointer'
                  : 'border-zinc-600 bg-zinc-700/60 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {loadingAssets ? 'Loading...' : 'Start'}
            </button>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="w-full border border-zinc-500 bg-zinc-700/85 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors cursor-pointer rounded-none"
            >
              Settings
            </button>

            <button
              type="button"
              onClick={onExit}
              className="w-full border border-zinc-600 bg-zinc-800/90 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer rounded-none"
            >
              Exit
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-xs">
            {/* Audio Section */}
            <div className="border border-zinc-600 bg-zinc-900/40 p-2.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Audio
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">Audio Engine</span>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSettings({
                      ...settings,
                      audioEnabled: !settings.audioEnabled,
                    })
                  }
                  className="border border-zinc-500 bg-zinc-800 px-2.5 py-0.5 font-mono-tabular text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                >
                  {settings.audioEnabled ? 'Enabled' : 'Muted'}
                </button>
              </div>
              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-300">Master Volume</span>
                  <span className="font-mono-tabular text-zinc-100">
                    {Math.round(settings.audioVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(settings.audioVolume * 100)}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      audioVolume: Number(e.target.value) / 100,
                    })
                  }
                  className="sharp-slider w-full"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">Voice Quality</span>
                <div className="flex gap-1">
                  {(['low', 'normal', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onChangeSettings({ ...settings, audioQuality: q })}
                      className={`border px-2 py-0.5 capitalize cursor-pointer rounded-none ${
                        settings.audioQuality === q
                          ? 'border-zinc-300 bg-zinc-200 text-zinc-900 font-semibold'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-600'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Simulation Section */}
            <div className="border border-zinc-600 bg-zinc-900/40 p-2.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Simulation
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200">Speed</span>
                  <div className="flex gap-1">
                    {([1, 2] as const).map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => onChangeSettings({ ...settings, simSpeed: spd })}
                        className={`border px-2 py-0.5 font-mono-tabular cursor-pointer rounded-none ${
                          settings.simSpeed === spd
                            ? 'border-zinc-300 bg-zinc-200 text-zinc-900 font-semibold'
                            : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-600'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">Weather</span>
                  <select
                    value={settings.weather}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        weather: e.target.value as WeatherCondition,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 rounded-none cursor-pointer"
                  >
                    <option value={WeatherCondition.Clear}>Clear</option>
                    <option value={WeatherCondition.Overcast}>Overcast</option>
                    <option value={WeatherCondition.Rain}>Rain</option>
                    <option value={WeatherCondition.HeavyFog}>Heavy Fog</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-300">Traffic Density</span>
                    <span className="font-mono-tabular text-zinc-100">
                      {Math.round(settings.trafficScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={Math.round(settings.trafficScale * 100)}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        trafficScale: Number(e.target.value) / 100,
                      })
                    }
                    className="sharp-slider w-full"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-300">Pedestrians</span>
                    <span className="font-mono-tabular text-zinc-100">
                      {Math.round(settings.pedScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={10}
                    value={Math.round(settings.pedScale * 100)}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        pedScale: Number(e.target.value) / 100,
                      })
                    }
                    className="sharp-slider w-full"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-300">Auto-Crime</span>
                    <span className="font-mono-tabular text-zinc-100">
                      {Math.round(settings.crimeProbability * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(settings.crimeProbability * 100)}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        crimeProbability: Number(e.target.value) / 100,
                      })
                    }
                    className="sharp-slider w-full"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-300">Cowardice</span>
                    <span className="font-mono-tabular text-zinc-100">
                      {Math.round(settings.cowardiceLevel * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(settings.cowardiceLevel * 100)}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        cowardiceLevel: Number(e.target.value) / 100,
                      })
                    }
                    className="sharp-slider w-full"
                  />
                </label>
              </div>
            </div>

            {/* Tactical Defaults Section */}
            <div className="border border-zinc-600 bg-zinc-900/40 p-2.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Tactical Defaults
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">Backup</span>
                  <select
                    value={settings.backupMode}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        backupMode: e.target.value as BackupMode,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 rounded-none cursor-pointer"
                  >
                    <option value={BackupMode.Minimal}>Solo</option>
                    <option value={BackupMode.Standard}>Standard</option>
                    <option value={BackupMode.Perimeter}>Perimeter</option>
                    <option value={BackupMode.FullScale}>Code 99</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">Driving</span>
                  <select
                    value={settings.drivingMode}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        drivingMode: e.target.value as DrivingMode,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 rounded-none cursor-pointer"
                  >
                    <option value={DrivingMode.Standard}>Standard</option>
                    <option value={DrivingMode.Aggressive}>Aggressive</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">Lightbar</span>
                  <select
                    value={settings.lightbarMode}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        lightbarMode: e.target.value as LightbarMode,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 rounded-none cursor-pointer"
                  >
                    <option value={LightbarMode.LED}>LED Array</option>
                    <option value={LightbarMode.FlashingHalogen}>Halogen</option>
                    <option value={LightbarMode.RotatingHalogen}>Rotator</option>
                    <option value={LightbarMode.VectorPods}>Vector V-Pod</option>
                    <option value={LightbarMode.VisorStealth}>Visor Stealth</option>
                    <option value={LightbarMode.MiniBeacon}>Mini Beacon</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200">Siren</span>
                  <select
                    value={settings.sirenPattern}
                    onChange={(e) =>
                      onChangeSettings({
                        ...settings,
                        sirenPattern: e.target.value as SirenPattern,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-1.5 py-0.5 text-zinc-100 rounded-none cursor-pointer"
                  >
                    <option value={SirenPattern.AutoCycle}>Auto Cycle</option>
                    <option value={SirenPattern.Wail}>Wail</option>
                    <option value={SirenPattern.Yelp}>Yelp</option>
                    <option value={SirenPattern.Phaser}>Phaser</option>
                    <option value={SirenPattern.HiLo}>Hi-Lo</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Graphics & Crash Physics Section */}
            <div className="border border-zinc-600 bg-zinc-900/40 p-2.5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Graphics & Crash Physics
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200">Shadows</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeSettings({
                        ...settings,
                        shadowsEnabled: !settings.shadowsEnabled,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-2 py-0.5 font-mono-tabular text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                  >
                    {settings.shadowsEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200">Debris Hitboxes</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeSettings({
                        ...settings,
                        debrisObstacles: !settings.debrisObstacles,
                      })
                    }
                    className="border border-zinc-500 bg-zinc-800 px-2 py-0.5 font-mono-tabular text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                  >
                    {settings.debrisObstacles ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-200">Render Scale</span>
                <div className="flex gap-1">
                  {([0.75, 1, 1.5] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => onChangeSettings({ ...settings, renderScale: sc })}
                      className={`border px-2 py-0.5 font-mono-tabular cursor-pointer rounded-none ${
                        settings.renderScale === sc
                          ? 'border-zinc-300 bg-zinc-200 text-zinc-900 font-semibold'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-600'
                      }`}
                    >
                      {sc}x
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-zinc-300">Crash Intensity</span>
                  <span className="font-mono-tabular text-zinc-100">
                    {Math.round(settings.crashIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={10}
                  value={Math.round(settings.crashIntensity * 100)}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      crashIntensity: Number(e.target.value) / 100,
                    })
                  }
                  className="sharp-slider w-full"
                />
              </label>
            </div>

            {/* Asset Pack Actions */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 border border-zinc-500 bg-zinc-700 px-2 py-1.5 text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <FolderArchive className="h-3.5 w-3.5" />
                Load ZIP
              </button>
              <button
                type="button"
                onClick={onReloadDefaultPack}
                className="flex items-center justify-center gap-1.5 border border-zinc-500 bg-zinc-700 px-2 py-1.5 text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reset Pack
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="w-full border border-zinc-400 bg-zinc-200 px-3 py-1.5 font-semibold text-zinc-900 hover:bg-white cursor-pointer rounded-none"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
