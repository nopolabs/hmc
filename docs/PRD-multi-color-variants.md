# PRD: Multi-Color Variant Support for HMC Cycling Store

**Status:** Final — ready for implementation  
**Date:** 2026-04-16

---

## Background

The store originally modeled each product/color combination as a separate Printful product. With growing color offerings this has become unmanageable. The new approach treats each shirt style × logo-placement as a single product with two variant dimensions: **color** and **size**. No backward compatibility with the old `products-config.json` structure or generated files is required.

---

## Printful Catalog

Six products are configured in Printful (source of truth: `docs/printful-products.json`). These are the six store products.

| Printful Product Name | Folder | Colors | Sizes |
|---|---|---|---|
| Women's Basic Softstyle T-Shirt HMC Crow Front and Back | `womens_softstyle-front_and_back` | Azalea, Black, Irish Green, Navy, Red, Royal, White | S M L XL 2XL |
| Women's Basic Softstyle T-Shirt HMC Crow Front Only | `womens_softstyle-front_only` | same 7 | S M L XL 2XL |
| Unisex T-Shirt HMC Crow Front and Back | `unisex-front_and_back` | Aqua, Cardinal, Forest, Mustard, Navy, Pink, Teal, Vintage Black, White | XS S M L XL 2XL |
| Unisex T-Shirt HMC Crow Front Only | `unisex-front_only` | same 9 | XS S M L XL 2XL |
| Women's Relaxed T-Shirt HMC Crow Front And Back | `womens_relaxed-front_and_back` | Black, Forest Green, Heather Deep Teal, Heather Red, Heather True Royal, Leaf, Maroon, Navy, Pink, White | S M L XL 2XL 3XL |
| Women's Relaxed T-Shirt HMC Crow Front Only | `womens_relaxed-front_only` | same 10 | S M L XL 2XL 3XL |

All Printful retail prices are $20.00 (though Printful charges more for larger sizes internally; we override with a flat price).

---

## Mockup Image Mapping

Mockups live in `mockups/{folder}/`. The mapping from Printful color name to filename slug is: lowercase, spaces replaced with hyphens. Examples: `"Irish Green"` → `irish-green`, `"Vintage Black"` → `vintage-black`, `"Heather Deep Teal"` → `heather-deep-teal`.

Filename pattern within each folder:
```
{product-base}-{color-slug}-{view}-{id}.png
```

- `front_and_back` folders contain one `front` and one `back` image per color.
- `front_only` folders contain one `front` image per color.

At sync time, `sync-products.js` resolves mockups for each product by scanning its folder and matching color slugs. The front image is the main/default card image; the back image (where present) becomes an alternate thumbnail.

---

## Color Ordering

Default color display order on each product card:

1. **White first** (always)
2. Remaining colors in chromatic (hue-wheel) order: Reds/Pinks → Orange/Yellow → Greens → Teals/Blues → Purples → Neutrals (ending with Black/Vintage Black)

Approximate ordering for known colors:
```
White → Red → Cardinal → Heather Red → Maroon → Azalea → Pink →
Mustard → Forest → Irish Green → Forest Green → Leaf →
Teal → Heather Deep Teal → Aqua → Navy → Royal → Heather True Royal →
Black → Vintage Black
```

`products-config.json` can override the order per product with a `color_order` array. Colors listed in the array are shown in that order; colors **absent from the array are hidden** (disabled). If `color_order` is omitted entirely, all colors are shown in the default chromatic order above.

---

## `products-config.json` — New Shape

```json
[
  {
    "slug": "69e05ba41a5e83",
    "printful_product_id": 428417969,
    "mockup_folder": "womens_softstyle-front_and_back",
    "active": true,
    "name": "Women's Softstyle T-Shirt (Front & Back)",
    "description": "Semi-fitted everyday tee. 100% ring-spun cotton.",
    "price": 20.00,
    "main_image": "mockups/womens_softstyle-front_and_back/womens-basic-softstyle-t-shirt-white-front-69e05cfd5a8df.png",
    "color_order": ["White", "Navy", "Black", "Red", "Royal", "Irish Green", "Azalea"]
  }
]
```

### Fields

