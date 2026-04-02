const { WebSocketServer } = require("ws");
const crypto = require("crypto");

let wss = null;
const clients = new Map();
const locks = new Map();

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

function setupWS(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const clientId = crypto.randomUUID();
    clients.set(ws, { clientId, userName: null });

    ws.send(JSON.stringify({ type: "connected", clientId }));

    sendLockSnapshot(ws);

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      const info = clients.get(ws);
      if (!info) return;

      if (msg.type === "set_name") {
        info.userName = msg.name || null;
        return;
      }

      if (msg.type === "lock:acquire") {
        handleLockAcquire(ws, info, msg);
        return;
      }

      if (msg.type === "lock:release") {
        handleLockRelease(info, msg);
        return;
      }
    });

    ws.on("close", () => {
      const info = clients.get(ws);
      if (info) releaseAllLocks(info.clientId);
      clients.delete(ws);
    });
  });

  setInterval(expireStale, 30_000);
}

function broadcast(event, payload, excludeClientId) {
  if (!wss) return;
  const msg = JSON.stringify({ type: "broadcast", event, data: payload });
  for (const [ws, info] of clients) {
    if (ws.readyState === 1 && info.clientId !== excludeClientId) {
      ws.send(msg);
    }
  }
}

function broadcastAll(event, payload) {
  broadcast(event, payload, null);
}

function lockKey(entity, id) {
  return `${entity}:${id}`;
}

function handleLockAcquire(ws, info, msg) {
  const { entity, id } = msg;
  if (!entity || id == null) return;
  const key = lockKey(entity, id);
  const existing = locks.get(key);

  if (existing && existing.clientId !== info.clientId) {
    ws.send(JSON.stringify({
      type: "lock:denied",
      entity,
      id,
      lockedBy: existing.userName || "Другой пользователь",
    }));
    return;
  }

  locks.set(key, {
    clientId: info.clientId,
    userName: info.userName || "Unknown",
    since: Date.now(),
  });

  broadcastLockState(entity, id, info);
}

function handleLockRelease(info, msg) {
  const { entity, id } = msg;
  if (!entity || id == null) return;
  const key = lockKey(entity, id);
  const existing = locks.get(key);
  if (existing && existing.clientId === info.clientId) {
    locks.delete(key);
    broadcastLockReleased(entity, id);
  }
}

function releaseAllLocks(clientId) {
  for (const [key, lock] of locks) {
    if (lock.clientId === clientId) {
      locks.delete(key);
      const [entity, id] = key.split(":");
      broadcastLockReleased(entity, id);
    }
  }
}

function broadcastLockState(entity, id, info) {
  if (!wss) return;
  const msg = JSON.stringify({
    type: "lock:acquired",
    entity,
    id: Number(id),
    clientId: info.clientId,
    userName: info.userName || "Unknown",
  });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastLockReleased(entity, id) {
  if (!wss) return;
  const msg = JSON.stringify({ type: "lock:released", entity, id: Number(id) });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function sendLockSnapshot(ws) {
  const snapshot = {};
  for (const [key, lock] of locks) {
    snapshot[key] = { clientId: lock.clientId, userName: lock.userName };
  }
  ws.send(JSON.stringify({ type: "lock:snapshot", locks: snapshot }));
}

function expireStale() {
  const now = Date.now();
  for (const [key, lock] of locks) {
    if (now - lock.since > LOCK_TIMEOUT_MS) {
      locks.delete(key);
      const [entity, id] = key.split(":");
      broadcastLockReleased(entity, id);
    }
  }
}

function isLockedByOther(entity, id, clientId) {
  const key = lockKey(entity, id);
  const lock = locks.get(key);
  if (!lock) return false;
  return lock.clientId !== clientId;
}

function getLockInfo(entity, id) {
  return locks.get(lockKey(entity, id)) || null;
}

module.exports = { setupWS, broadcast, broadcastAll, isLockedByOther, getLockInfo };
