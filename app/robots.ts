import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // crawler PODE ler a home e as páginas legais (legitimidade). Bloqueia só
      // áreas privadas/transitórias — /t é redirect por-clique (já noindex).
      allow: "/",
      disallow: ["/dashboard", "/api/", "/go", "/t"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