| Field | Required | Description |
|---|---|---|
| `slug` | yes | Printful `sync_product.external_id`. Used as the product key throughout (URL, cart, worker). |
| `printful_product_id` | yes | Printful `sync_product.id`. Used to fetch variant data. |
| `mockup_folder` | yes | Subfolder of `mockups/` containing this product's images. |
| `active` | no | Default `true`. When `false`, excluded from sync and not shown in the store. |
| `name` | no | Display name override. Falls back to Printful product name. |
| `description` | no | Shown under the product name on the card. |
| `price` | no | Flat retail price for all variants (all colors, all sizes). Falls back to the Printful `retail_price` of the first variant. The flat price exists because Printful charges more for XL/2XL/3XL but we charge a single price regardless. |
| `main_image` | no | Hero image path for the card before a color is selected. Falls back to the front mockup for White (or the first color in `color_order`). |
| `color_order` | no | Array of Printful color names in desired display order. Colors absent from this array are hidden. If omitted, all colors shown in default chromatic order. |

### Generating a Default `products-config.json`

`sync-products.js --init` reads `docs/printful-products.json` (already fetched) and writes a `products-config.json` with:
- One entry per Printful product
- `slug` = `sync_product.external_id`
- `printful_product_id` = `sync_product.id`
- `mockup_folder` = derived from the product name (see mapping below)
- `active: true`
- `name` = Printful product name
- `price` = `sync_variants[0].retail_price` as a number
- `main_image` = the front mockup for White (first matching file in the folder)
- `color_order` omitted (all colors shown)

If `products-config.json` already exists, `--init` refuses to overwrite (exit with error) unless `--force` is also passed.

**Printful product name → `mockup_folder` mapping** (hardcoded in sync script):

| Contains in name | `mockup_folder` |
|---|---|
| "Women's Basic Softstyle" + "Front and Back" | `womens_softstyle-front_and_back` |
| "Women's Basic Softstyle" + "Front Only" | `womens_softstyle-front_only` |
| "Unisex" + "Front and Back" | `unisex-front_and_back` |
| "Unisex" + "Front Only" | `unisex-front_only` |
| "Women's Relaxed" + "Front And Back" | `womens_relaxed-front_and_back` |
| "Women's Relaxed" + "Front Only" | `womens_relaxed-front_only` |

---

## Generated Files

### `src/_data/products.json`

```json
[
  {
    "slug": "69e05ba41a5e83",
    "name": "Women's Softstyle T-Shirt (Front & Back)",
    "description": "Semi-fitted everyday tee. 100% ring-spun cotton.",
    "price": "20.00",
    "main_image": "/mockups/womens_softstyle-front_and_back/womens-basic-softstyle-t-shirt-white-front-69e05cfd5a8df.png",
    "colors": [
      {
        "name": "White",
        "images": {
          "front": "/mockups/womens_softstyle-front_and_back/womens-basic-softstyle-t-shirt-white-front-69e05cfd5a8df.png",
          "back": "/mockups/womens_softstyle-front_and_back/womens-basic-softstyle-t-shirt-white-back-69e05cfd5b26e.png"
        },
        "sizes": [
          { "size": "S", "external_id": "69e05ba41a5f23" },
          { "size": "M", "external_id": "69e05ba41a5f81" },
          { "size": "L", "external_id": "..." },
          { "size": "XL", "external_id": "..." },
          { "size": "2XL", "external_id": "..." }
        ]
      }
    ],
    "size_guide": { "product_measure": {...}, "measure_yourself": {...} }
  }
]
```

- `images.back` is omitted for `front_only` products.
- `external_id` is `sync_variants[].external_id` from Printful (not the internal `id`).
- Sizes within each color are ordered S → M → L → XL → 2XL → 3XL → XS (standard apparel order).

### `worker/src/products.js`

```js
// AUTO-GENERATED by sync-products.js — do not edit manually
export const PRODUCTS = {
  "69e05ba41a5e83": {
    name: "Women's Softstyle T-Shirt (Front & Back)",
    price: 2000,
    variants: {
      "White": {
        "S":   { printful_variant_id: 5270106489 },
        "M":   { printful_variant_id: 5270106491 },
        "L":   { printful_variant_id: 5270106493 },
        "XL":  { printful_variant_id: 5270106495 },
        "2XL": { printful_variant_id: 5270106497 }
      }
    }
  }
};
```

---

## Checkout Flow

### Worker — `GET /checkout`

New signature: `GET /checkout?slug=<slug>&color=<color>&size=<size>`

