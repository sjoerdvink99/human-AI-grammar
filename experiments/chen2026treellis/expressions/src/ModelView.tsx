// model_view (artifact visual): the 3D rendering of the structure tree.
// Also renders linked_highlight (selection visual) for the selected node and lets the user
// select a node by clicking an object (process 2, human select).
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneNode } from '../shared/scene';
import { walk } from '../shared/scene';

interface Props {
  tree: SceneNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** changes when the camera should re-frame the scene (new generation) */
  fitKey: number;
}

const DEG = Math.PI / 180;
const HIGHLIGHT = 0xffc83d;

function vec(v: unknown, d: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : d;
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' ? v : d;
}

function buildObject(n: SceneNode, index: Map<string, THREE.Object3D>): THREE.Object3D {
  let obj: THREE.Object3D;
  const a = n.attrs;
  if (n.type === 'scene' || n.type === 'group') {
    obj = new THREE.Group();
  } else {
    let geo: THREE.BufferGeometry;
    switch (n.type) {
      case 'box': {
        const [w, h, d] = vec(a.size, [1, 1, 1]);
        geo = new THREE.BoxGeometry(w, h, d);
        break;
      }
      case 'sphere':
        geo = new THREE.SphereGeometry(num(a.radius, 0.5), 32, 20);
        break;
      case 'cylinder':
        geo = new THREE.CylinderGeometry(num(a.radius, 0.5), num(a.radius, 0.5), num(a.height, 1), 32);
        break;
      case 'cone':
        geo = new THREE.ConeGeometry(num(a.radius, 0.5), num(a.height, 1), 32);
        break;
      case 'torus':
        geo = new THREE.TorusGeometry(num(a.radius, 0.5), num(a.tube, 0.15), 16, 48);
        break;
      case 'plane':
      default: {
        const [w, d] = vec(a.size, [1, 1]);
        geo = new THREE.PlaneGeometry(w, d);
        geo.rotateX(-Math.PI / 2);
      }
    }
    const opacity = num(a.opacity, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: typeof a.color === 'string' ? a.color : '#9aa5b1',
      metalness: num(a.metalness, 0.1),
      roughness: num(a.roughness, 0.7),
      transparent: opacity < 1,
      opacity,
      side: n.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = n.type !== 'plane';
    mesh.receiveShadow = true;
    obj = mesh;
  }
  if (n.type !== 'scene') {
    const [x, y, z] = vec(a.position, [0, 0, 0]);
    const [rx, ry, rz] = vec(a.rotation, [0, 0, 0]);
    const [sx, sy, sz] = vec(a.scale, [1, 1, 1]);
    obj.position.set(x, y, z);
    obj.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    obj.scale.set(sx, sy, sz);
  }
  obj.userData.nodeId = n.id;
  obj.name = n.name;
  index.set(n.id, obj);
  for (const c of n.children) obj.add(buildObject(c, index));
  return obj;
}

export function ModelView({ tree, selectedId, onSelect, fitKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Object3D | null;
    index: Map<string, THREE.Object3D>;
    helper: THREE.BoxHelper | null;
    lastFit: number;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // set up renderer once
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(4, 3, 5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    scene.add(sun);
    const grid = new THREE.GridHelper(20, 40, 0x445060, 0x2c333b);
    grid.position.y = -0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    ctx.current = { renderer, scene, camera, controls, content: null, index: new Map(), helper: null, lastFit: -1 };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // click (not drag) to select
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
      const c = ctx.current!;
      const hits = c.content ? ray.intersectObject(c.content, true) : [];
      onSelectRef.current(hits.length ? hits[0].object.userData.nodeId : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      ctx.current?.helper?.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // tool translate: rebuild the 3D content whenever the structure tree changes
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.content) {
      c.scene.remove(c.content);
      c.content.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    c.index = new Map();
    c.content = buildObject(tree, c.index);
    c.scene.add(c.content);
    const bg = typeof tree.attrs.background === 'string' ? tree.attrs.background : '#1e2329';
    c.scene.background = new THREE.Color(bg);

    if (c.lastFit !== fitKey) {
      c.lastFit = fitKey;
      // Frame the objects, not large ground planes (fall back to everything if only planes exist).
      const box = new THREE.Box3();
      c.content.updateMatrixWorld(true);
      c.content.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o.geometry instanceof THREE.PlaneGeometry)) box.expandByObject(o);
      });
      if (box.isEmpty()) box.setFromObject(c.content);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());
        c.controls.target.copy(center);
        c.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.45, 0.75).normalize().multiplyScalar(size * 1.3 + 0.5));
        c.camera.near = size / 200 + 0.001;
        c.camera.far = size * 50 + 100;
        c.camera.updateProjectionMatrix();
      }
    }
  }, [tree, fitKey]);

  // linked_highlight: bounding box + emissive tint on the selected node's meshes
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.helper) {
      c.scene.remove(c.helper);
      c.helper.dispose();
      c.helper = null;
    }
    walk(tree, (n) => {
      const o = c.index.get(n.id);
      if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    });
    if (!selectedId) return;
    const target = c.index.get(selectedId);
    if (!target) return;
    if (selectedId !== '0') {
      c.helper = new THREE.BoxHelper(target, HIGHLIGHT);
      (c.helper.material as THREE.LineBasicMaterial).depthTest = false;
      c.helper.renderOrder = 999;
      c.scene.add(c.helper);
    }
    target.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissive.setHex(0x3a2a00);
    });
  }, [tree, selectedId]);

  return <div className="model-view" ref={hostRef} />;
}
