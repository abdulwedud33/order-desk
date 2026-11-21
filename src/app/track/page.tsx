'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  isValidTrackingToken,
  calculateTrackingStepper,
  type TrackingResponse,
} from '../../domain/tracking';
import { translate, type Locale } from '../../i18n';
import type { MessageKey } from '../../i18n/en';

function TrackingContent() {
  const searchParams = useSearchParams();
  const rawToken = searchParams.get('token') || '';

  const [locale, setLocale] = useState<Locale>('en');
  const [data, setData] = useState<Extract<TrackingResponse, { found: true }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<'not_found' | 'rate_limited' | 'offline' | null>(null);
  const [online, setOnline] = useState(true);

  // Auto-detect browser/phone language on mount
  useEffect(() => {
    try {
      const navLang = navigator.language?.slice(0, 2).toLowerCase();
      if (navLang === 'am') setLocale('am');
      else if (navLang === 'om') setLocale('om');
      else setLocale('en');
    } catch {}
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  );

  // Monitor network connectivity
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchStatus = useCallback(
    async (isInitial = false) => {
      if (!isValidTrackingToken(rawToken)) {
        setLoading(false);
        setErrorStatus('not_found');
        return;
      }

      if (isInitial) setLoading(true);

      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const endpoint = `${supabaseUrl}/functions/v1/track-order?token=${encodeURIComponent(rawToken)}`;

        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (res.status === 429) {
          setErrorStatus('rate_limited');
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setErrorStatus('not_found');
          setLoading(false);
          return;
        }

        const json = await res.json();
        if (json && json.found) {
          setData(json);
          setErrorStatus(null);
        } else {
          setErrorStatus('not_found');
        }
      } catch {
        if (!navigator.onLine) {
          setErrorStatus('offline');
        } else {
          setErrorStatus('not_found');
        }
      } finally {
        setLoading(false);
      }
    },
    [rawToken]
  );

  // Initial fetch and 20-second auto-refresh
  useEffect(() => {
    fetchStatus(true);
    const intervalId = setInterval(() => {
      fetchStatus(false);
    }, 20_000);
    return () => clearInterval(intervalId);
  }, [fetchStatus]);

  const stepper = data ? calculateTrackingStepper(data.order_type, data.status) : null;

  return (
    <main className="min-h-screen bg-paper flex flex-col justify-between max-w-md mx-auto p-4 sm:p-6 text-ink antialiased">
      {/* Top Header & Language Switcher */}
      <header className="flex items-center justify-between py-3 border-b border-line">
        <div>
          <h1 className="text-lg font-bold font-heading text-ink flex items-center gap-1.5">
            <span>📦</span>
            <span>{data?.shop_name || t('tracking.title')}</span>
          </h1>
          {data?.order_code && (
            <p className="text-xs font-semibold text-slate font-tabular">
              {data.order_code}
            </p>
          )}
        </div>

        {/* 3-Language Switcher */}
        <div className="flex bg-surface p-1 rounded-control border border-line text-xs font-semibold">
          {(['en', 'am', 'om'] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`px-2 py-1 rounded transition-colors ${
                locale === l ? 'bg-ink text-surface' : 'text-slate hover:text-ink'
              }`}
            >
              {l === 'en' ? 'EN' : l === 'am' ? 'አማ' : 'OM'}
            </button>
          ))}
        </div>
      </header>

      {/* Offline Alert Banner */}
      {(!online || errorStatus === 'offline') && (
        <div className="mt-4 p-3 rounded-control bg-amber/15 border border-amber/30 text-xs font-semibold text-amber flex items-center gap-2">
          <span>📡</span>
          <span>{t('tracking.offline')}</span>
        </div>
      )}

      {/* Main Status Container */}
      <div className="my-auto py-8">
        {loading && !data ? (
          /* Layout-matched Skeleton Loader (Zero Spinners) */
          <div className="space-y-6">
            <div className="p-5 bg-surface border border-line rounded-card space-y-4 shadow-sm animate-pulse">
              <div className="h-6 bg-line/60 rounded w-1/2" />
              <div className="h-4 bg-line/40 rounded w-1/3" />
            </div>
            <div className="space-y-3 p-4 bg-surface border border-line rounded-card animate-pulse">
              <div className="h-4 bg-line/50 rounded w-3/4" />
              <div className="h-4 bg-line/50 rounded w-2/3" />
              <div className="h-4 bg-line/50 rounded w-1/2" />
            </div>
          </div>
        ) : errorStatus === 'rate_limited' ? (
          <div className="text-center py-12 px-4 bg-surface border border-line rounded-card space-y-3 shadow-sm">
            <div className="text-3xl">⏳</div>
            <h2 className="text-base font-bold text-ink">{t('err.RATE_LIMITED')}</h2>
            <p className="text-xs text-slate max-w-xs mx-auto">
              {t('tracking.rateLimited')}
            </p>
          </div>
        ) : errorStatus === 'not_found' || !data ? (
          <div className="text-center py-12 px-4 bg-surface border border-line rounded-card space-y-3 shadow-sm">
            <div className="text-3xl">🔍</div>
            <h2 className="text-base font-bold text-ink">{t('tracking.notFound')}</h2>
            <p className="text-xs text-slate max-w-xs mx-auto">
              {t('tracking.notFoundDesc')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status Stepper Card */}
            <div className="p-5 bg-surface border border-line rounded-card shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate uppercase tracking-wider">
                  {t('tracking.orderStatus')}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-ink text-surface">
                  {t(`status.${data.status}` as MessageKey) || data.status}
                </span>
              </div>

              {/* Visual Stepper */}
              <div className="space-y-4 pt-1">
                {stepper?.steps.map((step, idx) => (
                  <div key={step.key} className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                        step.isCompleted
                          ? 'bg-forest text-surface'
                          : step.isCurrent
                          ? 'bg-ember text-on-ember animate-pulse'
                          : 'bg-line/60 text-slate'
                      }`}
                    >
                      {step.isCompleted ? '✓' : idx + 1}
                    </div>
                    <div className="flex-1">
                      <p
                        className={`text-sm ${
                          step.isCurrent
                            ? 'font-bold text-ink'
                            : step.isCompleted
                            ? 'font-semibold text-ink'
                            : 'text-slate'
                        }`}
                      >
                        {t(step.labelKey as MessageKey) || step.key}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Estimated / Promised Time */}
              {data.due_at && (
                <div className="pt-3 border-t border-line flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate">{t('tracking.promisedTime')}:</span>
                  <span className="font-bold font-tabular text-ink">
                    {new Date(data.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>

            {/* Auto-refresh indicator & Last updated */}
            <div className="text-center space-y-1">
              <p className="text-[11px] text-slate flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-forest animate-pulse" />
                <span>{t('tracking.autoRefresh')}</span>
              </p>
              <p className="text-[10px] text-slate font-tabular">
                {t('tracking.lastUpdated')}: {new Date(data.updated_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate border-t border-line">
        <p className="font-semibold text-ink">{data?.shop_name || 'Order Desk'}</p>
        <p className="text-[11px] text-slate mt-0.5">Powered by Order Desk</p>
      </footer>
    </main>
  );
}

export default function TrackingPage() {
  return (
    <>
      <head>
        <title>Order Tracking</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </head>
      <Suspense
        fallback={
          <div className="min-h-screen bg-paper max-w-md mx-auto p-6 space-y-6">
            <div className="h-8 bg-line/60 rounded w-1/3 animate-pulse" />
            <div className="h-48 bg-surface border border-line rounded-card animate-pulse" />
          </div>
        }
      >
        <TrackingContent />
      </Suspense>
    </>
  );
}
