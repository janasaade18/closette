# Garment taxonomy v2

`taxonomy.json` is the versioned source. Every subcategory id belongs to one category. Ids are kebab-case and are the values the API returns. Display names live in `labels.<id>.name`.

A category is never used as a subcategory. `tops` is a category. `t-shirt` is a subcategory.

## Categories

| id | subcategories |
| --- | --- |
| tops | t-shirt, shirt, polo, blouse, sweater, hoodie, tank-top, sweatshirt |
| bottoms | jeans, trousers, chinos, shorts, skirt, leggings |
| one-piece | dress, jumpsuit, romper |
| outerwear | jacket, coat, blazer, trench-coat, raincoat |
| footwear | sneakers, boots, sandals, formal-shoes, flats, heels |
| accessories | hat, scarf, belt, bag, gloves, other-accessories |

Each label has a one-sentence definition and a FashionCLIP prompt in `taxonomy.json`.

`supervision` says how the label can be trained:

- `direct` — a public dataset class maps cleanly onto this id
- `weak` — the source class is broader than this id, so the crop is kept but marked `label_quality=weak`
- `zero-shot` — no honest mapping. FashionCLIP covers it until Closette has its own labels

## Ambiguous cases

**Shirt vs blouse.** A shirt is a structured button-up with a collar. A blouse is a softer or dressier top. Fashionpedia's `shirt, blouse` class is not mapped.

**T-shirt vs polo vs tank top.** A polo has a collar and a placket. A tank top has no sleeves. A t-shirt has sleeves and no collar. DeepFashion2's short-sleeve top mixes these, so that row is weak and lands on `t-shirt` only as a noisy prior.

**Sweater vs sweatshirt vs hoodie.** A sweater is knit. A sweatshirt is fleece or French terry without a hood. A hoodie has a hood. Fashionpedia's combined top class is not mapped, so those three are not collapsed into `t-shirt`.

**Jeans vs trousers vs chinos.** Jeans are denim. Chinos are cotton twill. Trousers are other full-length pants. DeepFashion2 `trousers` and Fashionpedia `pants` mix all three, so they are weak and are not stored as jeans.

**Jacket vs coat vs blazer vs trench vs raincoat.** A jacket ends around the hip. A coat is longer. A blazer is tailored. A trench coat is belted with a storm flap. A raincoat is a waterproof shell that is not a trench.

**Dress vs jumpsuit vs romper.** A dress has a skirt. A jumpsuit has long pants. A romper has shorts. Romper has no clean public-dataset class, so it stays zero-shot.

**Dress vs skirt.** A dress has a bodice. A skirt starts at the waist. A skirt crop that cuts off the waist often looks like a dress. The pipeline rescored the full photo when those scores conflict, and asks for review when dress and skirt stay within 0.08.

**Footwear.** A label that only says "shoe" is skipped. It is not stored as sneakers. A boot covers the ankle. Sandals are open. Heels have a raised heel. Flats do not.

**Vest and cardigan.** DeepFashion2 vest, Fashionpedia vest, and Fashionpedia cardigan are skipped. They are not forced into tank-top or sweater.

**Hat vs hood.** A hood sewn onto a hoodie is part of the hoodie, not a hat.

The abstention list in `labels.*.ambiguous_with` is symmetric. When the top two scores are one of these pairs and are within 0.08, the API returns `review` instead of `success`.
