import React, { useMemo, useState } from 'react';
import {
  Box,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Image,
  Layers,
  Move,
  Palette,
  RotateCw,
  Save,
  Scaling,
  ShieldCheck,
  Siren,
  Volume2,
} from 'lucide-react';
import {
  DevEditorController,
  DevEditorState,
} from '../sim/devEditorController';
import { DevAssetTab, WorldEntityKind } from '../sim/types';
import { AssetHierarchyPanel } from './editor/AssetHierarchyPanel';
import { AudioEditorTab } from './editor/AudioEditorTab';
import { LightbarEditorTab } from './editor/LightbarEditorTab';
import { MapWorldEditorTab } from './editor/MapWorldEditorTab';
import { MaterialsEditorTab } from './editor/MaterialsEditorTab';
import { ModelEditorTab } from './editor/ModelEditorTab';
import { TemplatesTab } from './editor/TemplatesTab';
import { TextureEditorTab } from './editor/TextureEditorTab';
import { WorldInstanceEditorTab } from './editor/WorldInstanceEditorTab';

export interface DevToolsPaneProps {
  controller: DevEditorController | null;
  state: DevEditorState | null;
  onExportZipPack?: () => void;
  onOpenValidator?: () => void;
  onApplyLightbarToFleet?: (lightbarId: string) => void;
}

const ASSET_TABS: Array<{ id: DevAssetTab; label: string; icon: React.ReactNode }> = [
  { id: 'map', label: 'Map', icon: <Building2 className="h-3 w-3" /> },
  { id: 'model', label: 'Model', icon: <Box className="h-3 w-3" /> },
  { id: 'lightbars', label: 'Lights', icon: <Siren className="h-3 w-3" /> },
  { id: 'materials', label: 'Mat', icon: <Palette className="h-3 w-3" /> },
  { id: 'texture', label: 'Tex', icon: <Image className="h-3 w-3" /> },
  { id: 'audio', label: 'Audio', icon: <Volume2 className="h-3 w-3" /> },
  { id: 'prefabs', label: 'Pack', icon: <Car className="h-3 w-3" /> },
];

const WORLD_GROUPS: Array<{ kind: WorldEntityKind; label: string }> = [
  { kind: 'police', label: 'Police Units' },
  { kind: 'officer', label: 'Police Officers' },
  { kind: 'assailant', label: 'Assailants' },
  { kind: 'crime', label: 'Incidents' },
  { kind: 'traffic', label: 'Traffic Cars' },
  { kind: 'ped', label: 'Pedestrians' },
  { kind: 'nail_mat', label: 'Spike Strips' },
];

