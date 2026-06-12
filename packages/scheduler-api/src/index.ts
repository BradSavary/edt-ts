import express from 'express';
import scheduleRouter from './routes/schedule.js';
import holidaysRouter from './routes/holidays.js';
import { startTTLCleanup } from './jobs/JobStore.js';
import { warmupWorkerCode } from './jobs/JobQueue.js'; // initialise le singleton jobQueue au démarrage

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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

app.listen(PORT, () => {
  console.log(`🚀 scheduler-api démarré sur http://localhost:${PORT}`);
});

export default app;
