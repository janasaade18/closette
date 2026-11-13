# Contextual bandits for Muse

Reference: Li, Chu, Langford, and Schapire, WWW 2010.

LinUCB assumes the expected reward of an arm is linear in a feature vector. The score shown to the policy is that prediction plus a bonus for uncertainty. Arms the model has rarely seen stay in the mix until the data shrinks the bonus.

For news, the arms are a stable set of articles. For Muse, the arms are outfits built from one person’s current wardrobe. Those outfits appear and disappear as clothes are added, hidden, or marked in the laundry. A separate covariance matrix per outfit would almost never see a repeat.

The fit is a shared linear model:

- The feature vector is the baseline vector in `ranking/rank.js`: occasion, style, garment type, color preference, color harmony, weather, and layer context.
- One design matrix `A` and one vector `b` are shared.
- Each request scores the candidates that already survived the hard rules.
- The reward comes from feedback: like and save are positive, worn is a stronger positive, a dislike with a specific reason is negative, and a dismissal or a dislike without a specific reason is a small negative.

`SharedLinUCB` in `personalization/linucb.js` is that update rule. Phase 2 fits one instance per user from logged feedback and blends it with the learned ranker (`personalization/fit.js`). Purchase events are included for future marketplace interactions.

Offline checks live in `ml/muse/evaluate_personalization.py`. Exploration stays off by default (`linucb_explore: false`) so Nest sees deterministic rankings; the uncertainty bonus remains available when we want logged propensities later.
