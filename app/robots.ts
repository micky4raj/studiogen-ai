import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nothing behind auth or the API should be crawled or show up in search
      // results — a job ID or generated image URL leaking into an index would
      // be a real (if minor) privacy issue for user-uploaded product photos.
      disallow: ["/dashboard", "/api"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
