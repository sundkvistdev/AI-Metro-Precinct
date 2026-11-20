import React, { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import { useHudLayout } from '../sim/hudLayout';
import { SimSnapshot } from '../sim/types';
import { HudEditableFrame } from './HudEditableFrame';
import {
  computeAutoMinimapViewport,
  drawVectorRadar,
  RadarViewport,
} from './radarRenderer';

export interface MinimapRadarProps {
  snapshot: SimSnapshot;
  onOpenMapDialog: () => void;
}

export const MinimapRadar: React.FC<MinimapRadarProps> = ({
  snapshot,
  onOpenMapDialog,
}) => {
  const hud = useHudLayout();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef(snapshot);
  const smoothViewportRef = useRef<RadarViewport>({ cx: 0, cz: 0, halfSpan: 64 });
  const initializedRef = useRef(false);

  snapshotRef.current = snapshot;

  useEffect(() => {
    let rafId = 0;
    let lastMs = performance.now();

    const renderLoop = (nowMs: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (nowMs - lastMs) * 0.001));
      lastMs = nowMs;

      const canvas = canvasRef.current;
      const snap = snapshotRef.current;
      if (canvas) {
        const target = computeAutoMinimapViewport(snap.radarMap, snap.radar, 64);
        if (!initializedRef.current) {
          smoothViewportRef.current = { ...target };
          initializedRef.current = true;
        } else {
          const alpha = 1 - Math.exp(-6.5 * dt);
          smoothViewportRef.current.cx +=
            (target.cx - smoothViewportRef.current.cx) * alpha;
          smoothViewportRef.current.cz +=
            (target.cz - smoothViewportRef.current.cz) * alpha;
          smoothViewportRef.current.halfSpan +=
            (target.halfSpan - smoothViewportRef.current.halfSpan) * alpha;
        }

        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.max(1, Math.round(rect.width * dpr));
        const targetH = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
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
            smoothViewportRef.current,
            nowMs,
            {
              showCallsigns: false,
              showCaseLabels: true,
              showScaleGrid: true,
            },
          );
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const followed = snapshot.units.find((u) => u.id === snapshot.selectedUnitId);

  return (
    <HudEditableFrame
      widgetId="minimap"
      label="Tactical Radar"
      allowWidthResize
      allowHeightResize
      zIndex={24}
    >
      <div className="pointer-events-auto ui-panel flex flex-col w-full h-full overflow-hidden shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-600 bg-zinc-800/90 px-2 py-1 text-[10px] shrink-0">
          <span className="font-display font-semibold tracking-wider uppercase text-zinc-100 truncate">
            Radar · {followed ? followed.callsign : snapshot.mapName}
          </span>
          <span className="font-mono-tabular text-sky-300 shrink-0">
            {snapshot.radar.followedCrewDismounted ? 'CREW ZOOM' : 'TRACK'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!hud.editMode) onOpenMapDialog();
          }}
          title={
            hud.editMode
              ? 'Finish HUD editing to open interactive map'
              : 'Click to open interactive city map'
          }
          className={`relative flex-1 min-h-0 w-full bg-[#0e131b] text-left focus:outline-none ${
            hud.editMode ? 'cursor-default' : 'cursor-pointer group'
          }`}
        >
          <canvas ref={canvasRef} className="block w-full h-full" />
          {!hud.editMode && (
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 border border-zinc-600/80 bg-zinc-900/85 px-1.5 py-0.5 font-mono-tabular text-[9px] text-zinc-200 opacity-80 group-hover:opacity-100 group-hover:border-sky-400">
              <Maximize2 className="h-2.5 w-2.5 text-sky-400" />
              MAP
            </span>
          )}
        </button>
      </div>
    </HudEditableFrame>
  );
};
