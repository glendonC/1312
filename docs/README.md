# Documentation map

- Document type: Living registry
- Lifecycle: Active
- Authority: Public document ownership, lifecycle, and routing
- Last verified: 2026-07-17
- Update when: A public owner document is added, removed, renamed, or changes responsibility

Use this page to find the document that owns a question. Use
[`build-week/STATUS.md`](./build-week/STATUS.md) for current engineering state. Use code, schemas,
tests, and bound receipts to verify implementation claims.

## Owner registry

| Document | Type | Lifecycle | Owns | Does not own | Update when |
|---|---|---|---|---|---|
| [`PRODUCT.md`](./PRODUCT.md) | Product identity | Active | Category, product loop, beachhead, proof boundary | Runtime status or implementation inventory | Product identity or proof boundary changes |
| [`build-week/STATUS.md`](./build-week/STATUS.md) | Living status | Active | Current milestones, blockers, active work, next actions | Detailed contracts or historical implementation sequence | Engineering state changes |
| [`build-week/CAPABILITY_LADDER.md`](./build-week/CAPABILITY_LADDER.md) | Capability plan | Active | Rung order, dependencies, done-when, capability non-claims | UI work or completed-campaign history | A rung is accepted, implemented, blocked, or reordered |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Architecture reference | Stable | Module boundaries, dependency direction, durable system shape | Current roadmap or per-route inventory | A stable boundary changes |
| [`RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md) | Mixed contract reference | Active | Production runtime contracts plus explicitly inert fixture history | Current roadmap or product identity | A runtime contract changes, or fixture history is split out |
| [`STUDIO_PRODUCT_CONTRACT.md`](./STUDIO_PRODUCT_CONTRACT.md) | UI/runtime contract | Active | Studio meaning, authority, actions, evidence classes, unavailable states | General runtime internals or product identity | A Studio surface or authority boundary changes |
| [`STUDIO_AUTONOMY.md`](./STUDIO_AUTONOMY.md) | Deep design ledger | Active | Durable runtime decisions and dated implementation context | Current status or current capability claims | A durable decision changes or the ledger is retired |
| [`CODEX.md`](./CODEX.md) | Product executor runbook | Active | Closed product-launched Codex roles, invocation, tools, and operator proof | IDE or CLI repository-agent behavior | The product executor cage or run procedure changes |
| [`rfcs/0001-miss-to-gold-conveyor.md`](./rfcs/0001-miss-to-gold-conveyor.md) | Decision record | Accepted | Miss routing, gold isolation, scoring invariants, and rationale | Current pack counts, score counts, or runtime status | The decision or its invariants change |

`RUNTIME_CONTRACTS.md` remains mixed until inert fixture history is split from the production
reference. `STUDIO_AUTONOMY.md` preserves decisions and context, not current status.

## Supporting public runbooks

| Document | Owns |
|---|---|
| [`../README.md`](../README.md) | Repository entry point, problem, product response, and local start |
| [`../AGENTS.md`](../AGENTS.md) | IDE and CLI agent operations in this repository |
| [`../bench/README.md`](../bench/README.md) | Evaluation-domain layout, commands, packs, and score artifacts |
| [`../bench/ADJUDICATION.md`](../bench/ADJUDICATION.md) | Human gold-review procedure |

Current evaluation facts live in `bench/packs/`, `bench/scores/`, and their content-bound receipts.
A prose count is never stronger evidence than those artifacts.

## Lifecycle rules

Use one of these labels when a document receives a control block:

- `Active`: update in the same accepted slice as the owned fact.
- `Stable`: change only when a durable boundary or definition changes.
- `Accepted`: preserve the decision and rationale. Route current state elsewhere.
- `Superseded`: keep only when later work still needs the historical decision.
- `Historical snapshot`: preserve dated context. Never read it as current status.

Use `Last verified`, not `Last updated`, when evidence was checked across the full document. A date is
metadata, not proof.

## Update rules

- Keep each current fact in one owner. Summaries link to the owner instead of copying detail.
- Update a normative owner in the same accepted slice as the behavior change.
- Let status summarize. Keep contract inventories out of architecture and roadmap state out of RFCs.
- Never link public docs to `docs/local/`. Treat tracked code mentions as cleanup debt, not authority,
  and do not add new ones.
- Delete resolved local handoffs after their durable content is folded into an owner.
- Use Git for ordinary history. Preserve separate history only when its rationale still changes work.
- Run `npm run docs:check` after changing public documentation or agent instructions.
