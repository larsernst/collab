import type { VaultClient } from './vaultClient';
import { tauriCommands } from './tauri';

/**
 * External-file import for vaults. Adding documents/images/notes to a vault is
 * limited to images, PDFs, markdown, canvas, and Kanban so an import never
 * injects an arbitrary or unsupported binary. Images and PDFs are stored as
 * binary assets through the mode-agnostic `externalAssetImport` capability;
 * markdown and Collab structured files become real text documents on both local
 * and hosted vaults.
 */
export const IMPORT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
export const IMPORT_PDF_EXTENSIONS = ['pdf'];
export const IMPORT_MARKDOWN_EXTENSIONS = ['md', 'markdown'];
export const IMPORT_CANVAS_EXTENSIONS = ['canvas'];
export const IMPORT_KANBAN_EXTENSIONS = ['kanban'];

export const IMPORTABLE_EXTENSIONS = [
  ...IMPORT_IMAGE_EXTENSIONS,
  ...IMPORT_PDF_EXTENSIONS,
  ...IMPORT_MARKDOWN_EXTENSIONS,
  ...IMPORT_CANVAS_EXTENSIONS,
  ...IMPORT_KANBAN_EXTENSIONS,
];

export type ImportableCategory = 'image' | 'pdf' | 'markdown' | 'canvas' | 'kanban';

export function fileBaseName(sourcePath: string): string {
  const segments = sourcePath.split(/[/\\]/);
  return segments[segments.length - 1] ?? sourcePath;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function importCategoryForName(name: string): ImportableCategory | null {
  const ext = extensionOf(name);
  if (IMPORT_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (IMPORT_PDF_EXTENSIONS.includes(ext)) return 'pdf';
  if (IMPORT_MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown';
  if (IMPORT_CANVAS_EXTENSIONS.includes(ext)) return 'canvas';
  if (IMPORT_KANBAN_EXTENSIONS.includes(ext)) return 'kanban';
  return null;
}

export function isImportableFile(name: string): boolean {
  return importCategoryForName(name) !== null;
}

export interface VaultImportResult {
  imported: string[];
  failed: { name: string; error: string }[];
}

function decodeUtf8Base64(contentBase64: string): string {
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function joinVaultPath(folder: string | undefined, name: string): string {
  return folder ? `${folder.replace(/\/+$/, '')}/${name}` : name;
}

/**
 * Imports a markdown file as a text note. The source bytes are read through the
 * native client (the only filesystem touchpoint), then the note is created and
 * written through the mode-agnostic `VaultClient` so the same path works for both
 * local and hosted vaults.
 */
function validateStructuredDocument(text: string, category: 'canvas' | 'kanban') {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The .${category} file does not contain valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The .${category} file must contain a JSON object.`);
  }
  const record = parsed as Record<string, unknown>;
  if (category === 'canvas' && (!Array.isArray(record.nodes) || !Array.isArray(record.edges))) {
    throw new Error('The .canvas file must contain nodes and edges arrays.');
  }
  if (category === 'kanban' && !Array.isArray(record.columns)) {
    throw new Error('The .kanban file must contain a columns array.');
  }
}

async function importTextDocument(
  client: VaultClient,
  sourcePath: string,
  targetFolder: string | undefined,
  category: 'markdown' | 'canvas' | 'kanban',
): Promise<string> {
  const payload = await tauriCommands.readFileForUpload(sourcePath);
  const text = decodeUtf8Base64(payload.contentBase64);
  if (category !== 'markdown') validateStructuredDocument(text, category);
  const targetPath = joinVaultPath(targetFolder, payload.name);
  await client.createDocument(targetPath);
  // A freshly created note starts empty; write the source content as its first
  // real revision using the just-created version as the optimistic base.
  const created = await client.readDocument(targetPath);
  await client.writeDocument(targetPath, text, created.version, created.content);
  return targetPath;
}

/**
 * Imports the given desktop files into the vault, routing each by type. Markdown,
 * canvas, and Kanban become text documents; images and PDFs become binary
 * assets. When `targetFolder` is omitted, images default to the app-managed
 * `Pictures/` folder and everything else lands at the vault root. Each file is
 * imported independently so one bad file never aborts the rest.
 */
export async function importExternalFilesIntoVault(
  client: VaultClient,
  sourcePaths: string[],
  options: { targetFolder?: string } = {},
): Promise<VaultImportResult> {
  const result: VaultImportResult = { imported: [], failed: [] };
  const assetImporter = client.runtime.externalAssetImport;

  for (const sourcePath of sourcePaths) {
    const name = fileBaseName(sourcePath);
    const category = importCategoryForName(name);
    try {
      if (!category) {
        result.failed.push({ name, error: 'Unsupported file type. Only images, PDFs, markdown, canvas, and Kanban files can be imported.' });
        continue;
      }
      if (category === 'markdown' || category === 'canvas' || category === 'kanban') {
        result.imported.push(await importTextDocument(client, sourcePath, options.targetFolder, category));
        continue;
      }
      if (!assetImporter) {
        throw new Error('This vault does not support importing files.');
      }
      // '' targets the vault root; image defaults follow the Pictures convention.
      const folder = options.targetFolder ?? (category === 'image' ? 'Pictures' : '');
      result.imported.push(await assetImporter.import(sourcePath, folder));
    } catch (error) {
      result.failed.push({ name, error: String(error) });
    }
  }

  return result;
}
