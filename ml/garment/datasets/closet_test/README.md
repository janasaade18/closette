# Closet test photos

Put one primary garment in each photograph. Vary the light, background, wrinkles, hangers, mirrors, and camera angle. Add a row to `manifest.csv` and keep the file under `images/`.

These photos are the test set. They are not for training and not for choosing the confidence threshold. `prepare.py` refuses to build splits if one of these files also appears in train or validation.

The manifest ships with a header only. Personal wardrobe photos are not committed with the code.
