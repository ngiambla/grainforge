// What the image classifier is asked: several everyday names for each kind
// GrainForge can build, plus nearby furniture mapped to the closest kind, so
// "a nightstand" still lands on a cabinet. Pure data, shared by the worker and
// the tests.

import type { FurnitureKind } from './analysis';

export const KIND_PROMPTS: Record<FurnitureKind, string[]> = {
  table: ['a wooden table', 'a dining table', 'a coffee table', 'a side table', 'a desk', 'a console table'],
  bench: ['a wooden bench', 'a garden bench', 'an entryway bench'],
  stool: ['a wooden stool', 'a bar stool', 'a step stool'],
  bookcase: ['a bookcase', 'a bookshelf', 'an open shelving unit'],
  cabinet: ['a wooden cabinet', 'a sideboard', 'a dresser', 'a nightstand', 'a chest of drawers', 'a storage cupboard'],
  chair: ['a wooden chair', 'a dining chair', 'an armchair', 'a rocking chair'],
  bed: ['a bed frame', 'a wooden bed', 'a bed with a headboard'],
  frame: ['a picture frame', 'a wooden picture frame', 'a mirror frame'],
  rack: ['a wall-mounted peg rack', 'a coat rack with pegs', 'a wall shelf with hooks'],
  utensil: ['a wooden spoon', 'a wooden spatula', 'a wooden kitchen utensil', 'a wooden cutting board'],
};

/** Prompt text sent to the model. */
export const promptOf = (name: string) => `a photo of ${name}`;

/** All prompts in a fixed order, with the kind each belongs to. */
export const PROMPTS: { kind: FurnitureKind; text: string }[] = (Object.keys(KIND_PROMPTS) as FurnitureKind[]).flatMap((kind) =>
  KIND_PROMPTS[kind].map((name) => ({ kind, text: promptOf(name) })),
);

/**
 * Turn prompt similarities (cosine, -1..1) into a probability per kind: the
 * best prompt stands for its kind, then a softmax at CLIP's usual temperature.
 */
export function kindProbabilities(similarities: number[], scale = 100): Partial<Record<FurnitureKind, number>> {
  const best = new Map<FurnitureKind, number>();
  PROMPTS.forEach((p, i) => best.set(p.kind, Math.max(best.get(p.kind) ?? -Infinity, similarities[i]!)));
  const max = Math.max(...best.values());
  let sum = 0;
  const exp = new Map<FurnitureKind, number>();
  for (const [k, s] of best) {
    const e = Math.exp(scale * (s - max));
    exp.set(k, e);
    sum += e;
  }
  return Object.fromEntries([...exp].map(([k, e]) => [k, e / sum]));
}
