import React, { useRef, useState } from 'react';
import {
  Building2,
  Download,
  GitBranch,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Signpost,
  Spline,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MapBuildingDef,
  RoadNodePriority,
  RoadNodeType,
  RoadSignStyle,
} from '../../assets/assetTypes';
import { DevEditorController, DevEditorState } from '../../sim/devEditorController';
import { downloadJsonText, readFileAsText } from './editorFileUtils';

type MapSubMode = 'objects' | 'signs' | 'roads' | 'buildings';

const FACADE_STYLES: NonNullable<MapBuildingDef['facadeStyle']>[] = [
  'storefront',
  'brick',
  'concrete',
  'limestone',
  'office',
  'station_hall',
  'station_glass',
  'trim',
  'fountain',
  'sign',
  'beacon',
];

const SIGN_STYLES: Array<{ value: RoadSignStyle; label: string }> = [
  { value: 'stop', label: 'Stop' },
  { value: 'yield', label: 'Yield' },
  { value: 'speed_limit', label: 'Speed Limit' },
  { value: 'one_way', label: 'One Way' },
  { value: 'street_name', label: 'Street Name' },
  { value: 'precinct', label: 'Precinct' },
  { value: 'custom', label: 'Custom' },
];

export interface MapWorldEditorTabProps {
  controller: DevEditorController | null;
  state: DevEditorState;
}

