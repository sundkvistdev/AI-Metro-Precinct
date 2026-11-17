import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Folder,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CrashPartRole,
  ModelCategory,
  ModelMaterialDef,
  ModelPartDef,
} from '../../assets/assetTypes';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { downloadJsonText, readFileAsText } from './editorFileUtils';

type ModelSection = 'tree' | 'inspector' | 'materials' | 'flags';

const CATEGORIES: ModelCategory[] = [
  'vehicle',
  'humanoid',
  'sign',
  'prop',
  'building',
  'custom',
];

const CRASH_ROLES: CrashPartRole[] = [
  'bumper',
  'headlight_l',
  'headlight_r',
  'taillight_l',
  'taillight_r',
  'lightbar',
  'wheel',
  'door',
  'trim',
  'sign',
  'roof',
];

export interface ModelEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

export const ModelEditorTab: React.FC<ModelEditorTabProps> = ({
  controller,
  state,
}) => {
  const [section, setSection] = useState<ModelSection>('tree');
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [newModelName, setNewModelName] = useState('custom_prop');
  const [newMatName, setNewMatName] = useState('custom_mat');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const model = state.modelAsset;
  const selP = state.selectedPart;
  const flags = model?.flags ?? {};

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImportModel = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      const text = await readFileAsText(file);
      controller.importModelJson(text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderTreeNodes = (parts: ModelPartDef[], depth = 0): React.ReactNode => {
    return parts.map((p) => {
      const isGroup = p.kind === 'group';
      const isCollapsed = Boolean(collapsedIds[p.id]);
      const isSelected = p.id === state.selectedPartId;
      const isHidden = p.visible === false;

      return (
        <div key={p.id}>
          <div
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={`flex items-center justify-between gap-1 border-b border-zinc-800 py-0.5 pr-1 text-[11px] ${
              isSelected
                ? 'bg-sky-600/35 text-white'
                : 'text-zinc-200 hover:bg-zinc-800/80'
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {isGroup ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(p.id)}
                  className="text-zinc-400 hover:text-zinc-100 cursor-pointer"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="inline-block w-3 shrink-0" />
              )}

              <button
                type="button"
                onClick={() => controller?.selectPart(p.id)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left cursor-pointer truncate"
              >
                {isGroup && <Folder className="h-3 w-3 shrink-0 text-amber-300" />}
                <span className="font-mono-tabular truncate">{p.id}</span>
                <span className="text-[9px] text-zinc-400 shrink-0">[{p.kind}]</span>
              </button>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  controller?.selectPart(p.id);
                  controller?.updateSelectedPart({ visible: isHidden });
                }}
                title={isHidden ? 'Show part' : 'Hide part'}
                className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => controller?.movePartOrder(p.id, -1)}
                title="Move Up"
                className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => controller?.movePartOrder(p.id, 1)}
                title="Move Down"
                className="p-0.5 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
          </div>
          {isGroup && !isCollapsed && p.children && p.children.length > 0 && (
            <div>{renderTreeNodes(p.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Model Asset Picker + New / Clone / Load */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-medium text-zinc-300">
            Model ({state.modelIds.length})
          </span>
          <button
            type="button"
            onClick={() => controller?.focusModelStage()}
            className="flex items-center gap-1 border border-zinc-500 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            <Crosshair className="h-3 w-3" />
            Focus Stage
          </button>
        </div>

        <select
          value={state.selectedModelId}
          onChange={(e) => controller?.selectModel(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.modelIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          <input
            type="text"
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            placeholder="new_model_id"
            className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <button
            type="button"
            onClick={() => controller?.createNewModel(newModelName, 'prop')}
            className="border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
          >
            +New
          </button>
          <button
            type="button"
            onClick={() => controller?.cloneCurrentModel(newModelName)}
            className="border border-sky-500/70 bg-sky-700/40 px-1.5 py-0.5 text-[10px] text-sky-100 hover:bg-sky-600/60 cursor-pointer rounded-none"
          >
            Clone
          </button>
        </div>
      </div>

      {importError && (
        <div className="border border-red-500/70 bg-red-950/60 p-1.5 text-[10px] text-red-200 rounded-none">
          {importError}
        </div>
      )}

      {/* Section tabs */}
      <div className="grid grid-cols-4 gap-0.5 border border-zinc-600 bg-zinc-900/60 p-0.5">
        {(
          [
            { id: 'tree', label: 'Hierarchy' },
            { id: 'inspector', label: 'Part' },
            { id: 'materials', label: 'Materials' },
            { id: 'flags', label: 'Flags' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              section === tab.id
                ? 'bg-zinc-200 text-zinc-900 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-700/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* HIERARCHY TREE */}
      {section === 'tree' && model && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex flex-wrap gap-1">
              {(['group', 'box', 'cylinder', 'sphere', 'plane'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => controller?.addPart(k)}
                  className="border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
                >
                  +{k === 'cylinder' ? 'Cyl' : k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={!selP}
                onClick={() => controller?.duplicateSelectedPart()}
                title="Duplicate"
                className={`border px-1.5 py-0.5 text-[10px] rounded-none ${
                  selP
                    ? 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600 cursor-pointer'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={!selP}
                onClick={() => controller?.deleteSelectedPart()}
                title="Delete"
                className={`border px-1.5 py-0.5 text-[10px] rounded-none ${
                  selP
                    ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto border border-zinc-700 bg-zinc-900">
            {model.parts.length === 0 ? (
              <div className="p-2 text-[10px] text-zinc-400">No parts in model.</div>
            ) : (
              renderTreeNodes(model.parts)
            )}
          </div>

          {selP && (
            <div className="flex items-center gap-1 pt-0.5 text-[10px]">
              <span className="text-zinc-400 shrink-0">Parent Group:</span>
              <select
                value={state.selectedPartParentId ?? ''}
                onChange={(e) =>
                  controller?.reparentPart(selP.id, e.target.value || null)
                }
                className="flex-1 border border-zinc-600 bg-zinc-900 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
              >
                <option value="">(Root)</option>
                {state.groupIds
                  .filter((gid) => gid !== selP.id)
                  .map((gid) => (
                    <option key={gid} value={gid}>
                      {gid}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* SELECTED PART INSPECTOR */}
      {section === 'inspector' && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <select
            value={state.selectedPartId ?? ''}
            onChange={(e) => controller?.selectPart(e.target.value || null)}
            className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          >
            {state.partIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          {selP && (
            <div className="space-y-1.5 text-[11px] font-mono-tabular">
              <div className="grid grid-cols-2 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Part ID</span>
                  <input
                    type="text"
                    value={selP.id}
                    onChange={(e) => controller?.updateSelectedPart({ id: e.target.value })}
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Tag</span>
                  <input
                    type="text"
                    value={selP.tag ?? ''}
                    placeholder="e.g. frontWheel"
                    onChange={(e) => controller?.updateSelectedPart({ tag: e.target.value })}
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="text-[10px] text-zinc-400">Position (X / Y / Z)</div>
              <div className="grid grid-cols-3 gap-1">
                {[0, 1, 2].map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step={0.05}
                    value={selP.position?.[axis] ?? 0}
                    onChange={(e) => {
                      const next: [number, number, number] = [
                        selP.position?.[0] ?? 0,
                        selP.position?.[1] ?? 0,
                        selP.position?.[2] ?? 0,
                      ];
                      next[axis] = Number(e.target.value);
                      controller?.updateSelectedPart({ position: next });
                    }}
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                ))}
              </div>

              <div className="text-[10px] text-zinc-400">Rotation (rad X / Y / Z)</div>
              <div className="grid grid-cols-3 gap-1">
                {[0, 1, 2].map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step={0.05}
                    value={selP.rotation?.[axis] ?? 0}
                    onChange={(e) => {
                      const next: [number, number, number] = [
                        selP.rotation?.[0] ?? 0,
                        selP.rotation?.[1] ?? 0,
                        selP.rotation?.[2] ?? 0,
                      ];
                      next[axis] = Number(e.target.value);
                      controller?.updateSelectedPart({ rotation: next });
                    }}
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                ))}
              </div>

              {selP.kind !== 'group' && (
                <>
                  <div className="text-[10px] text-zinc-400">Dimensions</div>
                  <div className="grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((axis) => (
                      <input
                        key={axis}
                        type="number"
                        step={0.05}
                        min={0.02}
                        value={selP.dimensions?.[axis] ?? 1}
                        onChange={(e) => {
                          const next: [number, number, number] = [
                            selP.dimensions?.[0] ?? 1,
                            selP.dimensions?.[1] ?? 1,
                            selP.dimensions?.[2] ?? 1,
                          ];
                          next[axis] = Number(e.target.value);
                          controller?.updateSelectedPart({ dimensions: next });
                        }}
                        className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400 shrink-0">Material</span>
                    <select
                      value={selP.materialRef ?? ''}
                      onChange={(e) =>
                        controller?.updateSelectedPart({ materialRef: e.target.value })
                      }
                      className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 rounded-none"
                    >
                      <option value="">(none)</option>
                      {state.modelMaterialKeys.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-zinc-300">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selP.castShadow ?? true}
                        onChange={(e) =>
                          controller?.updateSelectedPart({ castShadow: e.target.checked })
                        }
                      />
                      Cast Shadow
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selP.receiveShadow ?? false}
                        onChange={(e) =>
                          controller?.updateSelectedPart({ receiveShadow: e.target.checked })
                        }
                      />
                      Receive Shadow
                    </label>
                  </div>
                </>
              )}

              <div className="border-t border-zinc-700 pt-1.5 space-y-1">
                <label className="flex items-center gap-1 text-[10px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(selP.crashPart)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        controller?.updateSelectedPart({
                          crashPart: {
                            role: 'trim',
                            minStrikeSpeed: 7.5,
                            health: 1.0,
                            radius: 0.4,
                          },
                        });
                      } else {
                        controller?.updateSelectedPart({ crashPart: null });
                      }
                    }}
                  />
                  Detachable Crash Part
                </label>

                {selP.crashPart && (
                  <div className="grid grid-cols-3 gap-1">
                    <select
                      value={selP.crashPart.role}
                      onChange={(e) =>
                        controller?.updateSelectedPart({
                          crashPart: {
                            ...selP.crashPart!,
                            role: e.target.value as CrashPartRole,
                          },
                        })
                      }
                      className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                    >
                      {CRASH_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step={0.5}
                      min={1}
                      title="Min strike speed"
                      value={selP.crashPart.minStrikeSpeed}
                      onChange={(e) =>
                        controller?.updateSelectedPart({
                          crashPart: {
                            ...selP.crashPart!,
                            minStrikeSpeed: Number(e.target.value),
                          },
                        })
                      }
                      className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                    />
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      title="Part health"
                      value={selP.crashPart.health}
                      onChange={(e) =>
                        controller?.updateSelectedPart({
                          crashPart: {
                            ...selP.crashPart!,
                            health: Number(e.target.value),
                          },
                        })
                      }
                      className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MATERIALS EDITOR */}
      {section === 'materials' && model && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <div className="flex gap-1">
            <input
              type="text"
              value={newMatName}
              onChange={(e) => setNewMatName(e.target.value)}
              placeholder="material_key"
              className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
            />
            <button
              type="button"
              onClick={() =>
                controller?.upsertModelMaterial(newMatName, {
                  type: 'standard',
                  color: '#94a3b8',
                  roughness: 0.45,
                  metalness: 0.2,
                })
              }
              className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
            >
              <Plus className="h-3 w-3" />
              Mat
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1.5">
            {Object.entries(model.materials).map(([key, mat]) => {
              const updateMat = (patch: Partial<ModelMaterialDef>) => {
                controller?.upsertModelMaterial(key, { ...mat, ...patch });
              };
              return (
                <div
                  key={key}
                  className="border border-zinc-700 bg-zinc-900 p-1.5 space-y-1 text-[10px] font-mono-tabular"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-zinc-100 truncate">{key}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="color"
                        value={mat.color.startsWith('#') ? mat.color.slice(0, 7) : '#808080'}
                        onChange={(e) => updateMat({ color: e.target.value })}
                        className="h-4 w-6 cursor-pointer border border-zinc-600 bg-transparent p-0"
                      />
                      <button
                        type="button"
                        onClick={() => controller?.deleteModelMaterial(key)}
                        className="border border-red-500/60 bg-red-900/40 p-0.5 text-red-200 hover:bg-red-800/60 cursor-pointer rounded-none"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <select
                      value={mat.type}
                      onChange={(e) =>
                        updateMat({ type: e.target.value as ModelMaterialDef['type'] })
                      }
                      className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                    >
                      <option value="standard">standard</option>
                      <option value="physical">physical</option>
                      <option value="basic">basic</option>
                    </select>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      title="Roughness"
                      value={mat.roughness ?? 0.5}
                      onChange={(e) => updateMat({ roughness: Number(e.target.value) })}
                      className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      title="Metalness"
                      value={mat.metalness ?? 0}
                      onChange={(e) => updateMat({ metalness: Number(e.target.value) })}
                      className="border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={mat.textureRef ?? ''}
                      onChange={(e) =>
                        updateMat({ textureRef: e.target.value || undefined })
                      }
                      className="flex-1 border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100 rounded-none"
                    >
                      <option value="">(no textureRef)</option>
                      {state.textureIds.map((tid) => (
                        <option key={tid} value={tid}>
                          {tid}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(mat.transparent)}
                        onChange={(e) => updateMat({ transparent: e.target.checked })}
                      />
                      Alpha
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODEL FLAGS */}
      {section === 'flags' && model && (
        <div className="ui-subpanel p-2 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-400">Category</span>
            <select
              value={flags.category ?? 'custom'}
              onChange={(e) =>
                controller?.updateModelFlags({ category: e.target.value as ModelCategory })
              }
              className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-200">
            {(
              [
                ['collidable', 'Collidable'],
                ['destructible', 'Destructible'],
                ['castShadow', 'Cast Shadows'],
                ['receiveShadow', 'Receive Shadows'],
                ['isEmergencyVehicle', 'Emergency Vehicle'],
                ['useBasePaint', 'Use Base Paint'],
                ['pedestrianTemplate', 'Pedestrian Template'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(flags[k])}
                  onChange={(e) =>
                    controller?.updateModelFlags({ [k]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>

          <label className="block space-y-0.5">
            <span className="text-[10px] text-zinc-400">Custom Tags (comma separated)</span>
            <input
              type="text"
              value={(flags.customTags ?? []).join(', ')}
              onChange={(e) =>
                controller?.updateModelFlags({
                  customTags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="e.g. armored, pursuit, downtown"
              className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
            />
          </label>
        </div>
      )}

      {/* Save / Load / Apply Live */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImportModel(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => controller?.applyModelChanges()}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
            state.dirtyModel
              ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
              : 'border-zinc-500 bg-zinc-700 text-zinc-100 hover:bg-zinc-600'
          }`}
        >
          <RefreshCw className="h-3 w-3" />
          Apply Live
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Upload className="h-3 w-3" />
          Load
        </button>
        <button
          type="button"
          onClick={() => {
            const res = controller?.exportModelJson();
            if (res) downloadJsonText(res.filename, res.content);
          }}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Download className="h-3 w-3" />
          Save
        </button>
      </div>
    </div>
  );
};
