# Codex and GPT-5.6

- Document type: Product executor runbook
- Lifecycle: Active
- Authority: Closed product-launched Codex roles, invocation, tools, and operator proof
- Last verified: 2026-07-19
- Update when: The product executor cage or run procedure changes

How 1321 uses Codex and GPT-5.6 in the product runtime (not only as an IDE assistant). Repository
IDE and CLI agent operations live in [`AGENTS.md`](../AGENTS.md); do not merge those roles.

## Role

Codex is the production agent executor. The host launches `codex exec` for:

- a **root orchestrator** that spawns work, waits on children, and synthesizes study under a closed tool list
- **workers** that only see tools matching live grants for their task

The model string is explicit (`--model` / `STUDIO_OWNED_SWARM_MODEL`). It is not taken from ambient
Codex user config. The configured product model for orchestrator and worker language work is
**GPT-5.6**.

## Closed invocation

Every production Codex process starts from a closed flag set in
[`src/studio/runtime/production/executor/codexInvocation.ts`](../src/studio/runtime/production/executor/codexInvocation.ts)
(`closedCodexExecArgs`):

- ephemeral, ignore user config and rules, strict config
- read-only sandbox
- web search disabled
- shell, apps, hooks, goals, memories, built-in multi-agent, and remote plugins disabled

Power is removed first. Task-private MCP tools are added back only when the host grants them.

## Two roles

| Role | Job | Tools |
|---|---|---|
| Orchestrator | Plan investigation, spawn specialists, wait, disposition reports, restudy / synthesize | Exact closed MCP surface from the root contract |
| Worker | Investigate a scoped question with media / evidence tools | Only tools bound to that task's live grants |

Contracts and launcher wiring live under `src/studio/runtime/production/` (see also [RUNTIME_CONTRACTS.md](RUNTIME_CONTRACTS.md)).

## What GPT-5.6 does here

Inside that cage, GPT-5.6:

- decides what focused work to open next (orchestrator)
- uses granted tools and returns structured evidence / reports (workers)
- drafts language work when that path is granted

The host still owns media producers (speech, acoustic triage, frames, OCR, speakers when enabled), journals, readiness, human approval, and private post-study artifacts.

## What the model does not do

- Run ambient web, shell, or computer-use by default
- Replace deterministic media producers
- Act as human review or publish authority
- Grade the beachhead benchmark (human labels; model judge pinned null)

## Run a real Codex path

Requires a local Codex CLI and an explicit model:

```sh
export STUDIO_OWNED_SWARM_MODEL=gpt-5.6
npm run runtime:host:codex
```

Related scripts in `package.json`: `runtime:host:codex`, `runtime:smoke:codex`, `runtime:proof:owned-swarm`.

Default `npm run runtime:host` uses the deterministic executor (test seam). That path is not evidence of model planning.

## Honesty

Studio's public `/studio/` demo defaults to a recorded investigation. Owned-path Codex execution is a separate local host path. Do not treat replay UI as live swarm cognition for a newly pasted URL.

See [PRODUCT.md](PRODUCT.md), [build-week/STATUS.md](build-week/STATUS.md), and [STUDIO_PRODUCT_CONTRACT.md](STUDIO_PRODUCT_CONTRACT.md).
