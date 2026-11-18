import { useSyncExternalStore } from 'react';
import { KeybindActionId } from '../assets/assetTypes';

export interface KeybindMeta {
  id: KeybindActionId;
  label: string;
  category: 'Simulation' | 'Camera Mode' | 'Camera Movement';
  defaultCode: string;
}

export const KEYBIND_ACTIONS: KeybindMeta[] = [
  { id: 'toggleHud', label: 'Toggle Sidebar / HUD', category: 'Simulation', defaultCode: 'KeyH' },
  { id: 'spawnCrime', label: 'Trigger Foot Crime', category: 'Simulation', defaultCode: 'Space' },
  { id: 'spawnPursuit', label: 'Trigger Vehicle Pursuit', category: 'Simulation', defaultCode: 'KeyP' },

  { id: 'cameraReset', label: 'Reset Overview Camera', category: 'Camera Mode', defaultCode: 'Digit0' },
  { id: 'cameraOverview', label: 'Overview Camera', category: 'Camera Mode', defaultCode: 'Digit1' },
  { id: 'cameraFreeFly', label: 'Free Fly Camera', category: 'Camera Mode', defaultCode: 'Digit2' },
  { id: 'cameraFollow', label: 'Follow Unit Camera', category: 'Camera Mode', defaultCode: 'Digit3' },
  { id: 'cameraLightbar', label: 'Lightbar View Camera', category: 'Camera Mode', defaultCode: 'Digit4' },

  { id: 'camForward', label: 'Pan / Move Forward', category: 'Camera Movement', defaultCode: 'KeyW' },
  { id: 'camBackward', label: 'Pan / Move Backward', category: 'Camera Movement', defaultCode: 'KeyS' },
  { id: 'camLeft', label: 'Pan / Strafe Left', category: 'Camera Movement', defaultCode: 'KeyA' },
  { id: 'camRight', label: 'Pan / Strafe Right', category: 'Camera Movement', defaultCode: 'KeyD' },
  { id: 'camOrbitLeft', label: 'Orbit / Yaw Left', category: 'Camera Movement', defaultCode: 'KeyQ' },
  { id: 'camOrbitRight', label: 'Orbit / Yaw Right', category: 'Camera Movement', defaultCode: 'KeyE' },
  { id: 'camUp', label: 'Move Altitude Up', category: 'Camera Movement', defaultCode: 'KeyR' },
  { id: 'camDown', label: 'Move Altitude Down', category: 'Camera Movement', defaultCode: 'KeyF' },
  { id: 'camZoomIn', label: 'Zoom In', category: 'Camera Movement', defaultCode: 'KeyZ' },
  { id: 'camZoomOut', label: 'Zoom Out', category: 'Camera Movement', defaultCode: 'KeyX' },
];

export const DEFAULT_KEYBINDS: Record<KeybindActionId, string> = KEYBIND_ACTIONS.reduce(
  (acc, item) => {
    acc[item.id] = item.defaultCode;
    return acc;
  },
  {} as Record<KeybindActionId, string>,
);

const STORAGE_KEY = 'metro_precinct_user_keybinds_v1';

function loadStoredOverrides(): Partial<Record<KeybindActionId, string>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Partial<Record<KeybindActionId, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim() && k in DEFAULT_KEYBINDS) {
        clean[k as KeybindActionId] = v.trim();
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function formatKeyCode(code: string): string {
  if (!code) return 'Unbound';
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code === 'Space') return 'Space';
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

class KeybindStore {
  private packDefaults: Partial<Record<KeybindActionId, string>> = {};
  private userOverrides: Partial<Record<KeybindActionId, string>> = loadStoredOverrides();
  private listeners = new Set<() => void>();
  private snapshotCache: Record<KeybindActionId, string> = { ...DEFAULT_KEYBINDS };

  constructor() {
    this.rebuildCache();
  }

  private rebuildCache(): void {
    this.snapshotCache = {
      ...DEFAULT_KEYBINDS,
      ...this.packDefaults,
      ...this.userOverrides,
    };
  }

  private emit(): void {
    this.rebuildCache();
    for (const fn of this.listeners) fn();
  }

  public applyPackDefaults(packKeybinds?: Partial<Record<KeybindActionId, string>>): void {
    this.packDefaults = packKeybinds ? { ...packKeybinds } : {};
    this.emit();
  }

  public getCode(actionId: KeybindActionId): string {
    return this.snapshotCache[actionId] ?? DEFAULT_KEYBINDS[actionId];
  }

  public getAll = (): Record<KeybindActionId, string> => {
    return this.snapshotCache;
  };

  public getUserOverrides(): Partial<Record<KeybindActionId, string>> {
    return { ...this.userOverrides };
  }

  public setUserOverride(actionId: KeybindActionId, code: string): void {
    this.userOverrides[actionId] = code;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userOverrides));
    } catch {
      // ignore storage errors
    }
    this.emit();
  }

  public clearUserOverride(actionId: KeybindActionId): void {
    delete this.userOverrides[actionId];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userOverrides));
    } catch {
      // ignore storage errors
    }
    this.emit();
  }

  public resetAllToDefaults(): void {
    this.userOverrides = {};
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    this.emit();
  }

  public matchesEvent(e: KeyboardEvent, actionId: KeybindActionId): boolean {
    const code = this.getCode(actionId);
    if (!code) return false;
    return e.code === code;
  }

  public isActionHeld(heldKeys: Set<string>, actionId: KeybindActionId): boolean {
    const code = this.getCode(actionId);
    if (code && heldKeys.has(code)) return true;
    // Allow arrow keys as ergonomic secondary fallback when movement uses default WASD
    if (actionId === 'camForward' && code === 'KeyW' && heldKeys.has('ArrowUp')) return true;
    if (actionId === 'camBackward' && code === 'KeyS' && heldKeys.has('ArrowDown')) return true;
    if (actionId === 'camLeft' && code === 'KeyA' && heldKeys.has('ArrowLeft')) return true;
    if (actionId === 'camRight' && code === 'KeyD' && heldKeys.has('ArrowRight')) return true;
    return false;
  }

  public subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export const keybindStore = new KeybindStore();

export function useKeybinds(): Record<KeybindActionId, string> {
  return useSyncExternalStore(keybindStore.subscribe, keybindStore.getAll, keybindStore.getAll);
}
