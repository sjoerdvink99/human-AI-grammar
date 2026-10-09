// [tool translate] scene -> model_view: build a three.js object hierarchy that mirrors the assembly tree.
import * as THREE from 'three';
import type { Geometry, Scene, SceneNode } from '../shared/scene';

const DEG = Math.PI / 180;

export function makeGeometry(g: Geometry): THREE.BufferGeometry {
  switch (g.shape) {
    case 'box':
      return new THREE.BoxGeometry(g.width, g.height, g.depth);
    case 'sphere':
      return new THREE.SphereGeometry(g.radius, 32, 20);
    case 'cylinder':
      return new THREE.CylinderGeometry(g.radiusTop, g.radiusBottom, g.height, 32);
    case 'cone':
      return new THREE.ConeGeometry(g.radius, g.height, 32);
    case 'torus':
      return new THREE.TorusGeometry(g.radius, g.tube, 16, 48);
    case 'capsule':
      return new THREE.CapsuleGeometry(g.radius, g.length, 8, 24);
  }
}

export interface BuiltScene {
  root: THREE.Object3D;
  /** scene node id -> its Object3D (group or mesh) */
  byId: Map<string, THREE.Object3D>;
}

function buildNode(n: SceneNode, byId: Map<string, THREE.Object3D>): THREE.Object3D {
  let obj: THREE.Object3D;
  if (n.kind === 'part' && n.geometry) {
    const mat = new THREE.MeshStandardMaterial({ color: n.color ?? '#9aa4b2', roughness: 0.6, metalness: 0.05 });
    const mesh = new THREE.Mesh(makeGeometry(n.geometry), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    obj = mesh;
  } else {
    obj = new THREE.Group();
  }
  obj.name = n.name;
  obj.userData.nodeId = n.id;
  obj.position.set(...n.position);
  obj.rotation.set(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG);
  obj.scale.set(...n.scale);
  byId.set(n.id, obj);
  for (const c of n.children) obj.add(buildNode(c, byId));
  return obj;
}

export function buildThreeScene(scene: Scene): BuiltScene {
  const byId = new Map<string, THREE.Object3D>();
  const root = buildNode(scene.root, byId);
  return { root, byId };
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
