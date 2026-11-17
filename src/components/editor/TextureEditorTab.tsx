import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { ProceduralTextureAsset, TextureLayerOp } from '../../assets/assetTypes';
import { renderJsonTextureToCanvas } from '../../assets/jsonTextureRenderer';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { downloadJsonText, readFileAsText } from './editorFileUtils';

export interface TextureEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

const LAYER_TEMPLATES: Record<string, () => TextureLayerOp> = {
  fill: () => ({ op: 'fill', color: '#334155' }),
  rect: () => ({ op: 'rect', x: 16, y: 16, w: 96, h: 48, color: '#38bdf8' }),
  grid_lines: () => ({
    op: 'grid_lines',
    stepX: 32,
    stepY: 32,
    lineWidth: 2,
    color: '#475569',
  }),
  dashed_line: () => ({
    op: 'dashed_line',
    orientation: 'horizontal',
    position: 120,
    dashLength: 20,
    gapLength: 14,
    thickness: 6,
    color: '#facc15',
  }),
  road_sign_plate: () => ({
    op: 'road_sign_plate',
    shape: 'octagon',
    title: 'STOP',
    subtitle: '',
    bgColor: '#dc2626',
    borderColor: '#ffffff',
    textColor: '#ffffff',
  }),
  police_door_emblem: () => ({
    op: 'police_door_emblem',
    title: 'METRO PD',
    subtitle: 'UNIT 99',
  }),
  noise_speckle: () => ({
    op: 'noise_speckle',
    count: 600,
    size: 2,
    minRgb: [25, 28, 35],
    maxRgb: [75, 82, 92],
    alpha: 0.45,
  }),
};

