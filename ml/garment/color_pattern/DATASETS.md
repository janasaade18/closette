# Dataset inventory

Color has no training set. Pattern and texture photos live outside the git repo in `tools/datasets` next to the `closette` folder. Set `CLOSETTE_DATASETS` if that folder is somewhere else. Do not commit the images.

| Dataset | What it is used for | Color labels | Pattern or texture labels | License | On disk |
| --- | --- | --- | --- | --- | --- |
| None for color | Report section 3.2: no training set. K-Means only. | Closette names are fixed swatches in `palette.py`, converted to CIELAB at runtime. | — | n/a | Swatches only |
| DeepFashion Category and Attribute Prediction | Report section 3.3 names this 1,000-attribute set. It was not reachable. | Coarse attributes, not this HEX palette | stripe, floral, graphic, and the rest of the 1,000-attribute list | Non-commercial research. Do not redistribute. | Not downloaded. Drive folder `0B7EVK8r0v71pQ2FuZ0k0QnhBQnc` returns 401. Dropbox annotation link returned HTML. |
| DeepFashion-MultiModal (`Tehreem07/deepfashion`) | Pattern phrases in captions, plus `upper_fabric` ids. 42,544 shop photos, 11 parquet shards, about 6.62 GB. | `upper_color`, `lower_color`, `outer_color` (8 ids, not the Closette names) | solid, stripe, lattice (checked), plaid, floral, graphic, color block, other. Fabric ids: denim, cotton, leather, fur, knit, chiffon, other. No polka, animal, or camouflage phrases in the captions. | Same DeepFashion non-commercial terms. | Complete at `tools/datasets/deepfashion-multimodal`. |
| Clothing pattern (`0x-Jayveersinh-Raj/clothing-pattern-dataset`) | Polka dots. Only the `Dot` rows are used (611). Arrow files, not parquet. | Not used | `Dot` → `polka_dot` | No license card on the dataset page. | Complete at `tools/datasets/clothing-pattern`. |
| Secondhand clothing (`wargoninnovation/clothingdatasetsecondhand`) | Animal print, extra polka dots, and silk from free-text `material`. 43,132 rows. | Coarser color list, not used for the K-Means names | Pattern class `7` → `animal_print`, `10` → `polka_dot`. Material text supplies silk and extra fabric tags. | CC-BY-4.0 | Complete at `tools/datasets/clothing-secondhand`. |
| CamoNet synthetic (`Mattysmittttt/camonet-synthetic`) | Camouflage class. 8,000 synthetic 256×256 swatches. | Not used | Every `family` value maps to `camouflage` | CC-BY-4.0. Not worn-garment photos. | Complete at `tools/datasets/camonet-synthetic`. |
| DeepFashion2 | Garment type, not this task | No Closette palette | Not a pattern benchmark | Research / non-commercial | Category name map only, in `ml/garment/taxonomy.json`. |
| Fashionpedia | Garment type | Attributes exist upstream | Some (stripe, floral) | Research | Category map only. |
| Custom Gabor samples | Fallback head when `pattern_mobilenet.pt` is missing | Not used for color | solid, striped, checked, plaid, polka_dot, color_block, unknown | Generated here, not a public dataset | Not saved as images. `fit_pattern.py` builds 48 images per class in memory (seed 11). `evaluate.py` uses seed 7. |

`yainage90/fashion-pattern-images` (camouflage, dot, leopard, zebra on worn clothes) returned 401 and was not downloaded.

Google Scanned Objects and the Isaac shoe meshes are footwear demos on another branch. They are not color, pattern, or texture data.
