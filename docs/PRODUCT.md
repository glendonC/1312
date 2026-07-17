# 1321

**Codename:** 1321 (Build Week Jul 13–21, 2026)  
**Category:** Language intelligence for real-world media  
**Beachhead:** Korean → English on YouTube / clips (first proof case, not the product boundary)

Human-facing voice is owned by the homepage hero, `/method/`, and the Journey manifesto
[`src/content/journey/2026-07-13-why-1321.md`](../src/content/journey/2026-07-13-why-1321.md).
Runtime status and contracts live in the Build Week and runtime docs.

---

## What 1321 is

**Autonomous Language Intelligence for Real-World Media.**

Korean media already crossed the world. Understanding it still has not. People get locked out of
videos they actually want — for enjoyment or for learning — because native speech, overlap, music,
culture, and speed do not fit a cold one-pass guess.

1321 builds the foundation for AI to **understand real-world media** through autonomous,
self-improving investigation. Agents work from the media itself (audio, frames, context), spawn the
investigation the source needs, reconcile claims against evidence, and withhold when weak.

Korean-to-English is the **first proof case, not the boundary.** The larger system is how autonomous
agents investigate and understand real media whenever meaning is spread across sound, picture, and
situation.

### What it is not

- Not a caption app, subtitle SaaS, or “faster live translate”
- Not “we investigate hard Korean clips” as the product name (that is a Build Week proof bar)
- Not Netflix DRM miracles, multilingual hive-mind v1, accounts-required v1, or Mac overlay as the submission
- Not rebuilding Feather / Learning OS this week (learning is a later use of understanding)

---

## Positioning

**Tagline:** Autonomous Language Intelligence for Real-World Media

**Foundation:** Building the foundation for AI to understand real-world media through autonomous,
self-improving investigation.

**Contrast:** Live translate guesses. This studies the video first.

**Learning track (later use, already on the hero “Then what?”):** This foundation can turn real media
into a learning environment. Understanding the video opens ways to learn that translation alone
never can.

---

## One-move

**Media in → understood media out** (evidence-backed investigation of that source), with a scored
Korean→English beachhead on fixed clips.

Method Apply (`src/features/method/steps.tsx`): understanding is reusable. One checked investigation
can support:

| Track | Examples | Now vs later |
|---|---|---|
| **Watch** | Captions + translation as playback aids | Downstream artifact / demo surface |
| **Understand** | Explanations + facts | Core product direction |
| **Reuse** | Cases + evidence for later work | Eval / compounding |
| **Learn** | Learning environment from real media → Feather later | Thesis on site; Learning OS parked |

Watch aids and captions are one Apply branch, not the product category.

---

## Problem (precise)

Cold one-shot handling of native media fails before “translation quality” even starts: speech vs
music, who spoke, uncertain transcription, meaning/tone, timing. Forcing all of that while the video
is still playing creates wrong-fluent or late results. Apple often stops at Korean transcription for
arbitrary media.

Do **not** claim every live tool sucks. Prove the beachhead on fixed clips (cold vs prepped, and vs
YouTube auto where useful). The product bet is **investigation over conversion**.

---

## Product loop (aligned with Method)

1. **Ingest** — YouTube URL or owned file becomes an inspectable run (media becomes evidence).
2. **Investigate** — orchestrator spawns/retires specialists; uncertainty shapes the work.
3. **Reconcile** — claims need receipts; conflicts stay visible; weak claims are revised or withheld.
4. **Apply** — turn checked understanding into useful outputs (watch / understand / reuse / learn).
5. **Improve** — misses → bench + glossary + rules + correction pairs (not weight dumps).
6. **Seam** — private **Sori** live companion can consume prep later. Live/low-latency is not this climb.

---

## Build Week bar (proof, not identity)

Deliberately small: ~30s–1min difficult Korean clip end to end; visible swarm; scored beachhead on
meaning. That proves the spine. It does **not** redefine the product as “hard Korean clip tooling.”

---

## UI routes

| Route | Role |
|-------|------|
| `/` | Landing — language intelligence + learning “Then what?” |
| `/method/` | How 1321 understands media |
| `/journey/` | Why this exists; Build Week evidence log |
| `/benchmarks/` | Beachhead evaluation surface (not the product definition) |
| `/studio/` | Product instrument (ingest, swarm, workspaces, traces) |

## Related

- **Sori** — private Mac live companion (consumer of prep later)
- **Feather** — long-term SRS; don’t rebuild Feather-lite here
