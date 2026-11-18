import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripHorizontal, Minimize2, Maximize2, X } from 'lucide-react';

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DraggableResizableWindowProps {
  title: string;
  subtitle?: string;
  defaultPos?: { x: number; y: number };
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  onClose?: () => void;
  closeDisabled?: boolean;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  zIndex?: number;
  borderTone?: 'default' | 'danger' | 'warning';
}

type DragOp =
  | { kind: 'move'; startX: number; startY: number; orig: WindowRect }
  | {
      kind: 'resize';
      edge: 'e' | 's' | 'se' | 'w';
      startX: number;
      startY: number;
      orig: WindowRect;
    };

function clampRect(rect: WindowRect, minW: number, minH: number): WindowRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const w = Math.max(minW, Math.min(rect.w, vw - 16));
  const h = Math.max(minH, Math.min(rect.h, vh - 16));
  const x = Math.max(8, Math.min(rect.x, vw - w - 8));
  const y = Math.max(8, Math.min(rect.y, vh - Math.min(h, 40) - 8));
  return { x, y, w, h };
}

export const DraggableResizableWindow: React.FC<DraggableResizableWindowProps> = ({
  title,
  subtitle,
  defaultPos,
  defaultSize = { w: 540, h: 400 },
  minSize = { w: 320, h: 200 },
  onClose,
  closeDisabled = false,
  headerActions,
  children,
  zIndex = 60,
  borderTone = 'default',
}) => {
  const [rect, setRect] = useState<WindowRect>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const initX = defaultPos?.x ?? Math.round((vw - defaultSize.w) / 2);
    const initY = defaultPos?.y ?? Math.round((vh - defaultSize.h) / 2);
    return clampRect(
      { x: initX, y: initY, w: defaultSize.w, h: defaultSize.h },
      minSize.w,
      minSize.h,
    );
  });
  const [minimized, setMinimized] = useState(false);
  const dragOpRef = useRef<DragOp | null>(null);

  useEffect(() => {
    const onResizeWindow = () => {
      setRect((prev) => clampRect(prev, minSize.w, minSize.h));
    };
    window.addEventListener('resize', onResizeWindow);
    return () => window.removeEventListener('resize', onResizeWindow);
  }, [minSize.w, minSize.h]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const op = dragOpRef.current;
      if (!op) return;
      const dx = e.clientX - op.startX;
      const dy = e.clientY - op.startY;
      if (op.kind === 'move') {
        setRect(
          clampRect(
            {
              x: op.orig.x + dx,
              y: op.orig.y + dy,
              w: op.orig.w,
              h: op.orig.h,
            },
            minSize.w,
            minSize.h,
          ),
        );
      } else {
        const next: WindowRect = { ...op.orig };
        if (op.edge === 'e' || op.edge === 'se') {
          next.w = op.orig.w + dx;
        }
        if (op.edge === 's' || op.edge === 'se') {
          next.h = op.orig.h + dy;
        }
        if (op.edge === 'w') {
          const newW = Math.max(minSize.w, op.orig.w - dx);
          next.x = op.orig.x + (op.orig.w - newW);
          next.w = newW;
        }
        setRect(clampRect(next, minSize.w, minSize.h));
      }
    };

    const onPointerUp = () => {
      dragOpRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [minSize.w, minSize.h]);

  const stopEvents = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const borderClass =
    borderTone === 'danger'
      ? 'border-red-500/80'
      : borderTone === 'warning'
      ? 'border-amber-500/75'
      : 'border-[#4c5362]';

  const headerTone =
    borderTone === 'danger'
      ? 'border-red-500/60 bg-red-950/75'
      : borderTone === 'warning'
      ? 'border-amber-500/50 bg-[#2d313b]'
      : 'border-[#4c5362] bg-[#2c313b]';

  return (
    <div
      role="dialog"
      aria-label={title}
      onPointerDown={stopEvents}
      onMouseDown={stopEvents}
      onClick={stopEvents}
      onWheel={stopEvents}
      onContextMenu={stopEvents}
      style={{
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: minimized ? 'auto' : rect.h,
        zIndex,
      }}
      className={`pointer-events-auto flex flex-col border ${borderClass} bg-[#22262e] text-zinc-100 shadow-2xl rounded-none select-none`}
    >
      {/* Draggable Header Bar */}
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest('button, input, select')) return;
          dragOpRef.current = {
            kind: 'move',
            startX: e.clientX,
            startY: e.clientY,
            orig: rect,
          };
        }}
        className={`flex items-center justify-between gap-2 border-b ${headerTone} px-2.5 py-1.5 cursor-move shrink-0`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <span className="font-display text-xs font-semibold tracking-wider uppercase text-zinc-100 truncate">
            {title}
          </span>
          {subtitle && (
            <span className="font-mono-tabular text-[10px] text-zinc-400 truncate">
              {subtitle}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Restore window' : 'Minimize window'}
            className="border border-zinc-600 bg-zinc-700/80 p-0.5 text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            {minimized ? (
              <Maximize2 className="h-3 w-3" />
            ) : (
              <Minimize2 className="h-3 w-3" />
            )}
          </button>
          {onClose && !closeDisabled && (
            <button
              type="button"
              onClick={onClose}
              title="Close window"
              className="border border-zinc-600 bg-zinc-700/80 p-0.5 text-zinc-200 hover:bg-red-700/70 hover:text-white cursor-pointer rounded-none"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!minimized && (
        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden select-text">
          {children}

          {/* Resize Handles (E, S, W, SE) */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragOpRef.current = {
                kind: 'resize',
                edge: 'e',
                startX: e.clientX,
                startY: e.clientY,
                orig: rect,
              };
            }}
            className="absolute top-0 right-0 bottom-2 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragOpRef.current = {
                kind: 'resize',
                edge: 'w',
                startX: e.clientX,
                startY: e.clientY,
                orig: rect,
              };
            }}
            className="absolute top-0 left-0 bottom-2 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragOpRef.current = {
                kind: 'resize',
                edge: 's',
                startX: e.clientX,
                startY: e.clientY,
                orig: rect,
              };
            }}
            className="absolute left-0 right-2 bottom-0 h-1.5 cursor-ns-resize"
          />
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragOpRef.current = {
                kind: 'resize',
                edge: 'se',
                startX: e.clientX,
                startY: e.clientY,
                orig: rect,
              };
            }}
            title="Drag to resize"
            className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize border-r-2 border-b-2 border-zinc-400/70 hover:border-sky-400"
          />
        </div>
      )}
    </div>
  );
};
