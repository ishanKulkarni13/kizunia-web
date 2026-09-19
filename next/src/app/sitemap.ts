import type { MetadataRoute } from "next";

const BASE_URL = "https://kizunia.vercel.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
    },
    {
      url: `${BASE_URL}/competitions`,
    },
    {
      url: `${BASE_URL}/legal/privacy`,
    },
    {
      url: `${BASE_URL}/legal/terms`,
    },
  ];
}