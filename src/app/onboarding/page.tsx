'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { useApp, type BusinessType } from '../../lib/session';

interface SampleItem {
  id: string;
  name: string;
  price: number;
}

const DEFAULT_SAMPLES: Record<BusinessType, SampleItem[]> = {
  food: [
    { id: '1', name: 'Shiro Tegamino', price: 150 },
    { id: '2', name: 'Special Tibs', price: 320 },
    { id: '3', name: 'Beyeaynetu', price: 180 },
    { id: '4', name: 'Macchiato', price: 45 },
  ],
  delivery: [
    { id: '1', name: 'Standard Delivery (Under 5km)', price: 100 },
    { id: '2', name: 'Express Delivery', price: 200 },
    { id: '3', name: 'Fragile / Bulky Delivery', price: 250 },
  ],
  repair: [
    { id: '1', name: 'Screen Replacement', price: 1200 },
    { id: '2', name: 'Battery Replacement', price: 650 },
    { id: '3', name: 'Diagnostics Fee', price: 200 },
  ],
};

export default function OnboardingPage() {
  const router = useRouter();
  const { t, locale, setLocale, refreshShop, errorText } = useApp();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [businessType, setBusinessType] = useState<BusinessType>('food');
  const [shopName, setShopName] = useState('Abel Kitchen');
  const [samples, setSamples] = useState<SampleItem[]>(DEFAULT_SAMPLES.food);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBusinessTypeChange = (type: BusinessType) => {
    setBusinessType(type);
    setSamples(DEFAULT_SAMPLES[type]);
    if (type === 'food') setShopName('My Restaurant');
    else if (type === 'delivery') setShopName('Express Couriers');
    else if (type === 'repair') setShopName('Tech Repair Lab');
  };

  const handleNext = async () => {
    setErrorMsg(null);

    if (step === 1) {
      if (!shopName.trim()) {
        setErrorMsg(t('onboarding.shopName'));
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      setStep(3);
      return;
    }

    if (step === 3) {
      setLoading(true);
      try {
        const { error } = await supabase.rpc('create_shop', {
          p_name: shopName.trim(),
          p_business_type: businessType,
          p_locale: locale,
          p_timezone: 'Africa/Addis_Ababa',
        });
        if (error) throw error;
        await refreshShop();
        router.push('/');
      } catch (err) {
        setErrorMsg(errorText(err));
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBack = () => {
    setErrorMsg(null);
    if (step > 1) {
      setStep((step - 1) as 1 | 2 | 3);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between max-w-lg mx-auto bg-paper">
      {/* FIXED REGION 1: Header & Fixed Progress Bar */}
      <header
        id="onboarding-fixed-header"
        className="h-16 px-4 bg-surface border-b border-line flex flex-col justify-center sticky top-0 z-30"
      >
        <div className="flex justify-between items-center text-xs font-semibold text-slate mb-1.5">
          <span>{t('onboarding.title')}</span>
          <span className="num font-heading">
            {step === 1 && t('onboarding.step1Title')}
            {step === 2 && t('onboarding.step2Title')}
            {step === 3 && t('onboarding.step3Title')}
          </span>
        </div>
        {/* Progress bar container has fixed height and position */}
        <div className="w-full bg-line h-2 rounded-full overflow-hidden">
          <div
            className="bg-ember h-full transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </header>

      {/* SCROLLABLE REGION: Step content */}
      <main id="onboarding-content-area" className="flex-1 p-4 overflow-y-auto">
        {step === 1 && (
          <div className="space-y-4 fade-in">
            <div>
              <label className="block text-sm font-semibold text-ink mb-1.5">
                {t('onboarding.businessType')}
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {(['food', 'delivery', 'repair'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleBusinessTypeChange(type)}
                    className={`p-3.5 rounded-ticket border text-left transition-all ${
                      businessType === type
                        ? 'border-ember bg-surface ring-1 ring-ember'
                        : 'border-line bg-surface hover:border-slate/40'
                    }`}
                  >
                    <div className="font-semibold text-sm text-ink">
                      {type === 'food' && t('onboarding.typeFood')}
                      {type === 'delivery' && t('onboarding.typeDelivery')}
                      {type === 'repair' && t('onboarding.typeRepair')}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1.5">
                {t('onboarding.shopName')}
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full h-12 px-3 rounded-control border border-line bg-surface text-ink focus:outline-none focus:border-ember"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-ink mb-1.5">
                {t('onboarding.language')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['en', 'am', 'om'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    className={`h-10 rounded-control font-semibold text-xs transition-colors ${
                      locale === l
                        ? 'bg-ember text-on-ember'
                        : 'bg-surface border border-line text-ink'
                    }`}
                  >
                    {l === 'en' && 'English'}
                    {l === 'am' && 'አማርኛ'}
                    {l === 'om' && 'Afaan Oromo'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 fade-in">
            <h2 className="text-base font-semibold text-ink mb-2">
              {t('onboarding.sampleMenu')}
            </h2>
            <div className="space-y-2">
              {samples.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-surface border border-line rounded-ticket flex justify-between items-center"
                >
                  <span className="text-sm font-medium text-ink">{item.name}</span>
                  <span className="text-sm font-semibold text-ink num font-heading">
                    {item.price.toFixed(2)} ETB
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 fade-in text-center pt-8">
            <div className="w-16 h-16 rounded-full bg-ember/10 text-ember mx-auto flex items-center justify-center text-3xl">
              ✓
            </div>
            <h2 className="text-xl font-bold font-heading text-ink">
              {t('onboarding.readyTitle')}
            </h2>
            <p className="text-sm text-slate max-w-xs mx-auto">
              {t('onboarding.readyDesc')}
            </p>
            <div className="bg-surface border border-line rounded-ticket p-4 text-left space-y-2 max-w-xs mx-auto">
              <div className="flex justify-between text-xs text-slate">
                <span>Shop:</span>
                <span className="font-semibold text-ink">{shopName}</span>
              </div>
              <div className="flex justify-between text-xs text-slate">
                <span>Type:</span>
                <span className="font-semibold text-ink capitalize">{businessType}</span>
              </div>
              <div className="flex justify-between text-xs text-slate">
                <span>Items:</span>
                <span className="font-semibold text-ink">{samples.length} items configured</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FIXED REGION 2: Fixed Reserved Message Space & Bottom Action Bar */}
      <footer id="onboarding-fixed-footer" className="sticky bottom-0 z-30 bg-surface border-t border-line">
        <div id="onboarding-message-slot" className="min-h-[24px] px-4 pt-2 text-center">
          {errorMsg && (
            <p className="text-xs text-late font-medium fade-in" role="alert">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="h-20 px-4 pb-4 pt-1 flex items-center gap-3">
          {step > 1 && (
            <button
              id="onboarding-back-btn"
              type="button"
              onClick={handleBack}
              disabled={loading}
              className="h-12 w-28 bg-surface border border-line text-ink rounded-control font-semibold text-sm transition-colors hover:bg-paper"
            >
              {t('common.back')}
            </button>
          )}

          <button
            id="onboarding-next-btn"
            type="button"
            onClick={handleNext}
            disabled={loading}
            className="flex-1 h-12 bg-ember text-on-ember rounded-control font-semibold text-sm transition-opacity active:opacity-90 disabled:opacity-50"
          >
            {loading
              ? t('common.loading')
              : step === 3
              ? t('onboarding.finish')
              : t('common.next')}
          </button>
        </div>
      </footer>
    </div>
  );
}
