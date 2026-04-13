import { ws } from './websocket';
import type { WsMessage } from '../lib/types';

let pending: ((formatted: string | null) => void) | null = null;

let _setup = false;
export function setupFormatHandler() {
  if (_setup) return;
  _setup = true;

  ws.on('stream', (msg: WsMessage) => {
    if (!pending) return;
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    const text = String(content?.text ?? '');
    if (text.startsWith('__bliss_fmt:')) {
      pending(text.slice('__bliss_fmt:'.length));
      pending = null;
    }
  });
}

export function formatPythonCode(code: string): Promise<string | null> {
  return new Promise(resolve => {
    pending = resolve;

    // encode the code as base64 to avoid any quoting issues
    const b64 = btoa(unescape(encodeURIComponent(code)));

    const script = `
import base64 as __b64
__bliss_code = __b64.b64decode("${b64}").decode("utf-8")
try:
    import black
    __bliss_r = black.format_str(__bliss_code, mode=black.Mode())
    print("__bliss_fmt:" + __bliss_r, end="")
except ImportError:
    try:
        import autopep8
        __bliss_r = autopep8.fix_code(__bliss_code)
        print("__bliss_fmt:" + __bliss_r, end="")
    except ImportError:
        print("__bliss_fmt:" + __bliss_code, end="")
except Exception as __e:
    print("__bliss_fmt:" + __bliss_code, end="")
finally:
    del __b64, __bliss_code
    for __n in ['__bliss_r', 'black', 'autopep8', '__e']:
        if __n in dir(): exec(f"del {__n}")
`;

    ws.send('execute_request', {
      cell_id: '__format__',
      cell_index: -1,
      code: script,
    });

    setTimeout(() => {
      if (pending) { pending(null); pending = null; }
    }, 5000);
  });
}
