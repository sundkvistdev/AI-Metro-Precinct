import {
  AssetManifest,
  LoadedJsonAssets,
  ProceduralAudioAsset,
  ProceduralModelAsset,
  ProceduralTextureAsset,
} from './assetTypes';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load JSON asset: ${url} (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function loadJsonAssetBundle(
  manifestUrl = '/jdataassets/manifest.json',
): Promise<LoadedJsonAssets> {
  const manifest = await fetchJson<AssetManifest>(manifestUrl);

  const textureEntries = Object.entries(manifest.textures);
  const modelEntries = Object.entries(manifest.models);
  const audioEntries = Object.entries(manifest.audio);

  const [loadedTextures, loadedModels, loadedAudio] = await Promise.all([
    Promise.all(
      textureEntries.map(async ([key, path]) => [
        key,
        await fetchJson<ProceduralTextureAsset>(path),
      ] as const),
    ),
    Promise.all(
      modelEntries.map(async ([key, path]) => [
        key,
        await fetchJson<ProceduralModelAsset>(path),
      ] as const),
    ),
    Promise.all(
      audioEntries.map(async ([key, path]) => [
        key,
        await fetchJson<ProceduralAudioAsset>(path),
      ] as const),
    ),
  ]);

  return {
    manifest,
    textures: Object.fromEntries(loadedTextures),
    models: Object.fromEntries(loadedModels),
    audio: Object.fromEntries(loadedAudio),
  };
}
