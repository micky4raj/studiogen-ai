/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // NOTE: currently unused — every image in this project renders via a
    // plain <img> tag (see components, dashboard-client.tsx), not next/image.
    // Left configured for whenever that migration happens.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "replicate.delivery" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }, // raw product photos can be large
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevents this app from being embedded in an iframe on another
          // site (clickjacking protection). Safe for every route here — none
          // of them are meant to be embedded.
          { key: "X-Frame-Options", value: "DENY" },
          // Stops browsers from guessing content-types away from what the
          // server declared, which closes off a class of MIME-sniffing attacks.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Sends the full referrer only to same-origin requests, and just the
          // origin (not the full path/query) cross-origin — avoids leaking
          // e.g. a job ID in the URL to a third party via the Referer header.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Explicitly deny access to sensitive browser APIs this app never uses.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // TODO: a real Content-Security-Policy is deliberately not included
          // here. This app loads Razorpay's checkout.js from an external
          // origin (components/razorpay-button.tsx) and Supabase auth may
          // rely on specific connect-src/frame-src rules — a CSP built and
          // "should work" without testing against the actual running app
          // risks silently breaking checkout or auth. Build one iteratively
          // in a staging environment with the browser console open instead.
        ],
      },
    ];
  },
};

module.exports = nextConfig;
