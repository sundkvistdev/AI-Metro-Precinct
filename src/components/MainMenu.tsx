import React, { useRef, useState } from 'react';
import { AlertTriangle, FolderArchive, RefreshCw } from 'lucide-react';
import { AssetLoadResult } from '../assets/assetTypes';
import { BackupMode, WeatherCondition } from '../sim/types';

export interface MainMenuSettings {
  audioEnabled: boolean;
  simSpeed: 1 | 2;
  weather: WeatherCondition;
  backupMode: BackupMode;
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

      <div className="relative z-10 w-[min(360px,92vw)] border border-zinc-500/80 bg-zinc-800/80 backdrop-blur-md p-5 shadow-2xl rounded-none">
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
          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between border border-zinc-600 bg-zinc-700/60 px-2.5 py-1.5">
              <span className="text-zinc-200">Audio</span>
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

            <div className="flex items-center justify-between border border-zinc-600 bg-zinc-700/60 px-2.5 py-1.5">
              <span className="text-zinc-200">Sim Speed</span>
              <div className="flex gap-1">
                {([1, 2] as const).map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onChangeSettings({ ...settings, simSpeed: spd })}
                    className={`border px-2 py-0.5 font-mono-tabular cursor-pointer rounded-none ${
                      settings.simSpeed === spd
                        ? 'border-zinc-300 bg-zinc-200 text-zinc-900 font-semibold'
                        : 'border-zinc-500 bg-zinc-800 text-zinc-300 hover:bg-zinc-600'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border border-zinc-600 bg-zinc-700/60 px-2.5 py-1.5">
              <span className="text-zinc-200">Weather</span>
              <select
                value={settings.weather}
                onChange={(e) =>
                  onChangeSettings({
                    ...settings,
                    weather: e.target.value as WeatherCondition,
                  })
                }
                className="border border-zinc-500 bg-zinc-800 px-2 py-0.5 text-zinc-100 rounded-none cursor-pointer"
              >
                <option value={WeatherCondition.Clear}>Clear</option>
                <option value={WeatherCondition.Overcast}>Overcast</option>
                <option value={WeatherCondition.Rain}>Rain</option>
                <option value={WeatherCondition.HeavyFog}>Heavy Fog</option>
              </select>
            </div>

            <div className="flex items-center justify-between border border-zinc-600 bg-zinc-700/60 px-2.5 py-1.5">
              <span className="text-zinc-200">Backup Policy</span>
              <select
                value={settings.backupMode}
                onChange={(e) =>
                  onChangeSettings({
                    ...settings,
                    backupMode: e.target.value as BackupMode,
                  })
                }
                className="border border-zinc-500 bg-zinc-800 px-2 py-0.5 text-zinc-100 rounded-none cursor-pointer"
              >
                <option value={BackupMode.Minimal}>Solo</option>
                <option value={BackupMode.Standard}>Standard</option>
                <option value={BackupMode.Perimeter}>Perimeter</option>
                <option value={BackupMode.FullScale}>Code 99</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
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
