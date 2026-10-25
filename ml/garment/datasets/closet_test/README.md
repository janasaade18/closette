# Closet test photos

Put one primary garment in each photograph. Vary the light, background, wrinkles, hangers, mirrors, and camera angle. Add a row to `manifest.csv` and keep the file under `images/`.

These photos are the test set. They are not for training and not for choosing the confidence threshold. `prepare.py` refuses to build splits if one of these files also appears in train or validation.

Thirty-three public photos are in `images/` so the API can be tried before anyone uploads a wardrobe. The first 26 are the original gate. Seven more were added later to cover classes that gate never showed (polo, jeans, jacket, trousers, and a second pair of chinos). Each one was checked by eye and labeled in `manifest.csv`. Sources and licenses are in `SOURCES.md`. Personal wardrobe photos can be added the same way. Do not commit photos of people from the team.
