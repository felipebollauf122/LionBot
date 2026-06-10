import type { Metadata, Viewport } from "next";
import { Chakra_Petch } from "next/font/google";
import { Rajdhani } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Display / headings — angular, technical, synthwave
const chakraPetch = Chakra_Petch({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// UI / body — condensed HUD-like grotesk
const rajdhani = Rajdhani({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Data / stats — monospace numerals
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "LionBot — Automacao de Vendas no Telegram",
  description:
    "Crie bots de vendas automatizados no Telegram. Funil, PIX integrado, tracking avancado e recuperacao automatica — tudo no piloto automatico.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "LionBot",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#07040d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${chakraPetch.variable} ${rajdhani.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply saved theme before paint to avoid a flash of the default theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('lionbot-theme');if(t&&t!=='synthwave'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
