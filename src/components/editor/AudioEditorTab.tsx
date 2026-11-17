import React, { useMemo, useRef, useState } from 'react';
import { Download, Play, Plus, Trash2, Upload } from 'lucide-react';
import { ProceduralAudioAsset } from '../../assets/assetTypes';
import { mulberry32 } from '../../assets/prng';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { downloadJsonText, readFileAsText } from './editorFileUtils';

export interface AudioEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

function buildWaveformPath(asset: ProceduralAudioAsset | null): string {
  if (!asset) return 'M 0 24 L 240 24';
  const samples = 64;
  const w = 240;
  const h = 48;
  const mid = h / 2;
  const rng = mulberry32(asset.seed || 42);
  const pts: string[] = [];

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    let amp = 0;
    if (asset.kind === 'filtered_noise_burst' && asset.noiseBurst) {
      const exp = asset.noiseBurst.envelope.curveExponent ?? 2.8;
      amp = Math.pow(1 - t, exp) * (rng() * 2 - 1);
    } else if (asset.kind === 'siren_hilo' && asset.siren) {
      const hi = Math.floor(t * 4) % 2 === 0;
      amp = Math.sin(t * Math.PI * (hi ? 26 : 16)) * 0.78;
    } else if (asset.kind === 'siren_sweep' && asset.siren) {
      const mod = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      amp = Math.sin(t * Math.PI * (12 + mod * 18)) * 0.78;
    } else if (asset.kind === 'chirp_sequence' && asset.chirp) {
      amp = Math.sin(t * Math.PI * 20) * (1 - t * 0.65) * 0.75;
    }
    const x = (t * w).toFixed(1);
    const y = (mid - amp * (h * 0.42)).toFixed(1);
    pts.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  return pts.join(' ');
}

