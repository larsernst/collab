#!/usr/bin/env node

import fs from 'node:fs';

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error('Usage: node scripts/check-release-version.mjs v<major>.<minor>.<patch>');
  process.exit(64);
}

if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`Release tag must be semantic version v<major>.<minor>.<patch>: ${tag}`);
  process.exit(1);
}

const version = tag.slice(1);
const packageVersion = (path) => JSON.parse(fs.readFileSync(path, 'utf8')).version;
const cargoVersion = (path, workspace = false) => {
  const source = fs.readFileSync(path, 'utf8');
  const section = workspace ? '\\[workspace\\.package\\]' : '\\[package\\]';
  const match = new RegExp(`${section}[\\s\\S]*?^version\\s*=\\s*"([^"]+)"`, 'm').exec(source);
  if (!match) throw new Error(`Could not find a concrete version in ${path}`);
  return match[1];
};

const versions = new Map([
  ['package.json', packageVersion('package.json')],
  ['apps/admin-web/package.json', packageVersion('apps/admin-web/package.json')],
  ['Cargo.toml workspace', cargoVersion('Cargo.toml', true)],
  ['src-tauri/Cargo.toml', cargoVersion('src-tauri/Cargo.toml')],
]);

if ([...versions.values()].some((actual) => actual !== version)) {
  console.error(`Release tag ${tag} does not match every project version:`);
  for (const [source, actual] of versions) console.error(`  ${source}: ${actual}`);
  process.exit(1);
}

console.log(`Release version ${version} is consistent across project manifests.`);
