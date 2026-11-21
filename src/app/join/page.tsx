'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../lib/session';

export default function JoinPage() {
  const router = useRouter();
  const { t, errorText, refreshShop } = useApp();
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length !== 16) {
      setErrorMsg(t('join.code'));
      return;
    }

    setLoading(true);
    try {
      const { data: _shopId, error } = await supabase.rpc('accept_invite', {
        p_code: cleanCode,
      });
      if (error) throw error;
      await refreshShop();
      router.push('/');
    } catch (err) {
      setErrorMsg(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
      <div className="bg-surface border border-line rounded-ticket p-6 shadow-sm">
        <h1 className="text-2xl font-bold font-heading text-ink mb-2">
          {t('join.title')}
        </h1>
        <p className="text-sm text-slate mb-6">
          {t('join.desc')}
        </p>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              {t('join.code')}
            </label>
            <input
              type="text"
              required
              maxLength={16}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. A1B2C3D4E5F67890"
              className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink font-mono text-center tracking-widest uppercase focus:outline-none focus:border-ember"
            />
          </div>

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
            {loading ? t('common.loading') : t('join.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}
