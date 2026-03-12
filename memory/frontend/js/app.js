// ─── Rex Memory Dashboard ───────────────────────────────────────────────────

const BASE = (() => {
  const base = document.querySelector('base');
  if (base) {
    const href = new URL(base.href).pathname.replace(/\/+$/, '');
    return href || '';
  }
  return '';
})();

// ─── API Client ─────────────────────────────────────────────────────────────

const api = {
  async get(url) {
    const res = await fetch(BASE + url);
    if (!res.ok) throw new Error('API error: ' + res.status);
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(BASE + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('API error: ' + res.status);
    return res.json();
  },
  async patch(url, body) {
    const res = await fetch(BASE + url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('API error: ' + res.status);
    return res.json();
  },
  async del(url) {
    const res = await fetch(BASE + url, { method: 'DELETE' });
    if (!res.ok) throw new Error('API error: ' + res.status);
    return res.json();
  },

  health: () => api.get('/api/health'),
  stats: (teamId) => api.get('/api/stats?teamId=' + encodeURIComponent(teamId || 'default')),
  list: (opts) => api.post('/api/memories/list', opts),
  recall: (opts) => api.post('/api/memories/recall', opts),
  getMemory: (id) => api.get('/api/memories/' + id),
  updateMemory: (id, data) => api.patch('/api/memories/' + id, data),
  deleteMemory: (id) => api.del('/api/memories/' + id),
  cleanup: (opts) => api.post('/api/memories/cleanup', opts),
};

// ─── State ──────────────────────────────────────────────────────────────────

let currentView = 'overview';
let currentMemoryId = null;
const teamId = 'default'; // TODO: make configurable

// ─── Navigation ─────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(link.dataset.view);
  });
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');

  if (view === 'overview') loadOverview();
  if (view === 'browse') loadBrowse();
}

// ─── Overview ───────────────────────────────────────────────────────────────

