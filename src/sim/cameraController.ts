import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EngineConfigAsset } from '../assets/assetTypes';
import { PoliceUnit } from './simActors';
import { CameraMode } from './types';

export type CameraConfig = EngineConfigAsset['camera'];

const _v1 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camGoal = new THREE.Vector3();
const _targetGoal = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export interface CameraControllerCallbacks {
  onSelectUnit: (unitId: string) => void;
  onUnlockAudio: () => void;
  onModeAutoFallback: (mode: CameraMode) => void;
  getClickables: () => THREE.Object3D[];
}

export class SimCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  public mode: CameraMode = CameraMode.Overview;

  private config: CameraConfig;
  private domElement: HTMLElement;
  private callbacks: CameraControllerCallbacks;
  private cameraNeedsSnap = false;
  private userOrbiting = false;
  private gizmoDragging = false;
  private devEditorActive = false;
  private shakeIntensity = 0;
  private appliedShake = new THREE.Vector3();

  private keys = new Set<string>();
  private freeYaw = 0;
  private freePitch = -0.35;
  private isFreeDragging = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastDragPos = { x: 0, y: 0 };
  private dragMoved = false;

  constructor(
    container: HTMLElement,
    domElement: HTMLElement,
    isSoftwareGl: boolean,
    initialConfig: CameraConfig,
    callbacks: CameraControllerCallbacks,
  ) {
    this.domElement = domElement;
    this.config = initialConfig;
    this.callbacks = callbacks;

    const aspect =
      (container.clientWidth || window.innerWidth) /
      (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(
      initialConfig.fov,
      aspect,
      initialConfig.near,
      initialConfig.far,
    );
    this.camera.position.set(...initialConfig.overviewPos);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = initialConfig.minDistance;
    this.controls.maxDistance = initialConfig.maxDistance;
    this.controls.target.set(...initialConfig.overviewTarget);
    this.controls.addEventListener('start', () => {
      this.userOrbiting = true;
    });
    this.controls.addEventListener('end', () => {
      this.userOrbiting = false;
    });

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    domElement.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  public applyConfig(cfg: CameraConfig): void {
    this.config = cfg;
    this.camera.fov = cfg.fov;
    this.camera.near = cfg.near;
    this.camera.far = cfg.far;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = cfg.minDistance;
    this.controls.maxDistance = cfg.maxDistance;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public setMode(mode: CameraMode): void {
    const prevMode = this.mode;
    this.mode = mode;
    this.cameraNeedsSnap = true;

    if (mode === CameraMode.FreeFly) {
      this.controls.enabled = false;
      _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.freeYaw = _euler.y;
      this.freePitch = THREE.MathUtils.clamp(_euler.x, -Math.PI * 0.45, Math.PI * 0.42);
    } else {
      this.controls.enabled = true;
      if (prevMode === CameraMode.FreeFly && mode === CameraMode.Overview) {
        this.camera.getWorldDirection(_fwd);
        const dist = Math.max(20, Math.min(90, this.camera.position.y * 1.4));
        this.controls.target.set(
          this.camera.position.x + _fwd.x * dist,
          0,
          this.camera.position.z + _fwd.z * dist,
        );
      }
    }
  }

  public requestSnap(): void {
    this.cameraNeedsSnap = true;
  }

  public setGizmoDragging(dragging: boolean): void {
    this.gizmoDragging = dragging;
    this.controls.enabled = !dragging && this.mode !== CameraMode.FreeFly;
  }

  public setDevEditorActive(active: boolean): void {
    this.devEditorActive = active;
  }

  public focusTarget(
    tx: number,
    ty: number,
    tz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    this.mode = CameraMode.Overview;
    this.controls.enabled = !this.gizmoDragging;
    this.appliedShake.set(0, 0, 0);
    this.controls.target.set(tx, ty, tz);
    this.camera.position.set(cx, cy, cz);
    this.controls.update();
  }

  public triggerImpactShake(intensity: number): void {
    this.shakeIntensity = Math.min(0.65, Math.max(this.shakeIntensity, intensity * 0.032));
  }

  public resetView(): void {
    this.mode = CameraMode.Overview;
    this.controls.enabled = !this.gizmoDragging;
    this.appliedShake.set(0, 0, 0);
    this.controls.target.set(...this.config.overviewTarget);
    this.camera.position.set(...this.config.overviewPos);
    this.controls.update();
  }

  public update(dt: number, selectedUnit: PoliceUnit | undefined): void {
    if (this.appliedShake.lengthSq() > 0) {
      this.camera.position.sub(this.appliedShake);
      this.appliedShake.set(0, 0, 0);
    }

    const moveFwd =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveRight =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const moveVert =
      (this.keys.has('KeyR') ? 1 : 0) - (this.keys.has('KeyF') ? 1 : 0);
    const yawRot =
      (this.keys.has('KeyQ') ? 1 : 0) - (this.keys.has('KeyE') ? 1 : 0);
    const zoomKey =
      (this.keys.has('KeyZ') ? 1 : 0) - (this.keys.has('KeyX') ? 1 : 0);

    const speedMult =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
        ? 2.4
        : this.keys.has('AltLeft') || this.keys.has('AltRight')
        ? 0.35
        : 1.0;

    const hasManualInput =
      moveFwd !== 0 || moveRight !== 0 || moveVert !== 0 || yawRot !== 0 || zoomKey !== 0;
    if (
      hasManualInput &&
      (this.mode === CameraMode.FollowUnit || this.mode === CameraMode.RearLightbar)
    ) {
      this.mode = CameraMode.Overview;
      this.controls.enabled = true;
      this.callbacks.onModeAutoFallback(CameraMode.Overview);
    }

    if (this.mode === CameraMode.FreeFly) {
      if (yawRot !== 0) {
        this.freeYaw += yawRot * 1.8 * dt * (speedMult > 1 ? 1.3 : 1);
      }
      _euler.set(this.freePitch, this.freeYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(_euler);

      this.camera.getWorldDirection(_fwd);
      _right.crossVectors(_fwd, this.camera.up).normalize();

      const flySpeed = this.config.freeFlySpeed * speedMult * dt;
      if (moveFwd !== 0) this.camera.position.addScaledVector(_fwd, moveFwd * flySpeed);
      if (moveRight !== 0) this.camera.position.addScaledVector(_right, moveRight * flySpeed);
      if (moveVert !== 0) this.camera.position.y += moveVert * flySpeed * 0.75;

      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -360, 360);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -360, 360);
      this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, 1.4, 240);
      return;
    }

    if (this.mode === CameraMode.Overview) {
      if (hasManualInput) {
        this.camera.getWorldDirection(_fwd);
        _fwd.y = 0;
        if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
        _fwd.normalize();
        _right.crossVectors(_fwd, this.camera.up).normalize();

        const altScale = THREE.MathUtils.clamp(this.camera.position.y / 45, 0.45, 2.2);
        const panSpeed = this.config.overviewPanSpeed * altScale * speedMult * dt;

        if (moveFwd !== 0) {
          this.camera.position.addScaledVector(_fwd, moveFwd * panSpeed);
          this.controls.target.addScaledVector(_fwd, moveFwd * panSpeed);
        }
        if (moveRight !== 0) {
          this.camera.position.addScaledVector(_right, moveRight * panSpeed);
          this.controls.target.addScaledVector(_right, moveRight * panSpeed);
        }
        if (moveVert !== 0) {
          this.camera.position.y = THREE.MathUtils.clamp(
            this.camera.position.y + moveVert * 38 * speedMult * dt,
            4.5,
            240,
          );
        }
        if (yawRot !== 0) {
          _v1.subVectors(this.camera.position, this.controls.target);
          const angle = yawRot * 1.7 * dt;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = _v1.x * cos + _v1.z * sin;
          const nz = -_v1.x * sin + _v1.z * cos;
          _v1.x = nx;
          _v1.z = nz;
          this.camera.position.copy(this.controls.target).add(_v1);
        }
        if (zoomKey !== 0) {
          _v1.subVectors(this.camera.position, this.controls.target);
          const len = _v1.length();
          const newLen = THREE.MathUtils.clamp(len - zoomKey * 55 * speedMult * dt, 5, 320);
          _v1.setLength(newLen);
          this.camera.position.copy(this.controls.target).add(_v1);
        }

        this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -350, 350);
        this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -350, 350);
      }

      this.controls.update();
      this.applyCameraShake(dt);
      return;
    }

    if (!selectedUnit) {
      this.controls.update();
      this.applyCameraShake(dt);
      return;
    }

    if (this.mode === CameraMode.RearLightbar) {
      const fwdX = Math.sin(selectedUnit.yaw);
      const fwdZ = Math.cos(selectedUnit.yaw);
      const latX = Math.cos(selectedUnit.yaw) * selectedUnit.lateralOffset;
      const latZ = -Math.sin(selectedUnit.yaw) * selectedUnit.lateralOffset;
      const cx = selectedUnit.pos.x + latX;
      const cz = selectedUnit.pos.z + latZ;

      _targetGoal.set(cx + fwdX * 1.2, 1.45, cz + fwdZ * 1.2);
      _camGoal.set(
        cx - fwdX * 5.8 + Math.cos(selectedUnit.yaw) * 0.8,
        2.75,
        cz - fwdZ * 5.8 - Math.sin(selectedUnit.yaw) * 0.8,
      );

      const lambda = this.cameraNeedsSnap ? 100 : 9;
      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, _targetGoal.x, lambda, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, _targetGoal.y, lambda, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, _targetGoal.z, lambda, dt);
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camGoal.x, lambda, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camGoal.y, lambda, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camGoal.z, lambda, dt);
      this.cameraNeedsSnap = false;
    } else if (this.mode === CameraMode.FollowUnit) {
      let focusX = selectedUnit.pos.x;
      let focusZ = selectedUnit.pos.z;
      if (!selectedUnit.mounted) {
        focusX = (selectedUnit.officers[0].pos.x + selectedUnit.officers[1].pos.x) * 0.5;
        focusZ = (selectedUnit.officers[0].pos.z + selectedUnit.officers[1].pos.z) * 0.5;
      }

      _targetGoal.set(focusX, 1.2, focusZ);
      const prevTx = this.controls.target.x;
      const prevTz = this.controls.target.z;
      const lambda = this.cameraNeedsSnap ? 100 : 6.5;

      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, _targetGoal.x, lambda, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, _targetGoal.y, lambda, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, _targetGoal.z, lambda, dt);

      if (this.cameraNeedsSnap) {
        const fwdX = Math.sin(selectedUnit.yaw);
        const fwdZ = Math.cos(selectedUnit.yaw);
        this.camera.position.set(focusX - fwdX * 14 + 5, 9.5, focusZ - fwdZ * 14 + 5);
        this.cameraNeedsSnap = false;
      } else if (!this.userOrbiting) {
        this.camera.position.x += this.controls.target.x - prevTx;
        this.camera.position.z += this.controls.target.z - prevTz;
      }
    }

    this.controls.update();
    this.applyCameraShake(dt);
  }

  private applyCameraShake(dt: number): void {
    if (this.shakeIntensity <= 0.002) {
      this.shakeIntensity = 0;
      return;
    }
    this.appliedShake.set(
      (Math.random() - 0.5) * 2 * this.shakeIntensity,
      (Math.random() - 0.5) * 1.4 * this.shakeIntensity,
      (Math.random() - 0.5) * 2 * this.shakeIntensity,
    );
    this.camera.position.add(this.appliedShake);
    this.shakeIntensity *= Math.exp(-9.5 * dt);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    this.callbacks.onUnlockAudio();
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.keys.clear();
    this.isFreeDragging = false;
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.callbacks.onUnlockAudio();
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.lastDragPos = { x: e.clientX, y: e.clientY };
    this.dragMoved = false;

    if (this.mode === CameraMode.FreeFly && e.button === 0) {
      this.isFreeDragging = true;
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const dxTotal = e.clientX - this.pointerDownPos.x;
    const dyTotal = e.clientY - this.pointerDownPos.y;
    if (dxTotal * dxTotal + dyTotal * dyTotal > 16) {
      this.dragMoved = true;
    }

    if (this.isFreeDragging && this.mode === CameraMode.FreeFly) {
      const dx = e.clientX - this.lastDragPos.x;
      const dy = e.clientY - this.lastDragPos.y;
      this.freeYaw -= dx * 0.0045;
      this.freePitch = THREE.MathUtils.clamp(
        this.freePitch - dy * 0.0045,
        -Math.PI * 0.46,
        Math.PI * 0.42,
      );
      this.lastDragPos = { x: e.clientX, y: e.clientY };
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.isFreeDragging = false;
    if (this.dragMoved || e.button !== 0 || this.gizmoDragging || this.devEditorActive) return;

    const rect = this.domElement.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }
    _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_pointer, this.camera);
    const hits = _raycaster.intersectObjects(this.callbacks.getClickables(), false);
    if (hits.length > 0) {
      const uid = hits[0].object.userData.unitId as string | undefined;
      if (uid) {
        this.callbacks.onSelectUnit(uid);
      }
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    if (this.mode === CameraMode.FreeFly) {
      e.preventDefault();
      this.camera.getWorldDirection(_fwd);
      const step = -Math.sign(e.deltaY) * 6.5;
      this.camera.position.addScaledVector(_fwd, step);
      this.camera.position.y = Math.max(1.3, this.camera.position.y);
    }
  };

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.domElement.removeEventListener('wheel', this.handleWheel);
    this.controls.dispose();
  }
}
