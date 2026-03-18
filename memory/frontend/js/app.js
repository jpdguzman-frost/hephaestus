// ═══════════════════════════════════════════════════════════════════════════════
// Rex Memory — Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

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
  stats: () => api.get('/api/stats'),
  list: (opts) => api.post('/api/memories/list', opts),
  recall: (opts) => api.post('/api/memories/recall', opts),
  getMemory: (id) => api.get('/api/memories/' + id),
  updateMemory: (id, data) => api.patch('/api/memories/' + id, data),
  deleteMemory: (id) => api.del('/api/memories/' + id),
  cleanup: (opts) => api.post('/api/memories/cleanup', opts),
};

// ─── State ──────────────────────────────────────────────────────────────────

let currentView = 'browse';
let selectedMemoryId = null;
let sidebarMemories = [];
let isEditing = false;

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
  if (view === 'browse') loadSidebar();
}

// ─── Overview ───────────────────────────────────────────────────────────────

async function loadOverview() {
  try {
    const stats = await api.stats();
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

    const result = await api.list({ context: {}, limit: 10 });
    const countEl = document.getElementById('recent-count');
    if (countEl) countEl.textContent = result.count ? `(${result.count})` : '';
    renderOverviewList(result.memories);
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

function renderOverviewList(memories) {
  const container = document.getElementById('recent-list');
  if (!memories || memories.length === 0) {
    container.innerHTML = '<div class="empty">No memories found</div>';
    return;
  }
  container.innerHTML = memories.map((m, i) => `
    <div class="memory-row" data-id="${m.id}" style="animation-delay:${i * 30}ms">
      <span class="badge badge-scope">${esc(m.scope)}</span>
      <span class="badge ${badgeClass(m.category)}">${esc(m.category)}</span>
      <span class="row-title">${esc(extractTitle(m.content))}</span>
      <span class="row-meta">${(m.confidence || 0).toFixed(2)}</span>
      <span class="row-meta">${timeAgo(m.createdAt)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.memory-row').forEach(row => {
    row.addEventListener('click', () => {
      switchView('browse');
      loadSidebar().then(() => selectMemory(row.dataset.id));
    });
  });
}

// ─── Browse: Sidebar ────────────────────────────────────────────────────────

const filterFile = document.getElementById('filter-file');
const filterCategory = document.getElementById('filter-category');
const filterSuperseded = document.getElementById('filter-superseded');

filterFile.addEventListener('change', () => renderSidebar());
filterCategory.addEventListener('change', loadSidebar);
filterSuperseded.addEventListener('change', loadSidebar);

async function loadSidebar() {
  try {
    const opts = {
      context: {},
      limit: 100,
      includeSuperseded: filterSuperseded.checked,
    };
    if (filterCategory.value) opts.category = filterCategory.value;

    const result = await api.list(opts);
    sidebarMemories = result.memories || [];
    populateFileFilter();
    renderSidebar();
  } catch (err) {
    console.error('Failed to load sidebar:', err);
  }
}

function populateFileFilter() {
  const current = filterFile.value;
  const files = new Map();
  for (const m of sidebarMemories) {
    if (m.fileName) files.set(m.fileKey || m.fileName, m.fileName);
  }
  filterFile.innerHTML = '<option value="">All files</option>' +
    [...files.entries()].map(([key, name]) =>
      `<option value="${esc(key)}">${esc(name)}</option>`
    ).join('');
  if (current && [...files.keys()].includes(current)) {
    filterFile.value = current;
  }
}

function renderSidebar() {
  const container = document.getElementById('sidebar-list');
  const fileVal = filterFile.value;
  const filtered = fileVal
    ? sidebarMemories.filter(m => (m.fileKey || m.fileName) === fileVal)
    : sidebarMemories;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No memories found</div>';
    return;
  }

  container.innerHTML = filtered.map((m, i) => `
    <div class="sidebar-card${m.id === selectedMemoryId ? ' selected' : ''}" data-id="${m.id}" style="animation-delay:${i * 25}ms">
      <div class="card-top">
        <span class="badge ${badgeClass(m.category)}">${esc(m.category)}</span>
        <span class="card-age">${timeAgo(m.createdAt)}</span>
      </div>
      <div class="card-title">${esc(extractTitle(m.content))}</div>
      <div class="card-preview">${esc(extractPreview(m.content))}</div>
      <div class="card-footer">
        <span class="card-confidence">
          <span class="confidence-bar"><span class="confidence-fill" style="width:${Math.round((m.confidence || 0) * 100)}%"></span></span>
          ${(m.confidence || 0).toFixed(2)}
        </span>
        <span class="card-tags">${esc((m.tags || []).join(', '))}</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.sidebar-card').forEach(card => {
    card.addEventListener('click', () => selectMemory(card.dataset.id));
  });
}

// ─── Browse: Detail Panel ───────────────────────────────────────────────────

async function selectMemory(id) {
  selectedMemoryId = id;
  isEditing = false;

  // Update sidebar selection
  document.querySelectorAll('.sidebar-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  const panel = document.getElementById('browse-detail');

  try {
    const { memory } = await api.getMemory(id);
    renderDetail(panel, memory);
  } catch (err) {
    panel.innerHTML = '<div class="detail-empty"><p>Failed to load memory</p></div>';
    console.error(err);
  }
}

function renderDetail(panel, memory) {
  const title = extractTitle(memory.content);
  const categories = ['context', 'explicit', 'idea', 'scratch', 'board'];
  const activeCat = (memory.category || '').toLowerCase();
  const subtitle = buildSubtitle(memory);
  const contentHtml = renderMarkdown(memory.content);

  panel.innerHTML = `
    <div class="detail-inner">
      <div class="detail-title">${esc(title)}</div>
      <div class="detail-badges">
        ${categories.map(cat => `
          <span class="badge ${cat === activeCat ? badgeClass(cat) : 'badge-default'}">${cat.toUpperCase()}</span>
        `).join('')}
      </div>
      <div class="detail-actions">
        <button class="btn" id="btn-edit">Edit</button>
        <button class="btn btn-danger" id="btn-delete">Delete</button>
      </div>
      ${subtitle ? `<div class="detail-subtitle">${esc(subtitle)}</div>` : ''}
      <div class="detail-content">${contentHtml}</div>
      <div class="detail-meta">
        <table class="meta-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Confidence</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Last Accessed</th>
              <th>Access Count</th>
              <th>File Key</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${esc(memory._id || memory.id || '')}</td>
              <td>${(memory.confidence || 0).toFixed(3)}</td>
              <td>${fmtDate(memory.createdAt)}</td>
              <td>${fmtDate(memory.updatedAt)}</td>
              <td>${fmtDate(memory.lastAccessedAt)}</td>
              <td>${memory.accessCount || 0}</td>
              <td>${esc(memory.fileKey || '')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  panel.querySelector('#btn-edit').addEventListener('click', () => {
    enterEditMode(panel, memory);
  });

  panel.querySelector('#btn-delete').addEventListener('click', async () => {
    if (!confirm('Delete this memory permanently?')) return;
    await api.deleteMemory(memory._id || memory.id);
    selectedMemoryId = null;
    panel.innerHTML = '<div class="detail-empty"><p>Memory deleted</p></div>';
    loadSidebar();
  });
}

// ─── Edit Mode ──────────────────────────────────────────────────────────────

function enterEditMode(panel, memory) {
  isEditing = true;
  const title = extractTitle(memory.content);

  panel.innerHTML = `
    <div class="detail-inner">
      <div class="detail-title">${esc(title)}</div>
      <div class="edit-label">Content</div>
      <textarea class="edit-content" id="edit-content">${esc(memory.content)}</textarea>
      <div class="edit-label">Tags</div>
      <input type="text" class="edit-tags" id="edit-tags" value="${esc((memory.tags || []).join(', '))}">
      <div class="edit-actions">
        <button class="btn" id="btn-save">Save</button>
        <button class="btn" id="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  panel.querySelector('#btn-save').addEventListener('click', async () => {
    const content = document.getElementById('edit-content').value;
    const tags = document.getElementById('edit-tags').value
      .split(',').map(t => t.trim()).filter(Boolean);
    await api.updateMemory(memory._id || memory.id, { content, tags });
    isEditing = false;
    selectMemory(memory._id || memory.id);
    loadSidebar();
  });

  panel.querySelector('#btn-cancel').addEventListener('click', () => {
    isEditing = false;
    renderDetail(panel, memory);
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

document.getElementById('btn-preview').addEventListener('click', () => runCleanup(true));
document.getElementById('btn-execute').addEventListener('click', () => runCleanup(false));

async function runCleanup(dryRun) {
  const resultEl = document.getElementById('cleanup-result');
  const executeBtn = document.getElementById('btn-execute');

  try {
    const result = await api.cleanup({
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
    executeBtn.disabled = !dryRun;

    if (!dryRun) loadSidebar();
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
}

// ─── Markdown Renderer ──────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^### /)) {
      closeLists();
      html += `<h3>${inline(line.slice(4))}</h3>`;
      continue;
    }
    if (line.match(/^## /)) {
      closeLists();
      html += `<h2>${inline(line.slice(3))}</h2>`;
      continue;
    }
    if (line.match(/^# /)) {
      closeLists();
      html += `<h2>${inline(line.slice(2))}</h2>`;
      continue;
    }

    if (line.match(/^\s*[-*]\s+/)) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
      continue;
    }

    if (line.match(/^\s*\d+\.\s+/)) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`;
      continue;
    }

    if (line.trim() === '') {
      closeLists();
      continue;
    }

    closeLists();
    html += `<p>${inline(line)}</p>`;
  }

  closeLists();
  return html;
}

function inline(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractTitle(content) {
  if (!content) return 'Untitled';
  const firstLine = content.split('\n').find(l => l.trim()) || 'Untitled';
  return firstLine.replace(/^#+\s*/, '').trim();
}

function extractPreview(content) {
  if (!content) return '';
  const lines = content.split('\n').filter(l => l.trim());
  return lines.slice(1, 3).join(' ').trim();
}

function buildSubtitle(memory) {
  const parts = [];
  if (memory.fileName) parts.push(memory.fileName);
  else if (memory.fileKey) parts.push('File: ' + memory.fileKey);
  if (memory.pageName) parts.push(memory.pageName);
  if (memory.source) parts.push(memory.source);
  if (memory.supersededBy) parts.push('Superseded by: ' + memory.supersededBy);
  return parts.join(' \u2014 ');
}

function badgeClass(category) {
  if (!category) return 'badge-default';
  const key = category.toLowerCase();
  const valid = [
    'context', 'explicit', 'idea', 'scratch', 'board', 'decision',
    'convention', 'rejection', 'relationship', 'preference', 'correction',
  ];
  return valid.includes(key) ? 'badge-' + key : 'badge-default';
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

function fmtDate(date) {
  if (!date) return '\u2014';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const statusEl = document.getElementById('status');
  try {
    const health = await api.health();
    const ok = health.status === 'ok';
    statusEl.innerHTML = `<span class="status-dot"></span>${ok ? 'connected' : 'disconnected'}`;
    statusEl.classList.toggle('connected', ok);
  } catch {
    statusEl.innerHTML = '<span class="status-dot"></span>offline';
  }

  loadSidebar();
}

init();
