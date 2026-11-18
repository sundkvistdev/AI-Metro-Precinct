import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  EngineConfigAsset,
  EventBindingDef,
  SimEventId,
} from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';

export interface SimEventMeta {
  id: SimEventId;
  label: string;
  category: 'Combat' | 'Collision' | 'Dispatch' | 'Sirens';
  defaultAudioId: string;
}

export const SIM_EVENT_DEFINITIONS: SimEventMeta[] = [
  { id: 'weapon_fire_pistol', label: 'Police Pistol Fire', category: 'Combat', defaultAudioId: 'gunshot_police' },
  { id: 'weapon_fire_rifle', label: 'SWAT / Officer Rifle Fire', category: 'Combat', defaultAudioId: 'gunshot_rifle' },
  { id: 'weapon_fire_suspect', label: 'Assailant Weapon Fire', category: 'Combat', defaultAudioId: 'gunshot_suspect' },
  { id: 'ped_impact', label: 'Humanoid / Ragdoll Impact', category: 'Collision', defaultAudioId: 'ped_impact' },
  { id: 'vehicle_crash', label: 'Vehicle Collision', category: 'Collision', defaultAudioId: 'vehicle_crash' },
  { id: 'dispatch_chirp', label: 'Radio Dispatch Chirp', category: 'Dispatch', defaultAudioId: 'dispatch_chirp' },
  { id: 'siren_wail', label: 'Siren: Wail', category: 'Sirens', defaultAudioId: 'siren_standard_wail' },
  { id: 'siren_yelp', label: 'Siren: Yelp', category: 'Sirens', defaultAudioId: 'siren_aggressive_yelp' },
  { id: 'siren_phaser', label: 'Siren: Phaser', category: 'Sirens', defaultAudioId: 'siren_phaser' },
  { id: 'siren_hilo', label: 'Siren: Hi-Lo', category: 'Sirens', defaultAudioId: 'siren_hilo' },
];

export const DEFAULT_EVENT_BINDINGS: Record<SimEventId, EventBindingDef> =
  SIM_EVENT_DEFINITIONS.reduce((acc, item) => {
    acc[item.id] = { audioId: item.defaultAudioId, gainScale: 1, enabled: true };
    return acc;
  }, {} as Record<SimEventId, EventBindingDef>);

const STORAGE_KEY = 'metro_precinct_event_bindings_v1';

function loadUserOverrides(): Partial<Record<SimEventId, EventBindingDef>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<Record<SimEventId, EventBindingDef>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k in DEFAULT_EVENT_BINDINGS && v && typeof v === 'object') {
        const rec = v as Record<string, unknown>;
        if (typeof rec.audioId === 'string') {
          out[k as SimEventId] = {
            audioId: rec.audioId,
            gainScale: typeof rec.gainScale === 'number' ? rec.gainScale : 1,
            enabled: typeof rec.enabled === 'boolean' ? rec.enabled : true,
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

class EventBindingStore {
  private packDefaults: Partial<Record<SimEventId, EventBindingDef>> = {};
  private userOverrides: Partial<Record<SimEventId, EventBindingDef>> = loadUserOverrides();
  private cache: Record<SimEventId, EventBindingDef> = { ...DEFAULT_EVENT_BINDINGS };
  private listeners = new Set<() => void>();

  constructor() {
    this.rebuild();
  }

  private rebuild(): void {
    const next: Record<SimEventId, EventBindingDef> = { ...DEFAULT_EVENT_BINDINGS };
    for (const id of Object.keys(DEFAULT_EVENT_BINDINGS) as SimEventId[]) {
      const base = DEFAULT_EVENT_BINDINGS[id];
      const pack = this.packDefaults[id];
      const user = this.userOverrides[id];
      next[id] = {
        audioId: user?.audioId ?? pack?.audioId ?? base.audioId,
        gainScale: user?.gainScale ?? pack?.gainScale ?? base.gainScale ?? 1,
        enabled: user?.enabled ?? pack?.enabled ?? base.enabled ?? true,
      };
    }
    this.cache = next;
  }

  private emit(): void {
    this.rebuild();
    for (const fn of this.listeners) fn();
  }

  public applyPackDefaults(bindings?: Partial<Record<SimEventId, EventBindingDef>>): void {
    this.packDefaults = bindings ? { ...bindings } : {};
    this.emit();
  }

  public getAll = (): Record<SimEventId, EventBindingDef> => {
    return this.cache;
  };

  public getUserOverrides(): Partial<Record<SimEventId, EventBindingDef>> {
    return { ...this.userOverrides };
  }

  public setUserOverride(eventId: SimEventId, binding: EventBindingDef): void {
    this.userOverrides[eventId] = { ...binding };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userOverrides));
    } catch {
      // ignore storage errors
    }
    this.emit();
  }

  public resetAll(): void {
    this.userOverrides = {};
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    this.emit();
  }

  public subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export const eventBindingStore = new EventBindingStore();

export function useEventBindings(): Record<SimEventId, EventBindingDef> {
  return useSyncExternalStore(
    eventBindingStore.subscribe,
    eventBindingStore.getAll,
    eventBindingStore.getAll,
  );
}

export function resolveEventAudio(
  eventId: SimEventId,
  config?: EngineConfigAsset | null,
): EventBindingDef {
  const userOverrides = eventBindingStore.getUserOverrides();
  const user = userOverrides[eventId];
  const pack = config?.eventBindings?.[eventId];
  const def = DEFAULT_EVENT_BINDINGS[eventId];
  return {
    audioId: user?.audioId ?? pack?.audioId ?? def.audioId,
    gainScale: user?.gainScale ?? pack?.gainScale ?? def.gainScale ?? 1,
    enabled: user?.enabled ?? pack?.enabled ?? def.enabled ?? true,
  };
}

export function playBoundAudioEvent(
  audio: JsonAudioSynth | null | undefined,
  config: EngineConfigAsset | null | undefined,
  eventId: SimEventId,
  worldPos?: THREE.Vector3,
): void {
  if (!audio) return;
  const binding = resolveEventAudio(eventId, config);
  if (binding.enabled === false || !binding.audioId) return;
  audio.playAssetAt(binding.audioId, worldPos, binding.gainScale);
}
