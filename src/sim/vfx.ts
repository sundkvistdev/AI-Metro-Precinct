import * as THREE from 'three';
import { CustomMapAsset, EngineConfigAsset } from '../assets/assetTypes';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { TextureRegistry } from '../assets/textureRegistry';
import { StaticObstacleBVH } from './bvh';
import { playBoundAudioEvent } from './eventBindings';
import { applyRigidHumanoidPose } from './humanoidAnim';
import { getSurfaceHeight, WorldConfig } from './roadGraph';
import { HumanoidRig } from './vehicleModels';

export interface RagdollState {
  active: boolean;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  pitch: number;
  roll: number;
  splay: number;
  recoverTimer: number;
}

export function createRagdollState(): RagdollState {
  return {
    active: false,
    vel: new THREE.Vector3(),
    angVel: new THREE.Vector3(),
    pitch: 0,
    roll: 0,
    splay: 0,
    recoverTimer: 0,
  };
}

export function triggerRagdoll(
  rag: RagdollState,
  rng: () => number,
  impulseX: number,
  impulseY: number,
  impulseZ: number,
  recoverDuration: number,
): void {
  rag.active = true;
  rag.vel.set(impulseX, impulseY, impulseZ);
  rag.angVel.set((rng() - 0.5) * 9, (rng() - 0.5) * 8, (rng() - 0.5) * 9);
  rag.pitch = 0.25;
  rag.roll = (rng() - 0.5) * 0.6;
  rag.splay = 0.75 + rng() * 0.45;
  rag.recoverTimer = recoverDuration;
}

export function stepRagdollPhysics(
  rag: RagdollState,
  pos: THREE.Vector3,
  rig: HumanoidRig,
  bvh: StaticObstacleBVH,
  surfaceSource: CustomMapAsset | WorldConfig,
  dt: number,
): void {
  rag.vel.y -= 23.0 * dt;
  pos.addScaledVector(rag.vel, dt);
  bvh.resolveCircle(pos, 0.45);

  const groundY = getSurfaceHeight(pos.x, pos.z, surfaceSource) + 0.16;
  const velSq = rag.vel.x * rag.vel.x + rag.vel.z * rag.vel.z;
  const isDeadOrTerminal = rag.recoverTimer > 100;

  if (pos.y <= groundY) {
    pos.y = groundY;
    if (rag.vel.y < -1.8) {
      rag.vel.y = -rag.vel.y * 0.28;
    } else {
      rag.vel.y = 0;
    }
    const damp = Math.exp(-7.5 * dt);
    rag.vel.x *= damp;
    rag.vel.z *= damp;
    rag.angVel.multiplyScalar(Math.exp(-8.5 * dt));

    if (isDeadOrTerminal && velSq < 0.09) {
      rag.vel.set(0, 0, 0);
      rag.angVel.set(0, 0, 0);
      rag.pitch = THREE.MathUtils.damp(rag.pitch, Math.PI * 0.5, 11, dt);
      rag.roll = THREE.MathUtils.damp(rag.roll, 0, 11, dt);
      rig.root.position.copy(pos);
      rig.root.rotation.x = rag.pitch;
      rig.root.rotation.z = rag.roll;
      applyRigidHumanoidPose(rig, 'dead_flat', { snap: true });
      return;
    }

    rag.pitch = THREE.MathUtils.damp(rag.pitch, Math.PI * 0.49, 8, dt);
    rag.roll = THREE.MathUtils.damp(
      rag.roll,
      isDeadOrTerminal ? 0 : Math.sign(rag.roll || 1) * 0.25,
      6,
      dt,
    );
  } else {
    rag.pitch += rag.angVel.x * dt;
    rag.roll += rag.angVel.z * dt;
  }

  rig.root.position.copy(pos);
  rig.root.rotation.x = rag.pitch;
  rig.root.rotation.z = rag.roll;
  rig.leftArm.rotation.x = -0.75 * rag.splay;
  rig.leftArm.rotation.z = 0.52 * rag.splay;
  rig.rightArm.rotation.x = -0.65 * rag.splay;
  rig.rightArm.rotation.z = -0.52 * rag.splay;
  rig.leftLeg.rotation.x = 0.22 * rag.splay;
  rig.rightLeg.rotation.x = -0.22 * rag.splay;
}

