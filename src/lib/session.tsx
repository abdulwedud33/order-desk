'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { translate, type Locale } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { translateError } from '../domain/errors';

export type MemberRole = 'owner' | 'staff' | 'kitchen' | 'courier';
export type BusinessType = 'food' | 'delivery' | 'repair';

export interface ShopInfo {
  id: string;
  name: string;
  business_type: BusinessType;
  currency: string;
  locale: Locale;
  timezone: string;
  default_delivery_fee: number;
}

export interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface AppContextType {
  ready: boolean;
  session: Session | null;
  user: User | null;
  shop: ShopInfo | null;
  role: MemberRole | null;
  locale: Locale;
  online: boolean;
  toasts: ToastItem[];
  setLocale: (l: Locale) => void;
  setRole: (r: MemberRole | null) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  errorText: (e: unknown) => string;
  showToast: (message: string, actionLabel?: string, onAction?: () => void) => void;
  refreshShop: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

const FALLBACK_SHOP: ShopInfo = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Order Desk Shop',
  business_type: 'food',
  currency: 'ETB',
  locale: 'en',
  timezone: 'Africa/Addis_Ababa',
  default_delivery_fee: 50,
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(FALLBACK_SHOP);
  const [role, setRole] = useState<MemberRole | null>('owner');
  const [locale, setLocaleState] = useState<Locale>('en');
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    try {
      const savedLocale = localStorage.getItem('od-locale') as Locale;
      if (savedLocale && ['en', 'am', 'om'].includes(savedLocale)) {
        setLocaleState(savedLocale);
      }
      const savedRole = localStorage.getItem('od-role') as MemberRole;
      if (savedRole && ['owner', 'staff', 'kitchen', 'courier'].includes(savedRole)) {
        setRole(savedRole);
      }
    } catch {}
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('od-locale', l);
    } catch {}
    document.documentElement.lang = l;
  }, []);

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

  const refreshShop = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setShop(FALLBACK_SHOP);
        setRole('owner');
        return;
      }

      const { data: members } = await supabase
        .from('shop_members')
        .select('shop_id, role, shops(*)')
        .eq('user_id', user.id)
        .limit(1);

      if (members && members.length > 0 && members[0]?.shops) {
        const m = members[0];
        const s = m.shops as unknown as ShopInfo;
        setShop(s);
        setRole(m.role as MemberRole);
        if (s.locale && ['en', 'am', 'om'].includes(s.locale)) {
          setLocale(s.locale);
        }
      } else {
        setShop(null);
        setRole(null);
      }
    } catch {
      // In offline mode or initial state
    }
  }, [setLocale]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      refreshShop().finally(() => setReady(true));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      refreshShop().finally(() => setReady(true));
    });

    return () => subscription.unsubscribe();
  }, [refreshShop]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem('od-session');
    } catch {}
    setSession(null);
    setShop(null);
    setRole(null);
  }, []);

  const t = useCallback((key: MessageKey, params?: Record<string, string | number>) => {
    return translate(locale, key, params);
  }, [locale]);

  const errorText = useCallback((e: unknown) => {
    const err = translateError(e);
    return translate(locale, err.messageKey);
  }, [locale]);

  const showToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, actionLabel, onAction }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <AppContext.Provider
      value={{
        ready,
        session,
        user: session?.user ?? null,
        shop,
        role,
        locale,
        online,
        toasts,
        setLocale,
        setRole: (r: MemberRole | null) => {
          setRole(r);
          try {
            if (r) localStorage.setItem('od-role', r);
            else localStorage.removeItem('od-role');
          } catch {}
        },
        t,
        errorText,
        showToast,
        refreshShop,
        signOut,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
