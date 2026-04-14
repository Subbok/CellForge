import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../lib/i18n';
import { api } from '../services/api';
import { useUIStore } from '../stores/uiStore';
import { refreshPlugins } from '../plugins/loader';
import { ArrowLeft, Trash2, Upload, Check, Puzzle, Shield, RotateCcw, Key } from 'lucide-react';
import { useModal } from './ModalDialog';
import type { PluginEntry, PluginScope } from '../plugins/types';

interface Props {
  onBack: () => void;
  user?: { username: string; is_admin: boolean };
}

export function Settings({ onBack, user }: Props) {
  const { t, i18n } = useTranslation();
  const [templates, setTemplates] = useState<{ name: string; variables: { key: string; default_value: string }[]; assets?: string[] }[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadTyp, setUploadTyp] = useState<File | null>(null);
  const [uploadAssets, setUploadAssets] = useState<File[]>([]);
  const typInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const autoSave = useUIStore(s => s.autoSaveInterval);
  const setAutoSave = useUIStore(s => s.setAutoSaveInterval);
  const reactive = useUIStore(s => s.reactiveEnabled);
  const setReactive = useUIStore(s => s.setReactiveEnabled);
  const accentColor = useUIStore(s => s.accentColor);
  const setAccentColor = useUIStore(s => s.setAccentColor);

  function loadTemplates() {
    api.listTemplates().then(setTemplates).catch(() => {});
  }
  useEffect(() => { loadTemplates(); }, []);

  async function doUpload() {
    if (!uploadName.trim() || !uploadTyp) return;
    const content = await uploadTyp.text();
    await api.uploadTemplate(uploadName.trim(), content, uploadAssets);
    setUploadName('');
    setUploadTyp(null);
    setUploadAssets([]);
    setShowUpload(false);
    loadTemplates();
  }

  async function deleteTemplate(name: string) {
    if (name === 'default') return;
    await api.deleteTemplate(name);
    loadTemplates();
  }

  return (
    <div className="h-full overflow-y-auto bg-bg relative">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 600px 300px at 50% 0%, rgba(122,153,255,0.04), transparent)' }} />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-3">
          <button onClick={onBack} className="btn btn-sm btn-ghost gap-1.5">
            <ArrowLeft size={14} /> {t('common.back')}
          </button>
          <div className="w-px h-5 bg-border/50" />
          <h1 className="font-semibold text-text text-sm">{t('settings.title')}</h1>
        </div>
      </header>

      <div className="relative max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* ── Appearance ── */}
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{t('settings.appearance')}</h3>
          <span className="text-[10px] text-text-muted bg-bg-elevated/80 border border-border/40 px-2 py-0.5 rounded">{t('settings.perUser')}</span>
        </div>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.accentColor')}</h2>
          <p className="section-desc">
            {t('settings.accentDescription')}
          </p>
          <AccentPicker value={accentColor} onChange={setAccentColor} />
        </section>

        {/* Language */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text">{t('settings.language')}</h3>
          <p className="text-xs text-text-muted">{t('settings.languageDescription')}</p>
          <div className="flex gap-2">
            {[
              { code: 'en', label: 'English' },
              { code: 'pl', label: 'Polski' },
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  i18n.language === lang.code
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-bg-elevated border-border text-text-secondary hover:border-border/80'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <ThemesSection isAdminProp={Boolean(user?.is_admin)} />
        </div>

        {/* ── Editor ── */}
        <div className="flex items-center gap-2 pt-2">
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{t('settings.editor')}</h3>
          <span className="text-[10px] text-text-muted bg-bg-elevated/80 border border-border/40 px-2 py-0.5 rounded">{t('settings.perUser')}</span>
        </div>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.reactiveExecution')}</h2>
          <p className="section-desc">
            {t('settings.reactiveDescription')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReactive(!reactive)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                reactive
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'bg-bg-elevated border-border text-text-muted hover:border-text-muted/30'
              }`}
            >
              {reactive ? t('settings.reactiveEnabled') : t('settings.reactiveDisabled')}
            </button>
            <span className="text-xs text-text-muted italic">
              {reactive ? t('settings.reactiveEnabledDesc') : t('settings.reactiveDisabledDesc')}
            </span>
          </div>
        </section>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.autoSave')}</h2>
          <div className="flex items-center gap-3">
            <select
              value={autoSave}
              onChange={e => setAutoSave(Number(e.target.value))}
              className="field w-auto"
            >
              <option value={0}>{t('settings.autoSaveDisabled')}</option>
              <option value={10}>{t('settings.autoSave10s')}</option>
              <option value={30}>{t('settings.autoSave30s')}</option>
              <option value={60}>{t('settings.autoSave1m')}</option>
              <option value={120}>{t('settings.autoSave2m')}</option>
              <option value={300}>{t('settings.autoSave5m')}</option>
            </select>
          </div>
        </section>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.aiAssistant')}</h2>
          <p className="section-desc">
            {t('settings.aiDescription')}
          </p>
          <AiSettings />
        </section>

        {/* ── Export ── */}
        <div className="flex items-center gap-2 pt-2">
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{t('settings.exportSection')}</h3>
          <span className="text-[10px] text-text-muted bg-bg-elevated/80 border border-border/40 px-2 py-0.5 rounded">{t('settings.systemWide')}</span>
        </div>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.pdfTemplates')}</h2>
          <p className="section-desc">
            {t('settings.templatesDescription')}
          </p>

          <div className="space-y-1">
            {templates.map(tpl => (
              <div key={tpl.name}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text">{tpl.name}</span>
                  {tpl.variables.length > 0 && (
                    <span className="text-xs text-text-muted ml-2">
                      ({tpl.variables.map(v => v.key).join(', ')})
                    </span>
                  )}
                  {tpl.assets && tpl.assets.length > 0 && (
                    <span className="text-xs text-text-muted ml-2">
                      · {tpl.assets.length} asset{tpl.assets.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <label className="btn btn-sm btn-ghost cursor-pointer" title={t('settings.addAssets')}>
                  <Upload size={12} />
                  <input type="file" multiple className="hidden" onChange={async e => {
                    const files = Array.from(e.target.files ?? []);
                    if (!files.length) return;
                    try {
                      await api.uploadTemplateAssets(tpl.name, files);
                      loadTemplates();
                    } catch { /* ignored */ }
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
            <button onClick={() => setShowUpload(true)} className="btn btn-md btn-secondary mt-3">
              <Upload size={14} /> {t('settings.uploadTemplate')}
            </button>
          ) : (
            <div className="mt-3 p-4 border border-border rounded-lg space-y-3">
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

              <div className="flex gap-2">
                <button
                  onClick={doUpload}
                  disabled={!uploadName.trim() || !uploadTyp}
                  className="btn btn-md btn-primary"
                >
                  {t('common.upload')}
                </button>
                <button onClick={() => setShowUpload(false)} className="btn btn-md btn-ghost">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Account & Users ── */}
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider pt-2">{t('settings.account')}</h3>

        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('auth.password')}</h2>
          <p className="section-desc">{t('settings.changePasswordDesc')}</p>
          <ChangePassword />
        </section>

        {user?.is_admin && (
          <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
            <UserManagement />
          </div>
        )}

        {/* ── Extensions ── */}
        <div className="flex items-center gap-2 pt-2">
          <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">{t('settings.extensions')}</h3>
          <span className="text-[10px] text-text-muted bg-bg-elevated/80 border border-border/40 px-2 py-0.5 rounded">{t('settings.perScope')}</span>
        </div>

        <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <PluginsSection isAdminProp={Boolean(user?.is_admin)} />
        </div>

        {/* ── About ── */}
        <section className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-6">
          <h2 className="section-title">{t('settings.about')}</h2>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Puzzle size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-text">CellForge</p>
              <p className="text-[11px] text-text-muted">{t('settings.aboutDescription')}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
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
  const [draft, setDraft] = useState(value);

  // keep draft in sync when an outside update lands (e.g. swatch click)
  useEffect(() => { setDraft(value); }, [value]);

  function commitDraft() {
    const v = draft.trim();
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex.toLowerCase());
    else setDraft(value); // reset on invalid input
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
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') commitDraft(); }}
            placeholder="#7a99ff"
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
          bg: th.vars['--color-bg'] ?? '#13141b',
          elevated: th.vars['--color-bg-elevated'] ?? '#242736',
          border: th.vars['--color-border'] ?? '#3f4154',
          accent: th.vars['--color-accent'] ?? '#7a99ff',
          text: th.vars['--color-text'] ?? '#ebedf2',
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

  useEffect(() => {
    if (!canInstallUser && canInstallSystem && uploadScope !== 'system') {
      setUploadScope('system');
    } else if (!canInstallSystem && canInstallUser && uploadScope !== 'user') {
      setUploadScope('user');
    }
  }, [canInstallUser, canInstallSystem, uploadScope]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await api.uploadPlugin(file, uploadScope);
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

function UserManagement() {
  const { t } = useTranslation();
  const modal = useModal();
  const [users, setUsers] = useState<{ username: string; display_name?: string; is_admin?: boolean }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [error, setError] = useState('');

  function load() { api.listUsers().then(setUsers).catch(() => {}); }
  useEffect(() => { load(); }, []);

  async function addUser() {
    setError('');
    try {
      const res = await api.register(newUser, newPass, newDisplay || undefined);
      if (!res.ok) { setError(res.error ?? 'failed'); return; }
      setNewUser(''); setNewPass(''); setNewDisplay(''); setShowAdd(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function remove(username: string) {
    await api.deleteUser(username);
    load();
  }

  async function resetPassword(username: string) {
    const newPass = await modal.prompt(t('settings.resetPassword'), `${t('settings.newPassword')} @${username}:`, t('settings.newPassword'));
    if (!newPass) return;
    try {
      const res = await api.changePassword(newPass, username);
      if (res.ok) await modal.alert(t('settings.passwordChanged'), t('settings.passwordUpdated', { username }), 'success');
      else await modal.alert(t('common.error'), res.error ?? t('settings.failed'), 'error');
    } catch (e: unknown) { await modal.alert(t('common.error'), e instanceof Error ? e.message : String(e), 'error'); }
  }

  return (
    <section>
      <h2 className="section-title">{t('settings.users')}</h2>
      <p className="section-desc">{t('settings.usersDesc')}</p>

      <div className="space-y-1 mb-3">
        {users.map(u => (
          <div key={u.username}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-text">{u.display_name || u.username}</span>
              <span className="text-xs text-text-muted ml-2">@{u.username}</span>
              {u.is_admin && <span className="text-[10px] text-accent ml-2 font-medium">{t('settings.admin')}</span>}
            </div>
            <button onClick={() => resetPassword(u.username)}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent" title={t('settings.resetPassword')}>
              <Key size={14} />
            </button>
            {!u.is_admin && (
              <button onClick={() => remove(u.username)}
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-error" title={t('settings.deleteUser')}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} className="btn btn-md btn-secondary">
          <Upload size={14} /> {t('settings.addUser')}
        </button>
      ) : (
        <div className="p-4 border border-border rounded-lg space-y-2">
          <input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder={t('auth.username')} className="field" />
          <input value={newDisplay} onChange={e => setNewDisplay(e.target.value)} placeholder={t('settings.displayNameOptional')} className="field" />
          <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder={t('auth.password')} className="field" />
          {error && <div className="text-xs text-error">{error}</div>}
          <div className="flex gap-2">
            <button onClick={addUser} disabled={!newUser || !newPass} className="btn btn-md btn-primary">
              {t('common.create')}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn btn-md btn-ghost">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
