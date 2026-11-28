import { describe, expect, it } from 'vitest';
import { confusions, rankVote, scoreMethods, type ListingAnswer } from '../src/bench/photo-score';

const listing = (kind: ListingAnswer['kind'], rules: ListingAnswer['kind'][][], clip: Record<string, number>[]): ListingAnswer => ({
  id: kind,
  kind,
  name: kind,
  photos: rules.map((r, i) => ({ rules: r, models: { clip: clip[i] ?? null } })),
});

describe('real-photo scoring', () => {
  it('votes rankings across photos', () => {
    expect(rankVote([['table', 'bench'], ['bench', 'table'], ['bench']])[0]).toBe('bench');
    expect(rankVote([[]])).toEqual([]);
  });

  it('scores rules, the model and blends per photo and per listing', () => {
    const ls = [
      listing('chair', [['stool'], ['chair']], [{ chair: 0.9, stool: 0.1 }, { chair: 0.8, stool: 0.2 }]),
      listing('table', [['table'], []], [{ bench: 0.7, table: 0.3 }, { table: 0.6, bench: 0.4 }]),
    ];
    const s = Object.fromEntries(scoreMethods(ls, ['clip']).map((m) => [m.method, m]));
    expect(s.rules!.photoFirst).toBe(50);
    expect(s.clip!.photoFirst).toBe(75);
    expect(s.clip!.listingFirst).toBe(50); // table averages to bench 0.55
    expect(s.clip!.byKind).toEqual({ chair: 100, table: 0 });
    expect(s['rules+clip @0.15']!.listingFirst).toBe(100);
    expect(confusions(ls, ['clip'], 'clip')).toEqual([['table → bench', 1]]);
  });
});
