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

The public site has no hosted cloud ingest yet. Real YouTube paste needs the local steps below.
**Explore a recording** still opens the recorded run-006 demo without a host.

### Local: browse the site and the recorded demo

```sh
npm ci
npm run dev
```

Open `http://localhost:4321/` or `/studio/` → **Explore a recording**. No API key required.
Use `npm install` only when changing a dependency or the lockfile.

### Local: paste a YouTube URL (real ingest)

1. Optional: copy [`.env.example`](.env.example) to `.env`. You do **not** need `OPENAI_API_KEY` for
   default ingest (deterministic host). Add the key only for real OpenAI caption / explanation /
   Codex paths (next section).
2. In two terminals:

```sh
npm run dev
npm run runtime:host
```

3. The host prints JSON on stdout. Copy `listening` (default `http://127.0.0.1:4312`) and
   `authorizationToken`.
4. Open `http://localhost:4321/studio/`, use **Connect to local host**, paste origin + token.
5. Paste a YouTube URL into **Input Source**. That runs local YouTube ingest for that video (not
   run-006). You can also use **Process locally** for a YouTube range or a file you own.

More host flags and honesty boundaries:
[`docs/STUDIO_PRODUCT_CONTRACT.md`](docs/STUDIO_PRODUCT_CONTRACT.md).

### Local: real OpenAI captions / Codex (optional)

Put your key in `.env` (never commit it):

```sh
cp .env.example .env
# edit .env → OPENAI_API_KEY=...
```

Then use the guarded host commands in [`package.json`](package.json) (for example
`runtime:host:caption-real`, `runtime:host:codex`). Those require explicit `--allow-real-*` flags
and are not the default `runtime:host` path. Details: [`docs/CODEX.md`](docs/CODEX.md).

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
