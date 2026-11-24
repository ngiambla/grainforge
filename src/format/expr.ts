// A tiny, safe arithmetic expression language for parametric dimensions.
//
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | atom
//   atom   := number | ident | ident '(' expr (',' expr)* ')' | '(' expr ')'
//
// Identifiers refer to project parameters. The only functions are min, max
// and round. Nothing is ever passed to eval().

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr }
  | { kind: 'call'; fn: FnName; args: Expr[] };

const FUNCTIONS = {
  min: (...xs: number[]) => Math.min(...xs),
  max: (...xs: number[]) => Math.max(...xs),
  round: (x: number) => Math.round(x),
} as const;
type FnName = keyof typeof FUNCTIONS;

export class ExprError extends Error {}

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`Bad number at position ${i}`);
      out.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
    } else if ('+-*/(),'.includes(c)) {
      out.push({ t: 'op', v: c, pos: i });
      i++;
    } else {
      throw new ExprError(`Unexpected character '${c}' at position ${i}`);
    }
  }
  return out;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const tk = toks[p];
    return tk !== undefined && tk.t === 'op' && tk.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected '${v}' in "${src}"`);
    p++;
  };

  function expr(): Expr {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: '+' | '-' }).v;
      left = { kind: 'bin', op, left, right: term() };
    }
    return left;
  }
  function term(): Expr {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: '*' | '/' }).v;
      left = { kind: 'bin', op, left, right: unary() };
    }
    return left;
  }
  function unary(): Expr {
    if (isOp('-')) {
      p++;
      return { kind: 'neg', arg: unary() };
    }
    return atom();
  }
  function atom(): Expr {
    const tk = peek();
    if (!tk) throw new ExprError(`Unexpected end of "${src}"`);
    if (tk.t === 'num') {
      p++;
      return { kind: 'num', value: tk.v };
    }
    if (tk.t === 'id') {
      p++;
      if (isOp('(')) {
        if (!(tk.v in FUNCTIONS)) throw new ExprError(`Unknown function '${tk.v}'`);
        p++;
        const args = [expr()];
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
        expect(')');
        return { kind: 'call', fn: tk.v as FnName, args };
      }
      return { kind: 'ref', name: tk.v };
    }
    if (isOp('(')) {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    throw new ExprError(`Unexpected '${tk.v}' at position ${tk.pos} in "${src}"`);
  }

  const result = expr();
  if (p < toks.length) {
    throw new ExprError(`Unexpected '${toks[p]!.v}' at position ${toks[p]!.pos} in "${src}"`);
  }
  return result;
}

/** Names of all parameters an expression refers to. */
export function references(e: Expr, into = new Set<string>()): Set<string> {
  switch (e.kind) {
    case 'ref':
      into.add(e.name);
      break;
    case 'neg':
      references(e.arg, into);
      break;
    case 'bin':
      references(e.left, into);
      references(e.right, into);
      break;
    case 'call':
      e.args.forEach((a) => references(a, into));
      break;
  }
  return into;
}

export function evaluate(e: Expr, scope: Readonly<Record<string, number>>): number {
  switch (e.kind) {
    case 'num':
      return e.value;
    case 'ref': {
      const v = scope[e.name];
      if (v === undefined) throw new ExprError(`Unknown parameter '${e.name}'`);
      return v;
    }
    case 'neg':
      return -evaluate(e.arg, scope);
    case 'bin': {
      const a = evaluate(e.left, scope);
      const b = evaluate(e.right, scope);
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new ExprError('Division by zero');
          return a / b;
      }
    }
    // falls through (unreachable)
    case 'call':
      return (FUNCTIONS[e.fn] as (...xs: number[]) => number)(
        ...e.args.map((a) => evaluate(a, scope)),
      );
  }
}

/** A dimension is either a literal number (mm) or an expression string. */
export function evalDimension(d: number | string, scope: Readonly<Record<string, number>>): number {
  return typeof d === 'number' ? d : evaluate(parseExpr(d), scope);
}
