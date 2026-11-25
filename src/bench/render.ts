// Photograph a model: render it like a product shot (plain backdrop, soft
// light, a shadow on the floor) from a given azimuth and elevation.

import * as THREE from 'three';
import type { ResolvedPart } from '../format';

export interface Shot {
  /** Degrees from straight-on front, positive towards the right side. */
  az: number;
  /** Degrees above horizontal. */
  el: number;
}

const BACKDROP = 0xefebe4;

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 4 / 3, 1, 50000);
  private group = new THREE.Group();
  private floor: THREE.Mesh;
  private sun: THREE.DirectionalLight;

  constructor(readonly width = 640, readonly height = 480) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8a78, 1.4));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.sun, this.sun.target);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    // Parts are z-up; three is y-up.
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
  }

  /** Show boxes for parts, or one curved outline standing upright. */
  setModel(parts: ResolvedPart[], color: number, outline?: { kind: 'spoon' | 'spatula'; width: number; height: number; thickness: number }) {
    for (const c of [...this.group.children]) this.group.remove(c);
    const grain = woodGrain();
    const wood = (i: number) => {
      const c = new THREE.Color(color);
      c.offsetHSL(0, 0, ((i * 37) % 7) / 100 - 0.03);
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, map: grain });
    };
    if (outline) {
      const mesh = new THREE.Mesh(outlineGeometry(outline), wood(0));
      mesh.castShadow = true;
      this.group.add(mesh);
    } else {
      parts.forEach((p, i) => {
        if (p.length <= 0 || p.width <= 0 || p.thickness <= 0) return;
        const geo = new THREE.BoxGeometry(p.length, p.width, p.thickness);
        geo.translate(p.length / 2, p.width / 2, p.thickness / 2);
        // A frame's backing shows as the picture or mat: off-white, not wood.
        const mat = p.id === 'backer' ? new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.9 }) : wood(i);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        const holder = new THREE.Group();
        holder.add(mesh);
        holder.position.set(p.position.x, p.position.y, p.position.z);
        holder.rotation.set(...([p.rotation.x, p.rotation.y, p.rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number]), 'ZYX');
        this.group.add(holder);
      });
    }
  }

  /** Render one view; returns a JPEG blob like a phone photo. */
  async shoot(shot: Shot): Promise<Blob> {
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = size.length() / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * 0.9;
    const az = THREE.MathUtils.degToRad(shot.az);
    const el = THREE.MathUtils.degToRad(shot.el);
    // Front is -y in part space, which is +z in three's y-up space.
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();

    const span = Math.max(size.x, size.z) * 4 + 1000;
    this.floor.scale.set(span, span, 1);
    this.floor.position.set(center.x, box.min.y - 0.5, center.z);
    this.sun.position.set(center.x - radius, center.y + radius * 3, center.z + radius * 2);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius * 2;
    cam.right = cam.top = radius * 2;
    cam.near = 1;
    cam.far = radius * 10;
    cam.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) =>
      this.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Render failed'))), 'image/jpeg', 0.9),
    );
  }
}

/**
 * A spoon or spatula outline in the x-z plane (standing up), extruded to its
 * thickness along y. Width is the widest point, height the overall length.
 */
function outlineGeometry(o: { kind: 'spoon' | 'spatula'; width: number; height: number; thickness: number }) {
  const w = o.width / 2;
  const h = o.height;
  const handle = Math.max(8, o.width * 0.28) / 2;
  const s = new THREE.Shape();
  if (o.kind === 'spoon') {
    // Handle up from the bottom, then an oval bowl at the top.
    const bowlH = h * 0.32;
    const cy = h - bowlH / 2;
    s.moveTo(-handle, 0);
    s.lineTo(handle, 0);
    s.lineTo(handle * 0.8, cy - bowlH / 2 - 10);
    s.absellipse(0, cy, w, bowlH / 2, -Math.PI / 2 + 0.25, Math.PI * 1.5 - 0.25, false, 0);
    s.lineTo(-handle, 0);
  } else {
    // Handle, a short neck, then a squared-off blade with rounded corners.
    const bladeH = h * 0.38;
    const b = h - bladeH;
    s.moveTo(-handle, 0);
    s.lineTo(handle, 0);
    s.lineTo(handle, b - 30);
    s.quadraticCurveTo(handle, b, w * 0.9, b + 10);
    s.lineTo(w, h - 12);
    s.quadraticCurveTo(w, h, w - 12, h);
    s.lineTo(-w + 12, h);
    s.quadraticCurveTo(-w, h, -w, h - 12);
    s.lineTo(-w * 0.9, b + 10);
    s.quadraticCurveTo(-handle, b, -handle, b - 30);
    s.lineTo(-handle, 0);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: o.thickness, bevelEnabled: false, curveSegments: 24 });
  // Shape is in x-y; stand it up so its y becomes z (height), extruded along y (depth).
  geo.rotateX(Math.PI / 2);
  geo.translate(w, o.thickness, 0);
  return geo;
}

let grainTexture: THREE.CanvasTexture | null = null;
/** A light procedural wood grain, so renders look less like flat plastic (helps the recognition model). */
function woodGrain() {
  if (grainTexture) return grainTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const y0 = rand() * 256;
    const shade = 200 + Math.floor(rand() * 45);
    ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
    ctx.lineWidth = 0.6 + rand() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, y0 + Math.sin(x / 40 + i) * 3 + rand());
    ctx.stroke();
  }
  grainTexture = new THREE.CanvasTexture(c);
  grainTexture.wrapS = grainTexture.wrapT = THREE.RepeatWrapping;
  grainTexture.colorSpace = THREE.SRGBColorSpace;
  return grainTexture;
}
