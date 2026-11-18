import React, { useState } from 'react';
import {
  Box,
  Building2,
  ChevronDown,
  ChevronRight,
  FileImage,
  Image,
  Palette,
  Trash2,
  Volume2,
} from 'lucide-react';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';

export interface AssetHierarchyPanelProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

type AssetSectionKey = 'map' | 'models' | 'materials' | 'textures' | 'audio' | 'media';

export const AssetHierarchyPanel: React.FC<AssetHierarchyPanelProps> = ({
  controller,
  state,
}) => {
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Record<AssetSectionKey, boolean>>({
    map: true,
    models: true,
    materials: true,
    textures: true,
    audio: true,
    media: true,
  });

  const q = search.trim().toLowerCase();
  const toggleSection = (key: AssetSectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
      className="w-full flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
    >
      <span className="flex items-center gap-1.5">
        {openSections[key] ? (
          <ChevronDown className="h-3 w-3 text-zinc-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-400" />
        )}
        {icon}
        {label}
      </span>
      <span className="font-mono-tabular text-[10px] text-zinc-400">{count}</span>
    </button>
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="text-[10px] text-zinc-400">
        Pack Assets Directly Loaded in Active Bundle (click any item to edit):
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search loaded pack assets..."
        className="w-full border border-zinc-600 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-500 rounded-none"
      />

      <div className="max-h-[420px] overflow-y-auto border border-zinc-600 bg-zinc-900">
        {/* Map */}
        {renderGroupHeader('map', 'Map Definition', 1, <Building2 className="h-3 w-3 text-sky-300" />)}
        {openSections.map && (
          <button
            type="button"
            onClick={() => controller?.setAssetTab('map')}
            className="w-full flex items-center justify-between px-4 py-1 text-left font-mono-tabular text-[10px] text-zinc-200 hover:bg-zinc-800 border-b border-zinc-800 cursor-pointer rounded-none"
          >
            <span>active_map</span>
            <span className="text-zinc-400">
              {state.buildingIds.length} bldg · {state.nodeList.length} nodes
            </span>
          </button>
        )}

        {/* Models */}
        {renderGroupHeader('models', '3D Models', models.length, <Box className="h-3 w-3 text-amber-300" />)}
        {openSections.models &&
          models.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectModel(id);
                controller?.setAssetTab('model');
              }}
              className={`w-full flex items-center justify-between px-4 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedModelId === id
                  ? 'bg-sky-600/30 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-zinc-500">model</span>
            </button>
          ))}

        {/* Shared Materials */}
        {renderGroupHeader(
          'materials',
          'Shared Materials',
          materials.length,
          <Palette className="h-3 w-3 text-emerald-300" />,
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
              className={`w-full flex items-center justify-between px-4 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedMaterialId === id
                  ? 'bg-sky-600/30 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-zinc-500">material</span>
            </button>
          ))}

        {/* Textures */}
        {renderGroupHeader('textures', 'Textures & Liveries', textures.length, <Image className="h-3 w-3 text-purple-300" />)}
        {openSections.textures &&
          textures.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectTexture(id);
                controller?.setAssetTab('texture');
              }}
              className={`w-full flex items-center justify-between px-4 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedTextureId === id
                  ? 'bg-sky-600/30 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-zinc-500">texture</span>
            </button>
          ))}

        {/* Audio */}
        {renderGroupHeader('audio', 'Audio Assets', audioList.length, <Volume2 className="h-3 w-3 text-sky-300" />)}
        {openSections.audio &&
          audioList.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                controller?.selectAudio(id);
                controller?.setAssetTab('audio');
              }}
              className={`w-full flex items-center justify-between px-4 py-1 text-left font-mono-tabular text-[10px] border-b border-zinc-800 cursor-pointer rounded-none ${
                state.selectedAudioId === id
                  ? 'bg-sky-600/30 text-white'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{id}</span>
              <span className="text-zinc-500">audio</span>
            </button>
          ))}

        {/* Imported Media Files (Images & Audio Clips) */}
        {renderGroupHeader('media', 'Imported Media Files', mediaList.length, <FileImage className="h-3 w-3 text-zinc-300" />)}
        {openSections.media &&
          (mediaList.length === 0 ? (
            <div className="px-4 py-1.5 text-[10px] text-zinc-500">
              No imported image/audio files yet. Use Texture or Audio tab to import.
            </div>
          ) : (
            mediaList.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 px-4 py-1 font-mono-tabular text-[10px] border-b border-zinc-800 text-zinc-200"
              >
                <span className="truncate">{m.id}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-zinc-400">
                    {m.kind}
                    {m.width && m.height ? ` ${m.width}x${m.height}` : ''}
                  </span>
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
      </div>
    </div>
  );
};
