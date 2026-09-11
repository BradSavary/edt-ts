import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/edtts',
  trailingSlash: true,
  // jspdf (export PDF) embarque fflate, dont le build Node fait `new Worker(<chemin dynamique>)` :
  // le bundler serveur (SSR/prerender) échoue à l'analyser statiquement. Exclu du bundling pour
  // utiliser le require() natif de Node à la place (jspdf n'est de toute façon exécuté que côté
  // client, dans un gestionnaire de clic — jamais pendant le rendu serveur).
  serverExternalPackages: ['jspdf'],
  async rewrites() {
    // Les rewrites ne fonctionnent qu'en dev (next dev).
    // En production (output: 'export'), c'est NEXT_PUBLIC_API_BASE qui prend le relais.
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
        basePath: false,
      },
    ];
  },
  async redirects() {
    // Même remarque : ne joue qu'en dev (next dev). basePath: false pour intercepter
    // la racine du serveur elle-même (sinon Next préfixerait la source en /edtts/edtts).
    // Sans ça, http://localhost:5173/ (premier réflexe au lancement de l'app) 404 :
    // la racine du domaine est hors de `basePath`, donc hors des routes de l'app.
    return [
      {
        source: '/',
        destination: '/edtts/',
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
