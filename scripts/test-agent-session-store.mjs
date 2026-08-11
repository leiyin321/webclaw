import assert from "node:assert/strict";
import { mergeAgentSessionState } from "../src/agent-session-store.js";

const current = {
  activeSessionId: "s1",
  sessions: [{
    id: "s1",
    title: "Chat",
    updatedAt: 2,
    messages: [{ id: "remote", content: "channel", time: 2 }],
    turns: [{ id: "turn-remote", status: "completed", completedAt: 2 }]
  }]
};
const incoming = {
  activeSessionId: "s1",
  sessions: [{
    id: "s1",
    title: "Renamed",
    updatedAt: 3,
    messages: [{ id: "local", content: "panel", time: 3 }],
    turns: [{ id: "turn-local", status: "completed", completedAt: 3 }]
  }]
};

const merged = mergeAgentSessionState(current, incoming);
assert.equal(merged.sessions[0].title, "Renamed");
assert.deepEqual(merged.sessions[0].messages.map((message) => message.id), ["remote", "local"]);
assert.deepEqual(merged.sessions[0].turns.map((turn) => turn.id), ["turn-remote", "turn-local"]);

const replaced = mergeAgentSessionState(current, {
  activeSessionId: "s1",
  sessions: [{ ...incoming.sessions[0], messages: [], turns: [] }]
}, { replaceSessionIds: ["s1"] });
assert.deepEqual(replaced.sessions[0].messages, []);

const deleted = mergeAgentSessionState({
  activeSessionId: "s1",
  sessions: [current.sessions[0], { id: "s2", updatedAt: 1, messages: [], turns: [] }]
}, { activeSessionId: "s2", sessions: [] }, { deletedSessionIds: ["s1"] });
assert.deepEqual(deleted.sessions.map((session) => session.id), ["s2"]);
assert.equal(deleted.activeSessionId, "s2");

const completedTurns = Array.from({ length: 100 }, (_, index) => ({
  id: `completed-${index}`,
  status: "completed",
  completedAt: index + 1
}));
const withRunningTurn = mergeAgentSessionState({
  activeSessionId: "s1",
  sessions: [{ id: "s1", updatedAt: 1, messages: [], turns: completedTurns }]
}, {
  activeSessionId: "s1",
  sessions: [{
    id: "s1",
    updatedAt: 2,
    messages: [],
    turns: [{ id: "running", status: "running", startedAt: 101 }]
  }]
});
assert.equal(withRunningTurn.sessions[0].turns.length, 100);
assert.ok(withRunningTurn.sessions[0].turns.some((turn) => turn.id === "running"));
assert.ok(!withRunningTurn.sessions[0].turns.some((turn) => turn.id === "completed-0"));

console.log("Agent session store tests passed.");
