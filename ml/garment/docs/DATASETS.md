# Datasets

Public fashion sets are for training and validation only. The closet test set is held out and is labeled by hand. Do not commit images, checkpoints, or credentials.

## Sources

**DeepFashion2** (Liu et al.). Commercial use is not allowed under its research license. Download it from the authors after requesting access. Expected layout:

```
<root>/train/image/*.jpg
<root>/train/annos/*.json
<root>/validation/image/*.jpg
<root>/validation/annos/*.json
```

**Fashionpedia** (Jia et al.). Annotations are CC BY 4.0. The photographs come from Flickr and keep their own licenses, so they are not redistributed here. Expected layout:

```
<root>/train_images/ or <root>/images/
<root>/annotations/instances_attributes_train2020.json
<root>/annotations/instances_attributes_val2020.json
```

Fashion-MNIST is not used. It is 28-pixel grayscale and only ten coarse classes. ModaNet is a possible later source for coarse boxes. It is not wired into `prepare.py`.

Mapped labels are listed in `taxonomy.json` under `sources`. Combined classes such as `shirt, blouse` and a generic `shoe` are omitted. Weak rows stay in the CSV with `label_quality=weak`.

## Prepare

```bash
python prepare.py --deepfashion2 D:\data\deepfashion2 --fashionpedia D:\data\fashionpedia
```

Outputs:

```
datasets/processed/classifier/{train,val}/<subcategory>/*.jpg
datasets/processed/detector/closette.yaml
datasets/train.csv
datasets/val.csv
datasets/test.csv
datasets/class_counts.json
```

Each CSV row has `image`, `category`, `subcategory`, `split`, `source`, `source_label`, `label_quality`, `source_id`, and `bbox`.

Official train and validation splits are kept. A source photo is identified by dataset plus path, and by an 8×8 average hash. If that photo would land in two splits, the extra copy is dropped. `test.csv` is filled only from `datasets/closet_test/manifest.csv`, and prepare stops if a closet photo collides with train or val.

## Closet test set

`datasets/closet_test/` is the real-world set: one garment per photo, with mixed light, wrinkles, hangers, mirrors, and angles. Add files under `datasets/closet_test/images/` and a row in `manifest.csv`:

```csv
image,category,subcategory,notes
white-tee.jpg,tops,t-shirt,window light, on a hanger
```

`notes` is free text. Leave the manifest header-only until those photos exist. Do not tune thresholds or pick checkpoints on this set; score it once with:

```bash
python evaluate.py --manifest datasets/closet_test/manifest.csv --images datasets/closet_test/images
```

The report is `runs/evaluation.json`. It includes accuracy, macro-F1, per-class precision and recall, the confusion matrix, and mean latency. Classes with no support are left out of the macro average.
