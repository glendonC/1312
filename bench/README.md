# Hard-KO Clip Pack bench

This directory is the evidence boundary for Benchmarks. The public page may render only what these artifacts can support.

Current evidence state: `hard-ko-v1` is frozen with three sourced clips, exact per-clip gold, and
six human adjudication receipts. run-007 has a post-freeze capture, human output labels, and one
re-derived `studio.bench.score.v1` receipt with `judge: null`. This is one scored capture, not
calibration, variance, generalization, or a positive result. The public aggregate under
`bench/examples/unscored-report.json` remains a protocol draft with no scored systems, so the
public page still cannot show a rank or superiority claim.

The gold-shaped file under `bench/examples/gold-drafts/` remains a non-authoritative dry run. It is
not the frozen pack gold and cannot enter a score receipt.

```text
bench/
  schemas/
    report.schema.json        # versioned public report contract
    capture.schema.json       # dated record of one run; scored/gold pinned unreachable
    gold.schema.json          # per-clip gold candidate; status pinned "candidate"
    adjudication.schema.json  # one blinded human decision, bound to exact candidate bytes
    ablation.schema.json      # result-free plan for one exact config delta on frozen bytes
  examples/
    unscored-report.json      # honest sample rendered by /benchmarks/
    gold-drafts/              # non-authoritative drafting-contract fixture; never pack gold
  prompts/
    gold-drafter-v1/          # content-addressed agent prompt + bound run-006 evidence
  ADJUDICATION.md             # blinded human worksheet and complete freeze handoff
  candidates/                 # mined miss manifests (studio.bench.candidates.v1)
  packs/<pack_id>/            # pack.json + per-clip gold + immutable freeze receipt
  reviews/                    # adjudication receipts and human output labels
  runs/                       # pinned captures (bench-pin.mjs)
  scores/                     # human-labelled score receipts (studio.bench.score.v1)
  ablations/<slug>/           # immutable result-free ablation registrations
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
| Draft | `scripts/draft-gold-from-candidates.mjs` + `bench/prompts/gold-drafter-v1/` | Schema drift; unstable/non-agent drafter id; copied English in `korean_gold`; missing/duplicate time windows; stale prompt, manifest, media, source, or schema bytes; a dry-run fixture entering `bench/packs/` |
| Adjudicate | `scripts/write-adjudication-receipt.mjs` + `bench/ADJUDICATION.md` | A hand-authored/divergent review id; candidate-byte drift; decisions not aligned to every gold time window; a declared Git identity different from the reviewer's checkout identity |
| Freeze | `scripts/freeze-pack.mjs` | Freezing without two blinded accept receipts per clip from reviewers with distinct declared names AND git identities, neither the drafter; a control clip mined from our own misses; a training-routed clip |
| Register | `scripts/register-ablation.mjs` | An unfrozen or byte-drifted pack; operator-authored ids or timestamps; more than one config leaf delta; fewer than three paired repetitions; non-null results or model judge; structural diagnostics with semantic authority |
| Score | `scripts/score-run.mjs` | Non-frozen or amended gold; a capture dated on or before the freeze day (pre-registration); an emitted line with no human label; a label for a line nothing emitted; any LLM judge (`judge` is pinned null) |
| Check | `scripts/check-bench.mjs` | Route conflicts; a memory proposal drawing on a pack or gold-routed clip (clip-level, not byte-level); a post-freeze capture without a score receipt (score-everything); stale or result-bearing ablation registrations; byte drift in anything a receipt bound |

Routing is exclusive and decided at mine time: a clip that may become bench gold contributes
nothing to glossary, rules, correction pairs, or future training exports — ever — and a clip
routed to training may never enter a pack. `bench/candidates/run-006/` is the first mined
manifest (routed gold, 13 candidates from 15 cues).

The versioned drafting prompt is `bench/prompts/gold-drafter-v1/prompt.md`; its companion
`manifest.json` content-binds the prompt, gold schema, candidates manifest, run evidence, ko-v3
registry, and source media. The materializer always validates `studio.bench.gold.v1`, pins
`status: "candidate"`, requires the stable `agent:gold-drafter-v1` identity, binds
`mined_from` to current manifest bytes, and writes immutably. The only produced example is
`bench/examples/gold-drafts/Ux-TMWnmntM.gold.json`, clearly marked as non-authoritative and
unreviewable because direct audio audition was unavailable here. A Korean-fluent audio-grounded
draft must replace machinery with human-checkable evidence before any pack transition.

Human reviewers follow `bench/ADJUDICATION.md`. The receipt helper uses the existing canonical
`bench-review:` id derivation and preserves `minutes_spent` as a measured number or `null`; it
does not infer decisions, fabricate time, freeze, or score.

Rule promotion is ablation-bound: `scripts/lib/memory-review.mjs` accepts a behavioral rule only
against a PAIR of scored reports on the identical frozen pack whose subject configs provably
differ by exactly the proposed rule (`config.rules` content ids), with the measured delta
recorded on the decision receipt. One scored report is not evidence about a rule.

**What still cannot happen, and why:** the committed raw-versus-eligible-stem registration contains
no outputs or results. It cannot select eligible clips after outcomes are known, omit absent variant
outputs, turn structural producer success into semantic quality, or establish variance from one
capture. The next packaging slice still needs at least three paired repetitions of every frozen
clip, every declared anonymous stem without best-stem selection, human labels for every emitted
line, score receipts for every capture, and honest missing or withheld outcomes where the stem-side
input is absent or ineligible. Later packs are still required before a generalization claim.

Two dating anchors are honest-but-incomplete in v1 and documented rather than pretended:
`frozen_at` is stamped by the tool (never operator-supplied) and cannot predate its adjudication
receipts, but it is not yet verified against git commit ancestry; and reviewer identity is
distinct-declared, not cryptographically proven. Both anchors harden the moment the receipts are
committed by their own authors, which is the working practice this repo expects.

## Check the sample

```sh
npm run bench:check
```

The check validates every report it discovers, every capture, every conveyor artifact, and every
ablation registration. Focused ablation tests reject forged ids, byte drift, premature timestamps,
multiple config deltas, low repetition, non-null judge or results, structural semantic authority,
best-stem selection, hidden ineligible outputs, and deletion of a committed registration. The
existing conveyor drills continue to reject invalid freezes, labels, routes, contamination, and
unscored post-freeze captures. Planned report slots cannot claim sources or annotations, system and
result states must agree, four-way outcomes must sum, and a zero-denominator rate remains `null`; it
never becomes zero.

The report is the public aggregate. Per-clip judgments, repeat-run detail, reviewer decisions,
and environment metadata stay in the linked score, review, output, and runtime artifacts so the
page can remain readable without weakening the audit trail.

The committed Studio replay under `public/demo/runs/run-005/` is a separate synthetic UI fixture. It must never be copied into this bench as real-media evidence.
