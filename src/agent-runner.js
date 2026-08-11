import {
  modelTurnAssistantText,
  modelTurnProtocolError,
  modelTurnToolCalls
} from "./agent-model-turn.js";
import { createAgentToolScheduler } from "./agent-tool-scheduler.js";
import { createAgentBudgets } from "./agent-budgets.js";
import { classifyAgentError } from "./agent-errors.js";
import { createAgentProgressTracker } from "./agent-progress.js";
import { createAgentStateMachine, isTerminalAgentState } from "./agent-state.js";

export async function runAgentLoop(options) {
  const maxSteps = positiveInteger(
    options?.runtimeState?.budgets?.limits?.modelSteps,
    positiveInteger(options?.maxSteps, 1)
  );
  const messages = Array.isArray(options?.messages) ? options.messages : [];
  let pendingRecoveryResult = null;
  let toolScheduler = null;
  const budgets = options.budgets || createAgentBudgets({
    maxModelSteps: maxSteps,
    maxToolCalls: options.runtimeState?.budgets?.limits?.toolCalls ?? options.maxToolCalls,
    maxElapsedMs: options.runtimeState?.budgets?.limits?.elapsedMs ?? options.maxElapsedMs,
    startedAt: options.runtimeState?.budgets?.startedAt,
    used: options.runtimeState?.budgets?.used
  });
  const progressTracker = options.progressTracker || createAgentProgressTracker({
    ...options.progressOptions,
    ...options.runtimeState?.progress
  });
  const stateMachine = options.stateMachine || createAgentStateMachine();
  const transition = async (state, data = {}) => {
    const event = stateMachine.transition(state, data);
    await options.onStateTransition?.(event);
    return event;
  };
  const runtimeSnapshot = () => ({
    budgets: budgets.snapshot(),
    progress: progressTracker.snapshot(),
    recovery: options.recoveryPolicy?.snapshot?.() || null
  });
  const scheduler = () => {
    if (!toolScheduler) {
      toolScheduler = createAgentToolScheduler({
        execute: (toolCall, schedulerContext) => options.executeTool({
          step: schedulerContext.step,
          messages,
          stepContext: schedulerContext.stepContext,
          turn: schedulerContext.turn,
          toolCall,
          toolCalls: schedulerContext.toolCalls,
          operationKey: schedulerContext.operationKey,
          executionMetadata: schedulerContext.metadata,
          runtimeState: schedulerContext.runtimeState,
          signal: schedulerContext.signal
        }),
        resolveMetadata: options.resolveToolExecutionMetadata,
        validate: options.validateToolCall,
        operationStore: options.toolOperationStore
      });
    }
    return toolScheduler;
  };

  try {
    const pendingToolCalls = Array.isArray(options.pendingToolCalls) ? options.pendingToolCalls : [];
    if (pendingToolCalls.length > 0) {
      options.assertCanContinue?.();
      const step = Math.max(0, Number(options.pendingToolStep || 0));
      const runtimeState = runtimeSnapshot();
      await transition("executing_tools", { step, toolCallCount: pendingToolCalls.length, recovered: true });
      const batch = await scheduler().executeBatch(pendingToolCalls, {
        runId: options.runId,
        signal: options.signal,
        step,
        messages,
        stepContext: null,
        turn: null,
        toolCalls: pendingToolCalls,
        runtimeState
      });
      await options.onToolBatchCompleted?.({ step, turn: null, toolCalls: pendingToolCalls, batch, recovered: true });
      await transition("recording_observations", { step, toolCallCount: pendingToolCalls.length, recovered: true });
      appendMessages(messages, batch.results.flatMap(messagesForScheduledResult));
      const progress = progressTracker.recordToolBatch(pendingToolCalls, batch.results);
      if (progress.action === "nudge") messages.push({ role: "user", content: progress.message });
      await options.onBoundary?.({
        phase: "after_tool",
        step,
        messages,
        execution: { batch },
        toolCalls: pendingToolCalls,
        progress,
        runtimeState: runtimeSnapshot(),
        recovered: true
      });
      await transition("evaluating_progress", { step, progressAction: progress.action, recovered: true });
      if (progress.action === "stop") {
        await transition("stuck", { step, reason: progress.reason });
        return { status: "stuck", step, progress, budget: budgets.snapshot() };
      }
    }

    for (let step = 0; step < maxSteps; step += 1) {
    options.assertCanContinue?.();
    const modelBudget = budgets.consume("modelSteps");
    if (modelBudget.exhausted) {
      await transition("failed", { reason: "budget_exhausted", step });
      return { status: "budget_exhausted", budget: modelBudget };
    }
    await transition("sampling_model", { step });
    const stepContext = await options.beforeModelStep?.({ step, messages, runtimeState: runtimeSnapshot() });
    let turn;
    try {
      turn = await options.sampleModel({ step, messages, stepContext });
    } catch (error) {
      const classifiedError = classifyAgentError(error, { aborted: options.signal?.aborted });
      if (classifiedError.type === "aborted") throw error;
      const recovery = options.recoveryPolicy?.recoverModelError?.({
        step,
        error,
        classifiedError
      });
      await options.onRecovery?.({ step, error, recovery, classifiedError });
      if (recovery?.action === "retry") {
        await transition("recovering", { reason: "model_error", step, errorType: classifiedError.type });
        pendingRecoveryResult = {
          status: "model_error",
          step,
          error: classifiedError,
          recovery
        };
        await options.onBoundary?.({
          phase: "after_recovery",
          step,
          messages,
          recovery,
          runtimeState: runtimeSnapshot()
        });
        await (options.wait || waitFor)(recovery.delayMs, options.signal);
        continue;
      }
      await transition("failed", { reason: "model_error", step, errorType: classifiedError.type });
      return { status: "model_error", step, error: classifiedError, recovery };
    }
    await transition("normalizing_response", { step });
    const assistantText = modelTurnAssistantText(turn);
    const toolCalls = modelTurnToolCalls(turn);
    const protocolError = modelTurnProtocolError(turn);

    await options.onModelTurn?.({
      step,
      messages,
      stepContext,
      turn,
      assistantText,
      toolCalls,
      protocolError
    });

    if (protocolError) {
      const recovery = options.recoveryPolicy?.recoverProtocolError?.({
        step,
        turn,
        protocolError
      });
      await options.onRecovery?.({ step, turn, recovery, protocolError });
      if (recovery?.action === "retry") {
        await transition("recovering", { reason: "protocol_error", step });
        appendMessages(messages, recovery.messages);
        await options.onBoundary?.({
          phase: "after_recovery",
          step,
          messages,
          turn,
          recovery,
          runtimeState: runtimeSnapshot()
        });
        pendingRecoveryResult = {
          status: "protocol_error",
          step,
          turn,
          protocolError,
          recovery
        };
        continue;
      }
      await transition("failed", { reason: "protocol_error", step });
      return {
        status: "protocol_error",
        step,
        turn,
        protocolError,
        recovery
      };
    }
    pendingRecoveryResult = null;
    await transition("validating_actions", { step, toolCallCount: toolCalls.length });

    if (toolCalls.length === 0) {
      if (
        !assistantText.trim() &&
        options.shouldRecoverEmptyAssistant?.({ step, turn }) !== false
      ) {
        const recovery = options.recoveryPolicy?.recoverEmptyResponse?.({ step, turn });
        await options.onRecovery?.({ step, turn, recovery });
        if (recovery?.action === "retry") {
          await transition("recovering", { reason: "empty_response", step });
          appendMessages(messages, recovery.messages);
          await options.onBoundary?.({
            phase: "after_recovery",
            step,
            messages,
            turn,
            recovery,
            runtimeState: runtimeSnapshot()
          });
          pendingRecoveryResult = {
            status: "empty_response",
            step,
            turn,
            recovery
          };
          continue;
        }
        if (recovery?.action === "stop") {
          await transition("failed", { reason: "empty_response", step });
          return {
            status: "empty_response",
            step,
            turn,
            recovery
          };
        }
      }
      const decision = await options.handleAssistant({
        step,
        messages,
        stepContext,
        turn,
        assistantText
      });
      appendMessages(messages, decision?.messages);
      await options.onBoundary?.({
        phase: decision?.continue === true ? "after_assistant_correction" : "after_assistant",
        step,
        messages,
        turn,
        decision,
        runtimeState: runtimeSnapshot()
      });
      if (decision?.continue === true) {
        await transition("recovering", { reason: "assistant_correction", step });
        continue;
      }
      await transition("completed", { step });
      return {
        status: "completed",
        step,
        turn,
        final: decision?.final ?? assistantText,
        metadata: decision?.metadata || {}
      };
    }

    const toolBudget = budgets.consume("toolCalls", toolCalls.length);
    if (toolBudget.exhausted) {
      await transition("failed", { reason: "budget_exhausted", step });
      return { status: "budget_exhausted", budget: toolBudget };
    }
    await transition("executing_tools", { step, toolCallCount: toolCalls.length });
    const batch = await scheduler().executeBatch(toolCalls, {
      runId: options.runId,
      signal: options.signal,
      step,
      messages,
      stepContext,
      turn,
      toolCalls,
      runtimeState: runtimeSnapshot()
    });
    await options.onToolBatchCompleted?.({ step, turn, toolCalls, batch });
    await transition("recording_observations", { step, toolCallCount: toolCalls.length });
    const execution = {
      batch,
      messages: batch.results.flatMap(messagesForScheduledResult)
    };
    appendMessages(messages, execution?.messages);
    const progress = progressTracker.recordToolBatch(toolCalls, batch.results);
    if (progress.action === "nudge") {
      messages.push({ role: "user", content: progress.message });
    }
    await options.onBoundary?.({
      phase: "after_tool",
      step,
      messages,
      turn,
      execution,
      toolCalls,
      progress,
      runtimeState: runtimeSnapshot()
    });
    await transition("evaluating_progress", { step, progressAction: progress.action });
    if (progress.action === "stop") {
      await transition("stuck", { step, reason: progress.reason });
      return { status: "stuck", step, progress, budget: budgets.snapshot() };
    }
    }

    await transition("failed", { reason: pendingRecoveryResult?.status || "step_limit" });
    return pendingRecoveryResult || {
      status: "step_limit",
      maxSteps
    };
  } catch (error) {
    if (!isTerminalAgentState(stateMachine.current())) {
      const interrupted = options.signal?.aborted || error?.name === "AbortError" || error?.message === "Stopped";
      try {
        await transition(interrupted ? "interrupted" : "failed", {
          reason: interrupted ? "aborted" : "runtime_error"
        });
      } catch {
        // Preserve the original runtime error if state reporting also fails.
      }
    }
    throw error;
  }
}

function appendMessages(target, additions) {
  if (!Array.isArray(additions) || additions.length === 0) return;
  target.push(...additions);
}

export function messagesForScheduledResult(entry) {
  if (Array.isArray(entry?.result?.messages)) return entry.result.messages;
  const call = entry?.call || {};
  const output = JSON.stringify(entry?.result || { ok: false, error: "Tool execution produced no result." });
  return [
    {
      role: "assistant",
      content: JSON.stringify({ tool: { name: call.name, args: call.args || {} } }),
      nativeItem: {
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: JSON.stringify(call.args || {})
      }
    },
    {
      role: "user",
      content: `TOOL_RESULT ${call.name}: ${output}`,
      nativeItem: {
        type: "function_call_output",
        call_id: call.callId,
        output
      }
    }
  ];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

function waitFor(delayMs, signal) {
  const duration = Math.max(0, Number(delayMs || 0));
  if (!duration) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Stopped"));
    }, { once: true });
  });
}
