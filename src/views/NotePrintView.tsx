import { useEffect, useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { MarkdownPreview } from '../components/editor/MarkdownPreview';
import { tauriCommands } from '../lib/tauri';
import { useVaultStore } from '../store/vaultStore';
import { Button } from '../components/ui/button';
import { getVaultDocumentTitle } from '../lib/vaultLinks';

interface NotePrintViewProps {
  relativePath: string;
  standalone?: boolean;
  onClose?: () => void;
}

export default function NotePrintView({
  relativePath,
  standalone = false,
  onClose,
}: NotePrintViewProps) {
  const vault = useVaultStore((state) => state.vault);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [didAutoPrint, setDidAutoPrint] = useState(false);
  const title = useMemo(() => getVaultDocumentTitle(relativePath), [relativePath]);

  useEffect(() => {
    document.title = `${title} · PDF Export`;
  }, [title]);

  useEffect(() => {
    document.documentElement.dataset.notePrintMode = 'true';
    return () => {
      delete document.documentElement.dataset.notePrintMode;
    };
  }, []);

  useEffect(() => {
    if (!vault) return;
    let cancelled = false;

    tauriCommands.readNote(vault.path, relativePath)
      .then((note) => {
        if (cancelled) return;
        setContent(note.content);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [relativePath, vault?.path]);

  useEffect(() => {
    if (content === null || didAutoPrint) return;
    const handle = window.setTimeout(() => {
      setDidAutoPrint(true);
      window.print();
    }, 160);
    return () => window.clearTimeout(handle);
  }, [content, didAutoPrint]);

  const handleClose = () => {
    if (standalone) {
      void getCurrentWindow().close().catch(() => window.close());
      return;
    }
    onClose?.();
  };

  if (!vault) {
    return (
      <div className="note-print-shell">
        <div className="note-print-state">Opening vault…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="note-print-shell">
        <div className="note-print-state">
          Failed to prepare PDF export.
          <div className="mt-2 text-xs opacity-70">{error}</div>
        </div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="note-print-shell">
        <div className="note-print-state">Loading note…</div>
      </div>
    );
  }

  return (
    <div className="note-print-shell">
      <div className="note-print-toolbar">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{relativePath}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer size={14} />
            Print / Save PDF
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClose}
            aria-label={standalone ? 'Close export window' : 'Close export preview'}
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      <div className="note-print-page">
        <div className="note-print-document">
          <div className="note-print-header">
            <h1>{title}</h1>
            <div>{relativePath}</div>
          </div>
          <MarkdownPreview
            content={content}
            currentDocumentRelativePath={relativePath}
            className="note-print-markdown"
          />
        </div>
      </div>
    </div>
  );
}
