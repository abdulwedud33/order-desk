'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '../lib/session';
import type { MessageKey } from '../i18n/en';

interface NavItem {
  href: string;
  key: MessageKey;
  icon: string;
  isCenter?: boolean;
}

export function BottomNav() {
  const pathname = usePathname();
  const { role, t, shop } = useApp();

  if (!shop) return null;

  let items: NavItem[] = [];

  if (role === 'owner') {
    items = [
      { href: '/', key: 'nav.board', icon: '📋' },
      { href: '/new', key: 'nav.new', icon: '+', isCenter: true },
      { href: '/customers', key: 'nav.customers', icon: '👥' },
      { href: '/reports', key: 'nav.reports', icon: '📊' },
      { href: '/more', key: 'nav.more', icon: '⚙️' },
    ];
  } else if (role === 'staff') {
    items = [
      { href: '/', key: 'nav.board', icon: '📋' },
      { href: '/new', key: 'nav.new', icon: '+', isCenter: true },
      { href: '/customers', key: 'nav.customers', icon: '👥' },
      { href: '/catalog', key: 'nav.catalog', icon: '🍽️' },
      { href: '/more', key: 'nav.more', icon: '⚙️' },
    ];
  } else if (role === 'kitchen') {
    items = [
      { href: '/', key: 'nav.board', icon: '🍳' },
      { href: '/more', key: 'nav.more', icon: '⚙️' },
    ];
  } else if (role === 'courier') {
    items = [
      { href: '/deliveries', key: 'nav.deliveries', icon: '🛵' },
      { href: '/more', key: 'nav.more', icon: '⚙️' },
    ];
  } else {
    items = [
      { href: '/', key: 'nav.board', icon: '📋' },
      { href: '/more', key: 'nav.more', icon: '⚙️' },
    ];
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line shadow-bar flex items-center justify-around h-16 max-w-lg mx-auto"
      aria-label="Bottom Navigation"
    >
      {items.map((item) => {
        const isActive = pathname === item.href;

        if (item.isCenter) {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="-mt-5 w-14 h-14 rounded-full bg-ember text-on-ember flex items-center justify-center text-2xl font-bold shadow-sheet transition-transform active:scale-95"
              aria-label={t(item.key)}
            >
              {item.icon}
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs transition-colors ${
              isActive ? 'text-ember font-semibold' : 'text-slate hover:text-ink'
            }`}
          >
            <span className="text-lg leading-none mb-1">{item.icon}</span>
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
