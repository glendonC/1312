# Hard-KO Clip Pack bench

This directory is the evidence boundary for Benchmarks. The public page may render only what these artifacts can support.

Current state: **protocol draft with the conveyor tooling in place**. There are still no sourced benchmark clips, no drafted or adjudicated gold, no frozen pack, no captured foils, no reviewer labels, and no scores. What now exists in code is the machinery that refuses to let any of those appear dishonestly.

```text
bench/
  schemas/
    report.schema.json        # versioned public report contract
    capture.schema.json       # dated record of one run; scored/gold pinned unreachable
    gold.schema.json          # per-clip gold candidate; status pinned "candidate"
    adjudication.schema.json  # one blinded human decision, bound to exact candidate bytes
  examples/
    unscored-report.json      # honest sample rendered by /benchmarks/
  candidates/                 # mined miss manifests (studio.bench.candidates.v1)
  packs/<pack_id>/            # future pack.json + per-clip gold + freeze receipt
  reviews/                    # future adjudication receipts (two distinct humans per clip)
  runs/                       # pinned captures (bench-pin.mjs)
  scores/                     # future score receipts (studio.bench.score.v1)
```

## State progression

1. `protocol_draft` — slots and conditions may be planned; all sources, runs, and result values remain empty.
2. `gold_frozen` — real sources and all required gold exist; systems may now run without changing the test set.
3. `scored` — every compared system has raw outputs, configuration, reviewer labels, artifacts, and scores.

The page must not show ranks or superiority claims in the first two states.

Per-clip `source` objects deliberately use the same provenance shape emitted by
`scripts/ingest-clip.mjs` (`licence`, channel, source timecodes, measured duration,
and attribution). The benchmark may point at locally held media; publishing the
evidence does not imply permission to redistribute the media itself.

## Headline contract

Each system reports these outcomes separately:

- critical meaning: binary human pass count and denominator;
- critical units: correctly emitted, wrongly emitted, withheld, or missing;
- catastrophic emitted errors: count, rate, and emitted-content denominator;
- latency: instrumented time to first usable captions and complete pack.

There is deliberately no composite pack score. Coverage never stands alone.

## The miss-to-gold conveyor (RFC 0001)

Agents draft; humans decide; code freezes; nothing scores itself.

| Step | Tool | What it refuses |
|---|---|---|
| Mine | `scripts/mine-gold-candidates.mjs` | Mining without an explicit `--route gold\|training`; a candidate carrying gold text |
| Freeze | `scripts/freeze-pack.mjs` | Freezing without two blinded accept receipts per clip from reviewers with distinct declared names AND git identities, neither the drafter; a control clip mined from our own misses; a training-routed clip |
| Score | `scripts/score-run.mjs` | Non-frozen or amended gold; a capture dated on or before the freeze day (pre-registration); an emitted line with no human label; a label for a line nothing emitted; any LLM judge (`judge` is pinned null) |
| Check | `scripts/check-bench.mjs` | Route conflicts; a memory proposal drawing on a pack or gold-routed clip (clip-level, not byte-level); a post-freeze capture without a score receipt (score-everything); byte drift in anything a receipt bound |

Routing is exclusive and decided at mine time: a clip that may become bench gold contributes
nothing to glossary, rules, correction pairs, or future training exports — ever — and a clip
routed to training may never enter a pack. `bench/candidates/run-006/` is the first mined
manifest (routed gold, 13 candidates from 15 cues).

Rule promotion is ablation-bound: `scripts/lib/memory-review.mjs` accepts a behavioral rule only
against a PAIR of scored reports on the identical frozen pack whose subject configs provably
differ by exactly the proposed rule (`config.rules` content ids), with the measured delta
recorded on the decision receipt. One scored report is not evidence about a rule.

**What still cannot happen, and why:** nothing can freeze and nothing can score until a second
Korean-fluent human reviewer exists. Two receipts under one person's two names would satisfy the
string checks and be receipt theater; the check enforces distinct declared identities and the
documented expectation is that each reviewer commits their own receipts from their own git
identity. Recruiting that reviewer is the pipeline's binding constraint and is not solvable in
code.

Two dating anchors are honest-but-incomplete in v1 and documented rather than pretended:
`frozen_at` is stamped by the tool (never operator-supplied) and cannot predate its adjudication
receipts, but it is not yet verified against git commit ancestry; and reviewer identity is
distinct-declared, not cryptographically proven. Both anchors harden the moment the receipts are
committed by their own authors, which is the working practice this repo expects.

## Check the sample

```sh
npm run bench:check
```

The check validates every report it discovers, every capture, and every conveyor artifact, and
then runs fail-closed drills against synthetic fixtures in a temp directory — single-reviewer
freeze, same-identity freeze, drafter self-review, pre-registration violations, unlabelled
lines, unfrozen gold, route conflicts, contamination, unscored post-freeze captures — so each
guard is proven to fire on every run, before real gold exists. Planned slots cannot claim
sources or annotations, system and result states must agree, four-way outcomes must sum, and a
zero-denominator rate remains `null`; it never becomes zero.

The report is the public aggregate. Per-clip judgments, repeat-run detail, reviewer decisions,
and environment metadata stay in the linked score, review, output, and runtime artifacts so the
page can remain readable without weakening the audit trail.

The committed Studio replay under `public/demo/runs/run-005/` is a separate synthetic UI fixture. It must never be copied into this bench as real-media evidence.
