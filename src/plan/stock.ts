import type { Material, UnitSystem } from '../format';

/** Saw kerf allowed between pieces, mm. */
export const KERF = 3;
/** Extra width per strip and extra length for panels that are glued up, mm. */
export const GLUEUP_WIDTH_ALLOWANCE = 5;
export const GLUEUP_LENGTH_ALLOWANCE = 25;

const FT = 304.8;

/**
 * What you can buy. Explicit stock sizes win in metric. In imperial, boards
 * and sheets are sold in whole feet, so lengths switch to 6, 8, 10 and 12 ft
 * (8 ft for sheets) and a default sheet is 48" wide.
 */
export function stockOf(m: Material, units: UnitSystem = 'metric'): { width: number; lengths: number[] } {
  if (units === 'imperial') {
    if (m.kind === 'sheet') return { width: m.stock?.width ?? 4 * FT, lengths: [8 * FT] };
    return { width: m.stock?.width ?? 139.7, lengths: [6, 8, 10, 12].map((f) => f * FT) };
  }
  if (m.stock) return { width: m.stock.width, lengths: [...m.stock.lengths].sort((a, b) => a - b) };
  return m.kind === 'sheet'
    ? { width: 1220, lengths: [2440] } // 1220 x 2440 mm sheet
    : { width: 140, lengths: [2400] }; // 140 mm board
}
