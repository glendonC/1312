# 1321

**Codename:** 1321 (Build Week Jul 13–21, 2026)  
**Category:** Language intelligence  
**Beachhead:** Korean → English real media (YouTube / clips first)

## Pitch

Live translate guesses. This studies the video first.

A Codex swarm forks into live workspaces, breaks down Korean media in parallel, and leaves accurate captions, translation, and study material — getting sharper on hard cases over time.

## One-move (Yolodex-shaped)

**YouTube / clip in → accurate captions (+ study) out**, with a scored loop.

## Problem (precise)

Cold real-time ko→en on real media is unreliable (wrong-fluent, late, or transcript-only). Apple often stops at Korean transcription for arbitrary media. Do **not** claim every live tool sucks — prove cold vs prepped (+ YouTube auto-translate) on fixed clips.

## Product loop

1. **Ingest** — public YouTube URL or local clip (“what I’m looking at” later).
2. **Instance** — isolated live workspaces (squircles) agents can scrub inside.
3. **Mitosis swarm** — orchestrator spawns/retires specialists as needed; workers **report structured results up**.
4. **Output** — timed Korean + cleaned English + hard lines to learn.
5. **Use** — play with those captions; learn/export (toward Feather later).
6. **Improve** — misses → bench + glossary + code rules + correction pairs (not GPT weight dumps).
7. **Seam** — can condition private **Sori** overlay later. Sori stays private.

## Not this

RL “agents practicing Korean,” MD-only memory as the brain, Netflix DRM miracles, websites-first, multilingual hive-mind v1, Mac overlay as the submission, accounts required for v1.

## Build Week bar

Nail ~30s–1min hard Korean video end-to-end; visible swarm; scores (cold vs prepped, Run 1→N, vs YouTube auto).

## UI routes (this repo)

| Route | Role |
|-------|------|
| `/` | Landing (Sori-style hero) |
| `/method/` | System / process |
| `/journey/` | Evidence build log |
| `/benchmarks/` | Metric surface (placeholders until scored) |
| `/studio/` | Product UI shell (ingest, org chart, squircles, traces) |

## Related

- **Sori** — private Mac live companion (consumer of prep later)
- **Feather** — long-term SRS; don’t rebuild Feather-lite here
