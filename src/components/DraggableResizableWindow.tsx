import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, Minimize2, X } from 'lucide-react';

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DraggableResizableWindowProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  defaultPos?: { x: number; y: number };
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  minimized?: boolean;
  onToggleMinimize?: () => void;
  onFocus?: () => void;
  onClose?: () => void;
  closeDisabled?: boolean;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  zIndex?: number;
  borderTone?: 'default' | 'danger' | 'warning';
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type DragOp =
  | { kind: 'move'; startX: number; startY: number; orig: WindowRect }
  | {
      kind: 'resize';
      edge: ResizeEdge;
      startX: number;
      startY: number;
      orig: WindowRect;
    };

function clampRect(rect: WindowRect, minW: number, minH: number): WindowRect {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const w = Math.max(Math.min(minW, vw - 16), Math.min(rect.w, vw - 16));
  const h = Math.max(Math.min(minH, vh - 16), Math.min(rect.h, vh - 16));
  const x = Math.max(8, Math.min(rect.x, vw - w - 8));
  const y = Math.max(8, Math.min(rect.y, vh - Math.min(h, 40) - 8));
  return { x, y, w, h };
}

export const DraggableResizableWindow: React.FC<DraggableResizableWindowProps> = ({
  title,
  subtitle,
  icon,
  defaultPos,
  defaultSize = { w: 540, h: 400 },
  minSize = { w: 320, h: 200 },
  minimized: controlledMinimized,
  onToggleMinimize,
  onFocus,
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
  const [internalMinimized, setInternalMinimized] = useState(false);
  const minimized = controlledMinimized ?? internalMinimized;
  const toggleMinimize = useCallback(() => {
    if (onToggleMinimize) {
      onToggleMinimize();
    } else {
      setInternalMinimized((m) => !m);
    }
  }, [onToggleMinimize]);

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
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
        const next: WindowRect = { ...op.orig };
        if (op.edge === 'e' || op.edge === 'ne' || op.edge === 'se') {
          next.w = op.orig.w + dx;
        }
        if (op.edge === 's' || op.edge === 'se' || op.edge === 'sw') {
          next.h = op.orig.h + dy;
        }
        if (op.edge === 'w' || op.edge === 'nw' || op.edge === 'sw') {
          const maxLeft = op.orig.x + op.orig.w - minSize.w;
          const clampedX = Math.max(8, Math.min(op.orig.x + dx, maxLeft));
          next.w = op.orig.x + op.orig.w - clampedX;
          next.x = clampedX;
        }
        if (op.edge === 'n' || op.edge === 'ne' || op.edge === 'nw') {
          const maxTop = op.orig.y + op.orig.h - minSize.h;
          const clampedY = Math.max(8, Math.min(op.orig.y + dy, maxTop));
          next.h = op.orig.y + op.orig.h - clampedY;
          next.y = clampedY;
        }
        next.w = Math.min(next.w, vw - next.x - 8);
        next.h = Math.min(next.h, vh - next.y - 8);
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

  const startResize = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent) => {
      e.stopPropagation();
      onFocus?.();
      dragOpRef.current = {
        kind: 'resize',
        edge,
        startX: e.clientX,
        startY: e.clientY,
        orig: rect,
      };
    },
    [onFocus, rect],
  );

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
      onPointerDown={(e) => {
        e.stopPropagation();
        onFocus?.();
      }}
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
      className={`pointer-events-auto flex flex-col border ${borderClass} bg-[#22262e]/95 text-zinc-100 shadow-2xl rounded-none select-none`}
    >
      {/* Draggable Header Bar */}
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onFocus?.();
          if ((e.target as HTMLElement).closest('button, input, select')) return;
          dragOpRef.current = {
            kind: 'move',
            startX: e.clientX,
            startY: e.clientY,
            orig: rect,
          };
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, input, select')) return;
          toggleMinimize();
        }}
        title="Drag to move · Double-click to collapse/restore"
        className={`flex items-center justify-between gap-2 border-b ${
          minimized ? 'border-b-0' : headerTone
        } bg-[#2c313b] px-2.5 py-1.5 cursor-move shrink-0`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          {icon && <span className="text-zinc-300 shrink-0">{icon}</span>}
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
            onClick={toggleMinimize}
            title={minimized ? 'Restore dialog' : 'Collapse dialog'}
            aria-label={minimized ? 'Restore dialog' : 'Collapse dialog'}
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
              title="Close dialog"
              aria-label="Close dialog"
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

          {/* 8-Way Resize Handles */}
          <div
            onPointerDown={startResize('n')}
            className="absolute top-0 left-2 right-2 h-1.5 cursor-ns-resize"
          />
          <div
            onPointerDown={startResize('s')}
            className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize"
          />
          <div
            onPointerDown={startResize('e')}
            className="absolute top-2 bottom-2 right-0 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={startResize('w')}
            className="absolute top-2 bottom-2 left-0 w-1.5 cursor-ew-resize"
          />
          <div
            onPointerDown={startResize('nw')}
            className="absolute top-0 left-0 h-2.5 w-2.5 cursor-nwse-resize"
          />
          <div
            onPointerDown={startResize('ne')}
            className="absolute top-0 right-0 h-2.5 w-2.5 cursor-nesw-resize"
          />
          <div
            onPointerDown={startResize('sw')}
            className="absolute bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize"
          />
          <div
            onPointerDown={startResize('se')}
            title="Drag to resize"
            className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize border-r-2 border-b-2 border-zinc-400/70 hover:border-sky-400"
          />
        </div>
      )}
    </div>
  );
};
