# Travel & multi-constraint packing (Phase 4)

`POST /v1/travel/pack` builds a multi-day packing plan on top of the existing Muse stack:

- Phase 1 MLP ranking per day
- Phase 2 LinUCB personalization when feedback exists
- Phase 3 marketplace complements when enabled

Travel-specific layers:

- **Day weather / occasion / season** — each day calls `recommend()` with its own context
- **Outfit rotation** — avoids repeating the same core look beyond `luggage.max_core_reuses`
- **Luggage optimization** — caps unique items / weight; drops single-use add-ons first
- **Combined wardrobe + marketplace** — packing list splits sources; `marketplace_suggestions` lists buys

This endpoint is opt-in. `POST /v1/outfits/recommend` behavior is unchanged.
