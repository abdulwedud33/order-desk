import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import { AppProvider } from '../lib/session';
import { OfflineBanner } from '../components/Banner';
import { ToastContainer } from '../components/Toast';
import { BottomNav } from '../components/Navigation';

export const metadata: Metadata = {
  title: 'Order Desk',
  description: 'Order management for restaurants, cafes, delivery and repair shops.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F6F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1419' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <OfflineBanner />
          {children}
          <ToastContainer />
          <BottomNav />
        </AppProvider>
      </body>
    </html>
  );
}
