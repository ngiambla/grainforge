import './style.css';
import bookcaseText from '../examples/bookcase.grainforge?raw';
import cabinetText from '../examples/cabinet.grainforge?raw';
import exampleText from '../examples/side-table.grainforge?raw';
import {
  FILE_EXTENSION,
  ProjectFormatError,
  emptyProject,
  formatLength,
  loadProject,
  parseLength,
  saveProject,
  type JointType,
  type Project,
  type UnitSystem,
} from './format';
import { buildPlan, buildSteps, JOINTS, TOOLS, type Plan, type Skill } from './plan';
import { boardSvg } from './ui/diagram';
import { openPhotoWizard } from './ui/photos';
import { Preview3D } from './ui/preview3d';

const AUTOSAVE_KEY = 'grainforge:autosave';
const TAB_KEY = 'grainforge:tab';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  errors: $('errors'),
  warnings: $('warnings'),
  name: $<HTMLInputElement>('project-name'),
  desc: $('project-desc'),
  params: $('params'),
  skill: $('skill'),
  limitTools: $<HTMLInputElement>('limit-tools'),
  tools: $('tools'),
  overall: $('overall'),
  tabs: $('tabs'),
  panel: $('panel'),
  file: $<HTMLInputElement>('file-input'),
};

let project: Project = restore() ?? loadProject(exampleText);
let plan: Plan | null = null;
let lastToolList: string[] = [];
let tab = readTab();
const viewer = new Preview3D($('viewer'));

// ---------- helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...children);
  return e;
}
const units = () => project.units as UnitSystem;
const fmt = (mm: number) => formatLength(mm, units());

function restore(): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? loadProject(text) : null;
  } catch {
    return null;
  }
}
function readTab() {
  try {
    return localStorage.getItem(TAB_KEY) ?? 'cuts';
  } catch {
    return 'cuts';
  }
}
function persist() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Storage may be unavailable; autosave is only a convenience.
  }
}
function showError(message: string | null) {
  els.errors.hidden = message === null;
  els.errors.textContent = message ?? '';
}

// ---------- rendering ----------

function renderAll() {
  els.name.value = project.meta.name;
  els.desc.textContent = project.meta.description;
  const strip = $('photo-strip');
  strip.hidden = project.photos.length === 0;
  strip.replaceChildren(
    ...project.photos.map((ph) => el('figure', {}, el('img', { src: ph.src, alt: `${ph.view} view` }), el('figcaption', { textContent: ph.view }))),
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-units]')) {
    b.setAttribute('aria-checked', String(b.dataset.units === project.units));
  }
  renderParams();
  renderWorkshop();
  recompute();
}

function renderParams() {
  if (!project.parameters.length) {
    els.params.replaceChildren(el('p', { class: 'empty', textContent: 'No dimensions yet.' }));
    return;
  }
  els.params.replaceChildren(
    ...project.parameters.map((prm) => {
      const id = `param-${prm.id}`;
      const input = el('input', { id, inputMode: 'decimal', spellcheck: false });
      input.value = prm.kind === 'length' ? fmt(prm.value) : String(prm.value);
      input.addEventListener('change', () => {
        try {
          const v = prm.kind === 'length' ? parseLength(input.value, units()) : Number(input.value);
          if (!Number.isFinite(v)) throw new Error(`Can't read "${input.value}"`);
          if (prm.min !== undefined && v < prm.min) throw new Error(`${prm.label} must be at least ${fmt(prm.min)}.`);
          if (prm.max !== undefined && v > prm.max) throw new Error(`${prm.label} must be at most ${fmt(prm.max)}.`);
          prm.value = v;
          input.value = prm.kind === 'length' ? fmt(v) : String(v);
          input.removeAttribute('aria-invalid');
          showError(null);
          recompute();
        } catch (e) {
          input.setAttribute('aria-invalid', 'true');
          showError((e as Error).message);
        }
      });
      return el('div', { class: 'param' }, el('label', { htmlFor: id, textContent: prm.label }), input);
    }),
  );
}

