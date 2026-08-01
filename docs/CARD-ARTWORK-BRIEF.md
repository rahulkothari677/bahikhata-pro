# Card artwork brief — how to make the template images

**For: generating the background artwork for EkBook's business card templates.**

Written 2026-07-29. Read this before generating anything — one detail (no text)
is the difference between artwork that works and artwork that has to be redone.

---

## The one rule that matters

> **Generate the artwork with NO TEXT on it.**

Your reference images have the name, phone and GSTIN baked into the picture.
That is right for a one-off card and wrong for a template, because every
shopkeeper needs their own details.

So: generate the **background only** — the curve, the photograph, the colour
blocks, the badges, the decorative flourishes. The app paints the text on top,
live, per shop. That means:

- the shopkeeper's real name and number appear, not a sample
- they can edit it
- the text stays razor-sharp when the card is printed or zoomed, where text
  baked into a JPEG turns fuzzy
- **one image serves every grocery shop in India**

---

## Size and safe areas

| | |
|---|---|
| **Dimensions** | **1050 × 600 px** (3.5 × 2 in at 300 dpi — standard Indian card) |
| Format | JPEG for photographic, PNG for flat colour |
| File size | Keep under **220 KB** — this loads on mobile data |

**Leave the left ~55% visually calm.** That is where the shop name, owner name
and contact lines go. Put the photography, the curve and the badges on the
**right side**, exactly as your reference images do — that layout instinct was
already correct.

```
┌──────────────────────────────┬───────────────────┐
│                              │                   │
│   KEEP CALM                  │   ARTWORK HERE    │
│   (text goes here —          │   photo, curve,   │
│    plain or lightly          │   badges, props   │
│    tinted background)        │                   │
│                              │                   │
└──────────────────────────────┴───────────────────┘
        ~55%                          ~45%
```

Keep anything important **4% away from every edge** — printers trim into it.

---

## Prompt structure that works

Whatever tool you used for the references, this shape gets a usable result:

> Professional business card **background** design, [CATEGORY] theme,
> **no text, no words, no letters, no logo**.
> Left 55% is clean [COLOUR] space for text.
> Right side has [SUBJECT] photography behind a smooth [COLOUR] curve.
> [ACCENT] accents, soft studio lighting, premium commercial quality.
> Horizontal, 1050×600, flat lay, high detail.

**Always include "no text, no words, no letters".** Image models add gibberish
lettering by default, and gibberish under real text looks broken.

### Per category

| Category | Subject | Palette |
|---|---|---|
| **Grocery / kirana** | vegetable basket, greens, grains | deep green + cream |
| **Pharmacy** | vials, capsules, blister packs, GMP-style seal | medical blue + white |
| **Fruit** | mixed fruit, wooden crate | orange + green |
| **Gifts / boutique** | wrapped boxes, ribbon, roses | rose pink + gold |
| **Textile** | folded fabric, thread spools | maroon / indigo + gold |
| **Hardware** | tools, fittings, workbench | steel grey + safety orange |
| **Food / restaurant** | thali, spices, tandoor | terracotta + saffron |
| **Finance / services** | abstract gold curve, guilloche | matte black + gold |
| **Festive (Diwali)** | diyas, lanterns, mandala, marigold | deep purple/maroon + gold |
| **Patriotic** | tricolour sweep, chakra, monuments | saffron, white, green |

Two or three variants per category is plenty. **A gallery of 20 excellent
templates beats 50 mediocre ones** — every weak one makes the whole set look
cheap.

---

## Where to put the files

**Option A — bundled** (simplest, best for the launch set)

Drop them in `public/card-templates/` with sensible names:

```
public/card-templates/
  kirana-fresh.jpg
  pharmacy-clinical.jpg
  festive-diwali.jpg
```

**Option B — Cloudinary** (better once there are many)

You already have Cloudinary configured. Upload there and use the URL. This
keeps them out of the app bundle and lets you add templates without a deploy.

---

## Then tell me, and I add the entry

For each image I need four things, and the first two you already know from
looking at it:

1. **Which side is calm** (almost always the left)
2. **Is the text area light or dark** — decides ink colour
3. **Category** — from the table above
4. **A name** shopkeepers will recognise ("FreshMart", "MediCare")

I add one object to `src/lib/card-templates.ts` and the template appears in the
picker. **No code changes** — the registry is the whole interface.

---

## Why this is the right approach, briefly

I tried twice to draw this artwork in code — first as minimal letterpress, then
as hand-authored SVG scenes. Both were rejected, correctly. Vector drawing
cannot reach photographic quality, and pretending otherwise wastes your time.

Every app with a good template gallery works the way described here: a designer
makes the artwork once, the app composites live text. Canva, Vyapar and
myBillBook all do exactly this. You already produced eight images of the right
quality, which means the hard part is done — the app just has to use them.

---

## The spec, in code

The numbers above are also in `ARTWORK_SPEC` in `src/lib/card-templates.ts`, so
this document and the code cannot drift. If one changes, change both.
