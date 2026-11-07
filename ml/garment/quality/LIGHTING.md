# Lighting check contract

Used by the phone camera (live red border) and by the server before classify/save.

## Response

```json
{
  "ok": false,
  "score": 0.42,
  "issues": ["too_dark", "uneven_shadow"],
  "guidance": "The photo is too dark. ...",
  "metrics": {
    "mean_luma": 40.2,
    "std_luma": 22.1,
    "shadow_frac": 0.21,
    "highlight_frac": 0.01,
    "uneven": 45.0
  }
}
```

- `ok` false → show a red border; do not enable save.
- `ok` true → clear border; capture may proceed.
- Issue ids the app can switch on: `too_dark`, `too_bright`, `low_contrast`, `shadow_clip`, `highlight_clip`, `uneven_shadow`.

Luma is Rec. 601: `0.299 R + 0.587 G + 0.114 B` on 0–255 sRGB.
