import React, { useState } from 'react';
import { Plus, Save, Siren, Trash2 } from 'lucide-react';
import {
  LightbarAssetDef,
  LightbarEmitterDef,
  LightbarEmitterGroup,
  LightbarEmitterMode,
  LightbarHardwareStyle,
  LightbarPatternType,
} from '../../assets/assetTypes';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';

export interface LightbarEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
  onApplyToFleet?: (lightbarId: string) => void;
}

const HARDWARE_STYLES: LightbarHardwareStyle[] = [
  'standard_shell',
  'vector_pods',
  'mini_beacon',
  'visor_stealth',
  'custom',
];

const PATTERN_TYPES: LightbarPatternType[] = [
  'led',
  'flashing_halogen',
  'rotating_halogen',
  'vector_pods',
  'visor_stealth',
  'mini_beacon',
  'custom',
];

const EMITTER_MODES: LightbarEmitterMode[] = [
  'strobe',
  'halogen',
  'rotator',
  'sweep',
  'steady',
];

const EMITTER_GROUPS: LightbarEmitterGroup[] = [
  'roof',
  'visor',
  'grille',
  'rear',
  'advisor',
];

export const LightbarEditorTab: React.FC<LightbarEditorTabProps> = ({
  controller,
  state,
  onApplyToFleet,
}) => {
  const [newId, setNewId] = useState('custom_bar');
  const [newName, setNewName] = useState('Custom Pursuit Bar');

  const lb = state.selectedLightbar;

  const updateLb = (patch: Partial<LightbarAssetDef>) => {
    if (!lb || !controller) return;
    controller.updateSelectedLightbar({ ...lb, ...patch });
  };

  const updateEmitter = (idx: number, patch: Partial<LightbarEmitterDef>) => {
    if (!lb || !controller) return;
    const emitters = lb.emitters.map((em, i) => (i === idx ? { ...em, ...patch } : em));
    controller.updateSelectedLightbar({ ...lb, emitters });
  };

  const addEmitter = () => {
    if (!lb || !controller) return;
    const nextIdx = lb.emitters.length + 1;
    const em: LightbarEmitterDef = {
      id: `emitter_${nextIdx}`,
      x: 0,
      y: 0.11,
      z: 0,
      w: 0.24,
      h: 0.08,
      d: 0.22,
      shape: 'box',
      color: lb.leftColor,
      emissive: lb.leftColor,
      phase: 0,
      duty: 0.4,
      freqHz: 2.6,
      mode: 'strobe',
      group: 'roof',
      intensity: 5.5,
    };
    controller.updateSelectedLightbar({
      ...lb,
      emitters: [...lb.emitters, em],
    });
  };

  const removeEmitter = (idx: number) => {
    if (!lb || !controller) return;
    controller.updateSelectedLightbar({
      ...lb,
      emitters: lb.emitters.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Lightbar Selector & Creation */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Pack Lightbars ({state.lightbarIds.length})</span>
          <button
            type="button"
            disabled={!lb || state.lightbarIds.length <= 1}
            onClick={() => lb && controller?.deleteLightbar(lb.id)}
            title="Delete selected lightbar"
            className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
              lb && state.lightbarIds.length > 1
                ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        <select
          value={state.selectedLightbarId}
          onChange={(e) => controller?.selectLightbar(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.lightbarIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <input
            type="text"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="new_id"
            className="border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display Name"
            className="border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-100 rounded-none"
          />
          <button
            type="button"
            onClick={() => controller?.createNewLightbar(newId, newName)}
            className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/45 px-2 py-0.5 text-[10px] font-medium text-emerald-100 hover:bg-emerald-600/65 cursor-pointer whitespace-nowrap rounded-none"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      {/* Selected Lightbar Properties */}
      {lb && (
        <div className="ui-subpanel p-2 space-y-2">
          <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Display Name</span>
              <input
                type="text"
                value={lb.name}
                onChange={(e) => updateLb({ name: e.target.value })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Rate Multiplier</span>
              <input
                type="number"
                step={0.1}
                min={0.2}
                max={4}
                value={lb.rateMult}
                onChange={(e) => updateLb({ rateMult: Number(e.target.value) || 1 })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Hardware Style</span>
              <select
                value={lb.hardwareStyle}
                onChange={(e) =>
                  updateLb({ hardwareStyle: e.target.value as LightbarHardwareStyle })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
              >
                {HARDWARE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Flash Pattern</span>
              <select
                value={lb.patternType}
                onChange={(e) =>
                  updateLb({ patternType: e.target.value as LightbarPatternType })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
              >
                {PATTERN_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Left Color</span>
              <div className="flex gap-1 items-center">
                <input
                  type="color"
                  value={lb.leftColor}
                  onChange={(e) => updateLb({ leftColor: e.target.value })}
                  className="h-6 w-8 border border-zinc-600 bg-zinc-900 p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={lb.leftColor}
                  onChange={(e) => updateLb({ leftColor: e.target.value })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                />
              </div>
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Right Color</span>
              <div className="flex gap-1 items-center">
                <input
                  type="color"
                  value={lb.rightColor}
                  onChange={(e) => updateLb({ rightColor: e.target.value })}
                  className="h-6 w-8 border border-zinc-600 bg-zinc-900 p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={lb.rightColor}
                  onChange={(e) => updateLb({ rightColor: e.target.value })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                />
              </div>
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Center Color</span>
              <div className="flex gap-1 items-center">
                <input
                  type="color"
                  value={lb.centerColor}
                  onChange={(e) => updateLb({ centerColor: e.target.value })}
                  className="h-6 w-8 border border-zinc-600 bg-zinc-900 p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={lb.centerColor}
                  onChange={(e) => updateLb({ centerColor: e.target.value })}
                  className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-1.5 font-mono-tabular">
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Halo Opacity</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={lb.haloOpacity}
                onChange={(e) => updateLb({ haloOpacity: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Light Range</span>
              <input
                type="number"
                step={1}
                min={2}
                max={50}
                value={lb.pointLightRange}
                onChange={(e) => updateLb({ pointLightRange: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-zinc-400">Light Intensity</span>
              <input
                type="number"
                step={1}
                min={0}
                max={40}
                value={lb.pointLightIntensity}
                onChange={(e) => updateLb({ pointLightIntensity: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-100 rounded-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            {(
              [
                { key: 'hasTrafficAdvisor', label: 'Traffic Advisor' },
                { key: 'hasCookies', label: 'Optic Cookies / Alley' },
                { key: 'hasGrilleStrobes', label: 'Grille Strobes' },
                { key: 'hasRearDeck', label: 'Rear Deck Lights' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.key}
                className="flex items-center justify-between border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 cursor-pointer"
              >
                <span>{opt.label}</span>
                <input
                  type="checkbox"
                  checked={lb[opt.key]}
                  onChange={(e) => updateLb({ [opt.key]: e.target.checked })}
                />
              </label>
            ))}
          </div>

          {/* Custom Emitters Editor */}
          <div className="border-t border-zinc-700 pt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-300">
                Custom Emitters ({lb.emitters.length})
              </span>
              <button
                type="button"
                onClick={addEmitter}
                className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
              >
                <Plus className="h-3 w-3" />
                Emitter
              </button>
            </div>

            {lb.emitters.length === 0 ? (
              <div className="text-[10px] text-zinc-500">
                No custom emitters defined (standard hardware mesh is used unless style = custom).
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                {lb.emitters.map((em, idx) => (
                  <div
                    key={`${em.id}-${idx}`}
                    className="border border-zinc-700 bg-zinc-900/90 p-1.5 space-y-1 font-mono-tabular text-[10px]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <input
                        type="text"
                        value={em.id}
                        onChange={(e) => updateEmitter(idx, { id: e.target.value })}
                        className="w-28 border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                      <select
                        value={em.mode}
                        onChange={(e) =>
                          updateEmitter(idx, {
                            mode: e.target.value as LightbarEmitterMode,
                          })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      >
                        {EMITTER_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <select
                        value={em.group}
                        onChange={(e) =>
                          updateEmitter(idx, {
                            group: e.target.value as LightbarEmitterGroup,
                          })
                        }
                        className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                      >
                        {EMITTER_GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeEmitter(idx)}
                        className="border border-red-500/60 bg-red-900/40 p-0.5 text-red-200 hover:bg-red-700/60 cursor-pointer rounded-none"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="grid grid-cols-6 gap-1">
                      {(
                        [
                          { key: 'x', label: 'X' },
                          { key: 'y', label: 'Y' },
                          { key: 'z', label: 'Z' },
                          { key: 'w', label: 'W' },
                          { key: 'h', label: 'H' },
                          { key: 'd', label: 'D' },
                        ] as const
                      ).map((f) => (
                        <label key={f.key} className="space-y-0.5">
                          <span className="text-[9px] text-zinc-500">{f.label}</span>
                          <input
                            type="number"
                            step={0.02}
                            value={em[f.key]}
                            onChange={(e) =>
                              updateEmitter(idx, { [f.key]: Number(e.target.value) })
                            }
                            className="w-full border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-5 gap-1 items-end">
                      <label className="space-y-0.5">
                        <span className="text-[9px] text-zinc-500">Color</span>
                        <input
                          type="color"
                          value={em.color}
                          onChange={(e) =>
                            updateEmitter(idx, {
                              color: e.target.value,
                              emissive: e.target.value,
                            })
                          }
                          className="h-5 w-full border border-zinc-700 bg-zinc-800 cursor-pointer"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[9px] text-zinc-500">Hz</span>
                        <input
                          type="number"
                          step={0.2}
                          min={0.2}
                          value={em.freqHz}
                          onChange={(e) =>
                            updateEmitter(idx, { freqHz: Number(e.target.value) })
                          }
                          className="w-full border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[9px] text-zinc-500">Phase</span>
                        <input
                          type="number"
                          step={0.05}
                          min={0}
                          max={1}
                          value={em.phase}
                          onChange={(e) =>
                            updateEmitter(idx, { phase: Number(e.target.value) })
                          }
                          className="w-full border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[9px] text-zinc-500">Duty</span>
                        <input
                          type="number"
                          step={0.05}
                          min={0.05}
                          max={1}
                          value={em.duty}
                          onChange={(e) =>
                            updateEmitter(idx, { duty: Number(e.target.value) })
                          }
                          className="w-full border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[9px] text-zinc-500">Shape</span>
                        <select
                          value={em.shape}
                          onChange={(e) =>
                            updateEmitter(idx, {
                              shape: e.target.value as LightbarEmitterDef['shape'],
                            })
                          }
                          className="w-full border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                        >
                          <option value="box">box</option>
                          <option value="cylinder">cyl</option>
                          <option value="sphere">sph</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save & Apply Actions */}
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => controller?.saveCurrentAssetToPack('lightbars')}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
            state.dirtyLightbars
              ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
              : 'border-emerald-500/70 bg-emerald-700/45 text-emerald-100 hover:bg-emerald-600/60'
          }`}
        >
          <Save className="h-3.5 w-3.5" />
          Save Lightbars
        </button>

        <button
          type="button"
          disabled={!lb || !onApplyToFleet}
          onClick={() => lb && onApplyToFleet?.(lb.id)}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium rounded-none ${
            lb && onApplyToFleet
              ? 'border-sky-500/70 bg-sky-700/45 text-sky-100 hover:bg-sky-600/65 cursor-pointer'
              : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
          }`}
        >
          <Siren className="h-3.5 w-3.5" />
          Apply to Fleet
        </button>
      </div>
    </div>
  );
};
