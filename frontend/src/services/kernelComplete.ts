import { ws } from './websocket';
import type { WsMessage } from '../lib/types';

// pending completion requests — resolve when kernel answers
const pending = new Map<string, (matches: string[], cursorStart: number, cursorEnd: number) => void>();

let _setup = false;
export function setupCompletionHandler() {
  if (_setup) return;
  _setup = true;

  ws.on('complete_reply', (msg: WsMessage) => {
    const content = msg.payload?.content as Record<string, unknown> | undefined;
    if (!content) return;

    // resolve ALL pending requests (usually just one but just in case)
    const matches = (content.matches ?? []) as string[];
    const start = (content.cursor_start ?? 0) as number;
    const end = (content.cursor_end ?? 0) as number;

    for (const [, resolve] of pending) {
      resolve(matches, start, end);
    }
    pending.clear();
  });
}

export function requestCompletion(code: string, cursorPos: number): Promise<{ matches: string[]; cursorStart: number; cursorEnd: number }> {
  return new Promise((resolve) => {
    const id = ws.send('complete_request', { code, cursor_pos: cursorPos });
    pending.set(id, (matches, cursorStart, cursorEnd) => {
      resolve({ matches, cursorStart, cursorEnd });
    });

    // timeout after 3s — kernel might be busy
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ matches: [], cursorStart: cursorPos, cursorEnd: cursorPos });
      }
    }, 3000);
  });
}