export const TextureEditorTab: React.FC<TextureEditorTabProps> = ({
  controller,
  state,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newTexName, setNewTexName] = useState('custom_tex');
  const [newLayerOp, setNewLayerOp] = useState<string>('rect');
  const [importError, setImportError] = useState<string | null>(null);

  const tex = state.selectedTexture;

  useEffect(() => {
    if (!tex || !canvasRef.current) return;
    renderJsonTextureToCanvas(tex, canvasRef.current);
  }, [tex]);

  const updateTex = (patch: Partial<ProceduralTextureAsset>) => {
    if (!tex || !controller) return;
    controller.updateSelectedTexture({ ...tex, ...patch });
  };

  const updateLayer = (idx: number, nextLayer: TextureLayerOp) => {
    if (!tex) return;
    const layers = [...tex.layers];
    layers[idx] = nextLayer;
    updateTex({ layers });
  };

  const moveLayer = (idx: number, delta: -1 | 1) => {
    if (!tex) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= tex.layers.length) return;
    const layers = [...tex.layers];
    const [item] = layers.splice(idx, 1);
    layers.splice(nextIdx, 0, item);
    updateTex({ layers });
  };

  const deleteLayer = (idx: number) => {
    if (!tex) return;
    const layers = tex.layers.filter((_, i) => i !== idx);
    updateTex({ layers });
  };

  const addLayer = () => {
    if (!tex) return;
    const maker = LAYER_TEMPLATES[newLayerOp] ?? LAYER_TEMPLATES.rect;
    updateTex({ layers: [...tex.layers, maker()] });
  };

  const handleImport = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      const text = await readFileAsText(file);
      controller.importTextureJson(text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Selector + Create */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Texture Asset ({state.textureIds.length})</span>
          {tex && (
            <span className="font-mono-tabular text-[10px] text-zinc-400">
              {tex.width}x{tex.height}
            </span>
          )}
        </div>

        <select
          value={state.selectedTextureId}
          onChange={(e) => controller?.selectTexture(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.textureIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          <input
            type="text"
            value={newTexName}
            onChange={(e) => setNewTexName(e.target.value)}
            placeholder="new_texture_id"
            className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <button
            type="button"
            onClick={() => controller?.createNewTexture(newTexName)}
            className="border border-emerald-500/70 bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
          >
            +New
          </button>
        </div>
      </div>

      {importError && (
        <div className="border border-red-500/70 bg-red-950/60 p-1.5 text-[10px] text-red-200 rounded-none">
          {importError}
        </div>
      )}

      {tex && (
        <>
          {/* Live Canvas Preview */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-center border border-zinc-700 bg-zinc-950 p-2">
              <canvas
                ref={canvasRef}
                className="max-h-40 max-w-full border border-zinc-700 object-contain"
              />
            </div>

            <div className="grid grid-cols-3 gap-1 text-[10px] font-mono-tabular">
              <label className="space-y-0.5">
                <span className="text-zinc-400">Width</span>
                <input
                  type="number"
                  step={32}
                  min={16}
                  max={1024}
                  value={tex.width}
                  onChange={(e) => updateTex({ width: Number(e.target.value) })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-zinc-400">Height</span>
                <input
                  type="number"
                  step={32}
                  min={16}
                  max={1024}
                  value={tex.height}
                  onChange={(e) => updateTex({ height: Number(e.target.value) })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-zinc-400">Seed</span>
                <input
                  type="number"
                  step={1}
                  value={tex.seed}
                  onChange={(e) => updateTex({ seed: Number(e.target.value) })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                />
              </label>
            </div>
          </div>

          {/* Layer Stack */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium text-zinc-300">
                Layers ({tex.layers.length})
              </span>
              <div className="flex gap-1">
                <select
                  value={newLayerOp}
                  onChange={(e) => setNewLayerOp(e.target.value)}
                  className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                >
                  {Object.keys(LAYER_TEMPLATES).map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addLayer}
                  className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
                >
                  <Plus className="h-3 w-3" />
                  Layer
                </button>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {tex.layers.map((layer, idx) => (
                <div
                  key={`${layer.op}-${idx}`}
                  className="border border-zinc-700 bg-zinc-900 p-1.5 space-y-1 text-[10px] font-mono-tabular"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sky-300">
                      #{idx + 1} {layer.op}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveLayer(idx, -1)}
                        className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveLayer(idx, 1)}
                        className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLayer(idx)}
                        className="p-0.5 text-red-400 hover:text-red-200 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {layer.op === 'fill' && (
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400">Color</span>
                      <input
                        type="color"
                        value={layer.color.slice(0, 7)}
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, color: e.target.value })
                        }
                        className="h-5 w-8 border border-zinc-600 bg-transparent cursor-pointer"
                      />
                      <span className="text-zinc-300">{layer.color}</span>
                    </div>
                  )}

                  {layer.op === 'rect' && (
                    <div className="grid grid-cols-5 gap-1">
                      <input
                        type="number"
                        value={layer.x}
                        title="X"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, x: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="number"
                        value={layer.y}
                        title="Y"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, y: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="number"
                        value={layer.w}
                        title="W"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, w: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="number"
                        value={layer.h}
                        title="H"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, h: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="color"
                        value={layer.color.slice(0, 7)}
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, color: e.target.value })
                        }
                        className="h-5 w-full border border-zinc-600 bg-transparent cursor-pointer"
                      />
                    </div>
                  )}

                  {layer.op === 'grid_lines' && (
                    <div className="grid grid-cols-4 gap-1">
                      <input
                        type="number"
                        min={2}
                        value={layer.stepX}
                        title="Step X"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, stepX: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="number"
                        min={2}
                        value={layer.stepY}
                        title="Step Y"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, stepY: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="number"
                        min={1}
                        value={layer.lineWidth}
                        title="Width"
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, lineWidth: Number(e.target.value) })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="color"
                        value={layer.color.slice(0, 7)}
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, color: e.target.value })
                        }
                        className="h-5 w-full border border-zinc-600 bg-transparent cursor-pointer"
                      />
                    </div>
                  )}

                  {(layer.op === 'police_door_emblem' ||
                    layer.op === 'precinct_sign_plate' ||
                    layer.op === 'road_sign_plate') && (
                    <div className="grid grid-cols-2 gap-1">
                      <input
                        type="text"
                        value={layer.title}
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, title: e.target.value })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <input
                        type="text"
                        value={layer.subtitle ?? ''}
                        onChange={(e) =>
                          updateLayer(idx, { ...layer, subtitle: e.target.value })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                    </div>
                  )}

                  {layer.op !== 'fill' &&
                    layer.op !== 'rect' &&
                    layer.op !== 'grid_lines' &&
                    layer.op !== 'police_door_emblem' &&
                    layer.op !== 'precinct_sign_plate' &&
                    layer.op !== 'road_sign_plate' && (
                      <div className="text-[9px] text-zinc-400 truncate">
                        {JSON.stringify(layer)}
                      </div>
                    )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => controller?.applyTexturesLive()}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
            state.dirtyTextures
              ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
          }`}
        >
          <RefreshCw className="h-3 w-3" />
          Apply Map
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Upload className="h-3 w-3" />
          Load
        </button>
        <button
          type="button"
          onClick={() => {
            const res = controller?.exportTextureJson();
            if (res) downloadJsonText(res.filename, res.content);
          }}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Download className="h-3 w-3" />
          Save
        </button>
      </div>
    </div>
  );
};
