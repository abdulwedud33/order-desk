'use client';

import { useApp } from '../lib/session';

export function OfflineBanner() {
  const { online, t } = useApp();

  if (online) return null;

  return (
    <div
      className="bg-line text-ink border-b border-slate/20 px-4 py-2 text-xs font-medium flex items-center justify-between sticky top-0 z-40"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-late animate-pulse" />
        <span>{t('common.offline')}</span>
      </div>
    </div>
  );
}
