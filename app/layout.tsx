import type { Metadata, Viewport } from "next";
import { SITE_URL, SITE_NAME, SITE_LEGAL_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";
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
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_LEGAL_NAME }],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/icon-512.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  // viewport-fit=cover faz o iOS EXPOR a safe-area (env(safe-area-inset-*)).
  // Sem isso o conteúdo vaza por baixo do notch/Dynamic Island no iPhone.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      // Scripts inline acima do React gravam atributos de tema neste elemento
      // (data-theme do dashboard, data-tg-scheme do Mini App) antes do paint.
      suppressHydrationWarning
      className={`${chakraPetch.variable} ${rajdhani.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply saved theme before paint to avoid a flash of the default theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('lionbot-theme');if(!t||t==='synthwave')return;var e=document.documentElement;e.setAttribute('data-theme',t);if(t==='custom'){var c=JSON.parse(localStorage.getItem('lionbot-custom')||'{}');function rgb(h){h=(h||'').replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x}).join('');var n=parseInt(h,16);return ((n>>16)&255)+', '+((n>>8)&255)+', '+(n&255)}if(c.accent){var a=rgb(c.accent);e.style.setProperty('--accent',c.accent);e.style.setProperty('--accent-muted','rgba('+a+',0.12)');e.style.setProperty('--accent-glow','rgba('+a+',0.45)');e.style.setProperty('--border-subtle','rgba('+a+',0.10)');e.style.setProperty('--border-default','rgba('+a+',0.18)');var ap=a.split(', ').map(Number);var alum=0.299*ap[0]+0.587*ap[1]+0.114*ap[2];e.style.setProperty('--on-accent',alum>140?'#05030a':'#ffffff')}if(c.cyan){var cy=rgb(c.cyan);e.style.setProperty('--cyan',c.cyan);e.style.setProperty('--cyan-glow','rgba('+cy+',0.40)')}if(c.purple){var p=rgb(c.purple);e.style.setProperty('--purple',c.purple);e.style.setProperty('--purple-glow','rgba('+p+',0.40)')}if(c.bg){var bg=rgb(c.bg);e.style.setProperty('--bg-root',c.bg);e.style.setProperty('--glass-bg','rgba('+bg+',0.85)')}}}catch(_){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
