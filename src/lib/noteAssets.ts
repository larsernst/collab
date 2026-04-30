import type { NoteFile } from '../types/vault';

const IMAGE_EXT_RE = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeRelativePath(path: string): string {
  const parts = normalizeSeparators(path).split('/');
  const out: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }

  return out.join('/');
}

export function isLikelyImagePath(path: string): boolean {
  const cleanPath = path.split(/[?#]/, 1)[0];
  return IMAGE_EXT_RE.test(cleanPath);
}

export type NoteAssetTarget =
  | { kind: 'direct'; value: string }
  | { kind: 'vault'; value: string };

function flattenVaultFiles(nodes: NoteFile[]): NoteFile[] {
  const flat: NoteFile[] = [];

  const visit = (items: NoteFile[]) => {
    for (const item of items) {
      if (item.isFolder) {
        if (item.children?.length) visit(item.children);
        continue;
      }
      flat.push(item);
    }
  };

  visit(nodes);
  return flat;
}

export function resolveNoteAssetTarget(
  assetPath: string,
  noteRelativePath: string,
  fileTree?: NoteFile[],
): NoteAssetTarget | null {
  const trimmed = assetPath.trim();
  if (!trimmed) return null;
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  if (ABSOLUTE_URL_RE.test(unwrapped) || unwrapped.startsWith('data:') || unwrapped.startsWith('blob:')) {
    return { kind: 'direct', value: unwrapped };
  }

  const [rawPath, suffix = ''] = unwrapped.match(/^([^?#]*)(.*)$/)?.slice(1) ?? [unwrapped, ''];
  const vaultRelativePath = normalizeRelativePath(rawPath);
  if (fileTree?.length) {
    const exactVaultMatch = flattenVaultFiles(fileTree).find((file) => (
      file.relativePath.toLowerCase() === vaultRelativePath.toLowerCase()
    ));
    if (exactVaultMatch) {
      return {
        kind: 'vault',
        value: `${exactVaultMatch.relativePath}${suffix}`,
      };
    }
  }

  const noteDir = noteRelativePath.includes('/')
    ? noteRelativePath.split('/').slice(0, -1).join('/')
    : '';
  const relativeToVault = rawPath.startsWith('/')
    ? normalizeRelativePath(rawPath)
    : normalizeRelativePath(noteDir ? `${noteDir}/${rawPath}` : rawPath);

  return {
    kind: 'vault',
    value: `${relativeToVault}${suffix}`,
  };
}
