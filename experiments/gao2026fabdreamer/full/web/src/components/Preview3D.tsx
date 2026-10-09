import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Canvas, Element, MaterialSettings, Project } from '../../../shared/types';
import { fileUrl } from '../api';

const imgCache = new Map<string, HTMLImageElement>();
function loadImg(src: string): Promise<HTMLImageElement> {
  const c = imgCache.get(src);
  if (c?.complete) return Promise.resolve(c);
  return new Promise((res, rej) => {
    const img = c ?? new Image();
    imgCache.set(src, img);
    img.onload = () => res(img);
    img.onerror = rej;
    if (!c) img.src = src;
  });
}

interface Props {
  project: Project;
  canvas: Canvas;
  elements: Record<string, Element>;
  material: MaterialSettings;
}

/** tool_2 translate: canvas → textured stacked 3D preview, refreshed whenever the canvas changes. */
export default function Preview3D({ project, canvas, elements, material }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; group: THREE.Group; controls: OrbitControls } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(-60, 120, 200);
    scene.add(dir);
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    camera.position.set(-120, 80, 320);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const group = new THREE.Group();
    scene.add(group);
    three.current = { renderer, scene, camera, group, controls };
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // rebuild layer textures (debounced) whenever the composition changes
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const ctx = three.current;
      if (!ctx) return;
      const mm = material.sheetWidthMm / canvas.width;
      const Wmm = canvas.width * mm;
      const Hmm = canvas.height * mm;
      const texScale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
      const meshes: THREE.Object3D[] = [];
      for (const layer of canvas.layers) {
        if (!layer.visible) continue;
        const cv = document.createElement('canvas');
        cv.width = Math.round(canvas.width * texScale);
        cv.height = Math.round(canvas.height * texScale);
        const g = cv.getContext('2d')!;
        g.scale(texScale, texScale);
        if (layer.frame) {
          g.fillStyle = '#d8cbb5';
          g.fill(new Path2D(framePathStr(canvas, layer.frameWidthMm / mm)), 'evenodd');
        }
        for (const id of layer.elementIds) {
          const e = elements[id];
          if (!e) continue;
          try {
            const img = await loadImg(fileUrl(project, e.texture));
            g.save();
            g.translate(e.x, e.y);
            g.rotate((e.rotation * Math.PI) / 180);
            g.scale(e.scale, e.scale);
            g.drawImage(img, -e.width / 2, -e.height / 2, e.width, e.height);
            g.restore();
          } catch {
            /* missing texture */
          }
        }
        if (cancelled) return;
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const z = -layer.depth * (material.layerGapMm + material.thicknessMm);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(Wmm, Hmm), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
        front.position.z = z;
        meshes.push(front);
        // fake sheet thickness: darker copies behind the face
        const steps = Math.max(1, Math.min(6, Math.round(material.thicknessMm / 0.5)));
        for (let s = 1; s <= steps; s++) {
          const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(Wmm, Hmm),
            new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, color: 0x6b5a45, side: THREE.DoubleSide }),
          );
          edge.position.z = z - (material.thicknessMm * s) / steps;
          meshes.push(edge);
        }
      }
      if (cancelled) return;
      for (const old of [...ctx.group.children]) {
        ctx.group.remove(old);
        (old as THREE.Mesh).geometry?.dispose();
      }
      // planes are centred at the origin; CanvasTexture's flipY maps canvas top to plane top
      for (const m of meshes) ctx.group.add(m);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project, canvas, elements, material]);

  return <div ref={host} className="preview3d" title="Drag to orbit, scroll to zoom" />;
}

function framePathStr(c: Canvas, f: number) {
  return `M0,0H${c.width}V${c.height}H0Z M${f},${f}V${c.height - f}H${c.width - f}V${f}Z`;
}
