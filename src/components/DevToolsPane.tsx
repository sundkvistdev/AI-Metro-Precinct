import React from 'react';
import {
  Box,
  Building2,
  Car,
  Download,
  Eye,
  EyeOff,
  FolderTree,
  Globe2,
  Image,
  Layers,
  Move,
  Palette,
  RotateCw,
  Save,
  Scaling,
  Volume2,
} from 'lucide-react';
import {
  DevEditorController,
  DevEditorState,
} from '../sim/devEditorController';
import { DevAssetTab } from '../sim/types';
import { AssetHierarchyPanel } from './editor/AssetHierarchyPanel';
import { AudioEditorTab } from './editor/AudioEditorTab';
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
}

const ASSET_TABS: Array<{ id: DevAssetTab; label: string; icon: React.ReactNode }> = [
  { id: 'hierarchy', label: 'Assets', icon: <FolderTree className="h-3 w-3" /> },
  { id: 'map', label: 'Map', icon: <Building2 className="h-3 w-3" /> },
  { id: 'model', label: 'Model', icon: <Box className="h-3 w-3" /> },
  { id: 'materials', label: 'Mat', icon: <Palette className="h-3 w-3" /> },
  { id: 'texture', label: 'Tex', icon: <Image className="h-3 w-3" /> },
  { id: 'audio', label: 'Audio', icon: <Volume2 className="h-3 w-3" /> },
  { id: 'prefabs', label: 'Prefabs', icon: <Car className="h-3 w-3" /> },
];

export const DevToolsPane: React.FC<DevToolsPaneProps> = ({
  controller,
  state,
  onExportZipPack,
}) => {
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
    state.dirtyAudio;

  const showAssetGizmo =
    state.devMode === 'asset' &&
    (state.assetTab === 'map' || state.assetTab === 'model');
  const showWorldGizmo =
    state.devMode === 'world' && Boolean(state.selectedWorldEntityUid);

  return (
    <div className="space-y-2 text-xs">
      {/* Top 2-Mode Switcher */}
      <div className="grid grid-cols-2 gap-1 border border-zinc-600 bg-zinc-900/70 p-1">
        <button
          type="button"
          onClick={() => controller?.setMode('world')}
          className={`flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase cursor-pointer rounded-none transition-colors ${
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
          className={`flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase cursor-pointer rounded-none transition-colors ${
            state.devMode === 'asset'
              ? 'bg-zinc-100 text-zinc-900 border border-zinc-300'
              : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Asset Editor
        </button>
      </div>

      {/* Pack Save / Export Strip */}
      {(anyDirty || state.lastSavedStatus || state.devMode === 'asset') && (
        <div className="ui-subpanel px-2 py-1.5 flex items-center justify-between gap-1.5">
          <div className="min-w-0 flex-1 text-[10px] font-mono-tabular truncate">
            {anyDirty ? (
              <span className="text-amber-300 font-medium">Unsaved pack changes</span>
            ) : state.lastSavedStatus ? (
              <span className="text-emerald-300">{state.lastSavedStatus}</span>
            ) : (
              <span className="text-zinc-400">Pack v2.0 ready</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => controller?.saveCurrentAssetToPack('all')}
              title="Save all modified assets into active pack (v2.0)"
              className={`flex items-center gap-1 border px-2 py-0.5 text-[10px] font-medium cursor-pointer rounded-none ${
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
                title="Export Asset Pack 2.0 ZIP"
                className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <Download className="h-3 w-3" />
                ZIP
              </button>
            )}
          </div>
        </div>
      )}

      {/* Asset Editor 7-Tab Strip */}
      {state.devMode === 'asset' && (
        <div className="grid grid-cols-7 gap-0.5 border border-zinc-600 bg-zinc-900/50 p-0.5">
          {ASSET_TABS.map((t) => {
            const active = state.assetTab === t.id;
            const dirtyDot =
              (t.id === 'map' && state.dirtyMap) ||
              (t.id === 'model' && state.dirtyModel) ||
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
                onClick={() => controller?.setShowRoadOverlay(!state.showRoadOverlay)}
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

      {/* Active Mode Content */}
      {state.devMode === 'world' && (
        <WorldInstanceEditorTab controller={controller} state={state} />
      )}

      {state.devMode === 'asset' && state.assetTab === 'hierarchy' && (
        <AssetHierarchyPanel controller={controller} state={state} />
      )}
      {state.devMode === 'asset' && state.assetTab === 'map' && (
        <MapWorldEditorTab controller={controller} state={state} />
      )}
      {state.devMode === 'asset' && state.assetTab === 'model' && (
        <ModelEditorTab controller={controller} state={state} />
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
  );
};
