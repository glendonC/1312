# Korean kinship address context registered campaign

Status: result-free registration and both qualification-only certified releases exist. This
campaign has no capture, human label, score, qualification, promotion, product runtime authority,
or measured product improvement.

The candidate rule says that bare Korean address forms such as `누나`, `오빠`, `형`, and `언니`
do not by themselves prove a family relationship. Explicit context such as `친누나` or `매형`
can support a kinship translation. The candidate originates from training-routed `run-005` and is
registered only on frozen `hard-ko-v1` clips.

The closed draft grid has three clips, three repetitions, and two conditions. It plans exactly 18
`whisper-1` audio translation calls over 606.078 media seconds, but it is not live-ready. The two
`local-eval-ko-control-*` clips permit local evaluation only and do not authorize provider egress.
The adapter preflight therefore refuses their 12 planned calls before charging a slot. The six
Creative Commons clip calls do not form the complete preregistered grid and must not be run alone.

Wall time and spend remain unset. Before any live authorization, replace this package with a newly
bound campaign against a separately frozen provider-authorized pack. The current adapter accepts
only the exact Creative Commons source contract. A future owned-media path would need a typed,
content-bound provider-egress authority contract before it could pass this gate. Do not mutate
`hard-ko-v1` or reinterpret its existing rights receipts. The result-free registration and its
certified releases do not override those media rights or authorize provider capture.

## Registered, result-free state

The canonical proposal exists at the path bound by `registration.json` and matches the approved
draft bytes. The exact-byte campaign approval is
`bench/reviews/rule-change-campaign/26947adc9c71e9ae4965f46a309438ec48be5b360349a451e1d66abf28c72ace.json`.
It records `live_capture_authorized: false`.

The registration id is
`bench-rule-change-registration:sha256:8ca90db19a68f84a0f409323d0de12fa9a888dd9fa6d84fd9ca5a695dbea430d`,
with `results: null`. Its qualification-only releases are:

- `without`: `bench/releases/8297d53d12e17aeb236c9659e6f4d056a57088894dcff174cd3414d8f6538ac1.json`
- `with`: `bench/releases/d0e2ba9114029d5fcbdfb2df66e79dfde1f4c84c525d8731e9da4df89ab169f1.json`

Both releases record `runtime_deployable: false`. The bound provider executor remains
`bench-capture-executor:sha256:ad94989baaab7e4ac0a40ab4aec0f81602a2530b35f035c09efc8174a5e395bd`.
Before any capture, preserve the required immutable Git chronology for the registration, releases,
executor, and attempt receipts. Registration does not authorize live provider spend. The approval
receipt records a declared human name and Git identity but does not authenticate that identity, so
the operator still owns the decision.

## Live capture gate

The current package cannot pass the provider-media gate, even if the operator supplies the live
authorization phrase. After a new provider-authorized package, registration, and both releases
exist, live execution still requires the operator phrase and exact grid authorization described in
the task handoff. The authorized run must use the newly bound executor and run ids exactly once.
A charged timeout, rate limit, provider error, or invalid response remains a spent slot and must not
be retried.

## Blinded labeling gate

After a complete live capture grid exists, prepare one human-owned file per run at
`bench/reviews/labels/<run>.json`. Do not fill semantic judgments automatically.

For every label file, the operator must verify:

- `schema` is `studio.bench.output-labels.v1`.
- `capture` binds the exact `bench/runs/<run>/capture.json` bytes.
- `blinded` is `true`, with at least two distinct human reviewers and Git identities.
- Every emitted unit for the subject system has one label with exact `t_start` and `t_end`.
- `meaning_preserved`, critical-unit `correct`, and `catastrophic` values are human judgments.
- No label exists for a withheld or missing output.
- `labels_id` is recomputed from the completed receipt before it is committed.

Then run `scripts/score-run.mjs` for all 18 captures, create the nine paired-score receipts with
`scripts/compare-scores.mjs`, and run `scripts/qualify-rule-change.mjs` with all nine pairs and all
18 execution attribution paths. A mechanically eligible result is only eligible for human review.
It is not a deployed rule, accepted memory, or measured product win.
