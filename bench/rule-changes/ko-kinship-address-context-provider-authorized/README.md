# Korean kinship address context provider-authorized campaign

Status: the result-free registration and both qualification-only releases exist. The live provider
grid spent all 18 registered slots once. Fifteen calls produced captures and execution
attributions. Three calls failed after provider execution, so the registered grid is incomplete.
Fifteen operator-authorized hackathon label receipts and 15 scores with `judge: null` exist for the
successful captures. Six paired-score receipts exist for the complete c1 and c3 repetitions. The
qualification command refused the partial grid before producing a result. No promotion, runtime
deployment, or product improvement result exists for this campaign.

## Bound campaign

The frozen pack is `hard-ko-provider-authorized-v1`. Its freeze id is
`bench-freeze:sha256:f98122007a2f09d7d2de0cd893c9d8b83a63f91e60d4880edef8fb9ad715a508`.
The registration id is
`bench-rule-change-registration:sha256:222b65152093755812937f287139756e185b2bef94fc9556edcc4cee3b95ca8f`,
with `results: null`. Its qualification-only certified releases are:

- `without`: `bench/releases/f4903dc34e5222c918d2a27e311fffba7be6ebc3a1218b1098e9cb7c9110dff9.json`
- `with`: `bench/releases/1bafaf5c9d5e03780c2ffe4e513aba80b06ce568385f613bbb7b606b332df71f.json`

Both releases record `runtime_deployable: false`. Registration and certified execution constrain
the evaluation. They do not accept the candidate rule or authorize product runtime use.

## Recorded provider grid

Every registered attempt has one pre-invocation charge and one provider-call receipt. Each made one
transport invocation with zero retries. The successful capture foundation is:

| Grid clip | Frozen clip | Without captures | With captures | Complete pairs available |
|---|---|---:|---:|---:|
| `c1` | `2o0f-V4uoMg` | 3 | 3 | 3 |
| `c2` | `Ni5rBtowdnI` | 0 | 3 | 0 |
| `c3` | `Ux-TMWnmntM` | 3 | 3 | 3 |
| Total |  | 6 | 9 | 6 |

All 15 successful calls have both `bench/runs/<run>/capture.json` and
`bench/attempts/<run>/attribution.json`. These three registered runs have provider-call receipts but
no capture or attribution:

- `rule-change-ko-kinship-address-context-provider-authorized-c2-r1-without`
- `rule-change-ko-kinship-address-context-provider-authorized-c2-r2-without`
- `rule-change-ko-kinship-address-context-provider-authorized-c2-r3-without`

Each failed with HTTP 200 and `provider_invalid_output`. A failed call spent its registered slot and
must not be retried. The provider response status does not turn invalid output into a capture.

## Hackathon labels, partial pairs, and qualification refusal

The 15 `studio.bench.output-labels.v1` receipts bind the exact successful capture bytes and declare
Bench Reviewer A and Bench Reviewer B. The current validator requires `blinded: true`, which these
receipts record. Their notes explicitly disclose that the judgments were an operator-authorized
hackathon fill derived from frozen gold guidance and emitted English, not independent blind human
semantic QC. The receipts must not be represented as stronger review than their notes support.

`scripts/score-run.mjs` derived 15 score receipts with `judge: null`.
`scripts/compare-scores.mjs` derived only the six complete c1 and c3 pairs, with
`with.memory: null`. Across all three c1 repetitions, the with-side critical-meaning rate delta is
`-0.6666666666666666` and the catastrophic-count delta is `+2` per pair. Across all three c3
repetitions, those deltas are `-0.38461538461538464` and `+4` per pair. These are partial-grid
measurements under the disclosed hackathon labels, not a campaign qualification or product result.

No c2 pair exists. Running `scripts/qualify-rule-change.mjs` with the six pairs and all 15 available
execution attributions refused with `rule change result requires 9 preregistered pairs`. The command
did not write `result.json`. Complete proof for six available pairs cannot establish a full
nine-pair campaign result, and the three spent c2 without attempts must not be retried.

The repository-wide bench check cold-validates all six pair receipts, then remains nonzero at the
score-everything gate. The c3 provider capture has the same `Ux-TMWnmntM` clip identity and source as
frozen `hard-ko-v1`, but its score receipt names only `hard-ko-provider-authorized-v1`. This slice
does not mutate `hard-ko-v1` or manufacture a second-pack score to clear that separate invariant.

Eligibility, if a future complete campaign earns it, would mean only eligible for human review. It
would not mean that the rule was accepted, deployed, consumed by a later run, or that the product
improved.
