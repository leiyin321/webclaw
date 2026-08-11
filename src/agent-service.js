export function createAgentService(options = {}) {
  const execute = typeof options.execute === "function" ? options.execute : null;
  if (!execute) throw new Error("AgentService requires an execute function.");
  const sessionTails = new Map();
  const activeRuns = new Map();

  return {
    run(messages, runOptions = {}) {
      if (runOptions.nested === true) return execute(messages, runOptions);
      const sessionId = String(runOptions.sessionId || "default");
      const turnId = String(runOptions.turnId || createTurnId());
      const previous = sessionTails.get(sessionId) || Promise.resolve();
      const task = previous
        .catch(() => {})
        .then(async () => {
          if (runOptions.signal?.aborted) throw new Error("Stopped");
          const resolvedMessages = typeof messages === "function" ? await messages() : messages;
          activeRuns.set(turnId, {
            turnId,
            sessionId,
            source: String(runOptions.source || runOptions.authorizationMode || "sidepanel"),
            startedAt: Date.now()
          });
          try {
            return await execute(resolvedMessages, { ...runOptions, turnId });
          } finally {
            activeRuns.delete(turnId);
          }
        });
      sessionTails.set(sessionId, task);
      task.finally(() => {
        if (sessionTails.get(sessionId) === task) sessionTails.delete(sessionId);
      }).catch(() => {});
      return task;
    },

    active() {
      return [...activeRuns.values()].map((run) => ({ ...run }));
    },

    pendingSessionCount() {
      return sessionTails.size;
    }
  };
}

function createTurnId() {
  return `turn-${crypto.randomUUID()}`;
}
