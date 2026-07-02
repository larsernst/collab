import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createVaultClient } from '../../lib/vaultClient';
import { isVaultReadOnly } from '../../types/vault';
import type { VaultMeta } from '../../types/vault';
import type { SvgScene } from '../../types/svg';
import { parseSvg, serializeScene, SvgParseError } from '../../lib/svgDocument';

interface UseSvgSessionOptions {
  vault: VaultMeta | null;
  relativePath: string | null;
  markDirty: (path: string) => void;
  markSaved: (path: string, hash: string) => void;
}

export interface SvgSession {
  scene: SvgScene | null;
  setScene: React.Dispatch<React.SetStateAction<SvgScene | null>>;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  /**
   * True when the file could only be read as a binary asset (a hosted SVG that
   * was imported as an image before SVGs became text documents). Such files open
   * for editing but cannot be saved back through the document-revision path.
   */
  assetBacked: boolean;
  save: () => Promise<void>;
}

/** Decode a `data:` URL (base64 or percent-encoded) to a UTF-8 string. */
function decodeDataUrlText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl;
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
}

/**
 * Load/parse/save lifecycle for the SVG vector editor. Reads the `.svg` as a
 * text document through the active {@link createVaultClient} (so it works for
 * both local and hosted vaults), parses it into an editable {@link SvgScene},
 * and writes changes back through the optimistic text-write path. Editing is
 * disabled (read-only) for hosted viewers via {@link isVaultReadOnly}.
 */
export function useSvgSession({ vault, relativePath, markDirty, markSaved }: UseSvgSessionOptions): SvgSession {
  const [scene, setScene] = useState<SvgScene | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Opaque optimistic-lock token from the last successful read/write, and the
  // serialized text at that point (the dirty baseline).
  const savedVersionRef = useRef<string | null>(null);
  const [savedText, setSavedText] = useState<string>('');
  const [assetBacked, setAssetBacked] = useState(false);

  const readOnly = isVaultReadOnly(vault);

  const currentText = useMemo(() => (scene ? serializeScene(scene) : ''), [scene]);
  const dirty = scene != null && currentText !== savedText;

  useEffect(() => {
    if (!vault || !relativePath) {
      setScene(null);
      setError('No file selected');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScene(null);
    setAssetBacked(false);

    const client = createVaultClient(vault);
    // Read as a text document first (the normal path with optimistic locking).
    // Fall back to reading the raw bytes when the file is stored as a binary
    // asset — e.g. a hosted SVG imported as an image before SVGs became text
    // documents — so it still opens for editing (save is then disabled).
    (async (): Promise<{ content: string; version: string | null; asset: boolean }> => {
      try {
        const doc = await client.readDocument(relativePath);
        return { content: doc.content, version: doc.version, asset: false };
      } catch (docError) {
        try {
          const dataUrl = await client.readAssetDataUrl(relativePath);
          return { content: decodeDataUrlText(dataUrl), version: null, asset: true };
        } catch {
          throw docError;
        }
      }
    })()
      .then((loaded) => {
        if (cancelled) return;
        const parsed = parseSvg(loaded.content);
        savedVersionRef.current = loaded.version;
        setSavedText(serializeScene(parsed));
        setAssetBacked(loaded.asset);
        setScene(parsed);
      })
      .catch((reason) => {
        if (cancelled) return;
        setScene(null);
        setError(reason instanceof SvgParseError ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [relativePath, vault?.path]);

  useEffect(() => {
    if (!relativePath) return;
    if (dirty) markDirty(relativePath);
    else markSaved(relativePath, `svg:${savedVersionRef.current ?? ''}`);
  }, [dirty, markDirty, markSaved, relativePath]);

  const save = useCallback(async () => {
    if (!vault || !relativePath || !scene || readOnly || saving) return;
    if (assetBacked) {
      toast.error('This SVG was imported as an image asset and cannot be saved as a vector document. Re-import it to edit and save it.');
      return;
    }
    const content = serializeScene(scene);
    setSaving(true);
    try {
      const result = await createVaultClient(vault).writeDocument(
        relativePath,
        content,
        savedVersionRef.current ?? undefined,
        savedText || undefined,
      );
      if (result.conflict) {
        toast.error('This SVG changed on disk since you opened it. Reopen the file to get the latest version before editing.');
        return;
      }
      savedVersionRef.current = result.version;
      setSavedText(content);
      markSaved(relativePath, `svg:${result.version}`);
      toast.success('SVG saved');
    } catch (reason) {
      toast.error(`Failed to save SVG: ${reason}`);
    } finally {
      setSaving(false);
    }
  }, [assetBacked, markSaved, readOnly, relativePath, saving, savedText, scene, vault?.path]);

  return { scene, setScene, loading, error, dirty, saving, readOnly, assetBacked, save };
}
