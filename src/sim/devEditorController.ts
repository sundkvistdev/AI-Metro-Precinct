import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  CrashPartSpec,
  ImportedMediaAsset,
  LoadedJsonAssets,
  MapBuildingDef,
  MapDynamicObjectDef,
  MapRoadEdgeDef,
  MapRoadNodeDef,
  MapRoadSignDef,
  ModelCategory,
  ModelFlagsDef,
  ModelMaterialDef,
  ModelPartDef,
  ProceduralAudioAsset,
  ProceduralModelAsset,
  ProceduralTextureAsset,
  RoadSignStyle,
} from '../assets/assetTypes';
import {
  importMediaAudioFile,
  importMediaImageFile,
  parseSingleAudioJson,
  parseSingleMapJson,
  parseSingleModelJson,
  parseSingleTextureJson,
} from '../assets/jsonAssetLoader';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { buildJsonModel } from '../assets/jsonModelBuilder';
import { TextureRegistry } from '../assets/textureRegistry';
import { SimCameraController } from './cameraController';
import { getSurfaceHeight, sampleEdgeBezier } from './roadGraph';
import { SceneWorldHierarchy } from './sceneHierarchy';
import {
  AIDebugFlags,
  AIDebugStats,
  DevAssetTab,
  DevEditorMode,
  DevWorldTab,
  WorldEntityKind,
  WorldEntitySummary,
} from './types';

export type DevEditorTab = DevAssetTab;
export type DevGizmoMode = 'translate' | 'rotate' | 'scale';

export interface DevEditorState {
  active: boolean;
  devMode: DevEditorMode;
  worldTab: DevWorldTab;
  assetTab: DevAssetTab;
  tab: DevEditorTab;
  gizmoMode: DevGizmoMode;
  showRoadOverlay: boolean;

  // World Instance Editor
  worldEntities: WorldEntitySummary[];
  selectedWorldEntityUid: string | null;
  selectedWorldEntity: WorldEntitySummary | null;
  aiDebugFlags: AIDebugFlags;
  aiDebugStats: AIDebugStats;

  // Map: Buildings, Nodes, Curved Edges, Dynamic Objects, Road Signs
  selectedBuildingId: string | null;
  selectedBuilding: MapBuildingDef | null;
  buildingIds: string[];

  selectedNodeId: number | null;
  selectedNode: MapRoadNodeDef | null;
  linkFromNodeId: number | null;
  nodeList: Array<{
    id: number;
    x: number;
    z: number;
    label?: string;
    nodeType?: MapRoadNodeDef['nodeType'];
    hasCrosswalk?: boolean;
    priority?: MapRoadNodeDef['priority'];
  }>;

  edgeList: Array<{
    index: number;
    from: number;
    to: number;
    ctrlX?: number;
    ctrlZ?: number;
  }>;
  selectedEdgeIndex: number | null;
  selectedEdge: MapRoadEdgeDef | null;

  objectIds: string[];
  selectedObjectId: string | null;
  selectedObject: MapDynamicObjectDef | null;

  signIds: string[];
  selectedSignId: string | null;
  selectedSign: MapRoadSignDef | null;

  // Model & Hierarchy Studio
  selectedModelId: string;
  modelIds: string[];
  modelAsset: ProceduralModelAsset | null;
  partIds: string[];
  groupIds: string[];
  selectedPartId: string | null;
  selectedPart: ModelPartDef | null;
  selectedPartParentId: string | null;
  modelMaterialKeys: string[];

  // Shared Pack Materials
  materialIds: string[];
  selectedMaterialId: string;
  selectedMaterial: ModelMaterialDef | null;

  // Texture Studio & Media
  textureIds: string[];
  selectedTextureId: string;
  selectedTexture: ProceduralTextureAsset | null;
  mediaList: Array<{
    id: string;
    kind: 'image' | 'audio';
    path: string;
    width?: number;
    height?: number;
    objectUrl: string;
    filename?: string;
  }>;

  // Audio Studio
  audioIds: string[];
  selectedAudioId: string;
  selectedAudio: ProceduralAudioAsset | null;
  audioPreviewPlaying: boolean;
  audioPreviewAssetId: string | null;
  audioPreviewLoop: boolean;

  // Config template pools
  civilianVariants: string[];
  pedestrianModels: string[];
  chassisIds: string[];
  liveryIds: string[];
  bayCount: number;

  dirtyMap: boolean;
  dirtyModel: boolean;
  dirtyMaterials: boolean;
  dirtyTextures: boolean;
  dirtyAudio: boolean;
  lastSavedStatus: string | null;
}

export interface DevEditorCallbacks {
  onStateChange: (state: DevEditorState) => void;
  onRebuildMap: () => void;
  onRebuildModels: () => void;
  getBuildingMesh: (buildingId: string) => THREE.Object3D | undefined;
  getObjectMesh?: (objectId: string) => THREE.Object3D | undefined;
  getSignMesh?: (signId: string) => THREE.Object3D | undefined;
  getWorldEntities?: () => WorldEntitySummary[];
  spawnWorldEntity?: (
    kind:
      | 'police_sedan'
      | 'police_suv'
      | 'police_van'
      | 'police_apc'
      | 'civilian'
      | 'pedestrian'
      | 'crime'
      | 'pursuit',
    pos?: { x: number; z: number },
  ) => WorldEntitySummary | null;
  deleteWorldEntity?: (kind: WorldEntityKind, id: string) => boolean;
  modifyWorldEntity?: (
    kind: WorldEntityKind,
    id: string,
    action:
      | 'repair_heal'
      | 'toggle_lights'
      | 'toggle_siren'
      | 'toggle_mount'
      | 'clear_impatience'
      | 'set_transform',
    transform?: { x?: number; y?: number; z?: number; yaw?: number },
  ) => boolean;
  getWorldEntityObject?: (kind: WorldEntityKind, id: string) => THREE.Object3D | undefined;
  findWorldEntityByObject?: (
    obj: THREE.Object3D,
  ) => { kind: WorldEntityKind; id: string } | null;
  focusWorldEntity?: (kind: WorldEntityKind, id: string) => void;
  getAIDebugFlags?: () => AIDebugFlags;
  setAIDebugFlags?: (patch: Partial<AIDebugFlags>) => void;
  getAIDebugStats?: () => AIDebugStats;
}

const STUDIO_ORIGIN = new THREE.Vector3(260, 0.05, -260);
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _box3 = new THREE.Box3();
const _size3 = new THREE.Vector3();
const _center3 = new THREE.Vector3();

const DEFAULT_AI_DEBUG_FLAGS: AIDebugFlags = {
  showPolicePaths: false,
  showPursuitPaths: false,
  showTrafficRoutes: false,
  showNodesAndPriority: false,
  showAvoidanceAndStuck: false,
};

const DEFAULT_AI_DEBUG_STATS: AIDebugStats = {
  activePoliceRoutes: 0,
  activePursuits: 0,
  activeTrafficRoutes: 0,
  impatientCount: 0,
  reversingCount: 0,
  avoidingCount: 0,
  roadNodeCount: 0,
  roadEdgeCount: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

function parseWorldUid(uid: string | null): { kind: WorldEntityKind; id: string } | null {
  if (!uid) return null;
  const sep = uid.indexOf(':');
  if (sep <= 0) return null;
  return {
    kind: uid.slice(0, sep) as WorldEntityKind,
    id: uid.slice(sep + 1),
  };
}

function flattenParts(parts: ModelPartDef[]): ModelPartDef[] {
  const out: ModelPartDef[] = [];
  const walk = (list: ModelPartDef[]) => {
    for (const p of list) {
      out.push(p);
      if (p.children && p.children.length > 0) {
        walk(p.children);
      }
    }
  };
  walk(parts);
  return out;
}

function collectGroupIds(parts: ModelPartDef[]): string[] {
  const out: string[] = [];
  const walk = (list: ModelPartDef[]) => {
    for (const p of list) {
      if (p.kind === 'group') {
        out.push(p.id);
      }
      if (p.children && p.children.length > 0) {
        walk(p.children);
      }
    }
  };
  walk(parts);
  return out;
}

interface FoundPartInfo {
  part: ModelPartDef;
  parentList: ModelPartDef[];
  parentGroup: ModelPartDef | null;
  index: number;
}

function findPartInTree(
  parts: ModelPartDef[],
  id: string,
  parentGroup: ModelPartDef | null = null,
): FoundPartInfo | null {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.id === id) return { part: p, parentList: parts, parentGroup, index: i };
    if (p.children) {
      const nested = findPartInTree(p.children, id, p);
      if (nested) return nested;
    }
  }
  return null;
}

function isDescendantOrSelf(candidate: ModelPartDef, targetId: string): boolean {
  if (candidate.id === targetId) return true;
  if (!candidate.children) return false;
  for (const child of candidate.children) {
    if (isDescendantOrSelf(child, targetId)) return true;
  }
  return false;
}

function ensureUniquePartId(parts: ModelPartDef[], desired: string): string {
  const existing = new Set(flattenParts(parts).map((p) => p.id));
  if (!existing.has(desired)) return desired;
  let counter = 2;
  while (existing.has(`${desired}_${counter}`)) {
    counter++;
  }
  return `${desired}_${counter}`;
}

function clonePartDef(
  part: ModelPartDef,
  suffix: string,
  rootParts: ModelPartDef[],
): ModelPartDef {
  const nextId = ensureUniquePartId(rootParts, `${part.id}_${suffix}`);
  return {
    ...part,
    id: nextId,
    position: part.position
      ? [part.position[0] + 0.2, part.position[1], part.position[2]]
      : [0.2, 0, 0],
    rotation: part.rotation ? [...part.rotation] : undefined,
    dimensions: part.dimensions ? [...part.dimensions] : undefined,
    crashPart: part.crashPart ? { ...part.crashPart } : undefined,
    children: part.children?.map((c) => clonePartDef(c, suffix, rootParts)),
  };
}

function defaultSignTexts(style: RoadSignStyle): {
  text: string;
  subtext?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
} {
  switch (style) {
    case 'stop':
      return { text: 'STOP' };
    case 'yield':
      return { text: 'YIELD' };
    case 'speed_limit':
      return { text: '35', subtext: 'SPEED LIMIT' };
    case 'one_way':
      return { text: 'ONE WAY', subtext: '--->' };
    case 'street_name':
      return { text: 'METRO AVE', subtext: 'BLOCK 100' };
    case 'precinct':
      return { text: 'PRECINCT', subtext: 'METRO PD' };
    case 'custom':
    default:
      return {
        text: 'CAUTION',
        subtext: 'CITY ZONE',
        bgColor: '#facc15',
        textColor: '#111827',
        borderColor: '#111827',
      };
  }
}

export class DevEditorController {
  private scene: THREE.Scene;
  private hierarchy: SceneWorldHierarchy;
  private cameraController: SimCameraController;
  private domElement: HTMLElement;
  private callbacks: DevEditorCallbacks;

  private assets: LoadedJsonAssets | null = null;
  private textures: TextureRegistry | null = null;
  private audio: JsonAudioSynth | null = null;
  private unsubAudioPreview: (() => void) | null = null;

  private transform: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private mapProxy = new THREE.Object3D();
  private worldProxy = new THREE.Object3D();

  private overlayGroup = new THREE.Group();
  private nodeMarkersGroup = new THREE.Group();
  private edgeLinesGroup = new THREE.Group();
  private edgeHitGroup = new THREE.Group();
  private selectionHighlightGroup = new THREE.Group();

  private studioGroup = new THREE.Group();
  private modelPreviewHolder = new THREE.Group();
  private partHighlightBox: THREE.BoxHelper | null = null;

  private active = false;
  private devMode: DevEditorMode = 'world';
  private worldTab: DevWorldTab = 'hierarchy';
  private assetTab: DevAssetTab = 'map';
  private gizmoMode: DevGizmoMode = 'translate';
  private showRoadOverlay = true;

  private selectedWorldEntityUid: string | null = null;
  private worldRefreshTimer = 0;

  private selectedBuildingId: string | null = null;
  private selectedNodeId: number | null = null;
  private selectedEdgeIndex: number | null = null;
  private selectedObjectId: string | null = null;
  private selectedSignId: string | null = null;
  private linkFromNodeId: number | null = null;

  private selectedModelId = 'police_cruiser';
  private selectedPartId: string | null = null;
  private selectedMaterialId = '';
  private selectedTextureId = 'asphalt_road_v';
  private selectedAudioId = 'siren_wail';
  private audioLoopEnabled = true;

  private dirtyMap = false;
  private dirtyModel = false;
  private dirtyMaterials = false;
  private dirtyTextures = false;
  private dirtyAudio = false;
  private lastSavedStatus: string | null = null;

  private isDraggingGizmo = false;
  private pointerDownPos = { x: 0, y: 0 };

  private dragStartBuildingDims: { w: number; h: number; d: number } | null = null;
  private dragStartObjectScale = 1;
  private dragStartSignHeight: number | null = null;
  private dragStartPartDims: [number, number, number] | null = null;
  private attachedPartObject: THREE.Object3D | null = null;

