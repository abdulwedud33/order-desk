import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        slate: 'rgb(var(--slate) / <alpha-value>)',
        ember: 'rgb(var(--ember) / <alpha-value>)',
        'on-ember': 'rgb(var(--on-ember) / <alpha-value>)',
        'st-new': 'rgb(var(--st-new) / <alpha-value>)',
        'st-progress': 'rgb(var(--st-progress) / <alpha-value>)',
        'st-progress-text': 'rgb(var(--st-progress-text) / <alpha-value>)',
        'st-waiting': 'rgb(var(--st-waiting) / <alpha-value>)',
        'st-ready': 'rgb(var(--st-ready) / <alpha-value>)',
        late: 'rgb(var(--late) / <alpha-value>)',
      },
      borderRadius: {
        control: '8px',
        ticket: '12px',
        sheet: '20px',
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'var(--font-ethiopic)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: '12px',
        sm: '14px',
        base: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
      },
      spacing: {
        12: '48px',
        18: '72px',
      },
      minHeight: { touch: '48px' },
      boxShadow: {
        bar: '0 -4px 12px rgb(0 0 0 / 0.06)',
        sheet: '0 -8px 24px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [],
};
export default config;
