# Datasets

Public fashion sets are for training and validation only. The closet test set is held out and is labeled by hand. Do not commit images, checkpoints, or credentials.

## Sources used in this MVP

| Source | License | Why we use it | Why we do not use all of it |
| --- | --- | --- | --- |
| **Fashionpedia** (Jia et al.) | Annotations CC BY 4.0; photos keep Flickr licenses | Dress, skirt, coat, jacket, trousers, shorts, jumpsuit, bag, belt, hat, scarf, sweater | Combined classes such as `shirt, blouse` and generic shoe are not mapped |
| **Clothing dataset** (Grigorev et al.) | **CC0** (commercial OK) | T-shirt, polo, blouse, hoodie, blazer, shirt, plus more tops | Kids photos skipped. `Shoes`, `Top`, `Body` are too coarse and are not mapped. `Pants` → trousers (weak), not jeans |
| **DeepFashion2** (Liu et al.) | Research / non-commercial | Optional later for tops and dresses | Not downloaded here without the author form password. Commercial use is not allowed |
| **ModaNet** | CC BY-NC 4.0 | — | Non-commercial. Coarse classes (top, pants, outer). Not wired in |
| **UT Zappos50K** | Academic, non-commercial | — | Would help boots/sandals, but Closette is a product. Not used for training weights we might ship |

Fashion-MNIST is not used (28-pixel grayscale, ten coarse classes).

Mapped labels live in `taxonomy.json` under `sources`. Weak rows stay in the CSV with `label_quality=weak`.

## Gaps that public sets still do not fill cleanly

These Closette ids still lack a clean, commercial-friendly public source after the sources above:

jeans, chinos, sweatshirt, romper, trench-coat, raincoat, sneakers, boots, sandals, formal-shoes, flats, heels, gloves

Until those exist (team photos or a licensed set), a supervised checkpoint **cannot** cover every taxonomy id. The live API stays on FashionCLIP for full coverage. A partial MobileNet is never loaded by default.

## Expected layouts

**Fashionpedia**

```
<root>/train_images/ or <root>/images/ or <root>/train/
<root>/val_images/ or <root>/test/
<root>/annotations/instances_attributes_train2020.json
<root>/annotations/instances_attributes_val2020.json
```

**Clothing dataset (CC0)**

```
<root>/images/*.jpg
<root>/images.csv
```

Clone or unzip from https://github.com/alexeygrigorev/clothing-dataset

**DeepFashion2** (optional, research only)

```
<root>/train/image/*.jpg
<root>/train/annos/*.json
<root>/validation/image/*.jpg
<root>/validation/annos/*.json
```

## Prepare

```bash
python prepare.py --fashionpedia datasets/raw/fashionpedia --clothing-dataset datasets/raw/clothing-dataset
```

Optional: add `--deepfashion2 D:\data\deepfashion2` when that archive is unlocked.

Outputs:

```
datasets/processed/classifier/{train,val}/<subcategory>/*.jpg
datasets/processed/detector/closette.yaml
datasets/train.csv
datasets/val.csv
datasets/test.csv
datasets/class_counts.json
```

Official Fashionpedia splits are kept. Clothing-dataset uses a deterministic 9:1 train/val split after skipping kids photos. A source photo is identified by dataset plus path, and by an 8×8 average hash. If that photo would land in two splits, the extra copy is dropped. `test.csv` is filled only from `datasets/closet_test/manifest.csv`.

## Closet test set

`datasets/closet_test/` is the real-world set. Do not tune thresholds or pick checkpoints on this set; score it once with:

```bash
python evaluate.py --manifest datasets/closet_test/manifest.csv --images datasets/closet_test/images
```

Switch the API off FashionCLIP only when a checkpoint’s `class_names` equal the full taxonomy **and** that run beats FashionCLIP on these 26 photos.
