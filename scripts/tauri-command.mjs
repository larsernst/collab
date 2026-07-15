#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolEntryPoints = {
  tauri: ['@tauri-apps', 'cli', 'tauri.js'],
  tsc: ['typescript', 'bin', 'tsc'],
  vite: ['vite', 'bin', 'vite.js'],
};

export function resolveNodeTool(name, projectRoot = rootDir) {
  const relativePath = toolEntryPoints[name];
  if (!relativePath) throw new Error(`Unknown local tool: ${name}`);

  const entryPoint = join(projectRoot, 'node_modules', ...relativePath);
  if (!existsSync(entryPoint)) {
    throw new Error(`Missing ${name} CLI at ${entryPoint}. Run pnpm install first.`);
  }

  return {
    command: process.execPath,
    prefixArgs: [entryPoint],
    shell: false,
  };
}

function withAndroidNodeHeap(env = process.env) {
  const nodeOptions = env.NODE_OPTIONS ?? '';
  const heapOption = '--max-old-space-size=8192';
  return {
    ...env,
    NODE_OPTIONS: nodeOptions.includes('--max-old-space-size') ? nodeOptions : `${nodeOptions} ${heapOption}`.trim(),
  };
}

function run(tool, commandArgs, env = process.env) {
  console.log(`Running ${tool.command} ${[...tool.prefixArgs, ...commandArgs].join(' ')}`);
  const result = spawnSync(tool.command, [...tool.prefixArgs, ...commandArgs], {
    cwd: rootDir,
    env,
    shell: tool.shell,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exitCode = result.status ?? 1;
  return process.exitCode === 0;
}

export function createTauriBuildArgs(args, signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const hasBuildConfigOverride = args.some((arg) => arg === '--config' || arg.startsWith('--config='));
  if (hasBuildConfigOverride) return args;

  const buildConfig = signingKey
    ? { build: { beforeBuildCommand: '' } }
    : { build: { beforeBuildCommand: '' }, bundle: { createUpdaterArtifacts: false } };
  return [...args, '--config', JSON.stringify(buildConfig)];
}

function main(args) {
  const childEnv = args[0] === 'android' ? withAndroidNodeHeap() : process.env;
  console.log(`Syncing version manifests before tauri ${args.join(' ')}...`);
  const syncVersions = spawnSync(process.execPath, [join(rootDir, 'scripts', 'sync-versions.mjs')], {
    cwd: rootDir,
    env: childEnv,
    shell: false,
    stdio: 'inherit',
  });
  if (syncVersions.status !== 0 || syncVersions.error) {
    if (syncVersions.error) console.error(syncVersions.error.message);
    process.exit(syncVersions.status ?? 1);
  }

  if (args[0] === 'build') {
    console.log('Preparing OCR assets...');
    const prepareOcr = spawnSync(process.execPath, [join(rootDir, 'scripts', 'prepare-ocr-assets.mjs')], {
      cwd: rootDir,
      env: childEnv,
      shell: false,
      stdio: 'inherit',
    });
    if (prepareOcr.status !== 0 || prepareOcr.error) {
      if (prepareOcr.error) console.error(prepareOcr.error.message);
      process.exit(prepareOcr.status ?? 1);
    }

    console.log('Type-checking desktop frontend...');
    if (!run(resolveNodeTool('tsc'), [], childEnv)) {
      process.exit(process.exitCode ?? 1);
    }

    console.log('Building desktop frontend...');
    if (!run(resolveNodeTool('vite'), ['build'], childEnv)) {
      process.exit(process.exitCode ?? 1);
    }

    console.log('Building Tauri desktop bundle...');
    run(resolveNodeTool('tauri'), createTauriBuildArgs(args), childEnv);
  } else {
    console.log(`Running Tauri command: tauri ${args.join(' ')}`);
    run(resolveNodeTool('tauri'), args, childEnv);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