  constructor(
    scene: THREE.Scene,
    hierarchy: SceneWorldHierarchy,
    cameraController: SimCameraController,
    domElement: HTMLElement,
    callbacks: DevEditorCallbacks,
  ) {
    this.scene = scene;
    this.hierarchy = hierarchy;
    this.cameraController = cameraController;
    this.domElement = domElement;
    this.callbacks = callbacks;

    this.mapProxy.name = 'DevMapProxy';
    this.worldProxy.name = 'DevWorldProxy';
    this.scene.add(this.mapProxy, this.worldProxy);

    this.overlayGroup.name = 'DevMapOverlay';
    this.overlayGroup.add(this.edgeHitGroup, this.edgeLinesGroup, this.nodeMarkersGroup);
    this.overlayGroup.visible = false;
    this.scene.add(this.overlayGroup);

    this.selectionHighlightGroup.name = 'DevSelectionHighlight';
    this.selectionHighlightGroup.visible = false;
    this.scene.add(this.selectionHighlightGroup);

    this.setupStudioStage();

    this.transform = new TransformControls(cameraController.camera, domElement);
    this.transform.setSpace('local');
    this.gizmoHelper = this.transform.getHelper();
    this.gizmoHelper.visible = false;
    this.scene.add(this.gizmoHelper);

    this.transform.addEventListener('dragging-changed', this.handleDraggingChanged);
    this.transform.addEventListener('objectChange', this.handleObjectChange);
    domElement.addEventListener('pointerdown', this.handlePointerDown);
    domElement.addEventListener('pointerup', this.handlePointerUp);
  }

