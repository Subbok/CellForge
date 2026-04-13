/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` requires a secure context (HTTPS or localhost),
 * so on plain-HTTP access from a LAN IP it's undefined — fall back to
 * the legacy execCommand('copy') path via a hidden textarea.
 */
export function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
