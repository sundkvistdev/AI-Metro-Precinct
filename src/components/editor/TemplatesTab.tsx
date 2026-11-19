import React, { useEffect, useState } from 'react';
import {
  Brain,
  Building2,
  Car,
  Download,
  Keyboard,
  Plus,
  Save,
  Sliders,
  UserPlus,
  Volume2,
} from 'lucide-react';
import {
  AIGoalRuleDef,
  EngineConfigAsset,
  KeybindActionId,
  SimEventId,
} from '../../assets/assetTypes';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { DEFAULT_EVENT_BINDINGS, SIM_EVENT_DEFINITIONS } from '../../sim/eventBindings';
import {
  DEFAULT_KEYBINDS,
  formatKeyCode,
  KEYBIND_ACTIONS,
} from '../../sim/keybinds';
import { downloadJsonText } from './editorFileUtils';

export interface TemplatesTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

type PackSection = 'templates' | 'world_models' | 'ai_goals' | 'pack_rules';

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

const PROP_MODEL_KEYS: Array<{
  key: keyof NonNullable<EngineConfigAsset['world']['propModels']>;
  label: string;
}> = [
  { key: 'tree', label: 'Tree' },
  { key: 'streetlight', label: 'Streetlight' },
  { key: 'fountain', label: 'Fountain' },
  { key: 'sign', label: 'Precinct Sign' },
  { key: 'beacon', label: 'Roof Beacon' },
  { key: 'roadSign', label: 'Road Sign Post' },
];

const BUILDING_STYLE_KEYS = [
  'storefront',
  'brick',
  'concrete',
  'limestone',
  'office',
  'station_hall',
  'station_glass',
  'trim',
];

