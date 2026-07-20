# 1321

**Autonomous Language Intelligence for Real-World Media.**

Live translate guesses. This studies the video first.

When media is in another language and another context, people get locked out of watching and
learning what they want. 1321 builds understanding first so those bridges can exist.

```text
People want media from other languages / contexts
        ↓
Gated by more than bad / slow translation
  (culture, history, register, references, who is speaking)
        ↓
Real media makes that worse (overlap, music, frames)
        ↓
Need: study first → checked understanding → then watch / learn uses
```

Foreign-language media travels farther than foreign-language understanding. People want the same
videos for enjoyment or learning, and hit a wall: native speech, cultural references, and history
that translation speed alone cannot unlock. Real media makes that worse before meaning is settled.
A cold one-pass system can sound fluent and still leave the viewer outside the source.

1321 studies the source first. Agents inspect sound, frames, speakers, and context; investigate
uncertain parts; compare evidence; and withhold when evidence is weak. Captions, translation, and
learning are uses of that checked understanding, not the product itself.

We started with Korean-to-English because that is a wall one of us actually hit, and because it is a
hard case (overlap, culture, register, speed). More of the why:
[Why 1321 has to exist](https://www.try1321.com/journey/2026-07-13-why-1321/)
([source in repo](src/content/journey/2026-07-13-why-1321.md)).

## Try it

**On the web:** [try1321.com](https://www.try1321.com/) ·
[Journey](https://www.try1321.com/journey/) ·
[Method](https://www.try1321.com/method/) ·
[Benchmarks](https://www.try1321.com/benchmarks/) ·
[Studio](https://www.try1321.com/studio/)

The public Studio demo replays a recorded investigation so you can see the product without running
a host. Pasting a URL there does not process that video.

**Locally (real ingest):**

```sh
npm ci
npm run dev
```

Use `npm install` only when intentionally changing a dependency or the lockfile. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Same site routes under `http://localhost:4321`. In Studio, use **Process locally** (YouTube range or
a file you own) with the local runtime host. That path really ingests and studies your source.
**Explore a recording** is the recorded demo path.

## Where next

| If you want… | Go here |
|---|---|
| What the product is (and is not) | [`docs/PRODUCT.md`](docs/PRODUCT.md) |
| How the system fits together | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| How agents run in the product | [`docs/CODEX.md`](docs/CODEX.md) |
| How to contribute | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Full documentation map | [`docs/README.md`](docs/README.md) |

Deeper owners (status, Studio contract, runtime schemas, capability ladder) are linked from the
[docs map](docs/README.md). Open them when you are changing that part of the system.

## How it runs

Codex is not only how this repo was written. Sandboxed `codex exec` is the production agent runtime
for orchestrator and worker roles: ambient tools stay off, and the host re-grants only task-private
MCP tools. GPT-5.6 is the configured model for those roles. Media detectors, readiness checks,
human approval, and scoring stay outside the model.

Details: [`docs/CODEX.md`](docs/CODEX.md).

## Evaluation

We freeze hard clips before scoring. Current pack and score facts live in `bench/packs/`,
`bench/scores/`, and their bound receipts; prose is never stronger than those artifacts. See
[`bench/README.md`](bench/README.md), [benchmarks on the site](https://www.try1321.com/benchmarks/),
and `bench/scores/run-007/`.
