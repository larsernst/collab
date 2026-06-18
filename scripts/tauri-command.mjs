#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function bin(name) {
  const executable = process.platform === 'win32' ? `${name}.cmd` : name;
  const path = join(rootDir, 'node_modules', '.bin', executable);
  return existsSync(path) ? path : name;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exitCode = result.status ?? 1;
  return process.exitCode === 0;
}

if (args[0] === 'build') {
  if (!run(bin('tsc'), [])) {
    process.exit(process.exitCode ?? 1);
  }

  if (!run(bin('vite'), ['build'])) {
    process.exit(process.exitCode ?? 1);
  }

  const hasBuildConfigOverride = args.some((arg) => arg === '--config' || arg.startsWith('--config='));
  const buildConfig = process.env.TAURI_SIGNING_PRIVATE_KEY
    ? { build: { beforeBuildCommand: '' } }
    : { build: { beforeBuildCommand: '' }, bundle: { createUpdaterArtifacts: false } };
  const buildArgs = hasBuildConfigOverride
    ? args
    : [...args, '--config', JSON.stringify(buildConfig)];

  run(bin('tauri'), buildArgs);
} else {
  run(bin('tauri'), args);
}
