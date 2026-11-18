import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/crm", "/portal", "/login", "/setup", "/setup-password", "/forgot-password", "/reset-password"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
