import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fluid Sand Clock',
  description: 'A fullscreen particle clock with flowing sand effects',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
