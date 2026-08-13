/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Job runner uses long-lived child processes + filesystem state,
  // so all API routes run on the Node.js runtime (see route files).
  // Keep @cursor/sdk out of the webpack graph (native agent stack + .d.ts.map).
  experimental: {
    serverComponentsExternalPackages: ["@cursor/sdk"],
  },
  webpack: (config) => {
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push("@cursor/sdk");
    }
    return config;
  },
};

export default nextConfig;
