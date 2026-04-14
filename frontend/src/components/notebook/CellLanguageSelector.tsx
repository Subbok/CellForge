import { useState, useRef, useEffect } from 'react';
import { langColor as getLangColor } from '../../lib/languages';

interface Props {
  language: string;
  onChange: (lang: string) => void;
  availableLanguages: string[];
}

export function CellLanguageSelector({ language, onChange, availableLanguages }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const color = getLangColor(language);

  // If only 1 language available, just show label, no dropdown
  if (availableLanguages.length <= 1) {
    return (
      <span
        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
        style={{ color }}
      >
        {language}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors cursor-pointer"
        style={{ color }}
        title="Change cell language"
      >
        {language}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-lg py-1 z-50 min-w-[100px]">
          {availableLanguages.map(lang => {
            const langColor = getLangColor(lang);
            const isCurrent = lang === language;
            return (
              <button
                key={lang}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(lang);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1 text-[11px] hover:bg-bg-hover transition-colors ${
                  isCurrent ? 'font-bold' : ''
                }`}
                style={{ color: langColor }}
              >
                {lang}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
