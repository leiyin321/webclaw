const DEFAULT_PROTOCOL_RETRIES = 2;
const DEFAULT_EMPTY_RESPONSE_RETRIES = 1;
const DEFAULT_FINAL_VALIDATION_RETRIES = 3;
const DEFAULT_MODEL_RETRIES = 2;
const DEFAULT_RAW_OUTPUT_CHARS = 6000;

export function createAgentRecoveryPolicy(options = {}) {
  const limits = {
    protocol: nonNegativeInteger(options.maxProtocolRetries, DEFAULT_PROTOCOL_RETRIES),
    emptyResponse: nonNegativeInteger(options.maxEmptyResponseRetries, DEFAULT_EMPTY_RESPONSE_RETRIES),
    finalValidation: nonNegativeInteger(options.maxFinalValidationRetries, DEFAULT_FINAL_VALIDATION_RETRIES),
    model: nonNegativeInteger(options.maxModelRetries, DEFAULT_MODEL_RETRIES)
  };
  const counters = {
    protocol: nonNegativeInteger(options.counters?.protocol, 0),
    emptyResponse: nonNegativeInteger(options.counters?.emptyResponse, 0),
    finalValidation: nonNegativeInteger(options.counters?.finalValidation, 0),
    model: nonNegativeInteger(options.counters?.model, 0)
  };
  const rawOutputChars = positiveInteger(options.rawOutputChars, DEFAULT_RAW_OUTPUT_CHARS);

  return {
    recoverProtocolError({ protocolError }) {
      if (counters.protocol >= limits.protocol) {
        return stopDecision("protocol_retry_limit", counters, limits);
      }
      counters.protocol += 1;
      const raw = truncateText(protocolError?.raw, rawOutputChars);
      return {
        action: "retry",
        type: "protocol_error",
        attempt: counters.protocol,
        limit: limits.protocol,
        messages: [
          ...(raw ? [{ role: "assistant", content: raw }] : []),
          {
            role: "user",
            content: [
              "MODEL_PROTOCOL_ERROR",
              String(protocolError?.message || "The previous response could not be parsed."),
              "Return exactly one valid final response or one valid Tool Call using the required schema.",
              "Do not repeat the invalid output unchanged."
            ].join("\n")
          }
        ]
      };
    },

    recoverEmptyResponse() {
      if (counters.emptyResponse >= limits.emptyResponse) {
        return stopDecision("empty_response_retry_limit", counters, limits);
      }
      counters.emptyResponse += 1;
      return {
        action: "retry",
        type: "empty_response",
        attempt: counters.emptyResponse,
        limit: limits.emptyResponse,
        messages: [{
          role: "user",
          content: [
            "EMPTY_MODEL_RESPONSE",
            "The previous response contained neither a final answer nor a Tool Call.",
            "Continue the task with one valid final response or one valid Tool Call."
          ].join("\n")
        }]
      };
    },

    recoverFinalValidation({ assistantText, validationResult, instruction }) {
      if (counters.finalValidation >= limits.finalValidation) {
        return stopDecision("final_validation_retry_limit", counters, limits);
      }
      counters.finalValidation += 1;
      return {
        action: "retry",
        type: "final_validation",
        attempt: counters.finalValidation,
        limit: limits.finalValidation,
        messages: [
          {
            role: "assistant",
            content: truncateText(assistantText, rawOutputChars)
          },
          {
            role: "user",
            content: [
              "TASK_OUTPUT_VALIDATION_ERROR",
              JSON.stringify(validationResult || {}),
              String(instruction || "Return a corrected final JSON value matching the required output schema. Do not claim completion until it validates.")
            ].join("\n")
          }
        ]
      };
    },

    recoverModelError({ classifiedError }) {
      if (!classifiedError?.retryable || classifiedError.type === "context_length") {
        return {
          ...stopDecision("model_error_not_retryable", counters, limits),
          errorType: classifiedError?.type || "fatal"
        };
      }
      if (counters.model >= limits.model) {
        return {
          ...stopDecision("model_retry_limit", counters, limits),
          errorType: classifiedError.type
        };
      }
      counters.model += 1;
      return {
        action: "retry",
        type: "model_error",
        errorType: classifiedError.type,
        attempt: counters.model,
        limit: limits.model,
        delayMs: classifiedError.type === "rate_limit" ? Math.min(8000, counters.model * 2000) : counters.model * 500,
        messages: []
      };
    },

    snapshot() {
      return {
        counters: { ...counters },
        limits: { ...limits }
      };
    }
  };
}

function stopDecision(reason, counters, limits) {
  return {
    action: "stop",
    reason,
    counters: { ...counters },
    limits: { ...limits }
  };
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n... truncated ${text.length - maxLength} chars`;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}
