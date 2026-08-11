export class DocumentSpecError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message);
    this.name = "DocumentSpecError";
    this.code = code;
    this.details = details;
    this.stage = options.stage || "validation";
    this.retryable = options.retryable !== false;
    this.suggestedActions = options.suggestedActions || [];
  }
}

export function documentSpecError(code, message, details = {}, options = {}) {
  return new DocumentSpecError(code, message, details, options);
}
