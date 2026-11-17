import * as THREE from 'three';
import { EngineConfigAsset } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { TownEnvironmentHandles } from './townBuilder';
import { WeatherCondition } from './types';

export type WeatherPresetsConfig = EngineConfigAsset['weatherPresets'];

export class WeatherSystem {
  private scene: THREE.Scene;
  private atmosphereGroup: THREE.Group;
  private renderer: THREE.WebGLRenderer;
  private rng: () => number;

  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private skyColor = new THREE.Color(0x162233);
  private fogExp: THREE.FogExp2;

  private rainLines: THREE.LineSegments | null = null;
  private rainPositions: Float32Array | null = null;
  private rainDropCount = 820;
  private currentWeather: WeatherCondition = WeatherCondition.Clear;

  constructor(
    scene: THREE.Scene,
    atmosphereGroup: THREE.Group,
    renderer: THREE.WebGLRenderer,
    isSoftwareGl: boolean,
    rng: () => number,
  ) {
    this.scene = scene;
    this.atmosphereGroup = atmosphereGroup;
    this.renderer = renderer;
    this.rng = rng;

    this.scene.background = this.skyColor;
    this.fogExp = new THREE.FogExp2(this.skyColor.getHex(), 0.0026);
    this.scene.fog = this.fogExp;

    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x263240, 0.85);
    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.85);
    this.sunLight.position.set(110, 145, 85);
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 420;
    const d = 210;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;

    this.rimLight = new THREE.DirectionalLight(0x60a5fa, 0.55);
    this.rimLight.position.set(-120, 65, -110);

    // Lights stay on scene root so clearAllLayers doesn't strip core rig lights; rain particles live in atmosphereGroup
    this.scene.add(this.hemiLight, this.sunLight, this.rimLight);
    this.ensureRainLines();
  }

  public ensureRainLines(): void {
    if (this.rainLines && this.rainLines.parent === this.atmosphereGroup) return;

    const count = this.rainDropCount;
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const rx = (this.rng() - 0.5) * 140;
      const ry = this.rng() * 55;
      const rz = (this.rng() - 0.5) * 140;
      const idx = i * 6;
      positions[idx] = rx;
      positions[idx + 1] = ry;
      positions[idx + 2] = rz;
      positions[idx + 3] = rx - 0.25;
      positions[idx + 4] = ry - 1.45;
      positions[idx + 5] = rz - 0.15;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x94b8db,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.rainPositions = positions;
    this.rainLines = new THREE.LineSegments(geo, mat);
    this.rainLines.visible = false;
    this.rainLines.frustumCulled = false;
    this.atmosphereGroup.add(this.rainLines);
  }

  public applyWeather(
    weather: WeatherCondition,
    presets: WeatherPresetsConfig,
    envHandles: TownEnvironmentHandles | null,
    audio: JsonAudioSynth | null,
  ): void {
    this.currentWeather = weather;
    this.ensureRainLines();

    const preset = presets[weather];
    const skyHex = parseInt(preset.skyColor.replace('#', ''), 16);
    const sunHex = parseInt(preset.sunColor.replace('#', ''), 16);

    this.skyColor.setHex(skyHex);
    this.fogExp.color.setHex(skyHex);
    this.fogExp.density = preset.fogDensity;
    this.sunLight.intensity = preset.sunIntensity;
    this.sunLight.color.setHex(sunHex);
    this.hemiLight.intensity = preset.hemiIntensity;
    this.rimLight.intensity = preset.rimIntensity;
    this.renderer.toneMappingExposure = preset.exposure;

    if (envHandles) {
      for (const m of envHandles.roadMaterials) {
        m.roughness = preset.roadRoughness;
        m.metalness = preset.roadMetalness;
      }
      envHandles.sidewalkMaterial.roughness = preset.sidewalkRoughness;
      envHandles.apronMaterial.roughness = preset.roadRoughness;
    }

    if (this.rainLines) {
      this.rainLines.visible = preset.rainIntensity > 0;
    }
    audio?.setRainIntensity(preset.rainIntensity);
  }

  public update(dt: number, cameraPos: THREE.Vector3, camForward: THREE.Vector3): void {
    if (!this.rainLines || !this.rainPositions || this.currentWeather !== WeatherCondition.Rain) {
      return;
    }

    const pos = this.rainPositions;
    const cx = cameraPos.x + camForward.x * 28;
    const cz = cameraPos.z + camForward.z * 28;
    const fallSpeed = 42;
    const windX = -5.5;
    const windZ = -3.0;

    for (let i = 0; i < this.rainDropCount; i++) {
      const idx = i * 6;
      pos[idx] += windX * dt;
      pos[idx + 1] -= fallSpeed * dt;
      pos[idx + 2] += windZ * dt;

      if (pos[idx + 1] < 0) {
        pos[idx] = cx + (this.rng() - 0.5) * 140;
        pos[idx + 1] = 38 + this.rng() * 22;
        pos[idx + 2] = cz + (this.rng() - 0.5) * 140;
      }
      pos[idx + 3] = pos[idx] - 0.22;
      pos[idx + 4] = pos[idx + 1] - 1.55;
      pos[idx + 5] = pos[idx + 2] - 0.12;
    }

    const attr = this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}
