import React, { useEffect, useRef } from 'react';
import { GripVertical, Move } from 'lucide-react';
import {
  hudLayoutStore,
  HudWidgetId,
  HudWidgetLayout,
  useHudLayout,
} from '../sim/hudLayout';

export interface HudEditableFrameProps {
  widgetId: HudWidgetId;
  label: string;
  children: React.ReactNode;
  allowWidthResize?: boolean;
  allowHeightResize?: boolean;
  zIndex?: number;
}

export const HudEditableFrame: React.FC<HudEditableFrameProps> = ({
  widgetId,
  label,
  children,
  allowWidthResize = true,
  allowHeightResize = false,
  zIndex = 20,
}) => {
  const hud = useHudLayout();
  const widget = hud.widgets[widgetId];
  const dragRef = useRef<{
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    orig: HudWidgetLayout;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const op = dragRef.current;
      if (!op) return;
      const dx = e.clientX - op.startX;
      const dy = e.clientY - op.startY;
      if (op.kind === 'move') {
        hudLayoutStore.updateWidget(widgetId, {
          x: op.orig.x + dx,
          y: op.orig.y + dy,
        });
      } else {
        hudLayoutStore.updateWidget(widgetId, {
          w: allowWidthResize ? op.orig.w + dx : op.orig.w,
          h: allowHeightResize ? op.orig.h + dy : op.orig.h,
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [widgetId, allowWidthResize, allowHeightResize]);

  if (!widget.visible) return null;

  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      onPointerDown={stopAll}
      onMouseDown={stopAll}
      onWheel={stopAll}
      onContextMenu={stopAll}
      style={{
        position: 'fixed',
        left: widget.x,
        top: widget.y,
        width: hud.editMode || allowWidthResize ? widget.w : 'auto',
        height: allowHeightResize ? widget.h : 'auto',
        zIndex,
        opacity: hud.hudOpacity,
      }}
      className={`pointer-events-none ${
        hud.editMode ? 'outline-1 outline-dashed outline-sky-400/90 bg-sky-950/20' : ''
      }`}
    >
      {hud.editMode && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            dragRef.current = {
              kind: 'move',
              startX: e.clientX,
              startY: e.clientY,
              orig: widget,
            };
          }}
          className="pointer-events-auto flex items-center justify-between gap-2 bg-sky-600/90 px-1.5 py-0.5 text-[10px] font-mono-tabular font-semibold text-white cursor-move select-none"
        >
          <span className="flex items-center gap-1">
            <Move className="h-3 w-3" />
            {label}
          </span>
          <span className="flex items-center gap-1 text-[9px] text-sky-100">
            {Math.round(widget.x)},{Math.round(widget.y)}
            <GripVertical className="h-3 w-3" />
          </span>
        </div>
      )}

      {children}

      {hud.editMode && (allowWidthResize || allowHeightResize) && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            dragRef.current = {
              kind: 'resize',
              startX: e.clientX,
              startY: e.clientY,
              orig: widget,
            };
          }}
          title="Drag to resize HUD element"
          className="pointer-events-auto absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize border-r-2 border-b-2 border-sky-400 bg-sky-900/60"
        />
      )}
    </div>
  );
};
