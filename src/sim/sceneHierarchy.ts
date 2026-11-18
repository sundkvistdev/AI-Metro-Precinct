import * as THREE from 'three';

function createNamedGroup(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

export function disposeGroupContents(group: THREE.Group): void {
  const removed = [...group.children];
  for (const child of removed) {
    group.remove(child);
    child.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      } else if (obj instanceof THREE.Sprite) {
        obj.material?.dispose();
      }
    });
  }
}

/**
 * Structured Three.js scene graph separating static environment geometry,
 * flat live simulation entities directly under EntitiesRoot, and transient VFX layers.
 */
export class SceneWorldHierarchy {
  public readonly root: THREE.Scene;

  public readonly worldRoot: THREE.Group;
  public readonly world = {
    terrain: createNamedGroup('world_terrain'),
    roads: createNamedGroup('world_roads'),
    buildings: createNamedGroup('world_buildings'),
    atmosphere: createNamedGroup('world_atmosphere'),
  };

  public readonly entitiesRoot: THREE.Group;

  public readonly effectsRoot: THREE.Group;
  public readonly effects = {
    tracers: createNamedGroup('effects_tracers'),
    vfx: createNamedGroup('effects_vfx'),
    debris: createNamedGroup('effects_debris'),
  };

  constructor(scene: THREE.Scene) {
    this.root = scene;

    this.worldRoot = createNamedGroup('WorldRoot');
    this.worldRoot.add(
      this.world.terrain,
      this.world.roads,
      this.world.buildings,
      this.world.atmosphere,
    );

    this.entitiesRoot = createNamedGroup('EntitiesRoot');

    this.effectsRoot = createNamedGroup('EffectsRoot');
    this.effectsRoot.add(
      this.effects.tracers,
      this.effects.vfx,
      this.effects.debris,
    );

    this.root.add(this.worldRoot, this.entitiesRoot, this.effectsRoot);
  }

  public addEntity(object: THREE.Object3D): void {
    this.entitiesRoot.add(object);
  }

  public removeEntity(object: THREE.Object3D): void {
    this.entitiesRoot.remove(object);
  }

  public clearAllLayers(): void {
    disposeGroupContents(this.world.terrain);
    disposeGroupContents(this.world.roads);
    disposeGroupContents(this.world.buildings);
    disposeGroupContents(this.world.atmosphere);

    disposeGroupContents(this.entitiesRoot);

    disposeGroupContents(this.effects.tracers);
    disposeGroupContents(this.effects.vfx);
    disposeGroupContents(this.effects.debris);
  }
}
