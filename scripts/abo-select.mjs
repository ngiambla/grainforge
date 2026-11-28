// Build a real-photo test set from Amazon Berkeley Objects (ABO), a public
// dataset of product listings with catalog photos and listed dimensions,
// licensed CC BY 4.0 (https://amazon-berkeley-objects.s3.amazonaws.com/index.html).
//
//   node scripts/abo-select.mjs [--per-kind=20] [--images=3] [--out=bench-data/abo]
//
// Downloads the listing and image metadata once (about 100 MB, cached in the
// output folder), picks listings for each kind GrainForge builds, and
// downloads their small (256 px) catalog photos. Everything goes in a folder
// git ignores, so no photo enters the repository; manifest.json keeps the
// attribution the license asks for.
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PER_KIND = Number(args['per-kind'] ?? 20);
const IMAGES = Number(args.images ?? 3);
const OUT = args.out ?? 'bench-data/abo';
const BASE = 'https://amazon-berkeley-objects.s3.amazonaws.com';

/** Which listings count as each kind: product types, and words the name must (or must not) contain. */
const KINDS = {
  table: { types: ['TABLE', 'DESK'], not: /cover|cloth|lamp|runner|mat\b/i },
  bench: { types: ['BENCH', 'HOME_FURNITURE_AND_DECOR'], name: /\bbench\b/i, not: /fitness|weight|cushion|pad\b/i },
  stool: { types: ['STOOL_SEATING'], not: /cushion|cover/i },
  bookcase: { types: ['SHELF', 'HOME_FURNITURE_AND_DECOR', 'HOME'], name: /book ?case|book ?shelf|shelving unit|shelf unit|etagere/i },
  cabinet: { types: ['CABINET', 'DRESSER'], not: /knob|handle|hinge|lock/i },
  chair: { types: ['CHAIR'], not: /cushion|cover|pad\b|bean ?bag/i },
  bed: { types: ['BED', 'BED_FRAME'], not: /sheet|pillow|mattress topper|cover|tent/i },
  frame: { types: ['PICTURE_FRAME', 'HOME', 'HOME_FURNITURE_AND_DECOR'], name: /picture frame|photo frame/i, not: /collage|digital/i },
  rack: { types: ['STORAGE_HOOK', 'HOME', 'HOME_FURNITURE_AND_DECOR'], name: /coat rack|hook rack|wall hook|peg/i, not: /adhesive|over.the.door|tie rack/i },
  utensil: { types: ['KITCHEN', 'CUTTING_BOARD'], name: /spoon|spatula|cutting board|chopping board|turner|ladle/i, not: /organi[sz]er|bowl|cookware|piece|plastic|silicone|nylon|stainless/i },
};

async function fetchOnce(path, file) {
  const dest = join(OUT, file);
  if (existsSync(dest)) return dest;
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function* lines(file) {
  yield* createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
}

const en = (xs) => xs?.find((x) => x.language_tag?.startsWith('en'))?.value;
const cm = (d) => (d ? (d.unit === 'centimeters' ? d.value : d.normalized_value?.unit === 'inches' ? d.normalized_value.value * 2.54 : undefined) : undefined);
// A fixed, even spread over the dataset rather than its first rows.
const order = (id) => createHash('sha1').update(id).digest('hex');

await mkdir(join(OUT, 'images'), { recursive: true });
console.log('Fetching metadata (first run only)…');
const listingsFile = await fetchOnce('listings/listings.json.gz', 'listings.json.gz');
const imagesFile = await fetchOnce('images/metadata/images.csv.gz', 'images.csv.gz');

const candidates = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
const seen = new Set();
for await (const line of lines(listingsFile)) {
  const d = JSON.parse(line);
  const type = d.product_type?.[0]?.value;
  const name = en(d.item_name);
  if (!type || !name || !d.main_image_id || seen.has(d.item_id)) continue;
  for (const [kind, rule] of Object.entries(KINDS)) {
    if (!rule.types.includes(type)) continue;
    if (rule.name && !rule.name.test(name)) continue;
    if (rule.not?.test(name)) continue;
    const dim = d.item_dimensions ?? {};
    const sizes = { height: cm(dim.height), length: cm(dim.length), width: cm(dim.width) };
    candidates[kind].push({
      id: d.item_id,
      kind,
      name,
      domain: d.domain_name,
      type,
      // Listed sizes in cm, as the listing gives them; which horizontal one is
      // the width varies between listings, so the bench treats them as a pair.
      sizes: Object.values(sizes).every((v) => v > 0) ? sizes : undefined,
      imageIds: [d.main_image_id, ...(d.other_image_id ?? [])].slice(0, IMAGES),
    });
    seen.add(d.item_id);
    break;
  }
}

const picked = Object.values(candidates).flatMap((list) =>
  list.sort((a, b) => (a.sizes ? 0 : 1) - (b.sizes ? 0 : 1) || order(a.id).localeCompare(order(b.id))).slice(0, PER_KIND),
);
const wanted = new Set(picked.flatMap((p) => p.imageIds));
const paths = new Map();
for await (const line of lines(imagesFile)) {
  const [id, h, w, path] = line.split(',');
  if (wanted.has(id)) paths.set(id, { path, width: Number(w), height: Number(h) });
}

let downloaded = 0;
for (const p of picked) {
  p.images = [];
  for (const id of p.imageIds) {
    const meta = paths.get(id);
    if (!meta) continue;
    const file = `images/${id}.jpg`;
    if (!existsSync(join(OUT, file))) {
      const res = await fetch(`${BASE}/images/small/${meta.path}`);
      if (!res.ok) continue;
      await writeFile(join(OUT, file), Buffer.from(await res.arrayBuffer()));
      downloaded++;
    }
    p.images.push({ id, file, width: meta.width, height: meta.height, main: id === p.imageIds[0] });
  }
  delete p.imageIds;
}

// A kind with only a handful of listings would swing the scores; leave it out.
const MIN_PER_KIND = 5;
const usable = picked.filter((p) => p.images.length);
const items = usable.filter((p) => usable.filter((q) => q.kind === p.kind).length >= MIN_PER_KIND);
await writeFile(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      source: 'Amazon Berkeley Objects (ABO)',
      license: 'CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
      credit: 'Collins et al., "ABO: Dataset and Benchmarks for Real-World 3D Object Understanding", CVPR 2022. Amazon.com, Inc.',
      url: 'https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
      items,
    },
    null,
    1,
  ),
);
const byKind = Object.fromEntries(Object.keys(KINDS).map((k) => [k, items.filter((i) => i.kind === k).length]));
console.log(`Kept ${items.length} listings, ${items.reduce((n, i) => n + i.images.length, 0)} photos (${downloaded} new):`, byKind);
console.log(`Candidates per kind:`, Object.fromEntries(Object.entries(candidates).map(([k, v]) => [k, v.length])));
