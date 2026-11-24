import type { Material } from '../format';

/** Saw kerf allowed between pieces, mm. */
export const KERF = 3;
/** Extra width per strip and extra length for panels that are glued up, mm. */
export const GLUEUP_WIDTH_ALLOWANCE = 5;
export const GLUEUP_LENGTH_ALLOWANCE = 25;

export function stockOf(m: Material): { width: number; lengths: number[] } {
  if (m.stock) return { width: m.stock.width, lengths: [...m.stock.lengths].sort((a, b) => a - b) };
  return m.kind === 'sheet'
    ? { width: 1220, lengths: [2440] } // 4 x 8 ft sheet
    : { width: 140, lengths: [2400] }; // a 1x6 / 140 mm board
}
