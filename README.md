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
3. Give one real measurement, such as "the width is 900 mm in the front photo".
   Front views give width and height, side views depth and height, top views
   width and depth. The scale carries across photos through the dimensions they share.
4. GrainForge suggests the kind of furniture from the outline (open legs or a
   solid case, and the proportions), and you confirm it. It then fits a parametric
   template: for tables, benches and stools it also reads leg thickness, apron
   height and overhang from the front view; for bookcases and cabinets you can set
   the number of shelves and doors.

Anything no photo shows (often the depth) is estimated and called out so you can check it.

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
