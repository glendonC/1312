# Hard-KO Clip Pack bench

- Document type: Evaluation-domain entry
- Lifecycle: Active
- Authority: Bench layout, commands, packs, and score artifacts in this directory
- Last verified: 2026-07-20
- Update when: Bench layout, commands, or artifact ownership changes

## In short

This folder is the **evidence boundary** for `/benchmarks/`. The public page may show only what
these artifacts support. Prose here is never stronger than packs, scores, and bound receipts.

- We freeze hard Korean clips, then score against receipted gold.
- Miss-to-gold machinery is real; a scored capture is not automatically a product win.
- The kinship / provider-authorized campaign is a **partial measurement**, not a self-improvement
  win, not deployment, and not independent blind QC.
- Conveyor invariants: [`docs/rfcs/0001-miss-to-gold-conveyor.md`](../docs/rfcs/0001-miss-to-gold-conveyor.md).

Open `/benchmarks/` after `npm run dev` for the public surface. Layout and current evidence detail
continue below.

## Evidence state and layout

This directory is the evidence boundary for Benchmarks. The public page may render only what these
artifacts can support. Capability rung U7 means conditional separation; see
[`docs/build-week/CAPABILITY_LADDER.md`](../docs/build-week/CAPABILITY_LADDER.md).

Current evidence state (verify against artifacts, not this paragraph alone): `hard-ko-v1` is frozen
with three sourced clips, exact per-clip gold, and six human adjudication receipts. run-007 has a
post-freeze capture, human output labels, and one re-derived `studio.bench.score.v1` receipt with
`judge: null`. This is one scored capture, not calibration, variance, generalization, or a positive
result. The public aggregate under `bench/examples/unscored-report.json` remains a protocol draft
with no scored systems, so the public page still cannot show a rank or superiority claim.

`hard-ko-provider-authorized-v1` is separately frozen. Its provider-authorized kinship campaign
spent all 18 registered slots once with zero retries. Fifteen provider calls produced captures and
execution attributions. The three `Ni5rBtowdnI` without-rule calls returned HTTP 200 but failed as
`provider_invalid_output`, so they have no capture or attribution and remain spent. The 15
successful captures have operator-authorized hackathon label receipts and score receipts with
`judge: null`. The label receipts declare `blinded: true`, but their notes explicitly disclaim
independent blind human semantic QC. Six structural pairs exist for c1 and c3. Qualification
refused before result materialization because the registration requires nine pairs. No accepted
rule, runtime deployment, or product improvement result exists. See the exact partial-grid
[campaign ledger](rule-changes/ko-kinship-address-context-provider-authorized/README.md). The
repository-wide bench gate validates the six pairs, then remains nonzero because the shared c3 clip
has a provider-pack score but no score receipt naming the separately frozen `hard-ko-v1` pack.

The registered raw-versus-eligible-stem ablation also has an immutable
`studio.bench.u7-ablation-inputs.v1` registry for all three frozen clips and a cold-audit-first
packager. No ablation capture, label, score, variance measurement, or result is committed.

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
    paired-score-v2.schema.json # cold-rederived per-clip compare with regression detail
    rule-change-*.schema.json # preregistered campaign plus V1 and V2 evaluation
    certified-release.schema.json # exact qualification config and path-free rule context
    capture-executor.schema.json # closed host-owned adapter identity and implementation bytes
    *attempt*.schema.json     # charged execution input and capture attribution
    u7-ablation-inputs.schema.json # exact pre-capture source identities for one U7 ablation
  examples/
    unscored-report.json      # honest sample rendered by /benchmarks/
    gold-drafts/              # non-authoritative drafting-contract fixture; never pack gold
  prompts/
    gold-drafter-v1/          # content-addressed run-006 and provider-authorized drafting inputs
  ADJUDICATION.md             # blinded human worksheet and complete freeze handoff
  candidates/                 # mined miss manifests (studio.bench.candidates.v1)
  packs/<pack_id>/            # pack.json + per-clip gold + immutable freeze receipt
  reviews/                    # adjudication receipts and human output labels
  runs/                       # pinned captures (bench-pin.mjs)
  scores/                     # human-labelled score receipts (studio.bench.score.v1)
  ablations/<slug>/           # immutable result-free registrations and pre-capture inputs
  releases/                   # content-addressed qualification-only certified releases
  executors/                  # content-addressed bench capture executor manifests
  attempts/<run>/             # immutable input, charge, and attribution receipts
