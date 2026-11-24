import { describe, expect, it } from 'vitest';
import { formatLength, parseLength } from '../src/format/units';

describe('formatLength', () => {
  it('formats metric', () => {
    expect(formatLength(600, 'metric')).toBe('600 mm');
    expect(formatLength(19.05, 'metric')).toBe('19.1 mm');
  });
  it('formats imperial to the nearest sixteenth', () => {
    expect(formatLength(25.4, 'imperial')).toBe('1"');
    expect(formatLength(19.05, 'imperial')).toBe('3/4"');
    expect(formatLength(450.85, 'imperial')).toBe('17 3/4"');
    expect(formatLength(1.5875, 'imperial')).toBe('1/16"');
  });
});

describe('parseLength', () => {
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
  it('reads metric with or without units', () => {
    expect(parseLength('450', 'metric')).toBe(450);
    expect(parseLength('45 cm', 'imperial')).toBe(450);
    expect(parseLength('1.2m', 'metric')).toBe(1200);
  });
  it('reads imperial forms', () => {
    close(parseLength('3/4"', 'metric'), 19.05);
    close(parseLength('17 3/4', 'imperial'), 450.85);
    close(parseLength(`1' 5 1/2"`, 'metric'), 17.5 * 25.4);
    close(parseLength('2ft', 'metric'), 609.6);
    close(parseLength('12', 'imperial'), 304.8);
  });
  it('rejects junk', () => {
    for (const bad of ['', 'abc', '3/0"', '12 parsecs']) {
      expect(() => parseLength(bad, 'metric'), bad).toThrow();
    }
  });
});