interface ImpactSpark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface SmokePuff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  growRate: number;
  startOpacity: number;
}

interface BloodDrop {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface BloodPool {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  targetScale: number;
}

const _vPos = new THREE.Vector3();

export class SimVfxManager {
  private vfxGroup: THREE.Group;
  private rng: () => number;
  private textures: TextureRegistry | null = null;
  private world: CustomMapAsset | WorldConfig | null = null;
  private config: EngineConfigAsset | null = null;

  private sparks: ImpactSpark[] = [];
  private smokePuffs: SmokePuff[] = [];
  private bloodDrops: BloodDrop[] = [];
  private bloodPools: BloodPool[] = [];

  private sparkGeo = new THREE.BoxGeometry(0.11, 0.08, 0.24);
  private sparkHotMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private sparkWarmMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });

  private bloodDropGeo = new THREE.BoxGeometry(0.085, 0.085, 0.14);
  private bloodBrightMat = new THREE.MeshBasicMaterial({ color: 0xb91c1c });
  private bloodDarkMat = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
  private bloodPoolGeo = new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2);

  constructor(vfxGroup: THREE.Group, rng: () => number) {
    this.vfxGroup = vfxGroup;
    this.rng = rng;
  }

  public configure(
    textures: TextureRegistry,
    world: CustomMapAsset | WorldConfig,
    config?: EngineConfigAsset,
  ): void {
    this.textures = textures;
    this.world = world;
    if (config) this.config = config;
  }

  public spawnBloodImpact(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    intensity = 1.0,
    withPool = true,
  ): void {
    const count = Math.round(6 + intensity * 8);
    for (let i = 0; i < count; i++) {
      if (this.bloodDrops.length > 220) break;
      const mat = i % 2 === 0 ? this.bloodBrightMat : this.bloodDarkMat;
      const mesh = new THREE.Mesh(this.bloodDropGeo, mat);
      mesh.position.set(x, y, z);
      const maxLife = 0.35 + this.rng() * 0.35;
      const vx = dirX * (3.2 + this.rng() * 4.5) + (this.rng() - 0.5) * 3.8;
      const vy = (1.2 + this.rng() * 3.4) * Math.max(0.7, intensity * 0.85);
      const vz = dirZ * (3.2 + this.rng() * 4.5) + (this.rng() - 0.5) * 3.8;
      mesh.lookAt(x + vx, y + vy, z + vz);
      this.vfxGroup.add(mesh);
      this.bloodDrops.push({
        mesh,
        vel: new THREE.Vector3(vx, vy, vz),
        life: maxLife,
        maxLife,
      });
    }

    if (withPool) {
      this.spawnBloodPool(
        x + dirX * (0.25 + this.rng() * 0.5),
        z + dirZ * (0.25 + this.rng() * 0.5),
        0.55 + intensity * 0.45,
      );
    }
  }

  public spawnBloodPool(x: number, z: number, scale = 0.85): void {
    if (!this.world) return;
    if (this.bloodPools.length >= 48) {
      const oldest = this.bloodPools.shift()!;
      this.vfxGroup.remove(oldest.mesh);
      (oldest.mesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6b0f12,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(this.bloodPoolGeo, mat);
    mesh.position.set(x, getSurfaceHeight(x, z, this.world) + 0.022, z);
    mesh.rotation.y = this.rng() * Math.PI * 2;
    mesh.scale.set(scale * 0.3, 1, scale * 0.25);
    mesh.renderOrder = 2;
    this.vfxGroup.add(mesh);
    this.bloodPools.push({
      mesh,
      life: 28,
      maxLife: 28,
      targetScale: scale,
    });
  }

  public spawnImpactSparks(
    x: number,
    y: number,
    z: number,
    count = 5,
    speedScale = 1.0,
    biasX = 0,
    biasZ = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length > 260) break;
      const mat = i % 2 === 0 ? this.sparkHotMat : this.sparkWarmMat;
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.set(x, y, z);
      const maxLife = 0.24 + this.rng() * 0.28;
      const vx = biasX * 0.45 + (this.rng() - 0.5) * 11 * speedScale;
      const vy = (2.4 + this.rng() * 6.5) * Math.max(0.7, speedScale * 0.85);
      const vz = biasZ * 0.45 + (this.rng() - 0.5) * 11 * speedScale;
      mesh.lookAt(x + vx, y + vy, z + vz);
      this.vfxGroup.add(mesh);
      this.sparks.push({
        mesh,
        vel: new THREE.Vector3(vx, vy, vz),
        life: maxLife,
        maxLife,
      });
    }
  }

  public spawnSmokePuff(
    x: number,
    y: number,
    z: number,
    scale: number,
    opacity: number,
    darkness = 0.4,
    riseSpeed = 2.4,
  ): void {
    if (!this.textures || this.smokePuffs.length > 190) return;
    const tone = Math.round(
      THREE.MathUtils.lerp(185, 48, THREE.MathUtils.clamp(darkness, 0, 1)),
    );
    const colorHex = (tone << 16) | (tone << 8) | tone;
    const mat = new THREE.SpriteMaterial({
      map: this.textures.lightHalo,
      color: colorHex,
      transparent: true,
      opacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(
      x + (this.rng() - 0.5) * 0.7,
      y + (this.rng() - 0.5) * 0.3,
      z + (this.rng() - 0.5) * 0.7,
    );
    sprite.scale.set(scale, scale, 1);
    sprite.renderOrder = 4;
    this.vfxGroup.add(sprite);

    const maxLife = 1.2 + this.rng() * 1.1;
    this.smokePuffs.push({
      sprite,
      vel: new THREE.Vector3(
        (this.rng() - 0.5) * 1.8,
        riseSpeed + this.rng() * 1.3,
        (this.rng() - 0.5) * 1.8,
      ),
      life: maxLife,
      maxLife,
      startScale: scale,
      growRate: 2.2 + this.rng() * 1.8,
      startOpacity: opacity,
    });
  }

  public spawnCollisionEffects(
    x: number,
    y: number,
    z: number,
    strikeSpeed: number,
    impulseX: number,
    impulseZ: number,
    audio: JsonAudioSynth | null,
  ): void {
    if (strikeSpeed < 2.2) return;
    const t = THREE.MathUtils.clamp((strikeSpeed - 2.2) / 18.0, 0.12, 1.5);
    const sparkCount = Math.round(4 + t * 24);
    this.spawnImpactSparks(x, y, z, sparkCount, 0.65 + t * 0.9, impulseX, impulseZ);

    if (strikeSpeed >= 4.0) {
      const puffCount = Math.round(2 + t * 10);
      for (let i = 0; i < puffCount; i++) {
        this.spawnSmokePuff(
          x + (this.rng() - 0.5) * 1.2,
          y + 0.3,
          z + (this.rng() - 0.5) * 1.2,
          1.1 + t * 1.4,
          0.35 + t * 0.26,
          THREE.MathUtils.clamp(0.25 + t * 0.55, 0, 1),
          1.9 + t * 1.5,
        );
      }
    }

    if (audio && strikeSpeed >= 5.2) {
      _vPos.set(x, y, z);
      playBoundAudioEvent(audio, this.config, 'vehicle_crash', _vPos);
    }
  }

  public update(dt: number): void {
    const world = this.world;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt;
      sp.vel.y -= 21 * dt;
      sp.mesh.position.addScaledVector(sp.vel, dt);
      if (sp.mesh.position.y <= 0.06) {
        sp.mesh.position.y = 0.06;
        sp.vel.y = Math.abs(sp.vel.y) * 0.35;
        sp.vel.x *= 0.72;
        sp.vel.z *= 0.72;
      }
      const s = Math.max(0.2, sp.life / sp.maxLife);
      sp.mesh.scale.setScalar(s);
      if (sp.life <= 0) {
        this.vfxGroup.remove(sp.mesh);
        this.sparks.splice(i, 1);
      }
    }

    for (let i = this.bloodDrops.length - 1; i >= 0; i--) {
      const bd = this.bloodDrops[i];
      bd.life -= dt;
      bd.vel.y -= 22 * dt;
      bd.mesh.position.addScaledVector(bd.vel, dt);
      const ground =
        (world ? getSurfaceHeight(bd.mesh.position.x, bd.mesh.position.z, world) : 0.04) +
        0.025;
      if (bd.mesh.position.y <= ground) {
        bd.mesh.position.y = ground;
        bd.vel.set(0, 0, 0);
        bd.mesh.scale.set(1.5, 0.25, 1.5);
      }
      if (bd.life <= 0) {
        this.vfxGroup.remove(bd.mesh);
        this.bloodDrops.splice(i, 1);
      }
    }

    for (let i = this.bloodPools.length - 1; i >= 0; i--) {
      const bp = this.bloodPools[i];
      bp.life -= dt;
      const age = bp.maxLife - bp.life;
      const spread = THREE.MathUtils.clamp(0.32 + age * 0.7, 0.32, 1.0);
      bp.mesh.scale.set(bp.targetScale * spread, 1, bp.targetScale * spread * 0.88);
      if (bp.life < 6) {
        (bp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0,
          (bp.life / 6) * 0.84,
        );
      }
      if (bp.life <= 0) {
        this.vfxGroup.remove(bp.mesh);
        (bp.mesh.material as THREE.Material).dispose();
        this.bloodPools.splice(i, 1);
      }
    }

    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const pf = this.smokePuffs[i];
      pf.life -= dt;
      if (pf.life <= 0) {
        this.vfxGroup.remove(pf.sprite);
        pf.sprite.material.dispose();
        this.smokePuffs.splice(i, 1);
        continue;
      }
      pf.sprite.position.addScaledVector(pf.vel, dt);
      pf.vel.x *= Math.exp(-1.5 * dt);
      pf.vel.z *= Math.exp(-1.5 * dt);
      const age = 1 - pf.life / pf.maxLife;
      const curScale = pf.startScale + age * pf.growRate;
      pf.sprite.scale.set(curScale, curScale, 1);
      pf.sprite.material.opacity = pf.startOpacity * (1 - age * age);
    }
  }

  public clearActiveParticles(): void {
    for (const sp of this.sparks) this.vfxGroup.remove(sp.mesh);
    for (const bd of this.bloodDrops) this.vfxGroup.remove(bd.mesh);
    for (const bp of this.bloodPools) {
      this.vfxGroup.remove(bp.mesh);
      (bp.mesh.material as THREE.Material).dispose();
    }
    for (const pf of this.smokePuffs) {
      this.vfxGroup.remove(pf.sprite);
      pf.sprite.material.dispose();
    }
    this.sparks = [];
    this.bloodDrops = [];
    this.bloodPools = [];
    this.smokePuffs = [];
  }

  public dispose(): void {
    this.clearActiveParticles();
    this.sparkGeo.dispose();
    this.sparkHotMat.dispose();
    this.sparkWarmMat.dispose();
    this.bloodDropGeo.dispose();
    this.bloodBrightMat.dispose();
    this.bloodDarkMat.dispose();
    this.bloodPoolGeo.dispose();
  }
}