```

## State progression

1. `protocol_draft`: slots and conditions may be planned; all sources, runs, and result values remain empty.
2. `gold_frozen`: real sources and all required gold exist; systems may run without changing the test set.
3. `scored`: every compared system has raw outputs, configuration, reviewer labels, artifacts, and scores.

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
| Draft | `scripts/draft-gold-from-candidates.mjs` + `bench/prompts/gold-drafter-v1/` | Schema drift; unstable/non-agent drafter id; copied English in `korean_gold`; missing/duplicate mined windows; overlapping or out-of-range source-only windows; non-null `mined_from` on an independent control; stale prompt, manifest, media, source, or schema bytes; a dry-run fixture entering `bench/packs/` |
| Adjudicate | `scripts/write-adjudication-receipt.mjs` + `bench/ADJUDICATION.md` | A hand-authored/divergent review id; candidate-byte drift; decisions not aligned to every gold time window; a declared Git identity different from the reviewer's checkout identity |
| Freeze | `scripts/freeze-pack.mjs` | Freezing without two blinded accept receipts per clip from reviewers with distinct declared names AND git identities, neither the drafter; a control clip mined from our own misses; a training-routed clip |
| Register | `scripts/register-ablation.mjs` | An unfrozen or byte-drifted pack; operator-authored ids or timestamps; more than one config leaf delta; fewer than three paired repetitions; non-null results or model judge; structural diagnostics with semantic authority |
| Register rule | `scripts/register-rule-change.mjs` | A non-rule proposal; gold-routed or pack-contaminated origin; invalid YouTube identity; absent exact media bytes; result-bearing registration; more than one config leaf delta; fewer than three preregistered pairs per clip |
| Certify rule input | `scripts/certify-rule-change-release.mjs` and `scripts/certify-rule-change-executor.mjs` | Registration, proposal, media, or executor byte drift; an unbounded candidate rule; config substitution; a filesystem-bearing host context; any claim of runtime deployment authority |
| Execute rule capture | `scripts/run-rule-change-attempt.mjs` | Missing pre-invocation charge; retry; duplicate attempt id; deleted charge; existing destination; caller-supplied media path; stale config; executor, capture, input, release, or charge substitution |
| Evaluate rule | `scripts/qualify-rule-change.mjs` | A partial or substituted run grid; capture config drift; unplanned matching captures; post-hoc pairing; invented pair deltas; model judge; missing or mismatched certified execution proof |
| Package U7 | `scripts/package-u7-ablation.mjs` | An unregistered clip or source byte drift; a non-auditable runtime operation; changed raw/stem configs; one selected anonymous stem; partial output from an unavailable, unknown, or truncated recognizer; any semantic label, score, judge, or preference |
| Score | `scripts/score-run.mjs` | Non-frozen or amended gold; a capture dated on or before the freeze day (pre-registration); an emitted line with no human label; a label for a line nothing emitted; any LLM judge (`judge` is pinned null) |
| Check | `scripts/check-bench.mjs` | Route conflicts; a memory proposal drawing on a pack or gold-routed clip (clip-level, not byte-level); a post-freeze capture without a score receipt (score-everything); stale or result-bearing ablation registrations; byte drift in anything a receipt bound |

Routing is exclusive and decided at mine time: a clip that may become bench gold contributes
nothing to glossary, rules, correction pairs, or future training exports — ever — and a clip
routed to training may never enter a pack. `bench/candidates/run-006/` is the first mined
manifest (routed gold, 13 candidates from 15 cues).

The original versioned drafting prompt is `bench/prompts/gold-drafter-v1/prompt.md`; its companion
`manifest.json` content-binds the run-006 prompt, gold schema, candidates manifest, run evidence,
ko-v3 registry, and source media. Provider-authorized v1.1 manifests under
`bench/prompts/gold-drafter-v1/hard-ko-provider-authorized-v1/` bind the shared source-audition
prompt plus each exact source, media file, schema, and phenomenon registry. The hard clip also
binds every mined run input. Independent controls omit mined inputs and require `mined_from: null`.
The materializer validates `studio.bench.gold.v1`, pins `status: "candidate"`, requires the stable
`agent:gold-drafter-v1` identity, enforces mined windows or bounded source-only windows, and writes
immutably. `bench/examples/gold-drafts/Ux-TMWnmntM.gold.json` remains a non-authoritative fixture,
not pack gold. The provider-authorized candidate bytes received two blinded Korean-fluent human
accepts per clip before their separate pack freeze.

Human reviewers follow `bench/ADJUDICATION.md`. The receipt helper uses the existing canonical
`bench-review:` id derivation and preserves `minutes_spent` as a measured number or `null`; it
does not infer decisions, fabricate time, freeze, or score.

Rule promotion is ablation-bound: `scripts/lib/memory-review.mjs` accepts a behavioral rule only
against a PAIR of scored reports on the identical frozen pack whose subject configs provably
differ by exactly the proposed rule (`config.rules` content ids), with the measured delta
recorded on the decision receipt. One scored report is not evidence about a rule.

Paired without/with scoring uses `scripts/compare-scores.mjs` against
`bench/schemas/paired-score-v2.schema.json`. It binds two validated score receipts on the same
`pack_id` + `clip_id`, requires `judge: null` on both, preserves four-way outcome deltas, and lists
loss of previously correct critical units. Repository checks reopen the bound bytes and rederive
the receipt, so changing a delta and recomputing its id does not create evidence. This per-clip
primitive does not establish exact configuration control, repetition variance, or campaign
qualification. The provider-authorized campaign working tree has 15 score receipts and six
structural pair receipts under the disclosed hackathon label procedure. The pairs carry no
with-memory consumption binding and do not establish a full campaign result.

Behavioral rule campaigns use the additive
`studio.bench.rule-change-registration.v1`, `studio.bench.rule-change-result.v1`, and
`studio.bench.rule-change-result.v2` contracts.
Registration binds one training-routed proposal to a validated redistributable YouTube identity,
the exact recorded media bytes, exact rule bytes, the frozen pack, the fixed
`/reviewed_memory/rule_content_id` leaf change, and every run id in the clip and repetition grid
before capture. Evaluation cold-reopens every pair, score, and capture. It requires all
preregistered runs,
rejects unplanned matching captures, measures the maximum within-condition clip range, and refuses
eligibility unless the critical meaning effect meets the preregistered floor of at least 0.25,
exceeds observed spread, does not increase catastrophic count, and introduces no newly
catastrophic critical unit. Repository checks require registration, capture, labels, score, pair,
and result to land in that git ancestry order. Historical V1 remains permanently `refused` and
`ineligible`. V2 accepts optional `studio.bench.execution-attribution.v1` receipts. Each receipt
cold-reopens the canonical execution input, pre-invocation charge, qualification-only certified
release, frozen-pack media, closed host adapter, exact coordinator and adapter bytes, and score-bound
capture. Hard-pack media is accepted only through a canonical prompt authority that predates the
freeze and binds the media named by the candidates-bound run receipt. The bench host owns attempt
identity and destinations. Its journal binds the charge bytes and current Git `HEAD`. The host
commits the exact input, charge, and journal files in one evidence commit before invoking the
adapter, then commits the exact capture and attribution together after invocation. Repository
validation requires those commits after the certified release and executor in that order. Committed
charge history makes a failed or deleted attempt remain spent. Replay reopens coordinator and
adapter bytes from the journal's precharge commit, so a later host version cannot reinterpret an
older proof. The host hashes the exact source buffer passed to the adapter against the release.

The host does not execute caller-supplied code. `studio.bench.capture-executor.v1` binds the exact
single-attempt coordinator and selects one closed adapter with exact implementation bytes. The
provider-authorized campaign used the host-owned one-call provider adapter. It cannot perform
best-of-K. A failed adapter spends the preregistered slot, and the host never retries. Missing any
grid proof keeps both execution checks false. Complete proofs can unlock only
`eligible_for_human_review`; they do not accept or deploy the rule, prove a later run consumed it,
or establish generalization. The provider-authorized registration is committed, but it has no
result. Its partial qualification command refused because only six of nine registered pairs exist.

**What still cannot happen, and why:** the committed raw-versus-eligible-stem registration and input
registry contain no outputs or results. The packager can materialize only both fixed anonymous-stem
captures from one cold-audited U7 operation. It maps unavailable, unknown, and truncated recognizer
results to withheld, maps empty or textless available results to missing, and leaves every semantic
field null. It cannot select eligible clips after outcomes are known, select a favorable stem, turn
structural producer success into semantic quality, or establish variance. Execution still needs at
least three paired repetitions of every frozen clip, human labels for every emitted line, and score
receipts for every capture. A with-memory second capture of the same frozen clip is still required
before any Improve Loop win claim, but that later deployment proof is separate from this
pre-promotion rule experiment. The bench-owned host now binds exact frozen media, executor bytes,
and certified host context to each capture, but its releases pin `runtime_deployable` false. The
provider adapter establishes qualification-only provider execution, not product-runtime authority.
Next-run runtime injection is not certified by this contract. Later independently frozen packs are
still required before any generalization claim.

Two dating anchors are honest-but-incomplete in v1 and documented rather than pretended:
`frozen_at` is stamped by the tool (never operator-supplied) and cannot predate its adjudication
receipts, but it is not yet verified against git commit ancestry; and reviewer identity is
distinct-declared, not cryptographically proven. Both anchors harden the moment the receipts are
committed by their own authors, which is the working practice this repo expects.

## Check the sample

```sh
npm run bench:check
```

The check validates every report it discovers, every capture, every conveyor artifact, every
ablation and rule-change registration, every rule-change result, and every U7 input registry or
committed capture pair. Focused tests reject forged ids, byte drift, premature timestamps, multiple
config deltas, low repetition, non-null judge or results, structural semantic authority,
best-stem selection, hidden ineligible outputs, incomplete anonymous-stem pairs, incomplete or
unplanned rule-change grids, effects below observed spread, catastrophic increases, missing charges,
retry, overwrite, deleted or duplicate attempt ids, caller-selected media, caller-supplied
executable authority, stale configuration, release or capture tamper, and deletion
of committed registration or result artifacts. The existing
conveyor drills continue to reject invalid freezes, labels, routes, contamination, and unscored
post-freeze captures. Planned report slots cannot claim sources or annotations, system and result
states must agree, four-way outcomes must sum, and a zero-denominator rate remains `null`; it never
becomes zero.

The report is the public aggregate. Per-clip judgments, repeat-run detail, reviewer decisions,
and environment metadata stay in the linked score, review, output, and runtime artifacts so the
page can remain readable without weakening the audit trail.

The committed Studio replay under `public/demo/runs/run-005/` is a separate synthetic UI fixture. It must never be copied into this bench as real-media evidence.
