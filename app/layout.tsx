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
            __html: `(function(){try{var t=localStorage.getItem('lionbot-theme');if(!t||t==='synthwave')return;var e=document.documentElement;e.setAttribute('data-theme',t);if(t==='custom'){var c=JSON.parse(localStorage.getItem('lionbot-custom')||'{}');function rgb(h){h=(h||'').replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x}).join('');var n=parseInt(h,16);return ((n>>16)&255)+', '+((n>>8)&255)+', '+(n&255)}if(c.accent){var a=rgb(c.accent);e.style.setProperty('--accent',c.accent);e.style.setProperty('--accent-muted','rgba('+a+',0.12)');e.style.setProperty('--accent-glow','rgba('+a+',0.45)');e.style.setProperty('--border-subtle','rgba('+a+',0.10)');e.style.setProperty('--border-default','rgba('+a+',0.18)')}if(c.cyan){var cy=rgb(c.cyan);e.style.setProperty('--cyan',c.cyan);e.style.setProperty('--cyan-glow','rgba('+cy+',0.40)')}if(c.purple){var p=rgb(c.purple);e.style.setProperty('--purple',c.purple);e.style.setProperty('--purple-glow','rgba('+p+',0.40)')}if(c.bg){var bg=rgb(c.bg);e.style.setProperty('--bg-root',c.bg);e.style.setProperty('--glass-bg','rgba('+bg+',0.85)')}}}catch(_){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
