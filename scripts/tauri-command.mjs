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

function run(tool, commandArgs) {
  const result = spawnSync(tool.command, [...tool.prefixArgs, ...commandArgs], {
    cwd: rootDir,
    env: process.env,
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
  if (args[0] === 'build') {
    if (!run(resolveNodeTool('tsc'), [])) {
      process.exit(process.exitCode ?? 1);
    }

    if (!run(resolveNodeTool('vite'), ['build'])) {
      process.exit(process.exitCode ?? 1);
    }

    run(resolveNodeTool('tauri'), createTauriBuildArgs(args));
  } else {
    run(resolveNodeTool('tauri'), args);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
