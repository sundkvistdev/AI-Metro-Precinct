import * as THREE from 'three';
import { LoadedJsonAssets } from '../assets/assetTypes';
import { renderJsonTexture } from '../assets/jsonTextureRenderer';

export interface ProceduralTexturePack {
  byId: Record<string, THREE.CanvasTexture>;
  asphaltRoadV: THREE.CanvasTexture;
  asphaltRoadH: THREE.CanvasTexture;
  intersectionPad: THREE.CanvasTexture;
  sidewalkPaver: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  policeDoorDecal: THREE.CanvasTexture;
  precinctSign: THREE.CanvasTexture;
  lightHalo: THREE.CanvasTexture;
  lightCookieRotator: THREE.CanvasTexture;
  roughnessAsphalt: THREE.CanvasTexture;
  roughnessConcrete: THREE.CanvasTexture;
  buildingFacades: THREE.CanvasTexture[];
  storefrontFacade: THREE.CanvasTexture;
  dispose: () => void;
}

export function createTexturePackFromJson(
  renderer: THREE.WebGLRenderer,
  assets: LoadedJsonAssets,
): ProceduralTexturePack {
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const byId: Record<string, THREE.CanvasTexture> = {};

  for (const [id, texDef] of Object.entries(assets.textures)) {
    byId[id] = renderJsonTexture(texDef, maxAnisotropy);
  }

  return {
    byId,
    asphaltRoadV: byId['asphalt_road_v'],
    asphaltRoadH: byId['asphalt_road_h'],
    intersectionPad: byId['intersection_pad'],
    sidewalkPaver: byId['sidewalk_paver'],
    contactShadow: byId['contact_shadow'],
    policeDoorDecal: byId['police_door_decal'],
    precinctSign: byId['precinct_sign'],
    lightHalo: byId['light_halo'],
    lightCookieRotator: byId['light_cookie_rotator'],
    roughnessAsphalt: byId['roughness_asphalt'],
    roughnessConcrete: byId['roughness_concrete'],
    buildingFacades: [
      byId['facade_brick'],
      byId['facade_concrete'],
      byId['facade_limestone'],
      byId['facade_office'],
    ],
    storefrontFacade: byId['storefront_retail'],
    dispose: () => {
      Object.values(byId).forEach((t) => t.dispose());
    },
  };
}
