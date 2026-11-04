# Evaluation

Two different checks. The API uses the photo models. `evaluate.py` scores the older Gabor head on drawings.

## Photo models

Pattern head `weights/pattern_mobilenet.pt`. MobileNetV3-Small, ImageNet backbone frozen, last linear layer only. Adam, learning rate 1e-3, batch 16, 2 epochs, CPU. Up to 400 images per class. Held-out split is 15% by `zlib.crc32` of the file name.

Epoch 1 loss 1.1560. Epoch 2 loss 0.7876.

| Metric | Value |
| --- | --- |
| Accuracy | 0.755 |
| Test images | 731 |

| Class | Recall |
| --- | --- |
| solid | 0.803 |
| striped | 0.812 |
| checked | 0.679 |
| plaid | 0.153 |
| polka_dot | 0.832 |
| floral | 0.904 |
| graphic_print | 0.586 |
| camouflage | 1.000 |
| animal_print | 0.847 |
| color_block | 0.825 |
| other | 0.746 |

`abstract_print` had no training images, so it is not in this table. Camouflage recall is on synthetic CamoNet swatches, not photos of worn clothes. Polka dots and animal print are clothing photos.

Texture head `weights/texture_mobilenet.pt`. Same training setup.

| Metric | Value |
| --- | --- |
| Accuracy | 0.728 |
| Test images | 334 |

Epoch 1 loss 1.3175. Epoch 2 loss 0.8879. The texture log does not record per-class recall. Training caps were 400 for cotton, denim, knit, and chiffon. Leather, fur, silk, and other kept every labelled photo: 117, 135, 216, and 90.

A winning score under 0.55 returns `unknown` for both heads.

## Gabor drawings

`evaluate.py` calls `classify_gabor`. Images are generated in that script with seed 7. The Gabor head is fit with seed 11 in `fit_pattern.py`. Nothing is shared between the two.

12 images per class. Classes scored: solid (with a lighting gradient), striped (gap varies), checked, plaid, polka_dot, color_block, unknown (pixel noise).

| Metric | Value |
| --- | --- |
| Accuracy | 0.988 |
| Macro-F1 | 0.988 |

| Class | Precision | Recall | F1 |
| --- | --- | --- | --- |
| solid | 1.000 | 1.000 | 1.000 |
| striped | 1.000 | 0.917 | 0.957 |
| checked | 1.000 | 1.000 | 1.000 |
| plaid | 1.000 | 1.000 | 1.000 |
| polka_dot | 1.000 | 1.000 | 1.000 |
| color_block | 1.000 | 1.000 | 1.000 |
| unknown | 0.923 | 1.000 | 0.960 |

Confusion: 11 of 12 stripes were striped. 1 stripe was `unknown` because its confidence fell under 0.55. It was not labelled as another pattern. Every other scored image matched its class. Unknown precision is 0.923 because that one abstention is counted as an unknown prediction.

These drawings are out of domain for the photo model. A flat navy rectangle can come back `unknown` from `classify_pattern` even when `classify_gabor` says solid. The unit tests call `classify_gabor` for the geometric cases.

Color checks in `test_pipeline.py` (separate from the tables above):

- A shaded navy crop stays navy, proportions sum to 1, and it is not multicolor.
- A navy / cream split is multicolor and includes navy.
- A red garment on a white field, cropped with the classifier box, is red.

## Limits

- The 0.755 and 0.728 figures are the photo-model scores. The 0.988 figure is generated cloth only.
- Plaid on real photos is weak. Abstract print is untrained. Worn camouflage photos were not in the training set.
- Lighting, occlusion, and wrinkles in a phone wardrobe are only partly represented by the shop and secondhand photos.
