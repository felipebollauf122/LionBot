import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LionBot",
    short_name: "LionBot",
    description: "Automação de vendas no Telegram — funil, PIX, tracking e recuperação.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#07040d",
    theme_color: "#07040d",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
