import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';

export function openNonVaultMarkdownPreviewLink(
  url: string,
  {
    openExternal = openUrl,
    onInvalidLink = (message: string) => toast.error(message),
  }: {
    openExternal?: (url: string) => Promise<unknown>;
    onInvalidLink?: (message: string) => void;
  } = {},
) {
  if (!/^https?:\/\//i.test(url)) {
    onInvalidLink('This link is not a valid vault file or web URL.');
    return false;
  }

  void openExternal(url).catch((error) => {
    onInvalidLink(`Failed to open link: ${error}`);
  });
  return true;
}
