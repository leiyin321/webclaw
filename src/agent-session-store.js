export function mergeAgentSessionState(currentValue, incomingValue, options = {}) {
  const current = sessionState(currentValue);
  const incoming = sessionState(incomingValue);
  const deleted = new Set(strings(options.deletedSessionIds));
  const replaced = new Set(strings(options.replaceSessionIds));
  const maxSessions = positiveInteger(options.maxSessions, 80);
  const maxMessages = positiveInteger(options.maxMessages, 200);
  const maxTurns = positiveInteger(options.maxTurns, 100);
  const byId = new Map(current.sessions.filter((session) => !deleted.has(session.id)).map((session) => [session.id, session]));

  for (const incomingSession of incoming.sessions) {
    if (deleted.has(incomingSession.id)) continue;
    const existing = byId.get(incomingSession.id);
    byId.set(
      incomingSession.id,
      !existing || replaced.has(incomingSession.id)
        ? clone(incomingSession)
        : {
            ...existing,
            ...incomingSession,
            messages: mergeRecords(existing.messages, incomingSession.messages, "time", maxMessages),
            turns: mergeRecords(existing.turns, incomingSession.turns, "completedAt", maxTurns)
          }
    );
  }

  const sessions = [...byId.values()]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, maxSessions);
  const requestedActive = String(incoming.activeSessionId || current.activeSessionId || "");
  return {
    activeSessionId: sessions.some((session) => session.id === requestedActive)
      ? requestedActive
      : sessions[0]?.id || "",
    sessions
  };
}

function mergeRecords(current, incoming, timestampKey, limit) {
  const records = new Map();
  for (const record of Array.isArray(current) ? current : []) {
    const id = String(record?.id || "");
    if (id) records.set(id, clone(record));
  }
  for (const record of Array.isArray(incoming) ? incoming : []) {
    const id = String(record?.id || "");
    if (id) records.set(id, { ...(records.get(id) || {}), ...clone(record) });
  }
  const sorted = [...records.values()]
    .sort((left, right) => recordTimestamp(left, timestampKey) - recordTimestamp(right, timestampKey));
  if (timestampKey !== "completedAt") return sorted.slice(-limit);

  const active = sorted.filter((record) => !isTerminalTurn(record));
  const completedLimit = Math.max(0, limit - active.length);
  const completed = completedLimit > 0 ? sorted.filter(isTerminalTurn).slice(-completedLimit) : [];
  return [...completed, ...active]
    .sort((left, right) => recordTimestamp(left, timestampKey) - recordTimestamp(right, timestampKey));
}

function recordTimestamp(record, timestampKey) {
  return Number(record?.[timestampKey] || record?.updatedAt || record?.startedAt || record?.time || 0);
}

function isTerminalTurn(record) {
  return ["completed", "failed", "interrupted", "cancelled"].includes(String(record?.status || ""));
}

function sessionState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    activeSessionId: String(source.activeSessionId || ""),
    sessions: (Array.isArray(source.sessions) ? source.sessions : [])
      .filter((session) => session && String(session.id || ""))
      .map(clone)
  };
}

function strings(value) {
  return (Array.isArray(value) ? value : []).map((entry) => String(entry || "")).filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
