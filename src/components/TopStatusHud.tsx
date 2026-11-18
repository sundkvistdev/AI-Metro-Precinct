import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, Info, LogOut } from 'lucide-react';
import { SimSnapshot } from '../sim/types';

export interface TopStatusHudProps {
  snapshot: SimSnapshot;
  onOpenErrorDialog: () => void;
  onReturnToMenu: () => void;
}

export const TopStatusHud: React.FC<TopStatusHudProps> = ({
  snapshot,
  onOpenErrorDialog,
  onReturnToMenu,
}) => {
  const [infoOpen, setInfoOpen] = useState(false);
  const issueCount = snapshot.assetIssues.length;
  const activeCallCount = snapshot.activeCrimes.length;

  return (
    <div className="relative flex items-start justify-between gap-2">
      {/* Slim Top-Left Title + Info Trigger */}
      <div className="pointer-events-auto relative">
        <div className="ui-panel flex items-center gap-2 px-2.5 py-1 shadow-md text-xs">
          <span className="font-display text-sm font-semibold tracking-wide text-zinc-100 uppercase whitespace-nowrap">
            Metro Precinct
          </span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="text-zinc-300 whitespace-nowrap">{snapshot.mapName}</span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span
            className={`font-mono-tabular whitespace-nowrap ${
              activeCallCount > 0 ? 'text-red-300 font-semibold' : 'text-zinc-300'
            }`}
          >
            Calls {activeCallCount}
          </span>
          <button
            type="button"
            onClick={() => setInfoOpen((prev) => !prev)}
            aria-expanded={infoOpen}
            className={`ml-1 flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
              infoOpen
                ? 'border-sky-400 bg-sky-600 text-white'
                : 'border-zinc-500 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
            }`}
            title="Show simulation & dispatch telemetry"
          >
            <Info className="h-3 w-3" />
            Info
            <ChevronDown
              className={`h-3 w-3 transition-transform ${infoOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Collapsible Simulation Info & Dispatch Popover */}
        {infoOpen && (
          <div className="mt-1 ui-panel p-2.5 shadow-xl w-[min(420px,90vw)] space-y-2 text-xs">
            <div className="grid grid-cols-3 gap-1.5 font-mono-tabular text-[11px]">
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Neutralized</div>
                <div className="text-zinc-100 font-semibold">{snapshot.neutralizedCount}</div>
              </div>
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Casualties</div>
                <div
                  className={`font-semibold ${
                    snapshot.casualtyCount > 0 ? 'text-red-300' : 'text-zinc-100'
                  }`}
                >
                  {snapshot.casualtyCount}
                </div>
              </div>
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Spikes</div>
                <div
                  className={`font-semibold ${
                    snapshot.activeNailMats > 0 ? 'text-amber-300' : 'text-zinc-100'
                  }`}
                >
                  {snapshot.activeNailMats}
                </div>
              </div>
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Traffic</div>
                <div className="text-zinc-100 font-semibold">{snapshot.civilianCarCount}</div>
              </div>
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Pedestrians</div>
                <div className="text-zinc-100 font-semibold">{snapshot.pedestrianCount}</div>
              </div>
              <div className="ui-subpanel px-2 py-1">
                <div className="text-[10px] text-zinc-400">Debris</div>
                <div className="text-zinc-100 font-semibold">{snapshot.debrisCount}</div>
              </div>
            </div>

            <div className="ui-subpanel px-2 py-1.5 font-mono-tabular text-[10px] text-zinc-300 space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Asset Pack</span>
                <span className="text-zinc-100 truncate">{snapshot.assetPackName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Source</span>
                <span className="text-zinc-200 truncate">{snapshot.assetSourceLabel}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Active Dispatch Queue ({activeCallCount})
              </div>
              {activeCallCount === 0 ? (
                <div className="ui-subpanel px-2 py-1.5 text-[11px] text-zinc-400">
                  No active incidents.
                </div>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {snapshot.activeCrimes.map((crime) => {
                    const urgClass =
                      crime.urgencyLevel === 'critical'
                        ? 'border-red-400/80 bg-red-600/85 text-white'
                        : crime.urgencyLevel === 'high'
                        ? 'border-orange-400/80 bg-orange-600/80 text-white'
                        : crime.urgencyLevel === 'medium'
                        ? 'border-amber-400/70 bg-amber-600/50 text-amber-100'
                        : 'border-zinc-500 bg-zinc-700 text-zinc-200';
                    const statusLabel =
                      crime.incidentStatus === 'on_scene'
                        ? 'ON SCENE'
                        : crime.incidentStatus.toUpperCase();
                    return (
                      <div
                        key={crime.id}
                        className="ui-subpanel flex items-center justify-between gap-2 px-2 py-1 text-[10px] text-zinc-100 font-mono-tabular"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span
                            className={`px-1 border text-[9px] font-semibold uppercase ${urgClass}`}
                          >
                            U{crime.urgency}
                          </span>
                          <span className="text-zinc-300 font-semibold">
                            #{crime.caseNumber}
                          </span>
                          <span className="truncate">
                            {crime.type} · {crime.district}
                          </span>
                        </span>
                        <span className="shrink-0 text-zinc-300">
                          {statusLabel} ·{' '}
                          {!crime.suspectAlive
                            ? 'Down'
                            : crime.inVehiclePursuit
                            ? `Car ${crime.vehicleHp}%`
                            : `HP ${crime.suspectHp}%`}
                          {crime.assignedUnits.length > 0
                            ? ` · ${crime.assignedUnits.map((u) => u.callsign).join(', ')}`
                            : crime.assignedUnitCallsign
                            ? ` · ${crime.assignedUnitCallsign}`
                            : ' · Unassigned'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Slim Top-Right Actions */}
      <div className="flex items-start gap-1.5">
        {issueCount > 0 && (
          <button
            type="button"
            onClick={onOpenErrorDialog}
            className="pointer-events-auto flex items-center gap-1 border border-amber-400/70 bg-zinc-700/95 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
            title="Inspect asset load issues"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {issueCount}
          </button>
        )}

        <button
          type="button"
          onClick={onReturnToMenu}
          className="pointer-events-auto flex items-center gap-1 border border-zinc-500 bg-zinc-700/95 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
          title="Return to Main Menu"
        >
          <LogOut className="h-3.5 w-3.5" />
          Menu
        </button>
      </div>
    </div>
  );
};
