import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Maximize, Minus, Plus } from 'lucide-react';
import { SimSnapshot } from '../sim/types';
import { DraggableResizableWindow } from './DraggableResizableWindow';
import {
  drawVectorRadar,
  getMapDefaultViewport,
  RadarViewport,
} from './radarRenderer';

export interface MapDialogProps {
  open: boolean;
  snapshot: SimSnapshot;
  onClose: () => void;
  onSelectUnit: (unitId: string) => void;
}

export const MapDialog: React.FC<MapDialogProps> = ({
  open,
  snapshot,
  onClose,
  onSelectUnit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef(snapshot);
  const [followSelected, setFollowSelected] = useState(false);
  const viewportRef = useRef<RadarViewport>({ cx: 0, cz: 0, halfSpan: 135 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origCx: number;
    origCz: number;
    moved: boolean;
  } | null>(null);

  snapshotRef.current = snapshot;

  // Reset to map overview when opened or map switches
  useEffect(() => {
    if (!open) return;
    viewportRef.current = getMapDefaultViewport(snapshotRef.current.radarMap);
  }, [open, snapshot.activeMapId]);

  useEffect(() => {
    if (!open) return;
    let rafId = 0;

    const loop = (nowMs: number) => {
      const canvas = canvasRef.current;
      const snap = snapshotRef.current;
      if (canvas) {
        if (followSelected) {
          const unit = snap.radar.cops.find((c) => c.id === snap.selectedUnitId);
          if (unit) {
            viewportRef.current.cx = unit.x;
            viewportRef.current.cz = unit.z;
          }
        }
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const tw = Math.max(1, Math.round(rect.width * dpr));
        const th = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== tw || canvas.height !== th) {
          canvas.width = tw;
          canvas.height = th;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          drawVectorRadar(
            ctx,
            rect.width,
            rect.height,
            snap.radarMap,
            snap.radar,
            viewportRef.current,
            nowMs,
            {
              showCallsigns: true,
              showCaseLabels: true,
              showScaleGrid: true,
            },
          );
          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [open, followSelected]);

  if (!open) return null;

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current;
    vp.halfSpan = Math.max(18, Math.min(340, vp.halfSpan * factor));
  };

  const resetFit = () => {
    setFollowSelected(false);
    viewportRef.current = getMapDefaultViewport(snapshot.radarMap);
  };

  const handleWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const minDim = Math.max(1, Math.min(rect.width, rect.height));
    const vp = viewportRef.current;
    const oldScale = minDim / (vp.halfSpan * 2);
    const mouseWorldX = vp.cx + (e.clientX - rect.left - rect.width * 0.5) / oldScale;
    const mouseWorldZ = vp.cz + (e.clientY - rect.top - rect.height * 0.5) / oldScale;

    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const nextHalfSpan = Math.max(18, Math.min(340, vp.halfSpan * factor));
    const nextScale = minDim / (nextHalfSpan * 2);

    vp.halfSpan = nextHalfSpan;
    if (!followSelected) {
      vp.cx = mouseWorldX - (e.clientX - rect.left - rect.width * 0.5) / nextScale;
      vp.cz = mouseWorldZ - (e.clientY - rect.top - rect.height * 0.5) / nextScale;
    }
  };

  const handlePointerDown: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    e.stopPropagation();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origCx: viewportRef.current.cx,
      origCz: viewportRef.current.cz,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const op = dragRef.current;
    const canvas = canvasRef.current;
    if (!op || !canvas) return;
    const dx = e.clientX - op.startX;
    const dy = e.clientY - op.startY;
    if (!op.moved && Math.hypot(dx, dy) > 4) {
      op.moved = true;
      setFollowSelected(false);
    }
    if (op.moved) {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(1, Math.min(rect.width, rect.height)) / (viewportRef.current.halfSpan * 2);
      viewportRef.current.cx = op.origCx - dx / scale;
      viewportRef.current.cz = op.origCz - dy / scale;
    }
  };

  const handlePointerUp: React.PointerEventHandler<HTMLCanvasElement> = (e) => {
    const op = dragRef.current;
    dragRef.current = null;
    if (!op || op.moved || !canvasRef.current) return;

    // Click near a police unit blip to select it
    const rect = canvasRef.current.getBoundingClientRect();
    const minDim = Math.max(1, Math.min(rect.width, rect.height));
    const vp = viewportRef.current;
    const scale = minDim / (vp.halfSpan * 2);
    const wx = vp.cx + (e.clientX - rect.left - rect.width * 0.5) / scale;
    const wz = vp.cz + (e.clientY - rect.top - rect.height * 0.5) / scale;
    const clickRadiusWorld = 12 / scale;

    let bestId: string | null = null;
    let bestDistSq = clickRadiusWorld * clickRadiusWorld;
    for (const cop of snapshotRef.current.radar.cops) {
      const dSq = (cop.x - wx) ** 2 + (cop.z - wz) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestId = cop.id;
      }
    }
    if (bestId) {
      onSelectUnit(bestId);
    }
  };

  return (
    <DraggableResizableWindow
      title="Tactical Sector Map"
      subtitle={`${snapshot.mapName} · ${snapshot.activeCrimes.length} active call(s)`}
      defaultSize={{ w: 720, h: 560 }}
      minSize={{ w: 400, h: 320 }}
      onClose={onClose}
      zIndex={65}
      headerActions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFollowSelected((f) => !f)}
            title="Lock view onto selected unit"
            className={`flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer rounded-none ${
              followSelected
                ? 'border-sky-400 bg-sky-600 text-white'
                : 'border-zinc-600 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
            }`}
          >
            <Crosshair className="h-3 w-3" />
            Track
          </button>
          <button
            type="button"
            onClick={resetFit}
            title="Fit entire city map"
            className="flex items-center gap-1 border border-zinc-600 bg-zinc-700/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            <Maximize className="h-3 w-3" />
            Fit
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.78)}
            title="Zoom in"
            aria-label="Zoom in"
            className="border border-zinc-600 bg-zinc-700/80 p-0.5 text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.28)}
            title="Zoom out"
            aria-label="Zoom out"
            className="border border-zinc-600 bg-zinc-700/80 p-0.5 text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            <Minus className="h-3 w-3" />
          </button>
        </div>
      }
    >
      <div className="relative flex-1 min-h-0 flex flex-col bg-[#0e131b]">
        <canvas
          ref={canvasRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="flex-1 min-h-0 w-full cursor-grab active:cursor-grabbing"
        />

        {/* Compact Radar Symbology Legend */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-700 bg-zinc-900/95 px-3 py-1.5 font-mono-tabular text-[10px] text-zinc-300 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 bg-blue-500 border border-sky-200" />
              Unit / Nav
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 bg-blue-400" />
              Officer (Flash=Down)
            </span>
            <span className="text-blue-400 font-bold">× Cop Wreck/KIA</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 bg-red-500 border border-red-200" />
              Suspect Visual
            </span>
            <span className="text-red-400 font-bold">? Sight Lost</span>
            <span className="text-red-400 font-bold">× Suspect Wreck/KIA</span>
          </div>
          <span className="text-zinc-500">Drag to pan · Wheel to zoom · Click unit to select</span>
        </div>
      </div>
    </DraggableResizableWindow>
  );
};
