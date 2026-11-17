import JSZip from 'jszip';
import {
  AssetIssue,
  AssetLoadResult,
  AssetManifest,
  CustomMapAsset,
  EngineConfigAsset,
  LoadedJsonAssets,
  ProceduralAudioAsset,
  ProceduralModelAsset,
  ProceduralTextureAsset,
} from './assetTypes';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateEngineConfig(raw: unknown): raw is EngineConfigAsset {
  if (!isObjectRecord(raw)) return false;
  if (raw.format !== 'jdata-config-v1') return false;
  if (!isObjectRecord(raw.world) || !isObjectRecord(raw.simulation) || !isObjectRecord(raw.camera)) {
    return false;
  }
  if (!isObjectRecord(raw.vehicles) || !isObjectRecord(raw.weapons)) {
    return false;
  }
  if (!isObjectRecord(raw.weatherPresets) || !isObjectRecord(raw.backupPolicies)) {
    return false;
  }
  if (
    !Array.isArray(raw.world.roadCoords) ||
    !Array.isArray(raw.world.blockCenters) ||
    !Array.isArray(raw.world.districts) ||
    !Array.isArray(raw.vehicles.stationBays) ||
    raw.vehicles.stationBays.length === 0 ||
    !isObjectRecord(raw.vehicles.chassis) ||
    !isObjectRecord(raw.vehicles.liveries)
  ) {
    return false;
  }
  for (const kind of ['sedan', 'suv', 'van', 'apc'] as const) {
    if (!isObjectRecord(raw.vehicles.chassis[kind])) return false;
  }
  for (const weapon of ['pistol', 'rifle'] as const) {
    if (!isObjectRecord(raw.weapons[weapon])) return false;
  }
  for (const weather of ['CLEAR', 'OVERCAST', 'RAIN', 'HEAVY_FOG'] as const) {
    if (!isObjectRecord(raw.weatherPresets[weather])) return false;
  }
  for (const policy of ['MINIMAL', 'STANDARD', 'PERIMETER', 'FULL_SCALE'] as const) {
    if (!isObjectRecord(raw.backupPolicies[policy])) return false;
  }
  return true;
}

export function validateMapAsset(raw: unknown): raw is CustomMapAsset {
  if (!isObjectRecord(raw)) return false;
  if (raw.format !== 'jdata-map-v1' || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    return false;
  }
  if (!isObjectRecord(raw.bounds) || !isObjectRecord(raw.surfaceHeights) || !isObjectRecord(raw.roadNetwork)) {
    return false;
  }
  if (
    !Array.isArray(raw.roadNetwork.nodes) ||
    !Array.isArray(raw.roadNetwork.edges) ||
    raw.roadNetwork.nodes.length === 0 ||
    !Array.isArray(raw.zones) ||
    !Array.isArray(raw.buildings) ||
    !Array.isArray(raw.trees) ||
    !Array.isArray(raw.streetlights) ||
    !Array.isArray(raw.districts) ||
    !Array.isArray(raw.pedLoops)
  ) {
    return false;
  }
  if (raw.objects !== undefined && !Array.isArray(raw.objects)) return false;
  if (raw.signs !== undefined && !Array.isArray(raw.signs)) return false;
  return true;
}

export function validateTextureAsset(raw: unknown): raw is ProceduralTextureAsset {
  if (!isObjectRecord(raw)) return false;
  return (
    raw.format === 'jdata-texture-v1' &&
    typeof raw.id === 'string' &&
    typeof raw.width === 'number' &&
    typeof raw.height === 'number' &&
    Array.isArray(raw.layers)
  );
}

export function validateModelAsset(raw: unknown): raw is ProceduralModelAsset {
  if (!isObjectRecord(raw)) return false;
  if (
    raw.format !== 'jdata-model-v1' ||
    typeof raw.id !== 'string' ||
    !isObjectRecord(raw.materials) ||
    !Array.isArray(raw.parts)
  ) {
    return false;
  }
  if (raw.flags !== undefined && !isObjectRecord(raw.flags)) return false;
  return true;
}

