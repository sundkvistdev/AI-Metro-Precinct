import React, { useState } from 'react';
import { Car, Plus, UserPlus } from 'lucide-react';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';

export interface TemplatesTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

const VEHICLE_TEMPLATES = [
  'police_cruiser',
  'police_suv',
  'police_van',
  'police_apc',
  'civilian_sedan',
  'civilian_hatch',
  'civilian_taxi',
  'civilian_van',
];

export const TemplatesTab: React.FC<TemplatesTabProps> = ({
  controller,
  state,
}) => {
  // Vehicle Builder state
  const [sourceModel, setSourceModel] = useState('police_cruiser');
  const [carId, setCarId] = useState('interceptor_v2');
  const [carPaint, setCarPaint] = useState('#1d4ed8');
  const [carTarget, setCarTarget] = useState<'civilian' | 'police_bay' | 'model_only'>(
    'police_bay',
  );
  const [callsign, setCallsign] = useState('UNIT 108');
  const [liveryId, setLiveryId] = useState(state.liveryIds[0] ?? 'classic_bw');
  const [weaponKind, setWeaponKind] = useState<'pistol' | 'rifle'>('rifle');
  const [isHeavy, setIsHeavy] = useState(false);

  // Ped Builder state
  const [pedId, setPedId] = useState('civilian_security');
  const [shirtColor, setShirtColor] = useState('#2563eb');
  const [pantsColor, setPantsColor] = useState('#1e293b');
  const [skinColor, setSkinColor] = useState('#d8b193');
  const [hasHat, setHasHat] = useState(true);
  const [hatColor, setHatColor] = useState('#0f172a');
  const [hasVest, setHasVest] = useState(true);
  const [vestColor, setVestColor] = useState('#334155');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const availableVehicleTemplates = VEHICLE_TEMPLATES.filter((id) =>
    state.modelIds.includes(id),
  );

  const handleCreateCar = (openInStudio: boolean) => {
    if (!controller) return;
    const created = controller.createCarFromTemplate({
      sourceModelId: sourceModel,
      newModelId: carId,
      paintColor: carPaint,
      target: carTarget,
      callsign,
      liveryId,
      weaponKind,
      isHeavyUnit: isHeavy,
      openInStudio,
    });
    if (created) {
      setStatusMsg(`Created vehicle "${created}" (${carTarget}).`);
    }
  };

  const handleCreatePed = (openInStudio: boolean) => {
    if (!controller) return;
    const created = controller.createPedFromTemplate({
      newModelId: pedId,
      shirtColor,
      pantsColor,
      skinColor,
      hasHat,
      hatColor,
      hasVest,
      vestColor,
      openInStudio,
    });
    if (created) {
      setStatusMsg(`Created pedestrian "${created}" & respawned city peds.`);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {statusMsg && (
        <div className="border border-emerald-500/60 bg-emerald-950/60 p-1.5 text-[10px] text-emerald-200 rounded-none">
          {statusMsg}
        </div>
      )}

      {/* VEHICLE / FLEET BUILDER */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
          <Car className="h-3.5 w-3.5 text-sky-300" />
          <span>Extend / Create Vehicle</span>
        </div>

        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <label className="space-y-0.5">
            <span className="text-zinc-400">Base Chassis</span>
            <select
              value={sourceModel}
              onChange={(e) => setSourceModel(e.target.value)}
              className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
            >
              {(availableVehicleTemplates.length > 0
                ? availableVehicleTemplates
                : state.modelIds
              ).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-zinc-400">New Model ID</span>
            <input
              type="text"
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
              className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1 items-center text-[10px]">
          <label className="space-y-0.5">
            <span className="text-zinc-400">Register As</span>
            <select
              value={carTarget}
              onChange={(e) =>
                setCarTarget(e.target.value as 'civilian' | 'police_bay' | 'model_only')
              }
              className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
            >
              <option value="police_bay">Police Station Bay</option>
              <option value="civilian">Civilian Traffic Pool</option>
              <option value="model_only">Model Library Only</option>
            </select>
          </label>

          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1 mt-3.5">
            <span className="text-zinc-300">Paint</span>
            <input
              type="color"
              value={carPaint}
              onChange={(e) => setCarPaint(e.target.value)}
              className="h-4 w-7 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>

        {carTarget === 'police_bay' && (
          <div className="space-y-1 border-t border-zinc-700 pt-1 text-[10px]">
            <div className="grid grid-cols-3 gap-1">
              <input
                type="text"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
                placeholder="Callsign"
                className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
              />
              <select
                value={liveryId}
                onChange={(e) => setLiveryId(e.target.value)}
                className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                {state.liveryIds.map((lid) => (
                  <option key={lid} value={lid}>
                    {lid}
                  </option>
                ))}
              </select>
              <select
                value={weaponKind}
                onChange={(e) => setWeaponKind(e.target.value as 'pistol' | 'rifle')}
                className="border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
              >
                <option value="pistol">Pistol</option>
                <option value="rifle">Rifle</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isHeavy}
                onChange={(e) => setIsHeavy(e.target.checked)}
              />
              Heavy Tactical / SWAT Deployment Bay (Current Bays: {state.bayCount})
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => handleCreateCar(false)}
            className="flex items-center justify-center gap-1 border border-emerald-500/70 bg-emerald-700/50 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-600 cursor-pointer rounded-none"
          >
            <Plus className="h-3 w-3" />
            Spawn Car
          </button>
          <button
            type="button"
            onClick={() => handleCreateCar(true)}
            className="border border-sky-500/70 bg-sky-700/50 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-600 cursor-pointer rounded-none"
          >
            Spawn & Edit Model
          </button>
        </div>
      </div>

      {/* PEDESTRIAN TEMPLATE BUILDER */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
          <UserPlus className="h-3.5 w-3.5 text-amber-300" />
          <span>Custom Pedestrian Model (Template)</span>
        </div>

        <div className="text-[10px] text-zinc-400">
          Active Ped Variants: {state.pedestrianModels.join(', ')}
        </div>

        <label className="block space-y-0.5 text-[10px]">
          <span className="text-zinc-400">New Pedestrian Model ID</span>
          <input
            type="text"
            value={pedId}
            onChange={(e) => setPedId(e.target.value)}
            className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
          />
        </label>

        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1">
            <span>Shirt</span>
            <input
              type="color"
              value={shirtColor}
              onChange={(e) => setShirtColor(e.target.value)}
              className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1">
            <span>Pants</span>
            <input
              type="color"
              value={pantsColor}
              onChange={(e) => setPantsColor(e.target.value)}
              className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1">
            <span>Skin</span>
            <input
              type="color"
              value={skinColor}
              onChange={(e) => setSkinColor(e.target.value)}
              className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1">
            <span className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={hasHat}
                onChange={(e) => setHasHat(e.target.checked)}
              />
              Add Hat
            </span>
            <input
              type="color"
              value={hatColor}
              disabled={!hasHat}
              onChange={(e) => setHatColor(e.target.value)}
              className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <label className="flex items-center justify-between border border-zinc-600 bg-zinc-900 px-1.5 py-1">
            <span className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={hasVest}
                onChange={(e) => setHasVest(e.target.checked)}
              />
              Add Vest
            </span>
            <input
              type="color"
              value={vestColor}
              disabled={!hasVest}
              onChange={(e) => setVestColor(e.target.value)}
              className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => handleCreatePed(false)}
            className="flex items-center justify-center gap-1 border border-emerald-500/70 bg-emerald-700/50 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-600 cursor-pointer rounded-none"
          >
            <Plus className="h-3 w-3" />
            Spawn Ped
          </button>
          <button
            type="button"
            onClick={() => handleCreatePed(true)}
            className="border border-sky-500/70 bg-sky-700/50 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-600 cursor-pointer rounded-none"
          >
            Spawn & Edit Model
          </button>
        </div>
      </div>
    </div>
  );
};
