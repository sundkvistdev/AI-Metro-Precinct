import React from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
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
  const issueCount = snapshot.assetIssues.length;

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="pointer-events-auto ui-panel px-2.5 py-1.5 shadow-md">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
          <span className="font-display text-sm font-semibold tracking-wide text-zinc-100 uppercase">
            Metro Precinct
          </span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="text-zinc-300">{snapshot.mapName}</span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="font-mono-tabular text-zinc-200">
            Calls {snapshot.activeCrimes.length}
          </span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="font-mono-tabular text-zinc-200">
            Neutralized {snapshot.neutralizedCount}
          </span>
          {snapshot.casualtyCount > 0 && (
            <>
              <span aria-hidden="true" className="text-zinc-500">·</span>
              <span className="font-mono-tabular text-red-300">
                Casualties {snapshot.casualtyCount}
              </span>
            </>
          )}
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="font-mono-tabular text-zinc-300">
            Traffic {snapshot.civilianCarCount}
          </span>
          <span aria-hidden="true" className="text-zinc-500">·</span>
          <span className="font-mono-tabular text-zinc-300">
            Peds {snapshot.pedestrianCount}
          </span>
          {snapshot.debrisCount > 0 && (
            <>
              <span aria-hidden="true" className="text-zinc-500">·</span>
              <span className="font-mono-tabular text-zinc-300">
                Debris {snapshot.debrisCount}
              </span>
            </>
          )}
          {snapshot.activeNailMats > 0 && (
            <>
              <span aria-hidden="true" className="text-zinc-500">·</span>
              <span className="font-mono-tabular text-amber-300">
                Spikes {snapshot.activeNailMats}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-1.5">
        {snapshot.activeCrimes.length > 0 && (
          <div className="pointer-events-auto ui-panel border-red-400/50 px-2.5 py-1.5 shadow-md max-w-lg">
            <div className="space-y-1">
              {snapshot.activeCrimes.slice(0, 3).map((crime) => {
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
                    className="flex items-center justify-between gap-2.5 text-[11px] text-zinc-100 font-mono-tabular"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span className={`px-1 py-0 border text-[10px] font-semibold uppercase ${urgClass}`}>
                        U{crime.urgency}
                      </span>
                      <span className="text-zinc-300 font-semibold">#{crime.caseNumber}</span>
                      <span className="truncate">
                        {crime.type} ({crime.suspectWeaponKind}) · {crime.district}
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
                      {crime.nailMatDeployed ? ' · Spikes' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {issueCount > 0 && (
          <button
            type="button"
            onClick={onOpenErrorDialog}
            className="pointer-events-auto flex items-center gap-1 border border-amber-400/70 bg-zinc-700/95 px-2 py-1.5 text-xs font-medium text-amber-200 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
            title="Inspect asset load issues"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {issueCount}
          </button>
        )}

        <button
          type="button"
          onClick={onReturnToMenu}
          className="pointer-events-auto flex items-center gap-1 border border-zinc-500 bg-zinc-700/95 px-2.5 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
          title="Return to Main Menu"
        >
          <LogOut className="h-3.5 w-3.5" />
          Menu
        </button>
      </div>
    </div>
  );
};
