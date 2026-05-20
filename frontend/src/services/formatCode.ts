import { ws } from './websocket';
import type { WsMessage } from '../lib/types';

// Pending format request — nonce binds the marker to THIS request so a
// compromised kernel (or any stream output that happens to start with
// "__cf_fmt:") can't hand us back arbitrary text and have us write it
// into the user's cell.
let pending: { nonce: string; resolve: (formatted: string | null) => void } | null = null;

let _setup = false;
export function setupFormatHandler() {
  if (_setup) return;
  _setup = true;

  ws.on('stream', (msg: WsMessage) => {
    if (!pending) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const text = String(content?.text ?? '');
    const marker = `__cf_fmt_${pending.nonce}:`;
    if (text.startsWith(marker)) {
      pending.resolve(text.slice(marker.length));
      pending = null;
    }
  });
}

export function formatPythonCode(code: string): Promise<string | null> {
  return new Promise(resolve => {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    pending = { nonce, resolve };

    // encode the code as base64 to avoid any quoting issues
    const b64 = btoa(unescape(encodeURIComponent(code)));

    const script = `
import base64 as __b64
__cf_code = __b64.b64decode("${b64}").decode("utf-8")
try:
    import black
    __cf_r = black.format_str(__cf_code, mode=black.Mode())
    print("__cf_fmt_${nonce}:" + __cf_r, end="")
except ImportError:
    try:
        import autopep8
        __cf_r = autopep8.fix_code(__cf_code)
        print("__cf_fmt_${nonce}:" + __cf_r, end="")
    except ImportError:
        print("__cf_fmt_${nonce}:" + __cf_code, end="")
except Exception as __e:
    print("__cf_fmt_${nonce}:" + __cf_code, end="")
finally:
    del __b64, __cf_code
    for __n in ['__cf_r', 'black', 'autopep8', '__e']:
        if __n in dir(): exec(f"del {__n}")
`;

    ws.send('execute_request', {
      cell_id: '__format__',
      cell_index: -1,
      code: script,
    });

    setTimeout(() => {
      // Only clear if it's still THIS request — user may have kicked off a
      // second format that replaced `pending`, and we shouldn't null theirs.
      if (pending?.nonce === nonce) {
        pending.resolve(null);
        pending = null;
      }
    }, 5000);
  });
}
