import { useState, useEffect } from 'react';
import { Send, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useUIStore } from '../../stores/uiStore';
import { useNotebookStore } from '../../stores/notebookStore';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_STORAGE_PREFIX = 'cellforge.ai.chat.';
/// Cap chat history per notebook. Once hit, oldest messages are dropped on
/// every save. Prevents one heavy user from filling all ~5MB of localStorage
/// and silently breaking every other preference store.
const CHAT_HISTORY_CAP = 100;
const CHAT_HISTORY_TRIM = 50; // retry target when QuotaExceededError fires

// Only warn once per session so every keystroke doesn't retrigger the toast.
let quotaWarned = false;

function loadChat(filePath: string | null): Message[] {
  if (!filePath) return [];
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_PREFIX + filePath);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Persist chat history for a notebook. Returns the array that was actually
 * persisted — may be trimmed from the input if the cap was hit or if the
 * browser's quota ran out. Callers should adopt the returned array to keep UI
 * state consistent with what's on disk.
 */
function saveChat(filePath: string | null, messages: Message[]): Message[] {
  if (!filePath) return messages;
  // Cap first so we never even try to persist unbounded history
  const capped =
    messages.length > CHAT_HISTORY_CAP
      ? messages.slice(-CHAT_HISTORY_CAP)
      : messages;
  try {
    if (capped.length === 0) {
      localStorage.removeItem(CHAT_STORAGE_PREFIX + filePath);
    } else {
      localStorage.setItem(CHAT_STORAGE_PREFIX + filePath, JSON.stringify(capped));
    }
    return capped;
  } catch (e) {
    // Quota exceeded: aggressively trim and retry once.
    const name = e instanceof Error ? e.name : '';
    if (name === 'QuotaExceededError' || name.includes('Quota')) {
      const trimmed = capped.slice(-CHAT_HISTORY_TRIM);
      try {
        localStorage.setItem(CHAT_STORAGE_PREFIX + filePath, JSON.stringify(trimmed));
        if (!quotaWarned) {
          quotaWarned = true;
          console.warn(
            '[ai] localStorage quota reached — chat history was trimmed to the last',
            CHAT_HISTORY_TRIM,
            'messages. Consider clearing older notebooks\' chat history.'
          );
        }
        return trimmed;
      } catch {
        console.error('[ai] could not persist chat history even after trimming');
      }
    }
    return capped;
  }
}

export function SidebarAI() {
  const filePath = useNotebookStore(s => s.filePath);
  const [messages, setMessages] = useState<Message[]>(() => loadChat(filePath));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // reload chat when switching notebooks
  useEffect(() => {
    setMessages(loadChat(filePath));
  }, [filePath]);

  // persist on change — if the persist layer trimmed the history (cap or
  // quota), adopt the trimmed array so the UI reflects what's actually stored
  useEffect(() => {
    const persisted = saveChat(filePath, messages);
    if (persisted.length !== messages.length) {
      setMessages(persisted);
    }
  }, [messages, filePath]);

  const provider = useUIStore(s => s.aiProvider);
  const apiKey = useUIStore(s => s.aiApiKey);
  const model = useUIStore(s => s.aiModel);
  const baseUrl = useUIStore(s => s.aiBaseUrl);

  const hasKey = provider === 'ollama' || apiKey.length > 0;

  async function send() {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // build context: full notebook content (code + outputs)
    const cells = useNotebookStore.getState().cells;
    const activeId = useNotebookStore.getState().activeCellId;
    const filePath = useNotebookStore.getState().filePath;

    let notebookContext = `Notebook: ${filePath ?? 'untitled'}\n\n`;
    cells.forEach((cell, i) => {
      const isActive = cell.id === activeId;
      const marker = isActive ? ' ← ACTIVE CELL' : '';
      if (cell.cell_type === 'markdown') {
        notebookContext += `--- Cell ${i + 1} (markdown)${marker} ---\n${cell.source}\n\n`;
      } else if (cell.cell_type === 'code') {
        notebookContext += `--- Cell ${i + 1} (code)${marker} ---\n\`\`\`python\n${cell.source}\n\`\`\`\n`;
        // include text outputs
        for (const out of cell.outputs) {
          if (out.output_type === 'stream') {
            notebookContext += `Output: ${out.text ?? ''}\n`;
          } else if (out.output_type === 'error') {
            notebookContext += `Error: ${out.ename}: ${out.evalue}\n`;
            const tb = out.traceback;
            // eslint-disable-next-line no-control-regex
            if (tb?.length) notebookContext += tb.join('\n').replace(/\x1b\[[0-9;]*m/g, '') + '\n';
          } else if (out.output_type === 'execute_result') {
            const plain = (out.data as Record<string, unknown> | undefined)?.['text/plain'];
            if (plain) notebookContext += `Result: ${plain}\n`;
          }
        }
        notebookContext += '\n';
      }
    });

    const systemPrompt = [
      'You are a helpful coding assistant in a Jupyter-style notebook called CellForge.',
      'Be concise. Use markdown for code blocks.',
      'The user can see the notebook — don\'t repeat code they already have unless modifying it.',
      '\n--- FULL NOTEBOOK CONTEXT ---\n',
      notebookContext,
    ].join('');

    try {
      const res = await api.aiChat(provider, apiKey, newMessages, {
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        system: systemPrompt,
      });

      if (res.ok && res.content) {
        setMessages([...newMessages, { role: 'assistant', content: res.content }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${res.error ?? 'Unknown error'}` }]);
      }
    } catch (e: unknown) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (!hasKey) {
    return (
      <div className="text-xs text-text-muted p-2 text-center">
        <p>Configure your AI provider in Settings → AI Assistant</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* messages */}
      <div className="flex-1 overflow-y-auto space-y-2 pb-2">
        {messages.length === 0 && (
          <div className="text-text-muted text-center py-4">
            Ask anything about your code.
            <br />
            <span className="text-[10px]">Active cell context is sent automatically.</span>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`px-2 py-1.5 rounded-lg ${
              msg.role === 'user'
                ? 'bg-accent/10 text-text ml-4'
                : 'bg-bg-elevated text-text-secondary mr-4'
            }`}
          >
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Thinking...
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-border pt-2 flex gap-1">
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="p-1.5 rounded hover:bg-bg-hover text-text-muted shrink-0"
            title="Clear chat"
          >
            <Trash2 size={12} />
          </button>
        )}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about your code..."
          disabled={loading}
          className="field field-sm flex-1"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="p-1.5 rounded bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-40 shrink-0"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