function renderWorkshop() {
  for (const b of els.skill.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-checked', String(b.dataset.skill === project.workshop.skill));
  }
  const limited = project.workshop.tools !== undefined;
  els.limitTools.checked = limited;
  els.tools.hidden = !limited;
  if (!limited) return;
  const owned = new Set(project.workshop.tools);
  const groups: [string, string[]][] = [
    ['Measuring', ['measure']],
    ['Saws', ['saw']],
    ['Power tools', ['power']],
    ['Hand tools', ['hand']],
    ['Jigs and clamps', ['jig', 'clamp']],
    ['Finishing', ['finish']],
  ];
  els.tools.replaceChildren(
    ...groups.flatMap(([title, cats]) => [
      el('h3', { textContent: title }),
      el(
        'div',
        { class: 'tool-chips' },
        ...TOOLS.filter((t) => cats.includes(t.category)).map((t) => {
          const b = el('button', { type: 'button', class: 'tool-chip', textContent: t.name });
          b.setAttribute('aria-pressed', String(owned.has(t.id)));
          b.addEventListener('click', () => {
            const tools = new Set(project.workshop.tools ?? []);
            if (tools.has(t.id)) tools.delete(t.id);
            else tools.add(t.id);
            project.workshop.tools = TOOLS.map((x) => x.id).filter((id) => tools.has(id));
            b.setAttribute('aria-pressed', String(tools.has(t.id)));
            recompute();
          });
          return b;
        }),
      ),
    ]),
  );
}

function recompute() {
  try {
    plan = buildPlan(project);
  } catch (e) {
    plan = null;
    showError((e as Error).message);
  }
  if (plan) {
    viewer.setParts(plan.parts, project.materials.map((m) => m.id));
    const o = plan.overall;
    els.overall.replaceChildren(
      ...([['W', o.width], ['D', o.depth], ['H', o.height]] as const).map(([k, v]) =>
        el('span', { class: 'chip' }, el('span', { textContent: k }), fmt(v)),
      ),
    );
    els.warnings.hidden = plan.warnings.length === 0;
    els.warnings.replaceChildren(el('ul', {}, ...plan.warnings.map((w) => el('li', { textContent: w }))));
  }
  renderTab();
  persist();
}

function renderTab() {
  for (const b of els.tabs.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  if (!plan) {
    els.panel.replaceChildren();
    return;
  }
  const p = plan;
  const views: Record<string, () => Node> = {
    cuts: () => cutListView(p),
    shopping: () => shoppingView(p),
    diagrams: () => diagramsView(p),
    joints: () => jointsView(p),
    toollist: () => toolsView(p),
    steps: () => stepsView(p),
  };
  els.panel.replaceChildren((views[tab] ?? views.cuts!)());
}

const tableOf = (head: string[], rows: Node[]) =>
  el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { textContent: h })))), el('tbody', {}, ...rows)));

function cutListView(p: Plan) {
  if (!p.cutList.length) return el('p', { class: 'empty', textContent: 'No parts yet.' });
  return tableOf(
    ['Part', 'Qty', 'Finished L × W × T', 'Cut to', 'Material'],
    p.cutList.map((r) =>
      el(
        'tr',
        {},
        el('td', {}, r.name, ...(r.notes.length ? [el('span', { class: 'sub', textContent: r.notes.join(' · ') })] : [])),
        el('td', { class: 'num', textContent: String(r.quantity) }),
        el('td', { class: 'num', textContent: `${fmt(r.length)} × ${fmt(r.width)} × ${fmt(r.thickness)}` }),
        el('td', {
          class: 'num',
          textContent: `${fmt(r.cutLength)} × ${fmt(r.cutWidth)}${r.strips > 1 ? `  ×${r.strips} strips` : ''}${r.layers > 1 ? `  ×${r.layers} layers` : ''}`,
        }),
        el('td', { textContent: r.material.name }),
      ),
    ),
  );
}

