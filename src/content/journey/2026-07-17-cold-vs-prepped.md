---
title: Cold vs prepped on fixed clip
description: "Same audio, two paths. Prepped pack ahead on hard lines; Benchmarks table still placeholder until scores freeze."
date: 2026-07-17
type: score
draft: false
clip: ko-clip-01
run: run-003
delta: "cold 0.33 → prep 0.58 hard-line"
---

Protocol (frozen clip `ko-clip-01`):

1. **Cold** - one-shot ASR→MT, no swarm, no glossary
2. **Prepped** - stub swarm + glossary seed from `run-002` miss
3. Foil queued: YouTube KO auto-CC → EN auto-translate (capture not stamped yet)

Provisional hard-line hit rate (8 critical segments):

| Path | Hard-line hit | Notes |
|------|---------------|-------|
| Cold | 0.33 | Fluent wrong on person + number |
| Prepped (`run-003`) | 0.58 | Homophone line recovered; 2 music/BGM lines still fail |
| YouTube auto | - | pending date-stamped capture |

Delta on index: `cold 0.33 → prep 0.58 hard-line`. Numbers are provisional until Benchmarks freezes gold + scorer. Full table lives on [/benchmarks/](/benchmarks/).
