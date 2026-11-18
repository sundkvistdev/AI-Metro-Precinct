import React, { useState } from 'react';
import { Check, Plus, Save, Trash2 } from 'lucide-react';
import { ModelMaterialDef } from '../../assets/assetTypes';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';

export interface MaterialsEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

export const MaterialsEditorTab: React.FC<MaterialsEditorTabProps> = ({
  controller,
  state,
}) => {
  const [newMatId, setNewMatId] = useState('shared_livery_trim');
  const mat = state.selectedMaterial;
  const matId = state.selectedMaterialId;

  const updateMat = (patch: Partial<ModelMaterialDef>) => {
    if (!mat || !matId || !controller) return;
    controller.upsertPackMaterial(matId, { ...mat, ...patch });
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Shared Pack Materials ({state.materialIds.length})</span>
          <button
            type="button"
            disabled={!matId}
            onClick={() => controller?.deletePackMaterial(matId)}
            className={`border px-1.5 py-0.5 text-[10px] rounded-none ${
              matId
                ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        <div className="flex gap-1">
          <input
            type="text"
            value={newMatId}
            onChange={(e) => setNewMatId(e.target.value)}
            placeholder="material_id"
            className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <button
            type="button"
            onClick={() =>
              controller?.upsertPackMaterial(newMatId, {
                type: 'standard',
                color: '#64748b',
                roughness: 0.45,
                metalness: 0.2,
              })
            }
            className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        <select
          value={matId}
          onChange={(e) => controller?.selectPackMaterial(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.materialIds.length === 0 ? (
            <option value="">-- No shared materials yet --</option>
          ) : (
            state.materialIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))
          )}
        </select>
      </div>

      {mat && (
        <div className="ui-subpanel p-2 space-y-2 text-[10px] font-mono-tabular">
          <div className="grid grid-cols-3 gap-1">
            <label className="space-y-0.5">
              <span className="text-zinc-400">Type</span>
              <select
                value={mat.type}
                onChange={(e) =>
                  updateMat({ type: e.target.value as ModelMaterialDef['type'] })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                <option value="standard">standard</option>
                <option value="physical">physical</option>
                <option value="basic">basic</option>
              </select>
            </label>

            <label className="space-y-0.5">
              <span className="text-zinc-400">Albedo</span>
              <input
                type="color"
                value={mat.color.startsWith('#') ? mat.color.slice(0, 7) : '#808080'}
                onChange={(e) => updateMat({ color: e.target.value })}
                className="h-6 w-full border border-zinc-600 bg-transparent p-0 cursor-pointer"
              />
            </label>

            <label className="space-y-0.5">
              <span className="text-zinc-400">Emissive</span>
              <input
                type="color"
                value={
                  mat.emissive?.startsWith('#') ? mat.emissive.slice(0, 7) : '#000000'
                }
                onChange={(e) => updateMat({ emissive: e.target.value })}
                className="h-6 w-full border border-zinc-600 bg-transparent p-0 cursor-pointer"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-1">
            <label className="space-y-0.5">
              <span className="text-zinc-400">Roughness</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={mat.roughness ?? 0.5}
                onChange={(e) => updateMat({ roughness: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-400">Metalness</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={mat.metalness ?? 0}
                onChange={(e) => updateMat({ metalness: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-400">Clearcoat</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={mat.clearcoat ?? 0}
                onChange={(e) => updateMat({ clearcoat: Number(e.target.value) })}
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <label className="space-y-0.5">
              <span className="text-zinc-400">Albedo Texture</span>
              <select
                value={mat.textureRef ?? ''}
                onChange={(e) =>
                  updateMat({ textureRef: e.target.value || undefined })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                <option value="">(none)</option>
                {state.textureIds.map((tid) => (
                  <option key={tid} value={tid}>
                    {tid}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-400">Roughness Map</span>
              <select
                value={mat.roughnessTextureRef ?? ''}
                onChange={(e) =>
                  updateMat({ roughnessTextureRef: e.target.value || undefined })
                }
                className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                <option value="">(none)</option>
                {state.textureIds.map((tid) => (
                  <option key={tid} value={tid}>
                    {tid}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(mat.transparent)}
                onChange={(e) => updateMat({ transparent: e.target.checked })}
              />
              Transparent
            </label>
            <label className="flex items-center gap-1.5 text-zinc-300">
              <span>Opacity</span>
              <input
                type="number"
                step={0.05}
                min={0.05}
                max={1}
                value={mat.opacity ?? 1}
                onChange={(e) => updateMat({ opacity: Number(e.target.value) })}
                className="w-16 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!state.selectedPartId}
            onClick={() => controller?.applyPackMaterialToSelectedPart(matId)}
            className={`w-full flex items-center justify-center gap-1 border py-1 font-sans text-[11px] font-medium rounded-none ${
              state.selectedPartId
                ? 'border-sky-500/70 bg-sky-700/45 text-sky-100 hover:bg-sky-600/60 cursor-pointer'
                : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <Check className="h-3 w-3" />
            Assign to Model Part ({state.selectedPartId ?? 'none selected'})
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => controller?.saveCurrentAssetToPack('material')}
        className={`w-full flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
          state.dirtyMaterials
            ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
            : 'border-emerald-500/70 bg-emerald-700/45 text-emerald-100 hover:bg-emerald-600/60'
        }`}
      >
        <Save className="h-3 w-3" />
        Save Materials to Pack
      </button>
    </div>
  );
};
