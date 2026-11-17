import * as THREE from 'three';
import { SirenPattern } from '../sim/types';
import { ProceduralAudioAsset } from './assetTypes';
import { mulberry32 } from './prng';

interface SirenVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  phase: number;
  autoPhaseOffset: number;
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
  private rainTarget = 0;

  private audioAssets: Record<string, ProceduralAudioAsset>;
  private cachedNoiseBuffers = new Map<string, AudioBuffer>();
  private missingAssetLogged = new Set<string>();

  constructor(audioAssets: Record<string, ProceduralAudioAsset>, defaultEnabled = true) {
    this.audioAssets = audioAssets;
    this.enabled = defaultEnabled;
  }

  public setAudioAssets(audioAssets: Record<string, ProceduralAudioAsset>): void {
    this.audioAssets = audioAssets;
    this.cachedNoiseBuffers.clear();
    this.missingAssetLogged.clear();
  }

  private getGunshotShaperCurve(): Float32Array<ArrayBuffer> {
    if (this.gunshotShaperCurve) return this.gunshotShaperCurve;
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const drive = 3.8;
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
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0.92, this.ctx.currentTime, 0.05);
      }
    } else if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
    compressor.knee.setValueAtTime(10, this.ctx.currentTime);
    compressor.ratio.setValueAtTime(5.5, this.ctx.currentTime);
    compressor.attack.setValueAtTime(0.0015, this.ctx.currentTime);
    compressor.release.setValueAtTime(0.16, this.ctx.currentTime);
    compressor.connect(this.ctx.destination);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.enabled ? 0.92 : 0;
    this.masterGain.connect(compressor);

    // Dry bus
    this.dryBus = this.ctx.createGain();
    this.dryBus.gain.value = 0.95;
    this.dryBus.connect(this.masterGain);

    // Siren / general urban canyon echo bus
    this.echoInput = this.ctx.createGain();
    this.echoInput.gain.value = 0.36;

    const delayA = this.ctx.createDelay(1.0);
    delayA.delayTime.value = 0.145;
    const delayB = this.ctx.createDelay(1.0);
    delayB.delayTime.value = 0.275;

    const echoFilter = this.ctx.createBiquadFilter();
    echoFilter.type = 'lowpass';
    echoFilter.frequency.value = 1650;

    const feedbackGain = this.ctx.createGain();
    feedbackGain.gain.value = 0.28;

    this.echoInput.connect(delayA);
    this.echoInput.connect(delayB);
    delayA.connect(echoFilter);
    delayB.connect(echoFilter);
    echoFilter.connect(feedbackGain);
    feedbackGain.connect(delayA);
    echoFilter.connect(this.masterGain);

    // Dedicated crisp street-canyon multi-tap echo for gunshots
    this.gunshotEchoInput = this.ctx.createGain();
    this.gunshotEchoInput.gain.value = 0.95;

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
    gFeedback.gain.value = 0.42;

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
    this.rainTarget = intensity * 0.14;
    if (this.ctx && this.rainGain) {
      this.rainGain.gain.setTargetAtTime(this.rainTarget, this.ctx.currentTime, 0.25);
    }
  }

  public updateListener(pos: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
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
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 16;
    panner.maxDistance = 320;
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
    };
    this.sirenVoices.set(unitId, voice);
    return voice;
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
    const voice = this.getOrCreateSirenVoice(unitId, unitIdx);
    if (!voice) return;

    const now = this.ctx.currentTime;
    if (!this.enabled || !active) {
      voice.gain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

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
      const step = Math.floor((simTime + voice.autoPhaseOffset) * (spec.hiloAlternationHz ?? 1.55)) % 2;
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

    const now = this.ctx.currentTime;

    if (asset.kind === 'chirp_sequence' && asset.chirp) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = asset.chirp.waveform;
      for (const step of asset.chirp.steps) {
        osc.frequency.setValueAtTime(step.freq, now + step.time);
      }
      gain.gain.setValueAtTime(asset.gain, now);
      gain.gain.exponentialRampToValueAtTime(
        asset.chirp.endGain,
        now + asset.chirp.duration,
      );
      osc.connect(gain);
      gain.connect(this.dryBus);
      osc.start(now);
      osc.stop(now + asset.chirp.duration + 0.01);
      return;
    }

    if (asset.kind === 'filtered_noise_burst' && asset.noiseBurst) {
      const nb = asset.noiseBurst;
      const isGunshot = assetId.startsWith('gunshot_');
      const isRifle = assetId === 'gunshot_rifle';
      const buffer = this.getOrBuildDeterministicBuffer(asset);
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = nb.filterType;
      filter.frequency.setValueAtTime(nb.freqStart, now);
      filter.frequency.exponentialRampToValueAtTime(nb.freqEnd, now + nb.duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(asset.gain, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + nb.duration);

      noise.connect(filter);

      let destinationNode: AudioNode = this.dryBus;
      if (worldPos) {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = isGunshot ? 68 : 22;
        panner.maxDistance = isGunshot ? 520 : 320;
        panner.rolloffFactor = isGunshot ? 0.55 : 1.15;
        panner.setPosition(worldPos.x, worldPos.y + 1.3, worldPos.z);
        panner.connect(this.dryBus);
        if (isGunshot && this.gunshotEchoInput) {
          panner.connect(this.gunshotEchoInput);
        } else {
          panner.connect(this.echoInput);
        }
        destinationNode = panner;
      } else {
        gain.connect(isGunshot && this.gunshotEchoInput ? this.gunshotEchoInput : this.echoInput);
      }

      if (isGunshot) {
        // Soft-saturate gunshot blast for sharp, realistic punch instead of soft filtered noise
        const shaper = this.ctx.createWaveShaper();
        shaper.curve = this.getGunshotShaperCurve();
        filter.connect(shaper);
        shaper.connect(gain);
        gain.connect(destinationNode);
        noise.start(now);

        // 1. Sub/low-mid chest punch (concussion wave)
        const thumpOsc = this.ctx.createOscillator();
        thumpOsc.type = isRifle ? 'sawtooth' : 'triangle';
        thumpOsc.frequency.setValueAtTime(isRifle ? 245 : 190, now);
        thumpOsc.frequency.exponentialRampToValueAtTime(42, now + 0.095);

        const thumpGain = this.ctx.createGain();
        thumpGain.gain.setValueAtTime(asset.gain * (isRifle ? 1.05 : 0.88), now);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        thumpOsc.connect(thumpGain);
        thumpGain.connect(destinationNode);
        thumpOsc.start(now);
        thumpOsc.stop(now + 0.12);

        // 2. Razor-sharp high-frequency supersonic snap impulse (0..26ms)
        const snap = this.ctx.createBufferSource();
        snap.buffer = buffer;
        const snapBp = this.ctx.createBiquadFilter();
        snapBp.type = 'bandpass';
        snapBp.frequency.setValueAtTime(isRifle ? 4400 : 3400, now);
        snapBp.Q.value = 0.7;
        const snapShaper = this.ctx.createWaveShaper();
        snapShaper.curve = this.getGunshotShaperCurve();
        const snapGain = this.ctx.createGain();
        snapGain.gain.setValueAtTime(asset.gain * (isRifle ? 1.35 : 1.15), now);
        snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

        snap.connect(snapBp);
        snapBp.connect(snapShaper);
        snapShaper.connect(snapGain);
        snapGain.connect(destinationNode);
        snap.start(now);
        snap.stop(now + 0.055);
      } else {
        filter.connect(gain);
        gain.connect(destinationNode);
        noise.start(now);
      }
    }
  }

  public playTireBlowoutAt(worldPos: THREE.Vector3): void {
    if (!this.enabled) return;
    if (!this.ctx || this.ctx.state !== 'running' || !this.dryBus || !this.echoInput) return;

    const now = this.ctx.currentTime;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 26;
    panner.maxDistance = 360;
    panner.rolloffFactor = 0.95;
    panner.setPosition(worldPos.x, worldPos.y + 0.45, worldPos.z);
    panner.connect(this.dryBus);
    panner.connect(this.echoInput);

    // 1. Sharp rubber carcass pop
    const popOsc = this.ctx.createOscillator();
    popOsc.type = 'triangle';
    popOsc.frequency.setValueAtTime(240, now);
    popOsc.frequency.exponentialRampToValueAtTime(52, now + 0.085);

    const popGain = this.ctx.createGain();
    popGain.gain.setValueAtTime(0.95, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    popOsc.connect(popGain);
    popGain.connect(panner);
    popOsc.start(now);
    popOsc.stop(now + 0.11);

    // 2. Pressurized tire hiss burst
    const dur = 0.48;
    const sampleRate = this.ctx.sampleRate;
    const len = Math.floor(sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, sampleRate);
    const ch = buf.getChannelData(0);
    const rand = mulberry32(419081);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 1.85);
      ch[i] = (rand() * 2 - 1) * env;
    }

    const hiss = this.ctx.createBufferSource();
    hiss.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, now);
    bp.frequency.exponentialRampToValueAtTime(1400, now + dur);
    bp.Q.value = 0.9;

    const hissGain = this.ctx.createGain();
    hissGain.gain.setValueAtTime(0.55, now);
    hissGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    hiss.connect(bp);
    bp.connect(hissGain);
    hissGain.connect(panner);
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
  }
}
