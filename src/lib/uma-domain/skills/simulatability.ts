/**
 * Skill simulatability validation.
 *
 * Determines whether a skill's condition strings can be fully parsed by the
 * current simulation engine. Skills with unknown condition tokens would crash
 * the parser at runtime, so we validate upfront and tag them.
 *
 * This is intentionally derived at runtime from the condition map — when we
 * add support for a new condition token, skills using it automatically become
 * simulatable without any data changes.
 */

import { knownConditionTokens } from './parser/conditions/conditions';
import { supportedSimulatableValueUsages } from './value-scaling/registry';
import type { SkillAlternative } from './skill.types';

export type UnsupportedSkillMechanic =
  | { kind: 'condition-token'; token: string }
  | { kind: 'value-usage'; usage: number };

/**
 * Extract identifier tokens from a condition string.
 *
 * Mirrors the parser's tokenizer: identifiers are sequences of [a-z0-9_]
 * starting with a letter. Numbers, operators (==, !=, <, >, &, @) are excluded.
 */
export function extractConditionTokens(condition: string): Array<string> {
  if (!condition) return [];

  const tokens: Array<string> = [];
  let i = 0;

  while (i < condition.length) {
    const ch = condition.charCodeAt(i);

    // Skip digits (integer literals)
    if (ch >= 48 && ch <= 57) {
      while (
        i < condition.length &&
        condition.charCodeAt(i) >= 48 &&
        condition.charCodeAt(i) <= 57
      ) {
        i++;
      }
      continue;
    }

    // Identifier: starts with a-z, continues with a-z, 0-9, _
    if (ch >= 97 && ch <= 122) {
      const start = i;
      while (i < condition.length) {
        const c = condition.charCodeAt(i);
        if (
          (c >= 97 && c <= 122) || // a-z
          (c >= 48 && c <= 57) || // 0-9
          c === 95 // _
        ) {
          i++;
        } else {
          break;
        }
      }
      tokens.push(condition.slice(start, i));
      continue;
    }

    // Skip everything else (operators, whitespace)
    i++;
  }

  return tokens;
}

/**
 * Check whether a single condition string is simulatable — all its tokens
 * are recognized by the current condition parser.
 */
export function isConditionSimulatable(condition: string): boolean {
  if (!condition) return true;

  const tokens = extractConditionTokens(condition);

  for (const token of tokens) {
    if (!knownConditionTokens.has(token)) {
      return false;
    }
  }

  return true;
}

/**
 * Check whether all alternatives of a skill are simulatable.
 *
 * A skill is simulatable if every condition and precondition string across
 * all its alternatives contains only known condition tokens.
 */
export function areAlternativesSimulatable(alternatives: Array<SkillAlternative>): boolean {
  return findUnsupportedSkillMechanics(alternatives).length === 0;
}

/**
 * Find unknown condition tokens across a skill's alternatives.
 * Returns an empty array if all tokens are recognized.
 */
export function findUnknownConditionTokens(alternatives: Array<SkillAlternative>): Array<string> {
  const unknown = new Set<string>();

  for (const alt of alternatives) {
    for (const token of extractConditionTokens(alt.condition)) {
      if (!knownConditionTokens.has(token)) {
        unknown.add(token);
      }
    }
    if (alt.precondition) {
      for (const token of extractConditionTokens(alt.precondition)) {
        if (!knownConditionTokens.has(token)) {
          unknown.add(token);
        }
      }
    }
  }

  return Array.from(unknown);
}

/** Return every unsupported condition token and value-scaling policy in a skill. */
export function findUnsupportedSkillMechanics(
  alternatives: Array<SkillAlternative>
): Array<UnsupportedSkillMechanic> {
  const mechanics: Array<UnsupportedSkillMechanic> = findUnknownConditionTokens(alternatives).map(
    (token) => ({ kind: 'condition-token', token })
  );

  for (const alternative of alternatives) {
    for (const effect of alternative.effects) {
      const usage = effect.valueUsage ?? 1;
      if (!supportedSimulatableValueUsages.has(usage)) {
        mechanics.push({ kind: 'value-usage', usage });
      }
    }
  }

  return mechanics;
}
