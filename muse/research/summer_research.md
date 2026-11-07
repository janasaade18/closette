# Summer research notes used by Muse

Source: `Closette resources/Closette_Outfit_Reco_Research.txt`, read with the garment taxonomy and the color pipeline already in this repo.

The note rejects four designs for Closette’s current stage:

- Content-based filtering on color and pattern describes items and does not learn taste. It also repeats safe outfits.
- Collaborative filtering has no history for a new user, can recommend clothes the user does not own, and needs a dense user base Closette does not have yet.
- A static rule book of “navy goes with beige” or “only one pattern” is cultural and subjective, and it does not learn.
- Transformer sequential models such as BERT4Rec and SASRec need more outfit history than a new wardrobe provides. Requiring ten uploads before recommendations does not create a training set.

The note’s proposed next step was a hybrid: content features first, collaborative filtering later, with Polyvore outfits and a frozen MobileNet encoder. Polyvore was taken down in 2019. This version does not train that hybrid. The baseline keeps the part that works on day one: the user’s own garments, explicit constraints, occasion, and weather, with taste signals added only when feedback exists.

Style analytics in `Style_Analytics.txt` answers a different question (what is worn, what is ignored) with counts and K-Means. Muse does not cluster wear history.

Color names come from the Closette palette in `ml/garment/color_pattern/palette.py`. A missing color stays missing.
