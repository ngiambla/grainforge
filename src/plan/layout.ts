// Pack cut pieces onto boards or sheets. Uses guillotine strip packing that
// matches how boards are usually cut: rip strips to width, then crosscut each
// strip into pieces. The grain always runs along the board's length.

import { KERF } from './stock';

export interface Piece {
  key: string;
  label: string;
  length: number;
  width: number;
}

export interface Placed extends Piece {
  x: number; // along the board's length
  y: number; // across its width
}

export interface Board {
  length: number;
  width: number;
  pieces: Placed[];
  /** True when a piece is longer than any stock length you can buy. */
  oversize: boolean;
}

interface Strip {
  y: number;
  width: number;
  used: number;
}

export function packPieces(pieces: Piece[], stockWidth: number, stockLengths: number[]): Board[] {
  const lengths = [...stockLengths].sort((a, b) => a - b);
  const maxLen = lengths[lengths.length - 1]!;
  const order = [...pieces].sort((a, b) => b.width - a.width || b.length - a.length);
  const boards: { board: Board; strips: Strip[]; usedWidth: number }[] = [];

  for (const p of order) {
    if (p.length > maxLen || p.width > stockWidth) {
      boards.push({
        board: { length: p.length, width: Math.max(p.width, stockWidth), pieces: [{ ...p, x: 0, y: 0 }], oversize: true },
        strips: [],
        usedWidth: Infinity,
      });
      continue;
    }
    let placed = false;
    for (const b of boards) {
      if (b.board.oversize) continue;
      for (const s of b.strips) {
        const x = s.used === 0 ? 0 : s.used + KERF;
        if (p.width <= s.width && x + p.length <= maxLen) {
          b.board.pieces.push({ ...p, x, y: s.y });
          s.used = x + p.length;
          placed = true;
          break;
        }
      }
      if (placed) break;
      const y = b.usedWidth === 0 ? 0 : b.usedWidth + KERF;
      if (y + p.width <= stockWidth) {
        b.strips.push({ y, width: p.width, used: p.length });
        b.usedWidth = y + p.width;
        b.board.pieces.push({ ...p, x: 0, y });
        placed = true;
        break;
      }
    }
    if (!placed) {
      boards.push({
        board: { length: maxLen, width: stockWidth, pieces: [{ ...p, x: 0, y: 0 }], oversize: false },
        strips: [{ y: 0, width: p.width, used: p.length }],
        usedWidth: p.width,
      });
    }
  }

  // Buy the shortest stock length that still holds each board's pieces.
  for (const b of boards) {
    if (b.board.oversize) continue;
    const need = Math.max(...b.strips.map((s) => s.used));
    b.board.length = lengths.find((l) => l >= need) ?? maxLen;
  }
  return boards.map((b) => b.board);
}

export function boardYield(b: Board): number {
  const used = b.pieces.reduce((sum, p) => sum + p.length * p.width, 0);
  return used / (b.length * b.width);
}
