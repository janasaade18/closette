# Color and pattern: method selection

Written from the Closette methods report (color section 3.2, pattern section 3.3) and the texture research note. This task does not replace `ml/garment/infer.py`. It takes the photo and that classifier output (highest-confidence box) and returns colors, one pattern label, and one fabric texture.

## Color

The report does not name a color training set. It asks for unsupervised K-Means in CIE LAB after the garment is isolated, with K chosen in a small range, and an output of color name, hex, and coverage.

Rejected in the report, and not used here: K-Medoids, DBSCAN, Mean Shift, and histogram binning.

What this module does:

1. Crop with the classifier box. A segmentation mask is used when one is passed in.
2. Flatten slow shading on a single-hue crop. A crop whose chroma already varies (two or more real colors) is left alone so the second color is not washed out.
3. Convert sRGB to CIELAB. Cluster with K-Means on `[0.35 * L*, a*, b*]` so a shadow does not split one fabric, while black, grey, and white stay apart.
4. K is configurable and must be 5–8. Default is 6, inside the required range. The report’s elbow range is 3–5; the product spec asks for 5–8, so the API enforces the product range.
5. Drop clusters under 6% , merge pixels that share a name, and renormalize proportions so they sum to 1.
6. Name each cluster from the Closette list. Low-chroma colors are named by lightness (black, charcoal, grey, off-white, cream, white) so a cool cast does not turn black into navy. Other colors use the nearest swatch in CIELAB.

## Pattern

The report asks for CNN feature maps from a MobileNetV3 backbone, Gabor filter banks, and the DeepFashion attribute set plus custom-labelled samples. The official 1,000-attribute image zip was not reachable (Drive 401). Training uses the public DeepFashion-MultiModal captions plus the extra sets in `DATASETS.md`.

The live label is `weights/pattern_mobilenet.pt`:

- MobileNetV3-Small, ImageNet weights, backbone frozen, only the last linear layer trained.
- Adam, learning rate 1e-3, batch 16, 2 epochs, CPU. At most 400 images per class.
- Held-out accuracy 0.755 on 731 photos. See `EVALUATION.md`.
- A winning score below 0.55 returns `unknown`.

Labels that head can return: solid, striped, checked, plaid, polka_dot, floral, graphic_print, abstract_print, camouflage, animal_print, color_block, other, unknown. `abstract_print` had no images. Camouflage images are synthetic swatches.

The Gabor linear head (`weights/pattern_head.npz`, `fit_pattern.py`, seed 11) is the fallback when the MobileNet file is missing. `evaluate.py` scores that head with `classify_gabor`. It emits solid, striped, checked, plaid, polka_dot, color_block, and unknown.

## Texture

Fabric is separate from print. The research note prefers a CNN with Gabor-style texture cues. The live label is the same MobileNetV3-Small setup, saved as `weights/texture_mobilenet.pt`.

DeepFashion `upper_fabric` ids map to denim, cotton, leather, fur, knit, chiffon, and other. Silk is not one of those ids. It is taken from secondhand `material` text, along with extra photos for the other fabrics. Held-out accuracy 0.728 on 334 photos. A winning score below 0.55 returns `unknown`. A missing weights file returns `unknown` with confidence 0.

`model_version` is `color-pattern-v1`.
