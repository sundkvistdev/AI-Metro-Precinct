import React from 'react';
import {
  Camera,
  Car,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Crosshair,
  Gauge,
  Palette,
  Radio,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  Siren,
  TriangleAlert,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BackupMode,
  CameraMode,
  DrivingMode,
  LightbarMode,
  SimSnapshot,
  SirenPattern,
  UnitStatus,
  WeatherCondition,
} from '../sim/types';
import { VEHICLE_BASE_COLOR_PALETTE } from '../sim/vehicleModels';

export interface ControlDockProps {
  snapshot: SimSnapshot;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectUnit: (id: string) => void;
  onSetUnitBaseColor: (unitId: string, colorHex: number) => void;
  onSetLightbarMode: (mode: LightbarMode) => void;
  onSetSirenPattern: (pattern: SirenPattern) => void;
  onSetDrivingMode: (mode: DrivingMode) => void;
  onSetBackupMode: (mode: BackupMode) => void;
  onRequestBackup: () => void;
  onDeployNailMat: () => void;
  onSetWeather: (weather: WeatherCondition) => void;
  onSetCameraMode: (mode: CameraMode) => void;
  onResetCamera: () => void;
  onSetCrimeProbability: (prob: number) => void;
  onSetCowardiceLevel: (level: number) => void;
  onTriggerCrime: () => void;
  onTriggerPursuit: () => void;
  onToggleMount: () => void;
  onToggleAudio: () => void;
  onToggleSimSpeed: () => void;
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

export const ControlDock: React.FC<ControlDockProps> = ({
  snapshot,
  collapsed,
  onToggleCollapse,
  onSelectUnit,
  onSetUnitBaseColor,
  onSetLightbarMode,
  onSetSirenPattern,
  onSetDrivingMode,
  onSetBackupMode,
  onRequestBackup,
  onDeployNailMat,
  onSetWeather,
  onSetCameraMode,
  onResetCamera,
  onSetCrimeProbability,
  onSetCowardiceLevel,
  onTriggerCrime,
  onTriggerPursuit,
  onToggleMount,
  onToggleAudio,
  onToggleSimSpeed,
}) => {
  const selectedUnit =
    snapshot.units.find((u) => u.id === snapshot.selectedUnitId) ?? snapshot.units[0];
  const canToggleMount =
    selectedUnit &&
    (selectedUnit.mounted ||
      (!selectedUnit.immobilized &&
        (selectedUnit.status === UnitStatus.Engaging ||
          selectedUnit.status === UnitStatus.Dismounting)));
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

  return (
    <div className="flex flex-col items-center">
      <div
        className={`pointer-events-auto flex flex-col items-center transition-transform duration-200 ease-out ${
          collapsed ? 'translate-y-[calc(100%-36px)]' : 'translate-y-0'
        }`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-800 bg-slate-950/94 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {collapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show Controls
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Hide Controls
            </>
          )}
        </button>

        <div className="w-[min(1240px,96vw)] rounded-xl border border-slate-800 bg-slate-950/94 p-3.5 shadow-2xl">
          {/* Row 1: Patrol Units + Direct Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 pb-2.5">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900 p-1">
              {snapshot.units.map((unit) => {
                const selected = unit.id === snapshot.selectedUnitId;
                const statusText =
                  unit.downedOfficers > 0
                    ? `${unit.downedOfficers} KIA`
                    : unit.immobilized && unit.mounted
                    ? 'Disabled'
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
                    title={`${unit.callsign} (${unit.vehicleKind.toUpperCase()} · ${unit.liveryLabel} · ${unit.weaponKind.toUpperCase()})`}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selected
                        ? 'bg-blue-600 text-white'
                        : unit.isHeavyUnit
                        ? 'border border-amber-500/30 text-amber-200 hover:bg-slate-800 hover:text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span>{unit.callsign}</span>
                    {unit.weaponKind === 'rifle' && (
                      <span
                        className={`text-[10px] uppercase tracking-wider ${
                          selected ? 'text-blue-200' : unit.isHeavyUnit ? 'text-amber-300' : 'text-sky-400'
                        }`}
                      >
                        {unit.isHeavyUnit ? 'HEAVY' : 'AR'}
                      </span>
                    )}
                    <span
                      className={`font-mono-tabular text-[11px] ${
                        unit.downedOfficers > 0 || unit.immobilized
                          ? 'text-red-400'
                          : unit.fleeingOfficers > 0 ||
                            unit.status === UnitStatus.Retreating ||
                            unit.status === UnitStatus.DeployingSpikes
                          ? 'text-amber-300'
                          : selected
                          ? 'text-blue-100'
                          : 'text-slate-400'
                      }`}
                    >
                      {statusText}
                      {unit.speedKmh > 0 ? ` ${unit.speedKmh}km/h` : ''}
                      {!unit.mounted && unit.downedOfficers === 0 ? ` M${unit.morale}%` : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onTriggerCrime}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Crosshair className="h-3.5 w-3.5" />
                Trigger Crime
              </button>

              <button
                type="button"
                onClick={onTriggerPursuit}
                className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Car className="h-3.5 w-3.5" />
                Trigger Pursuit
              </button>

              <button
                type="button"
                onClick={onRequestBackup}
                disabled={!canRequestBackup}
                title="Dispatch nearest standby unit or heavy SWAT to active incident"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  canRequestBackup
                    ? 'border-blue-500/60 bg-blue-600/20 text-blue-200 hover:bg-blue-600/35 cursor-pointer'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500 cursor-not-allowed'
                }`}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Call Backup
              </button>

              <button
                type="button"
                onClick={onDeployNailMat}
                disabled={!canDeployNailMat}
                title="Task a patrol unit to intercept ahead of pursuit and lay nail mat across road"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  canDeployNailMat
                    ? 'border-amber-500/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/35 cursor-pointer'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500 cursor-not-allowed'
                }`}
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                Nail Mat
              </button>

              <button
                type="button"
                onClick={onToggleMount}
                disabled={!canToggleMount}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  canToggleMount
                    ? 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 cursor-pointer'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                {selectedUnit?.mounted ? 'Dismount Crew' : 'Mount Crew'}
              </button>

              <button
                type="button"
                onClick={onToggleAudio}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  snapshot.audioEnabled
                    ? 'border-amber-600/70 bg-amber-500/15 text-amber-300'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
                title="Toggle 3D siren, gunfire, crash, and rain audio"
              >
                {snapshot.audioEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
                Audio
              </button>

              <button
                type="button"
                onClick={onToggleSimSpeed}
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono-tabular font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Gauge className="h-3.5 w-3.5" />
                {snapshot.simSpeed}x
              </button>
            </div>
          </div>

          {/* Row 2: Lightbar, Siren Pattern, Driving, Weather */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                <Siren className="h-3.5 w-3.5 text-slate-400" />
                Lightbar
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
                {[
                  { mode: LightbarMode.LED, label: 'LED' },
                  { mode: LightbarMode.FlashingHalogen, label: 'Flashing' },
                  { mode: LightbarMode.RotatingHalogen, label: 'Rotating' },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => onSetLightbarMode(item.mode)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.lightbarMode === item.mode
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                <Radio className="h-3.5 w-3.5 text-slate-400" />
                Siren
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
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
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.sirenPattern === item.pattern
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                Driving
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
                {[
                  { mode: DrivingMode.Standard, label: 'Standard' },
                  { mode: DrivingMode.Aggressive, label: 'Aggressive' },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => onSetDrivingMode(item.mode)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.drivingMode === item.mode
                        ? item.mode === DrivingMode.Aggressive
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
                Backup
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
                {[
                  {
                    mode: BackupMode.Minimal,
                    label: 'Solo',
                    hint: 'Solo patrol response; backup only on officer KIA or disabled vehicle',
                  },
                  {
                    mode: BackupMode.Standard,
                    label: 'Standard',
                    hint: 'Measured escalation: 1 backup on duress/long fight, SWAT if critical',
                  },
                  {
                    mode: BackupMode.Perimeter,
                    label: 'Perimeter',
                    hint: '2-unit containment + interceptors laying nail mats ahead of pursuits',
                  },
                  {
                    mode: BackupMode.FullScale,
                    label: 'Code 99',
                    hint: 'Full surge: 3 patrol units, staggered nail mats, SWAT Van & APC 401',
                  },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    title={item.hint}
                    onClick={() => onSetBackupMode(item.mode)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.backupMode === item.mode
                        ? item.mode === BackupMode.FullScale
                          ? 'bg-red-600 text-white'
                          : item.mode === BackupMode.Perimeter
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                <CloudRain className="h-3.5 w-3.5 text-slate-400" />
                Weather
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
                {[
                  { weather: WeatherCondition.Clear, label: 'Clear' },
                  { weather: WeatherCondition.Overcast, label: 'Overcast' },
                  { weather: WeatherCondition.Rain, label: 'Rain' },
                  { weather: WeatherCondition.HeavyFog, label: 'Fog' },
                ].map((item) => (
                  <button
                    key={item.weather}
                    type="button"
                    onClick={() => onSetWeather(item.weather)}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.weather === item.weather
                        ? 'bg-sky-700 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedUnit && (
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                  <Palette className="h-3.5 w-3.5 text-slate-400" />
                  Paint
                </span>
                <div className="flex items-center gap-1 rounded-lg bg-slate-900 px-1.5 py-1">
                  {VEHICLE_BASE_COLOR_PALETTE.map((swatch) => {
                    const active = selectedUnit.baseColorHex === swatch.hex;
                    const cssHex = `#${swatch.hex.toString(16).padStart(6, '0')}`;
                    return (
                      <button
                        key={swatch.id}
                        type="button"
                        onClick={() => onSetUnitBaseColor(selectedUnit.id, swatch.hex)}
                        title={`${selectedUnit.callsign} Base Paint: ${swatch.label}`}
                        aria-label={`Set ${selectedUnit.callsign} base color to ${swatch.label}`}
                        style={{ backgroundColor: cssHex }}
                        className={`h-4.5 w-4.5 rounded border transition-transform shrink-0 cursor-pointer ${
                          active
                            ? 'scale-110 border-white ring-1 ring-blue-400'
                            : 'border-slate-600 hover:scale-105 hover:border-slate-300'
                        }`}
                      />
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      const others = VEHICLE_BASE_COLOR_PALETTE.filter(
                        (s) => s.hex !== selectedUnit.baseColorHex,
                      );
                      const pick =
                        others[Math.floor(Math.random() * others.length)] ??
                        VEHICLE_BASE_COLOR_PALETTE[0];
                      onSetUnitBaseColor(selectedUnit.id, pick.hex);
                    }}
                    title={`Randomize ${selectedUnit.callsign} base color`}
                    className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors shrink-0 cursor-pointer"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Camera Mode, Sliders & Key Guide */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                <Camera className="h-3.5 w-3.5 text-slate-400" />
                View
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
                {[
                  { mode: CameraMode.Overview, label: 'Tactical' },
                  { mode: CameraMode.FreeFly, label: 'Free Fly' },
                  { mode: CameraMode.FollowUnit, label: 'Follow' },
                  { mode: CameraMode.RearLightbar, label: 'Lightbar' },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => onSetCameraMode(item.mode)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.cameraMode === item.mode
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onResetCamera}
                className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                title="Reset camera view (0)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300 whitespace-nowrap shrink-0">
                <span className="font-medium text-slate-400">Crime Prob</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(snapshot.crimeProbability * 100)}
                  onChange={(e) => onSetCrimeProbability(Number(e.target.value) / 100)}
                  className="h-1.5 w-18 accent-red-500 cursor-pointer"
                />
                <span className="w-8 text-right font-mono-tabular text-slate-200">
                  {Math.round(snapshot.crimeProbability * 100)}%
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 whitespace-nowrap shrink-0">
                <span className="font-medium text-slate-400">Cowardice</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(snapshot.cowardiceLevel * 100)}
                  onChange={(e) => onSetCowardiceLevel(Number(e.target.value) / 100)}
                  className="h-1.5 w-18 accent-amber-500 cursor-pointer"
                />
                <span className="w-8 text-right font-mono-tabular text-slate-200">
                  {Math.round(snapshot.cowardiceLevel * 100)}%
                </span>
              </label>
            </div>

            <span className="text-[11px] text-slate-400 font-mono-tabular">
              WASD/Arrows Move · Q/E Rotate · R/F Alt · Z/X Zoom · 0 Reset
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
