import { describe, expect, it } from 'vitest';
import { ExprError, evalDimension, evaluate, parseExpr, references } from '../src/format/expr';

const ev = (s: string, scope: Record<string, number> = {}) => evaluate(parseExpr(s), scope);

describe('expressions', () => {
  it('follows operator precedence', () => {
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('-2 * -3')).toBe(6);
  });

  it('reads parameters and functions', () => {
    const scope = { width: 600, leg: 45 };
    expect(ev('width - 2 * leg', scope)).toBe(510);
    expect(ev('max(width / 4, 200)', scope)).toBe(200);
    expect(ev('round(width / 7)', scope)).toBe(86);
    expect([...references(parseExpr('min(a, b) + a * c'))].sort()).toEqual(['a', 'b', 'c']);
  });

  it('accepts plain numbers as dimensions', () => {
    expect(evalDimension(19, {})).toBe(19);
    expect(evalDimension('1.5e2', {})).toBe(150);
  });

  it('rejects anything that is not arithmetic', () => {
    for (const bad of ['', '2 +', 'alert(1)', 'a; b', '2 ** 3', '(1', 'width.length', '1)']) {
      expect(() => parseExpr(bad), bad).toThrow(ExprError);
    }
    expect(() => ev('x')).toThrow(/Unknown parameter/);
    expect(() => ev('1 / 0')).toThrow(/Division by zero/);
  });
});
