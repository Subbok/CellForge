import { type ReactNode } from 'react';
import { FFNav, type NavStage } from './FFNav';

/**
 * Shell wrapper rendered around every authenticated stage (home, browse,
 * settings, admin, notebook editor). Renders the global top-nav above the
 * stage content. Login, loading and the kernel-picker stage do *not* use
 * this wrapper — they're full-bleed.
 */
export function AppShell({
  user,
  currentStage,
  hasOpenNotebook,
  onNav,
  onLogout,
  onOpenSearch,
  children,
}: {
  user: { username: string; display_name?: string; is_admin: boolean } | null;
  currentStage: NavStage;
  hasOpenNotebook: boolean;
  onNav: (stage: NavStage) => void;
  onLogout: () => void;
  onOpenSearch?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen min-h-0">
      <FFNav
        user={user}
        currentStage={currentStage}
        hasOpenNotebook={hasOpenNotebook}
        onNav={onNav}
        onLogout={onLogout}
        onOpenSearch={onOpenSearch}
      />
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
