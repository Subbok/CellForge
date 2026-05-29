import { useTranslation } from 'react-i18next';

/**
 * Renders compiled Typst pages as inline SVG — crisp at any zoom, with no
 * browser PDF chrome. Pages are styled like sheets of paper (white, shadow,
 * centered) on a neutral scrollable canvas.
 */
export function TypstPreview({ pages, error }: { pages: string[] | null; error: string }) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--color-error, #f87171)', fontSize: 12, margin: 0 }}>{error}</pre>
      </div>
    );
  }

  if (!pages || pages.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16, textAlign: 'center' }}>
        {t('typst.compileHint')}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg-elevated)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {pages.map((svg, i) => (
          <div
            key={i}
            style={{ background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.4)', borderRadius: 2, overflow: 'hidden' }}
            // Inject an inline style on the <svg> so it scales to the page
            // width (CSS width beats the pt width/height attributes).
            dangerouslySetInnerHTML={{
              __html: svg.replace('<svg', '<svg style="width:100%;height:auto;display:block"'),
            }}
          />
        ))}
      </div>
    </div>
  );
}
