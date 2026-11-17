import React from 'react';
import {
  Box,
  Building2,
  Car,
  Eye,
  EyeOff,
  Image,
  Move,
  RotateCw,
  Scaling,
  Volume2,
} from 'lucide-react';
import {
  DevEditorController,
  DevEditorState,
  DevEditorTab,
} from '../sim/devEditorController';
import { AudioEditorTab } from './editor/AudioEditorTab';
import { MapWorldEditorTab } from './editor/MapWorldEditorTab';
import { ModelEditorTab } from './editor/ModelEditorTab';
import { TemplatesTab } from './editor/TemplatesTab';
import { TextureEditorTab } from './editor/TextureEditorTab';

export interface DevToolsPaneProps {
  controller: DevEditorController | null;
  state: DevEditorState | null;
}

const TABS: Array<{ id: DevEditorTab; label: string; icon: React.ReactNode }> = [
  { id: 'map', label: 'Map', icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: 'model', label: 'Model', icon: <Box className="h-3.5 w-3.5" /> },
  { id: 'texture', label: 'Tex', icon: <Image className="h-3.5 w-3.5" /> },
  { id: 'audio', label: 'Audio', icon: <Volume2 className="h-3.5 w-3.5" /> },
  { id: 'templates', label: 'Prefabs', icon: <Car className="h-3.5 w-3.5" /> },
];

export const DevToolsPane: React.FC<DevToolsPaneProps> = ({
  controller,
  state,
}) => {
  if (!state) {
    return (
      <div className="p-2 text-xs text-zinc-400">
        Load a valid JSON asset pack to enable Asset & World Editors.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      {/* 5-Tab Studio Strip */}
      <div className="grid grid-cols-5 gap-0.5 border border-zinc-600 bg-zinc-900/50 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => controller?.setTab(t.id)}
            className={`flex items-center justify-center gap-1 py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              state.tab === t.id
                ? 'bg-zinc-200 text-zinc-900 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-700/70'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared 3D Gizmo Mode Bar */}
      {(state.tab === 'map' || state.tab === 'model') && (
        <div className="ui-subpanel p-1.5 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span>3D Transform Gizmo</span>
            {state.tab === 'map' && (
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
            ).map((item) => (
              <button
                key={item.mode}
                type="button"
                onClick={() => controller?.setGizmoMode(item.mode)}
                className={`flex items-center justify-center gap-1 border py-1 text-[11px] font-medium cursor-pointer rounded-none ${
                  state.gizmoMode === item.mode
                    ? 'border-sky-400 bg-sky-600 text-white'
                    : 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.tab === 'map' && (
        <MapWorldEditorTab controller={controller} state={state} />
      )}
      {state.tab === 'model' && (
        <ModelEditorTab controller={controller} state={state} />
      )}
      {state.tab === 'texture' && (
        <TextureEditorTab controller={controller} state={state} />
      )}
      {state.tab === 'audio' && (
        <AudioEditorTab controller={controller} state={state} />
      )}
      {state.tab === 'templates' && (
        <TemplatesTab controller={controller} state={state} />
      )}
    </div>
  );
};
