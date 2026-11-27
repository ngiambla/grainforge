# GrainForge

Turn photos of furniture into configurable woodworking plans, entirely in your browser.

GrainForge is a free, open-source tool for hobbyists and woodworkers. The goal:
give it a few photos of a piece of furniture, and get back a full plan with a
cut list, a lumber shopping list, the tools you need and the joinery, sized to
the dimensions you want and in metric or imperial. Plans export to PDF and save
as `.grainforge` files you can reopen and share.

Nothing is uploaded. All processing, including photo analysis, runs locally.

## Status

| Step | What                                                     | State       |
|------|----------------------------------------------------------|-------------|
| 1    | Project setup, `.grainforge` file format, load and save  | Done        |
| 2    | Plan engine: resizing, cut list, lumber layout, joinery by skill level, your tools, 3D preview, PDF | Done |
| 3    | Photos to model, using models that run in the browser    | Done (first version) |
| 4    | Examples, guide, tests and public release                | Done        |

## Try it

Open **https://ngiambla.github.io/grainforge/**, then pick **Examples** or **From photos**. **Guide** in the top bar walks through the rest.

## Development

Requires Node 22.

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # production build into dist/
npm run bench   # photo test bench (see below)
```

The site deploys to GitHub Pages from `main` via `.github/workflows/pages.yml`.

## How photos become a model

1. Add one or more photos and label each one as front, side, top or angled.
2. Click the piece in each photo. [SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform)
   (Apache-2.0) outlines it, running in your browser through
   [Transformers.js](https://github.com/huggingface/transformers.js) in a Web Worker,
   on WebGPU where available and WebAssembly otherwise. The model downloads once
   from the Hugging Face Hub and is cached; your photos never leave your device.
   If the model can't run, you draw a box around the piece instead.
3. Give one real measurement, such as "the width is 900 mm in the front photo",
   and add more if you know them ("+ Add another measurement"). Front views give
   width and height, side views depth and height, top views width and depth.
   An angled (three-quarter) photo gives all three, though depth and height are
   foreshortened estimates until you measure one of them. Photos that look angled
   are labelled angled automatically. The scale carries across photos through the
   dimensions they share.
4. GrainForge suggests the kind of furniture, and you confirm it. SigLIP
   (Apache-2.0, also in a Web Worker, downloaded once) recognises it from the
   photos; the outlines (open legs or a solid case, openings, proportions)
   break near-ties and take over if the model can't run.
   [Florence-2](https://huggingface.co/onnx-community/Florence-2-base-ft) (MIT)
   then finds the piece in each photo you haven't clicked yet and outlines it
   for you; click to adjust (`?florence=off` turns this off). Kinds: table, bench, stool, bookcase,
   cabinet, chair, bed frame, picture frame, wall peg rack and wooden utensil.
   It then fits a parametric template:
   - tables, benches and stools: leg thickness, top thickness, apron height and
     overhang; a thick slab top with no apron becomes legs joined straight into
     the top (you can force aprons on or off);
   - bookcases and cabinets: you set the number of shelves and doors;
   - chairs: seat height (from the side, or the seat band from the front);
   - beds: footboard height from the side;
   - picture frames: rail width from the opening;
   - utensils: a blank to saw and carve, with shaping steps.

Anything no photo shows clearly (often the depth) is estimated and called out so you can
check it. Splayed legs are modelled as straight for now.

## Photo test bench

`bench.html` (live at https://ngiambla.github.io/grainforge/bench.html) scores
the photo pipeline on 15 pieces, from tables and chairs to frames, racks and
spoons. Each piece is rendered from its true model with known sizes, from the
front, the side and at an angle, and every combination of 1 to 3 photos is
outlined, given one real measurement (the width), fitted and compared with the
truth: kind guessed, size error per dimension, and errors on legs, seats and
rails. Pick the simple outline (fast) or the SlimSAM model the app uses.

Headless, from a build:

```sh
npm run build
npm run bench                          # summary and per-piece table
npm run bench -- --case=chair --json=out.json --shot=bench.png
npm run bench -- --segmenter=sam       # outline with SlimSAM (WebAssembly if no GPU)
npm run bench -- --classifier=siglip   # also recognise the kind with SigLIP (or =clip)
```

The bench prints every photo where a model failed, with its error. With a
classifier it also prints what the model saw in each photo and how the kind
guess scores at several balances between the model and the outline rules.

### Real photos

`bench-photos.html` scores kind recognition on real catalog photos from
[Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.amazonaws.com/index.html)
(Collins et al., CVPR 2022; CC BY 4.0). The photos are not in the repository:

```sh
node scripts/abo-select.mjs            # 20 listings per kind, ~530 photos, into bench-data/ (git-ignored)
npm run build
npm run bench -- --photos              # outline rules, CLIP and SigLIP
npm run bench -- --photos --segmenter=sam --models=siglip
npm run bench -- --photos --florence    # also find the piece and count shelves, doors, hooks
```

Results, November 2026 (180 listings, 529 photos, 9 kinds; ABO has almost no
wooden utensils):

| Method | Listing right first | In top 3 |
| --- | --- | --- |
| Outline rules (simple outline) | 16.7% | 36.1% |
| Outline rules (SlimSAM outline) | 14.4% | 37.2% |
| CLIP | 63.9% | 83.9% |
| **SigLIP** | **85.6%** | **95%** |
| SigLIP + rules at weight 0.15 | 84.4% | 94.4% |
| SigLIP + rules at weight 1 | 46.7% | 85.6% |

The outline rules were tuned on the rendered bench (90% there) and don't carry
over to real photos. So the app recognises the kind with
[SigLIP](https://huggingface.co/Xenova/siglip-base-patch16-224) (Apache-2.0),
with the rules only breaking near-ties and taking over when the model can't
run (`?classifier=clip` picks CLIP, `?classifier=off` the rules alone).
SigLIP's weak spots are stools (60%, usually called chairs) and benches (55%).
Depth Anything V2 was tried for angled photos and dropped: it made sizes worse
on the rendered bench. Catalog photos are cleaner than a phone photo in a
cluttered room, so your own photos remain the hardest test.

This needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
Add a piece to `src/bench/corpus.ts` to test it.

## Your tools shape the plan

Switch on **Only use tools I have** and pick your tools. The plan changes to suit them:

- Each part's cut list row says which saw cuts it (a miter saw for narrow parts, a
  circular or track saw for wide ones, and so on).
- No saw that can rip: parts are bought as boards at the width they need.
- No planer or hand plane: parts are bought at their finished thickness.
- No clamps: wide glued-up panels become ready-made edge-glued panels.
- No saw for sheet goods: the store makes those cuts from the cutting diagram.
- Joints change to ones you can make, and anything still missing is listed.

Your skill and tools are remembered in your browser for new projects. **Save tools
file** writes them to a `.gftools` file you can load into any project, on any
computer, or send to someone else.

## File format

See [docs/file-format.md](docs/file-format.md).

## License

Apache License v2.0 with LLVM Exceptions. See [LICENSE.txt](LICENSE.txt).
