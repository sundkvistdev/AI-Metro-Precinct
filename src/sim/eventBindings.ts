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

class EventBindingStore {
  private packDefaults: Partial<Record<SimEventId, EventBindingDef>> = {};
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
      next[id] = {
        audioId: pack?.audioId ?? base.audioId,
        gainScale: pack?.gainScale ?? base.gainScale ?? 1,
        enabled: pack?.enabled ?? base.enabled ?? true,
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
  const pack = config?.eventBindings?.[eventId];
  const def = DEFAULT_EVENT_BINDINGS[eventId];
  return {
    audioId: pack?.audioId ?? def.audioId,
    gainScale: pack?.gainScale ?? def.gainScale ?? 1,
    enabled: pack?.enabled ?? def.enabled ?? true,
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
