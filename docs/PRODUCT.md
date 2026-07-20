# 1321

- Document type: Product identity
- Lifecycle: Active
- Authority: Category, product loop, beachhead, and proof boundary
- Last verified: 2026-07-20
- Update when: Product identity or proof boundary changes

**Live translate guesses. This studies the video first.**

Korean media already crossed the world. Understanding it still has not. People get locked out of
videos they actually want, for enjoyment or for learning, because native speech, overlap, music,
culture, and speed do not fit a cold one-pass guess.

**Codename:** 1321 (Build Week Jul 13–21, 2026)  
**Category:** Language intelligence for real-world media  
**First proof case:** Korean → English on YouTube / clips (not the product boundary)

Human-facing voice lives on the site:
[homepage](https://www.try1321.com/),
[Method](https://www.try1321.com/method/),
and the Journey manifesto
[Why 1321 has to exist](https://www.try1321.com/journey/2026-07-13-why-1321/)
([source](../src/content/journey/2026-07-13-why-1321.md)).
Current engineering status: [`build-week/STATUS.md`](./build-week/STATUS.md).
Runtime contracts: [`RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md).

---

## What 1321 is

**Autonomous Language Intelligence for Real-World Media.**

1321 builds the foundation for AI to **understand real-world media** through autonomous
investigation. Agents work from the media itself (audio, frames, context), spawn the investigation
the source needs, reconcile claims against evidence, and withhold when weak. Checked understanding
can be reused; captions and learning are uses of that understanding, not the product itself.

Korean-to-English is the **first proof case, not the boundary.** The larger system is how agents
investigate real media whenever meaning is spread across sound, picture, and situation.

### What it is not

- Not a caption app, subtitle SaaS, or “faster live translate”
- Not “we investigate hard Korean clips” as the product name (that is a proof bar, not the category)
- Not Netflix DRM miracles, multilingual hive-mind v1, accounts-required v1, or Mac overlay as the
  core product
- Not a learning-OS rebuild as the foundation claim (learning is a later use of understanding)

---

## Positioning

**Tagline:** Autonomous Language Intelligence for Real-World Media

**Foundation:** Building the foundation for AI to understand real-world media through autonomous
investigation.

**Contrast:** Live translate guesses. This studies the video first.

**Learning (later use):** Understanding the video can open ways to learn that translation alone
never can. Learning OS stays parked; see the site hero “Then what?”

How agents run in the product: [`CODEX.md`](./CODEX.md).

---

## The core loop

**Media in → checked understanding out**, with a scored Korean→English proof case on fixed clips.

One checked investigation can support:

| Track | Examples | Now vs later |
|---|---|---|
| **Watch** | Captions + translation as playback aids | Downstream use / demo surface |
| **Understand** | Explanations + facts | Core product direction |
| **Reuse** | Cases + evidence for later work | Eval / compounding |
| **Learn** | Learning environment from real media → Feather later | Thesis on site; Learning OS parked |

Watch aids and captions are one use of understanding, not the product category.

---

## Problem (precise)

Cold one-shot handling of native media fails before “translation quality” even starts: speech vs
music, who spoke, uncertain transcription, meaning/tone, timing. Forcing all of that while the video
is still playing creates wrong-fluent or late results.

Do **not** claim every live tool sucks. Prove the proof case on fixed clips (cold vs prepped, and vs
YouTube auto where useful). The product bet is **investigation over conversion**.

---

## Product loop (aligned with Method)

1. **Ingest:** YouTube URL or owned file becomes an inspectable run (media becomes evidence).
2. **Investigate:** orchestrator spawns/retires specialists; uncertainty shapes the work.
3. **Reconcile:** claims need receipts; conflicts stay visible; weak claims are revised or withheld.
4. **Apply:** turn checked understanding into useful outputs (watch / understand / reuse / learn).
5. **Improve:** misses → bench + glossary + rules + correction pairs (not weight dumps).
6. **Seam:** private **Sori** live companion can consume prep later. Live/low-latency is not this climb.

---

## Build Week bar (proof, not identity)

Deliberately small: ~30s–1min difficult Korean clip end to end; visible swarm; scored proof case on
meaning. That proves the spine. It does **not** redefine the product as “hard Korean clip tooling.”

---

## UI routes

| Route | Role |
|-------|------|
| [`/`](https://www.try1321.com/) | Landing: language intelligence + learning “Then what?” |
| [`/method/`](https://www.try1321.com/method/) | How 1321 understands media |
| [`/journey/`](https://www.try1321.com/journey/) | Why this exists; Build Week evidence log |
| [`/benchmarks/`](https://www.try1321.com/benchmarks/) | Evaluation surface (not the product definition) |
| [`/studio/`](https://www.try1321.com/studio/) | Product UI (ingest, swarm, workspaces, traces); default demo is recorded |

## Related

- **Sori:** private Mac live companion (consumer of prep later)
- **Feather:** long-term SRS; don’t rebuild Feather-lite here
