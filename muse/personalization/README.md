# Personalization

The request path is the baseline in `ranking/rank.js`.

`linucb.js` is a shared linear LinUCB. Unit tests check the matrix update on synthetic rewards. `recommend()` does not call it. Passing a model, or sending `"personalization": "linucb"`, returns HTTP 400 `personalization_not_available`.

The recommendation log keeps feature vectors for the outfits that were shown and the eligible outfits that were not. That is the hook for a later offline evaluation. It is not an online learner.

Read `research/contextual_bandits.md` before wiring this module into ranking.
