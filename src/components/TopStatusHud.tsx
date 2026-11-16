import React from 'react';
import { SimSnapshot } from '../sim/types';

interface TopStatusHudProps {
  snapshot: SimSnapshot;
}

export const TopStatusHud: React.FC<TopStatusHudProps> = ({ snapshot }) => {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="pointer-events-auto rounded-xl border border-slate-800 bg-slate-950/92 px-4 py-2.5 shadow-lg">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-base font-semibold tracking-wide text-slate-100">
            Metro Precinct 04
          </h1>
          <span className="text-xs text-slate-400">
            400m Town Grid · Midrise Mixed Zoning
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300 font-mono-tabular">
          <span>Active Calls: {snapshot.activeCrimes.length}</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>Neutralized: {snapshot.neutralizedCount}</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>Traffic: {snapshot.civilianCarCount} cars</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>Peds: {snapshot.pedestrianCount}</span>
          {snapshot.activeNailMats > 0 && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-amber-300">
                Nail Mats: {snapshot.activeNailMats}
              </span>
            </>
          )}
          {snapshot.assetsLoaded && (
            <>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-400">
                Assets: {snapshot.assetCounts.textures} tex, {snapshot.assetCounts.models} models, {snapshot.assetCounts.audio} audio
              </span>
            </>
          )}
        </div>
      </div>

      {snapshot.activeCrimes.length > 0 && (
        <div className="pointer-events-auto rounded-xl border border-red-900/70 bg-slate-950/92 px-4 py-2.5 shadow-lg max-w-lg">
          <div className="text-xs font-medium text-red-400">
            Active Incident Dispatch
          </div>
          <div className="mt-1 space-y-1">
            {snapshot.activeCrimes.slice(0, 3).map((crime) => (
              <div
                key={crime.id}
                className="flex items-center justify-between gap-4 text-xs text-slate-200 font-mono-tabular"
              >
                <span className="truncate">
                  {crime.type} ({crime.suspectWeaponKind}) · {crime.district}
                </span>
                <span className="shrink-0 text-slate-400">
                  {!crime.suspectAlive
                    ? 'Neutralized'
                    : crime.inVehiclePursuit
                    ? `Car ${crime.vehicleHp}%`
                    : `HP ${crime.suspectHp}%`}
                  {crime.assignedUnitCallsign ? ` · ${crime.assignedUnitCallsign}` : ''}
                  {crime.backupCount > 0 ? ` · +${crime.backupCount} Unit` : ''}
                  {crime.heavyDeployed ? ' · +SWAT' : ''}
                  {crime.apcDeployed ? ' · +APC' : ''}
                  {crime.nailMatDeployed ? ' · +Nail Mat' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
