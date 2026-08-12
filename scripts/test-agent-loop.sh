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
  scripts/test-json-schema-validator.mjs \
  scripts/test-knowledge-base.mjs \
  scripts/test-markdown.mjs \
  scripts/test-preview-sandbox.mjs \
  scripts/test-run-js-policy.mjs \
  scripts/test-tool-registry.mjs \
  scripts/test-web-search.mjs \
  scripts/test-vfs-tools.mjs \
  scripts/test-rich-document-core.mjs \
  scripts/test-docx-engine.mjs \
  scripts/test-pdf-engine.mjs \
  scripts/test-xlsx-engine.mjs \
  scripts/test-pptx-engine.mjs \
  scripts/test-document-artifact-store.mjs \
  scripts/test-document-images.mjs \
  scripts/test-document-sandbox-runtime.mjs \
  scripts/test-document-service.mjs \
  scripts/test-agent-tool-scheduler.mjs
do
  node "$test_file"
done

echo "Agent Loop test suite passed."
