const ORDER_TOKEN_RE = /^(order|order_rate)(==|!=|>=|<=|>|<)(\d+)$/;
const ORDER_CONTINUE_RE = /^order_rate_(in|out)(\d+)_continue==1$/;

/**
 * Positions allowed by the order/order_rate tokens in one '&'-joined condition group, using the
 * same position mapping as the engine's order filters. Returns null when the group has no
 * position conditions at all.
 */
function allowedPositionsForGroup(group: string, numUmas: number): Set<number> | null {
  let allowed: Set<number> | null = null;

  for (const token of group.split('&')) {
    let constraint: ((pos: number) => boolean) | null = null;

    const order = ORDER_TOKEN_RE.exec(token);
    if (order) {
      const bound =
        order[1] === 'order' ? Number(order[3]) : Math.round((numUmas * Number(order[3])) / 100);
      const op = order[2];
      constraint =
        op === '=='
          ? (pos) => pos === bound
          : op === '!='
            ? (pos) => pos !== bound
            : op === '>='
              ? (pos) => pos >= bound
              : op === '<='
                ? (pos) => pos <= bound
                : op === '>'
                  ? (pos) => pos > bound
                  : (pos) => pos < bound;
    } else {
      const cont = ORDER_CONTINUE_RE.exec(token);
      if (cont) {
        const bound = Math.round((Number(cont[2]) / 100) * numUmas);
        constraint = cont[1] === 'in' ? (pos) => pos <= bound : (pos) => pos >= bound;
      }
    }

    if (!constraint) continue;

    const next = new Set<number>();
    for (let pos = 1; pos <= numUmas; pos++) {
      if ((allowed === null || allowed.has(pos)) && constraint(pos)) next.add(pos);
    }
    allowed = next;
  }

  return allowed;
}

type SkillAlternativeLike = { precondition?: string; condition: string };

/**
 * Field positions worth probing individually when the default position band fails: the union of
 * positions allowed by each position-conditioned '@' group. Groups without position conditions
 * are ignored — they are unaffected by the assumed position, so if they didn't trigger under the
 * default band they never will. Deriving the set from the raw conditions (rather than probing all
 * positions) avoids probes that only pass because the engine deliberately relaxes forward order
 * conditions in the last leg, which would draw misleading last-leg-only windows.
 */
export function candidateScanPositions(
  alternatives: Array<SkillAlternativeLike>,
  numUmas: number
): Array<number> {
  const candidates = new Set<number>();

  for (const alternative of alternatives) {
    let preAllowed: Set<number> | null = null;
    if (alternative.precondition) {
      let union: Set<number> | null = null;
      let unrestricted = false;
      for (const group of alternative.precondition.split('@')) {
        const allowed = allowedPositionsForGroup(group, numUmas);
        if (allowed === null) {
          unrestricted = true;
          break;
        }
        union = union ? new Set([...union, ...allowed]) : allowed;
      }
      if (!unrestricted) preAllowed = union;
    }

    for (const group of alternative.condition.split('@')) {
      const allowed = allowedPositionsForGroup(group, numUmas) ?? preAllowed;
      if (allowed === null) continue;
      for (const pos of allowed) {
        if (preAllowed === null || preAllowed.has(pos)) candidates.add(pos);
      }
    }
  }

  return [...candidates].sort((a, b) => a - b);
}
