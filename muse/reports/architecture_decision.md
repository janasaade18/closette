# Muse v1: research and architecture decision

Muse recommends complete outfits from the wardrobe it is given. Version `muse-v1` is a deterministic baseline. It does not train a compatibility model and it does not run LinUCB on the request path.

## What was reviewed

Summer notes in the Closette resources folder:

- `Closette_Outfit_Reco_Research.txt` compares content-based filtering, collaborative filtering, static fashion rules, knowledge graphs, and transformer sequential models.
- `Style_Analytics.txt` is a separate wardrobe-insight idea (counts plus K-Means on wear). It is not the outfit ranker.
- `Closette_Color_Coding_Method_Research.txt` and `ml/garment/color_pattern` name colors in CIELAB. Muse reads those names. It does not cluster pixels.
- `Muse_ai_context_adaptation_6765.pdf` and `muse style embedding.pdf` are in the same folder. Their text is stored in encoded fonts, so this decision uses the written outfit note plus the published LinUCB method rather than a partial reading of those slides.
- The live garment taxonomy is `ml/garment/taxonomy.json`. Muse copies those category and subcategory ids.

LinUCB reviewed for later personalization: Lihong Li, Wei Chu, John Langford, and Robert E. Schapire, “A Contextual-Bandit Approach to Personalized News Article Recommendation,” WWW 2010. A linear model predicts reward from context features and adds an uncertainty bonus so the policy can explore. The useful Muse form is one shared weight vector. Each candidate outfit is an arm only for that request, described by the same features the baseline already computes. A fixed catalog of outfits does not fit Closette, because the wardrobe changes.

## Approaches considered

| Approach | Why it was set aside for v1 |
| --- | --- |
| Content-based filtering alone | The summer note is right that it cannot pick up taste and can repeat a safe look. V1 keeps content signals, and it does not pretend they are taste. |
| Collaborative filtering, NCF, Surprise, implicit, LightFM | Cold start, sparse early data, and recommendations that can name clothes the user does not own. |
| Static color and pattern rules as the whole model | Cultural, trendy, and subjective. The summer note rejects this. V1 does not ban a color pair. |
| Knowledge graphs | Called out of scope in the summer note. Building the graph is a project of its own. |
| BERT4Rec, SASRec, RecBole, Microsoft Recommenders | They need a long interaction history. The summer note says they collapse at cold start instead of falling back. |
| Polyvore compatibility plus MobileNet or FashionCLIP embeddings | The summer note’s hybrid plan. Polyvore was taken down in 2019, and this brief says not to train before a baseline exists. |
| MABWiser or another bandit library | A small shared LinUCB is enough to read and test. It stays unwired until logged feedback can be evaluated offline. |

## Decision

```
wardrobe + profile + context
        validate
        generate slot outfits
        hard rules
        weighted baseline rank
        diversity pass
        reasons + score
        store the recommendation for later feedback
```

Hard rules and ranking read separate config files: `compatibility_rules/config.json` and `ranking/weights.json`.

The baseline score is a weighted average of the features that have evidence. Missing color, formality, weather, or history leaves that feature out of the average. It is not filled in. With no evidence at all, the score is 0.5 and the reason says the outfit was built from wardrobe pieces that passed the rules. After at least three stored feedback events, and only when those events mention garments in the outfit, a small adjustment moves the score. A dismissal with no specific reason is a weak nudge. It does not delete the outfit.

`learned_model` is false on every v1 response. Three likes are a count, not a trained policy.

## Later personalization

`personalization/linucb.js` implements shared LinUCB and is covered by unit tests on synthetic rewards. `recommend()` returns `personalization_not_available` if a caller passes a LinUCB model or sets the config policy to anything other than `baseline`.

Turning it on needs two things this baseline does not claim:

1. Enough real feedback to evaluate a change.
2. Logged candidate features. The recommendation log already stores shown outfits and eligible outfits that were not shown, with their feature vectors, so a later offline check has something to replay. It does not store propensity scores, because v1 does not explore.

## Libraries

V1 depends only on the Node.js standard library. The Closette API process is already Node, and this baseline has no model to load. Garment classification and color stay in `ml/garment`. Nest should call Muse over HTTP. It should not import the ranker into the mobile client.
