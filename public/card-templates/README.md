# Card template artwork

Background images for the business card templates. **No text on them** — the app
draws the shop name, owner, phone and GSTIN live on top, so one image serves
every shop.

## Files expected right now

The registry in `src/lib/card-templates.ts` points at these exact names. A
missing file is not fatal — the card falls back to a flat colour and the text
still renders — but the design will look wrong.

| Filename | Template | Artwork |
|---|---|---|
| `gold-fold.jpg` | Gold Fold | Folded ivory/gold panels, charcoal hexagon right |
| `blush-botanical.jpg` | Blush Botanical | Watercolour blush wash, floral branch top-right |

**Names must match exactly**, lowercase, including the `.jpg`.

## Adding more

1. Drop the image here with a short, hyphenated name.
2. Add one entry to `CARD_TEMPLATES` in `src/lib/card-templates.ts`.

No other code changes. See `docs/CARD-ARTWORK-BRIEF.md` for dimensions, safe
zones and the prompt structure that produces usable artwork.

## Specs

- **1050 × 600 px** (3.5 × 2 in at 300 dpi). 1536 × 1024 also works — the card
  scales it.
- **Under ~220 KB.** These load on mobile data. Compress before committing;
  a 2 MB background will be felt on a 3G connection.
- Keep the **left ~55% visually calm** — that is where the text lands.
