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
  // Los sprites del juego los sirve el backend y el front (en Vercel) los
  // consume cross-origin. Sin Access-Control-Allow-Origin el canvas queda
  // "manchado" y no podemos teñir las mascaras de color de jugador.
  // Los .webp llevan hash de contenido en el nombre: cache inmutable.
  async headers() {
    return [
      {
        source: "/sprites/:path*.webp",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/sprites/:path*.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
