import * as THREE from 'three';
import { SirenPattern } from '../sim/types';
import { ImportedMediaAsset, ProceduralAudioAsset } from './assetTypes';
import { mulberry32 } from './prng';

export type AudioVoiceQuality = 'low' | 'normal' | 'high';

interface SirenVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  phase: number;
  autoPhaseOffset: number;
  lastActiveTime: number;
}

interface ActivePreviewVoice {
  asset: ProceduralAudioAsset;
  loop: boolean;
  osc1?: OscillatorNode;
  osc2?: OscillatorNode;
  filter?: BiquadFilterNode;
  gain?: GainNode;
  bufferSource?: AudioBufferSourceNode;
  intervalId?: number;
  stopTimeoutId?: number;
  phase: number;
  lastTickMs: number;
  disposed: boolean;
}

const QUALITY_LIMITS: Record<
  AudioVoiceQuality,
  { maxTransients: number; maxSirens: number; echoLevel: number }
> = {
  low: { maxTransients: 6, maxSirens: 2, echoLevel: 0.18 },
  normal: { maxTransients: 12, maxSirens: 4, echoLevel: 0.36 },
  high: { maxTransients: 18, maxSirens: 6, echoLevel: 0.42 },
};

const ASSET_COOLDOWN_MS: Record<string, number> = {
  gunshot_police: 32,
  gunshot_suspect: 32,
  gunshot_rifle: 28,
  vehicle_crash: 90,
  ped_impact: 115,
  tire_blowout: 130,
  dispatch_chirp: 110,
};

