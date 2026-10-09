// tool_2: VR runtime and scene editing system (three.js + WebXR).
// Desktop: drag to orbit, click an object to point at it, Shift+click the floor to point at a position.
// Headset: controller trigger points at objects/floor, grip (squeeze) toggles speech recording.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SceneGraph, SceneObject, Target } from '../../shared/types';
import { wallPoint } from '../../shared/geometry';

export class VRRuntime {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private roomGroup = new THREE.Group();
  private objectGroup = new THREE.Group();
  private targetGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private floor: THREE.Mesh | null = null;
  private meshes = new Map<string, THREE.Mesh>();
  graph: SceneGraph | null = null;
  targets: Target[] = [];
  onTargetsChanged: (t: Target[]) => void = () => {};
  onSqueeze: (pressed: boolean) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'labels';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color('#e9ecef');
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 100);
    this.camera.position.set(2, 6, 9);
    this.controls = new OrbitControls(this.camera, this.labelRenderer.domElement);
    this.controls.target.set(2, 0, 2);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8d8d8d', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(4, 8, 3);
    sun.castShadow = true;
    this.scene.add(sun, this.roomGroup, this.objectGroup, this.targetGroup);

    const vrButton = VRButton.createButton(this.renderer);
    vrButton.classList.add('vr-button');
    container.appendChild(vrButton);
    this.setupControllers();

    this.labelRenderer.domElement.addEventListener('pointerdown', (e) => (this.downAt = [e.clientX, e.clientY]));
    this.labelRenderer.domElement.addEventListener('pointerup', (e) => this.onClick(e));
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (!this.renderer.xr.isPresenting) this.labelRenderer.render(this.scene, this.camera);
    });
  }

  private downAt: [number, number] = [0, 0];

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  private setupControllers() {
    for (let i = 0; i < 2; i++) {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]), new THREE.LineBasicMaterial({ color: '#ff8800' }));
      c.add(line);
      c.addEventListener('select', () => {
        const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(m);
        this.pick(false, true);
      });
      c.addEventListener('squeezestart', () => this.onSqueeze(true));
      c.addEventListener('squeezeend', () => this.onSqueeze(false));
      this.scene.add(c);
    }
  }

  /** human select: pointing at objects (click) or floor positions (Shift+click). */
  private onClick(e: PointerEvent) {
    if (Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5 || e.button !== 0) return; // a drag, not a click
    const rect = this.labelRenderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.pick(e.shiftKey, false);
  }

  private pick(positionOnly: boolean, vr: boolean) {
    if (!this.graph) return;
    if (!positionOnly) {
      const hit = this.raycaster.intersectObjects([...this.meshes.values()], false)[0];
      if (hit) {
        const id = hit.object.userData.id as string;
        const o = this.graph.objects.find((x) => x.id === id)!;
        // clicking a pointed object again un-points it
        const idx = this.targets.findIndex((t) => t.kind === 'object' && t.id === id);
        if (idx >= 0) this.targets.splice(idx, 1);
        else this.targets.push({ kind: 'object', id, label: o.label });
        this.refreshTargets();
        return;
      }
      if (!vr) return;
    }
    const fh = this.floor && this.raycaster.intersectObject(this.floor, false)[0];
    if (fh) {
      this.targets.push({ kind: 'position', x: Math.round(fh.point.x * 100) / 100, z: Math.round(fh.point.z * 100) / 100 });
      this.refreshTargets();
    }
  }

  clearTargets() {
    this.targets = [];
    this.refreshTargets();
  }

  private refreshTargets() {
    for (const [id, m] of this.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const n = this.targets.findIndex((t) => t.kind === 'object' && t.id === id);
      mat.emissive.set(n >= 0 ? '#ff7a00' : '#000000');
      mat.emissiveIntensity = n >= 0 ? 0.55 : 0;
    }
    this.targetGroup.clear();
    this.targets.forEach((t, i) => {
      if (t.kind === 'object') {
        const m = this.meshes.get(t.id);
        if (m) this.targetGroup.add(this.label(`${i + 1}`, m.position.x, (m.userData.h as number) + 0.35, m.position.z, 'target-label'));
        return;
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 32), new THREE.MeshBasicMaterial({ color: '#ff7a00', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.x, 0.02, t.z);
      this.targetGroup.add(ring, this.label(`${i + 1}`, t.x, 0.3, t.z, 'target-label'));
    });
    this.onTargetsChanged([...this.targets]);
  }

  private label(text: string, x: number, y: number, z: number, cls: string) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    const l = new CSS2DObject(div);
    l.position.set(x, y, z);
    return l;
  }

  /** tool_2 translate: scene_graph → interactive 3D scene. */
  loadSceneGraph(graph: SceneGraph, resetCamera = true) {
    this.graph = graph;
    this.buildRoom(graph);
    this.objectGroup.clear();
    this.meshes.clear();
    for (const o of graph.objects) this.addObjectMesh(o);
    this.targets = this.targets.filter((t) => t.kind === 'position' || graph.objects.some((o) => o.id === t.id));
    this.refreshTargets();
    if (resetCamera) {
      const { width: w, depth: d } = graph.room;
      this.controls.target.set(w / 2, 0, d / 2);
      this.camera.position.set(w / 2, Math.max(w, d) * 1.55, d / 2 + Math.max(w, d) * 1.25);
      // in VR the user stands near the door
      this.scene.position.set(0, 0, 0);
    }
  }

  private addObjectMesh(o: SceneObject) {
    const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.75 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mat);
    mesh.position.set(o.x, o.h / 2, o.z);
    mesh.rotation.y = (o.rotation * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { id: o.id, h: o.h };
    // front marker: a small wedge on top pointing to the object's front (+z local)
    if (o.type !== 'rug') {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      marker.rotation.x = Math.PI / 2;
      marker.position.set(0, o.h / 2 + 0.01, o.d / 2 - 0.1);
      marker.raycast = () => {};
      mesh.add(marker);
    }
    this.objectGroup.add(mesh, this.label(o.id, o.x, o.h + 0.12, o.z, 'object-label'));
    this.meshes.set(o.id, mesh);
  }

  private buildRoom(g: SceneGraph) {
    this.roomGroup.clear();
    const { width: W, depth: D, height: H } = g.room;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#d9c8ad', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, D / 2);
    floor.receiveShadow = true;
    this.floor = floor;
    this.roomGroup.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D)), '#bba98c', '#c9b799');
    grid.position.set(W / 2, 0.001, D / 2);
    this.roomGroup.add(grid);
    // walls face inward so walls between the camera and the room are see-through
    const wallMat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', side: THREE.FrontSide });
    const walls: [number, number, number, number, number][] = [
      [W, W / 2, D * 0 + 0, 0, 0], // north (z=0), faces +z
      [W, W / 2, D, Math.PI, 0], // south
      [D, 0, D / 2, Math.PI / 2, 0], // west (x=0), faces +x
      [D, W, D / 2, -Math.PI / 2, 0], // east
    ];
    for (const [len, x, z, ry] of walls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
      m.position.set(x, H / 2, z);
      m.rotation.y = ry;
      this.roomGroup.add(m);
    }
    const opening = (wall: SceneGraph['room']['door']['wall'], offset: number, width: number, y: number, h: number, color: string) => {
      const c = wallPoint(g.room, wall, offset + width / 2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ color }));
      const inset = 0.01;
      m.position.set(c.x + (wall === 'west' ? inset : wall === 'east' ? -inset : 0), y, c.z + (wall === 'north' ? inset : wall === 'south' ? -inset : 0));
      m.rotation.y = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 }[wall];
      this.roomGroup.add(m);
    };
    for (const w of g.room.windows) opening(w.wall, w.offset, w.width, 1.5, 1.2, '#9fd3f2');
    opening(g.room.door.wall, g.room.door.offset, g.room.door.width, 1.0, 2.0, '#8a6a4a');
  }

  /** tool_2 translate (process 3): final scene → top-down image with labels for the vision-language model. */
  renderTopdown(px = 70): { png: string; legend: string } {
    const g = this.graph!;
    const pad = 40;
    const cv = document.createElement('canvas');
    cv.width = g.room.width * px + pad * 2;
    cv.height = g.room.depth * px + pad * 2;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#efe6d6';
    ctx.fillRect(pad, pad, g.room.width * px, g.room.depth * px);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.strokeRect(pad, pad, g.room.width * px, g.room.depth * px);
    const seg = (wall: string, offset: number, width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      const p = wallPoint(g.room, wall as any, offset), q = wallPoint(g.room, wall as any, offset + width);
      ctx.moveTo(pad + p.x * px, pad + p.z * px);
      ctx.lineTo(pad + q.x * px, pad + q.z * px);
      ctx.stroke();
    };
    for (const w of g.room.windows) seg(w.wall, w.offset, w.width, '#3fa7e0');
    seg(g.room.door.wall, g.room.door.offset, g.room.door.width, '#a0522d');
    const sorted = [...g.objects].sort((a, b) => (a.type === 'rug' ? -1 : b.type === 'rug' ? 1 : 0));
    ctx.font = '12px sans-serif';
    for (const o of sorted) {
      ctx.save();
      ctx.translate(pad + o.x * px, pad + o.z * px);
      ctx.rotate((-o.rotation * Math.PI) / 180);
      ctx.fillStyle = o.color;
      ctx.globalAlpha = o.type === 'rug' ? 0.55 : 0.9;
      ctx.fillRect((-o.w / 2) * px, (-o.d / 2) * px, o.w * px, o.d * px);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((-o.w / 2) * px, (-o.d / 2) * px, o.w * px, o.d * px);
      // front triangle
      ctx.fillStyle = '#222';
      const s = Math.min(o.w, o.d) * px * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, (o.d / 2) * px - 2);
      ctx.lineTo(-s, (o.d / 2) * px - s - 2);
      ctx.lineTo(s, (o.d / 2) * px - s - 2);
      ctx.fill();
      ctx.restore();
    }
    for (const o of g.objects) {
      const tw = ctx.measureText(o.id).width;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(pad + o.x * px - tw / 2 - 2, pad + o.z * px - 8, tw + 4, 15);
      ctx.fillStyle = '#000';
      ctx.fillText(o.id, pad + o.x * px - tw / 2, pad + o.z * px + 4);
    }
    ctx.fillStyle = '#000';
    ctx.font = '13px sans-serif';
    ctx.fillText('N ↑   window = blue, door = brown', pad, 22);
    const legend = `Room ${g.room.width}×${g.room.depth} m. Windows (blue) on ${g.room.windows.map((w) => w.wall).join(', ')} wall; door (brown) on ${g.room.door.wall} wall. Objects: ${g.objects.map((o) => `${o.id} (${o.type})`).join(', ')}.`;
    return { png: cv.toDataURL('image/png'), legend };
  }
}