  private setupStudioStage(): void {
    this.studioGroup.name = 'DevModelStudio';
    this.studioGroup.position.copy(STUDIO_ORIGIN);
    this.studioGroup.visible = false;

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(8.5, 9.0, 0.2, 36),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.78,
        metalness: 0.12,
      }),
    );
    pad.position.y = -0.1;
    pad.receiveShadow = true;

    const grid = new THREE.GridHelper(16, 16, 0x38bdf8, 0x475569);
    grid.position.y = 0.01;

    const rimLight = new THREE.PointLight(0xffffff, 1.4, 30);
    rimLight.position.set(5, 7, 6);

    const fillLight = new THREE.PointLight(0x93c5fd, 0.7, 25);
    fillLight.position.set(-5, 4, -5);

    this.studioGroup.add(pad, grid, rimLight, fillLight, this.modelPreviewHolder);
    this.scene.add(this.studioGroup);
  }

  public setAssets(
    assets: LoadedJsonAssets | null,
    textures: TextureRegistry | null,
    audio: JsonAudioSynth | null = null,
  ): void {
    this.unsubAudioPreview?.();
    this.unsubAudioPreview = null;

    this.assets = assets;
    this.textures = textures;
    this.audio = audio;

    if (audio) {
      this.unsubAudioPreview = audio.subscribePreviewState(() => {
        this.emitState();
      });
    }

    this.dirtyMap = false;
    this.dirtyModel = false;
    this.dirtyMaterials = false;
    this.dirtyTextures = false;
    this.dirtyAudio = false;
    this.lastSavedStatus = null;

    this.selectedBuildingId = null;
    this.selectedNodeId = null;
    this.selectedEdgeIndex = null;
    this.selectedObjectId = null;
    this.selectedSignId = null;
    this.linkFromNodeId = null;
    this.selectedPartId = null;
    this.selectedWorldEntityUid = null;

    if (assets) {
      if (!assets.materials) assets.materials = {};
      if (!assets.media) assets.media = {};

      const modelKeys = Object.keys(assets.models);
      if (modelKeys.length > 0 && !assets.models[this.selectedModelId]) {
        this.selectedModelId = modelKeys[0];
      }
      const matKeys = Object.keys(assets.materials);
      this.selectedMaterialId = matKeys[0] ?? '';

      const texKeys = Object.keys(assets.textures);
      if (texKeys.length > 0 && !assets.textures[this.selectedTextureId]) {
        this.selectedTextureId = texKeys[0];
      }
      const audioKeys = Object.keys(assets.audio);
      if (audioKeys.length > 0 && !assets.audio[this.selectedAudioId]) {
        this.selectedAudioId = audioKeys[0];
      }
      if (assets.map.buildings.length > 0) {
        this.selectedBuildingId = assets.map.buildings[0].id;
      }
    }

    this.refreshVisuals();
    this.emitState();
  }

  private clearMapSelections(): void {
    this.selectedBuildingId = null;
    this.selectedNodeId = null;
    this.selectedEdgeIndex = null;
    this.selectedObjectId = null;
    this.selectedSignId = null;
  }

  public getMediaLookup(): Record<string, ImportedMediaAsset> {
    return this.assets?.media ?? {};
  }

  public getState(): DevEditorState {
    const map = this.assets?.map;
    const model = this.assets?.models[this.selectedModelId];
    const selectedBuilding =
      map && this.selectedBuildingId
        ? map.buildings.find((b) => b.id === this.selectedBuildingId) ?? null
        : null;
    const selectedNode =
      map && this.selectedNodeId !== null
        ? map.roadNetwork.nodes.find((n) => n.id === this.selectedNodeId) ?? null
        : null;
    const selectedEdge =
      map &&
      this.selectedEdgeIndex !== null &&
      this.selectedEdgeIndex >= 0 &&
      this.selectedEdgeIndex < map.roadNetwork.edges.length
        ? map.roadNetwork.edges[this.selectedEdgeIndex]
        : null;
    const selectedObject =
      map?.objects && this.selectedObjectId
        ? map.objects.find((o) => o.id === this.selectedObjectId) ?? null
        : null;
    const selectedSign =
      map?.signs && this.selectedSignId
        ? map.signs.find((s) => s.id === this.selectedSignId) ?? null
        : null;

    const flatParts = model ? flattenParts(model.parts) : [];
    const foundPart =
      model && this.selectedPartId
        ? findPartInTree(model.parts, this.selectedPartId)
        : null;

    const materialIds = this.assets?.materials ? Object.keys(this.assets.materials) : [];
    const activeMatId =
      this.selectedMaterialId && this.assets?.materials?.[this.selectedMaterialId]
        ? this.selectedMaterialId
        : materialIds[0] ?? '';
    const selectedMaterial = activeMatId
      ? this.assets?.materials?.[activeMatId] ?? null
      : null;

    const textureIds = this.assets ? Object.keys(this.assets.textures) : [];
    const selectedTexture = this.assets?.textures[this.selectedTextureId] ?? null;

    const audioIds = this.assets ? Object.keys(this.assets.audio) : [];
    const selectedAudio = this.assets?.audio[this.selectedAudioId] ?? null;
    const previewState = this.audio?.getPreviewState() ?? {
      playing: false,
      assetId: null,
      loop: this.audioLoopEnabled,
    };

    const mediaList = this.assets?.media
      ? Object.values(this.assets.media).map((m) => ({
          id: m.id,
          kind: m.kind,
          path: m.path,
          width: m.width,
          height: m.height,
          objectUrl: m.objectUrl,
          filename: m.filename,
        }))
      : [];

    const worldEntities = this.callbacks.getWorldEntities?.() ?? [];
    const selectedWorldEntity =
      this.selectedWorldEntityUid
        ? worldEntities.find((e) => e.uid === this.selectedWorldEntityUid) ?? null
        : null;

    const config = this.assets?.config;

    return {
      active: this.active,
      devMode: this.devMode,
      worldTab: this.worldTab,
      assetTab: this.assetTab,
      tab: this.assetTab,
      gizmoMode: this.gizmoMode,
      showRoadOverlay: this.showRoadOverlay,

      worldEntities,
      selectedWorldEntityUid: selectedWorldEntity?.uid ?? null,
      selectedWorldEntity,
      aiDebugFlags: this.callbacks.getAIDebugFlags?.() ?? DEFAULT_AI_DEBUG_FLAGS,
      aiDebugStats: this.callbacks.getAIDebugStats?.() ?? DEFAULT_AI_DEBUG_STATS,

      selectedBuildingId: selectedBuilding?.id ?? null,
      selectedBuilding: selectedBuilding ? { ...selectedBuilding } : null,
      buildingIds: map ? map.buildings.map((b) => b.id) : [],

      selectedNodeId: selectedNode?.id ?? null,
      selectedNode: selectedNode ? { ...selectedNode } : null,
      linkFromNodeId: this.linkFromNodeId,
      nodeList: map
        ? map.roadNetwork.nodes.map((n) => ({
            id: n.id,
            x: round2(n.x),
            z: round2(n.z),
            label: n.label,
            nodeType: n.nodeType ?? 'junction',
            hasCrosswalk: n.hasCrosswalk,
            priority: n.priority ?? 'none',
          }))
        : [],

      edgeList: map
        ? map.roadNetwork.edges.map((e, index) => ({
            index,
            from: e.from,
            to: e.to,
            ctrlX: e.ctrlX !== undefined ? round2(e.ctrlX) : undefined,
            ctrlZ: e.ctrlZ !== undefined ? round2(e.ctrlZ) : undefined,
          }))
        : [],
      selectedEdgeIndex: selectedEdge ? this.selectedEdgeIndex : null,
      selectedEdge: selectedEdge ? { ...selectedEdge } : null,

      objectIds: map?.objects ? map.objects.map((o) => o.id) : [],
      selectedObjectId: selectedObject?.id ?? null,
      selectedObject: selectedObject ? deepClone(selectedObject) : null,

      signIds: map?.signs ? map.signs.map((s) => s.id) : [],
      selectedSignId: selectedSign?.id ?? null,
      selectedSign: selectedSign ? deepClone(selectedSign) : null,

      selectedModelId: this.selectedModelId,
      modelIds: this.assets ? Object.keys(this.assets.models) : [],
      modelAsset: model ? deepClone(model) : null,
      partIds: flatParts.map((p) => p.id),
      groupIds: model ? collectGroupIds(model.parts) : [],
      selectedPartId: foundPart?.part.id ?? null,
      selectedPart: foundPart ? deepClone(foundPart.part) : null,
      selectedPartParentId: foundPart?.parentGroup?.id ?? null,
      modelMaterialKeys: model ? Object.keys(model.materials) : [],

      materialIds,
      selectedMaterialId: activeMatId,
      selectedMaterial: selectedMaterial ? deepClone(selectedMaterial) : null,

      textureIds,
      selectedTextureId: selectedTexture?.id ?? this.selectedTextureId,
      selectedTexture: selectedTexture ? deepClone(selectedTexture) : null,
      mediaList,

      audioIds,
      selectedAudioId: selectedAudio?.id ?? this.selectedAudioId,
      selectedAudio: selectedAudio ? deepClone(selectedAudio) : null,
      audioPreviewPlaying: previewState.playing,
      audioPreviewAssetId: previewState.assetId,
      audioPreviewLoop: this.audioLoopEnabled,

      civilianVariants: config ? [...config.world.civilianVariants] : [],
      pedestrianModels: config?.world.pedestrianModels
        ? [...config.world.pedestrianModels]
        : ['pedestrian_humanoid'],
      chassisIds: config ? Object.keys(config.vehicles.chassis) : [],
      liveryIds: config ? Object.keys(config.vehicles.liveries) : [],
      bayCount: config ? config.vehicles.stationBays.length : 0,

      dirtyMap: this.dirtyMap,
      dirtyModel: this.dirtyModel,
      dirtyMaterials: this.dirtyMaterials,
      dirtyTextures: this.dirtyTextures,
      dirtyAudio: this.dirtyAudio,
      lastSavedStatus: this.lastSavedStatus,
    };
  }

  private emitState(): void {
    this.callbacks.onStateChange(this.getState());
  }

  public setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.cameraController.setDevEditorActive(active);
    if (!active) {
      this.cameraController.setGizmoDragging(false);
      this.audio?.stopAudioPreview();
    } else if (this.devMode === 'asset' && this.assetTab === 'model') {
      this.focusModelStage();
    }
    this.refreshVisuals();
    this.emitState();
  }

  public setMode(mode: DevEditorMode): void {
    if (this.devMode === mode) return;
    const prevWasModelStage = this.devMode === 'asset' && this.assetTab === 'model';
    this.devMode = mode;
    if (mode === 'asset' && this.assetTab === 'model') {
      this.focusModelStage();
    } else if (prevWasModelStage) {
      this.cameraController.resetView();
    }
    this.refreshVisuals();
    this.emitState();
  }

  public setWorldTab(tab: DevWorldTab): void {
    this.devMode = 'world';
    this.worldTab = tab;
    this.refreshVisuals();
    this.emitState();
  }

  public setAssetTab(tab: DevAssetTab): void {
    const prevTab = this.assetTab;
    this.devMode = 'asset';
    this.assetTab = tab;
    if (tab === 'model') {
      this.focusModelStage();
    } else if (prevTab === 'model' || tab === 'map') {
      this.cameraController.resetView();
    }
    this.refreshVisuals();
    this.emitState();
  }

  public setTab(tab: DevEditorTab): void {
    this.setAssetTab(tab);
  }

  public setGizmoMode(mode: DevGizmoMode): void {
    this.gizmoMode = mode;
    this.attachGizmo();
    this.emitState();
  }

  public setShowRoadOverlay(show: boolean): void {
    this.showRoadOverlay = show;
    this.overlayGroup.visible =
      this.active && this.devMode === 'asset' && this.assetTab === 'map' && this.showRoadOverlay;
    this.emitState();
  }

  public focusModelStage(): void {
    this.cameraController.focusTarget(
      STUDIO_ORIGIN.x,
      STUDIO_ORIGIN.y + 0.9,
      STUDIO_ORIGIN.z,
      STUDIO_ORIGIN.x + 6.5,
      STUDIO_ORIGIN.y + 4.4,
      STUDIO_ORIGIN.z + 7.2,
    );
  }

  // --- World Instance Mode Operations ---

  public refreshWorldEntities(): void {
    this.emitState();
  }

  public selectWorldEntity(kind: WorldEntityKind | null, id: string | null): void {
    this.selectedWorldEntityUid = kind && id ? `${kind}:${id}` : null;
    this.refreshWorldSelectionHighlight();
    this.attachGizmo();
    this.emitState();
  }

  public spawnWorldEntity(
    kind:
      | 'police_sedan'
      | 'police_suv'
      | 'police_van'
      | 'police_apc'
      | 'civilian'
      | 'pedestrian'
      | 'crime'
      | 'pursuit',
  ): WorldEntitySummary | null {
    const target = this.cameraController.controls.target;
    const spawned = this.callbacks.spawnWorldEntity?.(kind, {
      x: round2(target.x),
      z: round2(target.z),
    });
    if (spawned) {
      this.selectedWorldEntityUid = spawned.uid;
      this.refreshWorldSelectionHighlight();
      this.attachGizmo();
      this.emitState();
    }
    return spawned ?? null;
  }

  public deleteSelectedWorldEntity(): void {
    const parsed = parseWorldUid(this.selectedWorldEntityUid);
    if (!parsed) return;
    const ok = this.callbacks.deleteWorldEntity?.(parsed.kind, parsed.id);
    if (ok) {
      this.selectedWorldEntityUid = null;
      this.clearGroup(this.selectionHighlightGroup);
      this.attachGizmo();
      this.emitState();
    }
  }

  public modifySelectedWorldEntity(
    action:
      | 'repair_heal'
      | 'toggle_lights'
      | 'toggle_siren'
      | 'toggle_mount'
      | 'clear_impatience',
  ): void {
    const parsed = parseWorldUid(this.selectedWorldEntityUid);
    if (!parsed) return;
    if (this.callbacks.modifyWorldEntity?.(parsed.kind, parsed.id, action)) {
      this.refreshWorldSelectionHighlight();
      this.emitState();
    }
  }

  public focusSelectedWorldEntity(): void {
    const parsed = parseWorldUid(this.selectedWorldEntityUid);
    if (!parsed) return;
    this.callbacks.focusWorldEntity?.(parsed.kind, parsed.id);
  }

  public setAIDebugFlags(patch: Partial<AIDebugFlags>): void {
    this.callbacks.setAIDebugFlags?.(patch);
    this.emitState();
  }

  private refreshWorldSelectionHighlight(): void {
    this.clearGroup(this.selectionHighlightGroup);
    const parsed = parseWorldUid(this.selectedWorldEntityUid);
    if (!parsed) return;
    const obj = this.callbacks.getWorldEntityObject?.(parsed.kind, parsed.id);
    if (obj) {
      this.refreshMeshHighlight(obj, 0x38bdf8);
    }
  }

  // --- Map Editor: Buildings ---

  public selectBuilding(id: string | null): void {
    this.clearMapSelections();
    this.selectedBuildingId = id;
    this.refreshMapOverlay();
    this.attachGizmo();
    this.emitState();
  }

  public addBuilding(): void {
    const map = this.assets?.map;
    if (!map) return;
    const target = this.cameraController.controls.target;
    const id = `bldg_${Date.now().toString(36).slice(-5)}`;
    const b: MapBuildingDef = {
      id,
      kind: 'building',
      cx: round2(THREE.MathUtils.clamp(target.x, -map.bounds.halfSize, map.bounds.halfSize)),
      cz: round2(THREE.MathUtils.clamp(target.z, -map.bounds.halfSize, map.bounds.halfSize)),
      width: 14,
      depth: 14,
      height: 16,
      baseY: map.surfaceHeights.sidewalk,
      rotationY: 0,
      facadeStyle: 'storefront',
      collidable: true,
      hasAwning: true,
      hasHvac: true,
    };
    map.buildings.push(b);
    this.clearMapSelections();
    this.selectedBuildingId = id;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public deleteSelectedBuilding(): void {
    const map = this.assets?.map;
    if (!map || !this.selectedBuildingId) return;
    const idx = map.buildings.findIndex((b) => b.id === this.selectedBuildingId);
    if (idx < 0) return;
    map.buildings.splice(idx, 1);
    this.selectedBuildingId = map.buildings[0]?.id ?? null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public updateSelectedBuilding(patch: Partial<MapBuildingDef>): void {
    const map = this.assets?.map;
    if (!map || !this.selectedBuildingId) return;
    const b = map.buildings.find((item) => item.id === this.selectedBuildingId);
    if (!b) return;
    const needsGeometryRebuild =
      (patch.width !== undefined && patch.width !== b.width) ||
      (patch.height !== undefined && patch.height !== b.height) ||
      (patch.depth !== undefined && patch.depth !== b.depth) ||
      (patch.facadeStyle !== undefined && patch.facadeStyle !== b.facadeStyle);
    Object.assign(b, patch);
    b.width = Math.max(1, b.width);
    b.depth = Math.max(1, b.depth);
    b.height = Math.max(1, b.height);
    this.dirtyMap = true;
    if (needsGeometryRebuild) {
      this.callbacks.onRebuildMap();
      this.refreshVisuals();
    } else {
      this.syncLiveBuildingObject(b);
      this.refreshBuildingHighlight(b);
      this.attachGizmo();
    }
    this.emitState();
  }

  // --- Map Editor: Dynamic Model Objects ---

  public selectObject(id: string | null): void {
    this.clearMapSelections();
    this.selectedObjectId = id;
    this.refreshMapOverlay();
    this.attachGizmo();
    this.emitState();
  }

  public addObject(modelRef: string): void {
    const map = this.assets?.map;
    if (!map) return;
    if (!map.objects) map.objects = [];
    const target = this.cameraController.controls.target;
    const x = round2(THREE.MathUtils.clamp(target.x, -map.bounds.halfSize, map.bounds.halfSize));
    const z = round2(THREE.MathUtils.clamp(target.z, -map.bounds.halfSize, map.bounds.halfSize));
    const id = `obj_${Date.now().toString(36).slice(-5)}`;
    const modelDef = this.assets?.models[modelRef];
    const obj: MapDynamicObjectDef = {
      id,
      modelRef,
      x,
      z,
      rotationY: 0,
      scale: 1,
      collidable: modelDef?.flags?.collidable ?? true,
      label: modelRef,
    };
    map.objects.push(obj);
    this.clearMapSelections();
    this.selectedObjectId = id;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public deleteSelectedObject(): void {
    const map = this.assets?.map;
    if (!map?.objects || !this.selectedObjectId) return;
    const idx = map.objects.findIndex((o) => o.id === this.selectedObjectId);
    if (idx < 0) return;
    map.objects.splice(idx, 1);
    this.selectedObjectId = map.objects[0]?.id ?? null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public updateSelectedObject(patch: Partial<MapDynamicObjectDef>): void {
    const map = this.assets?.map;
    if (!map?.objects || !this.selectedObjectId) return;
    const obj = map.objects.find((o) => o.id === this.selectedObjectId);
    if (!obj) return;
    const prevModelRef = obj.modelRef;
    Object.assign(obj, patch);
    if (obj.scale !== undefined) {
      obj.scale = Math.max(0.1, obj.scale);
    }
    this.dirtyMap = true;
    if (patch.modelRef !== undefined && patch.modelRef !== prevModelRef) {
      this.callbacks.onRebuildMap();
      this.refreshVisuals();
    } else {
      this.syncLiveMapObject(obj);
      this.refreshMapOverlay();
      this.attachGizmo();
    }
    this.emitState();
  }

  // --- Map Editor: Road Signs ---

  public selectSign(id: string | null): void {
    this.clearMapSelections();
    this.selectedSignId = id;
    this.refreshMapOverlay();
    this.attachGizmo();
    this.emitState();
  }

  public addSign(style: RoadSignStyle): void {
    const map = this.assets?.map;
    if (!map) return;
    if (!map.signs) map.signs = [];
    const target = this.cameraController.controls.target;
    const x = round2(THREE.MathUtils.clamp(target.x, -map.bounds.halfSize, map.bounds.halfSize));
    const z = round2(THREE.MathUtils.clamp(target.z, -map.bounds.halfSize, map.bounds.halfSize));
    const defaults = defaultSignTexts(style);
    const id = `sign_${style}_${Date.now().toString(36).slice(-4)}`;
    const sign: MapRoadSignDef = {
      id,
      style,
      text: defaults.text,
      subtext: defaults.subtext,
      x,
      z,
      rotationY: 0,
      height: 2.8,
      collidable: true,
      bgColor: defaults.bgColor,
      textColor: defaults.textColor,
      borderColor: defaults.borderColor,
    };
    map.signs.push(sign);
    this.clearMapSelections();
    this.selectedSignId = id;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public deleteSelectedSign(): void {
    const map = this.assets?.map;
    if (!map?.signs || !this.selectedSignId) return;
    const idx = map.signs.findIndex((s) => s.id === this.selectedSignId);
    if (idx < 0) return;
    map.signs.splice(idx, 1);
    this.selectedSignId = map.signs[0]?.id ?? null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public updateSelectedSign(
    patch: Partial<MapRoadSignDef>,
    needsVisualRebuild = false,
  ): void {
    const map = this.assets?.map;
    if (!map?.signs || !this.selectedSignId) return;
    const sign = map.signs.find((s) => s.id === this.selectedSignId);
    if (!sign) return;
    Object.assign(sign, patch);
    if (sign.height !== undefined) {
      sign.height = Math.max(1.2, Math.min(8, sign.height));
    }
    this.dirtyMap = true;
    if (needsVisualRebuild) {
      this.callbacks.onRebuildMap();
      this.refreshVisuals();
    } else {
      this.syncLiveSignObject(sign);
      this.refreshMapOverlay();
      this.attachGizmo();
    }
    this.emitState();
  }

  // --- Map Editor: Road Nodes & Curved Edges ---

  public selectNode(id: number | null): void {
    this.clearMapSelections();
    this.selectedNodeId = id;
    this.refreshMapOverlay();
    this.attachGizmo();
    this.emitState();
  }

  public selectEdge(index: number | null): void {
    this.clearMapSelections();
    const edges = this.assets?.map.roadNetwork.edges ?? [];
    this.selectedEdgeIndex =
      index !== null && index >= 0 && index < edges.length ? index : null;
    this.refreshMapOverlay();
    this.attachGizmo();
    this.emitState();
  }

  public setEdgeCurve(
    index: number,
    enabled: boolean,
    ctrlX?: number,
    ctrlZ?: number,
  ): void {
    const map = this.assets?.map;
    if (!map || index < 0 || index >= map.roadNetwork.edges.length) return;
    const edge = map.roadNetwork.edges[index];
    if (!enabled) {
      delete edge.ctrlX;
      delete edge.ctrlZ;
    } else if (ctrlX !== undefined && ctrlZ !== undefined) {
      edge.ctrlX = round2(ctrlX);
      edge.ctrlZ = round2(ctrlZ);
    } else {
      const a = map.roadNetwork.nodes.find((n) => n.id === edge.from);
      const b = map.roadNetwork.nodes.find((n) => n.id === edge.to);
      if (a && b) {
        const mx = (a.x + b.x) * 0.5;
        const mz = (a.z + b.z) * 0.5;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const offset = Math.min(18, Math.max(8, len * 0.28));
        edge.ctrlX = round2(mx - (dz / len) * offset);
        edge.ctrlZ = round2(mz + (dx / len) * offset);
      } else {
        edge.ctrlX = 0;
        edge.ctrlZ = 0;
      }
    }
    this.selectedEdgeIndex = index;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public deleteEdge(index: number): void {
    const map = this.assets?.map;
    if (!map || index < 0 || index >= map.roadNetwork.edges.length) return;
    map.roadNetwork.edges.splice(index, 1);
    if (this.selectedEdgeIndex === index) {
      this.selectedEdgeIndex = null;
    } else if (this.selectedEdgeIndex !== null && this.selectedEdgeIndex > index) {
      this.selectedEdgeIndex -= 1;
    }
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public setLinkFromNode(id: number | null): void {
    this.linkFromNodeId = id;
    this.refreshMapOverlay();
    this.emitState();
  }

  public addRoadNode(): void {
    const map = this.assets?.map;
    if (!map) return;
    const target = this.cameraController.controls.target;
    const maxId = map.roadNetwork.nodes.reduce((acc, n) => Math.max(acc, n.id), -1);
    const newId = maxId + 1;
    const node: MapRoadNodeDef = {
      id: newId,
      x: round2(THREE.MathUtils.clamp(target.x, -map.bounds.halfSize, map.bounds.halfSize)),
      z: round2(THREE.MathUtils.clamp(target.z, -map.bounds.halfSize, map.bounds.halfSize)),
      label: `Node ${newId}`,
      nodeType: 'junction',
      hasCrosswalk: false,
      priority: 'none',
    };
    map.roadNetwork.nodes.push(node);
    if (this.selectedNodeId !== null) {
      map.roadNetwork.edges.push({ from: this.selectedNodeId, to: newId });
    }
    this.clearMapSelections();
    this.selectedNodeId = newId;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public deleteSelectedNode(): void {
    const map = this.assets?.map;
    if (!map || this.selectedNodeId === null) return;
    const nid = this.selectedNodeId;
    map.roadNetwork.nodes = map.roadNetwork.nodes.filter((n) => n.id !== nid);
    map.roadNetwork.edges = map.roadNetwork.edges.filter(
      (e) => e.from !== nid && e.to !== nid,
    );
    if (this.linkFromNodeId === nid) this.linkFromNodeId = null;
    this.selectedNodeId = map.roadNetwork.nodes[0]?.id ?? null;
    this.selectedEdgeIndex = null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public updateSelectedNode(x: number, z: number, label?: string): void {
    this.updateSelectedNodeProps({ x, z, label });
  }

  public updateSelectedNodeProps(patch: Partial<MapRoadNodeDef>): void {
    const map = this.assets?.map;
    if (!map || this.selectedNodeId === null) return;
    const node = map.roadNetwork.nodes.find((n) => n.id === this.selectedNodeId);
    if (!node) return;
    if (patch.x !== undefined) node.x = round2(patch.x);
    if (patch.z !== undefined) node.z = round2(patch.z);
    if (patch.label !== undefined) node.label = patch.label;
    if (patch.nodeType !== undefined) {
      node.nodeType = patch.nodeType;
      if (patch.nodeType === 'join') {
        node.hasCrosswalk = false;
        node.priority = 'none';
      }
    }
    if (patch.hasCrosswalk !== undefined) node.hasCrosswalk = patch.hasCrosswalk;
    if (patch.priority !== undefined) node.priority = patch.priority;

    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public toggleEdge(fromId: number, toId: number): void {
    const map = this.assets?.map;
    if (!map || fromId === toId) return;
    const idx = map.roadNetwork.edges.findIndex(
      (e) =>
        (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId),
    );
    if (idx >= 0) {
      map.roadNetwork.edges.splice(idx, 1);
      if (this.selectedEdgeIndex === idx) this.selectedEdgeIndex = null;
    } else {
      map.roadNetwork.edges.push({ from: fromId, to: toId });
      this.selectedEdgeIndex = map.roadNetwork.edges.length - 1;
    }
    this.linkFromNodeId = null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public applyMapRebuild(): void {
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public importMapJson(jsonText: string): void {
    if (!this.assets) return;
    const parsed = parseSingleMapJson(jsonText);
    this.assets.map = parsed;
    this.clearMapSelections();
    this.selectedBuildingId = parsed.buildings[0]?.id ?? null;
    this.dirtyMap = true;
    this.callbacks.onRebuildMap();
    this.refreshVisuals();
    this.emitState();
  }

  public exportMapJson(): { filename: string; content: string } | null {
    if (!this.assets?.map) return null;
    return {
      filename: `${this.assets.map.id || 'custom_map'}.json`,
      content: JSON.stringify(this.assets.map, null, 2),
    };
  }

  // --- Shared Pack Materials ---

  public selectPackMaterial(id: string): void {
    if (!this.assets?.materials?.[id]) return;
    this.selectedMaterialId = id;
    this.emitState();
  }

  public upsertPackMaterial(
    key: string,
    def: ModelMaterialDef,
    renameFrom?: string,
  ): void {
    if (!this.assets) return;
    if (!this.assets.materials) this.assets.materials = {};
    const cleanKey = key.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanKey) return;
    if (renameFrom && renameFrom !== cleanKey && this.assets.materials[renameFrom]) {
      delete this.assets.materials[renameFrom];
    }
    this.assets.materials[cleanKey] = { ...def };
    this.selectedMaterialId = cleanKey;
    this.dirtyMaterials = true;
    if (this.devMode === 'asset' && this.assetTab === 'model') {
      this.refreshModelPreview();
      this.attachGizmo();
    }
    this.emitState();
  }

  public deletePackMaterial(key: string): void {
    if (!this.assets?.materials?.[key]) return;
    delete this.assets.materials[key];
    const remaining = Object.keys(this.assets.materials);
    this.selectedMaterialId = remaining[0] ?? '';
    this.dirtyMaterials = true;
    this.emitState();
  }

  public applyPackMaterialToSelectedPart(matId: string): void {
    if (!this.assets?.materials?.[matId]) return;
    const model = this.assets.models[this.selectedModelId];
    if (!model || !this.selectedPartId) return;
    const found = findPartInTree(model.parts, this.selectedPartId);
    if (!found) return;
    model.materials[matId] = { ...this.assets.materials[matId] };
    found.part.materialRef = matId;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  // --- Model Editor & Hierarchy Operations ---

  public selectModel(modelId: string): void {
    if (!this.assets?.models[modelId]) return;
    this.selectedModelId = modelId;
    const parts = flattenParts(this.assets.models[modelId].parts);
    this.selectedPartId = parts[0]?.id ?? null;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public createNewModel(id: string, category: ModelCategory = 'prop'): void {
    if (!this.assets) return;
    const cleanId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return;
    const uniqueId = uniqueKeyOrNext(this.assets.models, cleanId);
    const model: ProceduralModelAsset = {
      format: 'jdata-model-v2',
      id: uniqueId,
      seed: Math.floor(100000 + Math.random() * 899999),
      flags: {
        category,
        collidable: true,
        destructible: false,
        castShadow: true,
        receiveShadow: true,
        customTags: [],
      },
      materials: {
        primary: {
          type: 'standard',
          color: '#64748b',
          roughness: 0.55,
          metalness: 0.15,
        },
        accent: {
          type: 'standard',
          color: '#38bdf8',
          roughness: 0.35,
          metalness: 0.3,
        },
      },
      parts: [
        {
          id: 'root_group',
          kind: 'group',
          position: [0, 0, 0],
          children: [
            {
              id: 'base_block',
              kind: 'box',
              dimensions: [1.0, 1.0, 1.0],
              position: [0, 0.5, 0],
              materialRef: 'primary',
              castShadow: true,
              receiveShadow: true,
            },
          ],
        },
      ],
    };
    this.assets.models[uniqueId] = model;
    this.assets.manifest.models[uniqueId] = `models/${uniqueId}.json`;
    this.selectedModelId = uniqueId;
    this.selectedPartId = 'base_block';
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public cloneCurrentModel(newId: string): void {
    if (!this.assets) return;
    const src = this.assets.models[this.selectedModelId];
    if (!src) return;
    const cleanId = newId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return;
    const finalId = uniqueKeyOrNext(this.assets.models, cleanId);
    const cloned = deepClone(src);
    cloned.id = finalId;
    this.assets.models[finalId] = cloned;
    this.assets.manifest.models[finalId] = `models/${finalId}.json`;
    this.selectedModelId = finalId;
    const parts = flattenParts(cloned.parts);
    this.selectedPartId = parts[0]?.id ?? null;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public importModelJson(jsonText: string): void {
    if (!this.assets) return;
    const parsed = parseSingleModelJson(jsonText);
    this.assets.models[parsed.id] = parsed;
    this.assets.manifest.models[parsed.id] = `models/${parsed.id}.json`;
    this.selectedModelId = parsed.id;
    const parts = flattenParts(parsed.parts);
    this.selectedPartId = parts[0]?.id ?? null;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public selectPart(partId: string | null): void {
    this.selectedPartId = partId;
    this.attachGizmo();
    this.emitState();
  }

  public addPart(
    kind: 'group' | 'box' | 'cylinder' | 'sphere' | 'plane',
    targetParentId?: string | null,
  ): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return;
    const matKeys = Object.keys(model.materials);
    const baseId = `${kind}_${Date.now().toString(36).slice(-4)}`;
    const id = ensureUniquePartId(model.parts, baseId);
    const newPart: ModelPartDef =
      kind === 'group'
        ? {
            id,
            kind: 'group',
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            visible: true,
            children: [],
          }
        : {
            id,
            kind,
            dimensions:
              kind === 'box'
                ? [0.6, 0.4, 0.8]
                : kind === 'cylinder'
                ? [0.25, 0.25, 0.5]
                : kind === 'plane'
                ? [0.8, 0.8, 1]
                : [0.3, 12, 10],
            position: [0, 1.0, 0],
            rotation: [0, 0, 0],
            materialRef: matKeys[0],
            castShadow: true,
            receiveShadow: true,
            visible: true,
          };

    let inserted = false;
    if (targetParentId) {
      const parentFound = findPartInTree(model.parts, targetParentId);
      if (parentFound && parentFound.part.kind === 'group') {
        if (!parentFound.part.children) parentFound.part.children = [];
        parentFound.part.children.push(newPart);
        inserted = true;
      }
    } else if (this.selectedPartId) {
      const selFound = findPartInTree(model.parts, this.selectedPartId);
      if (selFound && selFound.part.kind === 'group') {
        if (!selFound.part.children) selFound.part.children = [];
        selFound.part.children.push(newPart);
        inserted = true;
      }
    }
    if (!inserted) {
      model.parts.push(newPart);
    }

    this.selectedPartId = id;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public reparentPart(partId: string, targetGroupId: string | null): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return;
    const found = findPartInTree(model.parts, partId);
    if (!found) return;
    if (targetGroupId === null) {
      found.parentList.splice(found.index, 1);
      model.parts.push(found.part);
    } else {
      if (isDescendantOrSelf(found.part, targetGroupId)) return;
      const dest = findPartInTree(model.parts, targetGroupId);
      if (!dest || dest.part.kind !== 'group') return;
      found.parentList.splice(found.index, 1);
      if (!dest.part.children) dest.part.children = [];
      dest.part.children.push(found.part);
    }
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public movePartOrder(partId: string, delta: -1 | 1): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return;
    const found = findPartInTree(model.parts, partId);
    if (!found) return;
    const nextIdx = found.index + delta;
    if (nextIdx < 0 || nextIdx >= found.parentList.length) return;
    const [item] = found.parentList.splice(found.index, 1);
    found.parentList.splice(nextIdx, 0, item);
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public duplicateSelectedPart(): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model || !this.selectedPartId) return;
    const found = findPartInTree(model.parts, this.selectedPartId);
    if (!found) return;
    const cloned = clonePartDef(found.part, Date.now().toString(36).slice(-3), model.parts);
    found.parentList.push(cloned);
    this.selectedPartId = cloned.id;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public deleteSelectedPart(): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model || !this.selectedPartId) return;
    const found = findPartInTree(model.parts, this.selectedPartId);
    if (!found) return;
    found.parentList.splice(found.index, 1);
    const remaining = flattenParts(model.parts);
    this.selectedPartId = remaining[0]?.id ?? null;
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public updateSelectedPart(patch: {
    id?: string;
    tag?: string;
    visible?: boolean;
    castShadow?: boolean;
    receiveShadow?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number];
    dimensions?: [number, number, number];
    radiusSegments?: number;
    materialRef?: string;
    crashPart?: CrashPartSpec | null;
  }): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model || !this.selectedPartId) return;
    const found = findPartInTree(model.parts, this.selectedPartId);
    if (!found) return;
    const p = found.part;

    if (patch.id !== undefined) {
      const cleanId = patch.id.trim();
      if (cleanId && cleanId !== p.id) {
        const collision = findPartInTree(model.parts, cleanId);
        if (!collision) {
          p.id = cleanId;
          this.selectedPartId = cleanId;
        }
      }
    }
    if (patch.tag !== undefined) {
      const cleanTag = patch.tag.trim();
      if (cleanTag) p.tag = cleanTag;
      else delete p.tag;
    }
    if (patch.visible !== undefined) p.visible = patch.visible;
    if (patch.castShadow !== undefined) p.castShadow = patch.castShadow;
    if (patch.receiveShadow !== undefined) p.receiveShadow = patch.receiveShadow;
    if (patch.position) p.position = [...patch.position];
    if (patch.rotation) p.rotation = [...patch.rotation];
    if (patch.dimensions) {
      p.dimensions = [
        Math.max(0.02, patch.dimensions[0]),
        Math.max(0.02, patch.dimensions[1]),
        Math.max(0.02, patch.dimensions[2]),
      ];
    }
    if (patch.radiusSegments !== undefined) {
      p.radiusSegments = Math.max(4, Math.min(48, Math.round(patch.radiusSegments)));
    }
    if (patch.materialRef !== undefined) p.materialRef = patch.materialRef || undefined;
    if (patch.crashPart === null) delete p.crashPart;
    else if (patch.crashPart !== undefined) p.crashPart = { ...patch.crashPart };

    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public updateModelFlags(patch: Partial<ModelFlagsDef>): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return;
    model.flags = { ...(model.flags ?? {}), ...patch };
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public upsertModelMaterial(
    key: string,
    def: ModelMaterialDef,
    renameFrom?: string,
  ): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return;
    const cleanKey = key.trim();
    if (!cleanKey) return;
    if (renameFrom && renameFrom !== cleanKey && model.materials[renameFrom]) {
      delete model.materials[renameFrom];
      for (const p of flattenParts(model.parts)) {
        if (p.materialRef === renameFrom) {
          p.materialRef = cleanKey;
        }
      }
    }
    model.materials[cleanKey] = { ...def };
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public deleteModelMaterial(key: string): void {
    const model = this.assets?.models[this.selectedModelId];
    if (!model || !model.materials[key]) return;
    delete model.materials[key];
    for (const p of flattenParts(model.parts)) {
      if (p.materialRef === key) {
        delete p.materialRef;
      }
    }
    this.dirtyModel = true;
    this.refreshModelPreview();
    this.attachGizmo();
    this.emitState();
  }

  public applyModelChanges(): void {
    this.callbacks.onRebuildModels();
    this.emitState();
  }

  public exportModelJson(): { filename: string; content: string } | null {
    const model = this.assets?.models[this.selectedModelId];
    if (!model) return null;
    return {
      filename: `${model.id || 'model'}.json`,
      content: JSON.stringify(model, null, 2),
    };
  }

  // --- Texture Studio & Media Operations ---

  public selectTexture(id: string): void {
    if (!this.assets?.textures[id]) return;
    this.selectedTextureId = id;
    this.emitState();
  }

  public createNewTexture(id: string): void {
    if (!this.assets || !this.textures) return;
    const cleanId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return;
    const finalId = uniqueKeyOrNext(this.assets.textures, cleanId);
    const texAsset: ProceduralTextureAsset = {
      format: 'jdata-texture-v2',
      id: finalId,
      seed: Math.floor(100000 + Math.random() * 899999),
      width: 256,
      height: 256,
      colorSpace: 'srgb',
      layers: [
        { op: 'fill', color: '#334155' },
        { op: 'grid_lines', stepX: 32, stepY: 32, lineWidth: 2, color: '#475569' },
      ],
    };
    this.assets.textures[finalId] = texAsset;
    this.assets.manifest.textures[finalId] = `textures/${finalId}.json`;
    this.textures.upsertTexture(finalId, texAsset);
    this.selectedTextureId = finalId;
    this.dirtyTextures = true;
    this.emitState();
  }

  public updateSelectedTexture(next: ProceduralTextureAsset): void {
    if (!this.assets || !this.textures) return;
    const id = next.id;
    this.assets.textures[id] = deepClone(next);
    this.textures.upsertTexture(id, next);
    this.dirtyTextures = true;
    if (this.devMode === 'asset' && this.assetTab === 'model') {
      this.refreshModelPreview();
    }
    this.emitState();
  }

  public async importImageFileToPack(file: File): Promise<ImportedMediaAsset | null> {
    if (!this.assets || !this.textures) return null;
    const media = await importMediaImageFile(file);
    if (!this.assets.media) this.assets.media = {};
    const finalMediaId = uniqueKeyOrNext(this.assets.media, media.id);
    media.id = finalMediaId;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    media.path = `media/${finalMediaId}.${ext}`;

    this.assets.media[finalMediaId] = media;
    this.assets.manifest.formatVersion = '2.0';
    if (!this.assets.manifest.media) this.assets.manifest.media = {};
    this.assets.manifest.media[finalMediaId] = {
      kind: 'image',
      path: media.path,
      mimeType: media.mimeType,
      filename: media.filename,
    };

    this.textures.setMedia(this.assets.media);

    // Also create a ready-to-use texture asset wrapping the imported image
    const w = Math.max(16, Math.min(1024, media.width ?? 256));
    const h = Math.max(16, Math.min(1024, media.height ?? 256));
    const texId = uniqueKeyOrNext(this.assets.textures, `img_${finalMediaId}`);
    const texAsset: ProceduralTextureAsset = {
      format: 'jdata-texture-v2',
      id: texId,
      seed: Math.floor(100000 + Math.random() * 899999),
      width: w,
      height: h,
      colorSpace: 'srgb',
      layers: [
        { op: 'fill', color: '#000000' },
        { op: 'image_stamp', mediaId: finalMediaId, x: 0, y: 0, w, h, opacity: 1 },
      ],
    };
    this.assets.textures[texId] = texAsset;
    this.assets.manifest.textures[texId] = `textures/${texId}.json`;
    this.textures.upsertTexture(texId, texAsset);
    this.selectedTextureId = texId;
    this.dirtyTextures = true;
    this.lastSavedStatus = `Imported image "${finalMediaId}" & created texture "${texId}"`;
    this.emitState();
    return media;
  }

  public deleteMedia(mediaId: string): void {
    if (!this.assets?.media?.[mediaId]) return;
    const existing = this.assets.media[mediaId];
    if (existing.objectUrl.startsWith('blob:')) {
      URL.revokeObjectURL(existing.objectUrl);
    }
    delete this.assets.media[mediaId];
    if (this.assets.manifest.media) {
      delete this.assets.manifest.media[mediaId];
    }
    this.textures?.setMedia(this.assets.media);
    this.audio?.setMediaAssets(this.assets.media);
    this.emitState();
  }

  public assignTextureToLivery(
    liveryId: string,
    textureId: string,
    slot: 'door' | 'stripe',
  ): void {
    if (!this.assets || !this.textures) return;
    const livery = this.assets.config.vehicles.liveries[liveryId];
    const tex = this.assets.textures[textureId];
    if (!livery || !tex) return;

    if (slot === 'door') {
      livery.doorTextureRef = textureId;
    } else {
      const stripeTexId = `livery_${liveryId}_stripe`;
      const cloned = deepClone(tex);
      cloned.id = stripeTexId;
      this.assets.textures[stripeTexId] = cloned;
      this.assets.manifest.textures[stripeTexId] = `textures/${stripeTexId}.json`;
      this.textures.upsertTexture(stripeTexId, cloned);
    }
    this.dirtyTextures = true;
    this.callbacks.onRebuildModels();
    this.lastSavedStatus = `Applied "${textureId}" to livery "${liveryId}" (${slot})`;
    this.emitState();
  }

  public importTextureJson(jsonText: string): void {
    if (!this.assets || !this.textures) return;
    const parsed = parseSingleTextureJson(jsonText);
    this.assets.textures[parsed.id] = parsed;
    this.assets.manifest.textures[parsed.id] = `textures/${parsed.id}.json`;
    this.textures.upsertTexture(parsed.id, parsed);
    this.selectedTextureId = parsed.id;
    this.dirtyTextures = true;
    this.emitState();
  }

  public exportTextureJson(): { filename: string; content: string } | null {
    const tex = this.assets?.textures[this.selectedTextureId];
    if (!tex) return null;
    return {
      filename: `${tex.id || 'texture'}.json`,
      content: JSON.stringify(tex, null, 2),
    };
  }

  public applyTexturesLive(): void {
    this.callbacks.onRebuildMap();
    this.callbacks.onRebuildModels();
    this.emitState();
  }

  // --- Audio Studio Operations ---

  public selectAudio(id: string): void {
    if (!this.assets?.audio[id]) return;
    this.selectedAudioId = id;
    this.emitState();
  }

  public createNewAudio(
    id: string,
    kind: ProceduralAudioAsset['kind'] = 'chirp_sequence',
  ): void {
    if (!this.assets) return;
    const cleanId = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return;
    const finalId = uniqueKeyOrNext(this.assets.audio, cleanId);
    const asset: ProceduralAudioAsset =
      kind === 'siren_sweep' || kind === 'siren_hilo'
        ? {
            format: 'jdata-audio-v2',
            id: finalId,
            seed: Math.floor(100000 + Math.random() * 899999),
            kind,
            gain: 0.25,
            siren: {
              waveform1: 'sawtooth',
              waveform2: 'triangle',
              detuneRatio: 1.004,
              minFreq: 580,
              maxFreq: 1380,
              sweepRateHz: 0.45,
              bandpassFreq: 1150,
              bandpassQ: 1.2,
              hiloAlternationHz: kind === 'siren_hilo' ? 1.55 : undefined,
            },
          }
        : kind === 'filtered_noise_burst'
        ? {
            format: 'jdata-audio-v2',
            id: finalId,
            seed: Math.floor(100000 + Math.random() * 899999),
            kind,
            gain: 0.65,
            noiseBurst: {
              duration: 0.35,
              envelope: {
                attack: 0.002,
                decay: 0.28,
                duration: 0.35,
                curveExponent: 2.6,
              },
              filterType: 'bandpass',
              freqStart: 2400,
              freqEnd: 420,
            },
          }
        : kind === 'audio_clip'
        ? {
            format: 'jdata-audio-v2',
            id: finalId,
            seed: Math.floor(100000 + Math.random() * 899999),
            kind: 'audio_clip',
            gain: 0.75,
            clip: {
              mediaId:
                Object.values(this.assets.media).find((m) => m.kind === 'audio')?.id ?? '',
              playbackRate: 1.0,
              loop: true,
            },
          }
        : {
            format: 'jdata-audio-v2',
            id: finalId,
            seed: Math.floor(100000 + Math.random() * 899999),
            kind: 'chirp_sequence',
            gain: 0.22,
            chirp: {
              waveform: 'triangle',
              steps: [
                { time: 0, freq: 1100 },
                { time: 0.08, freq: 1560 },
              ],
              duration: 0.22,
              endGain: 0.005,
            },
          };
    this.assets.audio[finalId] = asset;
    this.assets.manifest.audio[finalId] = `audio/${finalId}.json`;
    this.audio?.upsertAudioAsset(finalId, asset);
    this.selectedAudioId = finalId;
    this.dirtyAudio = true;
    this.emitState();
  }

  public updateSelectedAudio(next: ProceduralAudioAsset): void {
    if (!this.assets) return;
    this.assets.audio[next.id] = deepClone(next);
    this.audio?.upsertAudioAsset(next.id, next);
    this.dirtyAudio = true;
    const pState = this.audio?.getPreviewState();
    if (pState?.playing && pState.assetId === next.id) {
      this.audio?.updateAudioPreview(next, this.audioLoopEnabled);
    }
    this.emitState();
  }

  public startAudioPreview(): void {
    const asset = this.assets?.audio[this.selectedAudioId];
    if (!asset) return;
    this.audio?.startAudioPreview(asset, this.audioLoopEnabled);
    this.emitState();
  }

  public stopAudioPreview(): void {
    this.audio?.stopAudioPreview();
    this.emitState();
  }

  public setAudioPreviewLoop(loop: boolean): void {
    this.audioLoopEnabled = loop;
    const asset = this.assets?.audio[this.selectedAudioId];
    const pState = this.audio?.getPreviewState();
    if (asset && pState?.playing && pState.assetId === asset.id) {
      this.audio?.updateAudioPreview(asset, loop);
    }
    this.emitState();
  }

  public previewSelectedAudio(): void {
    const pState = this.audio?.getPreviewState();
    if (pState?.playing && pState.assetId === this.selectedAudioId) {
      this.stopAudioPreview();
    } else {
      this.startAudioPreview();
    }
  }

  public async importAudioFileToPack(file: File): Promise<ProceduralAudioAsset | null> {
    if (!this.assets) return null;
    const media = await importMediaAudioFile(file);
    if (!this.assets.media) this.assets.media = {};
    const finalMediaId = uniqueKeyOrNext(this.assets.media, media.id);
    media.id = finalMediaId;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'wav';
    media.path = `media/${finalMediaId}.${ext}`;

    this.assets.media[finalMediaId] = media;
    this.assets.manifest.formatVersion = '2.0';
    if (!this.assets.manifest.media) this.assets.manifest.media = {};
    this.assets.manifest.media[finalMediaId] = {
      kind: 'audio',
      path: media.path,
      mimeType: media.mimeType,
      filename: media.filename,
    };

    this.audio?.setMediaAssets(this.assets.media);

    const audioId = uniqueKeyOrNext(this.assets.audio, finalMediaId);
    const asset: ProceduralAudioAsset = {
      format: 'jdata-audio-v2',
      id: audioId,
      seed: Math.floor(100000 + Math.random() * 899999),
      kind: 'audio_clip',
      gain: 0.75,
      clip: {
        mediaId: finalMediaId,
        playbackRate: 1.0,
        loop: true,
      },
    };
    this.assets.audio[audioId] = asset;
    this.assets.manifest.audio[audioId] = `audio/${audioId}.json`;
    this.audio?.upsertAudioAsset(audioId, asset);
    this.selectedAudioId = audioId;
    this.dirtyAudio = true;
    this.lastSavedStatus = `Imported audio "${media.filename}" as "${audioId}"`;
    this.emitState();
    return asset;
  }

  public importAudioJson(jsonText: string): void {
    if (!this.assets) return;
    const parsed = parseSingleAudioJson(jsonText);
    this.assets.audio[parsed.id] = parsed;
    this.assets.manifest.audio[parsed.id] = `audio/${parsed.id}.json`;
    this.audio?.upsertAudioAsset(parsed.id, parsed);
    this.selectedAudioId = parsed.id;
    this.dirtyAudio = true;
    this.emitState();
  }

  public exportAudioJson(): { filename: string; content: string } | null {
    const aud = this.assets?.audio[this.selectedAudioId];
    if (!aud) return null;
    return {
      filename: `${aud.id || 'audio'}.json`,
      content: JSON.stringify(aud, null, 2),
    };
  }

  // --- Save Current Assets to Active Asset Pack (Format 2.0) ---

  public saveCurrentAssetToPack(
    scope: 'map' | 'model' | 'material' | 'texture' | 'audio' | 'all' = 'all',
  ): void {
    if (!this.assets) return;
    const manifest = this.assets.manifest;
    manifest.formatVersion = '2.0';

    if (Object.keys(this.assets.materials).length > 0 || manifest.materials) {
      manifest.materials = manifest.materials || 'materials.json';
    }

    if (scope === 'map' || scope === 'all') {
      this.callbacks.onRebuildMap();
      this.dirtyMap = false;
    }

    if (scope === 'model' || scope === 'all') {
      const m = this.assets.models[this.selectedModelId];
      if (m) {
        manifest.models[m.id] = manifest.models[m.id] || `models/${m.id}.json`;
      }
      this.callbacks.onRebuildModels();
      this.dirtyModel = false;
    }

    if (scope === 'material' || scope === 'all') {
      this.callbacks.onRebuildMap();
      this.callbacks.onRebuildModels();
      this.dirtyMaterials = false;
    }

    if (scope === 'texture' || scope === 'all') {
      const t = this.assets.textures[this.selectedTextureId];
      if (t) {
        manifest.textures[t.id] = manifest.textures[t.id] || `textures/${t.id}.json`;
        this.textures?.upsertTexture(t.id, t);
      }
      this.callbacks.onRebuildMap();
      this.callbacks.onRebuildModels();
      this.dirtyTextures = false;
    }

    if (scope === 'audio' || scope === 'all') {
      const a = this.assets.audio[this.selectedAudioId];
      if (a) {
        manifest.audio[a.id] = manifest.audio[a.id] || `audio/${a.id}.json`;
        this.audio?.upsertAudioAsset(a.id, a);
      }
      this.dirtyAudio = false;
    }

    this.refreshVisuals();
    const label = scope === 'all' ? 'all changes' : scope;
    this.lastSavedStatus = `Saved ${label} to pack "${manifest.packName}" (v2.0)`;
    this.emitState();
  }

  // --- Vehicle & Pedestrian Template Builders ---

  public createCarFromTemplate(opts: {
    sourceModelId: string;
    newModelId: string;
    paintColor: string;
    target: 'civilian' | 'police_bay' | 'model_only';
    callsign?: string;
    liveryId?: string;
    weaponKind?: 'pistol' | 'rifle';
    isHeavyUnit?: boolean;
    openInStudio?: boolean;
  }): string | null {
    if (!this.assets) return null;
    const srcModel = this.assets.models[opts.sourceModelId];
    if (!srcModel) return null;
    const cleanId = opts.newModelId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return null;
    const finalId = uniqueKeyOrNext(this.assets.models, cleanId);

    const cloned = deepClone(srcModel);
    cloned.id = finalId;
    cloned.flags = {
      ...(cloned.flags ?? {}),
      category: 'vehicle',
      collidable: true,
      castShadow: true,
      receiveShadow: true,
      isEmergencyVehicle: opts.target === 'police_bay',
      useBasePaint: opts.target === 'police_bay',
    };

    for (const [mKey, mDef] of Object.entries(cloned.materials)) {
      const lower = mKey.toLowerCase();
      if (
        lower === 'paint' ||
        lower === 'bodypaint' ||
        lower === 'black_paint' ||
        lower === 'primarypaint' ||
        lower.includes('body_paint')
      ) {
        mDef.color = opts.paintColor;
      }
    }

    this.assets.models[finalId] = cloned;
    this.assets.manifest.models[finalId] = `models/${finalId}.json`;

    const config = this.assets.config;
    if (opts.target === 'civilian') {
      if (!config.world.civilianVariants.includes(finalId)) {
        config.world.civilianVariants.push(finalId);
      }
      this.callbacks.onRebuildModels();
    } else if (opts.target === 'police_bay') {
      const baseKind =
        opts.sourceModelId === 'police_suv'
          ? 'suv'
          : opts.sourceModelId === 'police_van'
          ? 'van'
          : opts.sourceModelId === 'police_apc'
          ? 'apc'
          : 'sedan';
      const baseChassis =
        config.vehicles.chassis[baseKind] ?? config.vehicles.chassis.sedan;
      config.vehicles.chassis[finalId] = {
        ...deepClone(baseChassis),
        modelRef: finalId,
      };
      const bayIndex = config.vehicles.stationBays.length;
      const laneOffset = Math.floor(bayIndex / 7);
      const slotRow = bayIndex % 7;
      config.vehicles.stationBays.push({
        id: `unit-${bayIndex + 1}`,
        callsign: (opts.callsign || finalId.toUpperCase()).slice(0, 14),
        vehicleKind: finalId,
        liveryId:
          opts.liveryId && config.vehicles.liveries[opts.liveryId]
            ? opts.liveryId
            : 'classic_bw',
        weaponKind: opts.weaponKind ?? 'pistol',
        isHeavyUnit: Boolean(opts.isHeavyUnit),
        parkPos: [
          -92 + laneOffset * 8,
          config.world.surfaceHeights.apron,
          -58 + slotRow * 8,
        ],
        parkYaw: Math.PI / 2,
        exitRoadNodeId: 7,
      });
      this.callbacks.onRebuildModels();
    }

    this.selectedModelId = finalId;
    this.selectedPartId = flattenParts(cloned.parts)[0]?.id ?? null;
    this.dirtyModel = false;
    if (opts.openInStudio) {
      this.devMode = 'asset';
      this.assetTab = 'model';
      this.focusModelStage();
    }
    this.refreshVisuals();
    this.emitState();
    return finalId;
  }

  public createPedFromTemplate(opts: {
    newModelId: string;
    shirtColor: string;
    pantsColor: string;
    skinColor: string;
    hasHat: boolean;
    hatColor: string;
    hasVest: boolean;
    vestColor: string;
    openInStudio?: boolean;
  }): string | null {
    if (!this.assets) return null;
    const baseModel =
      this.assets.models['pedestrian_humanoid'] ??
      this.assets.models['officer_humanoid'];
    if (!baseModel) return null;

    const cleanId = opts.newModelId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleanId) return null;
    const finalId = uniqueKeyOrNext(this.assets.models, cleanId);

    const cloned = deepClone(baseModel);
    cloned.id = finalId;
    cloned.flags = {
      ...(cloned.flags ?? {}),
      category: 'humanoid',
      pedestrianTemplate: true,
      castShadow: true,
      collidable: true,
    };

    if (cloned.materials.shirt) cloned.materials.shirt.color = opts.shirtColor;
    if (cloned.materials.pants) cloned.materials.pants.color = opts.pantsColor;
    if (cloned.materials.skin) cloned.materials.skin.color = opts.skinColor;

    if (opts.hasHat) {
      cloned.materials.custom_hat = {
        type: 'standard',
        color: opts.hatColor,
        roughness: 0.65,
      };
      const headGroup = findPartInTree(cloned.parts, 'head')?.part;
      const hatPart: ModelPartDef = {
        id: ensureUniquePartId(cloned.parts, 'ped_hat'),
        kind: 'box',
        dimensions: [0.3, 0.1, 0.34],
        position: [0, 0.13, 0.02],
        materialRef: 'custom_hat',
        castShadow: true,
      };
      if (headGroup?.children) headGroup.children.push(hatPart);
      else cloned.parts.push(hatPart);
    }

    if (opts.hasVest) {
      cloned.materials.custom_vest = {
        type: 'standard',
        color: opts.vestColor,
        roughness: 0.72,
      };
      const torsoGroup = findPartInTree(cloned.parts, 'torso')?.part;
      const vestPart: ModelPartDef = {
        id: ensureUniquePartId(cloned.parts, 'ped_vest'),
        kind: 'box',
        dimensions: [0.47, 0.44, 0.29],
        position: [0, 0.31, 0],
        materialRef: 'custom_vest',
        castShadow: true,
      };
      if (torsoGroup?.children) torsoGroup.children.push(vestPart);
      else cloned.parts.push(vestPart);
    }

    this.assets.models[finalId] = cloned;
    this.assets.manifest.models[finalId] = `models/${finalId}.json`;

    const pool = this.assets.config.world.pedestrianModels ?? ['pedestrian_humanoid'];
    if (!pool.includes(finalId)) pool.push(finalId);
    this.assets.config.world.pedestrianModels = pool;

    this.callbacks.onRebuildModels();
    this.selectedModelId = finalId;
    this.selectedPartId = flattenParts(cloned.parts)[0]?.id ?? null;
    this.dirtyModel = false;
    if (opts.openInStudio) {
      this.devMode = 'asset';
      this.assetTab = 'model';
      this.focusModelStage();
    }
    this.refreshVisuals();
    this.emitState();
    return finalId;
  }

  // --- Visual Sync & Gizmo Attachment ---

  public refreshVisuals(): void {
    const inAssetMap = this.active && this.devMode === 'asset' && this.assetTab === 'map';
    const inAssetModel = this.active && this.devMode === 'asset' && this.assetTab === 'model';
    const inWorldMode = this.active && this.devMode === 'world';

    this.overlayGroup.visible = inAssetMap && this.showRoadOverlay;
    this.selectionHighlightGroup.visible = inAssetMap || inWorldMode;
    this.studioGroup.visible = inAssetModel;

    if (inAssetMap) {
      this.refreshMapOverlay();
    } else if (inAssetModel) {
      this.refreshModelPreview();
    } else if (inWorldMode) {
      this.clearGroup(this.nodeMarkersGroup);
      this.clearGroup(this.edgeLinesGroup);
      this.clearGroup(this.edgeHitGroup);
      this.refreshWorldSelectionHighlight();
    } else {
      this.clearGroup(this.selectionHighlightGroup);
    }

    this.attachGizmo();
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const child = g.children[0];
      g.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material?.dispose();
        }
      });
    }
  }

  private addEdgeHitSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    y: number,
    width: number,
    edgeIndex: number,
  ): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return;

    const hitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(2, width), 0.35, len),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hitMesh.position.set((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
    hitMesh.rotation.y = Math.atan2(dx, dz);
    hitMesh.userData.devSelectEdgeIndex = edgeIndex;
    this.edgeHitGroup.add(hitMesh);
  }

  private refreshMapOverlay(): void {
    this.clearGroup(this.nodeMarkersGroup);
    this.clearGroup(this.edgeLinesGroup);
    this.clearGroup(this.edgeHitGroup);
    this.clearGroup(this.selectionHighlightGroup);

    const map = this.assets?.map;
    if (!map) return;

    const roadY = map.surfaceHeights.road + 0.35;
    const hitWidth = Math.max(6, (map.roadNetwork.roadWidth || 12) * 0.72);
    const nodeById = new Map<number, MapRoadNodeDef>();
    for (const n of map.roadNetwork.nodes) {
      nodeById.set(n.id, n);
    }

    const normalPts: number[] = [];
    const selectedPts: number[] = [];

    map.roadNetwork.edges.forEach((e, idx) => {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) return;
      const targetArr = idx === this.selectedEdgeIndex ? selectedPts : normalPts;
      const curved = e.ctrlX !== undefined && e.ctrlZ !== undefined;
      if (!curved) {
        targetArr.push(a.x, roadY, a.z, b.x, roadY, b.z);
        this.addEdgeHitSegment(a.x, a.z, b.x, b.z, roadY, hitWidth, idx);
      } else {
        const segs = 16;
        for (let s = 0; s < segs; s++) {
          const p0 = sampleEdgeBezier(a.x, a.z, b.x, b.z, e.ctrlX!, e.ctrlZ!, s / segs);
          const p1 = sampleEdgeBezier(a.x, a.z, b.x, b.z, e.ctrlX!, e.ctrlZ!, (s + 1) / segs);
          targetArr.push(p0.x, roadY, p0.z, p1.x, roadY, p1.z);
          if (s % 2 === 0) {
            const pNext = sampleEdgeBezier(
              a.x,
              a.z,
              b.x,
              b.z,
              e.ctrlX!,
              e.ctrlZ!,
              Math.min(1, (s + 2) / segs),
            );
            this.addEdgeHitSegment(p0.x, p0.z, pNext.x, pNext.z, roadY, hitWidth, idx);
          }
        }
        const isSel = idx === this.selectedEdgeIndex;
        const handle = new THREE.Mesh(
          new THREE.SphereGeometry(isSel ? 1.4 : 1.0, 10, 8),
          new THREE.MeshBasicMaterial({ color: isSel ? 0xfbbf24 : 0xf97316 }),
        );
        handle.position.set(e.ctrlX!, roadY + 0.28, e.ctrlZ!);
        handle.userData.devEdgeIndex = idx;
        this.nodeMarkersGroup.add(handle);
      }
    });

    if (normalPts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(normalPts, 3));
      this.edgeLinesGroup.add(
        new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x38bdf8 })),
      );
    }
    if (selectedPts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(selectedPts, 3));
      this.edgeLinesGroup.add(
        new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xfbbf24 })),
      );
    }

    // Node spheres with type/priority colors + optional crosswalk ring
    for (const n of map.roadNetwork.nodes) {
      const isSelected = n.id === this.selectedNodeId;
      const isLinkSource = n.id === this.linkFromNodeId;
      let color = 0xa78bfa;
      if (isSelected) color = 0x22c55e;
      else if (isLinkSource) color = 0xf59e0b;
      else if (n.nodeType === 'join') color = 0x38bdf8;
      else if (n.priority === 'stop') color = 0xef4444;
      else if (n.priority === 'yield') color = 0xf59e0b;
      else if (n.priority === 'major') color = 0x10b981;

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected || isLinkSource ? 1.4 : 1.0, 12, 10),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.set(n.x, roadY, n.z);
      mesh.userData.devNodeId = n.id;
      this.nodeMarkersGroup.add(mesh);

      if (n.hasCrosswalk === true) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.45, 1.9, 16),
          new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(n.x, roadY + 0.05, n.z);
        this.edgeLinesGroup.add(ring);
      }
    }

    // Selected building / object / sign highlight box
    if (this.selectedBuildingId) {
      const b = map.buildings.find((item) => item.id === this.selectedBuildingId);
      if (b) this.refreshBuildingHighlight(b);
    } else if (this.selectedObjectId) {
      const mesh = this.callbacks.getObjectMesh?.(this.selectedObjectId);
      if (mesh) this.refreshMeshHighlight(mesh, 0x34d399);
    } else if (this.selectedSignId) {
      const mesh = this.callbacks.getSignMesh?.(this.selectedSignId);
      if (mesh) this.refreshMeshHighlight(mesh, 0xfbbf24);
    }
  }

  private refreshMeshHighlight(obj: THREE.Object3D, color: number): void {
    this.clearGroup(this.selectionHighlightGroup);
    obj.updateMatrixWorld(true);
    _box3.setFromObject(obj);
    _box3.getSize(_size3);
    _box3.getCenter(_center3);
    const box = new THREE.BoxGeometry(
      Math.max(0.5, _size3.x + 0.3),
      Math.max(0.5, _size3.y + 0.3),
      Math.max(0.5, _size3.z + 0.3),
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color }));
    wire.position.copy(_center3);
    this.selectionHighlightGroup.add(wire);
  }

  private refreshBuildingHighlight(b: MapBuildingDef): void {
    this.clearGroup(this.selectionHighlightGroup);
    const box = new THREE.BoxGeometry(b.width + 0.4, b.height + 0.4, b.depth + 0.4);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const wire = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x38bdf8 }),
    );
    const baseY = b.baseY ?? this.assets?.map.surfaceHeights.sidewalk ?? 0.12;
    wire.position.set(b.cx, baseY + b.height * 0.5, b.cz);
    wire.rotation.y = b.rotationY ?? 0;
    this.selectionHighlightGroup.add(wire);
  }

  private syncLiveBuildingObject(b: MapBuildingDef): void {
    const obj = this.callbacks.getBuildingMesh(b.id);
    if (!obj) return;
    const baseY = b.baseY ?? this.assets?.map.surfaceHeights.sidewalk ?? 0.12;
    const centered =
      b.facadeStyle === 'station_hall' ||
      b.facadeStyle === 'station_glass' ||
      b.facadeStyle === 'trim' ||
      b.facadeStyle === 'sign';
    obj.position.set(b.cx, centered ? baseY + b.height * 0.5 : baseY, b.cz);
    obj.rotation.y = b.rotationY ?? 0;
    if (this.dragStartBuildingDims) {
      obj.scale.set(
        b.width / Math.max(0.1, this.dragStartBuildingDims.w),
        b.height / Math.max(0.1, this.dragStartBuildingDims.h),
        b.depth / Math.max(0.1, this.dragStartBuildingDims.d),
      );
    }
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
  }

  private syncLiveMapObject(o: MapDynamicObjectDef): void {
    const mesh = this.callbacks.getObjectMesh?.(o.id);
    if (!mesh || !this.assets) return;
    const y = o.y ?? getSurfaceHeight(o.x, o.z, this.assets.map);
    mesh.position.set(o.x, y, o.z);
    mesh.rotation.y = o.rotationY ?? 0;
    mesh.scale.setScalar(o.scale ?? 1);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }

  private syncLiveSignObject(s: MapRoadSignDef): void {
    const mesh = this.callbacks.getSignMesh?.(s.id);
    if (!mesh || !this.assets) return;
    const y = s.y ?? getSurfaceHeight(s.x, s.z, this.assets.map);
    mesh.position.set(s.x, y, s.z);
    mesh.rotation.y = s.rotationY ?? 0;
    if (this.dragStartSignHeight !== null && this.dragStartSignHeight > 0) {
      mesh.scale.set(1, (s.height ?? 2.8) / this.dragStartSignHeight, 1);
    }
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }

  private refreshModelPreview(): void {
    this.transform.detach();
    this.attachedPartObject = null;
    if (this.partHighlightBox) {
      this.scene.remove(this.partHighlightBox);
      this.partHighlightBox.dispose();
      this.partHighlightBox = null;
    }
    this.clearGroup(this.modelPreviewHolder);

    if (!this.assets || !this.textures) return;
    const modelAsset: ProceduralModelAsset | undefined =
      this.assets.models[this.selectedModelId];
    if (!modelAsset) return;

    const built = buildJsonModel(
      modelAsset,
      this.textures.byId,
      undefined,
      undefined,
      this.textures.magentaFallback,
      undefined,
      this.assets.materials,
    );
    this.modelPreviewHolder.add(built.root);
    this.studioGroup.updateMatrixWorld(true);
    const flat = flattenParts(modelAsset.parts);
    if (!this.selectedPartId || !flat.some((p) => p.id === this.selectedPartId)) {
      this.selectedPartId = flat[0]?.id ?? null;
    }
  }

  private attachGizmo(): void {
    this.transform.detach();
    this.attachedPartObject = null;
    this.gizmoHelper.visible = false;
    if (this.partHighlightBox) {
      this.scene.remove(this.partHighlightBox);
      this.partHighlightBox.dispose();
      this.partHighlightBox = null;
    }

    if (!this.active || !this.assets) return;

    if (this.devMode === 'world') {
      const parsed = parseWorldUid(this.selectedWorldEntityUid);
      if (!parsed) return;
      const obj = this.callbacks.getWorldEntityObject?.(parsed.kind, parsed.id);
      if (!obj) return;
      this.worldProxy.position.copy(obj.position);
      this.worldProxy.rotation.set(0, obj.rotation.y, 0);
      this.worldProxy.scale.set(1, 1, 1);
      this.transform.setMode(this.gizmoMode === 'scale' ? 'translate' : this.gizmoMode);
      this.transform.attach(this.worldProxy);
      this.gizmoHelper.visible = true;
      return;
    }

    if (this.assetTab === 'map') {
      const map = this.assets.map;
      if (this.selectedNodeId !== null) {
        const node = map.roadNetwork.nodes.find((n) => n.id === this.selectedNodeId);
        if (!node) return;
        this.mapProxy.position.set(node.x, map.surfaceHeights.road + 0.4, node.z);
        this.mapProxy.rotation.set(0, 0, 0);
        this.mapProxy.scale.set(1, 1, 1);
        this.transform.setMode('translate');
        this.transform.attach(this.mapProxy);
        this.gizmoHelper.visible = true;
      } else if (this.selectedEdgeIndex !== null) {
        const edge = map.roadNetwork.edges[this.selectedEdgeIndex];
        if (!edge || edge.ctrlX === undefined || edge.ctrlZ === undefined) return;
        this.mapProxy.position.set(edge.ctrlX, map.surfaceHeights.road + 0.6, edge.ctrlZ);
        this.mapProxy.rotation.set(0, 0, 0);
        this.mapProxy.scale.set(1, 1, 1);
        this.transform.setMode('translate');
        this.transform.attach(this.mapProxy);
        this.gizmoHelper.visible = true;
      } else if (this.selectedObjectId && map.objects) {
        const obj = map.objects.find((o) => o.id === this.selectedObjectId);
        if (!obj) return;
        const baseY = obj.y ?? getSurfaceHeight(obj.x, obj.z, map);
        this.mapProxy.position.set(obj.x, baseY, obj.z);
        this.mapProxy.rotation.set(0, obj.rotationY ?? 0, 0);
        this.mapProxy.scale.setScalar(obj.scale ?? 1);
        this.transform.setMode(this.gizmoMode);
        this.transform.attach(this.mapProxy);
        this.gizmoHelper.visible = true;
      } else if (this.selectedSignId && map.signs) {
        const sign = map.signs.find((s) => s.id === this.selectedSignId);
        if (!sign) return;
        const baseY = sign.y ?? getSurfaceHeight(sign.x, sign.z, map);
        this.mapProxy.position.set(sign.x, baseY, sign.z);
        this.mapProxy.rotation.set(0, sign.rotationY ?? 0, 0);
        this.mapProxy.scale.set(1, 1, 1);
        this.transform.setMode(this.gizmoMode);
        this.transform.attach(this.mapProxy);
        this.gizmoHelper.visible = true;
      } else if (this.selectedBuildingId) {
        const b = map.buildings.find((item) => item.id === this.selectedBuildingId);
        if (!b) return;
        const baseY = b.baseY ?? map.surfaceHeights.sidewalk;
        this.mapProxy.position.set(b.cx, baseY + b.height * 0.5, b.cz);
        this.mapProxy.rotation.set(0, b.rotationY ?? 0, 0);
        this.mapProxy.scale.set(1, 1, 1);
        this.transform.setMode(this.gizmoMode);
        this.transform.attach(this.mapProxy);
        this.gizmoHelper.visible = true;
      }
      return;
    }

    if (this.assetTab === 'model' && this.selectedPartId) {
      const target = this.modelPreviewHolder.getObjectByName(this.selectedPartId);
      if (!target) return;
      this.attachedPartObject = target;
      this.studioGroup.updateMatrixWorld(true);
      target.updateMatrixWorld(true);
      this.transform.setMode(this.gizmoMode);
      this.transform.attach(target);
      this.gizmoHelper.visible = true;
      this.partHighlightBox = new THREE.BoxHelper(target, 0x38bdf8);
      this.partHighlightBox.update();
      this.scene.add(this.partHighlightBox);
    }
  }

  public update(dt = 0.016): void {
    if (this.partHighlightBox && this.attachedPartObject) {
      this.attachedPartObject.updateMatrixWorld(true);
      this.partHighlightBox.update();
    }

    if (this.active && this.devMode === 'world') {
      const parsed = parseWorldUid(this.selectedWorldEntityUid);
      if (parsed && !this.isDraggingGizmo) {
        const obj = this.callbacks.getWorldEntityObject?.(parsed.kind, parsed.id);
        if (obj) {
          this.worldProxy.position.copy(obj.position);
          this.worldProxy.rotation.set(0, obj.rotation.y, 0);
          this.refreshMeshHighlight(obj, 0x38bdf8);
        } else {
          this.selectedWorldEntityUid = null;
          this.clearGroup(this.selectionHighlightGroup);
          this.attachGizmo();
        }
      }

      this.worldRefreshTimer += dt;
      if (this.worldRefreshTimer >= 0.35) {
        this.worldRefreshTimer = 0;
        this.emitState();
      }
    }
  }

  private handleDraggingChanged = (e: THREE.Event): void => {
    const dragging = Boolean((e as { value?: unknown }).value);
    this.isDraggingGizmo = dragging;
    this.cameraController.setGizmoDragging(dragging);

    if (dragging) {
      if (this.devMode === 'asset' && this.assetTab === 'map' && this.assets) {
        if (this.selectedBuildingId) {
          const b = this.assets.map.buildings.find((i) => i.id === this.selectedBuildingId);
          if (b) {
            this.dragStartBuildingDims = { w: b.width, h: b.height, d: b.depth };
          }
        } else if (this.selectedObjectId && this.assets.map.objects) {
          const o = this.assets.map.objects.find((i) => i.id === this.selectedObjectId);
          if (o) {
            this.dragStartObjectScale = o.scale ?? 1;
          }
        } else if (this.selectedSignId && this.assets.map.signs) {
          const s = this.assets.map.signs.find((i) => i.id === this.selectedSignId);
          if (s) {
            this.dragStartSignHeight = s.height ?? 2.8;
          }
        }
      } else if (
        this.devMode === 'asset' &&
        this.assetTab === 'model' &&
        this.selectedPartId &&
        this.assets
      ) {
        const m = this.assets.models[this.selectedModelId];
        const found = m ? findPartInTree(m.parts, this.selectedPartId) : null;
        if (found?.part.dimensions) {
          this.dragStartPartDims = [...found.part.dimensions];
        }
      }
    } else {
      if (this.devMode === 'asset' && this.assetTab === 'map' && this.assets) {
        const wasBuildingScale = this.gizmoMode === 'scale' && this.selectedBuildingId;
        const wasSignScale = this.gizmoMode === 'scale' && this.selectedSignId;
        const wasRoadEdit = this.selectedNodeId !== null || this.selectedEdgeIndex !== null;
        this.dragStartBuildingDims = null;
        this.dragStartSignHeight = null;
        if (wasBuildingScale || wasSignScale || wasRoadEdit) {
          this.mapProxy.scale.set(1, 1, 1);
          this.callbacks.onRebuildMap();
          this.refreshVisuals();
        }
      } else if (
        this.devMode === 'asset' &&
        this.assetTab === 'model' &&
        this.gizmoMode === 'scale' &&
        this.attachedPartObject
      ) {
        this.dragStartPartDims = null;
        this.refreshModelPreview();
        this.attachGizmo();
      }
      this.emitState();
    }
  };

  private handleObjectChange = (): void => {
    if (!this.active || !this.assets) return;

    if (this.devMode === 'world') {
      const parsed = parseWorldUid(this.selectedWorldEntityUid);
      if (!parsed) return;
      this.callbacks.modifyWorldEntity?.(parsed.kind, parsed.id, 'set_transform', {
        x: round2(this.worldProxy.position.x),
        y: round2(this.worldProxy.position.y),
        z: round2(this.worldProxy.position.z),
        yaw: round3(this.worldProxy.rotation.y),
      });
      this.refreshWorldSelectionHighlight();
      return;
    }

    if (this.assetTab === 'map') {
      const map = this.assets.map;
      if (this.selectedNodeId !== null) {
        const node = map.roadNetwork.nodes.find((n) => n.id === this.selectedNodeId);
        if (!node) return;
        node.x = round2(this.mapProxy.position.x);
        node.z = round2(this.mapProxy.position.z);
        this.dirtyMap = true;
        this.refreshMapOverlay();
      } else if (this.selectedEdgeIndex !== null) {
        const edge = map.roadNetwork.edges[this.selectedEdgeIndex];
        if (!edge) return;
        edge.ctrlX = round2(this.mapProxy.position.x);
        edge.ctrlZ = round2(this.mapProxy.position.z);
        this.dirtyMap = true;
        this.refreshMapOverlay();
      } else if (this.selectedObjectId && map.objects) {
        const o = map.objects.find((item) => item.id === this.selectedObjectId);
        if (!o) return;
        o.x = round2(this.mapProxy.position.x);
        o.y = round2(this.mapProxy.position.y);
        o.z = round2(this.mapProxy.position.z);
        o.rotationY = round3(this.mapProxy.rotation.y);
        if (this.gizmoMode === 'scale') {
          const s0 = Math.max(0.01, this.dragStartObjectScale);
          const dx = Math.abs(this.mapProxy.scale.x - s0);
          const dy = Math.abs(this.mapProxy.scale.y - s0);
          const dz = Math.abs(this.mapProxy.scale.z - s0);
          const dominant =
            dx >= dy && dx >= dz
              ? this.mapProxy.scale.x
              : dy >= dz
              ? this.mapProxy.scale.y
              : this.mapProxy.scale.z;
          o.scale = round2(Math.max(0.1, Math.abs(dominant)));
          this.mapProxy.scale.setScalar(o.scale);
        }
        this.dirtyMap = true;
        this.syncLiveMapObject(o);
        const mesh = this.callbacks.getObjectMesh?.(o.id);
        if (mesh) this.refreshMeshHighlight(mesh, 0x34d399);
      } else if (this.selectedSignId && map.signs) {
        const s = map.signs.find((item) => item.id === this.selectedSignId);
        if (!s) return;
        s.x = round2(this.mapProxy.position.x);
        s.y = round2(this.mapProxy.position.y);
        s.z = round2(this.mapProxy.position.z);
        s.rotationY = round3(this.mapProxy.rotation.y);
        if (this.gizmoMode === 'scale' && this.dragStartSignHeight !== null) {
          s.height = round2(
            Math.max(1.2, Math.min(8, this.dragStartSignHeight * Math.abs(this.mapProxy.scale.y))),
          );
        }
        this.dirtyMap = true;
        this.syncLiveSignObject(s);
        const mesh = this.callbacks.getSignMesh?.(s.id);
        if (mesh) this.refreshMeshHighlight(mesh, 0xfbbf24);
      } else if (this.selectedBuildingId) {
        const b = map.buildings.find((item) => item.id === this.selectedBuildingId);
        if (!b) return;
        b.cx = round2(this.mapProxy.position.x);
        b.cz = round2(this.mapProxy.position.z);
        b.rotationY = round3(this.mapProxy.rotation.y);
        if (this.gizmoMode === 'scale' && this.dragStartBuildingDims) {
          b.width = round2(
            Math.max(1, this.dragStartBuildingDims.w * Math.abs(this.mapProxy.scale.x)),
          );
          b.height = round2(
            Math.max(1, this.dragStartBuildingDims.h * Math.abs(this.mapProxy.scale.y)),
          );
          b.depth = round2(
            Math.max(1, this.dragStartBuildingDims.d * Math.abs(this.mapProxy.scale.z)),
          );
        }
        b.baseY = round2(this.mapProxy.position.y - b.height * 0.5);
        this.dirtyMap = true;
        this.syncLiveBuildingObject(b);
        this.refreshBuildingHighlight(b);
      }
      return;
    }

    if (this.assetTab === 'model' && this.attachedPartObject && this.selectedPartId) {
      const model = this.assets.models[this.selectedModelId];
      const found = model ? findPartInTree(model.parts, this.selectedPartId) : null;
      if (!found) return;
      const p = found.part;
      p.position = [
        round3(this.attachedPartObject.position.x),
        round3(this.attachedPartObject.position.y),
        round3(this.attachedPartObject.position.z),
      ];
      p.rotation = [
        round3(this.attachedPartObject.rotation.x),
        round3(this.attachedPartObject.rotation.y),
        round3(this.attachedPartObject.rotation.z),
      ];
      if (this.gizmoMode === 'scale' && this.dragStartPartDims) {
        const sx = Math.abs(this.attachedPartObject.scale.x);
        const sy = Math.abs(this.attachedPartObject.scale.y);
        const sz = Math.abs(this.attachedPartObject.scale.z);
        if (p.kind === 'cylinder') {
          const rScale = Math.abs(sx - 1) >= Math.abs(sz - 1) ? sx : sz;
          p.dimensions = [
            round3(Math.max(0.02, this.dragStartPartDims[0] * rScale)),
            round3(Math.max(0.02, this.dragStartPartDims[1] * rScale)),
            round3(Math.max(0.02, this.dragStartPartDims[2] * sy)),
          ];
        } else if (p.kind === 'sphere') {
          const dx = Math.abs(sx - 1);
          const dy = Math.abs(sy - 1);
          const dz = Math.abs(sz - 1);
          const rScale = dx >= dy && dx >= dz ? sx : dy >= dz ? sy : sz;
          this.attachedPartObject.scale.setScalar(rScale);
          p.dimensions = [
            round3(Math.max(0.02, this.dragStartPartDims[0] * rScale)),
            this.dragStartPartDims[1],
            this.dragStartPartDims[2],
          ];
        } else if (p.kind === 'plane') {
          p.dimensions = [
            round3(Math.max(0.02, this.dragStartPartDims[0] * sx)),
            round3(Math.max(0.02, this.dragStartPartDims[1] * sy)),
            this.dragStartPartDims[2],
          ];
        } else {
          p.dimensions = [
            round3(Math.max(0.02, this.dragStartPartDims[0] * sx)),
            round3(Math.max(0.02, this.dragStartPartDims[1] * sy)),
            round3(Math.max(0.02, this.dragStartPartDims[2] * sz)),
          ];
        }
      }
      this.attachedPartObject.updateMatrix();
      this.attachedPartObject.updateMatrixWorld(true);
      this.partHighlightBox?.update();
      this.dirtyModel = true;
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.active || e.button !== 0 || this.isDraggingGizmo || !this.assets) return;
    if (
      Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 5
    ) {
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_pointer, this.cameraController.camera);

    if (this.devMode === 'world') {
      const entityHits = _raycaster.intersectObjects(this.hierarchy.entitiesRoot.children, true);
      for (const h of entityHits) {
        const match = this.callbacks.findWorldEntityByObject?.(h.object);
        if (match) {
          this.selectWorldEntity(match.kind, match.id);
          return;
        }
      }
      return;
    }

    if (this.assetTab === 'map') {
      if (this.showRoadOverlay && this.nodeMarkersGroup.children.length > 0) {
        const markerHits = _raycaster.intersectObjects(this.nodeMarkersGroup.children, false);
        if (markerHits.length > 0) {
          const edgeIdx = markerHits[0].object.userData.devEdgeIndex as number | undefined;
          if (edgeIdx !== undefined) {
            this.selectEdge(edgeIdx);
            return;
          }
          const nid = markerHits[0].object.userData.devNodeId as number | undefined;
          if (nid !== undefined) {
            if (this.linkFromNodeId !== null && this.linkFromNodeId !== nid) {
              this.toggleEdge(this.linkFromNodeId, nid);
            } else {
              this.selectNode(nid);
            }
            return;
          }
        }
      }

      if (this.showRoadOverlay && this.edgeHitGroup.children.length > 0) {
        const edgeHits = _raycaster.intersectObjects(this.edgeHitGroup.children, false);
        if (edgeHits.length > 0) {
          const edgeIdx = edgeHits[0].object.userData.devSelectEdgeIndex as
            | number
            | undefined;
          if (edgeIdx !== undefined) {
            this.selectEdge(edgeIdx);
            return;
          }
        }
      }

      const worldHits = _raycaster.intersectObjects(
        this.hierarchy.world.buildings.children,
        true,
      );
      for (const h of worldHits) {
        let cur: THREE.Object3D | null = h.object;
        while (
          cur &&
          !cur.userData.mapBuildingId &&
          !cur.userData.mapObjectId &&
          !cur.userData.mapSignId
        ) {
          cur = cur.parent;
        }
        if (cur?.userData.mapObjectId) {
          this.selectObject(cur.userData.mapObjectId as string);
          return;
        }
        if (cur?.userData.mapSignId) {
          this.selectSign(cur.userData.mapSignId as string);
          return;
        }
        if (cur?.userData.mapBuildingId) {
          this.selectBuilding(cur.userData.mapBuildingId as string);
          return;
        }
      }
    } else if (this.assetTab === 'model') {
      const partHits = _raycaster.intersectObjects(this.modelPreviewHolder.children, true);
      for (const h of partHits) {
        let cur: THREE.Object3D | null = h.object;
        while (cur && cur !== this.modelPreviewHolder) {
          if (
            cur.name &&
            findPartInTree(this.assets.models[this.selectedModelId].parts, cur.name)
          ) {
            this.selectPart(cur.name);
            return;
          }
          cur = cur.parent;
        }
      }
    }
  };

  public dispose(): void {
    this.unsubAudioPreview?.();
    this.unsubAudioPreview = null;
    this.transform.removeEventListener('dragging-changed', this.handleDraggingChanged);
    this.transform.removeEventListener('objectChange', this.handleObjectChange);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.transform.detach();
    this.transform.dispose();
    this.scene.remove(this.gizmoHelper);
    this.scene.remove(this.mapProxy);
    this.scene.remove(this.worldProxy);
    this.clearGroup(this.nodeMarkersGroup);
    this.clearGroup(this.edgeLinesGroup);
    this.clearGroup(this.edgeHitGroup);
    this.clearGroup(this.selectionHighlightGroup);
    this.scene.remove(this.overlayGroup);
    this.scene.remove(this.selectionHighlightGroup);
    this.clearGroup(this.modelPreviewHolder);
    this.scene.remove(this.studioGroup);
    if (this.partHighlightBox) {
      this.scene.remove(this.partHighlightBox);
      this.partHighlightBox.dispose();
    }
  }
}

function uniqueKeyOrNext(record: Record<string, unknown>, base: string): string {
  if (!record[base]) return base;
  let i = 2;
  while (record[`${base}_${i}`]) {
    i++;
  }
  return `${base}_${i}`;
}
