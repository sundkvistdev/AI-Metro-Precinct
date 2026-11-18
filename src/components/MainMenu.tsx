import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  FolderArchive,
  LayoutGrid,
  MapPin,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { AssetLoadResult } from '../assets/assetTypes';
import { AudioVoiceQuality } from '../assets/jsonAudioSynth';
import { hudLayoutStore, HudWidgetId, useHudLayout } from '../sim/hudLayout';
import { assetIdToLightbarMode } from '../sim/lightbarSystem';
import {
  BackupMode,
  DrivingMode,
  LightbarMode,
  SirenPattern,
  WeatherCondition,
} from '../sim/types';

export interface MainMenuSettings {
  initialMapId: string;
  activeLightbarId: string;
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

type SettingsTabId = 'pack' | 'simulation' | 'tactical' | 'audio' | 'graphics' | 'hud';

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'pack', label: 'Maps & Pack' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'tactical', label: 'Tactical' },
  { id: 'audio', label: 'Audio' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'hud', label: 'HUD Layout' },
];

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
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('pack');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hud = useHudLayout();

  const availableMaps = useMemo(() => {
    const maps = assetResult?.assets?.maps;
    if (!maps) return [];
    return Object.values(maps);
  }, [assetResult]);

  const availableLightbars = useMemo(() => {
    const lbs = assetResult?.assets?.lightbars;
    if (!lbs) return [];
    return Object.values(lbs);
  }, [assetResult]);

  const activeMap =
    availableMaps.find((m) => m.id === settings.initialMapId) ?? availableMaps[0];

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
        className={`relative z-10 border border-zinc-500/80 bg-zinc-800/90 p-5 shadow-2xl rounded-none transition-all ${
          showSettings
            ? 'w-[min(560px,95vw)] max-h-[90vh] flex flex-col'
            : 'w-[min(380px,92vw)]'
        }`}
      >
        <div className="text-center shrink-0">
          <h1 className="font-display text-2xl font-bold tracking-wider text-zinc-100 uppercase">
            Metro Precinct
          </h1>
          {assetResult?.assets && (
            <div className="mt-0.5 font-mono-tabular text-[10px] text-zinc-400">
              {assetResult.assets.manifest.packName} · Pack v
              {assetResult.assets.manifest.formatVersion}
            </div>
          )}
        </div>

        {fatalError && (
          <div className="mt-3 border border-red-500/70 bg-red-950/60 p-2 text-xs text-red-200 shrink-0">
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
          <div className="mt-3 flex items-center justify-between border border-amber-500/60 bg-zinc-700/80 px-2.5 py-1.5 text-xs text-amber-200 shrink-0">
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
          <div className="mt-4 space-y-3">
            {/* Multi-Map Selector at Main Menu */}
            {availableMaps.length > 0 && (
              <div className="border border-zinc-600 bg-zinc-900/50 p-2.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-sky-400" />
                    Deployment Map
                  </span>
                  <span className="font-mono-tabular text-zinc-400">
                    {availableMaps.length} Available
                  </span>
                </div>
                <select
                  value={activeMap?.id ?? settings.initialMapId}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      initialMapId: e.target.value,
                    })
                  }
                  className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-100 rounded-none cursor-pointer"
                >
                  {availableMaps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
                {activeMap && (
                  <div className="text-[10px] font-mono-tabular text-zinc-400 flex items-center justify-between gap-2">
                    <span className="truncate">
                      {activeMap.description || activeMap.districts.join(', ')}
                    </span>
                    <span className="shrink-0 text-zinc-300">
                      {activeMap.roadNetwork.nodes.length}N ·{' '}
                      {activeMap.buildings.length}B
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
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
                {loadingAssets ? 'Loading...' : 'Start Dispatch'}
              </button>

              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="w-full border border-zinc-500 bg-zinc-700/85 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors cursor-pointer rounded-none"
              >
                Settings & Asset Pack
              </button>

              <button
                type="button"
                onClick={onExit}
                className="w-full border border-zinc-600 bg-zinc-800/90 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer rounded-none"
              >
                Exit
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col min-h-0 flex-1 gap-3 text-xs">
            {/* Horizontal Single-Line Tab Bar */}
            <div className="flex overflow-x-auto border border-zinc-600 bg-zinc-900/70 p-0.5 gap-0.5 shrink-0">
              {SETTINGS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSettingsTab(t.id)}
                  className={`flex-1 px-2 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                    settingsTab === t.id
                      ? 'bg-zinc-200 text-zinc-900 font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-700/70'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
              {/* TAB: MAPS & PACK */}
              {settingsTab === 'pack' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                    Active Map & Asset Bundle (V3)
                  </div>
                  {availableMaps.length > 0 && (
                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-300">Starting Map</span>
                      <select
                        value={activeMap?.id ?? settings.initialMapId}
                        onChange={(e) =>
                          onChangeSettings({
                            ...settings,
                            initialMapId: e.target.value,
                          })
                        }
                        className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 rounded-none cursor-pointer"
                      >
                        {availableMaps.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {activeMap && (
                    <div className="border border-zinc-700 bg-zinc-900/70 p-2 font-mono-tabular text-[11px] space-y-0.5 text-zinc-300">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Map Bounds</span>
                        <span>±{activeMap.bounds.halfSize}m</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Road Graph</span>
                        <span>
                          {activeMap.roadNetwork.nodes.length} nodes /{' '}
                          {activeMap.roadNetwork.edges.length} edges
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Station Bays</span>
                        <span>
                          {(
                            activeMap.stationBays ??
                            assetResult?.config?.vehicles.stationBays ??
                            []
                          ).length}{' '}
                          bays
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1.5 border border-zinc-500 bg-zinc-700 px-2 py-1.5 text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap rounded-none"
                    >
                      <FolderArchive className="h-3.5 w-3.5" />
                      Load Pack ZIP
                    </button>
                    <button
                      type="button"
                      onClick={onReloadDefaultPack}
                      className="flex items-center justify-center gap-1.5 border border-zinc-500 bg-zinc-700 px-2 py-1.5 text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap rounded-none"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reset Default Pack
                    </button>
                  </div>
                </div>
              )}

              {/* TAB: SIMULATION */}
              {settingsTab === 'simulation' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                    World & Population Simulation
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-200">Sim Speed</span>
                      <div className="flex gap-1">
                        {([1, 2] as const).map((spd) => (
                          <button
                            key={spd}
                            type="button"
                            onClick={() =>
                              onChangeSettings({ ...settings, simSpeed: spd })
                            }
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

                  <div className="grid grid-cols-2 gap-2.5">
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
                        <span className="text-zinc-300">Auto-Crime Rate</span>
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
                        <span className="text-zinc-300">Officer Cowardice</span>
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
              )}

              {/* TAB: TACTICAL */}
              {settingsTab === 'tactical' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                    Dispatch, Pursuit & Pack Lightbar Defaults
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-300">Backup Escalation</span>
                      <select
                        value={settings.backupMode}
                        onChange={(e) =>
                          onChangeSettings({
                            ...settings,
                            backupMode: e.target.value as BackupMode,
                          })
                        }
                        className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1 text-zinc-100 rounded-none cursor-pointer"
                      >
                        <option value={BackupMode.Minimal}>Solo</option>
                        <option value={BackupMode.Standard}>Standard</option>
                        <option value={BackupMode.Perimeter}>Perimeter</option>
                        <option value={BackupMode.FullScale}>Code 99</option>
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-300">Pursuit Driving</span>
                      <select
                        value={settings.drivingMode}
                        onChange={(e) =>
                          onChangeSettings({
                            ...settings,
                            drivingMode: e.target.value as DrivingMode,
                          })
                        }
                        className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1 text-zinc-100 rounded-none cursor-pointer"
                      >
                        <option value={DrivingMode.Standard}>Standard</option>
                        <option value={DrivingMode.Aggressive}>Aggressive</option>
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-300">
                        Default Fleet Lightbar
                      </span>
                      <select
                        value={settings.activeLightbarId}
                        onChange={(e) => {
                          const lbId = e.target.value;
                          onChangeSettings({
                            ...settings,
                            activeLightbarId: lbId,
                            lightbarMode: assetIdToLightbarMode(lbId),
                          });
                        }}
                        className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1 text-zinc-100 rounded-none cursor-pointer"
                      >
                        {availableLightbars.length > 0 ? (
                          availableLightbars.map((lb) => (
                            <option key={lb.id} value={lb.id}>
                              {lb.name} ({lb.hardwareStyle})
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="led_array">LED Array</option>
                            <option value="flashing_halogen">Flashing Halogen</option>
                            <option value="rotating_halogen">Rotating Beacon</option>
                            <option value="vector_pods">Vector V-Pod</option>
                            <option value="visor_stealth">Visor Stealth</option>
                            <option value="mini_beacon">Mini Beacon</option>
                          </>
                        )}
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-zinc-300">Siren Pattern</span>
                      <select
                        value={settings.sirenPattern}
                        onChange={(e) =>
                          onChangeSettings({
                            ...settings,
                            sirenPattern: e.target.value as SirenPattern,
                          })
                        }
                        className="w-full border border-zinc-500 bg-zinc-800 px-2 py-1 text-zinc-100 rounded-none cursor-pointer"
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
              )}

              {/* TAB: AUDIO */}
              {settingsTab === 'audio' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                    WebAudio Mixer & Voice Budget
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
                    <span className="text-zinc-200">Voice Polyphony Quality</span>
                    <div className="flex gap-1">
                      {(['low', 'normal', 'high'] as const).map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() =>
                            onChangeSettings({ ...settings, audioQuality: q })
                          }
                          className={`border px-2.5 py-0.5 capitalize cursor-pointer rounded-none ${
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
              )}

              {/* TAB: GRAPHICS */}
              {settingsTab === 'graphics' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
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
                          onClick={() =>
                            onChangeSettings({ ...settings, renderScale: sc })
                          }
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
                      <span className="text-zinc-300">Crash Detachment Intensity</span>
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
              )}

              {/* TAB: HUD LAYOUT */}
              {settingsTab === 'hud' && (
                <div className="border border-zinc-600 bg-zinc-900/45 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                      <LayoutGrid className="h-3.5 w-3.5 text-sky-400" />
                      HUD Layout & Widget Visibility
                    </span>
                    <button
                      type="button"
                      onClick={() => hudLayoutStore.reset()}
                      className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset HUD
                    </button>
                  </div>

                  <div className="space-y-1">
                    {(
                      [
                        { id: 'topBar', label: 'Top Status Bar' },
                        { id: 'sidebarDock', label: 'Sidebar Dock & Panels' },
                        { id: 'cameraBar', label: 'Camera & Quick Bar' },
                      ] as Array<{ id: HudWidgetId; label: string }>
                    ).map((w) => (
                      <label
                        key={w.id}
                        className="flex items-center justify-between border border-zinc-700 bg-zinc-800/70 px-2.5 py-1.5 cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 text-zinc-200">
                          <Eye className="h-3 w-3 text-zinc-400" />
                          {w.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={hud.widgets[w.id].visible}
                          onChange={(e) =>
                            hudLayoutStore.updateWidget(w.id, {
                              visible: e.target.checked,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-300">HUD Opacity</span>
                      <span className="font-mono-tabular text-zinc-100">
                        {Math.round(hud.hudOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={45}
                      max={100}
                      step={5}
                      value={Math.round(hud.hudOpacity * 100)}
                      onChange={(e) =>
                        hudLayoutStore.setHudOpacity(Number(e.target.value) / 100)
                      }
                      className="sharp-slider w-full"
                    />
                  </label>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="w-full border border-zinc-400 bg-zinc-200 px-3 py-1.5 font-semibold text-zinc-900 hover:bg-white cursor-pointer shrink-0 rounded-none"
            >
              Back to Menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
