import './style.css';
import exampleText from '../examples/side-table.grainforge?raw';
import {
  FILE_EXTENSION,
  ProjectFormatError,
  emptyProject,
  formatLength,
  loadProject,
  parseLength,
  resolveParts,
  saveProject,
  type Project,
  type UnitSystem,
} from './format';

const AUTOSAVE_KEY = 'grainforge:autosave';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  errors: $<HTMLDivElement>('errors'),
  name: $<HTMLInputElement>('project-name'),
  desc: $<HTMLParagraphElement>('project-desc'),
  params: $<HTMLDivElement>('params'),
  parts: $<HTMLTableElement>('parts').tBodies[0]!,
  joints: $<HTMLUListElement>('joints'),
  units: $<HTMLSelectElement>('units'),
  file: $<HTMLInputElement>('file-input'),
};

let project: Project = restore() ?? loadProject(exampleText);

function restore(): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? loadProject(text) : null;
  } catch {
    return null;
  }
}

function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    // Storage can be unavailable (private mode, quota); autosave is a convenience only.
  }
}

function showError(message: string | null) {
  els.errors.hidden = message === null;
  els.errors.textContent = message ?? '';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function render() {
  const units = project.units as UnitSystem;
  els.units.value = units;
  els.name.value = project.meta.name;
  els.desc.textContent = project.meta.description;

  els.params.replaceChildren(
    ...project.parameters.map((prm) => {
      const label = el('label', prm.label);
      const input = el('input');
      input.value = prm.kind === 'length' ? formatLength(prm.value, units) : String(prm.value);
      input.addEventListener('change', () => {
        try {
          const v = prm.kind === 'length' ? parseLength(input.value, units) : Number(input.value);
          if (!Number.isFinite(v)) throw new Error(`Can't read "${input.value}"`);
          if (prm.min !== undefined && v < prm.min) throw new Error(`${prm.label} must be at least ${formatLength(prm.min, units)}`);
          if (prm.max !== undefined && v > prm.max) throw new Error(`${prm.label} must be at most ${formatLength(prm.max, units)}`);
          prm.value = v;
          showError(null);
          update();
        } catch (e) {
          input.setAttribute('aria-invalid', 'true');
          showError((e as Error).message);
        }
      });
      label.append(input);
      return label;
    }),
  );

  renderParts();

  const partName = new Map(project.parts.map((p) => [p.id, p.name]));
  els.joints.replaceChildren(
    ...project.joints.map((j) => {
      const names = j.parts.map((id) => partName.get(id) ?? id).join(' + ');
      const alt = j.alternatives.length ? ` (or ${j.alternatives.join(', ')})` : '';
      return el('li', `${j.type}: ${names}${alt}`);
    }),
  );
}

function renderParts() {
  const units = project.units as UnitSystem;
  const mats = new Map(project.materials.map((m) => [m.id, m]));
  try {
    const rows = resolveParts(project).map((p) => {
      const tr = el('tr');
      tr.append(
        el('td', p.name),
        el('td', String(p.quantity), 'num'),
        el('td', formatLength(p.length, units), 'num'),
        el('td', formatLength(p.width, units), 'num'),
        el('td', formatLength(p.thickness, units), 'num'),
        el('td', mats.get(p.material)?.name ?? p.material),
      );
      return tr;
    });
    els.parts.replaceChildren(...rows);
  } catch (e) {
    showError((e as Error).message);
  }
}

function update() {
  render();
  autosave();
}

function open(text: string) {
  try {
    project = loadProject(text);
    showError(null);
    update();
  } catch (e) {
    showError(e instanceof ProjectFormatError ? e.message : String(e));
  }
}

function save() {
  const blob = new Blob([saveProject(project)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = (project.meta.name.trim() || 'project').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() + FILE_EXTENSION;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

$('btn-new').addEventListener('click', () => {
  project = emptyProject();
  showError(null);
  update();
});
$('btn-example').addEventListener('click', () => open(exampleText));
$('btn-open').addEventListener('click', () => els.file.click());
$('btn-save').addEventListener('click', save);
els.file.addEventListener('change', async () => {
  const f = els.file.files?.[0];
  if (f) open(await f.text());
  els.file.value = '';
});
els.units.addEventListener('change', () => {
  project.units = els.units.value as UnitSystem;
  update();
});
els.name.addEventListener('change', () => {
  project.meta.name = els.name.value;
  autosave();
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) open(await f.text());
});

render();
