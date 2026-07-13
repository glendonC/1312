---
title: Homophone miss on ko-clip-01
description: "error_type=homophone. Stub EN guessed a fluent wrong person name; meaning inverted on a hard line."
date: 2026-07-16
type: failure
draft: true
clip: ko-clip-01
run: run-002
---

First Translate stub on `ko-clip-01` / `run-002` produced a catastrophic fluent miss.

Logged correction row (schema from Architecture):

```json
{
  "source_video": "ko-clip-01",
  "t_start": 18.2,
  "t_end": 21.0,
  "raw": "…",
  "final": "…",
  "error_type": "homophone",
  "lang": "en"
}
```

What broke:

- Homophone pair collapsed into the wrong proper noun
- EN read fluent; hard-line meaning fail (person identity)
- No glossary hit; no QC withhold

Also saw a secondary `boundary` candidate on the same turn (segment cut mid-phrase). Primary tag for this note: **homophone**.

Action queued: glossary seed for clip entities + QC gate that fails closed when entity confidence is junk. Failure stays first-class; we do not rewrite it as a soft “learning moment.”
