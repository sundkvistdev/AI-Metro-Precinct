import * as THREE from 'three';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { TownEnvironmentHandles } from './townBuilder';
import { WeatherCondition } from './types';

export class WeatherSystem {
  private scene: THREE.Scene;
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
    renderer: THREE.WebGLRenderer,
    isSoftwareGl: boolean,
    rng: () => number,
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.rng = rng;

    this.scene.background = this.skyColor;
    this.fogExp = new THREE.FogExp2(this.skyColor.getHex(), 0.0026);
    this.scene.fog = this.fogExp;

    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x263240, 0.85);
    this.scene.add(this.hemiLight);

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
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0x60a5fa, 0.55);
    this.rimLight.position.set(-120, 65, -110);
    this.scene.add(this.rimLight);

    this.buildRainSystem();
  }

  private buildRainSystem(): void {
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
    this.scene.add(this.rainLines);
  }

  public applyWeather(
    weather: WeatherCondition,
    envHandles: TownEnvironmentHandles | null,
    audio: JsonAudioSynth | null,
  ): void {
    this.currentWeather = weather;

    let skyHex = 0x162233;
    let fogDensity = 0.0024;
    let sunIntensity = 1.85;
    let sunColor = 0xfff1d6;
    let hemiIntensity = 0.85;
    let rimIntensity = 0.55;
    let exposure = 1.12;
    let roadRoughness = 0.88;
    let roadMetalness = 0.05;
    let sidewalkRoughness = 0.88;
    let rainIntensity = 0;

    if (weather === WeatherCondition.Overcast) {
      skyHex = 0x263242;
      fogDensity = 0.0042;
      sunIntensity = 0.95;
      sunColor = 0xcbd5e1;
      hemiIntensity = 1.05;
      rimIntensity = 0.45;
      exposure = 1.02;
    } else if (weather === WeatherCondition.Rain) {
      skyHex = 0x121b28;
      fogDensity = 0.0056;
      sunIntensity = 0.65;
      sunColor = 0x94a3b8;
      hemiIntensity = 0.72;
      rimIntensity = 0.65;
      exposure = 1.05;
      roadRoughness = 0.24;
      roadMetalness = 0.22;
      sidewalkRoughness = 0.34;
      rainIntensity = 1.0;
    } else if (weather === WeatherCondition.HeavyFog) {
      skyHex = 0x3b4758;
      fogDensity = 0.0115;
      sunIntensity = 0.55;
      sunColor = 0xdbeafe;
      hemiIntensity = 0.9;
      rimIntensity = 0.3;
      exposure = 0.98;
    }

    this.skyColor.setHex(skyHex);
    this.fogExp.color.setHex(skyHex);
    this.fogExp.density = fogDensity;
    this.sunLight.intensity = sunIntensity;
    this.sunLight.color.setHex(sunColor);
    this.hemiLight.intensity = hemiIntensity;
    this.rimLight.intensity = rimIntensity;
    this.renderer.toneMappingExposure = exposure;

    if (envHandles) {
      for (const m of envHandles.roadMaterials) {
        m.roughness = roadRoughness;
        m.metalness = roadMetalness;
      }
      envHandles.sidewalkMaterial.roughness = sidewalkRoughness;
      envHandles.apronMaterial.roughness = roadRoughness;
    }

    if (this.rainLines) {
      this.rainLines.visible = rainIntensity > 0;
    }
    audio?.setRainIntensity(rainIntensity);
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
