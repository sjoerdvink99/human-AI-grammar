// model_view: rendered 3D view of the scene. Supports [human select] by clicking parts
// and shows linked_highlight for the selected subtree.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildThreeScene, disposeObject, type BuiltScene } from '../three/build';
import { findParent, type Scene } from '../shared/scene';

interface Props {
  scene: Scene | null;
  selectedId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string | null) => void;
  /** increments when the camera should re-frame the object (new generation) */
  frameKey: number;
}

const HIGHLIGHT = new THREE.Color('#ff8a1f');

interface Ctx {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Scene;
  built: BuiltScene | null;
  box: THREE.Box3Helper | null;
}

export function ModelView({ scene, selectedId, highlightIds, onSelect, frameKey }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const propsRef = useRef({ scene, selectedId, onSelect });
  propsRef.current = { scene, selectedId, onSelect };

  // one-time renderer setup
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color('#eef1f5');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(3, 2.5, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.6, 0);

    world.add(new THREE.HemisphereLight('#ffffff', '#b9c2cf', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    world.add(sun);
    const grid = new THREE.GridHelper(20, 40, '#b5bfcc', '#d5dbe3');
    world.add(grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);

    const ctx: Ctx = { renderer, camera, controls, world, built: null, box: null };
    ctxRef.current = ctx;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // click-to-select with raycasting (ignore drags used for orbiting)
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ctx.built ? ray.intersectObject(ctx.built.root, true) : [];
      const hit = hits.find((h) => h.object instanceof THREE.Mesh && h.object.userData.nodeId);
      const { scene: s, selectedId: sel, onSelect: select } = propsRef.current;
      if (!hit) return select(null);
      const id = hit.object.userData.nodeId as string;
      // clicking the already-selected part climbs to its parent subassembly
      if (id === sel && s) {
        const p = findParent(s, id);
        return select(p ? p.id : id);
      }
      // clicking inside a selected subassembly keeps climbing behaviour intuitive: select the part
      select(id);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = () => {
      controls.update();
      if (ctx.box) ctx.box.box.setFromObject(ctx.box.userData.target as THREE.Object3D);
      renderer.render(world, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  // rebuild geometry whenever the scene changes ([tool translate])
  useEffect(() => {
    const ctx = ctxRef.current!;
    if (ctx.built) {
      ctx.world.remove(ctx.built.root);
      disposeObject(ctx.built.root);
      ctx.built = null;
    }
    if (scene) {
      ctx.built = buildThreeScene(scene);
      ctx.world.add(ctx.built.root);
    }
  }, [scene]);

  // re-frame the camera on new generations
  useEffect(() => {
    const ctx = ctxRef.current!;
    if (!ctx.built) return;
    const box = new THREE.Box3().setFromObject(ctx.built.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    ctx.controls.target.copy(center);
    const dir = new THREE.Vector3(1, 0.7, 1.3).normalize();
    ctx.camera.position.copy(center).addScaledVector(dir, Math.max(size * 1.3, 1));
    ctx.camera.near = size / 200;
    ctx.camera.far = size * 100 + 50;
    ctx.camera.updateProjectionMatrix();
  }, [frameKey]);

  // linked_highlight in the 3D view
  useEffect(() => {
    const ctx = ctxRef.current!;
    if (ctx.box) {
      ctx.world.remove(ctx.box);
      ctx.box.dispose();
      ctx.box = null;
    }
    if (!ctx.built) return;
    for (const [id, obj] of ctx.built.byId) {
      if (obj instanceof THREE.Mesh) {
        const m = obj.material as THREE.MeshStandardMaterial;
        const on = highlightIds.has(id);
        m.emissive.copy(on ? HIGHLIGHT : new THREE.Color(0, 0, 0));
        m.emissiveIntensity = on ? 0.45 : 0;
      }
    }
    const target = selectedId ? ctx.built.byId.get(selectedId) : undefined;
    if (target) {
      const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(target), HIGHLIGHT);
      helper.userData.target = target;
      ctx.world.add(helper);
      ctx.box = helper;
    }
  }, [scene, selectedId, highlightIds]);

  return <div className="model-view" ref={hostRef} />;
}
