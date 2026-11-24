// What GrainForge knows about each joint: how hard it is, what it takes, how
// much extra length it adds, and how to cut it.

import type { Joint, JointType, Workshop } from '../format';
import { bestOption, canDo, type Requirement } from './tools';

export type Skill = Workshop['skill'];
export const SKILL_RANK: Record<Skill, number> = { beginner: 0, intermediate: 1, advanced: 2 };

export interface JointInfo {
  label: string;
  skill: Skill;
  /** 1 (weak) to 5 (very strong), for a typical furniture frame. */
  strength: number;
  needs: Requirement;
  /**
   * Extra length each joining part needs at this end, in mm, given the
   * thickness of the receiving part. E.g. a tenon's length.
   */
  allowance: (receivingThickness: number) => number;
  /** Plain-language steps. */
  steps: string[];
}

const none = () => 0;

export const JOINTS: Record<JointType, JointInfo> = {
  butt: {
    label: 'Glued butt joint',
    skill: 'beginner',
    strength: 1,
    needs: [['clamps']],
    allowance: none,
    steps: ['Square the ends.', 'Glue and clamp. Only use where there is long-grain glue surface or little load.'],
  },
  'butt-screwed': {
    label: 'Screwed butt joint',
    skill: 'beginner',
    strength: 2,
    needs: [['drill']],
    allowance: none,
    steps: ['Mark screw positions.', 'Drill pilot and countersink holes.', 'Glue if the grain allows, then screw together.'],
  },
  'pocket-screw': {
    label: 'Pocket screws',
    skill: 'beginner',
    strength: 3,
    needs: [['drill', 'pocket-hole-jig']],
    allowance: none,
    steps: [
      'Set the jig and drill collar for the stock thickness.',
      'Drill two pocket holes per joint on the hidden face.',
      'Clamp parts flush, glue, and drive the pocket screws.',
    ],
  },
  dowel: {
    label: 'Dowels',
    skill: 'beginner',
    strength: 3,
    needs: [['drill', 'dowel-jig']],
    allowance: none,
    steps: [
      'Mark matching centrelines on both parts.',
      'Drill dowel holes with the jig, slightly deeper than half the dowel length.',
      'Glue the holes and dowels, assemble and clamp.',
    ],
  },
  biscuit: {
    label: 'Biscuits',
    skill: 'beginner',
    strength: 2,
    needs: [['biscuit-joiner', 'clamps']],
    allowance: none,
    steps: ['Mark slot centres across the joint.', 'Cut matching slots.', 'Glue slots and biscuits, assemble and clamp.'],
  },
  domino: {
    label: 'Domino tenons',
    skill: 'intermediate',
    strength: 4,
    needs: [['domino', 'clamps']],
    allowance: none,
    steps: ['Mark mortise centres.', 'Cut matching mortises, one tight and one wide.', 'Glue tenons and mortises, assemble and clamp.'],
  },
  rabbet: {
    label: 'Rabbet',
    skill: 'intermediate',
    strength: 2,
    needs: [['router'], ['table-saw'], ['rabbet-plane', 'marking-gauge']],
    allowance: none,
    steps: ['Cut a step half the thickness deep along the edge.', 'Glue and clamp, adding screws or nails if needed.'],
  },
  dado: {
    label: 'Dado',
    skill: 'intermediate',
    strength: 3,
    needs: [['router'], ['table-saw', 'dado-stack'], ['japanese-saw', 'chisels']],
    allowance: (t) => Math.round(t / 3),
    steps: [
      'Mark the dado on the receiving part, one third of its thickness deep.',
      'Cut the dado to the exact thickness of the joining part.',
      'Glue and slide the joining part in.',
    ],
  },
  groove: {
    label: 'Groove',
    skill: 'intermediate',
    strength: 2,
    needs: [['router'], ['table-saw']],
    allowance: (t) => Math.round(t / 3),
    steps: ['Cut a groove along the grain, one third deep.', 'Fit the panel, leaving room for seasonal movement.'],
  },
  'tongue-and-groove': {
    label: 'Tongue and groove',
    skill: 'intermediate',
    strength: 3,
    needs: [['router', 'router-table'], ['table-saw']],
    allowance: (t) => Math.round(t / 3),
    steps: ['Cut the groove in the receiving part.', 'Cut a matching tongue on the joining part.', 'Glue and clamp.'],
  },
  'half-lap': {
    label: 'Half lap',
    skill: 'intermediate',
    strength: 3,
    needs: [['japanese-saw', 'chisels'], ['router'], ['table-saw', 'dado-stack']],
    allowance: (t) => t,
    steps: ['Mark both parts to half their thickness.', 'Saw the shoulders, remove waste, pare flat.', 'Glue and clamp.'],
  },
  bridle: {
    label: 'Bridle joint',
    skill: 'intermediate',
    strength: 4,
    needs: [['japanese-saw', 'chisels'], ['band-saw', 'chisels'], ['table-saw']],
    allowance: (t) => t,
    steps: ['Divide the thickness into thirds.', 'Cut the open slot and the matching tenon.', 'Glue and clamp.'],
  },
  'mortise-and-tenon': {
    label: 'Mortise and tenon',
    skill: 'advanced',
    strength: 5,
    needs: [
      ['hollow-chisel-mortiser', 'japanese-saw'],
      ['router', 'japanese-saw', 'chisels'],
      ['drill', 'chisels', 'mallet', 'japanese-saw'],
      ['chisels', 'mallet', 'japanese-saw'],
    ],
    allowance: (t) => Math.min(30, Math.round((t * 2) / 3)),
    steps: [
      'Lay out the mortise one third of the tenon part thickness wide, centred.',
      'Chop or rout the mortise a little deeper than the tenon is long.',
      'Saw the tenon cheeks and shoulders, then pare to a snug fit.',
      'Dry fit, then glue and clamp.',
    ],
  },
  'box-joint': {
    label: 'Box joint',
    skill: 'advanced',
    strength: 4,
    needs: [['table-saw', 'dado-stack'], ['router', 'router-table'], ['japanese-saw', 'chisels']],
    allowance: none,
    steps: ['Cut evenly spaced fingers on both parts with a jig.', 'Glue and clamp.'],
  },
  dovetail: {
    label: 'Dovetails',
    skill: 'advanced',
    strength: 5,
    needs: [['japanese-saw', 'chisels', 'mallet', 'marking-gauge'], ['router', 'dovetail-jig']],
    allowance: none,
    steps: ['Gauge the baseline on both parts.', 'Saw and chop the tails, then mark the pins from them.', 'Saw and chop the pins, test fit, glue.'],
  },
  miter: {
    label: 'Miter',
    skill: 'intermediate',
    strength: 1,
    needs: [['miter-saw'], ['table-saw'], ['japanese-saw']],
    allowance: none,
    steps: ['Cut both ends at 45 degrees.', 'Glue, clamp with a band clamp, reinforce with pins if needed.'],
  },
  'splined-miter': {
    label: 'Splined miter',
    skill: 'advanced',
    strength: 3,
    needs: [['table-saw'], ['router', 'router-table']],
    allowance: none,
    steps: ['Cut the miters.', 'Cut slots across each corner.', 'Glue in contrasting splines and trim flush.'],
  },
};

