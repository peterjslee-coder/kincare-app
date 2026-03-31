// ─── InPlace Offline Queue ───
// IndexedDB-based queue for storing check-in, check-out, and note actions
// when the caregiver has no internet. Auto-syncs when connectivity returns.

const OFFLINE_DB_NAME = 'inplace-offline';
const OFFLINE_DB_VERSION = 1;
const STORE_NAME = 'pendingActions';

// ─── IndexedDB helpers ───

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

// Queue an action for later sync
// action: { type: 'check-in'|'check-out'|'note', url, method, body, sessionId?, meta? }
async function queueOfflineAction(action) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record = {
      ...action,
      status: 'pending',        // pending | syncing | synced | failed
      createdAt: new Date().toISOString(),
      offlineTimestamp: new Date().toISOString(), // actual time of action
      attempts: 0,
      lastError: null,
    };
    const req = store.add(record);
    req.onsuccess = () => {
      record.id = req.result;
      resolve(record);
      // Notify any listeners that pending count changed
      _notifyPendingChange();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// Get all pending (un-synced) actions, ordered by creation time
async function getPendingActions() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const pending = req.result
        .filter(a => a.status === 'pending' || a.status === 'failed')
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      resolve(pending);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// Get count of pending actions
async function getPendingCount() {
  const actions = await getPendingActions();
  return actions.length;
}

// Update an action's status
async function updateActionStatus(id, status, error) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve(null);
      record.status = status;
      record.attempts = (record.attempts || 0) + (status === 'failed' ? 1 : 0);
      if (error) record.lastError = error;
      if (status === 'synced') record.syncedAt = new Date().toISOString();
      store.put(record);
      resolve(record);
      _notifyPendingChange();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

// Remove a synced action
async function removeAction(id) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); _notifyPendingChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

// Clear all synced actions (cleanup)
async function clearSyncedActions() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const record of req.result) {
        if (record.status === 'synced') store.delete(record.id);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => { db.close(); _notifyPendingChange(); };
  });
}

// ─── Sync engine ───

let _syncing = false;

async function syncOfflineActions() {
  if (_syncing) return { synced: 0, failed: 0 };
  if (!navigator.onLine) return { synced: 0, failed: 0, offline: true };

  _syncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const pending = await getPendingActions();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    console.log(`[OfflineQueue] Syncing ${pending.length} pending action(s)...`);

    for (const action of pending) {
      // Skip actions that have failed too many times
      if (action.attempts >= 5) {
        console.warn(`[OfflineQueue] Skipping action ${action.id} — too many attempts`);
        continue;
      }

      await updateActionStatus(action.id, 'syncing');

      try {
        // Inject offlineTimestamp into the body so the server knows the real time
        const body = action.body ? JSON.parse(action.body) : {};
        body.offlineTimestamp = action.offlineTimestamp;
        body.offlineSync = true;

        const response = await window.apiFetch(action.url, {
          method: action.method || 'POST',
          body: JSON.stringify(body),
          // Tag this as a sync request so we don't re-queue it
          headers: { 'X-Offline-Sync': 'true' },
        });

        if (response && response.ok) {
          await updateActionStatus(action.id, 'synced');
          // Clean up immediately
          await removeAction(action.id);
          synced++;
          console.log(`[OfflineQueue] Synced: ${action.type} (${action.url})`);
        } else {
          const errData = response ? await response.json().catch(() => ({})) : {};
          const errMsg = errData.error || `HTTP ${response?.status}`;

          // If session was cancelled or doesn't exist, discard the action
          if (response?.status === 404 || response?.status === 400) {
            console.warn(`[OfflineQueue] Discarding ${action.type} — ${errMsg}`);
            await updateActionStatus(action.id, 'synced'); // mark done
            await removeAction(action.id);
            synced++; // count as resolved
          } else {
            await updateActionStatus(action.id, 'failed', errMsg);
            failed++;
          }
        }
      } catch (err) {
        // Network error — stop syncing, we're probably offline again
        await updateActionStatus(action.id, 'failed', err.message);
        failed++;
        if (!navigator.onLine) break;
      }
    }
  } finally {
    _syncing = false;
    // Clean up old synced records
    await clearSyncedActions().catch(() => {});
  }

  return { synced, failed };
}

// ─── Connectivity listeners ───

let _pendingChangeListeners = [];

function onPendingChange(callback) {
  _pendingChangeListeners.push(callback);
  return () => {
    _pendingChangeListeners = _pendingChangeListeners.filter(cb => cb !== callback);
  };
}

function _notifyPendingChange() {
  getPendingCount().then(count => {
    for (const cb of _pendingChangeListeners) {
      try { cb(count); } catch {}
    }
  }).catch(() => {});
}

// Auto-sync when device comes back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Back online — starting sync...');
    // Small delay to let network stabilize
    setTimeout(() => {
      syncOfflineActions().then(result => {
        if (result.synced > 0) {
          console.log(`[OfflineQueue] Sync complete: ${result.synced} synced, ${result.failed} failed`);
        }
      });
    }, 2000);
  });
}

// ─── High-level helpers for specific action types ───

// Queue a check-in action
async function queueOfflineCheckIn(sessionId, data) {
  return queueOfflineAction({
    type: 'check-in',
    url: `/api/sessions/${sessionId}/check-in`,
    method: 'POST',
    body: JSON.stringify(data),
    sessionId,
    meta: {
      description: 'Check in to care session',
      sessionId,
    },
  });
}

// Queue a check-out action
async function queueOfflineCheckOut(sessionId, data) {
  return queueOfflineAction({
    type: 'check-out',
    url: `/api/sessions/${sessionId}/check-out`,
    method: 'POST',
    body: JSON.stringify(data),
    sessionId,
    meta: {
      description: 'Check out of care session',
      sessionId,
    },
  });
}

// Queue a note creation
async function queueOfflineNote(data) {
  return queueOfflineAction({
    type: 'note',
    url: '/api/notes',
    method: 'POST',
    body: JSON.stringify(data),
    meta: {
      description: 'Create care note',
      careRecipientId: data.careRecipientId,
    },
  });
}

// Export to window for use by other modules
window.OfflineQueue = {
  queueAction: queueOfflineAction,
  queueCheckIn: queueOfflineCheckIn,
  queueCheckOut: queueOfflineCheckOut,
  queueNote: queueOfflineNote,
  getPending: getPendingActions,
  getPendingCount,
  sync: syncOfflineActions,
  onPendingChange,
  removeAction,
  clearSynced: clearSyncedActions,
};
