import * as THREE from 'three';
import { AssetIssue, ImportedMediaAsset, LoadedJsonAssets } from './assetTypes';
import { renderJsonTexture } from './jsonTextureRenderer';
import { mulberry32 } from './prng';

export function createMagentaFallbackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#2d002d';
  const step = 32;
  for (let y = 0; y < 128; y += step) {
    for (let x = 0; x < 128; x += step) {
      if (((x / step + y / step) & 1) === 1) {
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createPlainAsphaltPadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#24282f';
  ctx.fillRect(0, 0, 256, 256);

  const rand = mulberry32(441923);
  for (let i = 0; i < 420; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const r = Math.floor(30 + rand() * 22);
    const g = Math.floor(33 + rand() * 22);
    const b = Math.floor(38 + rand() * 24);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export class TextureRegistry {
  public readonly byId: Record<string, THREE.CanvasTexture> = {};
  public readonly magentaFallback: THREE.CanvasTexture;
  public readonly plainAsphaltPad: THREE.CanvasTexture;
  private readonly reportedMissing = new Set<string>();
  private readonly onMissingIssue?: (issue: AssetIssue) => void;
  private readonly maxAnisotropy: number;
  private media: Record<string, ImportedMediaAsset> = {};

  constructor(
    renderer: THREE.WebGLRenderer,
    assets: LoadedJsonAssets,
    onMissingIssue?: (issue: AssetIssue) => void,
  ) {
    this.onMissingIssue = onMissingIssue;
    this.media = assets.media ?? {};
    this.magentaFallback = createMagentaFallbackTexture();
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.plainAsphaltPad = createPlainAsphaltPadTexture(this.maxAnisotropy);

    for (const [id, texDef] of Object.entries(assets.textures)) {
      try {
        this.byId[id] = renderJsonTexture(texDef, this.maxAnisotropy, this.media);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[TEXTURE RENDER ERROR] (${id}): ${msg}`);
        this.byId[id] = this.magentaFallback;
        this.onMissingIssue?.({
          severity: 'error',
          category: 'texture',
          id,
          path: assets.manifest.textures[id] ?? id,
          message: `Render failed: ${msg} (using magenta fallback)`,
        });
      }
    }
  }

  public setMedia(media: Record<string, ImportedMediaAsset>): void {
    this.media = media;
  }

  public upsertTexture(id: string, asset: LoadedJsonAssets['textures'][string]): THREE.CanvasTexture {
    const existing = this.byId[id];
    const nextTex = renderJsonTexture(asset, this.maxAnisotropy, this.media);
    if (existing && existing !== this.magentaFallback) {
      const prevCanvas = existing.image as HTMLCanvasElement | undefined;
      const nextCanvas = nextTex.image as HTMLCanvasElement;
      if (prevCanvas && prevCanvas.width === nextCanvas.width && prevCanvas.height === nextCanvas.height) {
        const ctx = prevCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
          ctx.drawImage(nextCanvas, 0, 0);
          existing.colorSpace = nextTex.colorSpace;
          existing.anisotropy = nextTex.anisotropy;
          if (asset.repeat && (asset.repeat[0] !== 1 || asset.repeat[1] !== 1)) {
            existing.wrapS = THREE.RepeatWrapping;
            existing.wrapT = THREE.RepeatWrapping;
            existing.repeat.set(asset.repeat[0], asset.repeat[1]);
          }
          existing.needsUpdate = true;
          nextTex.dispose();
          return existing;
        }
      }
      existing.dispose();
    }
    this.byId[id] = nextTex;
    this.reportedMissing.delete(id);
    return nextTex;
  }

  public get(id: string): THREE.CanvasTexture {
    const tex = this.byId[id];
    if (tex) return tex;

    if (!this.reportedMissing.has(id)) {
      this.reportedMissing.add(id);
      console.error(`[MISSING TEXTURE] "${id}" not found; returning magenta fallback texture.`);
      this.onMissingIssue?.({
        severity: 'error',
        category: 'texture',
        id,
        path: id,
        message: 'Texture missing from loaded pack (using magenta fallback)',
      });
    }
    return this.magentaFallback;
  }

  public has(id: string): boolean {
    return Boolean(this.byId[id]);
  }

  public get asphaltRoadV(): THREE.CanvasTexture {
    return this.get('asphalt_road_v');
  }
  public get asphaltRoadH(): THREE.CanvasTexture {
    return this.get('asphalt_road_h');
  }
  public get intersectionPad(): THREE.CanvasTexture {
    return this.get('intersection_pad');
  }
  public get sidewalkPaver(): THREE.CanvasTexture {
    return this.get('sidewalk_paver');
  }
  public get contactShadow(): THREE.CanvasTexture {
    return this.get('contact_shadow');
  }
  public get policeDoorDecal(): THREE.CanvasTexture {
    return this.get('police_door_decal');
  }
  public get precinctSign(): THREE.CanvasTexture {
    return this.get('precinct_sign');
  }
  public get lightHalo(): THREE.CanvasTexture {
    return this.get('light_halo');
  }
  public get lightCookieRotator(): THREE.CanvasTexture {
    return this.get('light_cookie_rotator');
  }
  public get roughnessAsphalt(): THREE.CanvasTexture {
    return this.get('roughness_asphalt');
  }
  public get roughnessConcrete(): THREE.CanvasTexture {
    return this.get('roughness_concrete');
  }
  public get buildingFacades(): THREE.CanvasTexture[] {
    return [
      this.get('facade_brick'),
      this.get('facade_concrete'),
      this.get('facade_limestone'),
      this.get('facade_office'),
    ];
  }
  public get storefrontFacade(): THREE.CanvasTexture {
    return this.get('storefront_retail');
  }

  public dispose(): void {
    const disposed = new Set<THREE.Texture>();
    for (const tex of Object.values(this.byId)) {
      if (!disposed.has(tex)) {
        tex.dispose();
        disposed.add(tex);
      }
    }
    if (!disposed.has(this.magentaFallback)) {
      this.magentaFallback.dispose();
    }
    if (!disposed.has(this.plainAsphaltPad)) {
      this.plainAsphaltPad.dispose();
    }
  }
}
