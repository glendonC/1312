# Hard-KO Clip Pack bench

This directory is the evidence boundary for Benchmarks. The public page may render only what these artifacts can support.

Current state: protocol draft. There are no sourced benchmark clips, frozen gold annotations, captured foils, completed benchmark runs, reviewer labels, or scores.

```text
bench/
  schemas/
    report.schema.json        # versioned report contract
  examples/
    unscored-report.json      # honest sample rendered by /benchmarks/
  packs/hard-ko-v1/           # future frozen manifest and per-clip gold
  foils/                      # future date-stamped external outputs
  runs/                       # future pinned 1321 outputs and runtime receipts
  reviews/                    # future blinded labels and adjudication
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

## Check the sample

```sh
npm run bench:check
```

The check enforces the honesty invariants that are easiest to break while wiring data: planned slots cannot claim sources or annotations, system and result states must agree, unrun systems cannot contain values or artifacts, and four-way outcomes must sum to their total. A scored report requires complete frozen gold, pinned system versions and configurations, every headline value, raw output, runtime, review, and score receipts. A zero-denominator rate remains `null`; it never becomes zero.

The report is the public aggregate. Per-clip judgments, repeat-run detail, reviewer decisions, and environment metadata stay in the linked score, review, output, and runtime artifacts so the page can remain readable without weakening the audit trail.

The committed Studio replay under `public/demo/runs/run-005/` is a separate synthetic UI fixture. It must never be copied into this bench as real-media evidence.
