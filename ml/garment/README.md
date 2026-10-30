# Closette garment classifier

Photograph in, garment category and subcategory out. This package is the server-side pipeline. It does not share code with the foot scanner.

```
photo -> validate -> segment -> crop -> classify -> JSON
```

Segmentation isolates the primary garment. Classification names it. Color extraction and outfit recommendation are separate and are not implemented here.

## Install

From `closette/ml/garment`:

```bash
python -m pip install -r requirements.txt
```

FashionCLIP and SegFormer are already in `weights/fashion-clip` and `weights/segformer`. Pull those folders with Git LFS. Do not download them again. `prefetch.py` is only for replacing those copies.

Detector training also needs `ultralytics`. It is not required to run the API.

## Run the API

```bash
python -m uvicorn inference.api:app --host 127.0.0.1 --port 8090
```

```bash
curl.exe -F "image=@photo.jpg" http://127.0.0.1:8090/v1/garments/classify
curl.exe http://127.0.0.1:8090/health
```

One image per request. JPEG, PNG, or WebP, up to 12 MB, at least 32 pixels on the short side. Optional query flags: `include_embedding=true`, `include_mask=false`.

The first call loads the weights. After that, `models.classifier` is `fashion-clip` and `models.segmenter` is `segformer-b2-clothes`.

Classify one file without the server:

```bash
python infer.py photo.jpg
```

## What the response means

`category` and `subcategory` are ids from `taxonomy.json` (version 2). `confidence` is the top softmax score between 0 and 1. It is not a calibrated probability.

| status | meaning |
| --- | --- |
| `success` | Score is at least 0.35, the runner-up is not a known lookalike, and the mask agrees |
| `review` | Show the guess and ask the user. `reason` is `low_confidence`, `ambiguous_pair`, or `localization_disagrees` |
| `unclear` | No garment region, or the score is under 0.20. Category and box are null |
| `error` | Bad file or a model failure. HTTP 400, 413, 415, 500, or 503 |

`bbox` is `[x_min, y_min, x_max, y_max]` in the original photo. The origin is the top-left, and the max edges are exclusive. `bbox` and `mask` are null when segmentation did not run or found nothing. They are never filled in with a guess.

The mask is row-major run-length encoding (`encoding: rle-row-major`), starting with background. Long photos are capped at 384 pixels on the long side; `source_width` and `source_height` are the original size.

FashionCLIP embeddings are 512-d and L2-normalized. They are omitted unless `include_embedding=true`. `model_version` is `closet-classifier-v1`.

Full contract: `docs/CONTRACT.md`. Taxonomy: `docs/TAXONOMY.md`.

## Taxonomy in the Nest API

`GET /garments/taxonomy` on the Nest app reads this same `taxonomy.json` and returns the groups. The mobile client should send photos to the Python service above, not to the foot-scan routes.

A correction is stored and is not added to training:

```bash
curl.exe -H "Content-Type: application/json" -d "{\"image_id\":\"photo-1\",\"predicted_category\":\"bottoms\",\"predicted_subcategory\":\"jeans\",\"corrected_category\":\"bottoms\",\"corrected_subcategory\":\"chinos\",\"confidence\":0.4,\"model_version\":\"closet-classifier-v1\"}" http://127.0.0.1:8090/v1/garments/corrections
```

`accepted_for_training` stays false until someone reviews the row in `runs/corrections.jsonl`.

## Data and training

Dataset sources, licenses, and the closet test set are in `docs/DATASETS.md`. The model comparison is in `docs/BENCHMARK.md`.

```bash
python prepare.py --deepfashion2 D:\data\deepfashion2 --fashionpedia D:\data\fashionpedia
python train_classifier.py
python evaluate.py --manifest datasets/closet_test/manifest.csv --images datasets/closet_test/images
```

`train_classifier.py` fine-tunes ImageNet MobileNetV3-Large on the prepared crops (seed 0). If validation top-1 stays under 0.90, rerun with `--backbone efficientnet_b0`. A checkpoint is used by the API only when its labels cover the whole taxonomy. Until then the API stays on FashionCLIP, which can name classes the public datasets do not separate (polo, jeans, trench coat, and the rest of the zero-shot list).

`train_detector.py` fine-tunes YOLOv8n for photos with several garments. The current API assumes one primary garment and uses SegFormer instead.

## Tests

```bash
python -m unittest discover -s tests -v
```

The tests inject a fake classifier and a fake mask. They do not download weights.

## Environment

| variable | effect |
| --- | --- |
| `CLOSETTE_CLASSIFIER=fashion-clip` | Force zero-shot, even if a checkpoint exists |
| `CLOSETTE_CLASSIFIER=mobilenet` | Require `weights/classifier.pt` |
| `CLOSETTE_SEGMENTER=none` | Classify the full frame and return a null box and mask |
