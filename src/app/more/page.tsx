'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../lib/session';

export default function MorePage() {
  const router = useRouter();
  const { t, role, shop, setLocale, locale, signOut } = useApp();

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth');
  };

  return (
    <main className="p-4 max-w-lg mx-auto pb-24 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink">{t('nav.more')}</h1>
        <p className="text-xs text-slate mt-0.5">{shop?.name || 'Order Desk'}</p>
      </div>

      {/* Navigation Sections */}
      <div className="space-y-4">
        {/* Core Sections */}
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-xs divide-y divide-line">
          <Link
            href="/catalog"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🍽️</span>
              <span className="text-sm font-semibold text-ink">{t('nav.catalog')}</span>
            </div>
            <span className="text-slate text-sm">›</span>
          </Link>

          <Link
            href="/customers"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">👥</span>
              <span className="text-sm font-semibold text-ink">{t('nav.customers')}</span>
            </div>
            <span className="text-slate text-sm">›</span>
          </Link>

          {role === 'owner' && (
            <Link
              href="/reports"
              className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">📊</span>
                <span className="text-sm font-semibold text-ink">{t('nav.reports')}</span>
              </div>
              <span className="text-slate text-sm">›</span>
            </Link>
          )}

          {role === 'owner' && (
            <Link
              href="/memory"
              className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🧠</span>
                <div>
                  <span className="text-sm font-semibold text-ink">{t('nav.memory')}</span>
                  <p className="text-xs text-slate">Item nicknames and preferences</p>
                </div>
              </div>
              <span className="text-slate text-sm">›</span>
            </Link>
          )}

          <Link
            href="/kitchen"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🍳</span>
              <span className="text-sm font-semibold text-ink">{t('kitchen.title')}</span>
            </div>
            <span className="text-slate text-sm">›</span>
          </Link>

          <Link
            href="/deliveries"
            className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🛵</span>
              <span className="text-sm font-semibold text-ink">{t('nav.deliveries')}</span>
            </div>
            <span className="text-slate text-sm">›</span>
          </Link>
        </div>

        {/* Language Selection */}
        <div className="bg-surface border border-line rounded-2xl p-4 shadow-xs space-y-2">
          <label className="block text-xs font-semibold text-slate">
            {t('onboarding.language')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { code: 'en', label: 'English' },
              { code: 'am', label: 'አማርኛ' },
              { code: 'om', label: 'Afaan Oromoo' },
            ].map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => setLocale(lang.code as 'en' | 'am' | 'om')}
                className={`py-2 px-1 text-xs font-semibold rounded-xl border text-center transition-all ${
                  locale === lang.code
                    ? 'border-ember bg-ember-soft text-ember'
                    : 'border-line bg-surface text-slate hover:bg-slate-50'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-2xl text-sm transition-colors"
        >
          {t('auth.signIn')} / Sign Out
        </button>
      </div>
    </main>
  );
}
