// "Start from photos" dialog: add labelled photos, outline the piece in each,
// give one real measurement, pick the kind of furniture, build the model.

import type { Photo, Project } from '../format';
import { formatLength, parseLength, type UnitSystem } from '../format';
import { analyzeMask, suggestKinds, type FurnitureKind, type Mask, type Silhouette } from '../vision/analysis';
import { fitFromPhotos } from '../vision/fit';
import { axesOf, type Dim, type View } from '../vision/fuse';
import { boxMask, WorkerSegmenter, type Point, type Segmenter } from '../vision/segmenter';
import { buildFromFit, KIND_LABEL } from '../vision/templates';
import { ThresholdSegmenter } from '../vision/threshold';

const MAX_SIDE = 1024;
const STORED_SIDE = 800;

interface PhotoState {
  id: string;
  view: View;
  blob: Blob;
  width: number;
  height: number;
  bitmap: ImageBitmap;
  points: Point[];
  mask: Mask | null;
  silhouette: Silhouette | null;
  mode: 'click' | 'box';
  embedded: Promise<void> | null;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
}

const VIEWS: [View, string][] = [
  ['front', 'Front'],
  ['left', 'Left side'],
  ['right', 'Right side'],
  ['back', 'Back'],
  ['top', 'Top'],
  ['angled', 'Angled'],
];

let segmenter: Segmenter | null = null;
let modelFailed = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...children);
  return e;
}

async function prepare(file: Blob) {
  const src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return { blob, bitmap: await createImageBitmap(blob), width: w, height: h };
}

