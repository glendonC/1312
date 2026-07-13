---
title: First 45s Korean clip through stub swarm
description: "Stub orchestrator opened one workspace, scrubbed a hard dialogue clip, and returned structured placeholders. Coverage incomplete."
date: 2026-07-15
type: experiment
draft: true
clip: ko-clip-01
run: run-001
---

Clip: `ko-clip-01` (~45s, two-speaker variety dialogue, light BGM).

Stub path:

- Orchestrator inspect → spawn Segment stub only (no Context / Translate+QC yet)
- Worker scrubbed timestamps in a single squircle
- Reported up timed KO stubs + empty EN slots

Observed:

| Artifact | Result |
|----------|--------|
| `captions.json` | KO lines partial; EN null |
| `corrections.json` | empty |
| `score.json` | not written |
| Coverage timed ko+en | ~0.35 KO only |

Null result is intentional: prove report-up shape before quality. Next: Translate+QC worker and a hard-line set for this clip.
