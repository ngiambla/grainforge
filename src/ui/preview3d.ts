// Interactive 3D preview of the assembled piece. World axes in the file are
// x = width, y = depth, z = height; three.js is y-up, so we map z → y.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ResolvedPart } from '../format';

const PALETTE = [0xc8955c, 0xa8703f, 0xd9b48a, 0x8c5a2e, 0xe0c39b, 0x9b7653];

export class Preview3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private framedFor = '';

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7560, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    // Our parts live in z-up space; rotate the whole group so z points up.
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const tick = () => {
      if (this.controls.update()) this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  setParts(parts: ResolvedPart[], materialOrder: string[]) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    for (const p of parts) {
      if (p.length <= 0 || p.width <= 0 || p.thickness <= 0) continue;
      const color = PALETTE[Math.max(0, materialOrder.indexOf(p.material)) % PALETTE.length]!;
      const geo = new THREE.BoxGeometry(p.length, p.width, p.thickness);
      geo.translate(p.length / 2, p.width / 2, p.thickness / 2); // origin at the min corner
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.45 }),
      );
      const holder = new THREE.Group();
      holder.add(mesh, edges);
      holder.position.set(p.position.x, p.position.y, p.position.z);
      holder.rotation.set(
        THREE.MathUtils.degToRad(p.rotation.x),
        THREE.MathUtils.degToRad(p.rotation.y),
        THREE.MathUtils.degToRad(p.rotation.z),
        'ZYX', // three applies ZYX order as x first, then y, then z in world terms
      );
      holder.userData.name = p.name;
      this.group.add(holder);
    }
    // Re-frame the camera only when the set of parts changes, not on every resize of a part.
    const key = parts.map((p) => p.id).join('|');
    if (key !== this.framedFor) {
      this.framedFor = key;
      this.frame();
    }
    this.render();
  }

  frame() {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 2.2;
    this.camera.position.set(center.x + dist * 0.75, center.y + dist * 0.55, center.z + dist * 0.9);
    this.controls.target.copy(center);
    this.controls.update();
    this.render();
  }

  /** A PNG snapshot from the current view, for the PDF. */
  snapshot(width = 1200, height = 900): string {
    const prev = new THREE.Vector2();
    this.renderer.getSize(prev);
    const aspect = this.camera.aspect;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setClearColor(0xffffff, 1);
    this.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(prev.x, prev.y, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.render();
    return url;
  }

  private resize() {
    const w = this.host.clientWidth || 600;
    const h = this.host.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
  }
}
