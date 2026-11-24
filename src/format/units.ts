// All lengths in a .grainforge file are stored in millimetres. Units only
// affect how numbers are shown and typed.

export type UnitSystem = 'metric' | 'imperial';

export const MM_PER_INCH = 25.4;

/** Format a length in mm for display. Imperial rounds to the nearest 1/16". */
export function formatLength(mm: number, units: UnitSystem): string {
  if (units === 'metric') {
    const rounded = Math.round(mm * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} mm`;
  }
  const sixteenths = Math.round((mm / MM_PER_INCH) * 16);
  const sign = sixteenths < 0 ? '-' : '';
  const abs = Math.abs(sixteenths);
  const whole = Math.floor(abs / 16);
  let num = abs % 16;
  let den = 16;
  while (num !== 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (num === 0) return `${sign}${whole}"`;
  return whole === 0 ? `${sign}${num}/${den}"` : `${sign}${whole} ${num}/${den}"`;
}

/**
 * Parse a length typed by a person. Accepts plain numbers in the current unit
 * system, or an explicit unit: "450mm", "45 cm", "1.2m", "3'", "17 3/4\"",
 * "1' 5 1/2\"", "3/4in".
 */
export function parseLength(text: string, units: UnitSystem): number {
  const s = text.trim().toLowerCase();
  if (s === '') throw new Error('Empty length');

  const metric = /^(-?\d*\.?\d+)\s*(mm|cm|m)$/.exec(s);
  if (metric) {
    const v = Number(metric[1]);
    return metric[2] === 'mm' ? v : metric[2] === 'cm' ? v * 10 : v * 1000;
  }

  // Feet and/or inches with optional fractions.
  const imperial =
    /^(?:(-?\d*\.?\d+)\s*(?:'|ft))?\s*(?:(\d*\.?\d+)?(?:\s*(\d+)\/(\d+))?\s*(?:"|in)?)?$/.exec(s);
  const hasImperialMark = /('|ft|"|in)/.test(s) || /\d+\/\d+/.test(s);
  if (imperial && (hasImperialMark || units === 'imperial')) {
    const [, ft, inch, n, d] = imperial;
    if (ft === undefined && inch === undefined && n === undefined) throw new Error(`Can't read "${text}"`);
    if (d !== undefined && Number(d) === 0) throw new Error(`Can't read "${text}"`);
    const inches =
      (ft ? Number(ft) * 12 : 0) + (inch ? Number(inch) : 0) + (n && d ? Number(n) / Number(d) : 0);
    return inches * MM_PER_INCH;
  }

  if (/^-?\d*\.?\d+$/.test(s)) return Number(s); // plain number, metric → mm
  throw new Error(`Can't read "${text}" as a length`);
}
