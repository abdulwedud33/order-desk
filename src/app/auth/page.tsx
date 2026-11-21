'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../lib/session';

export default function AuthPage() {
  const router = useRouter();
  const { t, errorText, refreshShop, setLocale, locale } = useApp();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 10) {
      setErrorMsg(t('auth.password'));
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, locale },
          },
        });
        if (error) throw error;
        await refreshShop();
        router.push('/onboarding');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        await refreshShop();
        router.push('/');
      }
    } catch (err) {
      setErrorMsg(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
      <div className="bg-surface border border-line rounded-ticket p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold font-heading text-ink">
            {isSignUp ? t('auth.signUp') : t('auth.signIn')}
          </h1>
          <div className="flex gap-1 text-xs font-semibold">
            {(['en', 'am', 'om'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                className={`px-2 py-1 rounded-control ${locale === l ? 'bg-ember text-on-ember' : 'bg-line text-ink'}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                {t('auth.name')}
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink focus:outline-none focus:border-ember"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('auth.email')}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink focus:outline-none focus:border-ember"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink focus:outline-none focus:border-ember"
            />
          </div>

          {/* Reserved space for error messages to prevent layout jumping */}
          <div className="min-h-[24px]">
            {errorMsg && (
              <p className="text-xs text-late font-medium fade-in" role="alert">
                {errorMsg}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-ember text-on-ember rounded-control font-semibold text-base transition-opacity active:opacity-90 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('auth.submit')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg(null);
            }}
            className="text-sm text-slate hover:text-ink font-medium"
          >
            {isSignUp ? t('auth.switchSignIn') : t('auth.switchSignUp')}
          </button>
        </div>
      </div>
    </main>
  );
}
