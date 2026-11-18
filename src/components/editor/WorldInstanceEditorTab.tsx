import React, { useMemo, useState } from 'react';
import {
  Activity,
  Car,
  Crosshair,
  Footprints,
  HeartHandshake,
  Layers,
  Plus,
  Siren,
  Trash2,
  Users,
  Volume2,
  Wrench,
} from 'lucide-react';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { AIDebugFlags, WorldEntityKind } from '../../sim/types';

export interface WorldInstanceEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

const KIND_FILTER_OPTIONS: Array<{ id: 'all' | WorldEntityKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'police', label: 'Police' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'ped', label: 'Peds' },
  { id: 'crime', label: 'Incidents' },
  { id: 'nail_mat', label: 'Spikes' },
];

export const WorldInstanceEditorTab: React.FC<WorldInstanceEditorTabProps> = ({
  controller,
  state,
}) => {
  const [kindFilter, setKindFilter] = useState<'all' | WorldEntityKind>('all');
  const [search, setSearch] = useState('');

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.worldEntities.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (
        q &&
        !e.label.toLowerCase().includes(q) &&
        !e.statusText.toLowerCase().includes(q) &&
        !e.id.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [state.worldEntities, kindFilter, search]);

  const sel = state.selectedWorldEntity;
  const isVehicle = sel?.kind === 'police' || sel?.kind === 'traffic';
  const isPolice = sel?.kind === 'police';
  const canRepairHeal = Boolean(
    sel && (sel.kind === 'police' || sel.kind === 'traffic' || sel.kind === 'crime'),
  );
  const canClearImpatience = Boolean(isVehicle);

  const toggleFlag = (key: keyof AIDebugFlags) => {
    controller?.setAIDebugFlags({ [key]: !state.aiDebugFlags[key] });
  };

  return (
    <div className="space-y-2 text-xs">
      {/* World Tab Switcher */}
      <div className="grid grid-cols-3 gap-0.5 border border-zinc-600 bg-zinc-900/60 p-0.5">
        {(
          [
            { id: 'hierarchy', label: 'Live Scene', icon: <Layers className="h-3 w-3" /> },
            { id: 'spawn', label: 'Spawn', icon: <Plus className="h-3 w-3" /> },
            { id: 'debug', label: 'AI Debug', icon: <Activity className="h-3 w-3" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => controller?.setWorldTab(t.id)}
            className={`flex items-center justify-center gap-1 py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              state.worldTab === t.id
                ? 'bg-zinc-200 text-zinc-900 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-700/70'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* LIVE WORLD SCENE HIERARCHY */}
      {state.worldTab === 'hierarchy' && (
        <div className="space-y-2">
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
              <span>Active World Instances ({state.worldEntities.length})</span>
              <span className="font-mono-tabular text-[10px] text-zinc-400">
                Click in 3D or list
              </span>
            </div>

            <div className="grid grid-cols-6 gap-0.5">
              {KIND_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setKindFilter(opt.id)}
                  className={`border py-0.5 text-[9px] font-medium cursor-pointer rounded-none ${
                    kindFilter === opt.id
                      ? 'border-sky-400 bg-sky-600 text-white'
                      : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter active objects..."
              className="w-full border border-zinc-600 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-500 rounded-none"
            />

            <div className="max-h-48 overflow-y-auto border border-zinc-700 bg-zinc-900 divide-y divide-zinc-800">
              {filteredEntities.length === 0 ? (
                <div className="p-2 text-center text-[11px] text-zinc-400">
                  No active world objects match.
                </div>
              ) : (
                filteredEntities.map((ent) => {
                  const selected = ent.uid === state.selectedWorldEntityUid;
                  return (
                    <button
                      key={ent.uid}
                      type="button"
                      onClick={() => controller?.selectWorldEntity(ent.kind, ent.id)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1 text-left font-mono-tabular text-[10px] cursor-pointer rounded-none ${
                        selected
                          ? 'bg-sky-600/35 text-white'
                          : 'text-zinc-200 hover:bg-zinc-800/80'
                      }`}
                    >
                      <span className="truncate font-semibold">{ent.label}</span>
                      <span className="shrink-0 text-zinc-400">{ent.statusText}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected Instance Inspector */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
              <span>{sel ? `Selected: ${sel.label}` : 'No World Instance Selected'}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={!sel}
                  onClick={() => controller?.focusSelectedWorldEntity()}
                  className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                    sel
                      ? 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <Crosshair className="h-3 w-3" />
                  Focus
                </button>
                <button
                  type="button"
                  disabled={!sel}
                  onClick={() => controller?.deleteSelectedWorldEntity()}
                  className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                    sel
                      ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>

            {sel && (
              <div className="space-y-1.5 text-[10px] font-mono-tabular">
                <div className="grid grid-cols-4 gap-1 text-zinc-300 border border-zinc-700 bg-zinc-900/80 p-1">
                  <span>X {sel.x}</span>
                  <span>Y {sel.y}</span>
                  <span>Z {sel.z}</span>
                  <span>Yaw {sel.yaw}</span>
                </div>
                {sel.extra && (
                  <div className="text-zinc-400 truncate">{sel.extra}</div>
                )}

                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    disabled={!canRepairHeal}
                    onClick={() => controller?.modifySelectedWorldEntity('repair_heal')}
                    className={`flex items-center justify-center gap-1 border py-1 font-sans text-[10px] font-medium rounded-none ${
                      canRepairHeal
                        ? 'border-emerald-500/70 bg-emerald-700/35 text-emerald-100 hover:bg-emerald-600/50 cursor-pointer'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    {sel.kind === 'crime' ? (
                      <HeartHandshake className="h-3 w-3" />
                    ) : (
                      <Wrench className="h-3 w-3" />
                    )}
                    {sel.kind === 'crime' ? 'Heal Suspect' : 'Repair / Heal'}
                  </button>

                  <button
                    type="button"
                    disabled={!canClearImpatience}
                    onClick={() => controller?.modifySelectedWorldEntity('clear_impatience')}
                    className={`flex items-center justify-center gap-1 border py-1 font-sans text-[10px] font-medium rounded-none ${
                      canClearImpatience
                        ? 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    Clear Impatience
                  </button>

                  <button
                    type="button"
                    disabled={!isPolice}
                    onClick={() => controller?.modifySelectedWorldEntity('toggle_lights')}
                    className={`flex items-center justify-center gap-1 border py-1 font-sans text-[10px] font-medium rounded-none ${
                      isPolice
                        ? 'border-sky-500/70 bg-sky-700/35 text-sky-100 hover:bg-sky-600/50 cursor-pointer'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    <Siren className="h-3 w-3" />
                    {sel.lightsActive ? 'Lights Off' : 'Lights On'}
                  </button>

                  <button
                    type="button"
                    disabled={!isPolice}
                    onClick={() => controller?.modifySelectedWorldEntity('toggle_siren')}
                    className={`flex items-center justify-center gap-1 border py-1 font-sans text-[10px] font-medium rounded-none ${
                      isPolice
                        ? 'border-amber-500/70 bg-amber-700/35 text-amber-100 hover:bg-amber-600/50 cursor-pointer'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    <Volume2 className="h-3 w-3" />
                    {sel.sirensActive ? 'Siren Off' : 'Siren On'}
                  </button>

                  <button
                    type="button"
                    disabled={!isPolice}
                    onClick={() => controller?.modifySelectedWorldEntity('toggle_mount')}
                    className={`col-span-2 flex items-center justify-center gap-1 border py-1 font-sans text-[10px] font-medium rounded-none ${
                      isPolice
                        ? 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    <Users className="h-3 w-3" />
                    {sel.mounted ? 'Dismount Crew' : 'Mount Crew'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LIVE WORLD SPAWNER */}
      {state.worldTab === 'spawn' && (
        <div className="ui-subpanel p-2 space-y-2">
          <div className="text-[11px] font-medium text-zinc-300">
            Spawn at Camera Focus Target
          </div>

          <div className="space-y-1">
            <div className="text-[10px] text-zinc-400">Police Reinforcements</div>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  { kind: 'police_sedan', label: 'Police Sedan' },
                  { kind: 'police_suv', label: 'Police SUV' },
                  { kind: 'police_van', label: 'SWAT Van' },
                  { kind: 'police_apc', label: 'Armored APC' },
                ] as const
              ).map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => controller?.spawnWorldEntity(item.kind)}
                  className="flex items-center justify-center gap-1 border border-sky-500/70 bg-sky-700/35 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-600/55 cursor-pointer rounded-none"
                >
                  <Siren className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] text-zinc-400">Civilian & Ambient</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => controller?.spawnWorldEntity('civilian')}
                className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <Car className="h-3.5 w-3.5" />
                Civilian Car
              </button>
              <button
                type="button"
                onClick={() => controller?.spawnWorldEntity('pedestrian')}
                className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <Footprints className="h-3.5 w-3.5" />
                Pedestrian
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] text-zinc-400">Incidents</div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => controller?.spawnWorldEntity('crime')}
                className="flex items-center justify-center gap-1 border border-red-400/70 bg-red-600/80 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 cursor-pointer rounded-none"
              >
                <Crosshair className="h-3.5 w-3.5" />
                Foot Crime
              </button>
              <button
                type="button"
                onClick={() => controller?.spawnWorldEntity('pursuit')}
                className="flex items-center justify-center gap-1 border border-orange-400/70 bg-orange-600/80 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500 cursor-pointer rounded-none"
              >
                <Car className="h-3.5 w-3.5" />
                Vehicle Pursuit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI PATHFINDING & TRAFFIC DEBUGGER */}
      {state.worldTab === 'debug' && (
        <div className="space-y-2">
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
              <span>3D AI & Traffic Overlays</span>
              <button
                type="button"
                onClick={() =>
                  controller?.setAIDebugFlags({
                    showPolicePaths: false,
                    showPursuitPaths: false,
                    showTrafficRoutes: false,
                    showNodesAndPriority: false,
                    showAvoidanceAndStuck: false,
                  })
                }
                className="border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                Clear All
              </button>
            </div>

            <div className="space-y-1 text-[11px]">
              {(
                [
                  {
                    key: 'showPolicePaths',
                    label: 'Police A* Routes (Cyan)',
                  },
                  {
                    key: 'showPursuitPaths',
                    label: 'Suspect Escape / Intercepts (Red)',
                  },
                  {
                    key: 'showTrafficRoutes',
                    label: 'Civilian A* Traffic Paths (Emerald)',
                  },
                  {
                    key: 'showNodesAndPriority',
                    label: 'Road Nodes, Priority & Crosswalks',
                  },
                  {
                    key: 'showAvoidanceAndStuck',
                    label: 'Avoidance, Reversing & Impatience (Amber)',
                  },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between border border-zinc-700 bg-zinc-900 px-2 py-1 cursor-pointer"
                >
                  <span className="text-zinc-200">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={state.aiDebugFlags[item.key]}
                    onChange={() => toggleFlag(item.key)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="ui-subpanel p-2 space-y-1 font-mono-tabular text-[10px]">
            <div className="font-sans text-[11px] font-medium text-zinc-300">
              Live Navigation Diagnostics
            </div>
            <div className="grid grid-cols-2 gap-1 text-zinc-200">
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Police A* Active: {state.aiDebugStats.activePoliceRoutes}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Active Pursuits: {state.aiDebugStats.activePursuits}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Traffic A* Active: {state.aiDebugStats.activeTrafficRoutes}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Avoiding Obstacles: {state.aiDebugStats.avoidingCount}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Impatient (&gt;40%): {state.aiDebugStats.impatientCount}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Reversing Recovery: {state.aiDebugStats.reversingCount}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Graph Nodes: {state.aiDebugStats.roadNodeCount}
              </div>
              <div className="border border-zinc-700 bg-zinc-900 px-2 py-1">
                Graph Edges: {state.aiDebugStats.roadEdgeCount}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
