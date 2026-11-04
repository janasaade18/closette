# Baseline choice

The summer Closette garment research picked an on-device model and left a heavier check for a server. This package is that server. It does not replace the on-device plan.

## What the summer research decided

MobileNetV3-Large was the on-device classifier: ImageNet weights, the last layer replaced, then fine-tuned on DeepFashion2. The target was 90% top-1. EfficientNet-B0 was the documented fallback if that target was missed, because it is a bit more accurate and a bit slower. EfficientNet-B4 was described as a later background check, not the first model.

ViT and ResNet-50 were turned down for the phone. A Vision Transformer needs more data and is heavy on device. ResNet-50 is a common fashion baseline, but a 2–3 second scan while someone uploads a wardrobe is too slow if inference stays on the phone. The research also wanted a `ClassifierService` boundary so the app can call `classify` without knowing which model ran. This HTTP API is that boundary.

Those notes assumed on-device inference for privacy, offline use, and latency. This task is the server pipeline, so a heavier pretrained model is acceptable here. MobileNetV3-Large remains the supervised training path in `train_classifier.py`, and it is still the right on-device model when weights are exported later.

## Candidates

| model | task | weights | fit for Closette |
| --- | --- | --- | --- |
| FashionCLIP ViT-B/32 (`patrickjohncyh/fashion-clip`) | zero-shot subcategory labels and a 512-d embedding | open weights, research release | Covers the full taxonomy without a training set. Trained on Farfetch catalog photos, so home photos with wrinkles, hangers, and bad light are a real risk. The model card says it was not built as a deployed product and should be checked in this setting. |
| MobileNetV3-Large, then EfficientNet-B0 | supervised subcategory classification | ImageNet, then Closette crops | Matches the summer choice. Cannot learn polo, jeans, or trench coat until those labels exist. A partial checkpoint is not loaded by the API, so it cannot silently drop the missing classes. |
| SegFormer-B2 clothes (`mattmdjaga/segformer_b2_clothes`) | semantic segmentation into coarse clothes regions | public checkpoint | Gives a real mask and box for one primary garment. It does not know Closette's fine ids. Left and right shoes are merged. Two garments of the same class become one region. |
| YOLOv8n fine-tune | multi-garment boxes | trained from `prepare.py` output | Useful later, when a photo can hold several items. Not required for the one-garment MVP. Training it from scratch was not justified. |

No accuracy number is claimed in this document. Catalog benchmarks, including FashionCLIP's published zero-shot scores, are not a substitute for the closet test set. `evaluate.py` writes accuracy, macro-F1, per-class precision and recall, the confusion matrix, and mean latency when that set exists.

## MVP baseline

FashionCLIP zero-shot for the subcategory, with the category taken from the taxonomy parent. SegFormer for the mask and the box. Abstain under 0.20, and ask for review under 0.35, on a close lookalike pair, or when the mask's coarse region disagrees with the category.

Fine-tuning MobileNet is ready and should run after `prepare.py`, then be compared with FashionCLIP on the same closet photos. Switch the API to the checkpoint only if that comparison wins and the checkpoint covers every taxonomy id. Until those photos and that run exist, shipping a trained-from-scratch number would be invented.

Home photos will be harder than DeepFashion2 and Fashionpedia crops. That gap is why `datasets/closet_test` is a held-out manual set and is not used to pick epochs.
