import React, { useState } from 'react';
import {
  Camera,
  Car,
  CloudRain,
  Crosshair,
  Eye,
  FolderArchive,
  Gauge,
  LayoutGrid,
  MapPin,
  RotateCcw,
  Settings,
  ShieldAlert,
  Shuffle,
  Siren,
  TriangleAlert,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { hudLayoutStore, HudWidgetId, useHudLayout } from '../sim/hudLayout';
import { HudEditableFrame } from './HudEditableFrame';
import {
  BackupMode,
  CameraMode,
  DrivingMode,
  SimSnapshot,
  SirenPattern,
  UnitStatus,
  WeatherCondition,
} from '../sim/types';
import { AssetManagerPane } from './AssetManagerPane';
import { DevToolsPane, DevToolsPaneProps } from './DevToolsPane';

export type SidebarPaneId =
  | 'units'
  | 'dispatch'
  | 'world'
  | 'settings'
  | 'assets'
  | 'devtools';

export interface SidebarPanelProps {
  snapshot: SimSnapshot;
  activePane: SidebarPaneId | null;
  loadedAssets: LoadedJsonAssets | null;
  assetBusy: boolean;
  onTogglePane: (pane: SidebarPaneId) => void;
  onSelectUnit: (id: string) => void;
  onSetUnitBaseColor: (unitId: string, colorHex: number) => void;
  onSetLightbarById: (lightbarId: string) => void;
  onSetSirenPattern: (pattern: SirenPattern) => void;
  onSetDrivingMode: (mode: DrivingMode) => void;
  onSetBackupMode: (mode: BackupMode) => void;
  onRequestBackup: (crimeId?: string) => void;
  onDeployNailMat: () => void;
  onSetWeather: (weather: WeatherCondition) => void;
  onSwitchMap: (mapId: string) => void;
  onSetCameraMode: (mode: CameraMode) => void;
  onResetCamera: () => void;
  onSetCrimeProbability: (prob: number) => void;
  onSetCowardiceLevel: (level: number) => void;
  onTriggerCrime: () => void;
  onTriggerPursuit: () => void;
  onToggleMount: () => void;
  onToggleAudio: () => void;
  onSetAudioVolume: (volume: number) => void;
  onToggleSimSpeed: () => void;
  onSetDebrisObstacles: (enabled: boolean) => void;
  onSetCrashIntensity: (intensity: number) => void;
  onLoadZipPack: (file: File) => void;
  onExportZipPack: () => void;
  onReloadDefaultPack: () => void;
  onOpenErrorDialog: () => void;
  onOpenValidator: () => void;
  devTools: DevToolsPaneProps;
}

const STATUS_LABELS: Record<UnitStatus, string> = {
  [UnitStatus.AtStation]: 'Station',
  [UnitStatus.Responding]: 'Code 3',
  [UnitStatus.Pursuing]: 'Pursuit',
  [UnitStatus.DeployingSpikes]: 'Spikes',
  [UnitStatus.Dismounting]: 'Dismount',
  [UnitStatus.Engaging]: 'Firing',
  [UnitStatus.Mounting]: 'Mounting',
  [UnitStatus.Retreating]: 'Fleeing',
  [UnitStatus.Returning]: 'Returning',
};

const PANE_META: Record<SidebarPaneId, { title: string; icon: React.ReactNode }> = {
  units: { title: 'Patrol Units', icon: <Car className="h-4 w-4" /> },
  dispatch: { title: 'Dispatch & Tactics', icon: <ShieldAlert className="h-4 w-4" /> },
  world: { title: 'Maps & Lightbars', icon: <MapPin className="h-4 w-4" /> },
  settings: { title: 'Sim & HUD Settings', icon: <Settings className="h-4 w-4" /> },
  assets: { title: 'Asset Pack V3', icon: <FolderArchive className="h-4 w-4" /> },
  devtools: { title: 'Dev & Asset Studio', icon: <Wrench className="h-4 w-4" /> },
};

type IngameSettingsTab = 'sim' | 'audio' | 'graphics' | 'hud';

export const SidebarPanel: React.FC<SidebarPanelProps> = (props) => {
  const {
    snapshot,
    activePane,
    loadedAssets,
    assetBusy,
    onTogglePane,
    onSelectUnit,
    onSetUnitBaseColor,
    onSetLightbarById,
    onSetSirenPattern,
    onSetDrivingMode,
    onSetBackupMode,
    onRequestBackup,
    onDeployNailMat,
    onSetWeather,
    onSwitchMap,
    onSetCameraMode,
    onResetCamera,
    onSetCrimeProbability,
    onSetCowardiceLevel,
    onTriggerCrime,
    onTriggerPursuit,
    onToggleMount,
    onToggleAudio,
    onSetAudioVolume,
    onToggleSimSpeed,
    onSetDebrisObstacles,
    onSetCrashIntensity,
    onLoadZipPack,
    onExportZipPack,
    onReloadDefaultPack,
    onOpenErrorDialog,
    onOpenValidator,
    devTools,
  } = props;

  const [settingsTab, setSettingsTab] = useState<IngameSettingsTab>('sim');
  const hud = useHudLayout();

  const selectedUnit =
    snapshot.units.find((u) => u.id === snapshot.selectedUnitId) ?? snapshot.units[0];
  const canToggleMount = Boolean(
    selectedUnit &&
      (selectedUnit.mounted ||
        (!selectedUnit.immobilized &&
          (selectedUnit.status === UnitStatus.Engaging ||
            selectedUnit.status === UnitStatus.Dismounting))),
  );
  const hasStandbyUnit = snapshot.units.some(
    (u) =>
      !u.immobilized &&
      (u.status === UnitStatus.AtStation || u.status === UnitStatus.Returning),
  );
  const canRequestBackup =
    hasStandbyUnit && snapshot.activeCrimes.some((c) => c.suspectAlive);
  const hasActivePursuit = snapshot.activeCrimes.some(
    (c) => c.suspectAlive && c.inVehiclePursuit,
  );
  const hasSpikeCapableUnit = snapshot.units.some(
    (u) =>
      u.mounted &&
      !u.immobilized &&
      u.status !== UnitStatus.DeployingSpikes &&
      (u.status === UnitStatus.AtStation ||
        u.status === UnitStatus.Returning ||
        u.status === UnitStatus.Pursuing),
  );
  const canDeployNailMat = hasActivePursuit && hasSpikeCapableUnit;

  const devDirty = Boolean(
    devTools.state?.dirtyMap ||
      devTools.state?.dirtyModel ||
      devTools.state?.dirtyLightbars ||
      devTools.state?.dirtyMaterials ||
      devTools.state?.dirtyTextures ||
      devTools.state?.dirtyAudio,
  );

  return (
    <HudEditableFrame
      widgetId="sidebarDock"
      label="Sidebar Dock"
      allowWidthResize={false}
      allowHeightResize={false}
      zIndex={20}
    >
      <div className="pointer-events-none flex items-start gap-1">
        {/* Vertical Categorized Icon Rail */}
        <nav
          aria-label="Simulation control panes"
          className="pointer-events-auto ui-panel flex flex-col divide-y divide-zinc-600 shadow-lg shrink-0"
        >
          {(Object.keys(PANE_META) as SidebarPaneId[]).map((id) => {
            const isOpen = activePane === id;
            const badge = id === 'assets' && snapshot.assetIssues.length > 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTogglePane(id)}
                title={PANE_META[id].title}
                aria-label={PANE_META[id].title}
                aria-expanded={isOpen}
                className={`relative flex h-9 w-9 items-center justify-center transition-colors cursor-pointer rounded-none ${
                  isOpen
                    ? 'bg-zinc-200 text-zinc-900'
                    : 'bg-zinc-800/90 text-zinc-200 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {PANE_META[id].icon}
                {badge && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 bg-amber-400" />
                )}
                {id === 'devtools' && devDirty && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 bg-sky-400" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Collapsible Active Pane */}
        {activePane && (
          <aside
            className={`pointer-events-auto ui-panel max-h-[calc(100vh-112px)] flex flex-col shadow-xl ${
              activePane === 'devtools'
                ? 'w-[min(740px,calc(100vw-60px))]'
                : 'w-[310px]'
            }`}
          >
            <div className="flex items-center justify-between border-b border-zinc-600 bg-zinc-700/75 px-2.5 py-1.5 shrink-0">
              <span className="font-display text-xs font-semibold tracking-wider uppercase text-zinc-100">
                {PANE_META[activePane].title}
              </span>
              <button
                type="button"
                onClick={() => onTogglePane(activePane)}
                aria-label="Collapse pane"
                className="border border-zinc-500 bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="overflow-y-auto p-2 space-y-2.5">
              {/* UNITS */}
              {activePane === 'units' && (
                <>
                  <div className="space-y-1">
                    {snapshot.units.map((unit) => {
                      const selected = unit.id === snapshot.selectedUnitId;
                      const statusText =
                        unit.downedOfficers > 0
                          ? `${unit.downedOfficers} KIA`
                          : unit.immobilized && unit.mounted
                          ? 'Disabled'
                          : unit.reversing
                          ? 'Reversing'
                          : unit.fleeingOfficers > 0 && unit.status !== UnitStatus.Retreating
                          ? 'Panicking'
                          : !unit.mounted && unit.freeRoam && !unit.targetCrimeId
                          ? 'Foot Patrol'
                          : STATUS_LABELS[unit.status];

                      return (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => onSelectUnit(unit.id)}
                          className={`w-full flex items-center justify-between gap-1.5 border px-2 py-1 text-xs transition-colors cursor-pointer rounded-none ${
                            selected
                              ? 'border-blue-400 bg-blue-600/90 text-white'
                              : unit.isHeavyUnit
                              ? 'border-amber-500/40 bg-zinc-700/70 text-amber-100 hover:bg-zinc-600'
                              : 'border-zinc-600 bg-zinc-700/50 text-zinc-100 hover:bg-zinc-600'
                          }`}
                        >
                          <span className="flex items-center gap-1 font-medium whitespace-nowrap truncate">
                            <span>{unit.callsign}</span>
                            {unit.weaponKind === 'rifle' && (
                              <span
                                className={`text-[10px] font-mono-tabular uppercase ${
                                  selected
                                    ? 'text-blue-100'
                                    : unit.isHeavyUnit
                                    ? 'text-amber-300'
                                    : 'text-sky-300'
                                }`}
                              >
                                {unit.isHeavyUnit ? 'HEAVY' : 'AR'}
                              </span>
                            )}
                            {unit.assignedCaseNumber !== null && (
                              <span
                                className={`text-[10px] font-mono-tabular ${
                                  selected ? 'text-blue-100' : 'text-zinc-400'
                                }`}
                              >
                                #{unit.assignedCaseNumber}
                              </span>
                            )}
                          </span>

                          <span
                            className={`font-mono-tabular text-[11px] whitespace-nowrap ${
                              unit.downedOfficers > 0 || unit.immobilized
                                ? 'text-red-300'
                                : unit.reversing ||
                                  unit.fleeingOfficers > 0 ||
                                  unit.status === UnitStatus.Retreating ||
                                  unit.status === UnitStatus.DeployingSpikes
                                ? 'text-amber-300'
                                : selected
                                ? 'text-blue-100'
                                : 'text-zinc-300'
                            }`}
                          >
                            {statusText}
                            {unit.speedKmh > 0 ? ` ${unit.speedKmh}km/h` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedUnit && (
                    <div className="ui-subpanel p-2 space-y-2 text-xs">
                      <div className="flex items-center justify-between font-mono-tabular text-[11px] text-zinc-300">
                        <span>{selectedUnit.vehicleKind.toUpperCase()}</span>
                        <span>{selectedUnit.liveryLabel}</span>
                      </div>
                      <div className="border border-zinc-700 bg-zinc-900/70 px-2 py-1 font-mono-tabular text-[10px] space-y-0.5">
                        <div className="flex justify-between text-sky-300">
                          <span>GOAL: {selectedUnit.activeGoal}</span>
                          <span>IMP {selectedUnit.impatience}%</span>
                        </div>
                        <div className="text-zinc-400 truncate">
                          {selectedUnit.goalReason}
                        </div>
                        <div className="flex justify-between text-zinc-400">
                          <span>
                            {selectedUnit.assignedCaseNumber !== null
                              ? `Case #${selectedUnit.assignedCaseNumber} (${selectedUnit.assignedRole ?? 'assigned'})`
                              : 'Unassigned'}
                          </span>
                          <span>Bar: {selectedUnit.lightbarId}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={onToggleMount}
                          disabled={!canToggleMount}
                          className={`flex items-center justify-center gap-1 border px-2 py-1 font-medium whitespace-nowrap shrink-0 rounded-none ${
                            canToggleMount
                              ? 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
                              : 'border-zinc-700 bg-zinc-800/70 text-zinc-500 cursor-not-allowed'
                          }`}
                        >
                          <Users className="h-3.5 w-3.5" />
                          {selectedUnit.mounted ? 'Dismount Crew' : 'Mount Crew'}
                        </button>

                        <button
                          type="button"
                          onClick={() => onSetCameraMode(CameraMode.FollowUnit)}
                          className={`flex items-center justify-center gap-1 border px-2 py-1 font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                            snapshot.cameraMode === CameraMode.FollowUnit
                              ? 'border-blue-400 bg-blue-600 text-white'
                              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                          }`}
                        >
                          <Camera className="h-3.5 w-3.5" />
                          Follow Unit
                        </button>
                      </div>

                      {snapshot.paintPalette.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-zinc-300">
                            <span>Base Paint</span>
                            <button
                              type="button"
                              onClick={() => {
                                const others = snapshot.paintPalette.filter(
                                  (s) => s.hex !== selectedUnit.baseColorHex,
                                );
                                const pick =
                                  others[Math.floor(Math.random() * others.length)] ??
                                  snapshot.paintPalette[0];
                                if (pick) onSetUnitBaseColor(selectedUnit.id, pick.hex);
                              }}
                              className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
                            >
                              <Shuffle className="h-3 w-3" />
                              Random
                            </button>
                          </div>
                          <div className="grid grid-cols-8 gap-1">
                            {snapshot.paintPalette.map((swatch) => {
                              const active = selectedUnit.baseColorHex === swatch.hex;
                              const cssHex = `#${swatch.hex.toString(16).padStart(6, '0')}`;
                              return (
                                <button
                                  key={swatch.id}
                                  type="button"
                                  onClick={() => onSetUnitBaseColor(selectedUnit.id, swatch.hex)}
                                  title={swatch.label}
                                  aria-label={`Set ${selectedUnit.callsign} paint to ${swatch.label}`}
                                  style={{ backgroundColor: cssHex }}
                                  className={`h-5 w-full border cursor-pointer rounded-none ${
                                    active
                                      ? 'border-white ring-1 ring-blue-400'
                                      : 'border-zinc-500 hover:border-zinc-200'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* DISPATCH & TACTICS */}
              {activePane === 'dispatch' && (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={onTriggerCrime}
                      className="flex items-center justify-center gap-1 border border-red-400/70 bg-red-600/90 px-2 py-1.5 font-semibold text-white hover:bg-red-500 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Foot Crime
                    </button>
                    <button
                      type="button"
                      onClick={onTriggerPursuit}
                      className="flex items-center justify-center gap-1 border border-orange-400/70 bg-orange-600/90 px-2 py-1.5 font-semibold text-white hover:bg-orange-500 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
                    >
                      <Car className="h-3.5 w-3.5" />
                      Pursuit
                    </button>
                    <button
                      type="button"
                      disabled={!canRequestBackup}
                      onClick={() => onRequestBackup()}
                      className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
                        canRequestBackup
                          ? 'border-blue-400/70 bg-blue-600/40 text-blue-100 hover:bg-blue-600/60 cursor-pointer'
                          : 'border-zinc-700 bg-zinc-800/70 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Call Backup
                    </button>
                    <button
                      type="button"
                      disabled={!canDeployNailMat}
                      onClick={onDeployNailMat}
                      className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
                        canDeployNailMat
                          ? 'border-amber-400/70 bg-amber-600/35 text-amber-100 hover:bg-amber-600/50 cursor-pointer'
                          : 'border-zinc-700 bg-zinc-800/70 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Nail Mat
                    </button>
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
                      <span>Active Cases</span>
                      <span className="font-mono-tabular text-zinc-400">
                        {snapshot.activeCrimes.length}
                      </span>
                    </div>
                    {snapshot.activeCrimes.length === 0 ? (
                      <div className="text-[11px] text-zinc-400">
                        No active incidents. Dispatch standby patrol or trigger a call.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {snapshot.activeCrimes.map((crime) => {
                          const urgColor =
                            crime.urgencyLevel === 'critical'
                              ? 'bg-red-500'
                              : crime.urgencyLevel === 'high'
                              ? 'bg-orange-500'
                              : crime.urgencyLevel === 'medium'
                              ? 'bg-amber-400'
                              : 'bg-sky-400';
                          const urgBadge =
                            crime.urgencyLevel === 'critical'
                              ? 'border-red-400/80 bg-red-600/80 text-white'
                              : crime.urgencyLevel === 'high'
                              ? 'border-orange-400/80 bg-orange-600/70 text-white'
                              : crime.urgencyLevel === 'medium'
                              ? 'border-amber-400/70 bg-amber-600/40 text-amber-100'
                              : 'border-zinc-500 bg-zinc-700 text-zinc-200';
                          const caseCanBackup = hasStandbyUnit && crime.suspectAlive;

                          return (
                            <div
                              key={crime.id}
                              className="border border-zinc-600 bg-zinc-800/75 p-1.5 space-y-1 rounded-none"
                            >
                              <div className="flex items-center justify-between gap-1 text-[11px]">
                                <span className="font-medium text-zinc-100 truncate">
                                  <span className="font-mono-tabular text-zinc-300">
                                    #{crime.caseNumber}
                                  </span>{' '}
                                  {crime.type}
                                </span>
                                <span
                                  className={`shrink-0 border px-1 text-[10px] font-mono-tabular font-semibold uppercase ${urgBadge}`}
                                >
                                  {crime.urgencyLevel} {crime.urgency}
                                </span>
                              </div>

                              <div className="h-1 w-full bg-zinc-700">
                                <div
                                  className={`h-full ${urgColor}`}
                                  style={{ width: `${crime.urgency}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between gap-1 text-[10px] font-mono-tabular text-zinc-300">
                                <span>
                                  {crime.district} · {crime.incidentStatus.replace('_', ' ')}
                                </span>
                                <span>
                                  {!crime.suspectAlive
                                    ? 'Neutralized'
                                    : crime.inVehiclePursuit
                                    ? `Veh ${crime.vehicleHp}%`
                                    : `HP ${crime.suspectHp}%`}
                                </span>
                              </div>

                              <div className="flex items-center justify-between gap-1 pt-0.5">
                                <div className="flex flex-wrap gap-1">
                                  {crime.assignedUnits.length > 0 ? (
                                    crime.assignedUnits.map((u) => (
                                      <button
                                        key={u.unitId}
                                        type="button"
                                        onClick={() => onSelectUnit(u.unitId)}
                                        className={`border px-1 py-0 text-[10px] font-mono-tabular cursor-pointer rounded-none ${
                                          u.unitId === snapshot.selectedUnitId
                                            ? 'border-blue-400 bg-blue-600 text-white'
                                            : 'border-zinc-500 bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                                        }`}
                                        title={`${u.callsign} (${u.role})`}
                                      >
                                        {u.callsign}
                                        {u.reversing ? ' REV' : ''}
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-amber-300">
                                      Awaiting unit
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  disabled={!caseCanBackup}
                                  onClick={() => onRequestBackup(crime.id)}
                                  className={`shrink-0 border px-1.5 py-0 text-[10px] font-medium rounded-none ${
                                    caseCanBackup
                                      ? 'border-blue-400/70 bg-blue-600/35 text-blue-100 hover:bg-blue-600/60 cursor-pointer'
                                      : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                  }`}
                                >
                                  +Backup
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-zinc-300">Driving Profile</div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { mode: DrivingMode.Standard, label: 'Standard' },
                        { mode: DrivingMode.Aggressive, label: 'Aggressive' },
                      ].map((item) => (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => onSetDrivingMode(item.mode)}
                          className={`border py-1 font-medium cursor-pointer rounded-none ${
                            snapshot.drivingMode === item.mode
                              ? item.mode === DrivingMode.Aggressive
                                ? 'border-amber-400 bg-amber-600 text-white'
                                : 'border-zinc-300 bg-zinc-200 text-zinc-900'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-zinc-300">Backup Escalation</div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { mode: BackupMode.Minimal, label: 'Solo' },
                        { mode: BackupMode.Standard, label: 'Standard' },
                        { mode: BackupMode.Perimeter, label: 'Perimeter' },
                        { mode: BackupMode.FullScale, label: 'Code 99' },
                      ].map((item) => (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => onSetBackupMode(item.mode)}
                          className={`border py-1 font-medium cursor-pointer rounded-none ${
                            snapshot.backupMode === item.mode
                              ? item.mode === BackupMode.FullScale
                                ? 'border-red-400 bg-red-600 text-white'
                                : item.mode === BackupMode.Perimeter
                                ? 'border-blue-400 bg-blue-600 text-white'
                                : 'border-zinc-300 bg-zinc-200 text-zinc-900'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ui-subpanel p-2 space-y-2">
                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-300">Auto-Crime Rate</span>
                        <span className="font-mono-tabular text-zinc-100">
                          {Math.round(snapshot.crimeProbability * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(snapshot.crimeProbability * 100)}
                        onChange={(e) => onSetCrimeProbability(Number(e.target.value) / 100)}
                        className="sharp-slider w-full"
                      />
                    </label>

                    <label className="block space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-300">Officer Cowardice</span>
                        <span className="font-mono-tabular text-zinc-100">
                          {Math.round(snapshot.cowardiceLevel * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(snapshot.cowardiceLevel * 100)}
                        onChange={(e) => onSetCowardiceLevel(Number(e.target.value) / 100)}
                        className="sharp-slider w-full"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* WORLD, MULTI-MAP SWITCHER & PACK LIGHTBARS */}
              {activePane === 'world' && (
                <div className="space-y-2 text-xs">
                  {/* Live Map Switcher */}
                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-sky-400" />
                        Active City Map ({snapshot.availableMaps.length})
                      </span>
                      <span className="font-mono-tabular text-[10px] text-sky-300">
                        {snapshot.activeMapId}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {snapshot.availableMaps.map((m) => {
                        const active = m.id === snapshot.activeMapId;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => onSwitchMap(m.id)}
                            className={`w-full text-left border px-2 py-1.5 cursor-pointer rounded-none ${
                              active
                                ? 'border-sky-400 bg-sky-600/80 text-white'
                                : 'border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                            }`}
                          >
                            <div className="flex items-center justify-between font-medium">
                              <span>{m.name}</span>
                              <span className="font-mono-tabular text-[10px] opacity-80">
                                {m.id}
                              </span>
                            </div>
                            {m.description && (
                              <div className="text-[10px] opacity-80 truncate">
                                {m.description}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Data-Driven Lightbars from Pack V3 */}
                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
                      <span className="flex items-center gap-1">
                        <Siren className="h-3.5 w-3.5 text-rose-400" />
                        Pack Lightbar Hardware
                      </span>
                      <span className="font-mono-tabular text-[10px] text-zinc-400">
                        {snapshot.availableLightbars.length} presets
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {snapshot.availableLightbars.map((lb) => (
                        <button
                          key={lb.id}
                          type="button"
                          onClick={() => onSetLightbarById(lb.id)}
                          className={`border px-1.5 py-1 text-[10px] font-medium truncate cursor-pointer rounded-none ${
                            snapshot.activeLightbarId === lb.id
                              ? 'border-zinc-200 bg-zinc-200 text-zinc-900 font-semibold'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                          }`}
                          title={lb.name}
                        >
                          {lb.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="text-[11px] font-medium text-zinc-300">Siren Tone</div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { pattern: SirenPattern.AutoCycle, label: 'Auto' },
                        { pattern: SirenPattern.Wail, label: 'Wail' },
                        { pattern: SirenPattern.Yelp, label: 'Yelp' },
                        { pattern: SirenPattern.Phaser, label: 'Phaser' },
                        { pattern: SirenPattern.HiLo, label: 'Hi-Lo' },
                      ].map((item) => (
                        <button
                          key={item.pattern}
                          type="button"
                          onClick={() => onSetSirenPattern(item.pattern)}
                          className={`border py-1 font-medium cursor-pointer rounded-none ${
                            snapshot.sirenPattern === item.pattern
                              ? 'border-zinc-300 bg-zinc-200 text-zinc-900'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-300">
                      <CloudRain className="h-3.5 w-3.5" />
                      Weather
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { weather: WeatherCondition.Clear, label: 'Clear' },
                        { weather: WeatherCondition.Overcast, label: 'Overcast' },
                        { weather: WeatherCondition.Rain, label: 'Rain' },
                        { weather: WeatherCondition.HeavyFog, label: 'Heavy Fog' },
                      ].map((item) => (
                        <button
                          key={item.weather}
                          type="button"
                          onClick={() => onSetWeather(item.weather)}
                          className={`border py-1 font-medium cursor-pointer rounded-none ${
                            snapshot.weather === item.weather
                              ? 'border-sky-400 bg-sky-600 text-white'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ui-subpanel p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
                      <span className="flex items-center gap-1">
                        <Camera className="h-3.5 w-3.5" />
                        Camera Mode
                      </span>
                      <button
                        type="button"
                        onClick={onResetCamera}
                        className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset (0)
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { mode: CameraMode.Overview, label: 'Tactical (1)' },
                        { mode: CameraMode.FreeFly, label: 'Free Fly (2)' },
                        { mode: CameraMode.FollowUnit, label: 'Follow (3)' },
                        { mode: CameraMode.RearLightbar, label: 'Lightbar (4)' },
                      ].map((item) => (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => onSetCameraMode(item.mode)}
                          className={`border py-1 font-medium cursor-pointer rounded-none ${
                            snapshot.cameraMode === item.mode
                              ? 'border-blue-400 bg-blue-600 text-white'
                              : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TABBED IN-GAME SETTINGS & HUD CONFIGURATOR */}
              {activePane === 'settings' && (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-4 gap-0.5 border border-zinc-600 bg-zinc-900/60 p-0.5">
                    {(
                      [
                        { id: 'sim', label: 'Sim' },
                        { id: 'audio', label: 'Audio' },
                        { id: 'graphics', label: 'Physics' },
                        { id: 'hud', label: 'HUD' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSettingsTab(t.id)}
                        className={`py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer rounded-none ${
                          settingsTab === t.id
                            ? 'bg-zinc-200 text-zinc-900 font-semibold'
                            : 'text-zinc-300 hover:bg-zinc-700/70'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {settingsTab === 'sim' && (
                    <div className="ui-subpanel p-2 space-y-2">
                      <button
                        type="button"
                        onClick={onToggleSimSpeed}
                        className="w-full flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 font-mono-tabular font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                      >
                        <Gauge className="h-3.5 w-3.5" />
                        Simulation Speed: {snapshot.simSpeed}x
                      </button>
                      <label className="block space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-300">Auto-Crime Rate</span>
                          <span className="font-mono-tabular text-zinc-100">
                            {Math.round(snapshot.crimeProbability * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(snapshot.crimeProbability * 100)}
                          onChange={(e) => onSetCrimeProbability(Number(e.target.value) / 100)}
                          className="sharp-slider w-full"
                        />
                      </label>
                      <label className="block space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-300">Officer Cowardice</span>
                          <span className="font-mono-tabular text-zinc-100">
                            {Math.round(snapshot.cowardiceLevel * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(snapshot.cowardiceLevel * 100)}
                          onChange={(e) => onSetCowardiceLevel(Number(e.target.value) / 100)}
                          className="sharp-slider w-full"
                        />
                      </label>
                    </div>
                  )}

                  {settingsTab === 'audio' && (
                    <div className="ui-subpanel p-2 space-y-2">
                      <button
                        type="button"
                        onClick={onToggleAudio}
                        className={`w-full flex items-center justify-center gap-1 border py-1.5 font-medium cursor-pointer rounded-none ${
                          snapshot.audioEnabled
                            ? 'border-amber-400/70 bg-amber-600/30 text-amber-200 hover:bg-amber-600/45'
                            : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                        }`}
                      >
                        {snapshot.audioEnabled ? (
                          <Volume2 className="h-3.5 w-3.5" />
                        ) : (
                          <VolumeX className="h-3.5 w-3.5" />
                        )}
                        {snapshot.audioEnabled ? 'Audio Enabled' : 'Audio Muted'}
                      </button>

                      <label className="block space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-300">Master Volume</span>
                          <span className="font-mono-tabular text-zinc-100">
                            {Math.round(snapshot.audioVolume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(snapshot.audioVolume * 100)}
                          onChange={(e) => onSetAudioVolume(Number(e.target.value) / 100)}
                          className="sharp-slider w-full"
                        />
                      </label>
                    </div>
                  )}

                  {settingsTab === 'graphics' && (
                    <div className="ui-subpanel p-2 space-y-2">
                      <label className="block space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-300">Crash Intensity</span>
                          <span className="font-mono-tabular text-zinc-100">
                            {Math.round(snapshot.crashIntensity * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={150}
                          step={10}
                          value={Math.round(snapshot.crashIntensity * 100)}
                          onChange={(e) => onSetCrashIntensity(Number(e.target.value) / 100)}
                          className="sharp-slider w-full"
                        />
                      </label>

                      <label className="flex items-center justify-between text-[11px] text-zinc-300 cursor-pointer">
                        <span>Debris Road Hitboxes</span>
                        <input
                          type="checkbox"
                          checked={snapshot.debrisObstacles}
                          onChange={(e) => onSetDebrisObstacles(e.target.checked)}
                        />
                      </label>
                    </div>
                  )}

                  {settingsTab === 'hud' && (
                    <div className="ui-subpanel p-2 space-y-2">
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => hudLayoutStore.setEditMode(!hud.editMode)}
                          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
                            hud.editMode
                              ? 'border-sky-400 bg-sky-600 text-white'
                              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
                          }`}
                        >
                          <LayoutGrid className="h-3.5 w-3.5" />
                          {hud.editMode ? 'Lock HUD' : 'Move/Resize HUD'}
                        </button>
                        <button
                          type="button"
                          onClick={() => hudLayoutStore.reset()}
                          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset Layout
                        </button>
                      </div>

                      <div className="space-y-1">
                        {(
                          [
                            { id: 'topBar', label: 'Top Status Bar' },
                            { id: 'cameraBar', label: 'Camera & Quick Bar' },
                          ] as Array<{ id: HudWidgetId; label: string }>
                        ).map((w) => (
                          <label
                            key={w.id}
                            className="flex items-center justify-between border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 cursor-pointer"
                          >
                            <span className="flex items-center gap-1">
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
              )}

              {/* ASSET PACK V3 MANAGER */}
              {activePane === 'assets' && (
                <AssetManagerPane
                  snapshot={snapshot}
                  loadedAssets={loadedAssets}
                  busy={assetBusy}
                  onLoadZipPack={onLoadZipPack}
                  onExportZipPack={onExportZipPack}
                  onReloadDefaultPack={onReloadDefaultPack}
                  onOpenErrorDialog={onOpenErrorDialog}
                />
              )}

              {/* DEV & ASSET STUDIO */}
              {activePane === 'devtools' && (
                <DevToolsPane
                  {...devTools}
                  onExportZipPack={onExportZipPack}
                  onOpenValidator={onOpenValidator}
                  onApplyLightbarToFleet={onSetLightbarById}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </HudEditableFrame>
  );
};
