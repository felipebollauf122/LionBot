import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compressão gzip nas respostas (#44)
  compress: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // Tree-shaking melhor de pacotes pesados (#44)
    optimizePackageImports: ["@xyflow/react"],
  },
  // Habilita next/image pra avatares/imagens externas (#42).
  // remotePatterns com https/** cobre Supabase Storage, Telegram, etc.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
