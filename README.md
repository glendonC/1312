# 1321

**Autonomous Language Intelligence for Real-World Media.**

1321 is building a foundation for AI to understand real-world media, not just convert it.

Real media is messy. People talk over music. A face or camera cut changes what a line means. A name or joke depends on what happened earlier. A system that only processes the next moment can sound fluent without understanding the source.

1321 lets autonomous agents study the media first. They inspect sound, frames, speakers, and context, investigate uncertain parts, compare evidence, and say when the evidence is not enough. That understanding can be checked, reused, and turned into useful outputs.

Difficult Korean-to-English video is the first stress test. Translation, captions, and learning are uses of the foundation, not the product itself.

## How we use Codex and GPT-5.6

Codex is not only how we wrote this. It is the production agent runtime.

We launch sandboxed `codex exec` processes for an orchestrator and for workers. Ambient tools stay off (web, shell, apps, memories, built-in multi-agent). The host re-grants only task-private MCP tools. GPT-5.6 is the configured model for those Codex roles. Media detectors, readiness checks, human approval, and scoring stay outside the model.

Details: [docs/CODEX.md](docs/CODEX.md).

## Try it

```sh
npm install
npm run dev
```

- `/` landing
- `/method/` how investigation works
- `/journey/` Build Week evidence log
- `/benchmarks/` frozen hard-clip evaluation
- `/studio/` product instrument (default demo is a recorded investigation)

## Docs

- [Product](docs/PRODUCT.md) - identity and pitch
- [Codex and GPT-5.6](docs/CODEX.md) - how agents run in production
- [Architecture](docs/ARCHITECTURE.md) - stack and boundaries
- [Build Week status](docs/build-week/STATUS.md) - what is shipped vs next
- [Studio product contract](docs/STUDIO_PRODUCT_CONTRACT.md) - what Studio shows vs records
- [Capability ladder](docs/build-week/CAPABILITY_LADDER.md) - honesty bounds for claims

## Evaluation

We freeze hard clips before scoring. The first human-labeled beachhead score exists with no model judge. One capture is a baseline, not a general quality win. See `/benchmarks/` and `bench/scores/run-007/`.
