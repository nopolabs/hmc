#!/usr/bin/env node
// Pushes secrets from a .vars file to Cloudflare via wrangler.
//
// Usage:
//   node set-secrets.js dev    # reads .dev.vars
//   node set-secrets.js prod   # reads .prod.vars

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = process.argv[2];
if (!env || !['dev', 'prod'].includes(env)) {
  console.error('Usage: node set-secrets.js dev|prod');
  process.exit(1);
}

const varsFile = resolve(__dirname, `.${env}.vars`);
let content;
try {
  content = readFileSync(varsFile, 'utf8');
} catch {
  console.error(`Error: ${varsFile} not found`);
  if (env === 'prod') console.error('Copy .prod.vars.example to .prod.vars and fill in live values.');
  process.exit(1);
}

const secrets = {};
for (const line of content.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  secrets[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

for (const [key, value] of Object.entries(secrets)) {
  console.log(`Setting ${key}...`);
  const result = spawnSync('wrangler', ['secret', 'put', key], {
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    console.error(`Failed to set ${key}`);
    process.exit(1);
  }
}

console.log(`\nSecrets from .${env}.vars applied. Run "npm run deploy" to deploy.`);