async function loadOverview() {
  try {
    const stats = await api.stats(teamId);
    const grid = document.getElementById('stats-grid');

    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Memories</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avgConfidence}</div>
        <div class="stat-label">Avg Confidence</div>
      </div>
      ${Object.entries(stats.byScope || {}).map(([scope, count]) => `
        <div class="stat-card">
          <div class="stat-value">${count}</div>
          <div class="stat-label">${scope}</div>
        </div>
      `).join('')}
    `;

    // Load recent memories
    const result = await api.list({
      context: { teamId },
      limit: 10,
    });
    renderMemoryList('recent-list', result.memories);
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

// ─── Browse ─────────────────────────────────────────────────────────────────

const filterScope = document.getElementById('filter-scope');
const filterCategory = document.getElementById('filter-category');
const filterSuperseded = document.getElementById('filter-superseded');
const btnRefresh = document.getElementById('btn-refresh');

btnRefresh.addEventListener('click', loadBrowse);
filterScope.addEventListener('change', loadBrowse);
filterCategory.addEventListener('change', loadBrowse);
filterSuperseded.addEventListener('change', loadBrowse);

async function loadBrowse() {
  try {
    const opts = {
      context: { teamId },
      limit: 50,
      includeSuperseded: filterSuperseded.checked,
    };
    if (filterScope.value) opts.scope = filterScope.value;
    if (filterCategory.value) opts.category = filterCategory.value;

    const result = await api.list(opts);
    renderMemoryList('browse-list', result.memories);
  } catch (err) {
    console.error('Failed to load browse:', err);
  }
}

// ─── Render Memory List ─────────────────────────────────────────────────────

function renderMemoryList(containerId, memories) {
  const container = document.getElementById(containerId);

  if (!memories || memories.length === 0) {
    container.innerHTML = '<div class="empty">No memories found</div>';
    return;
  }

  container.innerHTML = memories.map(m => `
    <div class="memory-row" data-id="${m.id}">
      <span class="badge badge-scope">${m.scope}</span>
      <span class="badge badge-category">${m.category}</span>
      <span class="memory-content" title="${escapeHtml(m.content)}">${escapeHtml(m.content)}</span>
      <span class="memory-meta">${(m.confidence || 0).toFixed(2)}</span>
      <span class="memory-meta">${timeAgo(m.createdAt)}</span>
      <span class="memory-actions"><button data-id="${m.id}" class="btn-delete-inline" title="Delete">&times;</button></span>
    </div>
  `).join('');

  // Click to open detail
  container.querySelectorAll('.memory-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-inline')) return;
      openModal(row.dataset.id);
    });
  });

  // Inline delete buttons
  container.querySelectorAll('.btn-delete-inline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this memory?')) return;
      await api.deleteMemory(btn.dataset.id);
      if (currentView === 'overview') loadOverview();
      else loadBrowse();
    });
  });
}

// ─── Modal ──────────────────────────────────────────────────────────────────

const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const modalTitle = document.getElementById('modal-title');

document.getElementById('modal-close').addEventListener('click', closeModal);
document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!currentMemoryId) return;
  if (!confirm('Delete this memory permanently?')) return;
  await api.deleteMemory(currentMemoryId);
  closeModal();
  if (currentView === 'overview') loadOverview();
  else loadBrowse();
});

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!currentMemoryId) return;
  const content = document.getElementById('edit-content').value;
  const tags = document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  await api.updateMemory(currentMemoryId, { content, tags });
  closeModal();
  if (currentView === 'overview') loadOverview();
  else loadBrowse();
});

async function openModal(id) {
  currentMemoryId = id;
  try {
    const { memory } = await api.getMemory(id);
    modalTitle.textContent = memory.scope + ' / ' + memory.category;
    modalBody.innerHTML = `
      <div class="field">
        <label>Content</label>
        <textarea id="edit-content">${escapeHtml(memory.content)}</textarea>
      </div>
      <div class="field">
        <label>Tags</label>
        <input type="text" id="edit-tags" value="${escapeHtml((memory.tags || []).join(', '))}">
      </div>
      <div class="field">
        <label>Details</label>
        <div style="font-size:12px; color: var(--text-muted); font-family: var(--mono); line-height: 1.8;">
          ID: ${memory._id}<br>
          Scope: ${memory.scope}<br>
          Category: ${memory.category}<br>
          Source: ${memory.source || 'explicit'}<br>
          Confidence: ${(memory.confidence || 0).toFixed(3)}<br>
          Created by: ${memory.createdBy?.name || 'Unknown'}<br>
          Created: ${new Date(memory.createdAt).toLocaleString()}<br>
          Updated: ${new Date(memory.updatedAt).toLocaleString()}<br>
          Last accessed: ${new Date(memory.lastAccessedAt).toLocaleString()}<br>
          Access count: ${memory.accessCount || 0}<br>
          ${memory.fileKey ? 'File: ' + memory.fileKey + '<br>' : ''}
          ${memory.pageId ? 'Page: ' + memory.pageId + '<br>' : ''}
          ${memory.supersededBy ? 'Superseded by: ' + memory.supersededBy + '<br>' : ''}
        </div>
      </div>
    `;
    modal.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load memory:', err);
  }
}

function closeModal() {
  modal.classList.add('hidden');
  currentMemoryId = null;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

document.getElementById('btn-preview').addEventListener('click', () => runCleanup(true));
document.getElementById('btn-execute').addEventListener('click', () => runCleanup(false));

async function runCleanup(dryRun) {
  const resultEl = document.getElementById('cleanup-result');
  const executeBtn = document.getElementById('btn-execute');

  try {
    const result = await api.cleanup({
      teamId,
      dryRun,
      maxAgeDays: parseInt(document.getElementById('cleanup-age').value, 10),
      minConfidence: parseFloat(document.getElementById('cleanup-conf').value),
      removeSuperseded: document.getElementById('cleanup-superseded').checked,
    });

    const lines = [
      dryRun ? '--- DRY RUN (preview only) ---' : '--- CLEANUP EXECUTED ---',
      '',
      `Stale (${result.staleCount} memories older than ${document.getElementById('cleanup-age').value}d with 0 access)`,
      `Low confidence (${result.lowConfidenceCount} below ${document.getElementById('cleanup-conf').value})`,
      `Superseded (${result.supersededCount} replaced by newer memories)`,
      '',
      dryRun
        ? `Total would remove: ${result.staleCount + result.lowConfidenceCount + result.supersededCount}`
        : `Total removed: ${result.totalRemoved}`,
    ];

    resultEl.textContent = lines.join('\n');
    executeBtn.disabled = dryRun ? false : true;

    if (!dryRun) loadOverview();
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + 'd';
  return Math.floor(days / 30) + 'mo';
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const statusEl = document.getElementById('status');
  try {
    const health = await api.health();
    statusEl.textContent = health.status === 'ok' ? 'connected' : 'disconnected';
    statusEl.classList.toggle('connected', health.status === 'ok');
  } catch {
    statusEl.textContent = 'offline';
  }

  loadOverview();
}

init();