function shoppingView(p: Plan) {
  if (!p.materials.length) return el('p', { class: 'empty', textContent: 'Nothing to buy yet.' });
  return tableOf(
    ['Material', 'Thickness', 'Buy', 'Yield'],
    p.materials.map((m) =>
      el(
        'tr',
        {},
        el('td', {}, m.material.name, ...(m.material.nominal ? [el('span', { class: 'sub', textContent: m.material.nominal })] : [])),
        el('td', { class: 'num', textContent: fmt(m.material.thickness) }),
        el('td', { class: 'num' }, ...m.buy.map((b) => el('div', { textContent: `${b.count} × ${fmt(b.length)} × ${fmt(b.width)}` }))),
        el('td', { class: 'num', textContent: `${Math.round(m.yield * 100)}%` }),
      ),
    ),
  );
}

function diagramsView(p: Plan) {
  const wrap = el('div');
  const width = Math.max(320, els.panel.clientWidth - 8);
  for (const m of p.materials) {
    const maxLen = Math.max(...m.boards.map((b) => b.length));
    const scale = width / maxLen;
    wrap.append(
      el(
        'div',
        { class: 'diagram-group' },
        el('h3', { textContent: `${m.material.name} · ${fmt(m.material.thickness)}` }),
        ...m.boards.map((b, i) =>
          el(
            'div',
            { class: 'diagram-board' },
            el('div', { class: 'caption', textContent: `${m.material.kind === 'sheet' ? 'Sheet' : 'Board'} ${i + 1}: ${fmt(b.length)} × ${fmt(b.width)}${b.oversize ? ' (larger than stock)' : ''}` }),
            boardSvg(b, scale),
          ),
        ),
      ),
    );
  }
  return wrap;
}

const REASON: Record<string, string> = {
  chosen: 'Your choice',
  design: 'As designed',
  skill: 'Easier for your skill level',
  tools: 'Fits your tools',
  fallback: 'Closest fit, see Tools',
};

function jointsView(p: Plan) {
  const partName = new Map(p.parts.map((x) => [x.id, x.name]));
  if (!p.joints.length) return el('p', { class: 'empty', textContent: 'No joints yet.' });
  return tableOf(
    ['Parts', 'Joint', 'Level', 'Why'],
    p.joints.map((c) => {
      const select = el('select', { ariaLabel: 'Joint type' });
      const auto = el('option', { value: '', textContent: `Auto (${JOINTS[c.joint.chosen ? c.joint.type : c.type].label})` });
      select.append(auto, ...c.options.map((t) => el('option', { value: t, textContent: `${JOINTS[t].label} · ${JOINTS[t].skill}` })));
      select.value = c.joint.chosen ?? '';
      select.addEventListener('change', () => {
        const j = project.joints.find((x) => x.id === c.joint.id)!;
        if (select.value) j.chosen = select.value as JointType;
        else delete j.chosen;
        recompute();
      });
      return el(
        'tr',
        {},
        el('td', { textContent: c.joint.parts.map((id) => partName.get(id) ?? id).join(' + ') }),
        el('td', {}, select),
        el('td', {}, el('span', { class: `badge ${JOINTS[c.type].skill}`, textContent: JOINTS[c.type].skill })),
        el('td', { class: 'sub-cell', textContent: REASON[c.reason] ?? '' }),
      );
    }),
  );
}

function toolsView(p: Plan) {
  const known = project.workshop.tools !== undefined;
  return tableOf(
    known ? ['Tool', 'Used for', ''] : ['Tool', 'Used for'],
    p.tools.map((t) =>
      el(
        'tr',
        {},
        el('td', { textContent: t.name }),
        el('td', { class: 'sub-cell', textContent: t.for.join(', ') }),
        ...(known ? [el('td', {}, el('span', { class: `badge ${t.owned ? 'ok' : 'need'}`, textContent: t.owned ? 'Have it' : 'Need' }))] : []),
      ),
    ),
  );
}

