import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../lib/i18n';
import { api } from '../services/api';
import { useUIStore } from '../stores/uiStore';
import { refreshPlugins } from '../plugins/loader';
import { Trash2, Upload, Check, Puzzle, Shield, RotateCcw, Key, Pencil, FileCode2 } from 'lucide-react';
import { TypstEditorModal } from './TypstEditorModal';
import { useModal } from './ModalDialog';
import type { PluginEntry, PluginScope } from '../plugins/types';
import { BrandMark } from './brand/BrandMark';
import { Avatar, bumpAvatar } from './Avatar';
import { APP_VERSION } from '../lib/version';

interface Props {
  user?: { username: string; is_admin: boolean };
}

type SectionId =
  | 'profile' | 'appearance' | 'editor' | 'ai'
  | 'plugins' | 'templates' | 'users' | 'about';

/** Pane shell: H1 + subtitle, used by every section's right-hand content. */
function PaneHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h1 className="font-semibold" style={{
        fontSize: 28, color: 'var(--color-text)', letterSpacing: '-0.025em',
      }}>{title}</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
        {subtitle}
      </p>
    </div>
  );
}

/** Settings row — label + sub on the left, control on the right. JSX baseline. */
function Row({ label, sub, children }: {
  label: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center"
      style={{ padding: '16px 0', borderTop: '1px solid var(--color-border-subtle)', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{label}</div>
        {sub && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Settings({ user }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<SectionId>('profile');

  const sections: { id: SectionId; label: string; visible: boolean }[] = [
    { id: 'profile',    label: t('settings.secProfile'),    visible: true },
    { id: 'appearance', label: t('settings.secAppearance'), visible: true },
    { id: 'editor',     label: t('settings.secEditor'),     visible: true },
    { id: 'ai',         label: t('settings.secAi'),         visible: true },
    { id: 'plugins',    label: t('settings.secPlugins'),    visible: true },
    { id: 'templates',  label: t('settings.secTemplates'),  visible: true },
    { id: 'about',      label: t('settings.secAbout'),      visible: true },
  ];

  const visibleSections = sections.filter(s => s.visible);

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden" style={{
      background: 'var(--color-bg)',
    }}>
      {/* Mobile — horizontal tab strip above main */}
      <nav className="md:hidden flex items-center gap-1 overflow-x-auto shrink-0"
        style={{
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
          padding: '8px 12px',
        }}
      >
        {visibleSections.map(s => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="shrink-0 transition-colors"
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12,
                color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                background: isActive ? 'var(--color-bg-hover)' : 'transparent',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Desktop — left sidebar section nav */}
      <aside className="hidden md:block" style={{
        width: 240, flexShrink: 0,
        background: 'var(--color-bg-secondary)',
        borderRight: '1px solid var(--color-border)',
        padding: 16,
        overflowY: 'auto',
      }}>
        <div className="uppercase" style={{
          fontSize: 11, color: 'var(--color-text-muted)',
          letterSpacing: '0.06em', marginBottom: 12, paddingLeft: 12,
        }}>
          {t('settings.title')}
        </div>
        {visibleSections.map(s => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="w-full text-left transition-colors"
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 13,
                color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                background: isActive ? 'var(--color-bg-hover)' : 'transparent',
                marginBottom: 2,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </aside>

      {/* Right pane — selected section */}
      <main className="flex-1 overflow-auto" style={{ padding: 'clamp(16px, 4vw, 32px) clamp(16px, 4vw, 40px)' }}>
        <div style={{ maxWidth: 760 }}>
          {active === 'profile'    && <ProfilePane user={user} />}
          {active === 'appearance' && <AppearancePane isAdmin={!!user?.is_admin} />}
          {active === 'editor'     && <EditorPane />}
          {active === 'ai'         && <AiPane />}
          {active === 'plugins'    && <PluginsPane isAdmin={!!user?.is_admin} />}
          {active === 'templates'  && <TemplatesPane />}
          {active === 'about'      && <AboutPane />}
        </div>
      </main>
    </div>
  );
}

// ── Section panes ────────────────────────────────────────────────────────────

function ProfilePane({ user }: { user?: { username: string; is_admin: boolean } }) {
  const { t } = useTranslation();
  return (
    <>
      <PaneHeader title={t('settings.secProfile')} subtitle={t('settings.subProfile')} />
      {user && <ProfileImageEmail username={user.username} />}
      <Row label={t('auth.username')}>
        <span className="font-mono text-text" style={{ fontSize: 13 }}>{user?.username ?? '—'}</span>
      </Row>
      <Row label={t('admin.role')}>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: user?.is_admin
            ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
            : 'var(--color-bg-hover)',
          color: user?.is_admin ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        }}>
          {user?.is_admin ? 'admin' : 'user'}
        </span>
      </Row>
      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 24, marginTop: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
          {t('auth.password')}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          {t('settings.changePasswordDesc')}
        </p>
        <ChangePassword />
      </div>
    </>
  );
}

/** Avatar upload + email-for-Gravatar pair. Sits at the top of the
 *  Profile pane because it's the visual identity surface — everything
 *  below it is text and account flags. */
function ProfileImageEmail({ username }: { username: string }) {
  const [hasLocal, setHasLocal] = useState(false);
  const [email, setEmail] = useState('');
  const [emailDirty, setEmailDirty] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'remove' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.avatarStatus().then(s => {
      if (cancelled) return;
      setHasLocal(s.has_local);
      setEmail(s.email ?? '');
      setEmailDirty(false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy('upload');
    try {
      await api.uploadAvatar(file);
      setHasLocal(true);
      bumpAvatar(username);
      flash();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemove() {
    setError(null);
    setBusy('remove');
    try {
      await api.deleteAvatar();
      setHasLocal(false);
      bumpAvatar(username);
      flash();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSaveEmail() {
    setError(null);
    setBusy('email');
    try {
      await api.setEmail(email);
      bumpAvatar(username);
      setEmailDirty(false);
      flash();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function flash() {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  return (
    <div style={{
      display: 'flex',
      gap: 20,
      padding: '16px 0 20px',
      borderBottom: '1px solid var(--color-border-subtle)',
      marginBottom: 12,
    }}>
      <Avatar username={username} size={72} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy === 'upload'}
            className="btn btn-md btn-primary"
          >
            {busy === 'upload' ? 'Uploading…' : hasLocal ? 'Change picture' : 'Upload picture'}
          </button>
          {hasLocal && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy === 'remove'}
              className="btn btn-md btn-secondary"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onUpload}
            style={{ display: 'none' }}
          />
          {savedFlash && (
            <span style={{ fontSize: 11, color: 'var(--color-success)' }}>Saved</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '6px 0 16px' }}>
          PNG / JPG / WebP. Resized to 256×256.
        </p>

        <label
          style={{
            display: 'block',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            marginBottom: 6,
          }}
        >
          Email <span style={{ color: 'var(--color-text-muted)' }}>(used only for Gravatar fallback)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setEmailDirty(true); }}
            placeholder="you@example.com"
            className="field"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={onSaveEmail}
            disabled={!emailDirty || busy === 'email'}
            className="btn btn-md btn-primary"
          >
            {busy === 'email' ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <p style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 6 }}>{error}</p>
        )}
      </div>
    </div>
  );
}

function AppearancePane({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useTranslation();
  const accentColor = useUIStore(s => s.accentColor);
  const setAccentColor = useUIStore(s => s.setAccentColor);
  const sidebarSide = useUIStore(s => s.sidebarSide);
  const setSidebarSide = useUIStore(s => s.setSidebarSide);

  return (
    <>
      <PaneHeader title={t('settings.secAppearance')} subtitle={t('settings.subAppearance')} />
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 14, color: 'var(--color-text)', marginBottom: 4 }}>
          {t('settings.accentColor')}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          {t('settings.accentDescription')}
        </p>
        <AccentPicker value={accentColor} onChange={setAccentColor} />
      </div>

      <Row label={t('settings.language')} sub={t('settings.languageDescription')}>
        <div className="flex" style={{ gap: 6 }}>
          {[
            { code: 'en', label: 'EN' },
            { code: 'pl', label: 'PL' },
          ].map(lang => (
            <button
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: i18n.language === lang.code
                  ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                  : 'var(--color-bg-elevated)',
                color: i18n.language === lang.code ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: i18n.language === lang.code
                  ? '1px solid var(--color-accent)'
                  : '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </Row>

      <Row label={t('settings.sidebarSide')} sub={t('settings.sidebarSideDesc')}>
        <div className="flex" style={{ gap: 6 }}>
          {([
            { v: 'left' as const,  label: t('settings.sidebarLeft') },
            { v: 'right' as const, label: t('settings.sidebarRight') },
          ]).map(opt => (
            <button
              key={opt.v}
              onClick={() => setSidebarSide(opt.v)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: sidebarSide === opt.v
                  ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                  : 'var(--color-bg-elevated)',
                color: sidebarSide === opt.v ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: sidebarSide === opt.v
                  ? '1px solid var(--color-accent)'
                  : '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Row>

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 24, marginTop: 8 }}>
        <ThemesSection isAdminProp={isAdmin} />
      </div>
    </>
  );
}

function EditorPane() {
  const { t } = useTranslation();
  const autoSave = useUIStore(s => s.autoSaveInterval);
  const setAutoSave = useUIStore(s => s.setAutoSaveInterval);
  const reactive = useUIStore(s => s.reactiveEnabled);
  const setReactive = useUIStore(s => s.setReactiveEnabled);

  return (
    <>
      <PaneHeader title={t('settings.secEditor')} subtitle={t('settings.subEditor')} />
      <Row
        label={t('settings.reactiveExecution')}
        sub={reactive ? t('settings.reactiveEnabledDesc') : t('settings.reactiveDisabledDesc')}
      >
        <Toggle on={reactive} onChange={setReactive} />
      </Row>
      <Row label={t('settings.autoSave')}>
        <select
          value={autoSave}
          onChange={e => setAutoSave(Number(e.target.value))}
          style={{
            padding: '6px 10px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 12, color: 'var(--color-text)',
            outline: 'none',
          }}
        >
          <option value={0}>{t('settings.autoSaveDisabled')}</option>
          <option value={10}>{t('settings.autoSave10s')}</option>
          <option value={30}>{t('settings.autoSave30s')}</option>
          <option value={60}>{t('settings.autoSave1m')}</option>
          <option value={120}>{t('settings.autoSave2m')}</option>
          <option value={300}>{t('settings.autoSave5m')}</option>
        </select>
      </Row>
    </>
  );
}

function AiPane() {
  const { t } = useTranslation();
  return (
    <>
      <PaneHeader title={t('settings.secAi')} subtitle={t('settings.subAi')} />
      <AiSettings />
    </>
  );
}

function PluginsPane({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <PaneHeader title={t('settings.secPlugins')} subtitle={t('settings.subPlugins')} />
      <PluginsSection isAdminProp={isAdmin} />
    </>
  );
}

function TemplatesPane() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<{ name: string; variables: { key: string; default_value: string }[]; assets?: string[] }[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadTyp, setUploadTyp] = useState<File | null>(null);
  const [uploadAssets, setUploadAssets] = useState<File[]>([]);
  const typInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTemplate, setEditorTemplate] = useState<string | undefined>(undefined);

  function loadTemplates() {
    api.listTemplates().then(setTemplates).catch(() => {});
  }
  useEffect(() => { loadTemplates(); }, []);

  async function doUpload() {
    if (!uploadName.trim() || !uploadTyp) return;
    const content = await uploadTyp.text();
    await api.uploadTemplate(uploadName.trim(), content, uploadAssets);
    setUploadName(''); setUploadTyp(null); setUploadAssets([]);
    setShowUpload(false);
    loadTemplates();
  }

  async function deleteTemplate(name: string) {
    if (name === 'default') return;
    await api.deleteTemplate(name);
    loadTemplates();
  }

  return (
    <>
      <PaneHeader title={t('settings.secTemplates')} subtitle={t('settings.subTemplates')} />
      <div className="space-y-1">
        {templates.map(tpl => (
          <div key={tpl.name}
            className="flex items-center gap-3"
            style={{
              padding: '12px 16px', borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}>
            <div className="flex-1 min-w-0">
              <span className="text-text" style={{ fontSize: 13 }}>{tpl.name}</span>
              {tpl.variables.length > 0 && (
                <span className="text-text-muted ml-2" style={{ fontSize: 11 }}>
                  ({tpl.variables.map(v => v.key).join(', ')})
                </span>
              )}
              {tpl.assets && tpl.assets.length > 0 && (
                <span className="text-text-muted ml-2" style={{ fontSize: 11 }}>
                  · {tpl.assets.length} asset{tpl.assets.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {tpl.name !== 'blank' && (
              <button onClick={() => { setEditorTemplate(tpl.name); setEditorOpen(true); }}
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text"
                title={t('settings.editTemplate')}>
                <Pencil size={14} />
              </button>
            )}
            <label className="btn btn-sm btn-ghost cursor-pointer" title={t('settings.addAssets')}>
              <Upload size={12} />
              <input type="file" multiple className="hidden" onChange={async e => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                try { await api.uploadTemplateAssets(tpl.name, files); loadTemplates(); }
                catch { /* ignored */ }
                e.target.value = '';
              }} />
            </label>
            {tpl.name !== 'default' && (
              <button onClick={() => deleteTemplate(tpl.name)}
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-error">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {!showUpload ? (
        <div className="flex gap-2 mt-3">
          <button onClick={() => { setEditorTemplate(undefined); setEditorOpen(true); }} className="btn btn-md btn-primary">
            <FileCode2 size={14} /> {t('settings.newTemplate')}
          </button>
          <button onClick={() => setShowUpload(true)} className="btn btn-md btn-secondary">
            <Upload size={14} /> {t('settings.uploadTemplate')}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3" style={{
          padding: 16, borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}>
          <input
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
            placeholder={t('settings.templateName')}
            className="field"
          />
          <div>
            <label className="text-xs text-text-muted block mb-1">{t('settings.templateFile')}</label>
            <input ref={typInputRef} type="file" accept=".typ"
              onChange={e => setUploadTyp(e.target.files?.[0] ?? null)}
              className="text-xs text-text-secondary" />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">{t('settings.assetsOptional')}</label>
            <input ref={assetInputRef} type="file" multiple
              onChange={e => setUploadAssets(Array.from(e.target.files ?? []))}
              className="text-xs text-text-secondary" />
            {uploadAssets.length > 0 && (
              <div className="text-xs text-text-muted mt-1">
                {uploadAssets.map(f => f.name).join(', ')}
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowUpload(false)} className="btn btn-md btn-ghost">
              {t('common.cancel')}
            </button>
            <button onClick={doUpload} disabled={!uploadName.trim() || !uploadTyp} className="btn btn-md btn-primary">
              {t('common.upload')}
            </button>
          </div>
        </div>
      )}

      {editorOpen && (
        <TypstEditorModal
          templateName={editorTemplate}
          onClose={() => { setEditorOpen(false); loadTemplates(); }}
        />
      )}
    </>
  );
}

function AboutPane() {
  const { t } = useTranslation();
  return (
    <>
      <PaneHeader title={t('settings.secAbout')} subtitle={t('settings.subAbout')} />
      <div className="flex items-center" style={{
        padding: 18, borderRadius: 'var(--radius-lg, 10px)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        gap: 14,
      }}>
        <div className="text-text" style={{
          width: 44, height: 44, borderRadius: 8,
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BrandMark size={26} />
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            CellForge <span className="font-mono text-text-muted" style={{ fontSize: 11, fontWeight: 500, marginLeft: 6 }}>v{APP_VERSION}</span>
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {t('settings.aboutDescription')}
          </p>
        </div>
      </div>
    </>
  );
}

// ── Toggle (JSX 36×20 pill) ──

function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: on ? 'var(--color-accent)' : 'var(--color-bg-hover)',
        position: 'relative', cursor: 'pointer',
        border: 'none',
        transition: 'background 120ms ease',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: on ? 'var(--color-accent-fg)' : 'var(--color-text-muted)',
        transition: 'left 120ms ease, background 120ms ease',
      }} />
    </button>
  );
}

// ── Accent color picker ──

interface AccentSwatch { name: string; hex: string; }

// Curated palette. Each color tested against the Crisp dark bg so they all
// read well on selection bars, active borders, and button fills.
const ACCENT_SWATCHES: AccentSwatch[] = [
  { name: 'Blue',     hex: '#7a99ff' },
  { name: 'Indigo',   hex: '#8b7dff' },
  { name: 'Violet',   hex: '#b57aff' },
  { name: 'Pink',     hex: '#ff7ab8' },
  { name: 'Rose',     hex: '#ff7a7a' },
  { name: 'Amber',    hex: '#ffb066' },
  { name: 'Emerald',  hex: '#4ade80' },
  { name: 'Cyan',     hex: '#5dd2e2' },
];

function AccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const { t } = useTranslation();
  // `userEdits === null` means "show the live `value` prop"; any other string
  // means the user is mid-typing in the hex field. Derived `draft` avoids
  // the prop-sync useEffect that react-hooks/set-state-in-effect rejects.
  const [userEdits, setUserEdits] = useState<string | null>(null);
  const draft = userEdits ?? value;

  function commitDraft() {
    const v = draft.trim();
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex.toLowerCase());
    setUserEdits(null); // either committed → `value` updates → derived again, or invalid → reset
  }

  return (
    <div className="flex flex-col gap-4">
      {/* swatches */}
      <div className="flex flex-wrap gap-2">
        {ACCENT_SWATCHES.map(s => {
          const active = value.toLowerCase() === s.hex.toLowerCase();
          return (
            <button
              key={s.hex}
              onClick={() => onChange(s.hex)}
              title={`${s.name} — ${s.hex}`}
              className={`group relative h-9 w-9 rounded-lg transition-all
                ${active
                  ? 'ring-2 ring-offset-2 ring-offset-bg scale-105'
                  : 'hover:scale-105'
                }`}
              style={{ background: s.hex, ...(active ? { boxShadow: `0 0 0 2px ${s.hex}` } : {}) }}
            >
              {active && (
                <Check size={14} className="absolute inset-0 m-auto text-white drop-shadow" />
              )}
            </button>
          );
        })}
      </div>

      {/* hex input + live preview */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-text-muted shrink-0">{t('settings.customHex')}</label>
        <div className="flex items-center gap-2 bg-bg-elevated border border-border rounded-lg px-2 py-1">
          <span
            className="w-4 h-4 rounded-sm border border-border"
            style={{ background: /^#[0-9a-fA-F]{6}$/.test(draft) ? draft : value }}
          />
          <input
            value={draft}
            onChange={e => setUserEdits(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') commitDraft(); }}
            placeholder="#a78bfa"
            maxLength={7}
            spellCheck={false}
            className="w-24 bg-transparent outline-none text-xs font-mono text-text"
          />
        </div>
        <span className="text-xs text-text-muted">{t('settings.preview')}</span>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: value, background: `${value}10` }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: value }} />
          <span className="text-xs font-medium" style={{ color: value }}>{t('settings.activeCell')}</span>
        </div>
      </div>
    </div>
  );
}

// ── helpers ──

/** A plugin is "theme-only" if it has themes but NO widgets and NO pylib. */
function isThemeOnly(entry: PluginEntry): boolean {
  const c = entry.manifest.contributes;
  if (!c) return false;
  const hasThemes = (c.themes?.length ?? 0) > 0;
  const hasWidgets = (c.widgets?.length ?? 0) > 0;
  const hasPylib = (c.pylib?.length ?? 0) > 0;
  return hasThemes && !hasWidgets && !hasPylib;
}

// ── Themes section ──

function ThemesSection({ isAdminProp }: { isAdminProp: boolean }) {
  const { t } = useTranslation();
  const modal = useModal();
  const plugins = useUIStore(s => s.plugins);
  const allowUserPlugins = useUIStore(s => s.allowUserPlugins);

  const themePlugins = plugins.filter(isThemeOnly);
  const canUpload = allowUserPlugins || isAdminProp;

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await api.uploadPlugin(file, 'user');
      await refreshPlugins();
    } catch (err: unknown) {
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeTheme(entry: PluginEntry) {
    if (!await modal.confirm('Remove theme', `Remove "${entry.manifest.display_name ?? entry.manifest.name}"?`)) return;
    try {
      await api.deletePlugin(entry.scope, entry.manifest.name);
      await refreshPlugins();
    } catch (err: unknown) {
      setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section>
      <h2 className="section-title">{t('settings.themes')}</h2>
      <p className="section-desc">
        {t('settings.themesDescription')}
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 bg-error/10 text-error text-xs rounded-lg">{error}</div>
      )}

      <ThemePicker />

      {/* installed theme plugins */}
      {themePlugins.length > 0 && (
        <div className="mt-4 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{t('settings.installedThemePlugins')}</div>
          {themePlugins.map(entry => (
            <div
              key={`${entry.scope}-${entry.manifest.name}`}
              className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <span className="text-xs text-text">
                  {entry.manifest.display_name ?? entry.manifest.name}
                </span>
                <span className={`ml-2 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                  entry.scope === 'system'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-accent/15 text-accent'
                }`}>
                  {entry.scope === 'system' ? t('settings.system') : t('settings.user')}
                </span>
              </div>
              {((entry.scope === 'user') || (entry.scope === 'system' && isAdminProp)) && (
                <button
                  onClick={() => removeTheme(entry)}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-error shrink-0"
                  title={t('settings.removeTheme')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* upload theme */}
      {canUpload && (
        <div className="mt-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn btn-sm btn-secondary"
          >
            <Upload size={12} /> {uploading ? t('settings.uploading') : t('settings.uploadTheme')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={onPickFile}
            className="hidden"
          />
        </div>
      )}
    </section>
  );
}

// ── Theme picker (cards) ──

function ThemePicker() {
  const { t } = useTranslation();
  const availableThemes = useUIStore(s => s.availableThemes);
  const currentThemeId = useUIStore(s => s.currentThemeId);
  const setCurrentThemeId = useUIStore(s => s.setCurrentThemeId);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {availableThemes.map(th => {
        const active = th.id === currentThemeId;
        const preview = {
          bg: th.vars['--color-bg'] ?? '#000000',
          elevated: th.vars['--color-bg-elevated'] ?? '#242424',
          border: th.vars['--color-border'] ?? 'rgba(255,255,255,0.10)',
          accent: th.vars['--color-accent'] ?? '#a78bfa',
          text: th.vars['--color-text'] ?? '#f4f5f7',
        };
        return (
          <button
            key={th.id}
            onClick={() => setCurrentThemeId(th.id)}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left
              ${active
                ? 'border-accent ring-2 ring-accent/25'
                : 'border-border hover:border-text-muted/50'
              }`}
          >
            {/* mini swatch */}
            <div
              className="w-10 h-10 rounded-md border shrink-0 flex items-center justify-center"
              style={{ background: preview.bg, borderColor: preview.border }}
            >
              <span
                className="w-5 h-2.5 rounded-full"
                style={{ background: preview.accent }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text truncate">{th.name}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider">
                {th.source === 'builtin' ? t('settings.builtIn') : `${th.source} plugin · ${th.plugin ?? ''}`}
              </div>
            </div>
            {active && (
              <Check size={16} className="text-accent shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Plugins section ──

function PluginsSection({ isAdminProp }: { isAdminProp: boolean }) {
  const { t } = useTranslation();
  const modal = useModal();
  const plugins = useUIStore(s => s.plugins);
  const allowUserPlugins = useUIStore(s => s.allowUserPlugins);
  const setAllowUserPlugins = useUIStore(s => s.setAllowUserPlugins);

  // Only show non-theme-only plugins here — theme-only ones live in ThemesSection
  const functionalPlugins = plugins.filter(e => !isThemeOnly(e));

  const [uploadScope, setUploadScope] = useState<PluginScope>('user');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canInstallUser = allowUserPlugins || isAdminProp;
  const canInstallSystem = isAdminProp;
  const canInstallAny = canInstallUser || canInstallSystem;

  // Derived "effective" scope — force `system` / `user` when the user only
  // has one permission. Beats syncing `uploadScope` via a setState-in-effect
  // (which the new react-hooks rule rejects) and makes intent obvious.
  const effectiveScope: PluginScope = (!canInstallUser && canInstallSystem)
    ? 'system'
    : (!canInstallSystem && canInstallUser)
    ? 'user'
    : uploadScope;

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await api.uploadPlugin(file, effectiveScope);
      await refreshPlugins();
    } catch (err: unknown) {
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removePlugin(entry: PluginEntry) {
    if (!await modal.confirm('Delete plugin', `Delete "${entry.manifest.name}"?`)) return;
    setError('');
    try {
      await api.deletePlugin(entry.scope, entry.manifest.name);
      await refreshPlugins();
    } catch (err: unknown) {
      setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function toggleAllowUser(next: boolean) {
    setError('');
    try {
      const updated = await api.setPluginConfig({ allow_user_plugins: next });
      setAllowUserPlugins(updated.allow_user_plugins);
    } catch (err: unknown) {
      setError(`Config update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section>
      <h2 className="section-title">{t('settings.plugins')}</h2>
      <p className="section-desc">
        {t('settings.pluginsDescription')}
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 bg-error/10 text-error text-xs rounded-lg">{error}</div>
      )}

      {/* Admin-only: allow_user_plugins toggle */}
      {isAdminProp && (
        <div className="mb-4 p-3 border border-border rounded-lg bg-bg-elevated/40 flex items-center gap-3">
          <div className="p-1.5 rounded bg-accent/10 text-accent">
            <Shield size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-text">{t('settings.allowUserPlugins')}</div>
            <div className="text-[11px] text-text-muted">
              {t('settings.allowUserPluginsDesc')}
            </div>
          </div>
          <button
            onClick={() => toggleAllowUser(!allowUserPlugins)}
            className={`btn btn-sm ${allowUserPlugins ? 'btn-primary' : 'btn-secondary'}`}
          >
            {allowUserPlugins ? t('settings.enabled') : t('settings.reactiveDisabled')}
          </button>
        </div>
      )}

      {/* Upload controls */}
      {canInstallAny ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {canInstallUser && canInstallSystem && (
            <div className="flex rounded-lg border border-border overflow-hidden text-xs">
              <button
                onClick={() => setUploadScope('user')}
                className={`px-3 py-1.5 transition-colors ${
                  uploadScope === 'user'
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                {t('settings.user')}
              </button>
              <button
                onClick={() => setUploadScope('system')}
                className={`px-3 py-1.5 transition-colors ${
                  uploadScope === 'system'
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                {t('settings.system')}
              </button>
            </div>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn btn-md btn-secondary"
          >
            <Upload size={14} /> {uploading ? t('settings.uploading') : t('settings.uploadPlugin')}
          </button>
          <button
            onClick={refreshPlugins}
            title={t('settings.refreshPlugins')}
            className="btn btn-md btn-ghost"
          >
            <RotateCcw size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={onPickFile}
            className="hidden"
          />
        </div>
      ) : (
        <div className="mb-4 px-3 py-2 bg-bg-elevated/60 border border-border rounded-lg text-xs text-text-muted">
          {t('settings.pluginsDisabled')}
        </div>
      )}

      {/* Installed plugin list (functional plugins only — themes live above) */}
      <div className="space-y-1">
        {functionalPlugins.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-muted border border-dashed border-border rounded-lg">
            <Puzzle size={16} className="mx-auto mb-1 opacity-50" />
            {t('settings.noPlugins')}
          </div>
        ) : (
          functionalPlugins.map(entry => (
            <div
              key={`${entry.scope}-${entry.manifest.name}`}
              className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg"
            >
              <div className="p-1.5 rounded bg-bg-elevated text-text-muted shrink-0">
                <Puzzle size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text truncate">
                    {entry.manifest.display_name ?? entry.manifest.name}
                  </span>
                  <span className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                    entry.scope === 'system'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-accent/15 text-accent'
                  }`}>
                    {entry.scope === 'system' ? t('settings.system') : t('settings.user')}
                  </span>
                  {entry.manifest.version && (
                    <span className="text-[10px] text-text-muted">v{entry.manifest.version}</span>
                  )}
                </div>
                {(entry.manifest.description || entry.manifest.author) && (
                  <div className="text-[11px] text-text-muted truncate">
                    {entry.manifest.description}
                    {entry.manifest.author && (
                      <> · <span className="italic">{entry.manifest.author}</span></>
                    )}
                  </div>
                )}
              </div>
              {/* delete button — system deletes require admin; per-user deletes always allowed for self */}
              {((entry.scope === 'user') || (entry.scope === 'system' && isAdminProp)) && (
                <button
                  onClick={() => removePlugin(entry)}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-error shrink-0"
                  title={t('settings.removePlugin')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514', defaultUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o-mini', defaultUrl: 'https://api.openai.com/v1' },
  { id: 'google', name: 'Google (Gemini)', defaultModel: 'gemini-2.0-flash', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', defaultUrl: 'https://api.deepseek.com/v1' },
  { id: 'groq', name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', defaultUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral', defaultModel: 'mistral-large-latest', defaultUrl: 'https://api.mistral.ai/v1' },
  { id: 'openrouter', name: 'OpenRouter', defaultModel: 'openai/gpt-4o-mini', defaultUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', name: 'Ollama (local)', defaultModel: 'llama3', defaultUrl: 'http://localhost:11434' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', defaultModel: '', defaultUrl: '' },
];

function AiSettings() {
  const { t } = useTranslation();
  const provider = useUIStore(s => s.aiProvider);
  const apiKey = useUIStore(s => s.aiApiKey);
  const model = useUIStore(s => s.aiModel);
  const setProvider = useUIStore(s => s.setAiProvider);
  const setApiKey = useUIStore(s => s.setAiApiKey);
  const setModel = useUIStore(s => s.setAiModel);
  const setBaseUrl = useUIStore(s => s.setAiBaseUrl);
  const baseUrl = useUIStore(s => s.aiBaseUrl);

  const providerInfo = AI_PROVIDERS.find(p => p.id === provider) ?? AI_PROVIDERS[0];
  const needsKey = provider !== 'ollama';
  const needsUrl = true; // all providers have a base URL

  return (
    <div className="space-y-3 max-w-md">
      <div>
        <label className="text-xs text-text-muted block mb-1">{t('settings.provider')}</label>
        <select
          value={provider}
          onChange={e => {
            setProvider(e.target.value);
            const p = AI_PROVIDERS.find(x => x.id === e.target.value);
            if (p) {
              if (!model || model === providerInfo.defaultModel) setModel(p.defaultModel);
              if (p.defaultUrl) setBaseUrl(p.defaultUrl);
            }
          }}
          className="field"
        >
          {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {needsKey && (
        <div>
          <label className="text-xs text-text-muted block mb-1">{t('settings.apiKey')}</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            className="field"
          />
        </div>
      )}

      {needsUrl && (
        <div>
          <label className="text-xs text-text-muted block mb-1">{t('settings.apiBaseUrl')}</label>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={providerInfo.defaultUrl || 'https://api.example.com/v1'}
            className="field"
          />
        </div>
      )}

      <div>
        <label className="text-xs text-text-muted block mb-1">{t('settings.model')}</label>
        <input
          value={model || providerInfo.defaultModel}
          onChange={e => setModel(e.target.value)}
          placeholder={providerInfo.defaultModel}
          className="field"
        />
      </div>

      <div className="text-[10px] text-text-muted">
        {provider === 'ollama'
          ? t('settings.ollamaNote')
          : t('settings.apiKeyNote')}
      </div>
    </div>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setMsg(''); setErr('');
    if (newPass.length < 4) { setErr(t('settings.passwordMinLength')); return; }
    if (newPass !== confirm) { setErr(t('settings.passwordsMismatch')); return; }
    try {
      const res = await api.changePassword(newPass);
      if (res.ok) { setMsg(t('settings.passwordChanged')); setNewPass(''); setConfirm(''); }
      else setErr(res.error ?? t('settings.failed'));
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="flex flex-col gap-2 max-w-xs">
      <input
        type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
        placeholder={t('settings.newPassword')} className="field"
      />
      <input
        type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
        placeholder={t('settings.confirmPassword')} className="field"
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
      />
      {err && <div className="text-xs text-error">{err}</div>}
      {msg && <div className="text-xs text-success">{msg}</div>}
      <button onClick={submit} disabled={!newPass || !confirm} className="btn btn-md btn-primary w-fit">
        <Key size={14} /> {t('settings.changePassword')}
      </button>
    </div>
  );
}

