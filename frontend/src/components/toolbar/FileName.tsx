import { useState, useRef, useEffect } from 'react';
import { useNotebookStore } from '../../stores/notebookStore';
import { api } from '../../services/api';

export function FileName() {
  const filePath = useNotebookStore(s => s.filePath);
  const dirty = useNotebookStore(s => s.dirty);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const fullName = filePath?.split('/').pop() ?? 'Untitled.ipynb';

  function startEditing() {
    setValue(fullName);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    const input = inputRef.current;
    input.focus();
    // select just the name part, not the extension
    const dot = fullName.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : fullName.length);
  }, [editing, fullName]);

  async function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === fullName || !filePath) return;

    try {
      const res = await api.renameNotebook(filePath, trimmed);
      useNotebookStore.setState({ filePath: res.path });
    } catch (e: unknown) {
      console.error('rename failed:', e);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="text-sm text-text bg-bg-elevated border border-accent/40 rounded px-2 py-0.5
          outline-none w-52 font-mono"
      />
    );
  }

  return (
    <button onClick={startEditing}
      className="text-sm text-text hover:text-accent transition-colors cursor-text"
      title="Click to rename">
      {fullName}
      {dirty && <span className="text-text-muted ml-1">(unsaved)</span>}
    </button>
  );
}
