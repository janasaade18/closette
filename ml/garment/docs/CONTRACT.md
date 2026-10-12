# Classify response v1

`model_version` is `closet-classifier-v1`. The Nest app and the mobile client should depend on these fields, not on FashionCLIP or SegFormer.

## Success

```json
{
  "status": "success",
  "category": "tops",
  "subcategory": "t-shirt",
  "confidence": 0.94,
  "bbox": [120, 80, 720, 900],
  "mask": null,
  "embedding": null,
  "model_version": "closet-classifier-v1"
}
```

The numbers above are the contract's shape, not a measured prediction.

Also returned:

- `reason` — null on success, otherwise `low_confidence`, `ambiguous_pair`, `localization_disagrees`, or `no_garment`
- `alternatives` — top three `{category, subcategory, confidence}` on success and review, null when unclear
- `latency_ms`
- `models.classifier`, `models.classifier_id`, `models.segmenter`, `models.taxonomy_version`, `models.embedding_dim`

## Fields

`category` and `subcategory` are taxonomy ids. `confidence` is a float in `[0, 1]` or null. Do not treat it as a guarantee. The review thresholds live in `taxonomy.json` under `policy` and should be retuned on the closet test set.

`bbox` is `[x_min, y_min, x_max, y_max]` in original-image pixels. The origin is the top-left corner. `x_min` and `y_min` are inclusive. `x_max` and `y_max` are exclusive, so width is `x_max - x_min`. This matches `PIL.Image.crop`. The classifier sees that box expanded by 8 percent, clipped to the image. The returned box stays tight.

`mask` is null, or:

```json
{
  "encoding": "rle-row-major",
  "start_value": 0,
  "width": 384,
  "height": 512,
  "source_width": 3000,
  "source_height": 4000,
  "counts": [0, 12, 8]
}
```

`counts` alternates background and foreground, starting with background. A foreground pixel in the first position produces a leading `0`. The mask's long side is at most 384. Scale it by `source_width / width` and `source_height / height` to line it up with the photo. Color extraction should use this mask later. It is not a color result.

`embedding` is null unless the request sets `include_embedding=true`. FashionCLIP returns 512 L2-normalized floats. MobileNet checkpoints do not currently return an embedding, so the field stays null for that backend.

Null means the component did not run or refused to guess. A missing garment does not get a full-frame box.

## Other statuses

Review keeps the best subcategory so the app can ask the user to confirm it.

Unclear sets `category`, `subcategory`, `confidence`, `bbox`, `mask`, `embedding`, and `alternatives` to null.

Errors:

```json
{
  "status": "error",
  "error": "unsupported_format",
  "message": "Use a JPEG, PNG, or WebP photograph.",
  "model_version": "closet-classifier-v1"
}
```

| HTTP | error | when |
| --- | --- | --- |
| 400 | `empty`, `corrupt`, `too_small`, `invalid_correction` | unreadable file, under 32 px, or a bad correction |
| 413 | `too_large` | over 12 MB |
| 415 | `unsupported_format` | not JPEG, PNG, or WebP |
| 500 | `model_error` | the model failed while scoring |
| 503 | `model_unavailable` | torch or transformers is not installed, or the MobileNet file is missing |

## Corrections

`POST /v1/garments/corrections` stores the original prediction, the corrected ids, the confidence, and `model_version`. `accepted_for_training` is false. The row is appended to `runs/corrections.jsonl`. It is not copied into `train.csv`.
