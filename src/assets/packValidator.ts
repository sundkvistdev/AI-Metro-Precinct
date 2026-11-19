import { DevAssetTab } from '../sim/types';
import { LoadedJsonAssets, ModelPartDef } from './assetTypes';

export type ValidationSeverity = 'fatal' | 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  category:
    | 'manifest'
    | 'map'
    | 'model'
    | 'material'
    | 'texture'
    | 'lightbar'
    | 'vehicle'
    | 'audio';
  assetId: string;
  fieldPath: string;
  message: string;
  jumpTab?: DevAssetTab;
  jumpTarget?: string;
}

export type PackValidationIssue = ValidationIssue;

function collectPartIds(parts: ModelPartDef[], out = new Set<string>()): Set<string> {
  for (const p of parts) {
    out.add(p.id);
    if (p.children && p.children.length > 0) {
      collectPartIds(p.children, out);
    }
  }
  return out;
}

function collectPartIssues(
  modelId: string,
  parts: ModelPartDef[],
  allPartIds: Set<string>,
  localMaterials: Record<string, unknown>,
  sharedMaterials: Record<string, unknown>,
  out: ValidationIssue[],
): void {
  for (const part of parts) {
    if (part.kind !== 'group') {
      if (part.materialRef && !localMaterials[part.materialRef] && !sharedMaterials[part.materialRef]) {
        out.push({
          id: `model:${modelId}:mat:${part.id}`,
          severity: 'error',
          category: 'model',
          assetId: modelId,
          fieldPath: `parts.${part.id}.materialRef`,
          message: `Part "${part.id}" references missing material "${part.materialRef}".`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
      if (part.dimensions && part.dimensions.some((d) => !Number.isFinite(d) || d < 0)) {
        out.push({
          id: `model:${modelId}:dim:${part.id}`,
          severity: 'warning',
          category: 'model',
          assetId: modelId,
          fieldPath: `parts.${part.id}.dimensions`,
          message: `Part "${part.id}" has invalid negative/NaN dimensions.`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
      if (part.kind === 'extrude' && (!part.extrude || part.extrude.points.length < 3)) {
        out.push({
          id: `model:${modelId}:extrude:${part.id}`,
          severity: 'warning',
          category: 'model',
          assetId: modelId,
          fieldPath: `parts.${part.id}.extrude`,
          message: `Extrude part "${part.id}" requires at least 3 contour points.`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
      if (part.kind === 'lathe' && (!part.lathe || part.lathe.points.length < 2)) {
        out.push({
          id: `model:${modelId}:lathe:${part.id}`,
          severity: 'warning',
          category: 'model',
          assetId: modelId,
          fieldPath: `parts.${part.id}.lathe`,
          message: `Lathe part "${part.id}" requires at least 2 profile points.`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
      if (part.kind === 'mesh' && (!part.customMesh || part.customMesh.positions.length < 9)) {
        out.push({
          id: `model:${modelId}:mesh:${part.id}`,
          severity: 'warning',
          category: 'model',
          assetId: modelId,
          fieldPath: `parts.${part.id}.customMesh`,
          message: `Custom mesh "${part.id}" requires at least 3 vertices (9 position floats).`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
    }
    if (part.seat?.hingePartId && !allPartIds.has(part.seat.hingePartId)) {
      out.push({
        id: `model:${modelId}:seat_hinge:${part.id}`,
        severity: 'warning',
        category: 'model',
        assetId: modelId,
        fieldPath: `parts.${part.id}.seat.hingePartId`,
        message: `Seat "${part.id}" references missing hinge part "${part.seat.hingePartId}".`,
        jumpTab: 'model',
        jumpTarget: modelId,
      });
    }
    if (part.children && part.children.length > 0) {
      collectPartIssues(modelId, part.children, allPartIds, localMaterials, sharedMaterials, out);
    }
  }
}

export function validateAssetPackLive(assets: LoadedJsonAssets | null): ValidationIssue[] {
  if (!assets) return [];
  const issues: ValidationIssue[] = [];

  // 1. Validate Maps
  const mapEntries = Object.entries(assets.maps ?? {});
  if (mapEntries.length === 0) {
    issues.push({
      id: 'manifest:no_maps',
      severity: 'fatal',
      category: 'manifest',
      assetId: assets.manifest.packName,
      fieldPath: 'maps',
      message: 'Asset pack has no loaded maps.',
      jumpTab: 'map',
    });
  }

  for (const [mapId, map] of mapEntries) {
    const nodes = map.roadNetwork?.nodes ?? [];
    const edges = map.roadNetwork?.edges ?? [];
    if (nodes.length === 0) {
      issues.push({
        id: `map:${mapId}:empty_nodes`,
        severity: 'fatal',
        category: 'map',
        assetId: mapId,
        fieldPath: 'roadNetwork.nodes',
        message: `Map "${map.name}" has zero road nodes.`,
        jumpTab: 'map',
        jumpTarget: mapId,
      });
      continue;
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const adj = new Map<number, number[]>();
    for (const n of nodes) adj.set(n.id, []);

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
        issues.push({
          id: `map:${mapId}:edge:${i}`,
          severity: 'error',
          category: 'map',
          assetId: mapId,
          fieldPath: `roadNetwork.edges[${i}]`,
          message: `Edge ${e.from} -> ${e.to} points to non-existent road node.`,
          jumpTab: 'map',
          jumpTarget: mapId,
        });
      } else if (e.from !== e.to) {
        adj.get(e.from)?.push(e.to);
        adj.get(e.to)?.push(e.from);
      }
    }

    // BFS connectivity check from first node
    const startId = nodes[0].id;
    const visited = new Set<number>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    const isolatedCount = nodes.length - visited.size;
    if (isolatedCount > 0) {
      issues.push({
        id: `map:${mapId}:disconnected`,
        severity: 'warning',
        category: 'map',
        assetId: mapId,
        fieldPath: 'roadNetwork.edges',
        message: `${isolatedCount} road node(s) in "${map.name}" are disconnected from main graph; A* cannot reach them.`,
        jumpTab: 'map',
        jumpTarget: mapId,
      });
    }

    const bays = map.stationBays ?? assets.config.vehicles.stationBays;
    if (!bays || bays.length === 0) {
      issues.push({
        id: `map:${mapId}:no_bays`,
        severity: 'error',
        category: 'map',
        assetId: mapId,
        fieldPath: 'stationBays',
        message: `Map "${map.name}" has no station bays defined for police dispatch.`,
        jumpTab: 'map',
        jumpTarget: mapId,
      });
    } else {
      for (const bay of bays) {
        if (!nodeIds.has(bay.exitRoadNodeId)) {
          issues.push({
            id: `map:${mapId}:bay:${bay.id}`,
            severity: 'warning',
            category: 'map',
            assetId: mapId,
            fieldPath: `stationBays.${bay.id}.exitRoadNodeId`,
            message: `Bay "${bay.callsign}" exitRoadNodeId (${bay.exitRoadNodeId}) is not in "${map.name}".`,
            jumpTab: 'map',
            jumpTarget: mapId,
          });
        }
      }
    }

    if (!map.precinctDoors) {
      issues.push({
        id: `map:${mapId}:no_precinct_doors`,
        severity: 'warning',
        category: 'map',
        assetId: mapId,
        fieldPath: 'precinctDoors',
        message: `Map "${map.name}" has no precinctDoors marker; falling back to station lobby east doorway.`,
        jumpTab: 'map',
        jumpTarget: mapId,
      });
    }

    const halfLimit = (map.bounds?.halfSize ?? 200) + 45;
    for (const obj of map.objects ?? []) {
      if (!assets.models[obj.modelRef]) {
        issues.push({
          id: `map:${mapId}:obj_model:${obj.id}`,
          severity: 'error',
          category: 'map',
          assetId: mapId,
          fieldPath: `objects.${obj.id}.modelRef`,
          message: `Placed object "${obj.id}" references missing model "${obj.modelRef}".`,
          jumpTab: 'map',
          jumpTarget: obj.id,
        });
      }
      if (Math.abs(obj.x) > halfLimit || Math.abs(obj.z) > halfLimit) {
        issues.push({
          id: `map:${mapId}:obj_bounds:${obj.id}`,
          severity: 'warning',
          category: 'map',
          assetId: mapId,
          fieldPath: `objects.${obj.id}`,
          message: `Placed object "${obj.id}" lies outside map bounds (+/-${halfLimit}m).`,
          jumpTab: 'map',
          jumpTarget: obj.id,
        });
      }
    }
  }

  // 2. Validate Shared Materials
  for (const [matId, mat] of Object.entries(assets.materials ?? {})) {
    if (mat.textureRef && !assets.textures[mat.textureRef]) {
      issues.push({
        id: `mat:${matId}:tex`,
        severity: 'error',
        category: 'material',
        assetId: matId,
        fieldPath: 'textureRef',
        message: `Shared material "${matId}" references missing texture "${mat.textureRef}".`,
        jumpTab: 'materials',
        jumpTarget: matId,
      });
    }
    if (mat.emissiveTextureRef && !assets.textures[mat.emissiveTextureRef]) {
      issues.push({
        id: `mat:${matId}:emissive_tex`,
        severity: 'error',
        category: 'material',
        assetId: matId,
        fieldPath: 'emissiveTextureRef',
        message: `Shared material "${matId}" references missing emissive texture "${mat.emissiveTextureRef}".`,
        jumpTab: 'materials',
        jumpTarget: matId,
      });
    }
    if (mat.roughnessTextureRef && !assets.textures[mat.roughnessTextureRef]) {
      issues.push({
        id: `mat:${matId}:rough_tex`,
        severity: 'error',
        category: 'material',
        assetId: matId,
        fieldPath: 'roughnessTextureRef',
        message: `Shared material "${matId}" references missing roughness texture "${mat.roughnessTextureRef}".`,
        jumpTab: 'materials',
        jumpTarget: matId,
      });
    }
  }

  // 3. Validate Models
  for (const [modelId, model] of Object.entries(assets.models ?? {})) {
    if (!model.parts || model.parts.length === 0) {
      issues.push({
        id: `model:${modelId}:empty`,
        severity: 'warning',
        category: 'model',
        assetId: modelId,
        fieldPath: 'parts',
        message: `Model "${modelId}" has no geometry parts.`,
        jumpTab: 'model',
        jumpTarget: modelId,
      });
    } else {
      const partIds = collectPartIds(model.parts);
      collectPartIssues(modelId, model.parts, partIds, model.materials ?? {}, assets.materials ?? {}, issues);
    }

    for (const [matKey, mat] of Object.entries(model.materials ?? {})) {
      if (mat.textureRef && !assets.textures[mat.textureRef] && matKey !== 'door_decal') {
        issues.push({
          id: `model:${modelId}:localmat:${matKey}`,
          severity: 'error',
          category: 'model',
          assetId: modelId,
          fieldPath: `materials.${matKey}.textureRef`,
          message: `Model "${modelId}" material "${matKey}" references missing texture "${mat.textureRef}".`,
          jumpTab: 'model',
          jumpTarget: modelId,
        });
      }
    }
  }

  // 4. Validate Textures
  for (const [texId, tex] of Object.entries(assets.textures ?? {})) {
    if (tex.width <= 0 || tex.height <= 0) {
      issues.push({
        id: `tex:${texId}:dims`,
        severity: 'error',
        category: 'texture',
        assetId: texId,
        fieldPath: 'width',
        message: `Texture "${texId}" has invalid dimensions (${tex.width}x${tex.height}).`,
        jumpTab: 'texture',
        jumpTarget: texId,
      });
    }
    for (let li = 0; li < tex.layers.length; li++) {
      const layer = tex.layers[li];
      if (layer.op === 'image_stamp' && !assets.media[layer.mediaId]) {
        issues.push({
          id: `tex:${texId}:media:${li}`,
          severity: 'error',
          category: 'texture',
          assetId: texId,
          fieldPath: `layers[${li}].mediaId`,
          message: `Texture "${texId}" stamp layer references missing media "${layer.mediaId}".`,
          jumpTab: 'texture',
          jumpTarget: texId,
        });
      }
    }
  }

  // 5. Validate Audio
  for (const [audioId, aud] of Object.entries(assets.audio ?? {})) {
    if (aud.gain <= 0) {
      issues.push({
        id: `audio:${audioId}:gain`,
        severity: 'warning',
        category: 'audio',
        assetId: audioId,
        fieldPath: 'gain',
        message: `Audio asset "${audioId}" has zero or negative gain (${aud.gain}).`,
        jumpTab: 'audio',
        jumpTarget: audioId,
      });
    }
    if (aud.kind === 'audio_clip' && (!aud.clip?.mediaId || !assets.media[aud.clip.mediaId])) {
      issues.push({
        id: `audio:${audioId}:clip`,
        severity: 'error',
        category: 'audio',
        assetId: audioId,
        fieldPath: 'clip.mediaId',
        message: `Audio clip "${audioId}" references missing media "${aud.clip?.mediaId ?? ''}".`,
        jumpTab: 'audio',
        jumpTarget: audioId,
      });
    }
  }

  // 6. Validate Lightbars
  for (const [lbId, lb] of Object.entries(assets.lightbars ?? {})) {
    if (lb.hardwareStyle === 'custom' && (!lb.emitters || lb.emitters.length === 0)) {
      issues.push({
        id: `lightbar:${lbId}:emitters`,
        severity: 'warning',
        category: 'lightbar',
        assetId: lbId,
        fieldPath: 'emitters',
        message: `Custom lightbar "${lb.name}" has zero emitters defined.`,
        jumpTab: 'lightbars',
        jumpTarget: lbId,
      });
    }
    if (lb.rateMult <= 0) {
      issues.push({
        id: `lightbar:${lbId}:rate`,
        severity: 'warning',
        category: 'lightbar',
        assetId: lbId,
        fieldPath: 'rateMult',
        message: `Lightbar "${lb.name}" rate multiplier should be > 0.`,
        jumpTab: 'lightbars',
        jumpTarget: lbId,
      });
    }
  }

  // 7. Validate Vehicle Definitions
  for (const [vehId, veh] of Object.entries(assets.vehicleDefs ?? {})) {
    if (!assets.models[veh.modelRef]) {
      issues.push({
        id: `vehicle:${vehId}:model`,
        severity: 'error',
        category: 'vehicle',
        assetId: vehId,
        fieldPath: 'modelRef',
        message: `Vehicle "${vehId}" references missing model "${veh.modelRef}".`,
        jumpTab: 'prefabs',
        jumpTarget: vehId,
      });
    }
    if (veh.defaultLightbarId && !assets.lightbars[veh.defaultLightbarId]) {
      issues.push({
        id: `vehicle:${vehId}:lightbar`,
        severity: 'warning',
        category: 'vehicle',
        assetId: vehId,
        fieldPath: 'defaultLightbarId',
        message: `Vehicle "${vehId}" references missing lightbar "${veh.defaultLightbarId}".`,
        jumpTab: 'lightbars',
        jumpTarget: vehId,
      });
    }
    if (veh.defaultLiveryId && !assets.config.vehicles.liveries[veh.defaultLiveryId]) {
      issues.push({
        id: `vehicle:${vehId}:livery`,
        severity: 'warning',
        category: 'vehicle',
        assetId: vehId,
        fieldPath: 'defaultLiveryId',
        message: `Vehicle "${vehId}" references missing livery "${veh.defaultLiveryId}".`,
        jumpTab: 'prefabs',
        jumpTarget: vehId,
      });
    }
  }

  // 8. Validate Map Buildings modelRef
  for (const [mapId, map] of mapEntries) {
    for (const b of map.buildings ?? []) {
      if (b.modelRef && !assets.models[b.modelRef]) {
        issues.push({
          id: `map:${mapId}:bldg_model:${b.id}`,
          severity: 'warning',
          category: 'map',
          assetId: mapId,
          fieldPath: `buildings.${b.id}.modelRef`,
          message: `Building "${b.id}" references missing model "${b.modelRef}".`,
          jumpTab: 'map',
          jumpTarget: b.id,
        });
      }
    }
  }

  // 9. Validate Event-to-Audio Bindings
  for (const [evId, binding] of Object.entries(assets.config.eventBindings ?? {})) {
    if (binding?.enabled !== false && binding?.audioId && !assets.audio[binding.audioId]) {
      issues.push({
        id: `config:event:${evId}`,
        severity: 'warning',
        category: 'audio',
        assetId: evId,
        fieldPath: `eventBindings.${evId}.audioId`,
        message: `Event "${evId}" binds to missing audio asset "${binding.audioId}".`,
        jumpTab: 'audio',
        jumpTarget: binding.audioId,
      });
    }
  }

  return issues;
}
