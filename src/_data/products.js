// Builds the `products` global for Eleventy.
//
// Reads the raw catalog (products.source.json, written by sync-products.js) and
// generates responsive image derivatives with @11ty/eleventy-img: WebP at a few
// widths (for `srcset`) plus a PNG fallback (for `src`). Each color image string
// becomes { src, srcset, width, height } so both the server-rendered markup and
// the client-side swatch/thumbnail/random-color swaps can be responsive.
//
// Derivatives are written to _site/img/ at build time (gitignored via _site/).
// See docs/webp-responsive-images-design.md.

import path from "node:path";
import { createRequire } from "node:module";
import Image from "@11ty/eleventy-img";

const require = createRequire(import.meta.url);
const raw = require("../../products.source.json");

const WIDTHS = [320, 480, 768];
const cache = new Map();

// site-root URL ("/mockups/folder/file.png") → on-disk path ("mockups/folder/file.png")
async function responsive(url) {
  if (!url) return url;
  if (cache.has(url)) return cache.get(url);

  const fsPath = url.replace(/^\//, "");
  const metadata = await Image(fsPath, {
    widths: WIDTHS,
    formats: ["webp", "png"],
    outputDir: path.join("_site", "img"),
    urlPath: "/img/",
  });

  const png = metadata.png[metadata.png.length - 1]; // largest PNG = fallback
  const result = {
    src: png.url,
    srcset: metadata.webp.map((e) => `${e.url} ${e.width}w`).join(", "),
    width: png.width,
    height: png.height,
  };
  cache.set(url, result);
  return result;
}

export default async function () {
  // Deep clone so we never mutate the cached require() object across rebuilds.
  const products = JSON.parse(JSON.stringify(raw));
  for (const product of products) {
    for (const color of product.colors || []) {
      if (color.images?.front) color.images.front = await responsive(color.images.front);
      if (color.images?.back) color.images.back = await responsive(color.images.back);
    }
  }
  return products;
}