export const MapWorldEditorTab: React.FC<MapWorldEditorTabProps> = ({
  controller,
  state,
}) => {
  const [subMode, setSubMode] = useState<MapSubMode>('roads');
  const [newObjectModel, setNewObjectModel] = useState<string>(
    state.modelIds[0] ?? 'police_cruiser',
  );
  const [newSignStyle, setNewSignStyle] = useState<RoadSignStyle>('stop');
  const [linkTargetId, setLinkTargetId] = useState<number>(state.nodeList[0]?.id ?? 0);
  const [importError, setImportError] = useState<string | null>(null);
  const [newMapId, setNewMapId] = useState('custom_district');
  const [newMapName, setNewMapName] = useState('Custom District');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selB = state.selectedBuilding;
  const selN = state.selectedNode;
  const selE = state.selectedEdge;
  const selO = state.selectedObject;
  const selS = state.selectedSign;

  const isJoinNode = (selN?.nodeType ?? 'junction') === 'join';

  const handleImportMap = async (file: File | undefined) => {
    if (!file || !controller) return;
    try {
      setImportError(null);
      const text = await readFileAsText(file);
      controller.importMapJson(text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {/* Multi-Map Pack V3 Selector */}
      <div className="ui-subpanel p-2 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
          <span>Active Pack Map ({state.mapIds.length})</span>
          <span className="font-mono-tabular text-[10px] text-sky-300 truncate">
            {state.activeMapId}
          </span>
        </div>
        <select
          value={state.activeMapId}
          onChange={(e) => controller?.switchMap(e.target.value)}
          className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
        >
          {state.mapIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <input
            type="text"
            value={newMapId}
            onChange={(e) => setNewMapId(e.target.value)}
            placeholder="map_id"
            className="border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono-tabular text-zinc-100 rounded-none"
          />
          <input
            type="text"
            value={newMapName}
            onChange={(e) => setNewMapName(e.target.value)}
            placeholder="Map Title"
            className="border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-100 rounded-none"
          />
          <button
            type="button"
            onClick={() => controller?.createNewMap(newMapId, newMapName)}
            className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/45 px-2 py-0.5 text-[10px] font-medium text-emerald-100 hover:bg-emerald-600/65 cursor-pointer whitespace-nowrap rounded-none"
          >
            <Plus className="h-3 w-3" />
            New Map
          </button>
        </div>
      </div>

      {/* Sub-mode selector */}
      <div className="grid grid-cols-4 gap-0.5 border border-zinc-600 bg-zinc-900/60 p-0.5">
        {(
          [
            { id: 'roads', label: 'Roads', icon: <Spline className="h-3 w-3" /> },
            { id: 'objects', label: 'Objects', icon: <Package className="h-3 w-3" /> },
            { id: 'signs', label: 'Signs', icon: <Signpost className="h-3 w-3" /> },
            { id: 'buildings', label: 'Blocks', icon: <Building2 className="h-3 w-3" /> },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSubMode(m.id)}
            className={`flex items-center justify-center gap-1 py-1 text-[10px] font-medium cursor-pointer rounded-none ${
              subMode === m.id
                ? 'bg-zinc-200 text-zinc-900 font-semibold'
                : 'text-zinc-300 hover:bg-zinc-700/70'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {importError && (
        <div className="border border-red-500/70 bg-red-950/60 p-1.5 text-[10px] text-red-200 rounded-none">
          {importError}
        </div>
      )}

      {/* ROADS, NODES (JOIN vs JUNCTION, PRIORITY, OPTIONAL CROSSWALK) & CURVED EDGES */}
      {subMode === 'roads' && (
        <div className="space-y-2">
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
              <span>Road Nodes ({state.nodeList.length})</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => controller?.addRoadNode()}
                  className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
                >
                  <Plus className="h-3 w-3" />
                  Node
                </button>
                <button
                  type="button"
                  disabled={!selN}
                  onClick={() => controller?.deleteSelectedNode()}
                  className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                    selN
                      ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>

            <select
              value={state.selectedNodeId ?? ''}
              onChange={(e) =>
                controller?.selectNode(
                  e.target.value !== '' ? Number(e.target.value) : null,
                )
              }
              className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
            >
              <option value="">-- Click node sphere or pick --</option>
              {state.nodeList.map((n) => (
                <option key={n.id} value={n.id}>
                  #{n.id} [{(n.nodeType ?? 'junction').toUpperCase()}] ({n.x}, {n.z})
                  {n.hasCrosswalk ? ' · XWALK' : ''}
                  {n.priority && n.priority !== 'none'
                    ? ` · ${n.priority.toUpperCase()}`
                    : ''}
                </option>
              ))}
            </select>

            {selN && (
              <div className="space-y-1.5 pt-0.5 text-[11px] font-mono-tabular">
                <div className="grid grid-cols-3 gap-1">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-zinc-400">Node X</span>
                    <input
                      type="number"
                      step={1}
                      value={selN.x}
                      onChange={(e) =>
                        controller?.updateSelectedNodeProps({
                          x: Number(e.target.value),
                        })
                      }
                      className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-zinc-400">Node Z</span>
                    <input
                      type="number"
                      step={1}
                      value={selN.z}
                      onChange={(e) =>
                        controller?.updateSelectedNodeProps({
                          z: Number(e.target.value),
                        })
                      }
                      className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-zinc-400">Node Type</span>
                    <select
                      value={selN.nodeType ?? 'junction'}
                      onChange={(e) =>
                        controller?.updateSelectedNodeProps({
                          nodeType: e.target.value as RoadNodeType,
                        })
                      }
                      className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                    >
                      <option value="join">join (flow-through)</option>
                      <option value="junction">junction (intersection)</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-1 items-center">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-zinc-400">
                      Traffic Priority
                    </span>
                    <select
                      disabled={isJoinNode}
                      value={isJoinNode ? 'none' : selN.priority ?? 'none'}
                      onChange={(e) =>
                        controller?.updateSelectedNodeProps({
                          priority: e.target.value as RoadNodePriority,
                        })
                      }
                      className={`w-full border px-1 py-0.5 text-[10px] rounded-none ${
                        isJoinNode
                          ? 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                          : 'border-zinc-600 bg-zinc-900 text-zinc-100'
                      }`}
                    >
                      <option value="none">none (uncontrolled)</option>
                      <option value="major">major (free flow)</option>
                      <option value="yield">yield (slow check)</option>
                      <option value="stop">stop (brief pause)</option>
                    </select>
                  </label>

                  <label
                    className={`flex items-center gap-1.5 pt-4 text-[10px] ${
                      isJoinNode
                        ? 'text-zinc-500 cursor-not-allowed'
                        : 'text-zinc-200 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={isJoinNode}
                      checked={!isJoinNode && Boolean(selN.hasCrosswalk)}
                      onChange={(e) =>
                        controller?.updateSelectedNodeProps({
                          hasCrosswalk: e.target.checked,
                        })
                      }
                    />
                    Crosswalk Markings
                  </label>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      controller?.setLinkFromNode(
                        state.linkFromNodeId === selN.id ? null : selN.id,
                      )
                    }
                    className={`flex items-center gap-1 border px-2 py-0.5 text-[10px] cursor-pointer rounded-none ${
                      state.linkFromNodeId === selN.id
                        ? 'border-amber-400 bg-amber-600 text-white'
                        : 'border-zinc-500 bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                    }`}
                  >
                    <GitBranch className="h-3 w-3" />
                    {state.linkFromNodeId === selN.id
                      ? 'Click 2nd Node'
                      : 'Click-Link'}
                  </button>

                  <select
                    value={linkTargetId}
                    onChange={(e) => setLinkTargetId(Number(e.target.value))}
                    className="flex-1 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                  >
                    {state.nodeList
                      .filter((n) => n.id !== selN.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          #{n.id}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => controller?.toggleEdge(selN.id, linkTargetId)}
                    className="border border-sky-500/70 bg-sky-700/50 px-1.5 py-0.5 text-[10px] text-sky-100 hover:bg-sky-600 cursor-pointer rounded-none"
                  >
                    Link
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Edges & Bezier Curves */}
          <div className="ui-subpanel p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
              <span>Road Segments ({state.edgeList.length})</span>
              {state.selectedEdgeIndex !== null && (
                <button
                  type="button"
                  onClick={() => controller?.deleteEdge(state.selectedEdgeIndex!)}
                  className="border border-red-500/70 bg-red-800/40 px-1.5 py-0.5 text-[10px] text-red-100 hover:bg-red-700/60 cursor-pointer rounded-none"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>

            <select
              value={state.selectedEdgeIndex ?? ''}
              onChange={(e) =>
                controller?.selectEdge(
                  e.target.value !== '' ? Number(e.target.value) : null,
                )
              }
              className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
            >
              <option value="">-- Click any road segment in 3D or pick --</option>
              {state.edgeList.map((edge) => (
                <option key={edge.index} value={edge.index}>
                  Seg #{edge.index}: {edge.from} &lt;-&gt; {edge.to}{' '}
                  {edge.ctrlX !== undefined ? '[CURVED]' : '[STRAIGHT]'}
                </option>
              ))}
            </select>

            {selE && state.selectedEdgeIndex !== null && (
              <div className="space-y-1.5 pt-0.5 text-[11px] font-mono-tabular">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selE.ctrlX !== undefined && selE.ctrlZ !== undefined}
                      onChange={(e) =>
                        controller?.setEdgeCurve(
                          state.selectedEdgeIndex!,
                          e.target.checked,
                        )
                      }
                    />
                    Bezier Curve
                  </label>
                  {selE.ctrlX !== undefined && (
                    <button
                      type="button"
                      onClick={() =>
                        controller?.setEdgeCurve(state.selectedEdgeIndex!, false)
                      }
                      className="flex items-center gap-1 border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-700 cursor-pointer rounded-none"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Straighten
                    </button>
                  )}
                </div>
                {selE.ctrlX !== undefined && selE.ctrlZ !== undefined && (
                  <div className="grid grid-cols-2 gap-1">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-zinc-400">Curve Ctrl X</span>
                      <input
                        type="number"
                        step={1}
                        value={selE.ctrlX}
                        onChange={(e) =>
                          controller?.setEdgeCurve(
                            state.selectedEdgeIndex!,
                            true,
                            Number(e.target.value),
                            selE.ctrlZ,
                          )
                        }
                        className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-zinc-400">Curve Ctrl Z</span>
                      <input
                        type="number"
                        step={1}
                        value={selE.ctrlZ}
                        onChange={(e) =>
                          controller?.setEdgeCurve(
                            state.selectedEdgeIndex!,
                            true,
                            selE.ctrlX,
                            Number(e.target.value),
                          )
                        }
                        className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DYNAMIC MAP OBJECTS */}
      {subMode === 'objects' && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
            <span>Map Objects ({state.objectIds.length})</span>
            <button
              type="button"
              disabled={!selO}
              onClick={() => controller?.deleteSelectedObject()}
              className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                selO
                  ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>

          <div className="flex gap-1">
            <select
              value={newObjectModel}
              onChange={(e) => setNewObjectModel(e.target.value)}
              className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[10px] font-mono-tabular text-zinc-100 rounded-none"
            >
              {state.modelIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => controller?.addObject(newObjectModel)}
              className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
            >
              <Plus className="h-3 w-3" />
              Place
            </button>
          </div>

          <select
            value={state.selectedObjectId ?? ''}
            onChange={(e) => controller?.selectObject(e.target.value || null)}
            className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          >
            <option value="">-- Select map object --</option>
            {state.objectIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          {selO && (
            <div className="space-y-1.5 pt-1 text-[11px] font-mono-tabular">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-zinc-400">Model</span>
                <select
                  value={selO.modelRef}
                  onChange={(e) =>
                    controller?.updateSelectedObject({ modelRef: e.target.value })
                  }
                  className="flex-1 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                >
                  {state.modelIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-4 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">X</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selO.x}
                    onChange={(e) =>
                      controller?.updateSelectedObject({ x: Number(e.target.value) })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Y</span>
                  <input
                    type="number"
                    step={0.25}
                    placeholder="Auto"
                    value={selO.y ?? ''}
                    onChange={(e) =>
                      controller?.updateSelectedObject({
                        y:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Z</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selO.z}
                    onChange={(e) =>
                      controller?.updateSelectedObject({ z: Number(e.target.value) })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">RotY</span>
                  <input
                    type="number"
                    step={0.1}
                    value={Math.round((selO.rotationY ?? 0) * 100) / 100}
                    onChange={(e) =>
                      controller?.updateSelectedObject({
                        rotationY: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-1 items-end">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Scale</span>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={selO.scale ?? 1}
                    onChange={(e) =>
                      controller?.updateSelectedObject({
                        scale: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Box W</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    placeholder="Auto"
                    value={selO.hitboxWidth ?? ''}
                    onChange={(e) =>
                      controller?.updateSelectedObject({
                        hitboxWidth: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="flex items-center gap-1 pb-1 text-[10px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selO.collidable ?? true}
                    onChange={(e) =>
                      controller?.updateSelectedObject({
                        collidable: e.target.checked,
                      })
                    }
                  />
                  Solid
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ROAD SIGNS */}
      {subMode === 'signs' && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
            <span>Road Signs ({state.signIds.length})</span>
            <button
              type="button"
              disabled={!selS}
              onClick={() => controller?.deleteSelectedSign()}
              className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                selS
                  ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>

          <div className="flex gap-1">
            <select
              value={newSignStyle}
              onChange={(e) => setNewSignStyle(e.target.value as RoadSignStyle)}
              className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-100 rounded-none"
            >
              {SIGN_STYLES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => controller?.addSign(newSignStyle)}
              className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
            >
              <Plus className="h-3 w-3" />
              Sign
            </button>
          </div>

          <select
            value={state.selectedSignId ?? ''}
            onChange={(e) => controller?.selectSign(e.target.value || null)}
            className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          >
            <option value="">-- Select road sign --</option>
            {state.signIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          {selS && (
            <div className="space-y-1.5 pt-1 text-[11px] font-mono-tabular">
              <div className="grid grid-cols-2 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Title Text</span>
                  <input
                    type="text"
                    value={selS.text}
                    onChange={(e) =>
                      controller?.updateSelectedSign({ text: e.target.value }, true)
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Subtext</span>
                  <input
                    type="text"
                    value={selS.subtext ?? ''}
                    onChange={(e) =>
                      controller?.updateSelectedSign(
                        { subtext: e.target.value },
                        true,
                      )
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-5 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">X</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selS.x}
                    onChange={(e) =>
                      controller?.updateSelectedSign({ x: Number(e.target.value) })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Y</span>
                  <input
                    type="number"
                    step={0.25}
                    placeholder="Auto"
                    value={selS.y ?? ''}
                    onChange={(e) =>
                      controller?.updateSelectedSign({
                        y:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Z</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selS.z}
                    onChange={(e) =>
                      controller?.updateSelectedSign({ z: Number(e.target.value) })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">RotY</span>
                  <input
                    type="number"
                    step={0.1}
                    value={Math.round((selS.rotationY ?? 0) * 100) / 100}
                    onChange={(e) =>
                      controller?.updateSelectedSign({
                        rotationY: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">H</span>
                  <input
                    type="number"
                    step={0.2}
                    min={1.4}
                    value={selS.height ?? 2.8}
                    onChange={(e) =>
                      controller?.updateSelectedSign(
                        { height: Number(e.target.value) },
                        true,
                      )
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <select
                  value={selS.style}
                  onChange={(e) =>
                    controller?.updateSelectedSign(
                      { style: e.target.value as RoadSignStyle },
                      true,
                    )
                  }
                  className="flex-1 border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100 rounded-none"
                >
                  {SIGN_STYLES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selS.collidable ?? true}
                    onChange={(e) =>
                      controller?.updateSelectedSign({
                        collidable: e.target.checked,
                      })
                    }
                  />
                  Solid Post
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BUILDINGS */}
      {subMode === 'buildings' && (
        <div className="ui-subpanel p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
            <span>Buildings ({state.buildingIds.length})</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => controller?.addBuilding()}
                className="flex items-center gap-0.5 border border-emerald-500/70 bg-emerald-700/40 px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600/60 cursor-pointer rounded-none"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
              <button
                type="button"
                disabled={!selB}
                onClick={() => controller?.deleteSelectedBuilding()}
                className={`flex items-center gap-0.5 border px-1.5 py-0.5 text-[10px] rounded-none ${
                  selB
                    ? 'border-red-500/70 bg-red-800/40 text-red-100 hover:bg-red-700/60 cursor-pointer'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          <select
            value={state.selectedBuildingId ?? ''}
            onChange={(e) => controller?.selectBuilding(e.target.value || null)}
            className="w-full border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          >
            <option value="">-- Click building in 3D or pick --</option>
            {state.buildingIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>

          {selB && (
            <div className="space-y-1.5 pt-1 text-[11px] font-mono-tabular">
              <div className="grid grid-cols-4 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">X</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selB.cx}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        cx: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Y</span>
                  <input
                    type="number"
                    step={0.25}
                    value={selB.baseY ?? 0.12}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        baseY: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Z</span>
                  <input
                    type="number"
                    step={0.5}
                    value={selB.cz}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        cz: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">Yaw</span>
                  <input
                    type="number"
                    step={0.1}
                    value={Math.round((selB.rotationY ?? 0) * 100) / 100}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        rotationY: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-1">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">W</span>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={selB.width}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        width: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">H</span>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={selB.height}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        height: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[10px] text-zinc-400">D</span>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={selB.depth}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        depth: Number(e.target.value),
                      })
                    }
                    className="w-full border border-zinc-600 bg-zinc-900 px-1 py-0.5 text-zinc-100 rounded-none"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-1.5">
                <select
                  value={selB.facadeStyle ?? 'storefront'}
                  onChange={(e) =>
                    controller?.updateSelectedBuilding({
                      facadeStyle: e.target
                        .value as MapBuildingDef['facadeStyle'],
                    })
                  }
                  className="flex-1 border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 rounded-none"
                >
                  {FACADE_STYLES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selB.collidable}
                    onChange={(e) =>
                      controller?.updateSelectedBuilding({
                        collidable: e.target.checked,
                      })
                    }
                  />
                  Solid
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Map Pack Save & File Actions */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImportMap(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => controller?.saveCurrentAssetToPack('map')}
          className={`flex items-center justify-center gap-1 border py-1.5 text-[11px] font-medium cursor-pointer rounded-none ${
            state.dirtyMap
              ? 'border-amber-400 bg-amber-600 text-white hover:bg-amber-500'
              : 'border-emerald-500/70 bg-emerald-700/45 text-emerald-100 hover:bg-emerald-600/60'
          }`}
        >
          <Save className="h-3 w-3" />
          Save Map to Pack
        </button>
        <button
          type="button"
          onClick={() => controller?.applyMapRebuild()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1.5 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <RefreshCw className="h-3 w-3" />
          Rebuild
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Upload className="h-3 w-3" />
          Load JSON
        </button>
        <button
          type="button"
          onClick={() => {
            const res = controller?.exportMapJson();
            if (res) downloadJsonText(res.filename, res.content);
          }}
          className="flex items-center justify-center gap-1 border border-zinc-500 bg-zinc-700 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
        >
          <Download className="h-3 w-3" />
          Export JSON
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
        <MapPin className="h-3 w-3 shrink-0" />
        <span>
          Click road segments, nodes (cyan=join), curve handles, signs, or
          objects directly in 3D.
        </span>
      </div>
    </div>
  );
};
