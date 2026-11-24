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
| 1    | Project setup, `.grainforge` file format, load and save  | In progress |
| 2    | Plan engine: resizing, cut list, lumber layout, joinery by skill level, your tools, 3D preview, PDF | Planned |
| 3    | Photos to model, using models that run in the browser    | Planned     |
| 4    | Examples, guide, tests and public release                | Planned     |

## Development

Requires Node 22.

```sh
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # production build into dist/
```

The site deploys to GitHub Pages from `main` via `.github/workflows/pages.yml`.

## File format

See [docs/file-format.md](docs/file-format.md).

## License

Apache License v2.0 with LLVM Exceptions. See [LICENSE.txt](LICENSE.txt).
