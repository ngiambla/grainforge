// Export a plan as a PDF. Loaded on demand so the main page stays small.

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { formatLength, type Project, type UnitSystem } from '../format';
import { buildSteps, JOINTS, methodName, type Plan } from '../plan';

const REASON: Record<string, string> = {
  chosen: 'Your choice',
  design: 'As designed',
  skill: 'Easier option for your skill level',
  tools: 'Works with the tools you have',
  fallback: 'Closest fit; see the tool list',
};

export function exportPdf(project: Project, plan: Plan, image: string | null): Blob {
  const units = project.units as UnitSystem;
  const fmt = (mm: number) => formatLength(mm, units);
  const doc = new jsPDF({ unit: 'mm', format: units === 'imperial' ? 'letter' : 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;
  const accent: [number, number, number] = [154, 91, 42];
  let y = M;

  const heading = (text: string) => {
    if (y > H - 40) {
      doc.addPage();
      y = M;
    }
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...accent).text(text, M, y + 5);
    doc.setTextColor(0);
    y += 10;
  };
  const para = (text: string, size = 10) => {
    doc.setFont('helvetica', 'normal').setFontSize(size);
    const lines = doc.splitTextToSize(text, W - 2 * M) as string[];
    for (const line of lines) {
      if (y > H - M) {
        doc.addPage();
        y = M;
      }
      doc.text(line, M, y + 4);
      y += size * 0.45;
    }
    y += 1.5;
  };
  const table = (head: string[], body: (string | number)[][]) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: M, right: M },
      styles: { fontSize: 9, cellPadding: 1.8 },
      headStyles: { fillColor: accent },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  };

  // Cover.
  doc.setFont('helvetica', 'bold').setFontSize(22).text(project.meta.name || 'Untitled project', M, y + 8);
  y += 14;
  if (project.meta.description) para(project.meta.description, 11);
  para(
    `Overall: ${fmt(plan.overall.width)} wide × ${fmt(plan.overall.depth)} deep × ${fmt(plan.overall.height)} high. ` +
      `Skill level: ${project.workshop.skill}.`,
    11,
  );
  if (image) {
    const iw = W - 2 * M;
    const ih = iw * 0.75;
    doc.addImage(image, 'PNG', M, y, iw, ih);
    y += ih + 4;
  }
  doc.setFontSize(8).setTextColor(120);
  doc.text(`Made with GrainForge on ${new Date().toLocaleDateString()}. Check every measurement before you cut.`, M, H - 8);
  doc.setTextColor(0);

  doc.addPage();
  y = M;
  if (plan.warnings.length) {
    heading('Check before you start');
    for (const w of plan.warnings) para(`• ${w}`);
  }
  if (plan.adaptations.length) {
    heading('Adjusted for your tools');
    for (const a of plan.adaptations) para(`• ${a}`);
  }

  heading('Shopping list');
  table(
    ['Material', 'Thickness', 'Buy'],
    plan.materials.map((m) => [
      m.material.name + (m.material.nominal ? ` (${m.material.nominal})` : ''),
      fmt(m.material.thickness),
      m.buy.map((b) => `${b.count} × ${fmt(b.length)} × ${fmt(b.width)}`).join('\n'),
    ]),
  );

  heading('Tools');
  table(
    project.workshop.tools ? ['Tool', 'Used for', 'Have it?'] : ['Tool', 'Used for'],
    plan.tools.map((t) => {
      const row = [t.name, t.for.join(', ')];
      if (project.workshop.tools) row.push(t.owned ? 'Yes' : 'Need');
      return row;
    }),
  );

  heading('Cut list');
  table(
    ['Part', 'Qty', 'Finished (L × W × T)', 'Cut to (L × W)', 'Cut with', 'Material', 'Notes'],
    plan.cutList.map((r) => [
      r.name,
      r.quantity,
      `${fmt(r.length)} × ${fmt(r.width)} × ${fmt(r.thickness)}`,
      `${fmt(r.cutLength)} × ${fmt(r.cutWidth)}${r.strips > 1 ? ` (×${r.strips})` : ''}${r.layers > 1 ? ` (${r.layers} layers)` : ''}`,
      [r.rip && `Rip: ${methodName(r.rip)}`, methodName(r.crosscut)].filter(Boolean).join('\n'),
      r.buyAs.name,
      r.notes.join('; '),
    ]),
  );

  heading('Joinery');
  const partName = new Map(plan.parts.map((p) => [p.id, p.name]));
  table(
    ['Joint', 'Parts', 'Why', 'Other options'],
    plan.joints.map((c) => [
      JOINTS[c.type].label,
      c.joint.parts.map((id) => partName.get(id) ?? id).join(' + '),
      REASON[c.reason] ?? '',
      c.options.filter((t) => t !== c.type).map((t) => `${JOINTS[t].label} (${JOINTS[t].skill})`).join(', '),
    ]),
  );

  // Cutting diagrams.
  doc.addPage();
  y = M;
  heading('Cutting diagrams');
  para('Grain runs left to right. Rip strips to width first, then crosscut. Pieces include saw kerf spacing.', 9);
  for (const m of plan.materials) {
    doc.setFont('helvetica', 'bold').setFontSize(11).text(`${m.material.name} (${fmt(m.material.thickness)})`, M, y + 4);
    y += 7;
    const maxLen = Math.max(...m.boards.map((b) => b.length));
    const scale = (W - 2 * M) / maxLen;
    m.boards.forEach((b, i) => {
      const bh = Math.max(b.width * scale, 6);
      if (y + bh + 10 > H - M) {
        doc.addPage();
        y = M;
      }
      doc.setFont('helvetica', 'normal').setFontSize(8).text(`${m.material.kind === 'sheet' ? 'Sheet' : 'Board'} ${i + 1}: ${fmt(b.length)} × ${fmt(b.width)}${b.oversize ? ' (larger than stock)' : ''}`, M, y + 3);
      y += 4.5;
      doc.setDrawColor(150).setFillColor(245, 238, 228).rect(M, y, b.length * scale, b.width * scale, 'FD');
      for (const p of b.pieces) {
        const px = M + p.x * scale;
        const py = y + p.y * scale;
        doc.setFillColor(214, 170, 120).rect(px, py, p.length * scale, p.width * scale, 'FD');
        if (p.width * scale > 3 && p.length * scale > 12) {
          const fs = Math.min(7, p.width * scale * 2);
          doc.setFontSize(fs).setTextColor(40);
          const label = doc.splitTextToSize(p.label, p.length * scale - 1)[0] as string;
          doc.text(label, px + 1, py + Math.min(p.width * scale, 8) / 2 + fs * 0.15);
          doc.setTextColor(0);
        }
      }
      y += bh + 5;
    });
    y += 4;
  }

  // Build steps.
  doc.addPage();
  y = M;
  heading('Build steps');
  buildSteps(plan, fmt).forEach((s, i) => {
    doc.setFont('helvetica', 'bold').setFontSize(11);
    if (y > H - 25) {
      doc.addPage();
      y = M;
    }
    doc.text(`${i + 1}. ${s.title}`, M, y + 4);
    y += 7;
    for (const d of s.details) para(`• ${d}`);
    y += 2;
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(8).setTextColor(120);
    doc.text(`${project.meta.name} · page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc.output('blob');
}
