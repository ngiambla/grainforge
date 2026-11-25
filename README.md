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
3. Give one real measurement, such as "the width is 900 mm in the front photo",
   and add more if you know them ("+ Add another measurement"). Front views give
   width and height, side views depth and height, top views width and depth.
   An angled (three-quarter) photo gives all three, though depth and height are
   foreshortened estimates until you measure one of them. Photos that look angled
   are labelled angled automatically. The scale carries across photos through the
   dimensions they share.
4. GrainForge suggests the kind of furniture from the outline (open legs or a
   solid case, and the proportions), and you confirm it. It then fits a parametric
   template: for tables, benches and stools it also reads leg thickness, top
   thickness, apron height and overhang; a thick slab top with no apron becomes
   legs joined straight into the top (you can force aprons on or off). For
   bookcases and cabinets you can set the number of shelves and doors.

Anything no photo shows clearly (often the depth) is estimated and called out so you can
check it. Splayed legs are modelled as straight for now.

## File format

See [docs/file-format.md](docs/file-format.md).

## License

Apache License v2.0 with LLVM Exceptions. See [LICENSE.txt](LICENSE.txt).