export const AudioEditorTab: React.FC<AudioEditorTabProps> = ({
  controller,
  state,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newAudioName, setNewAudioName] = useState('custom_fx');
  const [newKind, setNewKind] = useState<ProceduralAudioAsset['kind']>('chirp_sequence');
  const [importError, setImportError] = useState<string | null>(null);

  const aud = state.selectedAudio;
  const wavePath = useMemo(() => buildWaveformPath(aud), [aud]);

  const updateAud = (next: ProceduralAudioAsset) => {
    controller?.updateSelectedAudio(next);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      const text = await readFileAsText(file);
      controller.importAudioJson(text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Audio Asset Selector + Create */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Audio Asset ({state.audioIds.length})</span>
          {aud && (
            <span className="font-mono-tabular text-[10px] text-sky-300">{aud.kind}</span>
          )}
        </div>

        <select
          value={state.selectedAudioId}
          onChange={(e) => controller?.selectAudio(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.audioIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          <input
            type="text"
            value={newAudioName}
            onChange={(e) => setNewAudioName(e.target.value)}
            placeholder="new_audio_id"
            className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as ProceduralAudioAsset['kind'])}
            className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
          >
            <option value="chirp_sequence">Chirp</option>
            <option value="filtered_noise_burst">Noise Burst</option>
            <option value="siren_sweep">Siren Sweep</option>
            <option value="siren_hilo">Siren Hi-Lo</option>
          </select>
          <button
            type="button"
            onClick={() => controller?.createNewAudio(newAudioName, newKind)}
            className="border border-emerald-500/70 bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
          >
            +New
          </button>
        </div>
      </div>

      {importError && (
        <div className="border border-red-500/70 bg-red-950/60 p-1.5 text-[10px] text-red-200 rounded-none">
          {importError}
        </div>
      )}

      {aud && (
        <div className="ui-subpanel p-2 space-y-2">
          {/* Waveform visualizer + Play */}
          <div className="flex items-center gap-2 border border-zinc-700 bg-zinc-950 p-1.5">
            <svg viewBox="0 0 240 48" className="h-12 flex-1">
              <line x1="0" y1="24" x2="240" y2="24" stroke="#334155" strokeWidth="1" />
              <path d={wavePath} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            </svg>
            <button
              type="button"
              onClick={() => controller?.previewSelectedAudio()}
              className="flex items-center gap-1 border border-emerald-400/80 bg-emerald-600 px-2.5 py-2 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer rounded-none shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              Play
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono-tabular">
            <label className="space-y-0.5">
              <span className="text-zinc-400">Gain</span>
              <input
                type="number"
                step={0.05}
                min={0.01}
                max={2}
                value={aud.gain}
                onChange={(e) => updateAud({ ...aud, gain: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-400">Seed</span>
              <input
                type="number"
                step={1}
                value={aud.seed}
                onChange={(e) => updateAud({ ...aud, seed: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
          </div>

          {/* Siren Controls */}
          {(aud.kind === 'siren_sweep' || aud.kind === 'siren_hilo') && aud.siren && (
            <div className="space-y-1.5 border-t border-zinc-700 pt-1.5 text-[10px] font-mono-tabular">
              <div className="grid grid-cols-2 gap-1">
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Min Freq (Hz)</span>
                  <input
                    type="number"
                    step={20}
                    value={aud.siren.minFreq}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        siren: { ...aud.siren!, minFreq: Number(e.target.value) },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Max Freq (Hz)</span>
                  <input
                    type="number"
                    step={20}
                    value={aud.siren.maxFreq}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        siren: { ...aud.siren!, maxFreq: Number(e.target.value) },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Sweep Rate (Hz)</span>
                  <input
                    type="number"
                    step={0.05}
                    value={aud.siren.sweepRateHz}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        siren: { ...aud.siren!, sweepRateHz: Number(e.target.value) },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Bandpass (Hz)</span>
                  <input
                    type="number"
                    step={50}
                    value={aud.siren.bandpassFreq}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        siren: { ...aud.siren!, bandpassFreq: Number(e.target.value) },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <select
                  value={aud.siren.waveform1}
                  onChange={(e) =>
                    updateAud({
                      ...aud,
                      siren: { ...aud.siren!, waveform1: e.target.value as OscillatorType },
                    })
                  }
                  className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                >
                  <option value="sawtooth">sawtooth</option>
                  <option value="triangle">triangle</option>
                  <option value="square">square</option>
                  <option value="sine">sine</option>
                </select>
                <select
                  value={aud.siren.waveform2}
                  onChange={(e) =>
                    updateAud({
                      ...aud,
                      siren: { ...aud.siren!, waveform2: e.target.value as OscillatorType },
                    })
                  }
                  className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                >
                  <option value="triangle">triangle</option>
                  <option value="sawtooth">sawtooth</option>
                  <option value="square">square</option>
                  <option value="sine">sine</option>
                </select>
              </div>
            </div>
          )}

          {/* Noise Burst Controls */}
          {aud.kind === 'filtered_noise_burst' && aud.noiseBurst && (
            <div className="space-y-1.5 border-t border-zinc-700 pt-1.5 text-[10px] font-mono-tabular">
              <div className="grid grid-cols-2 gap-1">
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Duration (s)</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.04}
                    max={3}
                    value={aud.noiseBurst.duration}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      updateAud({
                        ...aud,
                        noiseBurst: {
                          ...aud.noiseBurst!,
                          duration: d,
                          envelope: { ...aud.noiseBurst!.envelope, duration: d },
                        },
                      });
                    }}
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Curve Exp</span>
                  <input
                    type="number"
                    step={0.2}
                    min={0.5}
                    max={8}
                    value={aud.noiseBurst.envelope.curveExponent ?? 2.8}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        noiseBurst: {
                          ...aud.noiseBurst!,
                          envelope: {
                            ...aud.noiseBurst!.envelope,
                            curveExponent: Number(e.target.value),
                          },
                        },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Freq Start</span>
                  <input
                    type="number"
                    step={50}
                    min={20}
                    value={aud.noiseBurst.freqStart}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        noiseBurst: {
                          ...aud.noiseBurst!,
                          freqStart: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-zinc-400">Freq End</span>
                  <input
                    type="number"
                    step={50}
                    min={20}
                    value={aud.noiseBurst.freqEnd}
                    onChange={(e) =>
                      updateAud({
                        ...aud,
                        noiseBurst: {
                          ...aud.noiseBurst!,
                          freqEnd: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>
              <select
                value={aud.noiseBurst.filterType}
                onChange={(e) =>
                  updateAud({
                    ...aud,
                    noiseBurst: {
                      ...aud.noiseBurst!,
                      filterType: e.target.value as BiquadFilterType,
                    },
                  })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                <option value="bandpass">bandpass</option>
                <option value="lowpass">lowpass</option>
                <option value="highpass">highpass</option>
              </select>
            </div>
          )}

          {/* Chirp Steps Controls */}
          {aud.kind === 'chirp_sequence' && aud.chirp && (
            <div className="space-y-1.5 border-t border-zinc-700 pt-1.5 text-[10px] font-mono-tabular">
              <div className="grid grid-cols-2 gap-1">
                <select
                  value={aud.chirp.waveform}
                  onChange={(e) =>
                    updateAud({
                      ...aud,
                      chirp: {
                        ...aud.chirp!,
                        waveform: e.target.value as OscillatorType,
                      },
                    })
                  }
                  className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                >
                  <option value="triangle">triangle</option>
                  <option value="sine">sine</option>
                  <option value="square">square</option>
                  <option value="sawtooth">sawtooth</option>
                </select>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  value={aud.chirp.duration}
                  onChange={(e) =>
                    updateAud({
                      ...aud,
                      chirp: { ...aud.chirp!, duration: Number(e.target.value) },
                    })
                  }
                  className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Pitch Steps</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateAud({
                        ...aud,
                        chirp: {
                          ...aud.chirp!,
                          steps: [...aud.chirp!.steps, { time: 0.1, freq: 1400 }],
                        },
                      })
                    }
                    className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-emerald-100 cursor-pointer rounded-none"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    Step
                  </button>
                </div>
                {aud.chirp.steps.map((st, sIdx) => (
                  <div key={sIdx} className="grid grid-cols-5 gap-1 items-center">
                    <input
                      type="number"
                      step={0.02}
                      value={st.time}
                      onChange={(e) => {
                        const steps = [...aud.chirp!.steps];
                        steps[sIdx] = { ...st, time: Number(e.target.value) };
                        updateAud({ ...aud, chirp: { ...aud.chirp!, steps } });
                      }}
                      className="col-span-2 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                    <input
                      type="number"
                      step={25}
                      value={st.freq}
                      onChange={(e) => {
                        const steps = [...aud.chirp!.steps];
                        steps[sIdx] = { ...st, freq: Number(e.target.value) };
                        updateAud({ ...aud, chirp: { ...aud.chirp!, steps } });
                      }}
                      className="col-span-2 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const steps = aud.chirp!.steps.filter((_, i) => i !== sIdx);
                        updateAud({ ...aud, chirp: { ...aud.chirp!, steps } });
                      }}
                      className="flex justify-center border border-red-500/60 bg-red-900/40 p-1 text-red-200 cursor-pointer rounded-none"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Load / Save */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Upload className="h-3 w-3" />
          Load Audio JSON
        </button>
        <button
          type="button"
          onClick={() => {
            const res = controller?.exportAudioJson();
            if (res) downloadJsonText(res.filename, res.content);
          }}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Download className="h-3 w-3" />
          Save Audio JSON
        </button>
      </div>
    </div>
  );
};
