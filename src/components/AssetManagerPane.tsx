import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FolderArchive,
  RefreshCw,
} from 'lucide-react';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { SimSnapshot } from '../sim/types';

export interface AssetManagerPaneProps {
  snapshot: SimSnapshot;
  loadedAssets: LoadedJsonAssets | null;
  busy: boolean;
  onLoadZipPack: (file: File) => void;
  onExportZipPack: () => void;
  onReloadDefaultPack: () => void;
  onOpenErrorDialog: () => void;
}

type AssetTab =
  | 'models'
  | 'lightbars'
  | 'materials'
  | 'textures'
  | 'audio'
  | 'map'
  | 'config';

export const AssetManagerPane: React.FC<AssetManagerPaneProps> = ({
  snapshot,
  loadedAssets,
  busy,
  onLoadZipPack,
  onExportZipPack,
  onReloadDefaultPack,
  onOpenErrorDialog,
}) => {
  const [tab, setTab] = useState<AssetTab>('models');
  const [filter, setFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => {
    if (!loadedAssets) return [];
    const q = filter.trim().toLowerCase();

    if (tab === 'textures') {
      return Object.entries(loadedAssets.textures)
        .filter(([id]) => !q || id.toLowerCase().includes(q))
        .map(([id, tex]) => ({
          id,
          meta: `${tex.width}×${tex.height} · ${tex.layers.length} ops`,
        }));
    }
    if (tab === 'models') {
      return Object.entries(loadedAssets.models)
        .filter(([id]) => !q || id.toLowerCase().includes(q))
        .map(([id, mdl]) => ({
          id,
          meta: `${mdl.parts.length} parts · ${Object.keys(mdl.materials).length} mats`,
        }));
    }
    if (tab === 'lightbars') {
      return Object.entries(loadedAssets.lightbars ?? {})
        .filter(([id, lb]) => !q || id.toLowerCase().includes(q) || lb.name.toLowerCase().includes(q))
        .map(([id, lb]) => ({
          id,
          meta: `${lb.hardwareStyle} · ${lb.patternType}`,
        }));
    }
    if (tab === 'materials') {
      return Object.entries(loadedAssets.materials)
        .filter(([id]) => !q || id.toLowerCase().includes(q))
        .map(([id, mat]) => ({
          id,
          meta: `${mat.type} · ${mat.color}`,
        }));
    }
    if (tab === 'audio') {
      return Object.entries(loadedAssets.audio)
        .filter(([id]) => !q || id.toLowerCase().includes(q))
        .map(([id, aud]) => ({
          id,
          meta: aud.kind,
        }));
    }
    if (tab === 'map') {
      const m = loadedAssets.map;
      return [
        { id: 'active.id', meta: m.id },
        { id: 'active.name', meta: m.name },
        { id: 'pack.maps', meta: Object.keys(loadedAssets.maps ?? {}).join(', ') },
        { id: 'map.bounds', meta: `±${m.bounds.halfSize}m` },
        { id: 'map.roadNodes', meta: `${m.roadNetwork.nodes.length} nodes` },
        { id: 'map.roadEdges', meta: `${m.roadNetwork.edges.length} edges` },
        { id: 'map.buildings', meta: `${m.buildings.length} structures` },
        { id: 'map.bays', meta: `${(m.stationBays ?? []).length} station bays` },
      ].filter(
        (row) => !q || row.id.toLowerCase().includes(q) || row.meta.toLowerCase().includes(q),
      );
    }
    const cfg = loadedAssets.config;
    return [
      { id: 'vehicleDefs', meta: `${Object.keys(loadedAssets.vehicleDefs ?? {}).length} vehicles` },
      { id: 'lightbars', meta: `${Object.keys(loadedAssets.lightbars ?? {}).length} presets` },
      { id: 'vehicles.liveries', meta: `${Object.keys(cfg.vehicles.liveries).length} presets` },
      { id: 'vehicles.paintPalette', meta: `${cfg.vehicles.paintPalette.length} swatches` },
      { id: 'weapons', meta: Object.keys(cfg.weapons).join(', ') },
      { id: 'weatherPresets', meta: Object.keys(cfg.weatherPresets).join(', ') },
      { id: 'backupPolicies', meta: Object.keys(cfg.backupPolicies).join(', ') },
    ].filter(
      (row) => !q || row.id.toLowerCase().includes(q) || row.meta.toLowerCase().includes(q),
    );
  }, [loadedAssets, tab, filter]);

  const issueCount = snapshot.assetIssues.length;

  return (
    <div className="space-y-2 text-xs">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadZipPack(f);
          e.target.value = '';
        }}
      />

      <div className="ui-subpanel p-2 space-y-1 font-mono-tabular">
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-300">Pack</span>
          <span className="text-zinc-100 font-semibold truncate">{snapshot.assetPackName}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Source</span>
          <span className="text-zinc-200 truncate">{snapshot.assetSourceLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Map</span>
          <span className="text-zinc-200 truncate">{snapshot.mapName}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-400">Format</span>
          <span className="text-zinc-200">
            v{loadedAssets?.manifest.formatVersion ?? '1.5.0'} · cfg {snapshot.configVersion}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 text-[10px] text-zinc-300">
          <span>{snapshot.assetCounts.maps} map</span>
          <span>{snapshot.assetCounts.lightbars} bar</span>
          <span>{snapshot.assetCounts.models} mdl</span>
          <span>{snapshot.assetCounts.materials} mat</span>
          <span>{snapshot.assetCounts.textures} tex</span>
          <span>{snapshot.assetCounts.audio} sfx</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
            busy
              ? 'border-zinc-600 bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
              : 'border-blue-400/70 bg-blue-600/80 text-white hover:bg-blue-500 cursor-pointer'
          }`}
        >
          <FolderArchive className="h-3.5 w-3.5" />
          Load ZIP
        </button>

        <button
          type="button"
          disabled={busy || !loadedAssets}
          onClick={onExportZipPack}
          className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
            busy || !loadedAssets
              ? 'border-zinc-600 bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
          }`}
        >
          <Download className="h-3.5 w-3.5" />
          Export V3 ZIP
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onReloadDefaultPack}
          className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
            busy
              ? 'border-zinc-600 bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Default Pack
        </button>

        <button
          type="button"
          disabled={issueCount === 0}
          onClick={onOpenErrorDialog}
          className={`flex items-center justify-center gap-1 border px-2 py-1.5 font-medium whitespace-nowrap shrink-0 rounded-none ${
            issueCount > 0
              ? 'border-amber-400/70 bg-amber-600/30 text-amber-200 hover:bg-amber-600/45 cursor-pointer'
              : 'border-zinc-600 bg-zinc-800/60 text-zinc-500 cursor-not-allowed'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Issues ({issueCount})
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 bg-zinc-900/50 p-0.5 border border-zinc-600">
        {(
          [
            { key: 'models', label: 'Mdl' },
            { key: 'lightbars', label: 'Bar' },
            { key: 'materials', label: 'Mat' },
            { key: 'textures', label: 'Tex' },
            { key: 'audio', label: 'Sfx' },
            { key: 'map', label: 'Map' },
            { key: 'config', label: 'Cfg' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              tab === item.key
                ? 'bg-zinc-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Filter ${tab}...`}
        className="w-full border border-zinc-600 bg-zinc-900/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none rounded-none"
      />

      <div className="max-h-48 overflow-y-auto border border-zinc-600 bg-zinc-900/50 divide-y divide-zinc-700/80">
        {items.length === 0 ? (
          <div className="px-2 py-2 text-center text-zinc-400">No entries match filter.</div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 px-2 py-1 font-mono-tabular text-[11px]"
            >
              <span className="truncate text-zinc-100">{item.id}</span>
              <span className="shrink-0 text-zinc-400">{item.meta}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
