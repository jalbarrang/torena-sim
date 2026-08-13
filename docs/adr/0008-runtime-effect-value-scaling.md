# ADR-0008: Runtime Effect Value Scaling

## Status

Accepted

## Context

`ability_value_usage` changes the value of an individual effect at activation time. A skill may combine Direct effects with value-scaled effects, as Copano Rickey's `100981` does. Applying a multiplier to the whole skill would incorrectly scale its Direct effect, while resolving a targeted effect at each receiver can roll different values for an effect that the caster activated once.

The engine previously carried raw numeric usages on `SkillEffect`, and Recovery implemented usages 8 and 9 locally. This left no shared semantic policy boundary, allowed unsupported usages to pass through as Direct behavior, and did not carry the authoritative `skill_data.tag_id` data required for usage 14.

The mechanics reference defines usage 14 as a multiplier based on successfully activated skills carrying any tag from 601 through 615: 0–2 skills maps to 0×, 3–4 to 1×, 5 to 2×, and 6 or more to 3×.

## Decision

Normalize raw effect data into an effect specification whose value scaling is a typed semantic policy rather than a raw numeric usage. Resolve each specification exactly once at activation into a distinct resolved-effect value before applying it or routing it to targets.

Caster-owned policies resolve against the caster before routing. A random multiplier rolls once per effect activation from the caster RNG and every recipient receives that resolved modifier. Injected effects have no caster; only policies that do not require caster state may resolve there.

Carry parsed numeric `skill_data.tag_id` values through the extracted TypeScript data, WASM DTO, and Rust `Skill` model. Empty or malformed slash-delimited segments are excluded. Tags intentionally do not enter `fingerprintSkill`, so this initial tag migration does not revise historical `lastUpdated` values solely because tags were added.

Value scaling is separate from duration scaling (`abilityTimeUsage`), skill-level scaling (`valueLevelUsage`), and additional-activation or lifecycle behavior. Those policy families retain their own seams.

Only implemented value policies are simulatable. Unsupported policies never fall back to Direct behavior.

> **Amendment (unsupported-usage severity):** An unsupported usage originally rejected the entire skill at the WASM DTO boundary. It now drops only the offending effect, matching how an unmodeled effect *type* has always degraded, and the skill still simulates. Rejecting the skill failed the whole DTO conversion, so one unmodeled usage anywhere in a skill pool took every other skill down with it — and because a runner's unique is force-included in its obtained set, a runner whose unique carried one (Radiant Star `210061`, and most of the r5 uniques among the 35 affected skills) could not be simulated at all. The no-fallback-to-Direct rule is unchanged and is why the effect is dropped rather than coerced: coercing Radiant Star's usage-10 component to Direct would apply it as though every climax race had been won, inventing a value instead of omitting one. A *supported* usage on an effect type it cannot scale stays fatal — that is data contradicting itself, not a gap in our modeling.

## Consequences

- A mixed-policy skill preserves each effect's independent semantics.
- Resolved effects cannot be accidentally re-resolved by a routed target.
- `uma-sim-primitives` owns the resolver so race and vacuum engines share the same mechanics, preserving ADR-0005's dependency direction.
- Adding a new value usage requires an explicit policy and capability-gate update rather than a numeric special case. It widens what is modeled; it is not needed to keep a skill loadable.
- A skill carrying an unsupported usage is simulatable but *understated* — it contributes everything except the dropped effect. The `skillSupportReport` export names the affected skills and what each one lost, so a consumer can surface partial modeling rather than present incomplete results as complete.
- The consuming app's runtime simulatability gate (torena-hub, `openspec/specs/skill-simulatability`) treats an unsupported effect policy as a partial-modeling warning, not an exclusion; unknown condition tokens remain a hard gate.
