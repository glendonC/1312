---
title: QC gate fails closed on low entity confidence
description: "Decision: withhold EN on junk entity confidence instead of emitting fluent wrong. Spawn Translate+QC as a required pair after Segment."
date: 2026-07-18
type: decision
draft: false
clip: ko-clip-01
run: run-004
---

Spawn / QC policy change after the `homophone` miss:

1. **Spawn:** after Segment, always spawn Translate+QC as a pair (not Translate alone).
2. **QC gate:** if proper-noun / entity confidence is below threshold, **withhold** the EN line (coverage gap) rather than ship wrong-fluent text.
3. **Report-up:** QC returns structured `{raw, final?, error_type?, withhold: bool}`  -  orchestrator merges; never invents a final when withheld.

Rationale: Build Week judges should see honest holes over confident mistakes. Fail closed matches Architecture security/product discipline.

Not decided yet: exact numeric threshold and whether music/`error_type=music` lines auto-withhold. Tracking in rules under `memory/rules/` once the folder lands.
