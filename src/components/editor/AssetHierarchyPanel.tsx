import React, { useState } from 'react';
import {
  Box,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  FileImage,
  Image,
  Palette,
  Siren,
  Trash2,
  Volume2,
} from 'lucide-react';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';

export interface AssetHierarchyPanelProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

type AssetSectionKey =
  | 'maps'
  | 'lightbars'
  | 'models'
  | 'materials'
  | 'textures'
  | 'audio'
  | 'media'
  | 'templates';

export const AssetHierarchyPanel: React.FC<AssetHierarchyPanelProps> = ({
  controller,
  state,
}) => {
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<AssetSectionKey, boolean>>({
    maps: true,
    lightbars: true,
    models: true,
    materials: false,
    textures: false,
    audio: false,
    media: false,
    templates: false,
  });

  const q = search.trim().toLowerCase();
  const toggleSection = (key: AssetSectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const maps = state.mapIds.filter((id) => !q || id.toLowerCase().includes(q));
  const lightbars = state.lightbarIds.filter((id) => !q || id.toLowerCase().includes(q));
  const models = state.modelIds.filter((id) => !q || id.toLowerCase().includes(q));
  const materials = state.materialIds.filter((id) => !q || id.toLowerCase().includes(q));
  const textures = state.textureIds.filter((id) => !q || id.toLowerCase().includes(q));
  const audioList = state.audioIds.filter((id) => !q || id.toLowerCase().includes(q));
  const mediaList = state.mediaList.filter(
    (m) => !q || m.id.toLowerCase().includes(q) || m.path.toLowerCase().includes(q),
  );

  const renderGroupHeader = (
    key: AssetSectionKey,
    label: string,
    count: number,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={() => toggleSection(key)}
      className="w-full flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {openSections[key] ? (
          <ChevronDown className="h-3 w-3 text-zinc-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-400 shrink-0" />
        )}
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono-tabular text-[10px] text-zinc-400 shrink-0">{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full gap-1.5 text-xs">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter pack hierarchy..."
        className="w-full border border-zinc-600 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-500 rounded-none shrink-0"
      />

      <div className="flex-1 min-h-0 overflow-y-auto border border-zinc-600 bg-zinc-900">
        {/* Maps */}
        {renderGroupHeader('maps', 'Maps', maps.length, <Building2 className="h-3 w-3 text-sky-300 shrink-0" />)}
        {openSections.maps &&
          maps.map((id) => {
            const active = state.activeMapId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (!active) controller?.switchMap(id);
                  controller?.setAssetTab('map');
                }}
                className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                  active && state.assetTab === 'map'
                    ? 'bg-sky-600/40 text-white'
                    : active
                    ? 'bg-sky-900/30 text-sky-200 hover:bg-zinc-800'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span className="truncate">{id}</span>
                <span className="text-[9px] text-zinc-400 shrink-0">
                  {active ? 'ACTIVE' : 'load'}
                </span>
              </button>
            );
          })}

        {/* Lightbars */}
        {renderGroupHeader('lightbars', 'Lightbars', lightbars.length, <Siren className="h-3 w-3 text-rose-300 shrink-0" />)}
        {openSections.lightbars &&
          lightbars.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectLightbar(id);
                controller?.setAssetTab('lightbars');
              }}
              className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedLightbarId === id && state.assetTab === 'lightbars'
                  ? 'bg-sky-600/40 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-[9px] text-zinc-500 shrink-0">bar</span>
            </button>
          ))}

        {/* Models */}
        {renderGroupHeader('models', '3D Models', models.length, <Box className="h-3 w-3 text-amber-300 shrink-0" />)}
        {openSections.models &&
          models.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectModel(id);
                controller?.setAssetTab('model');
              }}
              className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedModelId === id && state.assetTab === 'model'
                  ? 'bg-sky-600/40 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-[9px] text-zinc-500 shrink-0">mdl</span>
            </button>
          ))}

        {/* Shared Materials */}
        {renderGroupHeader(
          'materials',
          'Materials',
          materials.length,
          <Palette className="h-3 w-3 text-emerald-300 shrink-0" />,
        )}
        {openSections.materials &&
          materials.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectPackMaterial(id);
                controller?.setAssetTab('materials');
              }}
              className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedMaterialId === id && state.assetTab === 'materials'
                  ? 'bg-sky-600/40 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-[9px] text-zinc-500 shrink-0">mat</span>
            </button>
          ))}

        {/* Textures */}
        {renderGroupHeader('textures', 'Textures', textures.length, <Image className="h-3 w-3 text-purple-300 shrink-0" />)}
        {openSections.textures &&
          textures.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectTexture(id);
                controller?.setAssetTab('texture');
              }}
              className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedTextureId === id && state.assetTab === 'texture'
                  ? 'bg-sky-600/40 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-[9px] text-zinc-500 shrink-0">tex</span>
            </button>
          ))}

        {/* Audio */}
        {renderGroupHeader('audio', 'Audio', audioList.length, <Volume2 className="h-3 w-3 text-sky-300 shrink-0" />)}
        {openSections.audio &&
          audioList.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectAudio(id);
                controller?.setAssetTab('audio');
              }}
              className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedAudioId === id && state.assetTab === 'audio'
                  ? 'bg-sky-600/40 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-[9px] text-zinc-500 shrink-0">sfx</span>
            </button>
          ))}

        {/* Imported Media Files */}
        {renderGroupHeader('media', 'Media Files', mediaList.length, <FileImage className="h-3 w-3 text-zinc-300 shrink-0" />)}
        {openSections.media &&
          (mediaList.length === 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-zinc-500">
              No imported image/audio media yet.
            </div>
          ) : (
            mediaList.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-1 px-3 py-1 font-mono-tabular text-[10px] border-b border-zinc-800 text-zinc-200"
              >
                <span className="truncate">{m.id}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-zinc-400">{m.kind}</span>
                  <button
                    type="button"
                    onClick={() => controller?.deleteMedia(m.id)}
                    title="Remove media from pack"
                    className="p-0.5 text-red-400 hover:text-red-200 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          ))}

        {/* Prefabs & Pools */}
        {renderGroupHeader('templates', 'Vehicles & Pools', 4, <Car className="h-3 w-3 text-teal-300 shrink-0" />)}
        {openSections.templates && (
          <button
            type="button"
            onClick={() => controller?.setAssetTab('prefabs')}
            className={`w-full flex items-center justify-between px-3 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
              state.assetTab === 'prefabs'
                ? 'bg-sky-600/40 text-white'
                : 'text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <span>Civilian / Ped / Chassis</span>
            <span className="text-[9px] text-zinc-400">edit</span>
          </button>
        )}
      </div>
    </div>
  );
};
