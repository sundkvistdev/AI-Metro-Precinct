import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Download,
  ImagePlus,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Shapes,
  Square,
  Trash2,
  Type,
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

interface LayerBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  resizable: boolean;
}

function getLayerBounds(layer: TextureLayerOp): LayerBounds | null {
  switch (layer.op) {
    case 'rect':
    case 'image_stamp':
      return { x: layer.x, y: layer.y, w: layer.w, h: layer.h, resizable: true };
    case 'circle':
      return {
        x: layer.cx - layer.r,
        y: layer.cy - layer.r,
        w: layer.r * 2,
        h: layer.r * 2,
        resizable: true,
      };
    case 'ellipse':
      return {
        x: layer.cx - layer.rx,
        y: layer.cy - layer.ry,
        w: layer.rx * 2,
        h: layer.ry * 2,
        resizable: true,
      };
    case 'line': {
      const minX = Math.min(layer.x1, layer.x2);
      const minY = Math.min(layer.y1, layer.y2);
      const maxX = Math.max(layer.x1, layer.x2);
      const maxY = Math.max(layer.y1, layer.y2);
      return {
        x: minX,
        y: minY,
        w: Math.max(8, maxX - minX),
        h: Math.max(8, maxY - minY),
        resizable: true,
      };
    }
    case 'text': {
      const estW = Math.max(24, layer.text.length * layer.fontSize * 0.6);
      const estH = Math.max(12, layer.fontSize);
      const left =
        layer.align === 'center'
          ? layer.x - estW * 0.5
          : layer.align === 'right'
          ? layer.x - estW
          : layer.x;
      return {
        x: left,
        y: layer.y - estH * 0.5,
        w: estW,
        h: estH,
        resizable: true,
      };
    }
    case 'polygon': {
      if (layer.points.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of layer.points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
      return {
        x: minX,
        y: minY,
        w: Math.max(8, maxX - minX),
        h: Math.max(8, maxY - minY),
        resizable: false,
      };
    }
    default:
      return null;
  }
}

const LAYER_TEMPLATES: Record<string, (tex: ProceduralTextureAsset, mediaId?: string) => TextureLayerOp> = {
  rect: (t) => ({
    op: 'rect',
    x: Math.round(t.width * 0.15),
    y: Math.round(t.height * 0.35),
    w: Math.round(t.width * 0.7),
    h: Math.round(t.height * 0.22),
    color: '#38bdf8',
    strokeColor: '#ffffff',
    strokeWidth: 0,
    opacity: 1,
  }),
  circle: (t) => ({
    op: 'circle',
    cx: Math.round(t.width * 0.5),
    cy: Math.round(t.height * 0.5),
    r: Math.round(Math.min(t.width, t.height) * 0.18),
    color: '#facc15',
    strokeColor: '#0f172a',
    strokeWidth: 2,
    opacity: 1,
  }),
  ellipse: (t) => ({
    op: 'ellipse',
    cx: Math.round(t.width * 0.5),
    cy: Math.round(t.height * 0.5),
    rx: Math.round(t.width * 0.24),
    ry: Math.round(t.height * 0.14),
    rotation: 0,
    color: '#22c55e',
    opacity: 1,
  }),
  line: (t) => ({
    op: 'line',
    x1: Math.round(t.width * 0.1),
    y1: Math.round(t.height * 0.5),
    x2: Math.round(t.width * 0.9),
    y2: Math.round(t.height * 0.5),
    width: 8,
    color: '#f8fafc',
    opacity: 1,
  }),
  polygon: (t) => ({
    op: 'polygon',
    points: [
      [Math.round(t.width * 0.5), Math.round(t.height * 0.2)],
      [Math.round(t.width * 0.78), Math.round(t.height * 0.72)],
      [Math.round(t.width * 0.22), Math.round(t.height * 0.72)],
    ],
    color: '#ef4444',
    strokeColor: '#ffffff',
    strokeWidth: 2,
    opacity: 1,
  }),
  text: (t) => ({
    op: 'text',
    x: Math.round(t.width * 0.5),
    y: Math.round(t.height * 0.5),
    text: 'METRO PD',
    fontSize: Math.max(16, Math.round(t.height * 0.14)),
    fontWeight: '800',
    align: 'center',
    color: '#ffffff',
    opacity: 1,
  }),
  image_stamp: (t, mediaId) => ({
    op: 'image_stamp',
    mediaId: mediaId || '',
    x: Math.round(t.width * 0.15),
    y: Math.round(t.height * 0.15),
    w: Math.round(t.width * 0.7),
    h: Math.round(t.height * 0.7),
    rotation: 0,
    opacity: 1,
  }),
  fill: () => ({ op: 'fill', color: '#334155' }),
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
  police_door_emblem: () => ({
    op: 'police_door_emblem',
    title: 'METRO PD',
    subtitle: 'UNIT 99',
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
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const [newTexName, setNewTexName] = useState('custom_livery_tex');
  const [newLayerOp, setNewLayerOp] = useState<string>('rect');
  const [selectedLayerIdx, setSelectedLayerIdx] = useState<number>(0);
  const [liveryId, setLiveryId] = useState<string>(state.liveryIds[0] ?? 'classic_bw');
  const [importError, setImportError] = useState<string | null>(null);

  const dragRef = useRef<{
    mode: 'move' | 'resize';
    layerIdx: number;
    startX: number;
    startY: number;
    origLayer: TextureLayerOp;
  } | null>(null);

  const tex = state.selectedTexture;
  const imageMedia = useMemo(
    () => state.mediaList.filter((m) => m.kind === 'image'),
    [state.mediaList],
  );

  const safeLayerIdx =
    tex && selectedLayerIdx >= 0 && selectedLayerIdx < tex.layers.length
      ? selectedLayerIdx
      : tex && tex.layers.length > 0
      ? tex.layers.length - 1
      : -1;
  const selectedLayer =
    tex && safeLayerIdx >= 0 ? tex.layers[safeLayerIdx] : null;
  const selectedBounds = selectedLayer ? getLayerBounds(selectedLayer) : null;

  useEffect(() => {
    if (!tex || !canvasRef.current) return;
    renderJsonTextureToCanvas(tex, canvasRef.current, controller?.getMediaLookup());
  }, [tex, controller, state.mediaList]);

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
    setSelectedLayerIdx(nextIdx);
  };

  const deleteLayer = (idx: number) => {
    if (!tex) return;
    const layers = tex.layers.filter((_, i) => i !== idx);
    updateTex({ layers });
    setSelectedLayerIdx(Math.max(0, idx - 1));
  };

  const addLayerByOp = (opName: string) => {
    if (!tex) return;
    const maker = LAYER_TEMPLATES[opName] ?? LAYER_TEMPLATES.rect;
    const nextLayer = maker(tex, imageMedia[0]?.id);
    const nextIdx = tex.layers.length;
    updateTex({ layers: [...tex.layers, nextLayer] });
    setSelectedLayerIdx(nextIdx);
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !tex) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(1, rect.width)) * tex.width;
    const py = ((e.clientY - rect.top) / Math.max(1, rect.height)) * tex.height;
    return { x: px, y: py };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tex || !canvasRef.current) return;
    const pt = getCanvasPoint(e);

    // Check resize handle on currently selected layer first
    if (safeLayerIdx >= 0 && selectedBounds?.resizable) {
      const hx = selectedBounds.x + selectedBounds.w;
      const hy = selectedBounds.y + selectedBounds.h;
      const hitRadius = Math.max(10, Math.min(tex.width, tex.height) * 0.055);
      if (Math.hypot(pt.x - hx, pt.y - hy) <= hitRadius) {
        dragRef.current = {
          mode: 'resize',
          layerIdx: safeLayerIdx,
          startX: pt.x,
          startY: pt.y,
          origLayer: JSON.parse(JSON.stringify(tex.layers[safeLayerIdx])) as TextureLayerOp,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Hit-test topmost interactive layer under cursor
    for (let i = tex.layers.length - 1; i >= 0; i--) {
      const b = getLayerBounds(tex.layers[i]);
      if (!b) continue;
      if (
        pt.x >= b.x - 4 &&
        pt.x <= b.x + b.w + 4 &&
        pt.y >= b.y - 4 &&
        pt.y <= b.y + b.h + 4
      ) {
        setSelectedLayerIdx(i);
        dragRef.current = {
          mode: 'move',
          layerIdx: i,
          startX: pt.x,
          startY: pt.y,
          origLayer: JSON.parse(JSON.stringify(tex.layers[i])) as TextureLayerOp,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !tex) return;
    const pt = getCanvasPoint(e);
    const dx = Math.round(pt.x - d.startX);
    const dy = Math.round(pt.y - d.startY);
    const orig = d.origLayer;

    if (d.mode === 'move') {
      if (orig.op === 'rect' || orig.op === 'image_stamp' || orig.op === 'text') {
        updateLayer(d.layerIdx, { ...orig, x: orig.x + dx, y: orig.y + dy });
      } else if (orig.op === 'circle' || orig.op === 'ellipse') {
        updateLayer(d.layerIdx, { ...orig, cx: orig.cx + dx, cy: orig.cy + dy });
      } else if (orig.op === 'line') {
        updateLayer(d.layerIdx, {
          ...orig,
          x1: orig.x1 + dx,
          y1: orig.y1 + dy,
          x2: orig.x2 + dx,
          y2: orig.y2 + dy,
        });
      } else if (orig.op === 'polygon') {
        updateLayer(d.layerIdx, {
          ...orig,
          points: orig.points.map(([px, py]) => [px + dx, py + dy]),
        });
      }
    } else {
      if (orig.op === 'rect' || orig.op === 'image_stamp') {
        updateLayer(d.layerIdx, {
          ...orig,
          w: Math.max(8, orig.w + dx),
          h: Math.max(8, orig.h + dy),
        });
      } else if (orig.op === 'circle') {
        updateLayer(d.layerIdx, {
          ...orig,
          r: Math.max(4, Math.round(orig.r + (dx + dy) * 0.5)),
        });
      } else if (orig.op === 'ellipse') {
        updateLayer(d.layerIdx, {
          ...orig,
          rx: Math.max(4, orig.rx + dx),
          ry: Math.max(4, orig.ry + dy),
        });
      } else if (orig.op === 'line') {
        updateLayer(d.layerIdx, {
          ...orig,
          x2: orig.x2 + dx,
          y2: orig.y2 + dy,
        });
      } else if (orig.op === 'text') {
        updateLayer(d.layerIdx, {
          ...orig,
          fontSize: Math.max(10, orig.fontSize + dy),
        });
      }
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleImportJson = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      const text = await readFileAsText(file);
      controller.importTextureJson(text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportImage = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      await controller.importImageFileToPack(file);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Selector + Create + Real Image Import */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Texture & 2D Livery ({state.textureIds.length})</span>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-1 border border-sky-500/70 bg-sky-700/40 px-1.5 py-0.5 text-[10px] text-sky-100 hover:bg-sky-600/60 cursor-pointer rounded-none"
          >
            <ImagePlus className="h-3 w-3" />
            Import Image
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            void handleImportImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <select
          value={state.selectedTextureId}
          onChange={(e) => {
            controller?.selectTexture(e.target.value);
            setSelectedLayerIdx(0);
          }}
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
          {/* Interactive 2D Canvas Editor */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span>2D Canvas Editor (Click & Drag / Resize)</span>
              <span className="font-mono-tabular">
                {tex.width}×{tex.height}
              </span>
            </div>

            {/* Quick 2D Shape Palette */}
            <div className="grid grid-cols-6 gap-0.5">
              <button
                type="button"
                onClick={() => addLayerByOp('rect')}
                title="Add Rectangle"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                <Square className="h-2.5 w-2.5" />
                Rect
              </button>
              <button
                type="button"
                onClick={() => addLayerByOp('circle')}
                title="Add Circle"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                <Circle className="h-2.5 w-2.5" />
                Circ
              </button>
              <button
                type="button"
                onClick={() => addLayerByOp('ellipse')}
                title="Add Ellipse"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                Oval
              </button>
              <button
                type="button"
                onClick={() => addLayerByOp('line')}
                title="Add Line"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                <Minus className="h-2.5 w-2.5" />
                Line
              </button>
              <button
                type="button"
                onClick={() => addLayerByOp('polygon')}
                title="Add Polygon"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                <Shapes className="h-2.5 w-2.5" />
                Poly
              </button>
              <button
                type="button"
                onClick={() => addLayerByOp('text')}
                title="Add Text"
                className="flex items-center justify-center gap-0.5 border border-zinc-600 bg-zinc-800 py-1 text-[9px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
              >
                <Type className="h-2.5 w-2.5" />
                Text
              </button>
            </div>

            <div className="flex items-center justify-center border border-zinc-700 bg-zinc-950 p-1.5">
              <div
                className="relative inline-block max-w-full"
                style={{ aspectRatio: `${tex.width} / ${tex.height}`, maxHeight: 192 }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  className="block h-full w-full max-h-48 border border-zinc-700 cursor-crosshair touch-none"
                />
                {selectedBounds && (
                  <svg
                    viewBox={`0 0 ${tex.width} ${tex.height}`}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    <rect
                      x={selectedBounds.x}
                      y={selectedBounds.y}
                      width={selectedBounds.w}
                      height={selectedBounds.h}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={Math.max(1.5, tex.width * 0.008)}
                      strokeDasharray={`${Math.max(4, tex.width * 0.02)} ${Math.max(2, tex.width * 0.01)}`}
                    />
                    {selectedBounds.resizable && (
                      <rect
                        x={selectedBounds.x + selectedBounds.w - Math.max(5, tex.width * 0.025)}
                        y={selectedBounds.y + selectedBounds.h - Math.max(5, tex.width * 0.025)}
                        width={Math.max(10, tex.width * 0.05)}
                        height={Math.max(10, tex.width * 0.05)}
                        fill="#fbbf24"
                        stroke="#09090b"
                        strokeWidth={Math.max(1, tex.width * 0.005)}
                      />
                    )}
                  </svg>
                )}
              </div>
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
                  onClick={() => addLayerByOp(newLayerOp)}
                  className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
                >
                  <Plus className="h-3 w-3" />
                  Layer
                </button>
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1">
              {tex.layers.map((layer, idx) => {
                const isSel = idx === safeLayerIdx;
                return (
                  <div
                    key={`${layer.op}-${idx}`}
                    onClick={() => setSelectedLayerIdx(idx)}
                    className={`border p-1.5 space-y-1 text-[10px] font-mono-tabular cursor-pointer ${
                      isSel
                        ? 'border-sky-400 bg-zinc-800'
                        : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sky-300">
                        #{idx + 1} {layer.op}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            moveLayer(idx, -1);
                          }}
                          className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            moveLayer(idx, 1);
                          }}
                          className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            deleteLayer(idx);
                          }}
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
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.y}
                          title="Y"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, y: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.w}
                          title="W"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, w: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.h}
                          title="H"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, h: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
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

                    {layer.op === 'circle' && (
                      <div className="grid grid-cols-4 gap-1">
                        <input
                          type="number"
                          value={layer.cx}
                          title="CX"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, cx: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.cy}
                          title="CY"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, cy: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={2}
                          value={layer.r}
                          title="Radius"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, r: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
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

                    {layer.op === 'ellipse' && (
                      <div className="grid grid-cols-5 gap-1">
                        <input
                          type="number"
                          value={layer.cx}
                          title="CX"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, cx: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.cy}
                          title="CY"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, cy: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={2}
                          value={layer.rx}
                          title="RX"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, rx: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={2}
                          value={layer.ry}
                          title="RY"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, ry: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
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

                    {layer.op === 'line' && (
                      <div className="grid grid-cols-6 gap-1">
                        <input
                          type="number"
                          value={layer.x1}
                          title="X1"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, x1: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.y1}
                          title="Y1"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, y1: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.x2}
                          title="X2"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, x2: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          value={layer.y2}
                          title="Y2"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, y2: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={1}
                          value={layer.width}
                          title="Width"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, width: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
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

                    {layer.op === 'text' && (
                      <div className="grid grid-cols-5 gap-1">
                        <input
                          type="text"
                          value={layer.text}
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, text: e.target.value })
                          }
                          className="col-span-2 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={8}
                          value={layer.fontSize}
                          title="Font Size"
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, fontSize: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <select
                          value={layer.align ?? 'center'}
                          onChange={(e) =>
                            updateLayer(idx, {
                              ...layer,
                              align: e.target.value as CanvasTextAlign,
                            })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        >
                          <option value="left">left</option>
                          <option value="center">center</option>
                          <option value="right">right</option>
                        </select>
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

                    {layer.op === 'image_stamp' && (
                      <div className="space-y-1">
                        <select
                          value={layer.mediaId}
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, mediaId: e.target.value })
                          }
                          className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        >
                          <option value="">-- Pick imported image --</option>
                          {imageMedia.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id} ({m.width}×{m.height})
                            </option>
                          ))}
                        </select>
                        <div className="grid grid-cols-4 gap-1">
                          <input
                            type="number"
                            value={layer.x}
                            onChange={(e) =>
                              updateLayer(idx, { ...layer, x: Number(e.target.value) })
                            }
                            className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                          />
                          <input
                            type="number"
                            value={layer.y}
                            onChange={(e) =>
                              updateLayer(idx, { ...layer, y: Number(e.target.value) })
                            }
                            className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                          />
                          <input
                            type="number"
                            value={layer.w}
                            onChange={(e) =>
                              updateLayer(idx, { ...layer, w: Number(e.target.value) })
                            }
                            className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                          />
                          <input
                            type="number"
                            value={layer.h}
                            onChange={(e) =>
                              updateLayer(idx, { ...layer, h: Number(e.target.value) })
                            }
                            className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                          />
                        </div>
                      </div>
                    )}

                    {layer.op === 'grid_lines' && (
                      <div className="grid grid-cols-4 gap-1">
                        <input
                          type="number"
                          min={2}
                          value={layer.stepX}
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, stepX: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={2}
                          value={layer.stepY}
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, stepY: Number(e.target.value) })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="number"
                          min={1}
                          value={layer.lineWidth}
                          onChange={(e) =>
                            updateLayer(idx, {
                              ...layer,
                              lineWidth: Number(e.target.value),
                            })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
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
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                        <input
                          type="text"
                          value={layer.subtitle ?? ''}
                          onChange={(e) =>
                            updateLayer(idx, { ...layer, subtitle: e.target.value })
                          }
                          className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Livery Quick-Assign */}
          {state.liveryIds.length > 0 && (
            <div className="ui-subpanel p-2 space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-300">
                Assign Texture to Police Livery
              </div>
              <div className="flex gap-1">
                <select
                  value={liveryId}
                  onChange={(e) => setLiveryId(e.target.value)}
                  className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono-tabular text-zinc-100 rounded-none"
                >
                  {state.liveryIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    controller?.assignTextureToLivery(liveryId, tex.id, 'door')
                  }
                  className="border border-sky-500/70 bg-sky-700/40 px-2 py-0.5 text-[10px] text-sky-100 hover:bg-sky-600/60 cursor-pointer rounded-none"
                >
                  Door Decal
                </button>
                <button
                  type="button"
                  onClick={() =>
                    controller?.assignTextureToLivery(liveryId, tex.id, 'stripe')
                  }
                  className="border border-emerald-500/70 bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
                >
                  Side Stripe
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Save to Pack + JSON Actions */}
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImportJson(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => controller?.saveCurrentAssetToPack('texture')}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
            state.dirtyTextures
              ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
              : 'border-emerald-500/70 bg-emerald-700/45 text-emerald-100 hover:bg-emerald-600/60'
          }`}
        >
          <Save className="h-3 w-3" />
          Save to Pack
        </button>
        <button
          type="button"
          onClick={() => controller?.applyTexturesLive()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <RefreshCw className="h-3 w-3" />
          Apply Live
        </button>
        <button
          type="button"
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Upload className="h-3 w-3" />
          Load JSON
        </button>
        <button
          type="button"
          onClick={() => {
            const res = controller?.exportTextureJson();
            if (res) downloadJsonText(res.filename, res.content);
          }}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Download className="h-3 w-3" />
          Export JSON
        </button>
      </div>
    </div>
  );
};
