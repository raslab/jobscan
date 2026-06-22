import express, { Request, Response } from 'express';
import path from 'path';
import { initDb } from './db/index';
import sourcesRouter from './routes/sources';
import jobsRouter from './routes/jobs';
import syncRouter from './routes/sync';
import crmRouter from './routes/crm';
import { initProcessing } from './processing';

const app = express();
app.use(express.json());

// API routes
app.use('/api/sources', sourcesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/crm', crmRouter);

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env['PORT'] ?? 3000;

Promise.resolve(initDb()).then(async () => {
  await initProcessing();
  app.listen(PORT, () => {
    console.log(`JobScan running on http://localhost:${PORT}`);
  });
}).catch((err: unknown) => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
