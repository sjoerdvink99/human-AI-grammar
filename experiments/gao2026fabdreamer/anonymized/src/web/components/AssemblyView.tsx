// tool_2 translate: r27 (artifact spatial) → r28 (artifact visual), a three.js rendering.
// When `editable`, it is also the surface for P7's [human modify]: click to select, drag the gizmo to move/rotate.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Part3D, Vec3 } from "../../shared/types";
import { viewBoxOf } from "../../shared/tools1";

interface Props {
  parts: Part3D[];
  selectedId?: string | null;
  highlightIds?: string[];
  ghostParts?: Part3D[];
  editable?: boolean;
  mode?: "translate" | "rotate";
  onSelect?: (id: string | null) => void;
  onTransform?: (id: string, position: Vec3, rotationY: number) => void;
  height?: number;
}

export function buildGeometry(p: Part3D): THREE.BufferGeometry {
  const { w, h, d } = p.size;
  if (p.shape === "cylinder") {
    const g = new THREE.CylinderGeometry(w / 2, w / 2, h, 40);
    g.scale(1, 1, d / Math.max(w, 1e-6));
    return g;
  }
  if (p.shape === "profile" && p.profileSvg) {
    try {
      const vb = viewBoxOf(p.profileSvg);
      const data = new SVGLoader().parse(p.profileSvg);
      const shapes: THREE.Shape[] = [];
      for (const path of data.paths) {
        const fill = String((path.userData as { style?: { fill?: string } })?.style?.fill ?? "").toLowerCase();
        if (fill === "none" || fill === "#fff" || fill === "#ffffff" || fill === "white") continue;
        for (const sh of SVGLoader.createShapes(path)) {
          const pts = sh.getPoints();
          const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
          const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
          if (area > vb.w * vb.h * 1.2) continue; // background-like shape outside the crop
          shapes.push(sh);
        }
      }
      if (shapes.length) {
        const g = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, curveSegments: 8 });
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        const size = new THREE.Vector3(); bb.getSize(size);
        const centre = new THREE.Vector3(); bb.getCenter(centre);
        g.translate(-centre.x, -centre.y, -centre.z);
        const horiz = p.profileAxis === "x" ? d : w;
        const extr = p.profileAxis === "x" ? w : d;
        g.scale(horiz / Math.max(size.x, 1e-6), -h / Math.max(size.y, 1e-6), extr / Math.max(size.z, 1e-6)); // flip SVG y-down
        if (p.profileAxis === "x") g.rotateY(-Math.PI / 2);
        g.computeVertexNormals();
        return g;
      }
    } catch { /* fall back to a box */ }
  }
  return new THREE.BoxGeometry(w, h, d);
}

export function AssemblyView({ parts, selectedId, highlightIds = [], ghostParts = [], editable, mode = "translate", onSelect, onTransform, height = 460 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; orbit: OrbitControls;
    gizmo: TransformControls; group: THREE.Group; fitted: boolean; dragging: boolean;
  } | null>(null);
  const cb = useRef({ onSelect, onTransform });
  cb.current = { onSelect, onTransform };

  // set up renderer once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0xf4f2ee);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
    camera.position.set(900, 700, 1100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8577, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(600, 1200, 800); scene.add(sun);
    const grid = new THREE.GridHelper(4000, 80, 0xb9b3a8, 0xdcd7ce); scene.add(grid);
    const group = new THREE.Group(); scene.add(group);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 200, 0); orbit.update();
    const gizmo = new TransformControls(camera, renderer.domElement);
    scene.add(gizmo.getHelper());
    const state = { renderer, scene, camera, orbit, gizmo, group, fitted: false, dragging: false };
    ctx.current = state;

    gizmo.addEventListener("dragging-changed", (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value);
      orbit.enabled = !dragging; state.dragging = dragging;
      const obj = gizmo.object;
      if (!dragging && obj) {
        cb.current.onTransform?.(obj.userData.id, {
          x: round(obj.position.x), y: round(obj.position.y), z: round(obj.position.z),
        }, round(THREE.MathUtils.radToDeg(obj.rotation.y)));
      }
    });

    const ray = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || state.dragging) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(group.children.filter((c) => !c.userData.ghost), false)[0];
      cb.current.onSelect?.(hit ? hit.object.userData.id : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); renderer.render(scene, camera); };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); gizmo.detach(); gizmo.dispose(); orbit.dispose(); renderer.dispose();
      renderer.domElement.remove(); ctx.current = null;
    };
  }, []);

  // rebuild meshes when the parts change
  useEffect(() => {
    const c = ctx.current; if (!c) return;
    c.gizmo.detach();
    c.group.children.forEach((m) => { const mesh = m as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
    c.group.clear();
    const add = (p: Part3D, ghost: boolean) => {
      const mat = new THREE.MeshStandardMaterial({
        color: ghost ? 0x3b82f6 : p.color, roughness: 0.75, metalness: /steel|metal|alumin/i.test(p.material) ? 0.4 : 0.05,
        side: THREE.DoubleSide, transparent: ghost, opacity: ghost ? 0.45 : 1,
        emissive: new THREE.Color(!ghost && highlightIds.includes(p.id) ? 0x992222 : !ghost && p.id === selectedId ? 0x1d4ed8 : 0x000000),
        emissiveIntensity: 0.45,
      });
      const mesh = new THREE.Mesh(buildGeometry(p), mat);
      mesh.position.set(p.position.x, p.position.y, p.position.z);
      mesh.rotation.y = THREE.MathUtils.degToRad(p.rotationY);
      mesh.userData = { id: p.id, ghost };
      c.group.add(mesh);
      if (!ghost && editable && p.id === selectedId) c.gizmo.attach(mesh);
    };
    parts.forEach((p) => add(p, false));
    ghostParts.forEach((p) => add(p, true));
    c.gizmo.setMode(mode);
    c.gizmo.showX = mode === "translate"; c.gizmo.showZ = mode === "translate"; c.gizmo.showY = true;
    if (!c.fitted && parts.length) {
      const box = new THREE.Box3().setFromObject(c.group);
      const size = box.getSize(new THREE.Vector3()).length() || 500;
      const centre = box.getCenter(new THREE.Vector3());
      c.orbit.target.copy(centre);
      c.camera.position.set(centre.x + size * 0.55, centre.y + size * 0.4, centre.z + size * 0.75);
      c.orbit.update(); c.fitted = true;
    }
  }, [parts, selectedId, highlightIds.join(","), ghostParts, editable, mode]);

  return <div ref={host} className="viewport" style={{ height }} />;
}

const round = (n: number) => Math.round(n * 10) / 10;
