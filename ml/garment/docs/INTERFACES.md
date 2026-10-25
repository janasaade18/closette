# Later modules

The classifier stops at category, subcategory, box, mask, and optional embedding. The next Closette pieces should call this API rather than import the model.

| module | what it receives | what this package does not do |
| --- | --- | --- |
| Color | the photo plus `mask` | K-means, CIELAB, or color names |
| Attributes | the crop inside `bbox` | pattern, sleeve, neckline, material |
| Digital closet | the JSON response and the stored photo | wardrobe records |
| Recommendations | `category`, `subcategory`, and `embedding` when present | outfit ranking |
| Corrections | `POST /v1/garments/corrections` | automatic retraining |

The summer color notes (CIELAB, then K-means) and the outfit notes (content-based filtering first, collaborative filtering later) stay in those modules. The MobileNet trunk was proposed there as a shared visual encoder. That reuse happens after a full-taxonomy checkpoint exists. FashionCLIP's 512-d vector is the embedding available now.

A correction keeps the original prediction, the replacement label, and the model version. `accepted_for_training` stays false until a person accepts the row.
