'use client';

import React from 'react';
import { getBalanceStatus, calculateBalance, type BalanceStatus } from '../domain/payments';
import { useApp } from '../lib/session';

interface BalanceChipProps {
  total: number;
  paidAmount: number;
  settleLater?: boolean;
  currency?: string;
  onClick?: () => void;
  className?: string;
}

export function BalanceChip({
  total,
  paidAmount,
  settleLater,
  currency = 'ETB',
  onClick,
  className = '',
}: BalanceChipProps) {
  const { t } = useApp();
  const status: BalanceStatus = getBalanceStatus(total, paidAmount, settleLater);
  const balance = calculateBalance(total, paidAmount);

  let badgeColor = '';
  let label = '';
  let icon: React.ReactNode = null;

  if (status === 'paid') {
    badgeColor = 'bg-[#0F7B5F]/10 text-[#0F7B5F] border-[#0F7B5F]/30 hover:bg-[#0F7B5F]/20';
    label = t('pay.paid');
    icon = (
      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    );
  } else if (status === 'settle_later') {
    badgeColor = 'bg-[#6B4BC4]/10 text-[#6B4BC4] border-[#6B4BC4]/30 hover:bg-[#6B4BC4]/20';
    label = `${t('pay.settleLater')} · ${currency} ${balance.toFixed(2)}`;
    icon = (
      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  } else if (status === 'partial') {
    badgeColor = 'bg-[#E0A030]/15 text-[#8A5600] border-[#E0A030]/40 hover:bg-[#E0A030]/25';
    label = `${t('pay.partial')} · ${currency} ${balance.toFixed(2)}`;
    icon = (
      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  } else {
    // unpaid
    badgeColor = 'bg-slate/10 text-slate border-line hover:bg-slate/20';
    label = `${t('pay.unpaid')} · ${currency} ${balance.toFixed(2)}`;
    icon = (
      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  const baseClasses = `inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${badgeColor} ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`${baseClasses} cursor-pointer active:scale-95`}
        title={t('pay.title')}
      >
        {icon}
        <span className="font-tabular">{label}</span>
      </button>
    );
  }

  return (
    <span className={baseClasses}>
      {icon}
      <span className="font-tabular">{label}</span>
    </span>
  );
}
