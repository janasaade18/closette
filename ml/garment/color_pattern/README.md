# Garment classification

One photo returns the primary garment from the type model, plus color, pattern, and fabric texture.

`RESEARCH.md` is the method choice. `DATASETS.md` is the source and license list. `EVALUATION.md` is the held-out scores.

## Setup

From `closette/backend`:

```powershell
pip install -r ml/garment/color_pattern/requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install pyarrow
```

`pillow` and `numpy` run color and the Gabor fallback. Pattern and texture labels use the saved MobileNet heads:

- `weights/pattern_mobilenet.pt`
- `weights/texture_mobilenet.pt`

`weights/pattern_head.npz` is the Gabor fallback used when the pattern file is missing. The first call rebuilds it with `fit_pattern.py`.

## Usage

```powershell
cd ml/garment/color_pattern
python pipeline.py path\to\photo.jpg
python pipeline.py path\to\photo.jpg --classification ..\detections.json
```

`detections.json` is optional. Omit it and `pipeline.py` asks the garment-type model for one primary garment: SegFormer for the box and mask, FashionCLIP for the name. A MobileNet checkpoint is used only when it covers the full taxonomy. Pass the file to reuse boxes that already include `group`, `type`, `confidence`, and `box`.

The API route is `POST /garments/appearance` (`file`, optional `classification` JSON, optional `k` from 5 to 8). It runs this same script and returns one object per garment.

```python
from pipeline import classify_photo

print(classify_photo("photo.jpg"))
```

## Response

`status` is `success`, `review`, `unclear`, or `failed`. `unclear` and `failed` return `garments: []`. A failed photo includes an `error`. Proportions inside each color sum to 1. Pattern or texture confidence below 0.55 becomes `unknown`. Color uses the type model's mask when one is returned.

`model_version` is `color-pattern-v1`.

```json
{
  "status": "success",
  "garments": [
    {
      "group": "top",
      "type": "t-shirt",
      "confidence": 0.91,
      "box": [10, 10, 200, 300],
      "color": {
        "primary": { "name": "navy", "hex": "#1C2A5C", "proportion": 0.62 },
        "secondary": [{ "name": "white", "hex": "#F5F5F0", "proportion": 0.38 }],
        "is_multicolor": true
      },
      "pattern": { "primary": "striped", "confidence": 0.81 },
      "texture": { "primary": "cotton", "confidence": 0.7 }
    }
  ],
  "model_version": "color-pattern-v1"
}
```

## Tests

```powershell
cd ml/garment/color_pattern
python -m unittest test_pipeline.py
python evaluate.py
```

`evaluate.py` scores the Gabor head on generated cloth. The photo-model scores are in `EVALUATION.md`.

## Limitations

- Color names come from a fixed swatch list. An unusual dye lands on the nearest name.
- Plaid is weak on the photo model. Abstract print has no training photos. Camouflage was trained on synthetic swatches.
- Leather, fur, silk, and other had fewer than 220 images each.
- Color uses the SegFormer mask when the type model returns one. A loose box with no mask still includes background.
- Each API call starts a new Python process. The first response downloads FashionCLIP (about 600 MB) and SegFormer (about 110 MB) into the Hugging Face cache, then loads the pattern and texture heads.
- `torch` and `transformers` have to be installed. `detector.pt` is not used for this single-garment result.