export type PickReason = 'chosen' | 'design' | 'skill' | 'tools' | 'fallback';

export interface JointChoice {
  joint: Joint;
  type: JointType;
  reason: PickReason;
  /** All types the maker could choose from for this joint. */
  options: JointType[];
}

/**
 * Pick the joint to build. A maker's explicit choice wins. Otherwise use the
 * design's joint if it suits their skill and tools, else the strongest
 * alternative that does.
 */
export function chooseJoint(joint: Joint, workshop: Workshop): JointChoice {
  const options = [joint.type, ...joint.alternatives.filter((t) => t !== joint.type)];
  if (joint.chosen) return { joint, type: joint.chosen, reason: 'chosen', options };

  const owned = workshop.tools ? new Set(workshop.tools) : undefined;
  const skillOk = (t: JointType) => SKILL_RANK[JOINTS[t].skill] <= SKILL_RANK[workshop.skill];
  const toolsOk = (t: JointType) => canDo(JOINTS[t].needs, owned);

  if (skillOk(joint.type) && toolsOk(joint.type)) return { joint, type: joint.type, reason: 'design', options };

  const byStrength = [...options].sort((a, b) => JOINTS[b].strength - JOINTS[a].strength);
  const fits = byStrength.find((t) => skillOk(t) && toolsOk(t));
  if (fits) return { joint, type: fits, reason: skillOk(joint.type) ? 'tools' : 'skill', options };

  // Nothing fits both. Prefer one within skill (they can buy a tool), else the easiest.
  const withinSkill = byStrength.find(skillOk);
  if (withinSkill) return { joint, type: withinSkill, reason: 'fallback', options };
  const easiest = [...options].sort((a, b) => SKILL_RANK[JOINTS[a].skill] - SKILL_RANK[JOINTS[b].skill])[0]!;
  return { joint, type: easiest, reason: 'fallback', options };
}

export function jointTools(type: JointType, owned: ReadonlySet<string> | undefined) {
  return bestOption(JOINTS[type].needs, owned);
}
