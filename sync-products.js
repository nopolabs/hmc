#!/usr/bin/env node
// Syncs product data from Printful into:
//   products.source.json      (raw front-end catalog; enriched by src/_data/products.js)
//   worker/src/products.js    (Cloudflare Worker)
//
// Usage:
//   node sync-products.js            # sync all products (requires API key)
//   node sync-products.js --init     # generate products-config.json + data files from local docs/printful-products.json
//   node sync-products.js --init --force  # overwrite existing products-config.json
//   node sync-products.js --list     # list Printful products and their IDs
//   node sync-products.js --json     # dump raw Printful API JSON
//
// Reads PRINTFUL_API_KEY from worker/.dev.vars (or PRINTFUL_API_KEY env var)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRINTFUL_STORE_ID = 17828143;

// ── Color definitions ─────────────────────────────────────────────────────────

const DEFAULT_COLOR_ORDER = [
  'White',
  'Red', 'Cardinal', 'Heather Red', 'Maroon', 'Azalea', 'Pink',
  'Mustard',
  'Forest', 'Irish Green', 'Forest Green', 'Leaf',
  'Teal', 'Heather Deep Teal', 'Aqua',
  'Navy', 'Royal', 'Heather True Royal',
  'Black', 'Vintage Black',
];

const COLOR_HEX = {
  'White':              '#FFFFFF',
  'Black':              '#1a1a1a',
  'Vintage Black':      '#2d2d2b',
  'Navy':               '#1a2744',
  'Royal':              '#1a4ba0',
  'Heather True Royal': '#4466bb',
  'Teal':               '#007b8a',
  'Heather Deep Teal':  '#2d7d7a',
  'Aqua':               '#47c5d4',
  'Irish Green':        '#009a44',
  'Forest':             '#2d5016',
  'Forest Green':       '#2d5016',
  'Leaf':               '#5a7a3a',
  'Mustard':            '#c8922a',
  'Red':                '#cc2222',
  'Cardinal':           '#9b1b2a',
  'Heather Red':        '#bb4444',
  'Maroon':             '#6b1a2a',
  'Pink':               '#f4a0b0',
  'Azalea':             '#f06080',
};

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorToSlug(color) {
  return color.toLowerCase().replace(/\s+/g, '-');
}

function getMockupFolder(productName) {
  const name = productName.toLowerCase();
  const isFrontOnly = name.includes('front only');
  if (name.includes('unisex')) {
    return isFrontOnly ? 'unisex-front_only' : 'unisex-front_and_back';
  }
  if (name.includes('relaxed')) {
    return isFrontOnly ? 'womens_relaxed-front_only' : 'womens_relaxed-front_and_back';
  }
  if (name.includes('softstyle') || name.includes('basic')) {
    return isFrontOnly ? 'womens_softstyle-front_only' : 'womens_softstyle-front_and_back';
  }
  throw new Error(`Cannot determine mockup folder for product: "${productName}"`);
}

function findMockups(mockupFolder, colorName) {
  const slug = colorToSlug(colorName);
  const dir = resolve(__dirname, 'mockups', mockupFolder);
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return { front: null, back: null };
  }
  const front = files.find(f => f.includes(`-${slug}-front-`) && f.endsWith('.png')) || null;
  const back  = files.find(f => f.includes(`-${slug}-back-`)  && f.endsWith('.png')) || null;
  return {
    front: front ? `/mockups/${mockupFolder}/${front}` : null,
    back:  back  ? `/mockups/${mockupFolder}/${back}`  : null,
  };
}

function sortSizes(sizes) {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a);
    const bi = SIZE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function orderColors(allColors, colorOrderConfig) {
  if (colorOrderConfig && colorOrderConfig.length > 0) {
    // Only include colors explicitly listed, in that order; absent = disabled
    return colorOrderConfig.filter(c => allColors.includes(c));
  }
  // Default: White first, then chromatic order, unknowns at end alphabetically
  const known   = DEFAULT_COLOR_ORDER.filter(c => allColors.includes(c));
  const unknown = allColors.filter(c => !DEFAULT_COLOR_ORDER.includes(c)).sort();
  return [...known, ...unknown];
}

