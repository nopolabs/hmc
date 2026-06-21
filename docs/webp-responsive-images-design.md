# WebP + Responsive Images — Design

Follow-up to the 2026-06 image optimization (mockups resized 2000px → 800px PNG,
177 MB → 35 MB). See `ROADMAP.md` → "WebP + Responsive Images (eleventy-img)".

## Goal

Serve **WebP at viewport-appropriate widths** with a PNG fallback. Each shirt
image goes from ~680 KB (800px PNG) to roughly **40–80 KB** delivered; homepage
imagery on first load drops from ~4 MB to well under 1 MB. WebP (the format
change) is most of the win; responsive widths add the rest.

## Constraints (why this isn't a plain eleventy-img drop-in)

1. **Image paths are data-driven, not template-inline.** They live in
   `src/_data/products.json` (`colors[].images.front/.back`) and are serialized to
   the client as `data-colors`. The eleventy-img `{% image %}` shortcode only
   helps template-inline images; the *client* needs the responsive sources too.
2. **JS swaps the image.** Random-color-on-load, swatch clicks, and front/back
   thumbnails all set `img.src` from the color data. Responsive sources must be
   swappable client-side.
3. **The cart consumes the image URL.** `Cart.add(…, color.images.front)` stores a
   string and the drawer renders it.
4. **Sync regenerates the data.** `sync-products.js` writes the product data; the
   enrichment must survive a re-sync.

## Decisions (approved)

1. **`srcset` (WebP) + `src` (PNG) fallback**, not `<picture>`. WebP is
   universally supported in 2026; this is simple to set from JS. Browsers pick a
   WebP from `srcset`; the PNG `src` is the floor.
2. **Generate at build, gitignored.** Derivatives are emitted into `_site/img/`
   (already covered by the `_site/` ignore) by eleventy-img during the data phase.
   The repo carries no extra binaries; Cloudflare Pages regenerates on each build.
3. **Keep the 800px PNGs as source + fallback.** Cards render ~340px (retina
   ~680px), so an 800px source is enough; no need to restore the 2000px originals.

## Architecture: enrich the data at build via eleventy-img

- Rename the sync output to **`src/_data/products.source.json`** (raw paths).
- Add **`src/_data/products.js`** (ESM, async) that:
  - imports `products.source.json`;
  - for each color's `front`/`back` image, runs `@11ty/eleventy-img` to emit
    `webp` + `png` at `[320, 480, 768]` into `_site/img/` (urlPath `/img/`);
  - replaces each image string with `{ src, srcset, width, height }` where
    `src` = the largest PNG (fallback), `srcset` = the WebP width set
    (`"…-320.webp 320w, …-480.webp 480w, …-768.webp 768w"`);
  - exports the enriched array as the `products` collection.
- eleventy-img wraps sharp and content-hashes filenames → free caching and
  cache-busting; re-running is cheap.

Source path mapping: data paths are site-root (`/mockups/folder/file.png`); strip
the leading slash to read from disk at `mockups/folder/file.png`.

`main_image` is left a string — the home page main `<img>` starts as a
transparent placeholder and JS sets it from the (enriched) color data, so
`main_image` is no longer rendered there.

## Derivative spec

- **Formats:** `webp` + `png`.
- **Widths:** `[320, 480, 768]` (source is 800px → no upscaling).
- **`sizes`:** `(max-width: 800px) 45vw, 30vw` for the main image (3-col grid →
  2-col under 800px); thumbnails use a small fixed `sizes` (~`120px`) so the
  browser picks the 320w variant.
- `width`/`height` set for layout stability (the wrapper already reserves a
  square, so this is belt-and-suspenders).

## Template + JS changes (`src/index.liquid`)

- `data-colors` automatically carries `srcset` once the data is enriched (it's
  serialized with `| json`).
- `selectColor()` / random pick / thumb swap set `img.src` **and** `img.srcset`
  **and** `img.sizes` (a `SIZES` constant for the main image, a smaller one for
  thumbs).
- `Cart.add(…)` passes `selectedColor.images.front.src` (the string), not the
  object.

## Sync coordination (`sync-products.js`)

- Write the front-end data to `src/_data/products.source.json` instead of
  `products.json`; `git mv` the current file. Update the header comment and
  `CLAUDE.md`/`SYNC_PRODUCTS.md` references.

## Verification

- `npm run build` → `_site/img/` contains webp+png at each width.
- `data-colors` in the built home page carries `srcset`.
- Curl a generated webp to confirm ~40–80 KB.
- Serve and confirm: random color loads a WebP, swatch + front/back swaps load
  WebP, cart still shows an image and checkout still works.
- Sanity: a build from a clean `_site/` regenerates derivatives.

## Out of scope / later

- `<picture>`/AVIF, art-direction, or LQIP blur-up.
- Optimizing the still-~960 KB about-page logo (separate, not data-driven).
