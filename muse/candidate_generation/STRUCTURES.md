# Outfit structures in v1

Required structures:

- `top` + `bottom` + `footwear`
- `one-piece` + `footwear`

Optional, and only when an eligible item exists:

- One outer layer, from at most `outerwear_beam` items (default 2). Added when the temperature is under 18°C, or when the season is fall or winter and no temperature was sent. Temperature wins when both are present, so a warm winter day does not force a coat. A formal or work occasion can also add outerwear whose formality is formal, work, or smart-casual, which covers a blazer on a mild day. A casual jacket is not added just because the occasion is casual.
- One accessory, the highest pre-score eligible accessory (`accessory_beam` 1). The outfit without that accessory is also kept.

Pre-score is used only to trim a large wardrobe. It adds formality affinity, preferred type, favorite primary color, and an in-range temperature. Ties break by garment id. If the full set of base outfits is at most `max_candidates` (240), every eligible piece is used. Above that, each required slot keeps `slot_beam` items (8), and the expanded list stops at 240.

An item with no role after the category rules never enters a slot. Muse returns fewer outfits when a required slot is empty.