export function validateAudioAsset(raw: unknown): raw is ProceduralAudioAsset {
  if (!isObjectRecord(raw)) return false;
  return (
    raw.format === 'jdata-audio-v1' &&
    typeof raw.id === 'string' &&
    typeof raw.kind === 'string'
  );
}

export function parseSingleModelJson(text: string): ProceduralModelAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateModelAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-model-v1 model asset.');
  }
  return parsed;
}

export function parseSingleTextureJson(text: string): ProceduralTextureAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateTextureAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-texture-v1 texture asset.');
  }
  return parsed;
}

export function parseSingleAudioJson(text: string): ProceduralAudioAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateAudioAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-audio-v1 audio asset.');
  }
  return parsed;
}

export function parseSingleMapJson(text: string): CustomMapAsset {
  const parsed = JSON.parse(text) as unknown;
  if (!validateMapAsset(parsed)) {
    throw new Error('JSON file is not a valid jdata-map-v1 map asset.');
  }
  return parsed;
}

function logAssetIssue(issue: AssetIssue): void {
  const prefix = issue.severity === 'fatal' ? '[FATAL ASSET ERROR]' : '[ASSET ERROR]';
  console.error(`${prefix} (${issue.category}:${issue.id}) ${issue.path} -> ${issue.message}`);
}

