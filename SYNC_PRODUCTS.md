Syncing Products from Printful

Product data is managed in products-config.json and synced from the Printful API.
Running the sync generates two files (do not edit manually):
  src/_data/products.json     — Eleventy front-end catalog
  worker/src/products.js      — Cloudflare Worker catalog

## Source of truth

products-config.json is the only file you edit directly:

  slug              — URL slug, must match across site and worker
  name              — Display name
  image             — Path to image in src/images/
  printful_product_id — Printful sync product ID (see Finding IDs below)
  retail_price      — Price in USD you charge the customer

Variant IDs and sizes come from Printful automatically.

## Running the sync

  npm run sync

Then deploy the worker to apply the changes:

  cd worker && npm run deploy

The Eleventy site picks up products.json automatically on the next build/deploy.

## Finding Printful product IDs

  node sync-products.js --list

Lists all products in the Printful store with their IDs.
Copy the id into products-config.json as printful_product_id.

## Adding a new product

1. Add the product to your Printful store (Manual Order / API store, store ID 17828143)
2. Run node sync-products.js --list to get the new product's ID
3. Add an entry to products-config.json with the ID, slug, name, image, and retail_price
4. Add the product image to src/images/
5. Run npm run sync
6. cd worker && npm run deploy

## Changing prices

Edit retail_price in products-config.json, then run npm run sync and deploy the worker.

## API key

The sync script reads PRINTFUL_API_KEY from worker/.dev.vars.
To use a different key, set the PRINTFUL_API_KEY environment variable:

  PRINTFUL_API_KEY=... node sync-products.js