async function toStoredDataUrl(p: PhotoState) {
  const k = Math.min(1, STORED_SIDE / Math.max(p.width, p.height));
  const c = document.createElement('canvas');
  c.width = Math.round(p.width * k);
  c.height = Math.round(p.height * k);
  c.getContext('2d')!.drawImage(p.bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

export function openPhotoWizard(units: UnitSystem, onCreate: (p: Project) => void) {
  const params = new URLSearchParams(location.search);
  const status = el('p', { class: 'wizard-status', ariaLive: 'polite' });
  const setStatus = (t: string) => (status.textContent = t);
  segmenter ??= params.get('segmenter') === 'simple' ? new ThresholdSegmenter() : new WorkerSegmenter(setStatus);

  const photos: PhotoState[] = [];
  let counter = 0;

  const grid = el('div', { class: 'photo-grid' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const drop = el(
    'button',
    { type: 'button', class: 'dropzone' },
    el('strong', { textContent: 'Add photos' }),
    el('span', { textContent: 'Front, side and top views work best. More angles help.' }),
  );
  drop.addEventListener('click', () => fileInput.click());

  // Measurement and kind.
  const dimSel = el('select', { ariaLabel: 'Known dimension' });
  const valueInput = el('input', { placeholder: units === 'imperial' ? 'e.g. 36"' : 'e.g. 900 mm', inputMode: 'decimal', class: 'measure-input', ariaLabel: 'Measurement' });
  const photoSel = el('select', { ariaLabel: 'Photo with the measurement' });
  const kindSel = el('select', { ariaLabel: 'Kind of furniture' });
  for (const k of Object.keys(KIND_LABEL) as FurnitureKind[]) kindSel.append(el('option', { value: k, textContent: KIND_LABEL[k] }));
  let kindTouched = false;
  kindSel.addEventListener('change', () => {
    kindTouched = true;
    syncKind();
  });
  const shelvesInput = el('input', { type: 'number', min: '0', max: '12', value: '', placeholder: 'auto', class: 'small-num', ariaLabel: 'Shelves' });
  const doorsInput = el('input', { type: 'number', min: '0', max: '4', value: '', placeholder: 'auto', class: 'small-num', ariaLabel: 'Doors' });
  const caseOpts = el('span', { class: 'case-opts' }, el('label', {}, 'Shelves ', shelvesInput), el('label', {}, 'Doors ', doorsInput));
  const syncKind = () => {
    const k = kindSel.value as FurnitureKind;
    caseOpts.hidden = !(k === 'bookcase' || k === 'cabinet');
  };

  const errorBox = el('p', { class: 'wizard-error', role: 'alert', hidden: true });
  const createBtn = el('button', { type: 'button', class: 'primary', textContent: 'Build the model' });
  const cancelBtn = el('button', { type: 'button', class: 'ghost', textContent: 'Cancel' });

  const dialog = el(
    'dialog',
    { class: 'wizard' },
    el(
      'div',
      { class: 'wizard-head' },
      el('h2', { textContent: 'Start from photos' }),
      el('p', {
        class: 'hint',
        textContent:
          'Everything runs on your device. Click the piece in each photo to outline it (Shift-click to remove an area), or draw a box around it.',
      }),
    ),
    el('div', { class: 'wizard-body' }, drop, fileInput, grid, status),
    el(
      'div',
      { class: 'wizard-form' },
      el('div', { class: 'form-row' }, el('span', { textContent: 'I know the' }), dimSel, el('span', { textContent: 'is' }), valueInput, el('span', { textContent: 'in' }), photoSel),
      el('div', { class: 'form-row' }, el('span', { textContent: "It's a" }), kindSel, caseOpts),
      errorBox,
    ),
    el('div', { class: 'wizard-actions' }, el('span', { class: 'hint', textContent: 'This replaces the current project. Save it first if you want to keep it.' }), cancelBtn, createBtn),
  );

  const refreshForm = () => {
    const prevPhoto = photoSel.value;
    const prevDim = dimSel.value;
    photoSel.replaceChildren(
      ...photos
        .filter((p) => axesOf(p.view))
        .map((p) => el('option', { value: p.id, textContent: `photo ${photos.indexOf(p) + 1} (${VIEWS.find((v) => v[0] === p.view)![1].toLowerCase()})` })),
    );
    if ([...photoSel.options].some((o) => o.value === prevPhoto)) photoSel.value = prevPhoto;
    const sel = photos.find((p) => p.id === photoSel.value);
    const axes = sel ? axesOf(sel.view) : null;
    const dims: Dim[] = axes ? [axes.h, axes.v] : ['width', 'height', 'depth'];
    dimSel.replaceChildren(...dims.map((d) => el('option', { value: d, textContent: d })));
    if (dims.includes(prevDim as Dim)) dimSel.value = prevDim;
    // Suggest a kind from the first outlined front view.
    const front = photos.find((p) => (p.view === 'front' || p.view === 'back') && p.silhouette);
    if (front && !kindTouched) kindSel.value = suggestKinds(front.silhouette!)[0]!;
    syncKind();
  };
  photoSel.addEventListener('change', refreshForm);

  function draw(p: PhotoState) {
    const c = p.canvas;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(p.bitmap, 0, 0, c.width, c.height);
    if (p.mask) {
      const o = new OffscreenCanvas(p.mask.width, p.mask.height);
      const octx = o.getContext('2d')!;
      const img = octx.createImageData(p.mask.width, p.mask.height);
      for (let i = 0; i < p.mask.data.length; i++) {
        if (p.mask.data[i]) {
          img.data[i * 4] = 224;
          img.data[i * 4 + 1] = 139;
          img.data[i * 4 + 2] = 85;
          img.data[i * 4 + 3] = 120;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(o, 0, 0, c.width, c.height);
    }
    const s = p.silhouette;
    if (s && p.mask) {
      const kx = c.width / p.mask.width;
      const ky = c.height / p.mask.height;
      ctx.strokeStyle = '#b4693a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(s.box.x * kx, s.box.y * ky, s.box.width * kx, s.box.height * ky);
      ctx.setLineDash([]);
    }
    for (const pt of p.points) {
      ctx.beginPath();
      ctx.arc(pt.x * c.width, pt.y * c.height, 6, 0, Math.PI * 2);
      ctx.fillStyle = pt.positive ? '#2f7a4b' : '#9b2216';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function describe(p: PhotoState) {
    if (!p.silhouette) {
      p.status.textContent = p.mode === 'box' ? 'Drag a box around the piece.' : 'Click the piece to outline it.';
      return;
    }
    const s = p.silhouette;
    const bits = [`${s.box.width} × ${s.box.height} px`];
    if (s.legs.length) bits.push(`${s.legs.length} legs seen`);
    else if (s.lowerFill > 0.6) bits.push('solid case');
    p.status.textContent = bits.join(' · ');
  }

  function setMask(p: PhotoState, mask: Mask | null) {
    p.mask = mask;
    p.silhouette = mask ? analyzeMask(mask) : null;
    draw(p);
    describe(p);
    refreshForm();
  }

  function useBoxMode(p: PhotoState, why?: string) {
    p.mode = 'box';
    p.points = [];
    if (why) setStatus(why);
    p.canvas.parentElement!.querySelector<HTMLButtonElement>('.mode-btn')!.textContent = 'Click to outline';
    describe(p);
  }

  async function runSegment(p: PhotoState) {
    try {
      p.status.textContent = 'Outlining…';
      p.embedded ??= segmenter!.embed(p.id, p.blob);
      await p.embedded;
      const mask = await segmenter!.segment(p.id, p.points);
      setMask(p, mask);
    } catch (err) {
      p.embedded = null;
      modelFailed = true;
      useBoxMode(p, `The outline model couldn't run here (${(err as Error).message}). Draw a box around the piece instead.`);
    }
  }

  async function addFiles(files: FileList | File[]) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const prep = await prepare(f);
      const id = `photo_${++counter}`;
      const canvas = el('canvas', { width: prep.width, height: prep.height, class: 'photo-canvas' });
      const viewSel = el('select', { ariaLabel: 'Which view is this?' });
      viewSel.append(...VIEWS.map(([v, label]) => el('option', { value: v, textContent: label })));
      const used = new Set(photos.map((p) => p.view));
      const view = (['front', 'left', 'top', 'angled'] as View[]).find((v) => !used.has(v)) ?? 'angled';
      viewSel.value = view;
      const status = el('span', { class: 'photo-status' });
      const modeBtn = el('button', { type: 'button', class: 'ghost small mode-btn', textContent: 'Draw a box instead' });
      const clearBtn = el('button', { type: 'button', class: 'ghost small', textContent: 'Clear' });
      const removeBtn = el('button', { type: 'button', class: 'ghost small', textContent: 'Remove' });
      const card = el(
        'div',
        { class: 'photo-card' },
        canvas,
        el('div', { class: 'photo-meta' }, viewSel, status),
        el('div', { class: 'photo-tools' }, modeBtn, clearBtn, removeBtn),
      );
      grid.append(card);
      const p: PhotoState = { id, view, ...prep, points: [], mask: null, silhouette: null, mode: modelFailed ? 'box' : 'click', embedded: null, canvas, status };
      photos.push(p);
      draw(p);
      if (modelFailed) useBoxMode(p);
      describe(p);
      // Start encoding straight away so the first click is quick.
      if (p.mode === 'click') p.embedded = segmenter!.embed(p.id, p.blob).catch((err) => {
        p.embedded = null;
        modelFailed = true;
        useBoxMode(p, `The outline model couldn't run here (${(err as Error).message}). Draw a box around the piece instead.`);
      });

      viewSel.addEventListener('change', () => {
        p.view = viewSel.value as View;
        refreshForm();
      });
      modeBtn.addEventListener('click', () => {
        if (p.mode === 'click') useBoxMode(p);
        else {
          p.mode = 'click';
          modeBtn.textContent = 'Draw a box instead';
          describe(p);
        }
      });
      clearBtn.addEventListener('click', () => {
        p.points = [];
        setMask(p, null);
      });
      removeBtn.addEventListener('click', () => {
        photos.splice(photos.indexOf(p), 1);
        card.remove();
        refreshForm();
      });

      const rel = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      };
      let dragStart: { x: number; y: number } | null = null;
      canvas.addEventListener('pointerdown', (e) => {
        if (p.mode === 'box') {
          dragStart = rel(e);
          canvas.setPointerCapture(e.pointerId);
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (p.mode !== 'box' || !dragStart) return;
        const q = rel(e);
        draw(p);
        const ctx = canvas.getContext('2d')!;
        ctx.strokeStyle = '#b4693a';
        ctx.lineWidth = 3;
        ctx.strokeRect(dragStart.x * canvas.width, dragStart.y * canvas.height, (q.x - dragStart.x) * canvas.width, (q.y - dragStart.y) * canvas.height);
      });
      canvas.addEventListener('pointerup', (e) => {
        if (p.mode === 'box' && dragStart) {
          const q = rel(e);
          if (Math.abs(q.x - dragStart.x) > 0.02 && Math.abs(q.y - dragStart.y) > 0.02) {
            setMask(p, boxMask(p.width, p.height, { x0: dragStart.x, y0: dragStart.y, x1: q.x, y1: q.y }));
          }
          dragStart = null;
        } else if (p.mode === 'click') {
          p.points.push({ ...rel(e), positive: !e.shiftKey });
          draw(p);
          void runSegment(p);
        }
      });
    }
    refreshForm();
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files) void addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  dialog.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  dialog.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files) void addFiles([...e.dataTransfer.files]);
  });

  const fail = (msg: string) => {
    errorBox.hidden = false;
    errorBox.textContent = msg;
  };

  createBtn.addEventListener('click', async () => {
    errorBox.hidden = true;
    const ready = photos.filter((p) => p.silhouette);
    if (!ready.length) return fail('Outline the piece in at least one photo.');
    const ref = photos.find((p) => p.id === photoSel.value);
    if (!ref?.silhouette) return fail('Outline the piece in the photo with your measurement.');
    let mm: number;
    try {
      mm = parseLength(valueInput.value, units);
      if (!(mm > 0)) throw new Error();
    } catch {
      return fail(`Enter the ${dimSel.value} as a length, like ${units === 'imperial' ? '36"' : '900 mm'}.`);
    }
    try {
      const kind = kindSel.value as FurnitureKind;
      const num = (i: HTMLInputElement) => (i.value === '' ? undefined : Number(i.value));
      const { fit, guessed } = fitFromPhotos(
        ready.map((p) => ({ id: p.id, view: p.view, silhouette: p.silhouette! })),
        { photoId: ref.id, dim: dimSel.value as Dim, mm },
        kind,
        { shelves: num(shelvesInput), doors: num(doorsInput) },
      );
      const project = buildFromFit(fit);
      project.units = units;
      if (guessed.length) {
        project.meta.description += ` The ${guessed.join(' and ')} ${guessed.length > 1 ? 'were' : 'was'} estimated (no photo showed ${guessed.length > 1 ? 'them' : 'it'}), so check ${guessed.length > 1 ? 'them' : 'it'}: ${guessed.map((d) => `${d} ${formatLength(fit[d], units)}`).join(', ')}.`;
      }
      const stored: Photo[] = [];
      for (const p of photos) stored.push({ id: p.id, view: p.view, src: await toStoredDataUrl(p) });
      project.photos = stored;
      dialog.close();
      onCreate(project);
    } catch (err) {
      fail((err as Error).message);
    }
  });
  cancelBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    for (const p of photos) p.bitmap.close();
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  refreshForm();
}