export const DevToolsPane: React.FC<DevToolsPaneProps> = ({
  controller,
  state,
  onExportZipPack,
  onOpenValidator,
  onApplyLightbarToFleet,
}) => {
  const [worldSearch, setWorldSearch] = useState('');
  const [openWorldGroups, setOpenWorldGroups] = useState<
    Record<WorldEntityKind, boolean>
  >({
    police: true,
    officer: true,
    assailant: true,
    crime: true,
    traffic: false,
    ped: false,
    nail_mat: true,
  });

  const groupedWorldEntities = useMemo(() => {
    const map: Record<WorldEntityKind, NonNullable<DevEditorState['worldEntities']>> = {
      police: [],
      officer: [],
      assailant: [],
      crime: [],
      traffic: [],
      ped: [],
      nail_mat: [],
    };
    if (!state) return map;
    const q = worldSearch.trim().toLowerCase();
    for (const ent of state.worldEntities) {
      if (
        q &&
        !ent.label.toLowerCase().includes(q) &&
        !ent.statusText.toLowerCase().includes(q) &&
        !ent.id.toLowerCase().includes(q)
      ) {
        continue;
      }
      map[ent.kind].push(ent);
    }
    return map;
  }, [state, worldSearch]);

  if (!state) {
    return (
      <div className="p-2 text-xs text-zinc-400">
        Load a valid JSON asset pack to enable World Instance & Asset Editors.
      </div>
    );
  }

  const anyDirty =
    state.dirtyMap ||
    state.dirtyModel ||
    state.dirtyMaterials ||
    state.dirtyTextures ||
    state.dirtyAudio ||
    state.dirtyLightbars;

  const showAssetGizmo =
    state.devMode === 'asset' &&
    (state.assetTab === 'map' || state.assetTab === 'model');
  const showWorldGizmo =
    state.devMode === 'world' && Boolean(state.selectedWorldEntityUid);

  const issueCount = state.validationIssues?.length ?? 0;
  const fatalOrErrCount = (state.validationIssues ?? []).filter(
    (i) => i.severity === 'fatal' || i.severity === 'error',
  ).length;

  return (
    <div className="space-y-2 text-xs">
      {/* Top 2-Mode Switcher + Pack Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border border-zinc-600 bg-zinc-900/70 p-1">
        <div className="grid grid-cols-2 gap-1 w-64 shrink-0">
          <button
            type="button"
            onClick={() => controller?.setMode('world')}
            className={`flex items-center justify-center gap-1.5 py-1 text-[10px] font-semibold tracking-wider uppercase cursor-pointer whitespace-nowrap rounded-none transition-colors ${
              state.devMode === 'world'
                ? 'bg-sky-600 text-white border border-sky-400'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" />
            World Instance
          </button>
          <button
            type="button"
            onClick={() => controller?.setMode('asset')}
            className={`flex items-center justify-center gap-1.5 py-1 text-[10px] font-semibold tracking-wider uppercase cursor-pointer whitespace-nowrap rounded-none transition-colors ${
              state.devMode === 'asset'
                ? 'bg-zinc-100 text-zinc-900 border border-zinc-300'
                : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Asset Editor
          </button>
        </div>

        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[10px] font-mono-tabular truncate max-w-[150px]">
            {anyDirty ? (
              <span className="text-amber-300 font-medium">Unsaved V3</span>
            ) : state.lastSavedStatus ? (
              <span className="text-emerald-300">{state.lastSavedStatus}</span>
            ) : (
              <span className="text-zinc-400">Pack v1.5.0</span>
            )}
          </div>

          {onOpenValidator && (
            <button
              type="button"
              onClick={onOpenValidator}
              title="Open Live Pack Validator"
              className={`flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-mono-tabular cursor-pointer whitespace-nowrap rounded-none ${
                fatalOrErrCount > 0
                  ? 'border-rose-400/80 bg-rose-900/60 text-rose-100 hover:bg-rose-800'
                  : issueCount > 0
                  ? 'border-amber-400/80 bg-amber-800/50 text-amber-100 hover:bg-amber-700'
                  : 'border-emerald-500/60 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/60'
              }`}
            >
              <ShieldCheck className="h-3 w-3" />
              {issueCount === 0 ? 'Valid' : `${issueCount} Issue`}
            </button>
          )}

          <button
            type="button"
            onClick={() => controller?.saveCurrentAssetToPack('all')}
            title="Save all modified assets into active pack (v1.5.0)"
            className={`flex items-center gap-1 border px-2 py-0.5 text-[10px] font-medium cursor-pointer whitespace-nowrap rounded-none ${
              anyDirty
                ? 'border-emerald-400/80 bg-emerald-600/85 text-white hover:bg-emerald-500'
                : 'border-zinc-500 bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
            }`}
          >
            <Save className="h-3 w-3" />
            Save All
          </button>

          {onExportZipPack && (
            <button
              type="button"
              onClick={onExportZipPack}
              title="Export Asset Pack V3 (1.5.0) ZIP"
              className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap rounded-none"
            >
              <Download className="h-3 w-3" />
              ZIP
            </button>
          )}
        </div>
      </div>

      {/* Persistent 2-Column Workspace: Left = Full Hierarchy, Right = Relevant Controls */}
      <div className="grid grid-cols-[220px_1fr] gap-2 items-start">
        {/* LEFT COLUMN: FULL SCENE / PACK HIERARCHY */}
        <div className="border border-zinc-600 bg-zinc-900/60 p-1.5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-300 border-b border-zinc-700 pb-1">
            <span>
              {state.devMode === 'world' ? 'World Hierarchy' : 'Pack V3 Hierarchy'}
            </span>
            <span className="font-mono-tabular text-zinc-400">
              {state.devMode === 'world'
                ? state.worldEntities.length
                : `${state.mapIds.length}M/${state.modelIds.length}O`}
            </span>
          </div>

          {state.devMode === 'world' ? (
            <div className="space-y-1.5">
              <input
                type="text"
                value={worldSearch}
                onChange={(e) => setWorldSearch(e.target.value)}
                placeholder="Filter live objects..."
                className="w-full border border-zinc-600 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-500 rounded-none"
              />
              <div className="max-h-[480px] overflow-y-auto border border-zinc-700 bg-zinc-900">
                {WORLD_GROUPS.map((grp) => {
                  const list = groupedWorldEntities[grp.kind];
                  const isOpen = openWorldGroups[grp.kind];
                  return (
                    <div key={grp.kind}>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenWorldGroups((prev) => ({
                            ...prev,
                            [grp.kind]: !prev[grp.kind],
                          }))
                        }
                        className="w-full flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
                      >
                        <span className="flex items-center gap-1">
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3 text-zinc-400" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-zinc-400" />
                          )}
                          {grp.label}
                        </span>
                        <span className="font-mono-tabular text-zinc-400">{list.length}</span>
                      </button>

                      {isOpen &&
                        (list.length === 0 ? (
                          <div className="px-3 py-1 text-[10px] text-zinc-500 border-b border-zinc-800">
                            None active
                          </div>
                        ) : (
                          list.map((ent) => {
                            const selected = ent.uid === state.selectedWorldEntityUid;
                            return (
                              <div
                                key={ent.uid}
                                className={`flex items-center justify-between gap-1 px-2 py-1 border-b border-zinc-800 font-mono-tabular text-[10px] ${
                                  selected
                                    ? 'bg-sky-600/40 text-white'
                                    : 'text-zinc-200 hover:bg-zinc-800/80'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    controller?.selectWorldEntity(ent.kind, ent.id)
                                  }
                                  className="flex-1 min-w-0 text-left cursor-pointer"
                                >
                                  <div className="truncate font-semibold">{ent.label}</div>
                                  <div className="truncate text-[9px] text-zinc-400">
                                    {ent.statusText}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    controller?.selectWorldEntity(ent.kind, ent.id);
                                    controller?.focusSelectedWorldEntity();
                                  }}
                                  title="Focus camera"
                                  className="p-0.5 text-zinc-400 hover:text-white cursor-pointer shrink-0"
                                >
                                  <Crosshair className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <AssetHierarchyPanel controller={controller} state={state} />
          )}
        </div>

        {/* RIGHT COLUMN: RELEVANT EDITOR & DEBUG CONTROLS */}
        <div className="min-w-0 space-y-2">
          {/* Asset Editor Tabs Strip */}
          {state.devMode === 'asset' && (
            <div className="grid grid-cols-7 gap-0.5 border border-zinc-600 bg-zinc-900/50 p-0.5">
              {ASSET_TABS.map((t) => {
                const active = state.assetTab === t.id;
                const dirtyDot =
                  (t.id === 'map' && state.dirtyMap) ||
                  (t.id === 'model' && state.dirtyModel) ||
                  (t.id === 'lightbars' && state.dirtyLightbars) ||
                  (t.id === 'materials' && state.dirtyMaterials) ||
                  (t.id === 'texture' && state.dirtyTextures) ||
                  (t.id === 'audio' && state.dirtyAudio);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => controller?.setAssetTab(t.id)}
                    className={`relative flex flex-col items-center justify-center gap-0.5 py-1 text-[9px] font-medium cursor-pointer rounded-none ${
                      active
                        ? 'bg-zinc-200 text-zinc-900 font-semibold'
                        : 'text-zinc-300 hover:bg-zinc-700/70'
                    }`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                    {dirtyDot && (
                      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Shared 3D Gizmo Bar */}
          {(showAssetGizmo || showWorldGizmo) && (
            <div className="ui-subpanel p-1.5 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span>
                  {state.devMode === 'world'
                    ? 'Live Instance Gizmo'
                    : '3D Transform Gizmo'}
                </span>
                {state.devMode === 'asset' && state.assetTab === 'map' && (
                  <button
                    type="button"
                    onClick={() =>
                      controller?.setShowRoadOverlay(!state.showRoadOverlay)
                    }
                    className="flex items-center gap-1 border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
                  >
                    {state.showRoadOverlay ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3" />
                    )}
                    Graph Overlay
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { mode: 'translate', label: 'Move', icon: <Move className="h-3 w-3" /> },
                    { mode: 'rotate', label: 'Rotate', icon: <RotateCw className="h-3 w-3" /> },
                    { mode: 'scale', label: 'Scale', icon: <Scaling className="h-3 w-3" /> },
                  ] as const
                ).map((item) => {
                  const scaleDisabled =
                    state.devMode === 'world' && item.mode === 'scale';
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      disabled={scaleDisabled}
                      onClick={() => controller?.setGizmoMode(item.mode)}
                      title={
                        scaleDisabled
                          ? 'Scale is not applicable to live world actors'
                          : item.label
                      }
                      className={`flex items-center justify-center gap-1 border py-1 text-[11px] font-medium rounded-none ${
                        scaleDisabled
                          ? 'border-zinc-700 bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                          : state.gizmoMode === item.mode
                          ? 'border-sky-400 bg-sky-600 text-white cursor-pointer'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 cursor-pointer'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Editor / World Controls */}
          {state.devMode === 'world' && (
            <WorldInstanceEditorTab controller={controller} state={state} />
          )}

          {state.devMode === 'asset' &&
            (state.assetTab === 'map' || state.assetTab === 'hierarchy') && (
              <MapWorldEditorTab controller={controller} state={state} />
            )}
          {state.devMode === 'asset' && state.assetTab === 'model' && (
            <ModelEditorTab controller={controller} state={state} />
          )}
          {state.devMode === 'asset' && state.assetTab === 'lightbars' && (
            <LightbarEditorTab
              controller={controller}
              state={state}
              onApplyToFleet={onApplyLightbarToFleet}
            />
          )}
          {state.devMode === 'asset' && state.assetTab === 'materials' && (
            <MaterialsEditorTab controller={controller} state={state} />
          )}
          {state.devMode === 'asset' && state.assetTab === 'texture' && (
            <TextureEditorTab controller={controller} state={state} />
          )}
          {state.devMode === 'asset' && state.assetTab === 'audio' && (
            <AudioEditorTab controller={controller} state={state} />
          )}
          {state.devMode === 'asset' && state.assetTab === 'prefabs' && (
            <TemplatesTab controller={controller} state={state} />
          )}
        </div>
      </div>
    </div>
  );
};