async function fetchJsonStrict<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} loading ${url}`);
  }
  return (await res.json()) as T;
}

export async function loadJsonAssetBundle(
  manifestUrl = '/jdataassets/manifest.json',
): Promise<AssetLoadResult> {
  const issues: AssetIssue[] = [];

  let manifest: AssetManifest;
  try {
    manifest = await fetchJsonStrict<AssetManifest>(manifestUrl);
    if (!isObjectRecord(manifest) || typeof manifest.config !== 'string') {
      throw new Error('Manifest missing required "config" JSON reference.');
    }
    if (typeof manifest.map !== 'string') {
      throw new Error('Manifest missing required "map" JSON reference.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: manifestUrl,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Manifest Failure (${manifestUrl}): ${msg}`,
      sourceLabel: manifestUrl,
    };
  }

  let config: EngineConfigAsset;
  try {
    const rawConfig = await fetchJsonStrict<unknown>(manifest.config);
    if (!validateEngineConfig(rawConfig)) {
      throw new Error('Engine config JSON failed schema validation (missing required sections).');
    }
    config = rawConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Failure (${manifest.config}): ${msg}`,
      sourceLabel: manifest.packName || manifestUrl,
    };
  }

  let map: CustomMapAsset;
  try {
    const rawMap = await fetchJsonStrict<unknown>(manifest.map);
    if (!validateMapAsset(rawMap)) {
      throw new Error('Map JSON failed jdata-map-v1 schema validation.');
    }
    map = rawMap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'map',
      id: 'world_map',
      path: manifest.map,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config,
      issues,
      fatalError: `Fatal Map Failure (${manifest.map}): ${msg}`,
      sourceLabel: manifest.packName || manifestUrl,
    };
  }

  const textures: Record<string, ProceduralTextureAsset> = {};
  const models: Record<string, ProceduralModelAsset> = {};
  const audio: Record<string, ProceduralAudioAsset> = {};

  const textureEntries = Object.entries(manifest.textures ?? {});
  const modelEntries = Object.entries(manifest.models ?? {});
  const audioEntries = Object.entries(manifest.audio ?? {});

  await Promise.all([
    Promise.all(
      textureEntries.map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateTextureAsset(data)) {
            throw new Error('Invalid jdata-texture-v1 format.');
          }
          textures[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'texture',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      modelEntries.map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateModelAsset(data)) {
            throw new Error('Invalid jdata-model-v1 format.');
          }
          models[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'model',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta cube fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      audioEntries.map(async ([key, path]) => {
        try {
          const data = await fetchJsonStrict<unknown>(path);
          if (!validateAudioAsset(data)) {
            throw new Error('Invalid jdata-audio-v1 format.');
          }
          audio[key] = data;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'audio',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
  ]);

  return {
    assets: {
      manifest,
      config,
      map,
      textures,
      models,
      audio,
    },
    config,
    issues,
    fatalError: null,
    sourceLabel: `Built-in (${manifest.packName})`,
  };
}

function normalizeZipLookupCandidates(manifestDir: string, assetPath: string): string[] {
  const clean = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const strippedPrefix = clean.replace(/^jdataassets\//, '');
  const candidates = new Set<string>([
    clean,
    strippedPrefix,
    manifestDir ? `${manifestDir}/${clean}` : clean,
    manifestDir ? `${manifestDir}/${strippedPrefix}` : strippedPrefix,
  ]);
  const basename = clean.split('/').pop();
  if (basename) {
    candidates.add(basename);
  }
  return Array.from(candidates);
}

function findZipEntry(
  zip: JSZip,
  manifestDir: string,
  assetPath: string,
): JSZip.JSZipObject | null {
  const candidates = normalizeZipLookupCandidates(manifestDir, assetPath);
  for (const c of candidates) {
    const direct = zip.file(c);
    if (direct && !direct.dir) return direct;
  }

  const cleanLower = assetPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const strippedLower = cleanLower.replace(/^jdataassets\//, '');
  let matched: JSZip.JSZipObject | null = null;
  zip.forEach((relativePath, entry) => {
    if (matched || entry.dir) return;
    const norm = relativePath.replace(/\\/g, '/').toLowerCase();
    if (
      norm.endsWith(`/${cleanLower}`) ||
      norm === cleanLower ||
      norm.endsWith(`/${strippedLower}`) ||
      norm === strippedLower
    ) {
      matched = entry;
    }
  });
  return matched;
}

export async function loadJsonAssetBundleFromZip(file: File): Promise<AssetLoadResult> {
  const issues: AssetIssue[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'zip_archive',
      path: file.name,
      message: `Unable to open ZIP archive: ${msg}`,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal ZIP Error (${file.name}): ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let manifestEntry: JSZip.JSZipObject | null = zip.file('manifest.json');
  let manifestDir = '';
  if (!manifestEntry) {
    zip.forEach((relPath, entry) => {
      if (manifestEntry || entry.dir) return;
      if (
        relPath.replace(/\\/g, '/').toLowerCase().endsWith('/manifest.json') ||
        relPath.toLowerCase() === 'manifest.json'
      ) {
        manifestEntry = entry;
        const idx = relPath.lastIndexOf('/');
        manifestDir = idx >= 0 ? relPath.slice(0, idx) : '';
      }
    });
  }

  if (!manifestEntry) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: `${file.name}/manifest.json`,
      message: 'ZIP pack does not contain a manifest.json file.',
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Pack Error: "${file.name}" is missing manifest.json.`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let manifest: AssetManifest;
  try {
    const rawText = await manifestEntry.async('string');
    manifest = JSON.parse(rawText) as AssetManifest;
    if (!isObjectRecord(manifest) || typeof manifest.config !== 'string') {
      throw new Error('Manifest inside ZIP is missing required "config" path.');
    }
    if (typeof manifest.map !== 'string') {
      throw new Error('Manifest inside ZIP is missing required "map" path.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'manifest',
      id: 'manifest',
      path: `${file.name}/manifest.json`,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Manifest Error in "${file.name}": ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let config: EngineConfigAsset;
  const configEntry = findZipEntry(zip, manifestDir, manifest.config);
  if (!configEntry) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: `Missing required engine config file "${manifest.config}" inside ZIP.`,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Missing in "${file.name}": ${manifest.config}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  try {
    const rawConfig = JSON.parse(await configEntry.async('string')) as unknown;
    if (!validateEngineConfig(rawConfig)) {
      throw new Error('Engine config inside ZIP failed schema validation.');
    }
    config = rawConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'config',
      id: 'engine_config',
      path: manifest.config,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config: null,
      issues,
      fatalError: `Fatal Engine Config Error in "${file.name}": ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  let map: CustomMapAsset;
  const mapEntry = findZipEntry(zip, manifestDir, manifest.map);
  if (!mapEntry) {
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'map',
      id: 'world_map',
      path: manifest.map,
      message: `Missing required map file "${manifest.map}" inside ZIP.`,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config,
      issues,
      fatalError: `Fatal Map Missing in "${file.name}": ${manifest.map}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  try {
    const rawMap = JSON.parse(await mapEntry.async('string')) as unknown;
    if (!validateMapAsset(rawMap)) {
      throw new Error('Map inside ZIP failed jdata-map-v1 schema validation.');
    }
    map = rawMap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const issue: AssetIssue = {
      severity: 'fatal',
      category: 'map',
      id: 'world_map',
      path: manifest.map,
      message: msg,
    };
    logAssetIssue(issue);
    issues.push(issue);
    return {
      assets: null,
      config,
      issues,
      fatalError: `Fatal Map Error in "${file.name}": ${msg}`,
      sourceLabel: `ZIP: ${file.name}`,
    };
  }

  const textures: Record<string, ProceduralTextureAsset> = {};
  const models: Record<string, ProceduralModelAsset> = {};
  const audio: Record<string, ProceduralAudioAsset> = {};

  await Promise.all([
    Promise.all(
      Object.entries(manifest.textures ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateTextureAsset(parsed)) throw new Error('Invalid texture JSON schema');
          textures[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'texture',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.models ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateModelAsset(parsed)) throw new Error('Invalid model JSON schema');
          models[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'model',
            id: key,
            path,
            message: `${err instanceof Error ? err.message : String(err)} (using magenta cube fallback)`,
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
    Promise.all(
      Object.entries(manifest.audio ?? {}).map(async ([key, path]) => {
        try {
          const entry = findZipEntry(zip, manifestDir, path);
          if (!entry) throw new Error('File not found in ZIP');
          const parsed = JSON.parse(await entry.async('string')) as unknown;
          if (!validateAudioAsset(parsed)) throw new Error('Invalid audio JSON schema');
          audio[key] = parsed;
        } catch (err) {
          const issue: AssetIssue = {
            severity: 'error',
            category: 'audio',
            id: key,
            path,
            message: err instanceof Error ? err.message : String(err),
          };
          logAssetIssue(issue);
          issues.push(issue);
        }
      }),
    ),
  ]);

  return {
    assets: {
      manifest,
      config,
      map,
      textures,
      models,
      audio,
    },
    config,
    issues,
    fatalError: null,
    sourceLabel: `ZIP: ${file.name} (${manifest.packName})`,
  };
}

export async function exportAssetBundleToZip(assets: LoadedJsonAssets): Promise<Blob> {
  const zip = new JSZip();

  const mapRel = `maps/${assets.map.id || 'metro_default'}.json`;
  const exportedManifest: AssetManifest = {
    formatVersion: assets.manifest.formatVersion,
    packName: assets.manifest.packName,
    config: 'engine_config.json',
    map: mapRel,
    textures: {},
    models: {},
    audio: {},
  };

  zip.file('engine_config.json', JSON.stringify(assets.config, null, 2));
  zip.file(mapRel, JSON.stringify(assets.map, null, 2));

  for (const [id, tex] of Object.entries(assets.textures)) {
    const rel = `textures/${id}.json`;
    exportedManifest.textures[id] = rel;
    zip.file(rel, JSON.stringify(tex, null, 2));
  }

  for (const [id, model] of Object.entries(assets.models)) {
    const rel = `models/${id}.json`;
    exportedManifest.models[id] = rel;
    zip.file(rel, JSON.stringify(model, null, 2));
  }

  for (const [id, audio] of Object.entries(assets.audio)) {
    const rel = `audio/${id}.json`;
    exportedManifest.audio[id] = rel;
    zip.file(rel, JSON.stringify(audio, null, 2));
  }

  zip.file('manifest.json', JSON.stringify(exportedManifest, null, 2));
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
