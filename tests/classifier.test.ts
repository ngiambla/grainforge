import { describe, expect, it } from 'vitest';
import { combineKinds } from '../src/vision/classifier';
import { kindProbabilities, PROMPTS } from '../src/vision/kinds-labels';

const sims = (best: string, high = 0.3, low = 0.2) => PROMPTS.map((p) => (p.text === best ? high : low));

describe('recognition model scores', () => {
  it('turns prompt similarities into probabilities per kind', () => {
    const p = kindProbabilities(sims('a photo of a nightstand'));
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0]).toBe('cabinet');
  });

  it('lets the model lead and the outline break near-ties', () => {
    const chairy = kindProbabilities(sims('a photo of a dining chair'));
    expect(combineKinds([chairy], ['stool', 'table'])[0]!.kind).toBe('chair');
    const tie = { table: 0.5, bench: 0.5 };
    expect(combineKinds([tie], ['bench', 'table'])[0]!.kind).toBe('bench');
  });

  it('falls back to the outline alone when the model gave nothing', () => {
    expect(combineKinds([], ['frame', 'cabinet'])[0]!.kind).toBe('frame');
  });

  it('has a prompt for every kind', () => {
    expect(new Set(PROMPTS.map((p) => p.kind)).size).toBe(10);
  });
});
