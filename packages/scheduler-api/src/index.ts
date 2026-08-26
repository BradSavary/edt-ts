import express from 'express';
import scheduleRouter from './routes/schedule.js';
import holidaysRouter from './routes/holidays.js';
import { startTTLCleanup } from './jobs/JobStore.js';
import { warmupWorkerCode } from './jobs/JobQueue.js'; // initialise le singleton jobQueue au démarrage

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// Écoute sur la boucle locale par défaut : en production l'API est censée n'être
// joignable qu'à travers le reverse-proxy Apache (`/edtts/api/*` → 127.0.0.1:3000).
// Écouter sur toutes les interfaces exposerait l'API en direct, proxy contourné.
// `HOST=0.0.0.0` reste possible pour un accès depuis une autre machine (test LAN,
// conteneur) — c'est alors un choix explicite, pas le défaut.
const HOST = process.env.HOST ?? '127.0.0.1';

// ── Middleware ───────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/schedule', scheduleRouter);
app.use('/api/holidays', holidaysRouter);

// ── Racine ───────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: '@edt-ts/scheduler-api',
    version: '0.1.0',
    endpoints: {
      health: 'GET  /api/schedule/health',
      schedule: 'POST /api/schedule',
    },
  });
});

// ── Démarrage ────────────────────────────────────────────────────────────────
startTTLCleanup(); // purge automatique des jobs expirés toutes les heures
warmupWorkerCode(); // bundle esbuild au démarrage avant d'accepter des connexions

app.listen(PORT, HOST, () => {
  console.log(`🚀 scheduler-api démarré sur http://${HOST}:${PORT}`);
});

export default app;
