import type { NextConfig } from 'next';

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Control referrer info sent with requests
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Restrict browser features
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Force HTTPS for 1 year (only meaningful after SSL is confirmed)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Content Security Policy — restricts what scripts/styles/connections are allowed
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js needs inline scripts for hydration; Supabase SDK needs eval in some builds
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Allow Supabase API + storage
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      // Images: self + Supabase storage + data URIs (for file previews)
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },
  logging: {
    fetches: { fullUrl: false },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