function loadApiKey() {
  if (process.env.PRINTFUL_API_KEY) return process.env.PRINTFUL_API_KEY;
  try {
    const vars = readFileSync(resolve(__dirname, 'worker/.dev.vars'), 'utf8');
    const match = vars.match(/^PRINTFUL_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  throw new Error('PRINTFUL_API_KEY not found in env or worker/.dev.vars');
}

async function printfulGet(path, apiKey) {
  const url = `https://api.printful.com${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const json = await res.json();
  if (json.code !== 200) throw new Error(`Printful API error: ${JSON.stringify(json)}`);
  return json.result;
}

// ── Core: build product data from sync_variants ───────────────────────────────

function buildProductData(entry, syncVariants, sizeGuide) {
  // Group variants by color → size
  const byColor = {};
  for (const v of syncVariants) {
    if (!byColor[v.color]) byColor[v.color] = {};
    byColor[v.color][v.size] = {
      printful_variant_id: v.id,
      external_id: v.external_id,
    };
  }

  const orderedColors = orderColors(Object.keys(byColor), entry.color_order || null);

  const colors = orderedColors.map(colorName => {
    const mockups     = findMockups(entry.mockup_folder, colorName);
    const sizesObj    = byColor[colorName];
    const sortedSizes = sortSizes(Object.keys(sizesObj));
    return {
      name: colorName,
      hex:  COLOR_HEX[colorName] || '#888888',
      images: {
        front: mockups.front,
        ...(mockups.back ? { back: mockups.back } : {}),
      },
      sizes: sortedSizes.map(size => ({
        size,
        external_id: sizesObj[size].external_id,
      })),
    };
  });

  // main_image: config override, else White front, else first color front
  let mainImage = entry.main_image
    ? (entry.main_image.startsWith('/') ? entry.main_image : `/${entry.main_image}`)
    : null;
  if (!mainImage && colors.length > 0) {
    mainImage = colors[0].images.front;
  }

  const priceNum  = entry.price != null ? entry.price : parseFloat(syncVariants[0].retail_price);
  const priceStr  = priceNum.toFixed(2);
  const priceCents = Math.round(priceNum * 100);

  // Frontend product
  const frontendProduct = {
    slug:        entry.slug,
    name:        entry.name,
    description: entry.description || '',
    price:       priceStr,
    main_image:  mainImage,
    colors,
    size_guide:  sizeGuide || null,
  };

  // Worker product: variants[color][size] = { printful_variant_id }
  const workerVariants = {};
  for (const colorName of orderedColors) {
    workerVariants[colorName] = {};
    for (const [size, v] of Object.entries(byColor[colorName])) {
      workerVariants[colorName][size] = { printful_variant_id: v.printful_variant_id };
    }
  }

  const workerProduct = {
    name:     entry.name,
    price:    priceCents,
    variants: workerVariants,
  };

  return { frontendProduct, workerProduct };
}

function writeDataFiles(frontendProducts, workerProducts) {
  // Raw front-end catalog. src/_data/products.js reads this and generates
  // responsive (WebP + PNG) derivatives, exporting the enriched `products`.
  const productsJsonPath = resolve(__dirname, 'products.source.json');
  writeFileSync(productsJsonPath, JSON.stringify(frontendProducts, null, 2) + '\n');
  console.log(`Wrote ${productsJsonPath}`);

  const productsJsPath = resolve(__dirname, 'worker/src/products.js');
  const productsJs = `// AUTO-GENERATED by sync-products.js — do not edit manually\nexport const PRODUCTS = ${JSON.stringify(workerProducts, null, '\t')};\n`;
  writeFileSync(productsJsPath, productsJs);
  console.log(`Wrote ${productsJsPath}`);
}

// ── --init ────────────────────────────────────────────────────────────────────

function initConfig() {
  const force      = process.argv.includes('--force');
  const configPath = resolve(__dirname, 'products-config.json');

  if (existsSync(configPath) && !force) {
    console.error('products-config.json already exists. Use --force to overwrite.');
    process.exit(1);
  }

  const localDataPath = resolve(__dirname, 'docs/printful-products.json');
  if (!existsSync(localDataPath)) {
    console.error('docs/printful-products.json not found. Run: node sync-products.js --json > docs/printful-products.json');
    process.exit(1);
  }

  const printfulProducts = JSON.parse(readFileSync(localDataPath, 'utf8'));

  const config = printfulProducts.map(p => {
    const mockupFolder = getMockupFolder(p.sync_product.name);
    const whiteMockups = findMockups(mockupFolder, 'White');
    // Store without leading slash so it looks clean in the config file
    const mainImage = whiteMockups.front ? whiteMockups.front.replace(/^\//, '') : null;
    const price     = parseFloat(p.sync_variants[0].retail_price);

    return {
      slug:               p.sync_product.external_id,
      printful_product_id: p.sync_product.id,
      mockup_folder:      mockupFolder,
      active:             true,
      name:               p.sync_product.name,
      description:        '',
      price,
      ...(mainImage ? { main_image: mainImage } : {}),
    };
  });

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Wrote ${configPath}`);

  // Also generate preliminary data files from local JSON (no size guides yet)
  generateFromLocal(printfulProducts, config);
  console.log('\nRun "node sync-products.js" (with API key) to add size guide data.');
}

function generateFromLocal(printfulProducts, config) {
  const frontendProducts = [];
  const workerProducts   = {};

  for (const entry of config.filter(e => e.active !== false)) {
    const pData = printfulProducts.find(p => p.sync_product.id === entry.printful_product_id);
    if (!pData) {
      console.warn(`Warning: no local data for printful_product_id ${entry.printful_product_id}`);
      continue;
    }
    const { frontendProduct, workerProduct } = buildProductData(entry, pData.sync_variants, null);
    frontendProducts.push(frontendProduct);
    workerProducts[entry.slug] = workerProduct;
  }

  writeDataFiles(frontendProducts, workerProducts);
}

// ── --list ────────────────────────────────────────────────────────────────────

async function listProducts(apiKey) {
  const products = await printfulGet(`/store/products?store_id=${PRINTFUL_STORE_ID}`, apiKey);
  console.log('\nPrintful store products:\n');
  for (const p of products) {
    console.log(`  id: ${p.id}  external_id: ${p.external_id}  name: ${p.name}`);
  }
  console.log('\nUse external_id as the slug in products-config.json.\n');
}

// ── --json ────────────────────────────────────────────────────────────────────

async function jsonProducts(apiKey) {
  const products = await printfulGet(`/store/products?store_id=${PRINTFUL_STORE_ID}`, apiKey);
  const details  = [];
  for (const p of products) {
    const detail = await printfulGet(`/store/products/${p.id}?store_id=${PRINTFUL_STORE_ID}`, apiKey);
    details.push(detail);
  }
  console.log(JSON.stringify(details, null, 2));
}

// ── sync (default) ────────────────────────────────────────────────────────────

async function syncProducts(apiKey) {
  const config = JSON.parse(readFileSync(resolve(__dirname, 'products-config.json'), 'utf8'));
  const frontendProducts = [];
  const workerProducts   = {};

  for (const entry of config.filter(e => e.active !== false)) {
    if (!entry.printful_product_id) {
      throw new Error(`Missing printful_product_id for "${entry.slug}".`);
    }

    console.log(`Fetching variants for "${entry.name}" (${entry.printful_product_id})...`);
    const product = await printfulGet(
      `/store/products/${entry.printful_product_id}?store_id=${PRINTFUL_STORE_ID}`,
      apiKey
    );

    const catalogProductId = product.sync_variants[0].product.product_id;
    console.log(`Fetching size guide for catalog product ${catalogProductId}...`);
    const sizeData = await printfulGet(`/products/${catalogProductId}/sizes`, apiKey);
    const pmTable  = sizeData.size_tables.find(t => t.type === 'product_measure')  || null;
    const myTable  = sizeData.size_tables.find(t => t.type === 'measure_yourself') || null;
    const sizeGuide = (pmTable || myTable) ? { product_measure: pmTable, measure_yourself: myTable } : null;

    const { frontendProduct, workerProduct } = buildProductData(entry, product.sync_variants, sizeGuide);
    frontendProducts.push(frontendProduct);
    workerProducts[entry.slug] = workerProduct;
  }

  writeDataFiles(frontendProducts, workerProducts);

  console.log('\nDone. Next steps:');
  console.log('  Deploy the worker:        cd worker && npm run deploy');
  console.log('  Commit and push the site: git add . && git commit -m "sync products" && git push\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (process.argv.includes('--init')) {
  initConfig();
} else if (process.argv.includes('--list')) {
  await listProducts(loadApiKey());
} else if (process.argv.includes('--json')) {
  await jsonProducts(loadApiKey());
} else {
  await syncProducts(loadApiKey());
}
