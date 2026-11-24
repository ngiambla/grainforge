# The `.grainforge` file format (version 1)

A GrainForge project is a single JSON file with the `.grainforge` extension.
It is the source of truth for a design: open it, change it, save it, share it.
Like a draw.io file, it is plain text, so it diffs well in git.

The schema lives in [`src/format/schema.ts`](../src/format/schema.ts), and
[`examples/side-table.grainforge`](../examples/side-table.grainforge) is a complete example.

## Units

**Every length is stored in millimetres**, whatever the user chooses to see.
`units` (`"metric"` or `"imperial"`) only controls display and input. Imperial
display rounds to the nearest 1/16".

## Top level

| Field        | Type                     | Notes                                           |
|--------------|--------------------------|-------------------------------------------------|
| `format`     | `"grainforge"`           | Required. Identifies the file.                  |
| `version`    | `1`                      | Required. Bumped on breaking changes.           |
| `meta`       | `{ name, description, created, modified }` | Times are ISO 8601. |
| `units`      | `"metric" \| "imperial"` | Display preference. Default `"metric"`.         |
| `parameters` | `Parameter[]`            | The dimensions a user can change.               |
| `materials`  | `Material[]`             | Stock the parts are cut from.                   |
| `parts`      | `Part[]`                 | Every piece of wood.                            |
| `joints`     | `Joint[]`                | How parts connect.                              |
| `photos`     | `Photo[]`                | Reference photos, embedded as `data:` URLs.     |
| `workshop`   | `{ skill, tools }`       | The maker's skill level and the tools they own. |

## Parameters and expressions

A parameter is a named number, such as `width` = `600`. Any dimension of a part
can be a plain number (mm) or an **expression** over parameters:

```json
"length": "width - 2 * overhang - 2 * leg"
```

Expressions support numbers, parameter names, `+ - * /`, parentheses, unary
minus, and the functions `min`, `max` and `round`. Nothing else is allowed, and
expressions are never passed to `eval`. This is what makes a plan resizable:
change `width` and every part that depends on it follows.

Parameter fields: `id` (letters, digits, `_`), `label`, `kind`
(`length`, `count` or `angle`), `value`, and optional `min`/`max`.

## Materials

`id`, `name`, `kind` (`lumber` for boards or `sheet` for plywood/MDF),
`thickness` in mm, and optional `species` and `nominal` (trade name such as `2x4`).

## Parts

Each part is a rectangular board:

- `length` runs along the grain (the part's local x axis), `width` is local y,
  `thickness` is local z and defaults to the material's thickness.
- `quantity` defaults to 1. Use separate parts when copies sit in different places.
- `position` is the part's minimum corner in world space, before rotation.
- `rotation` is in degrees about x, then y, then z, around that corner.
- World axes: x is width (left to right), y is depth (front to back), z is height.

## Joints

`type` is one of: `butt`, `butt-screwed`, `pocket-screw`, `dowel`, `biscuit`,
`domino`, `rabbet`, `dado`, `groove`, `tongue-and-groove`, `half-lap`, `bridle`,
`mortise-and-tenon`, `box-joint`, `dovetail`, `miter`, `splined-miter`.

`parts` lists at least two part ids. `alternatives` lists other joint types that
would work, so the plan can offer an easier or stronger option.

## Validation

Loading a file checks the schema, then also checks that ids are unique, every
reference points at something that exists, and every expression parses and only
uses known parameters. Errors name the field so they can be fixed by hand.

## Versioning

Files newer than the app are refused with a message to reload. When version 2
exists, the loader will upgrade version 1 files automatically.
