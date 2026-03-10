#!/usr/bin/env bash
# Usage: ./pull-store-catalog.sh store-id

if [[ $# -eq 0 ]]; then
  echo "Error: store-id is required" >&2
  echo "Usage: $(basename "$0") store-id" >&2
  exit 1
fi

source worker/.prod.vars
STORE_ID="${1}"

echo "Fetching store-${STORE_ID}.json"
curl -s -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
  "https://api.printful.com/store/products?store_id=${STORE_ID}" \
  | jq \
  > tmp/store-${STORE_ID}.json

for PRODUCT_ID in $(jq '.result[].id' tmp/store-${STORE_ID}.json); do
  echo "Fetching product-${PRODUCT_ID}.json"
  curl -s -H "Authorization: Bearer ${PRINTFUL_API_KEY}" \
    "https://api.printful.com/store/products/${PRODUCT_ID}?store_id=${STORE_ID}" \
    | jq \
    > tmp/product-${PRODUCT_ID}.json
done

echo "Generating products-config.json"
jq -s '[.[] | {
  slug: .result.sync_product.external_id,
  name: .result.sync_product.name,
  images: ([.result.sync_variants[].files[] | select(.type == "preview") | .preview_url] | unique),
  printful_product_id: .result.sync_product.id,
  retail_price: 100.00,
  active: true
}]' tmp/product-*.json > products-config.json
echo "Done: products-config.json"
