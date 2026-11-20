import { useEffect, useState } from 'react';

export type HudWidgetId = 'topBar' | 'sidebarDock' | 'cameraBar' | 'minimap';

export interface HudWidgetLayout {
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudLayoutConfig {
  editMode: boolean;
  hudOpacity: number;
  compactMode: boolean;
  widgets: Record<HudWidgetId, HudWidgetLayout>;
}

const STORAGE_KEY = 'metro_precinct_hud_layout_v1';

export function getDefaultHudLayout(): HudLayoutConfig {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const miniSize = Math.min(220, Math.max(168, Math.round(Math.min(vw, vh) * 0.25)));
  return {
    editMode: false,
    hudOpacity: 0.94,
    compactMode: false,
    widgets: {
      topBar: {
        visible: true,
        x: 6,
        y: 6,
        w: Math.max(480, vw - 12),
        h: 36,
      },
      sidebarDock: {
        visible: true,
        x: 6,
        y: 48,
        w: 356,
        h: Math.max(360, vh - 110),
      },
      cameraBar: {
        visible: true,
        x: Math.max(8, Math.round((vw - 640) / 2)),
        y: Math.max(8, vh - 46),
        w: Math.min(640, vw - 16),
        h: 38,
      },
      minimap: {
        visible: true,
        x: Math.max(8, vw - miniSize - 10),
        y: Math.max(50, vh - miniSize - 10),
        w: miniSize,
        h: miniSize,
      },
    },
  };
}

function loadInitialLayout(): HudLayoutConfig {
  const def = getDefaultHudLayout();
  if (typeof window === 'undefined') return def;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<HudLayoutConfig>;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mergeWidget = (id: HudWidgetId): HudWidgetLayout => {
      const base = def.widgets[id];
      const item = parsed.widgets?.[id];
      if (!item) return base;
      const minW = id === 'minimap' ? 140 : 180;
      const minH = id === 'minimap' ? 140 : 30;
      const w = Math.max(minW, Math.min(vw - 8, Number(item.w) || base.w));
      const h = Math.max(minH, Math.min(vh - 8, Number(item.h) || base.h));
      const x = Math.max(0, Math.min(vw - 80, Number(item.x) ?? base.x));
      const y = Math.max(0, Math.min(vh - 30, Number(item.y) ?? base.y));
      return {
        visible: item.visible ?? base.visible,
        x,
        y,
        w,
        h,
      };
    };
    return {
      editMode: false,
      hudOpacity:
        typeof parsed.hudOpacity === 'number'
          ? Math.max(0.45, Math.min(1, parsed.hudOpacity))
          : def.hudOpacity,
      compactMode: Boolean(parsed.compactMode),
      widgets: {
        topBar: mergeWidget('topBar'),
        sidebarDock: mergeWidget('sidebarDock'),
        cameraBar: mergeWidget('cameraBar'),
        minimap: mergeWidget('minimap'),
      },
    };
  } catch {
    return def;
  }
}

class HudLayoutStore {
  private config: HudLayoutConfig = loadInitialLayout();
  private listeners = new Set<() => void>();

  public getConfig(): HudLayoutConfig {
    return this.config;
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...this.config, editMode: false }),
      );
    } catch {
      // Ignore storage quota issues
    }
  }

  private emit(): void {
    this.persist();
    for (const fn of this.listeners) fn();
  }

  public updateWidget(id: HudWidgetId, patch: Partial<HudWidgetLayout>): void {
    const cur = this.config.widgets[id];
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const minW = id === 'minimap' ? 140 : 180;
    const minH = id === 'minimap' ? 140 : 30;
    const next: HudWidgetLayout = {
      ...cur,
      ...patch,
    };
    next.w = Math.max(minW, Math.min(vw - 8, next.w));
    next.h = Math.max(minH, Math.min(vh - 8, next.h));
    next.x = Math.max(0, Math.min(vw - 64, next.x));
    next.y = Math.max(0, Math.min(vh - 28, next.y));
    this.config = {
      ...this.config,
      widgets: {
        ...this.config.widgets,
        [id]: next,
      },
    };
    this.emit();
  }

  public setEditMode(editMode: boolean): void {
    this.config = { ...this.config, editMode };
    this.emit();
  }

  public setHudOpacity(opacity: number): void {
    this.config = {
      ...this.config,
      hudOpacity: Math.max(0.45, Math.min(1, opacity)),
    };
    this.emit();
  }

  public setCompactMode(compactMode: boolean): void {
    this.config = { ...this.config, compactMode };
    this.emit();
  }

  public reset(): void {
    this.config = getDefaultHudLayout();
    this.emit();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const hudLayoutStore = new HudLayoutStore();

export function useHudLayout(): HudLayoutConfig {
  const [state, setState] = useState<HudLayoutConfig>(() =>
    hudLayoutStore.getConfig(),
  );
  useEffect(() => hudLayoutStore.subscribe(() => setState(hudLayoutStore.getConfig())), []);
  return state;
}
