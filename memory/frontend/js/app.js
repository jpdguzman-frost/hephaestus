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
  files: (excludeChat) => api.get('/api/memories/files' + (excludeChat ? '?excludeChat=true' : '')),
  chatSessions: (opts) => api.post('/api/chat/sessions', opts),
  chatMessages: (sid) => api.get('/api/chat/sessions/' + encodeURIComponent(sid) + '/messages'),
};

// ─── State ──────────────────────────────────────────────────────────────────

let currentView = 'browse';
let selectedMemoryId = null;
let sidebarMemories = [];
let isEditing = false;

// Chat state
let chatSessions = [];
let chatSessionsTotal = 0;
let chatSessionsLoading = false;
let selectedChatSessionId = null;

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
  if (view === 'chat') loadChatSessions(true);
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

filterFile.addEventListener('change', () => loadSidebar(true));
filterCategory.addEventListener('change', () => loadSidebar(true));
filterSuperseded.addEventListener('change', () => loadSidebar(true));

const PAGE_SIZE = 50;
let sidebarTotal = 0;
let sidebarLoading = false;

async function loadSidebar(reset = false) {
  if (sidebarLoading) return;
  if (reset) {
    sidebarMemories = [];
    sidebarTotal = 0;
  }
  // Already have everything
  if (!reset && sidebarMemories.length >= sidebarTotal && sidebarTotal > 0) return;

  sidebarLoading = true;
  try {
    const opts = {
      context: {},
      limit: PAGE_SIZE,
      skip: sidebarMemories.length,
      includeSuperseded: filterSuperseded.checked,
      excludeTags: ['chat-session', 'chat-message', 'chat-history'],
    };
    if (filterCategory.value) opts.category = filterCategory.value;
    if (filterFile.value) {
      opts.context = { fileKey: filterFile.value };
    }

    const result = await api.list(opts);
    const batch = result.memories || [];
    sidebarTotal = result.total || 0;
    sidebarMemories = sidebarMemories.concat(batch);

    // Only repopulate file filter on first load with no file selected
    if (sidebarMemories.length === batch.length && !filterFile.value) {
      populateFileFilter();
    }
    renderSidebar(reset);
  } catch (err) {
    console.error('Failed to load sidebar:', err);
  } finally {
    sidebarLoading = false;
  }
}

// Infinite scroll on sidebar list
document.getElementById('sidebar-list').addEventListener('scroll', (e) => {
  const el = e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadSidebar();
  }
});

async function populateFileFilter() {
  const current = filterFile.value;
  try {
    const { files } = await api.files(true);
    filterFile.innerHTML = '<option value="">All files</option>' +
      files.map(f =>
        `<option value="${esc(f.fileKey)}">${esc(f.fileName || f.fileKey)} (${f.count})</option>`
      ).join('');
    if (current && files.some(f => f.fileKey === current)) {
      filterFile.value = current;
    }
  } catch (err) {
    console.error('Failed to load file filter:', err);
  }
}

function renderSidebar(reset = false) {
  const container = document.getElementById('sidebar-list');

  if (sidebarMemories.length === 0) {
    container.innerHTML = '<div class="empty">No memories found</div>';
    return;
  }

  if (reset) container.innerHTML = '';

  // Remove existing loader if present
  const existingLoader = container.querySelector('.sidebar-loader');
  if (existingLoader) existingLoader.remove();

  // Determine which cards to render (only new ones on append)
  const existingCount = container.querySelectorAll('.sidebar-card').length;
  const newItems = sidebarMemories.slice(existingCount);

  const fragment = document.createDocumentFragment();
  for (const m of newItems) {
    const div = document.createElement('div');
    div.className = `sidebar-card${m.id === selectedMemoryId ? ' selected' : ''}`;
    div.dataset.id = m.id;
    div.innerHTML = `
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
    `;
    div.addEventListener('click', () => selectMemory(m.id));
    fragment.appendChild(div);
  }
  container.appendChild(fragment);

  // Show count / loading indicator
  if (sidebarMemories.length < sidebarTotal) {
    const loader = document.createElement('div');
    loader.className = 'sidebar-loader';
    loader.textContent = `${sidebarMemories.length} of ${sidebarTotal} — scroll for more`;
    container.appendChild(loader);
  }
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

// ─── Chat History ───────────────────────────────────────────────────────────

const chatFilterFile = document.getElementById('chat-filter-file');
chatFilterFile.addEventListener('change', () => loadChatSessions(true));

document.getElementById('chat-session-list').addEventListener('scroll', (e) => {
  const el = e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadChatSessions();
  }
});

async function loadChatSessions(reset = false) {
  if (chatSessionsLoading) return;
  if (reset) {
    chatSessions = [];
    chatSessionsTotal = 0;
    selectedChatSessionId = null;
    document.getElementById('chat-detail').innerHTML =
      '<div class="detail-empty"><div class="detail-empty-icon"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M8 12a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H18l-8 6V12z" stroke="currentColor" stroke-width="1.5" opacity="0.3"/><path d="M16 18h16M16 24h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"/></svg></div><p>Select a conversation to view</p></div>';
  }
  if (!reset && chatSessions.length >= chatSessionsTotal && chatSessionsTotal > 0) return;

  chatSessionsLoading = true;
  try {
    const opts = { limit: PAGE_SIZE, skip: chatSessions.length };
    if (chatFilterFile.value) opts.fileKey = chatFilterFile.value;

    const result = await api.chatSessions(opts);
    const batch = result.sessions || [];
    chatSessionsTotal = result.total || 0;
    chatSessions = chatSessions.concat(batch);

    if (chatSessions.length === batch.length && !chatFilterFile.value) {
      populateChatFileFilter();
    }
    renderChatSessions(reset);
  } catch (err) {
    console.error('Failed to load chat sessions:', err);
  } finally {
    chatSessionsLoading = false;
  }
}

