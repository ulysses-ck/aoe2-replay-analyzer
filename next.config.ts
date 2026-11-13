import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // aoe2rec-js carga un .wasm desde node_modules: no debe pasar por el bundler.
  serverExternalPackages: ["aoe2rec-js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