function stepsView(p: Plan) {
  return el(
    'ol',
    { class: 'steps' },
    ...buildSteps(p, fmt).map((s) => el('li', {}, el('h4', { textContent: s.title }), el('ul', {}, ...s.details.map((d) => el('li', { textContent: d }))))),
  );
}

// ---------- actions ----------

function open(text: string) {
  try {
    project = loadProject(text);
    showError(null);
    renderAll();
  } catch (e) {
    showError(e instanceof ProjectFormatError ? e.message : String(e));
  }
}

function fileName(ext: string) {
  return (project.meta.name.trim() || 'project').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() + ext;
}

function download(blob: Blob, name: string) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btn-new').addEventListener('click', () => {
  project = emptyProject();
  showError(null);
  renderAll();
});
const EXAMPLES: Record<string, string> = { 'side-table': exampleText, bookcase: bookcaseText, cabinet: cabinetText };
const exampleBtn = $('btn-example');
const exampleMenu = $('example-menu');
const setMenu = (openMenu: boolean) => {
  exampleMenu.hidden = !openMenu;
  exampleBtn.setAttribute('aria-expanded', String(openMenu));
};
exampleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(exampleMenu.hidden);
  if (!exampleMenu.hidden) exampleMenu.querySelector<HTMLButtonElement>('button')?.focus();
});
exampleMenu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-example]');
  if (!b) return;
  const units0 = project.units;
  open(EXAMPLES[b.dataset.example!]!);
  // Keep the unit system the person is working in.
  if (project.units !== units0) {
    project.units = units0;
    renderAll();
  }
  setMenu(false);
});
document.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setMenu(false);
});
const guide = $<HTMLDialogElement>('guide');
$('btn-guide').addEventListener('click', () => guide.showModal());
$('guide-close').addEventListener('click', () => guide.close());
$('btn-open').addEventListener('click', () => els.file.click());
$('btn-save').addEventListener('click', () => download(new Blob([saveProject(project)], { type: 'application/json' }), fileName(FILE_EXTENSION)));
$('btn-photos').addEventListener('click', () =>
  openPhotoWizard(units(), (p) => {
    project = p;
    showError(null);
    renderAll();
  }),
);
$('btn-frame').addEventListener('click', () => viewer.frame());
$<HTMLButtonElement>('btn-pdf').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (!plan) return;
  btn.disabled = true;
  try {
    const { exportPdf } = await import('./ui/pdf');
    download(exportPdf(project, plan, viewer.snapshot()), fileName('.pdf'));
  } catch (err) {
    showError(`Couldn't make the PDF: ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
  }
});

els.file.addEventListener('change', async () => {
  const f = els.file.files?.[0];
  if (f) open(await f.text());
  els.file.value = '';
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-units]')) {
  b.addEventListener('click', () => {
    project.units = b.dataset.units as UnitSystem;
    renderAll();
  });
}
for (const b of els.skill.querySelectorAll<HTMLButtonElement>('button')) {
  b.addEventListener('click', () => {
    project.workshop.skill = b.dataset.skill as Skill;
    renderWorkshop();
    recompute();
  });
}
els.limitTools.addEventListener('change', () => {
  if (els.limitTools.checked) project.workshop.tools = lastToolList;
  else {
    lastToolList = project.workshop.tools ?? [];
    delete project.workshop.tools;
  }
  renderWorkshop();
  recompute();
});
els.tabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role=tab]');
  if (!b?.dataset.tab) return;
  tab = b.dataset.tab;
  renderTab();
  persist();
});
els.name.addEventListener('change', () => {
  project.meta.name = els.name.value;
  persist();
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('dragging');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) open(await f.text());
});
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => tab === 'diagrams' && renderTab(), 150);
});

renderAll();
