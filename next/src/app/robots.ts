import type { MetadataRoute } from "next";

const BASE_URL = "https://kizunia.vercel.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/admin/",
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}