async function populateChatFileFilter() {
  const current = chatFilterFile.value;
  try {
    const { files } = await api.files(false);
    chatFilterFile.innerHTML = '<option value="">All files</option>' +
      files.map(f =>
        `<option value="${esc(f.fileKey)}">${esc(f.fileName || f.fileKey)}</option>`
      ).join('');
    if (current && files.some(f => f.fileKey === current)) {
      chatFilterFile.value = current;
    }
  } catch (err) {
    console.error('Failed to load chat file filter:', err);
  }
}

function renderChatSessions(reset = false) {
  const container = document.getElementById('chat-session-list');

  if (chatSessions.length === 0) {
    container.innerHTML = '<div class="empty">No conversations found</div>';
    return;
  }

  if (reset) container.innerHTML = '';

  const existingLoader = container.querySelector('.sidebar-loader');
  if (existingLoader) existingLoader.remove();

  const existingCount = container.querySelectorAll('.sidebar-card').length;
  const newItems = chatSessions.slice(existingCount);

  const fragment = document.createDocumentFragment();
  for (const s of newItems) {
    const parsed = parseSessionContent(s);
    const div = document.createElement('div');
    const isSelected = parsed.sessionId === selectedChatSessionId;
    div.className = `sidebar-card${isSelected ? ' selected' : ''}`;
    div.dataset.sessionId = parsed.sessionId;
    div.innerHTML = `
      <div class="card-top">
        <span class="chat-card-name">${esc(parsed.name || 'Untitled Session')}</span>
        <span class="card-age">${timeAgo(s.updatedAt || parsed.lastMessageAt)}</span>
      </div>
      <div class="chat-card-file">${esc(s.fileName || s.fileKey || '')}</div>
      <div class="card-footer">
        <span class="chat-card-count">${parsed.messageCount || 0} messages</span>
      </div>
    `;
    div.addEventListener('click', () => selectChatSession(parsed.sessionId, s));
    fragment.appendChild(div);
  }
  container.appendChild(fragment);

  if (chatSessions.length < chatSessionsTotal) {
    const loader = document.createElement('div');
    loader.className = 'sidebar-loader';
    loader.textContent = `${chatSessions.length} of ${chatSessionsTotal} — scroll for more`;
    container.appendChild(loader);
  }
}

function parseSessionContent(entry) {
  try {
    return JSON.parse(entry.content);
  } catch {
    return { sessionId: '', name: 'Unknown', messageCount: 0 };
  }
}

async function selectChatSession(sessionId, sessionEntry) {
  selectedChatSessionId = sessionId;

  // Update sidebar selection
  document.querySelectorAll('#chat-session-list .sidebar-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.sessionId === sessionId);
  });

  const panel = document.getElementById('chat-detail');
  panel.innerHTML = '<div class="detail-empty"><p>Loading messages...</p></div>';

  try {
    const { messages } = await api.chatMessages(sessionId);
    const parsed = parseSessionContent(sessionEntry);
    renderChatThread(panel, parsed, sessionEntry, messages);
  } catch (err) {
    panel.innerHTML = '<div class="detail-empty"><p>Failed to load messages</p></div>';
    console.error(err);
  }
}

function renderChatThread(panel, session, sessionEntry, rawMessages) {
  const messages = rawMessages.map(m => {
    try {
      const p = JSON.parse(m.content);
      return { ...p, _createdAt: m.createdAt };
    } catch {
      return null;
    }
  }).filter(Boolean);

  messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const duration = messages.length >= 2
    ? timeAgo(new Date(messages[0].timestamp))
    : '';

  panel.innerHTML = `
    <div class="chat-thread-header">
      <div class="chat-thread-title">${esc(session.name || 'Untitled Session')}</div>
      <div class="chat-thread-meta">
        ${esc(sessionEntry.fileName || sessionEntry.fileKey || '')}
        ${session.messageCount ? ' \u00B7 ' + session.messageCount + ' messages' : ''}
        ${duration ? ' \u00B7 started ' + duration : ''}
      </div>
    </div>
    <div class="chat-thread">
      ${messages.map((m, i) => `
        <div class="chat-bubble chat-bubble-${m.role === 'user' ? 'user' : 'assistant'}" style="animation-delay:${Math.min(i * 30, 600)}ms">
          <div class="chat-bubble-role">${m.role === 'user' ? 'YOU' : 'REX'}</div>
          <div class="chat-bubble-content">${m.role === 'assistant' ? renderMarkdown(m.message) : esc(m.message)}</div>
          <div class="chat-bubble-time">${m.timestamp ? fmtTime(m.timestamp) : ''}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Scroll to bottom
  requestAnimationFrame(() => {
    panel.scrollTop = panel.scrollHeight;
  });
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' \u00B7 ' + d.toLocaleDateString();
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
  return firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
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
