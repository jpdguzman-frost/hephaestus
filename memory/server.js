// ─── Rex Memory Service ──────────────────────────────────────────────────────
// Shared memory for Rex — persistent design knowledge across sessions.

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Store } from './src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const PORT = parseInt(process.env.PORT || '3002', 10);
const BASE_PATH = process.env.BASE_PATH || '';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'rex_memory';

const store = new Store(MONGODB_URI, DB_NAME);
const app = express();
const router = express.Router();

app.use(express.json());

// ─── Static Files ────────────────────────────────────────────────────────────

router.use('/frontend', express.static(path.join(__dirname, 'frontend')));

// ─── Health ──────────────────────────────────────────────────────────────────

router.get('/api/health', (req, res) => {
  res.json({
    status: store.client ? 'ok' : 'disconnected',
    version: '1.0.0',
    db: DB_NAME,
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get('/api/stats', async (req, res) => {
  try {
    const teamId = req.query.teamId || 'default';
    const stats = await store.stats(teamId);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Create Memory ──────────────────────────────────────────────────────────

router.post('/api/memories', async (req, res) => {
  try {
    const entry = await store.remember(req.body);
    res.status(201).json({ memory: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Recall (text search) ───────────────────────────────────────────────────

router.post('/api/memories/recall', async (req, res) => {
  try {
    const results = await store.recall(req.body);
    res.json({ memories: formatList(results), count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List ───────────────────────────────────────────────────────────────────

router.post('/api/memories/list', async (req, res) => {
  try {
    const results = await store.list(req.body);
    res.json({ memories: formatList(results), count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Load for Session ───────────────────────────────────────────────────────

router.post('/api/memories/session', async (req, res) => {
  try {
    const { context, maxEntries } = req.body;
    const results = await store.loadForSession(context, maxEntries);
    res.json({ memories: formatList(results), count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get Single Memory ─────────────────────────────────────────────────────

router.get('/api/memories/:id', async (req, res) => {
  try {
    const entry = await store.getById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Memory not found' });
    res.json({ memory: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Memory ──────────────────────────────────────────────────────────

router.patch('/api/memories/:id', async (req, res) => {
  try {
    const entry = await store.update(req.params.id, req.body);
    if (!entry) return res.status(404).json({ error: 'Memory not found' });
    res.json({ memory: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete Memory ──────────────────────────────────────────────────────────

router.delete('/api/memories/:id', async (req, res) => {
  try {
    const deleted = await store.deleteById(req.params.id);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Forget (query-based deletion) ──────────────────────────────────────────

router.post('/api/memories/forget', async (req, res) => {
  try {
    const deleted = await store.forget(req.body);
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

router.post('/api/memories/cleanup', async (req, res) => {
  try {
    const result = await store.cleanup(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Decay ──────────────────────────────────────────────────────────────────

router.post('/api/memories/decay', async (req, res) => {
  try {
    const { teamId } = req.body;
    const modified = await store.applyDecay(teamId || 'default');
    res.json({ modified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard SPA Fallback ─────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.redirect(BASE_PATH + '/frontend/');
});

router.get('/frontend/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ─── Mount & Start ──────────────────────────────────────────────────────────

app.use(BASE_PATH || '/', router);

async function start() {
  await store.connect();
  app.listen(PORT, () => {
    console.log(`Rex Memory Service running at http://localhost:${PORT}${BASE_PATH}`);
    console.log(`Dashboard: http://localhost:${PORT}${BASE_PATH}/frontend/`);
    console.log(`API: http://localhost:${PORT}${BASE_PATH}/api/health`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatList(memories) {
  return memories.map(m => ({
    id: m._id,
    scope: m.scope,
    category: m.category,
    content: m.content,
    tags: m.tags,
    confidence: m.confidence,
    source: m.source,
    createdBy: m.createdBy,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastAccessedAt: m.lastAccessedAt,
    accessCount: m.accessCount,
    supersededBy: m.supersededBy,
    fileKey: m.fileKey,
    pageId: m.pageId,
    teamId: m.teamId,
  }));
}
