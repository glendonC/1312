# Architecture (verified direction — UI-first week)

Status: **decided for Build Week**; implement agents after UI scaffold is solid.  
Last updated: 2026-07-13

## Goals

- Maximize **Codex / GPT-5.6** (computer use, multi-agent, measurable loop).
- Ship a **complete product experience** (ingest → swarm UI → captions/study → scores).
- Keep long-term path open for fine-tune + better ASR **without** throwing away schemas.

## Recommended stack (UI now → agents next)

| Layer | Choice | Why |
|-------|--------|-----|
| Marketing + Studio UI | **Astro static** + light CSS (this repo) | Fast, matches Sori site pattern |
| Studio interactivity | Progressive: Astro islands / small client JS → later React island if needed | Don’t boil the ocean day one |
| Agent runtime | **Codex app / `codex exec`** + orchestrator scripts (Yolodex-like skills) | Contest-native; parallel worktrees/workspaces |
| Media ingest | `yt-dlp` / local file → workspace media | YouTube-first; DRM out of scope |
| ASR (v1) | Whisper-family or cloud ASR behind a seam | Swappable; not the brand |
| Translation / repair | GPT-5.6 specialists + QC gates | Model does language work; code enforces honesty |
| Persistence | Local workspace folders + **JSON/SQLite** | Accountless compounding on one machine |
| Eval | Fixed clips + `score.json` | Yolodex-style iterate-until-target |
| Hosting demo | Vercel / Cloudflare Pages / `*.pages.dev` | Skip expensive `1321.ai` for now |

## Frontend boundaries

The public site follows four explicit layers so new surfaces do not grow back into route-level god files:

```text
src/
  pages/        route composition and document metadata only
  features/     domain UI, view models, client behavior, and feature-owned styles
  components/   genuinely shared visual and loading primitives
  layouts/      document shells shared across unrelated features
  styles/       global tokens, reset, navigation, buttons, and transitions only
  studio/       isolated product application
```

- A route should assemble a feature, not contain its implementation.
- Feature data derivation belongs in a typed model rather than an Astro frontmatter block.
- Client enhancement code lives beside its feature and binds once across Astro transitions.
- Responsive rules stay with the feature they change.
- Studio CSS is loaded only by `/studio/`; public pages must not inherit the product application's surface styles.
- Shared components expose only implemented variants. Future states are added when their behavior and visuals exist.

### Explicitly deferred

- User accounts / sync
- Fine-tuning weights (consume correction pairs later)
- Private Sori overlay integration (seam only)
- Always-on screen capture as primary ingest

## Swarm model (mitosis)

```
Orchestrator (1)
  ├─ inspect job (length, hardness, gaps)
  ├─ spawn Segment / Context / Translate+QC as needed
  ├─ each worker: own live workspace (squircle)
  └─ workers report UP structured results → merge → QC → outputs
```

- **Not** a fixed N-browser farm.
- **Not** all-to-all debate.
- User can open a worker **during/after** to see seeks, drafts, corrections, handoff.

## Artifacts (learning export — not MD-as-brain)

Per run:

```text
runs/<video_id>/
  captions.json       # timed ko / en
  corrections.json    # raw → final + error_type
  glossary.json       # terms / entities
  score.json          # metrics
  traces/             # per-agent action logs
```

Shared across runs:

```text
memory/
  glossary.sqlite|json
  rules/              # code-enforced playbooks
bench/
  clips/ + expectations + scorer
```

### How this helps “other models”

1. **Inject** glossary/corrections/rules into the next prompt/tool context.  
2. **Grade** any model on the bench.  
3. **Fine-tune later** a small cleanup/gist model on correction pairs.

MD is optional human receipt only.

## Stable correction schema (anti-debt)

```json
{
  "source_video": "id",
  "t_start": 12.4,
  "t_end": 16.1,
  "raw": "…",
  "final": "…",
  "error_type": "homophone|boundary|hallucination|music|other",
  "lang": "ko|en"
}
```

This row shape is future fine-tune data.

## Benchmarks to wire

| Metric | Meaning |
|--------|---------|
| Pack / prep score | Quality after agents finish |
| Δ vs cold | Same clip naive vs prepped |
| Run 1 → N | After memory/rules update |
| vs YouTube auto | Public foil on same minute |
| Coverage | % timed ko+en |
| Time-to-usable | Prep latency |

## Security / product discipline

- User-armed ingest; no silent always-on capture in v1.
- Fail closed / withhold when confidence is junk.
- Public YouTube / owned files only for agent browse.
- Don’t log secrets into traces.

## Implementation order

1. ✅ Marketing pages scaffold (`/`, `/method/`, `/journey/`, `/benchmarks/`)
2. 🔄 Studio UI redesign: `/studio/` empty shell
3. Local run folder schema + fake scored demo data for Benchmarks UI  
4. Orchestrator stub + one real workspace worker on a short clip  
5. Parallel spawn + report-up merge  
6. Bench harness + YouTube foil  
7. Study export thin slice  

## Open questions (do not block UI)

- Exact computer-use host for squircles (Codex CUA vs embedded browser/player).  
- Whether Studio stays Astro islands or becomes a Vite app under `/studio`.  
- Public GitHub visibility when Devpost rules require it.
