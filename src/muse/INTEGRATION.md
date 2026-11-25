# Muse conversational agent — integration boundaries

**Branch:** `feature/muse-chat`  
**Rule:** Closette ML contribution (Phases 1–4 + weather defaults) is **untouchable**. The agent calls Muse over HTTP. It does not import, copy, simplify, or re-rank inside Nest.

## Contribution phases → call path (no modification)

| Phase | What it is | How the agent invokes it | What Nest must NOT do |
| --- | --- | --- | --- |
| **1 — MLP ranker** | `ml/muse/weights/ranker-v1.json` scored in `muse/ranking/learned.js` when `ranking_policy: "learned"` | `POST {MUSE_URL}/v1/outfits/recommend` with wardrobe + context. Muse pipeline loads MLP. | Re-score outfits; invent scores; bypass Muse |
| **2 — LinUCB** | `muse/personalization/*` blended after enough feedback | Same recommend call (`personalization: "linucb"` via Muse `runtime.json`). Learning continues via `POST /v1/outfits/feedback`. | Reimplement bandit; fake personalization |
| **3 — Marketplace** | `muse/marketplace/*` closet-first gap-fill | Recommend with `marketplace.enabled: true` + `marketplace_products` (or Muse catalog). Mixed looks only from Muse `marketplace_items`. | Invent product IDs; mix outside Muse |
| **4 — Travel** | `muse/travel/pack.js` | `POST {MUSE_URL}/v1/travel/pack` | Invent day plans / packing lists |
| **Weather (engine)** | `muse/weather/defaults.js` inside recommend/travel | Pass `weather.{temperature_c,condition}` on Muse requests. Optional Nest `get_weather` fills those fields from Open-Meteo **before** calling Muse. | Replace Muse weather rules |

## Agent architecture (one stylist)

```
App chat / Muse tab (shared session context over time)
        ↓
Nest POST /muse/chat
        ↓
Gemini (tool calling) — conversational brain
        ↓ tools
   ├── get_wardrobe_snapshot / get_profile_snapshot   (request/session data)
   ├── get_weather                                   (Open-Meteo → args for Muse)
   ├── recommend_outfits                             → Muse /v1/outfits/recommend
   ├── plan_travel_pack                              → Muse /v1/travel/pack
   └── submit_outfit_feedback                        → Muse /v1/outfits/feedback
        ↓
{ text, outfit?, travel?, context? }  — IDs only from Muse tool results
```

## Hard boundaries

1. **Outfit / pack / marketplace fill truth** = Muse tool JSON only. LLM narrates; never fabricates garment or product IDs.
2. **No edits** under `muse/ranking/**`, `muse/personalization/**`, `muse/marketplace/**`, `muse/travel/**`, `ml/muse/**` for this agent work.
3. **Regex is not the brain.** At most used for safety (off-topic refuse), never as primary intent router.
4. **Phase A vs B** = delivery order of tools/UX polish, **not** two different products. Same agent loop from day one.

## Phase A (this delivery)

Implemented tools: wardrobe/profile snapshot, weather, `recommend_outfits`, `submit_outfit_feedback`, `plan_travel_pack` (thin Muse HTTP).  
Gemini orchestrates with function calling. Frontend chat keeps existing outfit tiles + Muse feedback actions.

## Session (chat ↔ Muse tab)

`context` on the chat DTO carries occasion, weather, avoided/last outfit ids. Phase A persists this in the chat reply for the app. Shared durable session store across tab + chat is a follow-up on the same contract (same fields), not a second assistant.
