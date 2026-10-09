// tool_2 — 3D rendering library (three.js).
//   urban_plan_1 -> [tool_2 translate] -> city_model_1
//   city_model_1 + density_grid_2 -> [tool_2 modify] -> city_model_2
// and tool_3's depth capture: city_model_2 -> [tool_3 translate] -> depth_map_1
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL, N_BLOCKS, SITE, STREET, ZONE_COLOR, type DensityGrid, type UrbanPlan } from '../urban/types';
import { blockDensity, depthImageToGrid } from './urbanPre';

export const MAX_HEIGHT = 160;

/** city_model: building boxes derived from per-zone templates. */
export interface Building { x: number; z: number; w: number; d: number; h: number; color: string; kind: 'box' | 'tree' }
export interface CityModel { plan: UrbanPlan; buildings: Building[] }

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Template per zone; heights follow the block's clay density. */
export function buildCity(plan: UrbanPlan, density: DensityGrid | null): CityModel {
  const buildings: Building[] = [];
  const inner = CELL - STREET;
  for (const b of plan.blocks) {
    const x0 = b.i * CELL + STREET / 2;
    const z0 = b.j * CELL + STREET / 2;
    const dens = density ? blockDensity(density, b.i, b.j) : null;
    const seed = b.i * 31 + b.j * 17;
    const H = (base: number) => Math.max(4, (dens ?? base) * MAX_HEIGHT);
    const col = ZONE_COLOR[b.zone];
    switch (b.zone) {
      case 'residential': {
        // 2×2 houses
        const s = inner / 2;
        for (let k = 0; k < 4; k++) {
          const hx = x0 + (k % 2) * s + 3, hz = z0 + Math.floor(k / 2) * s + 3;
          buildings.push({ x: hx, z: hz, w: s - 6, d: s - 6, h: H(0.3) * (0.7 + 0.5 * rand(seed + k)), color: col, kind: 'box' });
        }
        break;
      }
      case 'commercial':
        buildings.push({ x: x0 + 4, z: z0 + 4, w: inner - 8, d: inner - 8, h: H(0.75), color: col, kind: 'box' });
        break;
      case 'mixed':
        buildings.push({ x: x0 + 1, z: z0 + 1, w: inner - 2, d: inner - 2, h: Math.min(18, H(0.5)), color: '#d9c7ef', kind: 'box' });
        buildings.push({ x: x0 + inner * 0.3, z: z0 + inner * 0.3, w: inner * 0.4, d: inner * 0.4, h: H(0.5), color: col, kind: 'box' });
        break;
      case 'industrial':
        buildings.push({ x: x0 + 2, z: z0 + 6, w: inner - 4, d: inner - 14, h: Math.max(6, H(0.25) * 0.5), color: col, kind: 'box' });
        buildings.push({ x: x0 + inner - 9, z: z0 + 2, w: 5, d: 5, h: H(0.25) * 1.2, color: '#666', kind: 'box' });
        break;
      case 'park':
        for (let k = 0; k < 5; k++) {
          buildings.push({ x: x0 + 6 + rand(seed + k) * (inner - 12), z: z0 + 6 + rand(seed + k + 50) * (inner - 12), w: 8, d: 8, h: 12 + 6 * rand(seed + k + 9), color: '#3d8b3d', kind: 'tree' });
        }
        break;
      default:
        break;
    }
  }
  return { plan, buildings };
}

/** city_model_1 + density_grid_2 -> [tool_2 modify] -> city_model_2 */
export function updateCityHeights(city: CityModel, density: DensityGrid): CityModel {
  return buildCity(city.plan, density);
}

function blockMeshes(plan: UrbanPlan): THREE.Group {
  const g = new THREE.Group();
  for (const b of plan.blocks) {
    const inner = CELL - STREET;
    const color = b.zone === 'park' ? '#8fcf8f' : b.zone === 'none' ? '#e9e4da' : '#d8d2c6';
    const m = new THREE.Mesh(new THREE.BoxGeometry(inner, 1, inner), new THREE.MeshLambertMaterial({ color }));
    m.position.set(b.i * CELL + CELL / 2, 0.5, b.j * CELL + CELL / 2);
    g.add(m);
  }
  return g;
}

function cityMeshes(city: CityModel, depthMaterial?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const b of city.buildings) {
    const mat = depthMaterial ?? new THREE.MeshLambertMaterial({ color: b.color });
    const geo = b.kind === 'tree' ? new THREE.ConeGeometry(b.w / 2, b.h, 8) : new THREE.BoxGeometry(b.w, b.h, b.d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.x + b.w / 2, b.h / 2 + 1, b.z + b.d / 2);
    g.add(m);
  }
  return g;
}

/** Interactive 3D view of city_model. */
export class CityView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private city = new THREE.Group();
  private ground = new THREE.Group();
  private raf = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.position.set(SITE * 1.05, SITE * 0.8, SITE * 1.15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(SITE / 2, 0, SITE / 2);
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.scene.background = new THREE.Color('#f4f1ea');
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.55));
    const sun = new THREE.DirectionalLight('#fff6e0', 1.2);
    sun.position.set(SITE, SITE * 1.5, SITE * 0.3);
    this.scene.add(sun);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(SITE, SITE), new THREE.MeshLambertMaterial({ color: '#9a9a9a' }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(SITE / 2, 0, SITE / 2);
    this.scene.add(base, this.ground, this.city);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  resize() {
    const w = this.host.clientWidth || 600, h = this.host.clientHeight || 450;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  show(city: CityModel) {
    const plan = city.plan;
    this.scene.remove(this.ground, this.city);
    this.ground = blockMeshes(plan);
    this.city = cityMeshes(city);
    this.scene.add(this.ground, this.city);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * city_model_2 -> [tool_3 translate] -> depth_map_1
 * Top-down orthographic depth render: brighter = closer to the camera (taller).
 */
export function renderDepthMap(city: CityModel, size = 256): { png: string; grid: number[][] } {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const far = MAX_HEIGHT * 1.6 + 10;
  const cam = new THREE.OrthographicCamera(-SITE / 2, SITE / 2, SITE / 2, -SITE / 2, 1, far + 1);
  cam.position.set(SITE / 2, far, SITE / 2);
  cam.up.set(0, 0, -1);
  cam.lookAt(SITE / 2, 0, SITE / 2);
  // depth = height above ground, linear
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying float vY; void main(){ float d = clamp(vY / ${(MAX_HEIGHT * 1.2).toFixed(1)}, 0.0, 1.0); gl_FragColor = vec4(vec3(d), 1.0); }`,
  });
  scene.add(cityMeshes(city, mat));
  renderer.render(scene, cam);
  const src = renderer.domElement;
  const c2 = document.createElement('canvas');
  c2.width = size; c2.height = size;
  const ctx = c2.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, size, size).data;
  const png = c2.toDataURL('image/png');
  renderer.dispose();
  renderer.forceContextLoss();
  return { png, grid: depthImageToGrid(data, size, size, N_BLOCKS * 2) };
}
