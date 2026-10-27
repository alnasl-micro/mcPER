// Evaluation of ePER applicability patterns such as
//   CC1.1,CC1.2+CMBBZ+!40Q+!407+ECOCF4+(LL0,LL2,LL4)
// "," = OR, "+" = AND, "!" = NOT, parentheses group.
// Ported from openPER's ExpressionEvaluater (commit 8194551) and PatternMatchHelper.

export const TRUE = 'yes';
export const FALSE = 'no';
export const MAYBE = 'maybe';

const OPERATORS = new Set(['(', ')', '+', ',', '!']);
const MAX_ENUMERATED_UNKNOWNS = 14;

export function tokenize(pattern) {
  const tokens = [];
  let symbol = '';
  for (const c of pattern.replace(/[\s|]/g, '')) {
    if (OPERATORS.has(c)) {
      if (symbol) tokens.push(symbol);
      symbol = '';
      tokens.push(c);
    } else {
      symbol += c;
    }
  }
  if (symbol) tokens.push(symbol);
  return tokens;
}

export function symbolsOf(pattern) {
  return [...new Set(tokenize(pattern).filter((t) => !OPERATORS.has(t)))];
}

// Recursive descent with precedence ! > + > ,
function parse(tokens) {
  let i = 0;
  const parseOr = () => {
    const terms = [parseAnd()];
    while (tokens[i] === ',') { i++; terms.push(parseAnd()); }
    return terms.length === 1 ? terms[0] : { op: 'or', terms };
  };
  const parseAnd = () => {
    const terms = [parseNot()];
    while (tokens[i] === '+') { i++; terms.push(parseNot()); }
    return terms.length === 1 ? terms[0] : { op: 'and', terms };
  };
  const parseNot = () => {
    if (tokens[i] === '!') { i++; return { op: 'not', term: parseNot() }; }
    if (tokens[i] === '(') {
      i++;
      const inner = parseOr();
      if (tokens[i] !== ')') throw new Error('Unbalanced parentheses');
      i++;
      return inner;
    }
    const t = tokens[i++];
    if (t === undefined || OPERATORS.has(t)) throw new Error(`Unexpected token ${t}`);
    return { op: 'sym', name: t };
  };
  const tree = parseOr();
  if (i !== tokens.length) throw new Error(`Unexpected token ${tokens[i]}`);
  return tree;
}

function evalTree(node, value) {
  switch (node.op) {
    case 'sym': return value(node.name);
    case 'not': return !evalTree(node.term, value);
    case 'and': return node.terms.every((t) => evalTree(t, value));
    case 'or': return node.terms.some((t) => evalTree(t, value));
  }
}

// Kleene three-valued logic; used when there are too many unknowns to enumerate.
function evalKleene(node, value) {
  switch (node.op) {
    case 'sym': return value(node.name);
    case 'not': { const v = evalKleene(node.term, value); return v === MAYBE ? MAYBE : v === TRUE ? FALSE : TRUE; }
    case 'and': {
      const vs = node.terms.map((t) => evalKleene(t, value));
      return vs.includes(FALSE) ? FALSE : vs.includes(MAYBE) ? MAYBE : TRUE;
    }
    case 'or': {
      const vs = node.terms.map((t) => evalKleene(t, value));
      return vs.includes(TRUE) ? TRUE : vs.includes(MAYBE) ? MAYBE : FALSE;
    }
  }
}

// values: Map symbol -> true | false | null (null = unknown); missing symbols are false.
// Returns yes (true for every value of the unknowns), maybe (true for some), or no.
export function evaluate(pattern, values) {
  if (!pattern || !pattern.trim()) return TRUE;
  const tree = parse(tokenize(pattern));
  const unknowns = symbolsOf(pattern).filter((s) => values.get(s) === null);
  if (unknowns.length > MAX_ENUMERATED_UNKNOWNS) {
    return evalKleene(tree, (s) => {
      const v = values.get(s);
      return v === null ? MAYBE : v ? TRUE : FALSE;
    });
  }
  let anyTrue = false, anyFalse = false;
  for (let mask = 0; mask < 1 << unknowns.length; mask++) {
    const assigned = new Map(unknowns.map((s, b) => [s, (mask & (1 << b)) !== 0]));
    const result = evalTree(tree, (s) => (assigned.has(s) ? assigned.get(s) : values.get(s) === true));
    if (result) anyTrue = true; else anyFalse = true;
    if (anyTrue && anyFalse) return MAYBE;
  }
  return anyTrue ? TRUE : FALSE;
}

// "A+!B+C|D" -> Map { A: true, B: false, CD: true }
export function parseVehiclePattern(text) {
  const values = new Map();
  for (const raw of (text ?? '').replace(/[|\r\n\s]/g, '').split('+')) {
    if (!raw) continue;
    if (raw.startsWith('!')) values.set(raw.slice(1), false);
    else values.set(raw, true);
  }
  return values;
}

// VIN CARATT first, then any SINCOM (MVS) items not already present.
export function consolidate(vinPattern, sincomPattern) {
  const values = parseVehiclePattern(vinPattern);
  for (const [k, v] of parseVehiclePattern(sincomPattern)) if (!values.has(k)) values.set(k, v);
  return values;
}

/**
 * Evaluates a part/drawing pattern for a vehicle.
 * vehicle: { values: Map, precise: boolean, multiValueSymbols: Set }
 *  - precise: values come from the VIN's CARATT, so unknown symbols are false.
 *  - otherwise unknown symbols are unknown, except multi-value VMK options which are false.
 */
export function evaluateForVehicle(pattern, vehicle) {
  if (!pattern || !pattern.trim()) return TRUE;
  const symbols = symbolsOf(pattern);
  const values = new Map(vehicle.values);
  // CARATT often holds bare option numbers (008) while patterns use prefixed symbols (E008).
  for (const [k, v] of vehicle.values) {
    if (/^\d{3}$/.test(k)) {
      const m = symbols.find((s) => s.endsWith(k));
      if (m && !vehicle.values.has(m)) values.set(m, v);
    }
  }
  // Drive side: GS/GSX = left-hand, GD/GDX = right-hand. When the vehicle states one side,
  // the other is false; otherwise left-hand is assumed, as openPER does.
  // vehicle.drive ('L'/'R') overrides, like ePER's drive selector.
  const rhd = values.get('GDX') ?? values.get('GD');
  const lhd = values.get('GSX') ?? values.get('GS');
  const isRhd = vehicle.drive ? vehicle.drive === 'R'
    : rhd === true || lhd === false ? true : rhd === false || lhd === true ? false : null;
  for (const [s, side] of [['GS', false], ['GSX', false], ['GD', true], ['GDX', true]]) {
    if (values.has(s) && !vehicle.drive) continue;
    if (isRhd !== null) values.set(s, isRhd === side);
    else if (!side) values.set(s, true);
  }
  if (!vehicle.precise) {
    for (const s of symbols) {
      if (!values.has(s)) values.set(s, vehicle.multiValueSymbols?.has(s) ? false : null);
    }
  }
  try {
    return evaluate(pattern, values);
  } catch {
    // Err on the side of showing the item, as ePER does.
    return MAYBE;
  }
}