function isFiniteVec3(v: THREE.Vector3 | undefined): v is THREE.Vector3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export class JsonAudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private echoInput: GainNode | null = null;
  private gunshotEchoInput: GainNode | null = null;
  private gunshotShaperCurve: Float32Array<ArrayBuffer> | null = null;
  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;

  private sirenVoices = new Map<string, SirenVoice>();
  private enabled = true;
  private masterVolume = 0.85;
  private voiceQuality: AudioVoiceQuality = 'normal';
  private rainTarget = 0;

  private listenerPos = new THREE.Vector3(0, 40, 0);
  private activeTransients = 0;
  private lastPlayedMs = new Map<string, number>();

  private audioAssets: Record<string, ProceduralAudioAsset>;
  private mediaAssets: Record<string, ImportedMediaAsset> = {};
  private decodedAudioBuffers = new Map<string, AudioBuffer>();
  private decodingAudioPromises = new Map<string, Promise<AudioBuffer | null>>();
  private cachedNoiseBuffers = new Map<string, AudioBuffer>();
  private missingAssetLogged = new Set<string>();
  private previewVoice: ActivePreviewVoice | null = null;
  private previewListeners = new Set<() => void>();

  constructor(
    audioAssets: Record<string, ProceduralAudioAsset>,
    defaultEnabled = true,
    mediaAssets: Record<string, ImportedMediaAsset> = {},
  ) {
    this.audioAssets = audioAssets;
    this.mediaAssets = mediaAssets;
    this.enabled = defaultEnabled;
  }

  public setAudioAssets(audioAssets: Record<string, ProceduralAudioAsset>): void {
    this.audioAssets = audioAssets;
    this.cachedNoiseBuffers.clear();
    this.missingAssetLogged.clear();
  }

  public setMediaAssets(mediaAssets: Record<string, ImportedMediaAsset>): void {
    this.mediaAssets = mediaAssets;
    this.decodedAudioBuffers.clear();
    this.decodingAudioPromises.clear();
  }

  public subscribePreviewState(listener: () => void): () => void {
    this.previewListeners.add(listener);
    return () => {
      this.previewListeners.delete(listener);
    };
  }

  private emitPreviewState(): void {
    for (const cb of this.previewListeners) {
      cb();
    }
  }

  public getPreviewState(): { playing: boolean; assetId: string | null; loop: boolean } {
    if (!this.previewVoice || this.previewVoice.disposed) {
      return { playing: false, assetId: null, loop: true };
    }
    return {
      playing: true,
      assetId: this.previewVoice.asset.id,
      loop: this.previewVoice.loop,
    };
  }

  private async decodeMediaAudio(mediaId: string): Promise<AudioBuffer | null> {
    const existing = this.decodedAudioBuffers.get(mediaId);
    if (existing) return existing;

    const inflight = this.decodingAudioPromises.get(mediaId);
    if (inflight) return inflight;

    const media = this.mediaAssets[mediaId];
    if (!media || media.kind !== 'audio') return null;

    this.ensureContext();
    if (!this.ctx) return null;
    const ctx = this.ctx;

    const promise = ctx
      .decodeAudioData(media.bytes.slice().buffer)
      .then((buffer) => {
        this.decodedAudioBuffers.set(mediaId, buffer);
        this.decodingAudioPromises.delete(mediaId);
        return buffer;
      })
      .catch((err) => {
        console.error(`[AUDIO DECODE ERROR] (${mediaId}):`, err);
        this.decodingAudioPromises.delete(mediaId);
        return null;
      });

    this.decodingAudioPromises.set(mediaId, promise);
    return promise;
  }

  private getGunshotShaperCurve(): Float32Array<ArrayBuffer> {
    if (this.gunshotShaperCurve) return this.gunshotShaperCurve;
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const drive = 3.6;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive);
    }
    this.gunshotShaperCurve = curve;
    return curve;
  }

  public unlockOnGesture(): void {
    if (!this.enabled) return;
    this.ensureContext();
    if (this.ctx && this.ctx.state !== 'running') {
      void this.ctx.resume();
    }
  }

  public ensureRunningIfEnabled(): void {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.ensureContext();
      if (this.ctx && this.ctx.state !== 'running') {
        void this.ctx.resume();
      }
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(this.effectiveMasterGain(), this.ctx.currentTime, 0.05);
      }
    } else if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = THREE.MathUtils.clamp(Number.isFinite(volume) ? volume : 0.85, 0, 1);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? this.effectiveMasterGain() : 0,
        this.ctx.currentTime,
        0.04,
      );
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setVoiceQuality(quality: AudioVoiceQuality): void {
    this.voiceQuality = quality;
    const cfg = QUALITY_LIMITS[quality];
    if (this.echoInput && this.ctx) {
      this.echoInput.gain.setTargetAtTime(cfg.echoLevel, this.ctx.currentTime, 0.05);
    }
    for (const v of this.sirenVoices.values()) {
      v.panner.panningModel = quality === 'low' ? 'equalpower' : 'HRTF';
    }
  }

  public getVoiceQuality(): AudioVoiceQuality {
    return this.voiceQuality;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private effectiveMasterGain(): number {
    return 0.92 * this.masterVolume;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
    compressor.knee.setValueAtTime(14, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(6.0, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.002, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.14, this.ctx.currentTime);
    compressor.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.enabled ? this.effectiveMasterGain() : 0;
    this.masterGain.connect(compressor);

    // Dry bus
    this.dryBus = this.ctx.createGain();
    this.dryBus.gain.value = 0.95;
    this.dryBus.connect(this.masterGain);

    // Siren / general urban canyon echo bus
    this.echoInput = this.ctx.createGain();
    this.echoInput.gain.value = QUALITY_LIMITS[this.voiceQuality].echoLevel;

    const delayA = this.ctx.createDelay(1.0);
    delayA.delayTime.value = 0.145;
    const delayB = this.ctx.createDelay(1.0);
    delayB.delayTime.value = 0.275;

    const echoFilter = this.ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1650;

    const feedbackGain = this.ctx.createGain();
    feedbackGain.gain.value = 0.24;

    this.echoInput.connect(delayA);
    this.echoInput.connect(delayB);
    delayA.connect(echoFilter);
    delayB.connect(echoFilter);
    echoFilter.connect(feedbackGain);
    feedbackGain.connect(delayA);
    echoFilter.connect(this.masterGain);

    // Dedicated crisp street-canyon multi-tap echo for gunshots
    this.gunshotEchoInput = this.ctx.createGain();
    this.gunshotEchoInput.gain.value = 0.85;

    const gTap1 = this.ctx.createDelay(1.5);
    gTap1.delayTime.value = 0.115;
    const gTap2 = this.ctx.createDelay(1.5);
    gTap2.delayTime.value = 0.245;
    const gTap3 = this.ctx.createDelay(1.5);
    gTap3.delayTime.value = 0.41;

    const gFilter = this.ctx.createBiquadFilter();
    gFilter.type = 'bandpass';
    gFilter.frequency.value = 1450;
    gFilter.Q.value = 0.65;

    const gFeedback = this.ctx.createGain();
    gFeedback.gain.value = 0.34;

    this.gunshotEchoInput.connect(gTap1);
    this.gunshotEchoInput.connect(gTap2);
    this.gunshotEchoInput.connect(gTap3);
    gTap1.connect(gFilter);
    gTap2.connect(gFilter);
    gTap3.connect(gFilter);
    gFilter.connect(gFeedback);
    gFeedback.connect(gTap2);
    gFilter.connect(this.masterGain);

    // Deterministic Rain Ambience Loop
    const rainLen = Math.floor(this.ctx.sampleRate * 2.0);
    const rainBuf = this.ctx.createBuffer(1, rainLen, this.ctx.sampleRate);
    const rData = rainBuf.getChannelData(0);
    const rainRng = mulberry32(991007);
    let last = 0;
    for (let i = 0; i < rainLen; i++) {
      const white = rainRng() * 2 - 1;
      last = (last + 0.06 * white) / 1.06;
      rData[i] = last * 2.4;
    }
    this.rainSource = this.ctx.createBufferSource();
    this.rainSource.buffer = rainBuf;
    this.rainSource.loop = true;

    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1800;
    rainFilter.Q.value = 0.55;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = this.rainTarget;
    this.rainSource.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    this.rainSource.start();
  }

  public setRainIntensity(intensity: number): void {
    const safeIntensity = Number.isFinite(intensity) ? THREE.MathUtils.clamp(intensity, 0, 1.5) : 0;
    this.rainTarget = safeIntensity * 0.14;
    if (this.ctx && this.rainGain) {
      this.rainGain.gain.setTargetAtTime(this.rainTarget, this.ctx.currentTime, 0.25);
    }
  }

  public updateListener(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    if (!isFiniteVec3(pos) || !isFiniteVec3(forward) || !isFiniteVec3(up)) return;
    this.listenerPos.copy(pos);
    if (!this.ctx || !this.enabled) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private getOrCreateSirenVoice(unitId: string, unitIdx: number): SirenVoice | null {
    if (!this.ctx || !this.dryBus || !this.echoInput) return null;
    const existing = this.sirenVoices.get(unitId);
    if (existing) return existing;

    const panner = this.ctx.createPanner();
    panner.panningModel = this.voiceQuality === 'low' ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 16;
    panner.maxDistance = 300;
    panner.rolloffFactor = 1.25;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1150;
    filter.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 600;

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 603;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.dryBus);
    panner.connect(this.echoInput);

    osc1.start();
    osc2.start();

    const voice: SirenVoice = {
      osc1,
      osc2,
      filter,
      gain,
      panner,
      phase: unitIdx * 0.37,
      autoPhaseOffset: unitIdx * 3.1,
      lastActiveTime: 0,
    };
    this.sirenVoices.set(unitId, voice);
    return voice;
  }

  private activeAudibleSirenCount(): number {
    let count = 0;
    const now = performance.now();
    for (const v of this.sirenVoices.values()) {
      if (now - v.lastActiveTime < 160) count++;
    }
    return count;
  }

  public updateUnitSiren(
    unitId: string,
    unitIdx: number,
    active: boolean,
    worldPos: THREE.Vector3,
    pattern: SirenPattern,
    simTime: number,
    dt: number,
  ): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!isFiniteVec3(worldPos)) return;
    const voice = this.getOrCreateSirenVoice(unitId, unitIdx);
    if (!voice) return;

    const now = this.ctx.currentTime;
    const dist = worldPos.distanceTo(this.listenerPos);
    const maxSirens = QUALITY_LIMITS[this.voiceQuality].maxSirens;
    const nowMs = performance.now();
    const wasRecentlyActive = nowMs - voice.lastActiveTime < 160;
    const overBudget = !wasRecentlyActive && this.activeAudibleSirenCount() >= maxSirens;

    if (!this.enabled || !active || dist > 300 || overBudget) {
      voice.gain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    voice.lastActiveTime = nowMs;

    if (voice.panner.positionX) {
      voice.panner.positionX.setTargetAtTime(worldPos.x, now, 0.03);
      voice.panner.positionY.setTargetAtTime(worldPos.y + 1.6, now, 0.03);
      voice.panner.positionZ.setTargetAtTime(worldPos.z, now, 0.03);
    } else {
      voice.panner.setPosition(worldPos.x, worldPos.y + 1.6, worldPos.z);
    }

    let resolvedPattern = pattern;
    if (pattern === SirenPattern.AutoCycle) {
      const cyclePos = (simTime + voice.autoPhaseOffset) % 14;
      if (cyclePos < 6) resolvedPattern = SirenPattern.Wail;
      else if (cyclePos < 10.5) resolvedPattern = SirenPattern.Yelp;
      else resolvedPattern = SirenPattern.Phaser;
    }

    const assetId =
      resolvedPattern === SirenPattern.Wail
        ? 'siren_standard_wail'
        : resolvedPattern === SirenPattern.Yelp
        ? 'siren_aggressive_yelp'
        : resolvedPattern === SirenPattern.Phaser
        ? 'siren_phaser'
        : 'siren_hilo';

    const asset = this.audioAssets[assetId];
    const spec = asset?.siren;

    let freq = 720;
    if (resolvedPattern === SirenPattern.HiLo && spec) {
      const step =
        Math.floor((simTime + voice.autoPhaseOffset) * (spec.hiloAlternationHz ?? 1.55)) % 2;
      freq = step === 0 ? spec.maxFreq : spec.minFreq;
    } else if (spec) {
      voice.phase += dt * spec.sweepRateHz;
      const saw = voice.phase % 1;
      const tri = saw < 0.45 ? saw / 0.45 : 1 - (saw - 0.45) / 0.55;
      const shaped = 0.5 - 0.5 * Math.cos(tri * Math.PI);
      freq = spec.minFreq + shaped * (spec.maxFreq - spec.minFreq);
    }

    const detune = spec?.detuneRatio ?? 1.004;
    voice.filter.frequency.setTargetAtTime(spec?.bandpassFreq ?? 1150, now, 0.04);
    voice.osc1.frequency.setTargetAtTime(freq, now, 0.02);
    voice.osc2.frequency.setTargetAtTime(freq * detune, now, 0.02);
    voice.gain.gain.setTargetAtTime(asset?.gain ?? 0.22, now, 0.05);
  }

  private canSpawnTransient(key: string, worldPos?: THREE.Vector3, maxDistance = 320): boolean {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return false;
    if (worldPos) {
      if (!isFiniteVec3(worldPos)) return false;
      if (worldPos.distanceTo(this.listenerPos) > maxDistance) return false;
    }
    const maxVoices = QUALITY_LIMITS[this.voiceQuality].maxTransients;
    if (this.activeTransients >= maxVoices) return false;

    const cooldown = ASSET_COOLDOWN_MS[key] ?? 45;
    const nowMs = performance.now();
    const prev = this.lastPlayedMs.get(key) ?? 0;
    if (nowMs - prev < cooldown) return false;
    this.lastPlayedMs.set(key, nowMs);
    return true;
  }

  private trackTransientCleanup(source: AudioScheduledSourceNode, nodesToDisconnect: AudioNode[]): void {
    this.activeTransients++;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeTransients = Math.max(0, this.activeTransients - 1);
      for (const n of nodesToDisconnect) {
        try {
          n.disconnect();
        } catch {
          // already disconnected
        }
      }
    };
    source.onended = cleanup;
    window.setTimeout(cleanup, 1400);
  }

  public upsertAudioAsset(id: string, asset: ProceduralAudioAsset): void {
    this.audioAssets[id] = asset;
    this.cachedNoiseBuffers.delete(id);
    this.missingAssetLogged.delete(id);
  }

  private scheduleTransientOnce(asset: ProceduralAudioAsset): number {
    if (!this.ctx || !this.dryBus || !this.echoInput) return 0.25;
    const now = this.ctx.currentTime;
    const g = THREE.MathUtils.clamp(asset.gain || 0.25, 0.02, 1.0);

    if (asset.kind === 'chirp_sequence' && asset.chirp) {
      const dur = Math.max(0.06, asset.chirp.duration || 0.25);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = asset.chirp.waveform ?? 'triangle';
      for (const step of asset.chirp.steps) {
        osc.frequency.setValueAtTime(Math.max(40, step.freq), now + Math.max(0, step.time));
      }
      gain.gain.setValueAtTime(Math.max(0.01, g), now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, asset.chirp.endGain || 0.005),
        now + dur,
      );
      osc.connect(gain);
      gain.connect(this.dryBus);
      this.trackTransientCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      return dur;
    }

    if (asset.kind === 'filtered_noise_burst' && asset.noiseBurst) {
      const nb = asset.noiseBurst;
      const dur = Math.max(0.04, nb.duration || 0.25);
      const sampleRate = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, sampleRate);
      const data = buf.getChannelData(0);
      const rand = mulberry32(asset.seed || 1001);
      const exp = nb.envelope.curveExponent ?? 2.8;
      for (let i = 0; i < len; i++) {
        data[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, exp);
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = nb.filterType ?? 'bandpass';
      filter.frequency.setValueAtTime(Math.max(20, nb.freqStart), now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, nb.freqEnd), now + dur);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0.01, g), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.dryBus);
      gain.connect(this.echoInput);
      this.trackTransientCleanup(noise, [noise, filter, gain]);
      noise.start(now);
      return dur;
    }

    return 0.25;
  }

  public stopAudioPreview(): void {
    const pv = this.previewVoice;
    if (!pv) return;
    pv.disposed = true;
    if (pv.intervalId !== undefined) window.clearInterval(pv.intervalId);
    if (pv.stopTimeoutId !== undefined) window.clearTimeout(pv.stopTimeoutId);

    for (const node of [pv.osc1, pv.osc2, pv.bufferSource]) {
      if (!node) continue;
      try {
        node.stop();
      } catch {
        // already stopped
      }
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    for (const node of [pv.filter, pv.gain]) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }

    this.previewVoice = null;
    this.emitPreviewState();
  }

  public startAudioPreview(asset: ProceduralAudioAsset, loop = true): void {
    this.stopAudioPreview();
    this.ensureContext();
    if (!this.ctx || !this.dryBus || !this.echoInput) return;
    if (this.ctx.state !== 'running') {
      void this.ctx.resume();
    }
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.effectiveMasterGain(), this.ctx.currentTime, 0.03);
    }

    const clonedAsset: ProceduralAudioAsset = JSON.parse(JSON.stringify(asset));
    const voice: ActivePreviewVoice = {
      asset: clonedAsset,
      loop,
      phase: 0,
      lastTickMs: performance.now(),
      disposed: false,
    };
    this.previewVoice = voice;
    this.emitPreviewState();

    const g = THREE.MathUtils.clamp(clonedAsset.gain || 0.25, 0.02, 1.0);

    if ((clonedAsset.kind === 'siren_sweep' || clonedAsset.kind === 'siren_hilo') && clonedAsset.siren) {
      const spec = clonedAsset.siren;
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc1.type = spec.waveform1 ?? 'sawtooth';
      osc2.type = spec.waveform2 ?? 'triangle';
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(Math.max(60, spec.bandpassFreq || 1150), now);
      filter.Q.setValueAtTime(Math.max(0.2, spec.bandpassQ || 1.4), now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(g, now + 0.04);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.dryBus);
      gain.connect(this.echoInput);
      osc1.start(now);
      osc2.start(now);

      voice.osc1 = osc1;
      voice.osc2 = osc2;
      voice.filter = filter;
      voice.gain = gain;

      const stepModulation = () => {
        if (voice.disposed || !this.ctx || !voice.osc1 || !voice.osc2 || !voice.filter || !voice.gain) {
          return;
        }
        const curMs = performance.now();
        const dt = Math.min(0.1, Math.max(0.001, (curMs - voice.lastTickMs) / 1000));
        voice.lastTickMs = curMs;
        const s = voice.asset.siren;
        if (!s) return;

        const t = this.ctx.currentTime;
        let freq = s.minFreq;
        if (voice.asset.kind === 'siren_hilo') {
          voice.phase += dt * (s.hiloAlternationHz ?? 1.55);
          const idx = Math.floor(voice.phase) % 2;
          freq = idx === 0 ? s.maxFreq : s.minFreq;
        } else {
          voice.phase += dt * Math.max(0.05, s.sweepRateHz || 0.35);
          const saw = voice.phase % 1;
          const tri = saw < 0.45 ? saw / 0.45 : 1 - (saw - 0.45) / 0.55;
          const shaped = 0.5 - 0.5 * Math.cos(tri * Math.PI);
          freq = s.minFreq + shaped * (s.maxFreq - s.minFreq);
        }

        if (voice.osc1.type !== s.waveform1) voice.osc1.type = s.waveform1;
        if (voice.osc2.type !== s.waveform2) voice.osc2.type = s.waveform2;
        voice.filter.frequency.setTargetAtTime(Math.max(60, s.bandpassFreq || 1150), t, 0.03);
        voice.filter.Q.setTargetAtTime(Math.max(0.2, s.bandpassQ || 1.4), t, 0.03);
        voice.osc1.frequency.setTargetAtTime(Math.max(40, freq), t, 0.015);
        voice.osc2.frequency.setTargetAtTime(
          Math.max(40, freq * (s.detuneRatio || 1.004)),
          t,
          0.015,
        );
        voice.gain.gain.setTargetAtTime(
          THREE.MathUtils.clamp(voice.asset.gain || 0.25, 0.02, 1.0),
          t,
          0.03,
        );
      };

      stepModulation();
      voice.intervalId = window.setInterval(stepModulation, 25);

      if (!loop) {
        const cycleDurMs =
          clonedAsset.kind === 'siren_hilo'
            ? Math.round((2 / Math.max(0.25, spec.hiloAlternationHz ?? 1.55)) * 1000)
            : Math.round((1 / Math.max(0.15, spec.sweepRateHz || 0.35)) * 1000);
        voice.stopTimeoutId = window.setTimeout(() => {
          this.stopAudioPreview();
        }, Math.min(6000, Math.max(1200, cycleDurMs)));
      }
      return;
    }

    if (clonedAsset.kind === 'audio_clip' && clonedAsset.clip?.mediaId) {
      const mediaId = clonedAsset.clip.mediaId;
      void this.decodeMediaAudio(mediaId).then((buf) => {
        if (voice.disposed || !buf || !this.ctx || !this.dryBus) {
          if (!voice.disposed && !buf) this.stopAudioPreview();
          return;
        }
        const now = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = voice.loop;
        src.playbackRate.setValueAtTime(
          THREE.MathUtils.clamp(voice.asset.clip?.playbackRate ?? 1.0, 0.25, 4.0),
          now,
        );
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(
          THREE.MathUtils.clamp(voice.asset.gain || 0.5, 0.02, 1.0),
          now,
        );
        src.connect(gain);
        gain.connect(this.dryBus);
        voice.bufferSource = src;
        voice.gain = gain;
        src.onended = () => {
          if (!voice.disposed && !voice.loop) {
            this.stopAudioPreview();
          }
        };
        src.start(now);
      });
      return;
    }

    // Transient assets (chirp_sequence / filtered_noise_burst)
    const firstDur = this.scheduleTransientOnce(clonedAsset);
    if (!loop) {
      voice.stopTimeoutId = window.setTimeout(() => {
        this.stopAudioPreview();
      }, Math.max(140, Math.round(firstDur * 1000 + 80)));
      return;
    }

    const triggerRepeat = () => {
      if (voice.disposed) return;
      const d = this.scheduleTransientOnce(voice.asset);
      const waitMs = Math.max(220, Math.round((d + 0.24) * 1000));
      voice.stopTimeoutId = window.setTimeout(triggerRepeat, waitMs);
    };
    voice.stopTimeoutId = window.setTimeout(
      triggerRepeat,
      Math.max(220, Math.round((firstDur + 0.24) * 1000)),
    );
  }

  public updateAudioPreview(asset: ProceduralAudioAsset, loop?: boolean): void {
    const pv = this.previewVoice;
    if (!pv || pv.disposed) return;
    const prevKind = pv.asset.kind;
    const prevLoop = pv.loop;
    const prevMedia = pv.asset.clip?.mediaId;
    const nextLoop = loop !== undefined ? loop : prevLoop;
    pv.asset = JSON.parse(JSON.stringify(asset));
    pv.loop = nextLoop;

    if (
      prevKind !== asset.kind ||
      prevLoop !== nextLoop ||
      prevMedia !== asset.clip?.mediaId
    ) {
      this.startAudioPreview(pv.asset, nextLoop);
      return;
    }

    if (pv.bufferSource && pv.gain && this.ctx && asset.clip) {
      const t = this.ctx.currentTime;
      pv.bufferSource.playbackRate.setTargetAtTime(
        THREE.MathUtils.clamp(asset.clip.playbackRate ?? 1.0, 0.25, 4.0),
        t,
        0.02,
      );
      pv.gain.gain.setTargetAtTime(
        THREE.MathUtils.clamp(asset.gain || 0.5, 0.02, 1.0),
        t,
        0.02,
      );
    }
  }

  public previewAudioAsset(asset: ProceduralAudioAsset, loop = true): number {
    this.startAudioPreview(asset, loop);
    if (asset.kind === 'chirp_sequence') return asset.chirp?.duration ?? 0.25;
    if (asset.kind === 'filtered_noise_burst') return asset.noiseBurst?.duration ?? 0.25;
    return 1.65;
  }

  public playAssetAt(assetId: string, worldPos?: THREE.Vector3): void {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state !== 'running' || !this.dryBus || !this.echoInput) return;

    const asset = this.audioAssets[assetId];
    if (!asset) {
      if (!this.missingAssetLogged.has(assetId)) {
        this.missingAssetLogged.add(assetId);
        console.error(`[MISSING AUDIO] Audio asset "${assetId}" missing from pack.`);
      }
      return;
    }

    const isGunshot = assetId.startsWith('gunshot_');
    const maxDist = isGunshot ? 520 : 260;
    if (!this.canSpawnTransient(assetId, worldPos, maxDist)) return;

    const now = this.ctx.currentTime;

    if (asset.kind === 'audio_clip' && asset.clip?.mediaId) {
      const cached = this.decodedAudioBuffers.get(asset.clip.mediaId);
      if (!cached) {
        void this.decodeMediaAudio(asset.clip.mediaId);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = cached;
      src.playbackRate.setValueAtTime(
        THREE.MathUtils.clamp(asset.clip.playbackRate ?? 1.0, 0.25, 4.0),
        now,
      );
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0.01, asset.gain), now);
      src.connect(gain);

      const nodesToDisconnect: AudioNode[] = [src, gain];
      if (worldPos) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = 24;
        panner.maxDistance = maxDist;
        panner.rolloffFactor = 1.1;
        panner.setPosition(worldPos.x, worldPos.y + 1.2, worldPos.z);
        gain.connect(panner);
        panner.connect(this.dryBus);
        nodesToDisconnect.push(panner);
      } else {
        gain.connect(this.dryBus);
      }
      this.trackTransientCleanup(src, nodesToDisconnect);
      src.start(now);
      return;
    }

    if (asset.kind === 'chirp_sequence' && asset.chirp) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = asset.chirp.waveform;
      for (const step of asset.chirp.steps) {
        osc.frequency.setValueAtTime(step.freq, now + step.time);
      }
      gain.gain.setValueAtTime(Math.max(0.01, asset.gain), now);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, asset.chirp.endGain),
        now + asset.chirp.duration,
      );
      osc.connect(gain);
      gain.connect(this.dryBus);
      this.trackTransientCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + asset.chirp.duration + 0.015);
      return;
    }

    if (asset.kind === 'filtered_noise_burst' && asset.noiseBurst) {
      const nb = asset.noiseBurst;
      const isRifle = assetId === 'gunshot_rifle';
      const buffer = this.getOrBuildDeterministicBuffer(asset);
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = nb.filterType;
      filter.frequency.setValueAtTime(Math.max(20, nb.freqStart), now);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, nb.freqEnd),
        now + Math.max(0.02, nb.duration),
      );

      // Slight gain scaling when many voices overlap avoids harsh compressor ducking
      const overlapAtten = this.activeTransients > 6 ? 0.72 : 1.0;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0.005, asset.gain * overlapAtten), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.02, nb.duration));

      noise.connect(filter);

      const nodesToDisconnect: AudioNode[] = [noise, filter, gain];
      let destinationNode: AudioNode = this.dryBus;

      if (worldPos) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = isGunshot ? 68 : 22;
        panner.maxDistance = maxDist;
        panner.rolloffFactor = isGunshot ? 0.55 : 1.15;
        panner.setPosition(worldPos.x, worldPos.y + 1.3, worldPos.z);
        panner.connect(this.dryBus);
        if (isGunshot && this.gunshotEchoInput) {
          panner.connect(this.gunshotEchoInput);
        } else {
          panner.connect(this.echoInput);
        }
        nodesToDisconnect.push(panner);
        destinationNode = panner;
      } else {
        gain.connect(isGunshot && this.gunshotEchoInput ? this.gunshotEchoInput : this.echoInput);
      }

      if (isGunshot) {
        const shaper = this.ctx.createWaveShaper();
        shaper.curve = this.getGunshotShaperCurve();
        filter.connect(shaper);
        shaper.connect(gain);
        gain.connect(destinationNode);
        nodesToDisconnect.push(shaper);

        // Concussion wave + supersonic snap only on normal/high voice quality or low load
        if (this.voiceQuality !== 'low' && this.activeTransients < QUALITY_LIMITS[this.voiceQuality].maxTransients - 2) {
          const thumpOsc = this.ctx.createOscillator();
          thumpOsc.type = isRifle ? 'sawtooth' : 'triangle';
          thumpOsc.frequency.setValueAtTime(isRifle ? 245 : 190, now);
          thumpOsc.frequency.exponentialRampToValueAtTime(42, now + 0.095);

          const thumpGain = this.ctx.createGain();
          thumpGain.gain.setValueAtTime(asset.gain * overlapAtten * (isRifle ? 0.95 : 0.8), now);
          thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
          thumpOsc.connect(thumpGain);
          thumpGain.connect(destinationNode);
          nodesToDisconnect.push(thumpOsc, thumpGain);
          thumpOsc.start(now);
          thumpOsc.stop(now + 0.12);

          const snap = this.ctx.createBufferSource();
          snap.buffer = buffer;
          const snapBp = this.ctx.createBiquadFilter();
          snapBp.type = 'bandpass';
          snapBp.frequency.setValueAtTime(isRifle ? 4400 : 3400, now);
          snapBp.Q.value = 0.7;
          const snapShaper = this.ctx.createWaveShaper();
          snapShaper.curve = this.getGunshotShaperCurve();
          const snapGain = this.ctx.createGain();
          snapGain.gain.setValueAtTime(asset.gain * overlapAtten * (isRifle ? 1.15 : 0.98), now);
          snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

          snap.connect(snapBp);
          snapBp.connect(snapShaper);
          snapShaper.connect(snapGain);
          snapGain.connect(destinationNode);
          nodesToDisconnect.push(snap, snapBp, snapShaper, snapGain);
          snap.start(now);
          snap.stop(now + 0.055);
        }

        this.trackTransientCleanup(noise, nodesToDisconnect);
        noise.start(now);
      } else {
        filter.connect(gain);
        gain.connect(destinationNode);
        this.trackTransientCleanup(noise, nodesToDisconnect);
        noise.start(now);
      }
    }
  }

  public playTireBlowoutAt(worldPos: THREE.Vector3): void {
    if (!this.canSpawnTransient('tire_blowout', worldPos, 320)) return;
    if (!this.ctx || this.ctx.state !== 'running' || !this.dryBus || !this.echoInput) return;

    const now = this.ctx.currentTime;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 26;
    panner.maxDistance = 320;
    panner.rolloffFactor = 0.95;
    panner.setPosition(worldPos.x, worldPos.y + 0.45, worldPos.z);
    panner.connect(this.dryBus);
    panner.connect(this.echoInput);

    const popOsc = this.ctx.createOscillator();
    popOsc.type = 'triangle';
    popOsc.frequency.setValueAtTime(240, now);
    popOsc.frequency.exponentialRampToValueAtTime(52, now + 0.085);

    const popGain = this.ctx.createGain();
    popGain.gain.setValueAtTime(0.9, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    popOsc.connect(popGain);
    popGain.connect(panner);
    popOsc.start(now);
    popOsc.stop(now + 0.11);

    const dur = 0.46;
    let buf = this.cachedNoiseBuffers.get('__tire_hiss__');
    if (!buf) {
      const sampleRate = this.ctx.sampleRate;
      const len = Math.floor(sampleRate * dur);
      buf = this.ctx.createBuffer(1, len, sampleRate);
      const ch = buf.getChannelData(0);
      const rand = mulberry32(419081);
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, 1.85);
        ch[i] = (rand() * 2 - 1) * env;
      }
      this.cachedNoiseBuffers.set('__tire_hiss__', buf);
    }

    const hiss = this.ctx.createBufferSource();
    hiss.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, now);
    bp.frequency.exponentialRampToValueAtTime(1400, now + dur);
    bp.Q.value = 0.9;

    const hissGain = this.ctx.createGain();
    hissGain.gain.setValueAtTime(0.52, now);
    hissGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    hiss.connect(bp);
    bp.connect(hissGain);
    hissGain.connect(panner);
    this.trackTransientCleanup(hiss, [popOsc, popGain, hiss, bp, hissGain, panner]);
    hiss.start(now);
  }

  private getOrBuildDeterministicBuffer(asset: ProceduralAudioAsset): AudioBuffer {
    const cached = this.cachedNoiseBuffers.get(asset.id);
    if (cached) return cached;

    const ctx = this.ctx!;
    const nb = asset.noiseBurst!;
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * nb.duration));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const rand = mulberry32(asset.seed);
    const exp = nb.envelope.curveExponent ?? 2.8;
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, exp);
      data[i] = (rand() * 2 - 1) * env;
    }

    this.cachedNoiseBuffers.set(asset.id, buffer);
    return buffer;
  }

  public dispose(): void {
    this.stopAudioPreview();
    this.previewListeners.clear();
    this.sirenVoices.clear();
    if (this.rainSource) {
      try {
        this.rainSource.stop();
      } catch {
        // ignore if already stopped
      }
      this.rainSource = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.cachedNoiseBuffers.clear();
    this.decodedAudioBuffers.clear();
    this.decodingAudioPromises.clear();
  }
}
