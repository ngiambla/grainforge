// The .grainforge project file format, version 1.
//
// A project is a parametric model: a few named parameters (overall width,
// height, ...) and a list of parts whose sizes and positions are numbers or
// expressions over those parameters. Every length is in millimetres.
// See docs/file-format.md for the full description.

import { z } from 'zod';

export const FORMAT_ID = 'grainforge';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.grainforge';

const Id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'ids start with a letter or _ and use letters, digits, _ or -');

/** Parameter ids are used inside expressions, so they can't contain '-'. */
const ParamId = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'parameter ids use letters, digits and _ only');

/** A length in mm, or an expression such as "height - top_thickness". */
export const Dimension = z.union([z.number(), z.string().min(1)]);

export const Vec3 = z.object({ x: Dimension, y: Dimension, z: Dimension });

export const Parameter = z.object({
  id: ParamId,
  label: z.string(),
  kind: z.enum(['length', 'count', 'angle']).default('length'),
  value: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const Material = z.object({
  id: Id,
  name: z.string(),
  /** Dimensional lumber / rough boards, or sheet goods like plywood and MDF. */
  kind: z.enum(['lumber', 'sheet']),
  species: z.string().optional(),
  /** Finished thickness in mm. */
  thickness: z.number().positive(),
  /** Trade name, e.g. "2x4", "4/4", "3/4 in birch ply". */
  nominal: z.string().optional(),
  /**
   * What you can buy: board or sheet width and the lengths sold, in mm.
   * Defaults depend on the kind (see src/plan/stock.ts).
   */
  stock: z
    .object({
      width: z.number().positive(),
      lengths: z.array(z.number().positive()).min(1),
    })
    .optional(),
});

export const JointType = z.enum([
  'butt',
  'butt-screwed',
  'pocket-screw',
  'dowel',
  'biscuit',
  'domino',
  'rabbet',
  'dado',
  'groove',
  'tongue-and-groove',
  'half-lap',
  'bridle',
  'mortise-and-tenon',
  'box-joint',
  'dovetail',
  'miter',
  'splined-miter',
]);

export const Part = z.object({
  id: Id,
  name: z.string(),
  material: Id,
  quantity: Dimension.default(1),
  /** Size along the grain. */
  length: Dimension,
  width: Dimension,
  /** Defaults to the material's thickness. */
  thickness: Dimension.optional(),
  /** Position of the part's minimum corner, before rotation. */
  position: Vec3.default({ x: 0, y: 0, z: 0 }),
  /** Rotation in degrees about the x, y and z axes, applied in that order. */
  rotation: Vec3.default({ x: 0, y: 0, z: 0 }),
  /**
   * Shaping after the part is cut square: "curved" outlines are sawn (band saw,
   * jigsaw or coping saw); "carved" parts are also carved to a 3D form.
   * Absent means the part stays rectangular.
   */
  shape: z.enum(['curved', 'carved']).optional(),
  notes: z.string().optional(),
});

export const Joint = z.object({
  id: Id,
  type: JointType,
  /**
   * The parts this joint connects, at least two. The first part receives the
   * joint (e.g. the leg holding the mortise); the others join into it.
   */
  parts: z.array(Id).min(2),
  /** Other joint types that would work here, e.g. for a different skill level. */
  alternatives: z.array(JointType).default([]),
  /** The joint the maker picked. When absent, GrainForge picks one for their skill and tools. */
  chosen: JointType.optional(),
  notes: z.string().optional(),
});

export const Photo = z.object({
  id: Id,
  view: z.enum(['front', 'back', 'left', 'right', 'top', 'angled']),
  /** A data: URL, so a project file stays self-contained. */
  src: z.string().startsWith('data:image/'),
});

export const Workshop = z.object({
  skill: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  /**
   * Tool ids the maker owns, e.g. "table-saw", "drill", "pocket-hole-jig".
   * Absent means "not told yet": plans then assume any tool is available.
   */
  tools: z.array(z.string()).optional(),
});

export const Project = z.object({
  format: z.literal(FORMAT_ID),
  version: z.literal(FORMAT_VERSION),
  meta: z.object({
    name: z.string(),
    description: z.string().default(''),
    created: z.string().optional(),
    modified: z.string().optional(),
  }),
  /** How lengths are shown. Storage is always mm. */
  units: z.enum(['metric', 'imperial']).default('metric'),
  parameters: z.array(Parameter).default([]),
  materials: z.array(Material).default([]),
  parts: z.array(Part).default([]),
  joints: z.array(Joint).default([]),
  photos: z.array(Photo).default([]),
  workshop: Workshop.default({ skill: 'beginner' }),
});

export type Dimension = z.infer<typeof Dimension>;
export type Parameter = z.infer<typeof Parameter>;
export type Material = z.infer<typeof Material>;
export type JointType = z.infer<typeof JointType>;
export type Part = z.infer<typeof Part>;
export type Joint = z.infer<typeof Joint>;
export type Photo = z.infer<typeof Photo>;
export type Workshop = z.infer<typeof Workshop>;
export type Project = z.infer<typeof Project>;
