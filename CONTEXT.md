# Domain Context

## Glossary

### Runner (Uma)

A character (umamusume) identified by a base ID. Each runner has one or more **outfits**.

### Outfit

A specific variant of a runner, identified by an outfit ID (e.g. `100101`). Each outfit has an **epithet** (e.g. "[Special Dreamer]") and its own set of **innate aptitudes**.

### Innate Aptitudes

The base aptitude grades (S, A, B, C, D, E, F, G) that a runner outfit ships with, before any training modifications. Organized into three categories:

- **Track:** Turf, Dirt
- **Distance:** Sprint, Mile, Medium, Long
- **Style:** Front Runner, Pace Chaser, Late Surger, End Closer

These are distinct from **trained aptitudes**, which are the values a user manually sets on a runner card after training.

### Aptitude Grade

A letter grade from S (best) to G (worst) representing proficiency in a track, distance, or style category. Numerically encoded as S=0 through G=7 in the simulation engine (lower is better), but displayed and filtered as letter grades.

### Value Scaling Policy

How an effect's runtime value is derived from its base modifier, identified by `valueUsage`. The names mirror the game enum and Rust `ValueScalingPolicy`: `Direct` (1/none), `MultiplyRandom` (8/9), and `MultiplyActivateSpecificTagSkillCount` (14).

### Special Scaling

Any Value Scaling Policy other than Direct.

### Green skill

A skill whose master-data tags include 601–615. Usage 14 counts activated green skills: 0–2→0×, 3–4→1×, 5→2×, 6+→3× (see `docs/mechanics/README.md`, “MultiplyActivateSpecificTagSkillCount (14)”).
