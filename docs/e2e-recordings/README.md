# Exploratory session recordings

Provenance for the Playwright suite in `e2e/`. Each spec cites the step numbers from `carat-calculator-session.log` that it was transcribed from.

| File | Tracked | What it is |
| --- | --- | --- |
| `carat-calculator-session.log` | yes | Transcript of a 24-step agent-browser pass over `/carat-calculator`, with the assertion output of each step |
| `carat-calculator-session.webm` | no (gitignored) | Screen recording of the same pass |

The video is deliberately kept out of git history — it is a one-time artifact, and the log plus the specs carry everything durable. Re-record with:

```bash
agent-browser record start docs/e2e-recordings/carat-calculator-session.webm
# ... drive the app ...
agent-browser record stop
```

## What the pass established

Two defects surfaced, both in the exploration script rather than the app:

- A drag whose grab point sat below the fold silently did nothing. The Playwright version scrolls the handle into view first, which `boundingBox()` handles automatically.
- "New plan" opens a name dialog rather than creating a plan immediately, so a click alone left the plan list unchanged.

No application defects were found. Every behaviour the pass exercised is now asserted in `e2e/`.
