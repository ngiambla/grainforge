// Run the photo test bench headless and print a summary.
//   npm run bench                       (simple outline, all cases)
//   npm run bench -- --case=chair       (one case)
//   npm run bench -- --json=out.json    (save full results)
//   npm run bench -- --shot=bench.png   (save a screenshot of the report)
// Needs a build first (npm run build) and Playwright with Chromium.
//   npm run bench -- --segmenter=sam    (the real model; needs network for the first download)
//   npm run bench -- --classifier=siglip (recognise the kind with SigLIP, or =clip; needs network the first time)
//   npm run bench -- --photos           (real catalog photos: run node scripts/abo-select.mjs first;
//                                        --models=clip,siglip  --segmenter=sam  --kinds=chair,table  --florence)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

// Playwright isn't a dependency of the site; use whichever copy is installed
// (npm i -D playwright && npx playwright install chromium).
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const root = new URL('../dist/', import.meta.url).pathname;
const repo = new URL('../', import.meta.url).pathname;
const types = { '.jpg': 'image/jpeg', '.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/grainforge\//, '/'));
  try {
    // Real-photo data lives outside the build, in a folder git ignores.
    const base = path.startsWith('/bench-data/') ? repo : root;
    const body = await readFile(join(base, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
// Progress and model failures from the page, so a stall shows where it is.
page.on('console', (m) => {
  if (m.text().startsWith('[bench]') || m.type() === 'error') console.error(m.text());
});
if ('photos' in args) {
  const pq = new URLSearchParams({
    segmenter: args.segmenter ?? 'simple',
    models: args.models ?? 'clip,siglip',
    ...(args.kinds ? { kinds: args.kinds } : {}),
    ...('florence' in args ? { florence: '1' } : {}),
  });
  await page.goto(`http://localhost:${port}/grainforge/bench-photos.html?${pq}`);
  await page.waitForFunction(() => window.photoBench?.done, null, { timeout: 60 * 60_000 });
  const r = await page.evaluate(() => window.photoBench);
  if (args.json) await writeFile(args.json, JSON.stringify(r, null, 2));
  await browser.close();
  server.close();
  if (r.error) (console.error(r.error), process.exit(1));
  console.log(`Listings: ${r.listings.length}, photos: ${r.listings.reduce((n, l) => n + l.photos.length, 0)}`);
  console.log('Method                     listing right first / top 3   photo right first');
  for (const s of r.scores) console.log(`  ${s.method.padEnd(24)} ${String(s.listingFirst).padStart(5)}% / ${String(s.listingTop3).padStart(5)}%        ${s.photoFirst}%`);
  const kinds = Object.keys(r.scores[0].byKind);
  console.log('\nRight first by kind (listing level):');
  console.log(`  ${'method'.padEnd(24)} ${kinds.map((k) => k.slice(0, 8).padStart(8)).join(' ')}`);
  for (const s of r.scores.filter((s) => !s.method.includes('@') || s.method.endsWith('@1'))) console.log(`  ${s.method.padEnd(24)} ${kinds.map((k) => String(s.byKind[k]).padStart(8)).join(' ')}`);
  console.log('\nCommonest mistakes:');
  for (const [m, list] of Object.entries(r.confusions)) console.log(`  ${m}: ${list.map(([c, n]) => `${c} ×${n}`).join(', ') || 'none'}`);
  if (r.florence) {
    const f = r.florence;
    console.log(`\nFlorence-2: found the piece in ${f.found} of ${f.photos} main photos`);
    for (const [part, c] of Object.entries(f.counts)) console.log(`  ${part}: ${c.exact}/${c.listings} exact, ${c.withinOne}/${c.listings} within one (listed→counted: ${c.examples.join(', ')})`);
  }
  if (r.errors.length) console.log('\nModel errors:\n  ' + r.errors.join('\n  '));
  process.exit(0);
}
const q = new URLSearchParams({
  autorun: '1',
  segmenter: args.segmenter ?? 'simple',
  ...(args.classifier ? { classifier: args.classifier } : {}),
  ...(args.case ? { case: args.case } : {}),
});
await page.goto(`http://localhost:${port}/grainforge/bench.html?${q}`);
await page.waitForFunction(() => window.bench?.done, null, { timeout: 15 * 60_000 });
const bench = await page.evaluate(() => window.bench);
if (args.json) await writeFile(args.json, JSON.stringify(bench, null, 2));
if (args.shot) await page.screenshot({ path: args.shot, fullPage: true });
await browser.close();
server.close();

const s = bench.summary;
console.log(`Tests with a model: ${s.tests - s.failed}/${s.tests}`);
console.log(`Kind right first: ${s.kindFirst}%   in top 3: ${s.kindTop3}%`);
console.log(`Size error (read from photos): ${s.dimError}% average, ${s.within10}% within 10%`);
console.log(`Leg/seat/rail error: ${s.paramError}%   Tests with warnings: ${s.withWarnings}`);
console.log(`Photos where a model failed: ${s.modelFailures ?? 0}`);
for (const e of s.modelErrors ?? []) console.log(`  ${e}`);
if (s.weightSweep?.length) {
  console.log('Kind right first / top 3 by outline weight (0 = recognition model only):');
  for (const w of s.weightSweep) console.log(`  ${String(w.weight).padEnd(5)} ${w.kindFirst}% / ${w.kindTop3}%`);
}
const fmt = (d) => (!d ? '   –  ' : d.given ? ' given' : d.guessed ? ' guess' : `${d.error >= 0 ? '+' : ''}${Math.round(d.error * 100)}%`.padStart(6));
for (const r of bench.results) {
  console.log(`\n${r.label} (${r.kind})${r.views.filter((v) => v.autoAngled && v.view !== 'angled').map((v) => `  [${v.view} looks angled]`).join('')}`);
  // What the recognition model saw in each photo, on its own.
  const seen = r.views.filter((v) => v.kindScores).map((v) => {
    const [k, p] = Object.entries(v.kindScores).sort((a, b) => b[1] - a[1])[0];
    return `${v.view} ${k} ${Math.round(p * 100)}%`;
  });
  if (seen.length) console.log(`  model sees: ${seen.join(', ')}`);
  for (const set of r.sets) {
    if (set.error) { console.log(`  ${set.set.padEnd(10)} ERROR ${set.error}`); continue; }
    const p = Object.entries(set.params).map(([k, d]) => `${k} ${fmt(d).trim()}`).join(' ');
    console.log(`  ${set.set.padEnd(10)} kind ${String(set.suggested[0]).padEnd(8)}${set.kindRank === 0 ? '✓' : '✗'}  W ${fmt(set.dims.width)} D ${fmt(set.dims.depth)} H ${fmt(set.dims.height)}  ${p}${set.warnings.length ? '  ⚠ ' + set.warnings.length : ''}`);
  }
}