- `slug` — product external_id
- `color` — Printful color name (e.g. `White`, `Irish Green`)
- `size` — size string (e.g. `M`, `2XL`)

Lookup: `PRODUCTS[slug].variants[color][size].printful_variant_id`

Returns 400 if any parameter is missing or the `(slug, color, size)` combination is not found.

Price is taken from `PRODUCTS[slug].price` (the flat per-product price in cents), ignoring whatever Printful charges for that variant. This is how we absorb the cost difference for larger sizes.

### Cart Item Payload (frontend)

The cart item gains a `color` field:
```js
{ slug, name, color, size, price, image }
```

The checkout URL built by the cart drawer becomes:
```
/checkout?slug={slug}&color={encodeURIComponent(color)}&size={size}
```

---

## Shop Page (`src/index.liquid`)

The page remains a single scrollable grid of 6 product cards. Changes to each card:

### Product card structure

1. **Main image** — shows `product.main_image` on load. Swaps to the front mockup of the selected color when a color swatch is clicked.

2. **Color swatches** — a row of colored circles, one per color in `product.colors`. Clicking a swatch:
   - Highlights the selected swatch (ring/border)
   - Updates the main image to that color's front mockup
   - Resets the size dropdown to "Select"
   - Back thumbnail (if present) also becomes available as a secondary thumbnail

3. **Back thumbnail** — for front_and_back products, a small thumbnail showing the back of the currently selected color. Clicking it swaps the main image to the back mockup (same pattern as existing thumbnail JS).

4. **Size dropdown** — unchanged in behavior; options are the sizes for the selected color (consistent across all colors per product, but the data model allows per-color sizes).

5. **Add to Cart button** — disabled / shows "Select color & size" until both color and size are chosen.

6. **Price** — a single flat price displayed (no per-size variance shown to user).

### Color swatch rendering

Color names map to CSS background colors via a lookup table in the template or a small JS object. Hex values for known colors:

| Color name | Hex |
|---|---|
| White | `#FFFFFF` |
| Black | `#1a1a1a` |
| Vintage Black | `#2d2d2b` |
| Navy | `#1a2744` |
| Royal | `#1a4ba0` |
| Heather True Royal | `#4466bb` |
| Teal | `#007b8a` |
| Heather Deep Teal | `#2d7d7a` |
| Aqua | `#47c5d4` |
| Irish Green | `#009a44` |
| Forest | `#2d5016` |
| Forest Green | `#2d5016` |
| Leaf | `#5a7a3a` |
| Mustard | `#c8922a` |
| Red | `#cc2222` |
| Cardinal | `#9b1b2a` |
| Heather Red | `#bb4444` |
| Maroon | `#6b1a2a` |
| Pink | `#f4a0b0` |
| Azalea | `#f06080` |

Swatches with a very light color (White) get a visible border so they don't disappear against the card background.

---

## `sync-products.js` Changes

### New flags

| Flag | Behavior |
|---|---|
| (none) | Sync: read `products-config.json`, fetch Printful data, write generated files |
| `--list` | List Printful products and their IDs (unchanged) |
| `--json` | Dump raw Printful API JSON (unchanged) |
| `--init` | Generate a default `products-config.json` from `docs/printful-products.json` (no network call). Refuses to overwrite without `--force`. |

### Sync logic changes

1. Read the new `products-config.json` shape.
2. For each active product, fetch `sync_variants` from Printful.
3. Apply `color_order` filter: if `color_order` is present, only include listed colors in that order. If absent, include all colors in default chromatic order.
4. For each color, find the matching front (and back) mockup by scanning the `mockup_folder` directory: find files matching `*-{color-slug}-front-*.png` and `*-{color-slug}-back-*.png`.
5. Group variants by `(color, size)` using `sync_variants[].color` and `sync_variants[].size`.
6. Resolve `main_image` from config, or fall back to front mockup of White (or first color in order).
7. Fetch size guide (unchanged).
8. Write `src/_data/products.json` and `worker/src/products.js` in new shapes.

The `--init` path reads `docs/printful-products.json` locally (no network needed), derives `mockup_folder` from product name, and writes `products-config.json`.

---

## Out of Scope

- Pagination (≤6 products)
- Per-color or per-size pricing
- Product detail pages
- Preview mode changes (existing `site.json` `preview` flag behavior unchanged)
- Inventory/availability tracking beyond Printful `availability_status: "active"`
- Size guide changes
