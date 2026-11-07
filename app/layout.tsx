import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Popup Posters",
  description: "Event posters from your group chats, sorted by date and area.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh font-sans antialiased">
        <div className="mx-auto max-w-5xl px-4 pb-16">{children}</div>
      </body>
    </html>
  );
}
