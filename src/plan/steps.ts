// A plain-language build order derived from the plan.

import { METHOD, methodName, STORE } from './adapt';
import { JOINTS } from './joinery';
import type { Plan } from './plan';

export interface BuildStep {
  title: string;
  details: string[];
}

export function buildSteps(plan: Plan, fmt: (mm: number) => string): BuildStep[] {
  const steps: BuildStep[] = [];
  steps.push({
    title: 'Get your materials',
    details: plan.materials.map((m) =>
      m.buy.map((b) => `${b.count} × ${m.material.name}, ${fmt(b.length)} long, ${fmt(b.width)} wide, ${fmt(m.material.thickness)} thick`).join('; '),
    ),
  });

  const milling: string[] = [];
  for (const r of plan.cutList) {
    if (r.layers > 1) milling.push(`${r.name}: glue ${r.layers} layers face to face, then plane to ${fmt(r.thickness)}.`);
    else if (r.planeTo) milling.push(`${r.name}: plane to ${fmt(r.thickness)} thick.`);
  }
  if (milling.length) steps.push({ title: 'Mill to thickness', details: milling });

  // tool -> verb -> part names
  const byTool = new Map<string, Map<string, string[]>>();
  const add = (tool: string, verb: string, name: string) => {
    const verbs = byTool.get(tool) ?? new Map<string, string[]>();
    verbs.set(verb, [...(verbs.get(verb) ?? []), name]);
    byTool.set(tool, verbs);
  };
  for (const r of plan.cutList) {
    if (r.rip) add(r.rip, 'rip to width', r.name);
    add(r.crosscut, r.buyAs.kind === 'sheet' ? 'cut from the sheet' : 'cut to length', r.name);
  }
  const cutting = [
    plan.cutList.some((r) => r.rip)
      ? 'Follow the cutting diagrams: rip each strip to width first, then crosscut to length. Label every piece in pencil as you cut it.'
      : 'Follow the cutting diagrams, and label every piece in pencil as you cut it.',
  ];
  for (const [tool, verbs] of byTool) {
    const lead = tool === STORE ? 'Have the store or lumberyard' : `With the ${methodName(tool).toLowerCase()},`;
    const tip = METHOD[tool] ?? '';
    const what = [...verbs].map(([verb, names]) => `${verb}: ${names.join('; ')}`).join('. ');
    cutting.push(`${lead} ${what}. ${tip.charAt(0).toUpperCase()}${tip.slice(1)}`.trim());
  }
  steps.push({ title: 'Cut pieces to rough size', details: cutting });

  const glueups = plan.cutList.filter((r) => r.strips > 1);
  if (glueups.length) {
    steps.push({
      title: 'Glue up panels',
      details: glueups.map(
        (r) => `${r.name}: edge-glue ${r.strips} strips, alternating growth rings, and let cure. Trim to ${fmt(r.length)} × ${fmt(r.width)}.`,
      ),
    });
  }

  const shaped = plan.parts.filter((p) => p.shape);
  if (shaped.length) {
    const carved = shaped.filter((p) => p.shape === 'carved');
    steps.push({
      title: 'Shape the parts',
      details: [
        `Draw or print the outline full size and trace it onto ${shaped.map((p) => p.name).join(', ')}, with the grain running along the longest, thinnest section.`,
        'Saw just outside the line with a band saw, jigsaw or coping saw, then fair the curves with a rasp and sandpaper.',
        ...(carved.length
          ? [`Carve ${carved.map((p) => p.name).join(', ')} to shape: rough out with a knife or gouge, cutting downhill with the grain, then refine with a spokeshave or rasp.`]
          : []),
      ],
    });
  }

  steps.push({ title: 'Cut parts to final size', details: ['Cut each part to the finished sizes in the cut list. Cut lengths already include any tenons.'] });

  const byType = new Map<string, string[]>();
  for (const c of plan.joints) {
    const names = c.joint.parts.map((id) => plan.parts.find((p) => p.id === id)?.name ?? id).join(' + ');
    const list = byType.get(c.type) ?? [];
    list.push(names);
    byType.set(c.type, list);
  }
  for (const [type, where] of byType) {
    const info = JOINTS[type as keyof typeof JOINTS];
    steps.push({ title: `Cut the joinery: ${info.label.toLowerCase()}`, details: [...info.steps, `Where: ${where.join('; ')}.`] });
  }

  steps.push({
    title: 'Dry fit, then assemble',
    details: [
      'Assemble everything without glue to check the fit and that the piece sits square.',
      'Sand inside faces now. They are hard to reach later.',
      'Glue up in stages: sub-assemblies first, then the whole piece. Measure the diagonals to check for square.',
    ],
  });
  steps.push({ title: 'Sand and finish', details: ['Sand through the grits to 180 or 220.', 'Apply your finish of choice.'] });
  return steps;
}