export const TemplatesTab: React.FC<TemplatesTabProps> = ({
  controller,
  state,
}) => {
  const [subTab, setSubTab] = useState<PackSection>('templates');
  const [sourceModel, setSourceModel] = useState('police_cruiser');
  const [carId, setCarId] = useState('interceptor_v2');
  const [carPaint, setCarPaint] = useState('#1d4ed8');
  const [carTarget, setCarTarget] = useState<
    'civilian' | 'police_bay' | 'model_only'
  >('police_bay');
  const [callsign, setCallsign] = useState('UNIT 108');
  const [liveryId, setLiveryId] = useState(state.liveryIds[0] ?? 'classic_bw');
  const [weaponKind, setWeaponKind] = useState<'pistol' | 'rifle'>('rifle');
  const [isHeavy, setIsHeavy] = useState(false);

  const [pedId, setPedId] = useState('civilian_security');
  const [shirtColor, setShirtColor] = useState('#2563eb');
  const [pantsColor, setPantsColor] = useState('#1e293b');
  const [skinColor, setSkinColor] = useState('#d8b193');
  const [hasHat, setHasHat] = useState(true);
  const [hatColor, setHatColor] = useState('#0f172a');
  const [hasVest, setHasVest] = useState(true);
  const [vestColor, setVestColor] = useState('#334155');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [capturingKeyAction, setCapturingKeyAction] =
    useState<KeybindActionId | null>(null);

  useEffect(() => {
    if (!capturingKeyAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        controller?.updateConfigKeybinds({ [capturingKeyAction]: e.code });
        setStatusMsg(
          `Updated pack keybind "${capturingKeyAction}" to ${formatKeyCode(e.code)}.`,
        );
      }
      setCapturingKeyAction(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturingKeyAction, controller]);

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

  const updateGoalRule = (
    scope: 'police' | 'pedestrian',
    idx: number,
    patch: Partial<AIGoalRuleDef>,
  ) => {
    const list = [...state.configAiGoals[scope]];
    list[idx] = { ...list[idx], ...patch };
    controller?.updateConfigAiGoals(scope, list);
  };

  const renderGoalSection = (
    scope: 'police' | 'pedestrian',
    title: string,
    goals: AIGoalRuleDef[],
  ) => (
    <div className="ui-subpanel p-2 space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-200">
        <span className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-sky-300" />
          {title}
        </span>
        <span className="text-[10px] font-mono-tabular text-zinc-400">
          {goals.length} rules
        </span>
      </div>

      {goals.length === 0 ? (
        <div className="border border-zinc-700 bg-zinc-900/70 p-2 text-[10px] text-zinc-400">
          No goal rules defined in this pack&apos;s engine_config.json.
        </div>
      ) : (
        <div className="max-h-56 overflow-y-auto space-y-1">
          {goals.map((rule, idx) => (
            <div
              key={rule.id}
              className="border border-zinc-700 bg-zinc-900/80 p-1.5 space-y-1 text-[10px]"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 font-medium text-zinc-100 cursor-pointer truncate">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) =>
                      updateGoalRule(scope, idx, { enabled: e.target.checked })
                    }
                  />
                  <span className="truncate">{rule.label || rule.id}</span>
                </label>
                <label className="flex items-center gap-1 shrink-0 font-mono-tabular">
                  <span className="text-zinc-400">Prio</span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={999}
                    value={rule.priority}
                    onChange={(e) =>
                      updateGoalRule(scope, idx, {
                        priority: Number(e.target.value),
                      })
                    }
                    className="w-12 border border-zinc-600 bg-zinc-950 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>
              {rule.params && Object.keys(rule.params).length > 0 && (
                <div className="grid grid-cols-2 gap-1 pt-0.5 font-mono-tabular">
                  {Object.entries(rule.params).map(([pk, pv]) => (
                    <label
                      key={pk}
                      className="flex items-center justify-between gap-1 bg-zinc-950/70 px-1.5 py-0.5 border border-zinc-800"
                    >
                      <span className="text-[9px] text-zinc-400 truncate">{pk}</span>
                      <input
                        type="number"
                        step={0.1}
                        value={pv}
                        onChange={(e) =>
                          updateGoalRule(scope, idx, {
                            params: {
                              ...rule.params,
                              [pk]: Number(e.target.value),
                            },
                          })
                        }
                        className="w-14 border border-zinc-700 bg-zinc-900 px-1 py-0.2 text-[10px] text-zinc-100 rounded-none"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2 text-xs">
      {/* Sub-tab Strip */}
      <div className="grid grid-cols-4 gap-0.5 border border-zinc-600 bg-zinc-900/60 p-0.5">
        {(
          [
            { id: 'templates', label: 'Prefabs', icon: <Car className="h-3 w-3" /> },
            { id: 'world_models', label: 'Props', icon: <Building2 className="h-3 w-3" /> },
            { id: 'ai_goals', label: 'AI Goals', icon: <Brain className="h-3 w-3" /> },
            { id: 'pack_rules', label: 'Config', icon: <Sliders className="h-3 w-3" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`flex items-center justify-center gap-1 py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              subTab === t.id
                ? 'bg-zinc-200 text-zinc-900 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-700/70'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {statusMsg && (
        <div className="border border-emerald-500/60 bg-emerald-950/60 p-1.5 text-[10px] text-emerald-200 rounded-none">
          {statusMsg}
        </div>
      )}

      {/* TAB 1: VEHICLE & PEDESTRIAN TEMPLATES */}
      {subTab === 'templates' && (
        <div className="space-y-2">
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
                    setCarTarget(
                      e.target.value as 'civilian' | 'police_bay' | 'model_only',
                    )
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
                    onChange={(e) =>
                      setWeaponKind(e.target.value as 'pistol' | 'rifle')
                    }
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
                  Heavy Tactical / SWAT Deployment Bay (Current Bays:{' '}
                  {state.bayCount})
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
                Create Car
              </button>
              <button
                type="button"
                onClick={() => handleCreateCar(true)}
                className="border border-sky-500/70 bg-sky-700/50 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-600 cursor-pointer rounded-none"
              >
                Create &amp; Edit
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
                Create Ped
              </button>
              <button
                type="button"
                onClick={() => handleCreatePed(true)}
                className="border border-sky-500/70 bg-sky-700/50 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-600 cursor-pointer rounded-none"
              >
                Create &amp; Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WORLD PROP & BUILDING MODEL MAPPINGS */}
      {subTab === 'world_models' && (
        <div className="space-y-2">
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-zinc-200">
              Prop Model Overrides (World)
            </div>
            <div className="space-y-1 text-[10px]">
              {PROP_MODEL_KEYS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-zinc-300 w-28 shrink-0">{label}</span>
                  <select
                    value={state.worldPropModels[key] ?? ''}
                    onChange={(e) => {
                      const next = { ...state.worldPropModels };
                      if (e.target.value) next[key] = e.target.value;
                      else delete next[key];
                      controller?.updateWorldModelMappings({ propModels: next });
                    }}
                    className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
                  >
                    <option value="">Procedural Default</option>
                    {state.modelIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="text-[11px] font-semibold text-zinc-200">
              Building Facade Model Overrides
            </div>
            <div className="space-y-1 text-[10px]">
              {BUILDING_STYLE_KEYS.map((styleKey) => (
                <label
                  key={styleKey}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-mono-tabular text-zinc-300 w-28 shrink-0">
                    {styleKey}
                  </span>
                  <select
                    value={state.worldBuildingModels[styleKey] ?? ''}
                    onChange={(e) => {
                      const next = { ...state.worldBuildingModels };
                      if (e.target.value) next[styleKey] = e.target.value;
                      else delete next[styleKey];
                      controller?.updateWorldModelMappings({
                        buildingModels: next,
                      });
                    }}
                    className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
                  >
                    <option value="">Procedural Facade</option>
                    {state.modelIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ASSET-PACK CONFIGURABLE AI GOALS */}
      {subTab === 'ai_goals' && (
        <div className="space-y-2">
          {renderGoalSection(
            'police',
            'Police AI Goal Priorities',
            state.configAiGoals.police,
          )}
          {renderGoalSection(
            'pedestrian',
            'Pedestrian AI Goal Priorities',
            state.configAiGoals.pedestrian,
          )}
        </div>
      )}

      {/* TAB 4: PACK PHYSICS, EVENT AUDIO BINDINGS, DEFAULT KEYBINDS & CONFIG EXPORT */}
      {subTab === 'pack_rules' && (
        <div className="space-y-2">
          {/* Physics Defaults */}
          <div className="ui-subpanel p-2 space-y-1.5 text-[10px]">
            <div className="text-[11px] font-semibold text-zinc-200">
              Pack Crash &amp; Debris Physics Defaults
            </div>
            <label className="flex items-center justify-between gap-2">
              <span className="text-zinc-300">Default Max Physics Parts</span>
              <input
                type="number"
                min={12}
                max={160}
                step={4}
                value={state.configPhysics.defaultMaxPhysicsParts}
                onChange={(e) =>
                  controller?.updateConfigPhysics({
                    defaultMaxPhysicsParts: Math.max(
                      12,
                      Math.min(160, Number(e.target.value)),
                    ),
                  })
                }
                className="w-20 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
              <label className="space-y-0.5">
                <span className="text-zinc-400">Debris Bounce</span>
                <input
                  type="number"
                  min={0.05}
                  max={0.9}
                  step={0.05}
                  value={state.configPhysics.debrisRestitution ?? 0.34}
                  onChange={(e) =>
                    controller?.updateConfigPhysics({
                      debrisRestitution: Number(e.target.value),
                    })
                  }
                  className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-zinc-100 rounded-none"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-zinc-400">Knockdown Speed</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  step={0.5}
                  value={state.configPhysics.debrisHumanImpactSpeed ?? 5.5}
                  onChange={(e) =>
                    controller?.updateConfigPhysics({
                      debrisHumanImpactSpeed: Number(e.target.value),
                    })
                  }
                  className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-zinc-100 rounded-none"
                />
              </label>
            </div>
          </div>

          {/* Pack Event-to-Audio Bindings */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
              <Volume2 className="h-3.5 w-3.5 text-emerald-300" />
              <span>Pack Event Audio Bindings</span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 text-[10px]">
              {SIM_EVENT_DEFINITIONS.map((ev) => {
                const cur =
                  state.configEventBindings[ev.id] ?? DEFAULT_EVENT_BINDINGS[ev.id];
                const updateEv = (patch: Partial<typeof cur>) => {
                  controller?.updateConfigEventBindings({
                    [ev.id as SimEventId]: { ...cur, ...patch },
                  });
                };
                return (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between gap-1.5 border border-zinc-700 bg-zinc-900/80 px-1.5 py-1"
                  >
                    <label className="flex items-center gap-1 text-zinc-200 truncate min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cur.enabled ?? true}
                        onChange={(e) => updateEv({ enabled: e.target.checked })}
                      />
                      <span className="truncate">{ev.label}</span>
                    </label>
                    <select
                      value={cur.audioId}
                      onChange={(e) => updateEv({ audioId: e.target.value })}
                      className="w-28 border border-zinc-600 bg-zinc-950 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
                    >
                      {state.audioIds.map((aid) => (
                        <option key={aid} value={aid}>
                          {aid}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      title="Gain Scale"
                      value={cur.gainScale ?? 1}
                      onChange={(e) =>
                        updateEv({ gainScale: Number(e.target.value) })
                      }
                      className="w-12 border border-zinc-600 bg-zinc-950 px-1 py-0.5 font-mono-tabular text-zinc-100 rounded-none"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pack Default Keybinds */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
              <Keyboard className="h-3.5 w-3.5 text-amber-300" />
              <span>Pack Default Keybinds</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 text-[10px]">
              {KEYBIND_ACTIONS.map((act) => {
                const isCap = capturingKeyAction === act.id;
                const code =
                  state.configKeybinds[act.id] ?? DEFAULT_KEYBINDS[act.id];
                return (
                  <div
                    key={act.id}
                    className="flex items-center justify-between gap-2 border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5"
                  >
                    <span className="text-zinc-200 truncate">{act.label}</span>
                    <button
                      type="button"
                      onClick={() => setCapturingKeyAction(isCap ? null : act.id)}
                      className={`border px-2 py-0.5 font-mono-tabular text-[10px] cursor-pointer rounded-none ${
                        isCap
                          ? 'border-amber-400 bg-amber-600 text-white'
                          : 'border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                      }`}
                    >
                      {isCap ? 'Press key...' : formatKeyCode(code)}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const res = controller?.exportConfigJson();
              if (res) downloadJsonText(res.filename, res.content);
            }}
            className="w-full flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            <Download className="h-3 w-3" />
            Export engine_config.json
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => controller?.saveCurrentAssetToPack('all')}
        className="w-full flex items-center justify-center gap-1 border border-emerald-500/70 bg-emerald-700/45 py-1.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
      >
        <Save className="h-3 w-3" />
        Save Prefabs &amp; Config to Pack
      </button>
    </div>
  );
};
