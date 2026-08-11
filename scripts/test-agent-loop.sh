#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for test_file in \
  scripts/test-agent-context.mjs \
  scripts/test-agent-control.mjs \
  scripts/test-agent-model-turn.mjs \
  scripts/test-agent-recovery-policy.mjs \
  scripts/test-agent-run-store.mjs \
  scripts/test-agent-runner.mjs \
  scripts/test-agent-service.mjs \
  scripts/test-agent-session-store.mjs \
  scripts/test-agent-state.mjs \
  scripts/test-agent-task-supervisor.mjs \
  scripts/test-agent-terminal-outcome.mjs \
  scripts/test-agent-tool-scheduler.mjs
do
  node "$test_file"
done

echo "Agent Loop test suite passed."
