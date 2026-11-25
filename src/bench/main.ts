import '../style.css';
import type { Mask } from '../vision/analysis';
import { WorkerSegmenter, type Segmenter } from '../vision/segmenter';
import { KIND_LABEL } from '../vision/templates';
import { ThresholdSegmenter } from '../vision/threshold';
import { CASES } from './corpus';
import { runCase, summarize, type CaseResult, type DimScore, type SetResult } from './run';
import { Studio } from './render';

declare global {
  interface Window {
    bench?: { done: boolean; results: unknown[]; summary?: ReturnType<typeof summarize> };
  }
}

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...children);
  return e;
}

const params = new URLSearchParams(location.search);
const segSel = $('seg') as HTMLSelectElement;
segSel.value = params.get('segmenter') === 'sam' ? 'sam' : 'simple';
const status = $('status');

async function thumb(image: Blob, mask: Mask | null): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(image);
  const c = el('canvas', { width: bmp.width, height: bmp.height, class: 'bench-thumb' });
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  if (mask) {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < mask.data.length; i++) {
      if (!mask.data[i]) continue;
      img.data[i * 4] = Math.round(img.data[i * 4]! * 0.55 + 180 * 0.45);
      img.data[i * 4 + 1] = Math.round(img.data[i * 4 + 1]! * 0.55 + 40 * 0.45);
      img.data[i * 4 + 2] = Math.round(img.data[i * 4 + 2]! * 0.55 + 200 * 0.45);
    }
    ctx.putImageData(img, 0, 0);
  }
  return c;
}

const pct = (e: number) => `${e > 0 ? '+' : ''}${Math.round(e * 100)}%`;
function dimCell(d: DimScore | undefined) {
  if (!d) return el('td', { textContent: '–' });
  const cls = d.given ? 'given' : d.guessed ? 'guessed' : Math.abs(d.error) <= 0.05 ? 'good' : Math.abs(d.error) <= 0.15 ? 'fair' : 'poor';
  const note = d.given ? 'given' : d.guessed ? 'guessed' : pct(d.error);
  return el('td', { class: `num ${cls}`, title: `true ${Math.round(d.truth)} mm, got ${Math.round(d.got)} mm` }, `${Math.round(d.got)}`, el('span', { class: 'sub', textContent: note }));
}

function kindCell(s: SetResult) {
  const first = s.suggested[0];
  const cls = s.kindRank === 0 ? 'good' : s.kindRank > 0 && s.kindRank < 3 ? 'fair' : 'poor';
  return el('td', { class: cls }, first ? KIND_LABEL[first] : '–', el('span', { class: 'sub', textContent: s.kindRank === 0 ? 'right' : s.kindRank > 0 ? `true kind is #${s.kindRank + 1}` : 'not offered' }));
}

async function renderCase(r: CaseResult) {
  const thumbs = await Promise.all(r.shots.map(async (s) => el('figure', {}, await thumb(s.image, s.mask), el('figcaption', { textContent: `${s.view}${s.autoAngled && s.view !== 'angled' ? ' (app would call it angled)' : ''}` }))));
  const checks = r.case.check ?? [];
  const head = ['Photos', 'Kind guess', 'Width', 'Depth', 'Height', ...checks, 'Warnings'];
  const t = r.case.truth;
  return el(
    'section',
    { class: 'card bench-case' },
    el('h3', { textContent: r.case.label }),
    el('p', { class: 'hint', textContent: `True size ${t.width} × ${t.depth} × ${t.height} mm (W × D × H), ${KIND_LABEL[t.kind].toLowerCase()}.` }),
    el('div', { class: 'bench-thumbs' }, ...thumbs),
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { textContent: h })))),
        el(
          'tbody',
          {},
          ...r.sets.map((s) =>
            s.error
              ? el('tr', {}, el('td', { textContent: s.set }), el('td', { class: 'poor', colSpan: head.length - 1, textContent: s.error }))
              : el(
                  'tr',
                  {},
                  el('td', { textContent: s.set }),
                  kindCell(s),
                  dimCell(s.dims.width),
                  dimCell(s.dims.depth),
                  dimCell(s.dims.height),
                  ...checks.map((c) => dimCell(s.params[c])),
                  el('td', { class: s.warnings.length ? 'poor' : '', textContent: s.warnings.length ? s.warnings.join(' ') : 'none' }),
                ),
          ),
        ),
      ),
    ),
  );
}

function renderSummary(sum: ReturnType<typeof summarize>) {
  const stat = (value: string, label: string) => el('div', { class: 'bench-stat' }, el('strong', { textContent: value }), el('span', { textContent: label }));
  $('summary').replaceChildren(
    stat(`${sum.tests - sum.failed}/${sum.tests}`, 'tests produced a model'),
    stat(`${sum.kindFirst}%`, 'kind guessed right first'),
    stat(`${sum.kindTop3}%`, 'right kind in the top 3'),
    stat(`${sum.dimError}%`, 'average size error, read from photos'),
    stat(`${sum.within10}%`, 'of sizes within 10%'),
    stat(`${sum.paramError}%`, 'average error on legs, seats, rails'),
  );
}

async function run() {
  const btn = $('run') as HTMLButtonElement;
  btn.disabled = true;
  window.bench = { done: false, results: [] };
  $('results').replaceChildren();
  const segmenter: Segmenter = segSel.value === 'sam' ? new WorkerSegmenter((t) => (status.textContent = t)) : new ThresholdSegmenter();
  const studio = new Studio();
  const results: CaseResult[] = [];
  const only = params.get('case');
  for (const c of CASES.filter((x) => !only || x.id === only)) {
    status.textContent = `Testing ${c.label} (${results.length + 1} of ${CASES.length})…`;
    const r = await runCase(c, studio, segmenter);
    results.push(r);
    $('results').append(await renderCase(r));
    renderSummary(summarize(results));
  }
  const summary = summarize(results);
  status.textContent = 'Done.';
  btn.disabled = false;
  window.bench = {
    done: true,
    summary,
    results: results.map((r) => ({ id: r.case.id, label: r.case.label, kind: r.case.truth.kind, views: r.shots.map((s) => ({ view: s.view, autoAngled: s.autoAngled, outlined: !!s.silhouette })), sets: r.sets })),
  };
}

$('run').addEventListener('click', run);
if (params.has('autorun')) run();
