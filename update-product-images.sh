#!/usr/bin/env bash
# Updates images in products-config.json by matching src/images/ files
# to products using filename prefixes from the Printful product JSONs.

python3 << 'EOF'
import json, os, re, glob

IMAGES_DIR = "src/images"
CONFIG_FILE = "products-config.json"
TMP_DIR = "tmp"

with open(CONFIG_FILE) as f:
    config = json.load(f)

config_by_id = {p["printful_product_id"]: p for p in config}

image_files = sorted(os.listdir(IMAGES_DIR))

for product_file in sorted(glob.glob(f"{TMP_DIR}/product-*.json")):
    with open(product_file) as f:
        data = json.load(f)

    product = data["result"]["sync_product"]
    product_id = product["id"]

    if product_id not in config_by_id:
        print(f"Skipping {product_id} (not in products-config.json)")
        continue

    # Collect unique filename prefixes from preview-type variant files
    prefixes = set()
    for variant in data["result"]["sync_variants"]:
        for file in variant["files"]:
            if file["type"] == "preview":
                # Strip view and hex suffix (e.g. -front-<hex>.png) to match all angles
                prefix = re.sub(r'-(front|back|left|right).*$', '', file["filename"])
                prefixes.add(prefix)

    # Find all src/images/ files whose name starts with any of those prefixes
    matched = [
        f"/images/{fname}"
        for fname in image_files
        if any(fname.startswith(p) for p in sorted(prefixes))
    ]

    if matched:
        config_by_id[product_id]["images"] = matched
        print(f"{product['name']}: {len(matched)} image(s)")
    else:
        print(f"{product['name']}: no images found (prefixes: {sorted(prefixes)})")

with open(CONFIG_FILE, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print(f"\nUpdated {CONFIG_FILE}")
EOF