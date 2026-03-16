import express from 'express';
import scheduleRouter from './routes/schedule.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/schedule', scheduleRouter);

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
app.listen(PORT, () => {
  console.log(`🚀 scheduler-api démarré sur http://localhost:${PORT}`);
});

export default app;
