// The bulk test set: pieces with known sizes, photographed from several
// angles. Synthetic cases are rendered from the same parametric models the
// app builds, with the true sizes kept, so every fit can be scored.

import type { FurnitureKind } from '../vision/analysis';
import type { View } from '../vision/fuse';
import type { FitInput } from '../vision/templates';

export interface BenchCase {
  id: string;
  label: string;
  /** The true model. Its kind is what the photos should be recognised as. */
  truth: FitInput;
  /** Extra parameters worth scoring, by parameter id in the built project. */
  check?: string[];
  /** Wood colour for the render. */
  color?: number;
  /** Draw a curved outline instead of the model's boxes (utensils). */
  outline?: 'spoon' | 'spatula';
}

/** Camera positions for each labelled view: azimuth from the front (degrees, + turns towards the right side) and elevation. */
export const CAMERAS: Record<Exclude<View, 'back' | 'left' | 'top'>, { az: number; el: number }> = {
  front: { az: 0, el: 6 },
  right: { az: 90, el: 6 },
  angled: { az: 35, el: 24 },
};
export type BenchView = keyof typeof CAMERAS;

/** Which photos each test uses: one photo, two, or three. */
export const PHOTO_SETS: { id: string; views: BenchView[] }[] = [
  { id: 'angled', views: ['angled'] },
  { id: 'front', views: ['front'] },
  { id: 'front+side', views: ['front', 'right'] },
  { id: 'all three', views: ['front', 'right', 'angled'] },
];

const t = (kind: FurnitureKind, width: number, depth: number, height: number, extra: Partial<FitInput> = {}): FitInput => ({
  kind, width, depth, height, ...extra,
});

export const CASES: BenchCase[] = [
  { id: 'side-table', label: 'Side table with aprons', truth: t('table', 600, 400, 550, { leg: 45, apron: 80, overhang: 20, topThickness: 19 }), check: ['leg', 'overhang', 'top_t'] },
  { id: 'dining-table', label: 'Dining table', truth: t('table', 1800, 900, 750, { leg: 70, apron: 100, overhang: 40, topThickness: 30 }), check: ['leg', 'overhang', 'top_t'], color: 0x9b6a3e },
  { id: 'slab-coffee-table', label: 'Slab coffee table, no aprons', truth: t('table', 1300, 600, 420, { leg: 70, aprons: false, overhang: 120, topThickness: 60 }), check: ['leg', 'top_t'], color: 0xb98a5a },
  { id: 'bench', label: 'Bench', truth: t('bench', 1200, 350, 450, { leg: 50, apron: 70, overhang: 30, topThickness: 30 }), check: ['leg'] },
  { id: 'stool', label: 'Stool', truth: t('stool', 350, 350, 650, { leg: 40, apron: 60, overhang: 20, topThickness: 25 }), check: ['leg'] },
  { id: 'bookcase', label: 'Bookcase', truth: t('bookcase', 800, 300, 1800, { shelves: 4 }), color: 0xd9b48a },
  { id: 'cabinet', label: 'Two-door cabinet', truth: t('cabinet', 900, 450, 800, { doors: 2 }), color: 0xc8955c },
  { id: 'chair', label: 'Dining chair', truth: t('chair', 450, 480, 900, { seatHeight: 450, leg: 38 }), check: ['seat_h', 'leg'], color: 0xa8703f },
  { id: 'low-chair', label: 'Low-back chair', truth: t('chair', 470, 460, 760, { seatHeight: 440, leg: 40 }), check: ['seat_h'], color: 0xc8955c },
  { id: 'bed', label: 'Double bed frame', truth: t('bed', 1500, 2100, 1100, { footHeight: 500, leg: 80 }), check: ['foot_h'], color: 0x9b7653 },
  { id: 'frame', label: 'Picture frame', truth: t('frame', 400, 22, 500, { rail: 45 }), check: ['rail'], color: 0x6e4a2a },
  { id: 'square-frame', label: 'Square frame, thin rails', truth: t('frame', 300, 20, 300, { rail: 25 }), check: ['rail'], color: 0xc8955c },
  { id: 'peg-rack', label: 'Wall peg rack', truth: t('rack', 600, 110, 100, { pegs: 4 }), color: 0xb98a5a },
  { id: 'spoon', label: 'Wooden spoon', truth: t('utensil', 60, 14, 300), outline: 'spoon', color: 0xd9b48a },
  { id: 'spatula', label: 'Flat spatula', truth: t('utensil', 75, 10, 320), outline: 'spatula', color: 0xc8955c },
];
