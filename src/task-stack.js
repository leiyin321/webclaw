const DEFAULT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Concise result for the parent task."
    }
  },
  required: ["summary"],
  additionalProperties: true
});

const TASK_STATUSES = new Set([
  "running",
  "waiting_child",
  "completed",
  "failed",
  "cancelled"
]);

export function defaultTaskOutputSchema() {
  return structuredClone(DEFAULT_OUTPUT_SCHEMA);
}

export function normalizeTaskSpec(value, defaults = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const instruction = String(source.instruction || source.task || "").trim();
  if (!instruction) throw new Error("task_push requires instruction.");
  if (instruction.length > 20_000) throw new Error("task instruction is too long.");

  const outputSchema = normalizeTaskOutputSchema(source.outputSchema);
  const maxSteps = positiveInteger(source.maxSteps, positiveInteger(defaults.maxSteps, 8));
  const allowedTools = uniqueStrings(source.allowedTools).slice(0, 100);
  const context = normalizeTaskContext(source.context);

  return {
    title: String(source.title || instruction.split(/\r?\n/, 1)[0] || "Subtask").trim().slice(0, 160),
    instruction,
    context,
    outputSchema,
    outputInstructions: String(source.outputInstructions || "").trim().slice(0, 4000),
    maxSteps,
    allowedTools,
    workingDirectory: normalizeTaskPath(source.workingDirectory || defaults.workingDirectory || "/workspace")
  };
}

export function normalizeTaskOutputSchema(value) {
  if (value === undefined || value === null) return defaultTaskOutputSchema();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("outputSchema must be a JSON Schema object.");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 12_000) throw new Error("outputSchema is too large.");
  assertSupportedSchema(value, "$", 0);
  return structuredClone(value);
}

export function createTaskRun(options = {}) {
  const now = Date.now();
  const runId = String(options.runId || createId("task-run"));
  const rootTaskId = String(options.rootTaskId || createId("task"));
  const root = {
    id: rootTaskId,
    runId,
    parentId: "",
    depth: 0,
    title: String(options.title || "Agent turn").slice(0, 160),
    instruction: "",
    status: "running",
    step: 0,
    maxSteps: positiveInteger(options.maxSteps, 8),
    workingDirectory: normalizeTaskPath(options.workingDirectory || "/workspace"),
    providerId: String(options.providerId || ""),
    createdAt: now,
    startedAt: now,
    completedAt: 0
  };
  return {
    id: runId,
    sessionId: String(options.sessionId || ""),
    providerId: String(options.providerId || ""),
    status: "running",
    rootTaskId,
    stack: [rootTaskId],
    tasks: { [rootTaskId]: root },
    completedTaskCount: 0,
    budget: {
      maxDepth: positiveInteger(options.maxDepth, 4),
      maxTasks: positiveInteger(options.maxTasks, 16),
      createdTasks: 0,
      maxModelSteps: nonNegativeInteger(options.maxModelSteps, 0),
      usedModelSteps: 0
    },
    createdAt: now,
    updatedAt: now
  };
}

export function pushTask(run, parentTaskId, spec) {
  assertTaskRun(run);
  const parent = run.tasks[String(parentTaskId || "")];
  if (!parent) throw new Error(`Parent task not found: ${parentTaskId || "unknown"}`);
  if (run.stack.at(-1) !== parent.id) {
    throw new Error("Only the current stack-top task can create a child task.");
  }
  const depth = parent.depth + 1;
  if (depth > run.budget.maxDepth) {
    throw new Error(`Task stack depth limit reached (${run.budget.maxDepth}).`);
  }
  if (run.budget.createdTasks >= run.budget.maxTasks) {
    throw new Error(`Task count limit reached (${run.budget.maxTasks}).`);
  }

  const now = Date.now();
  const id = createId("task");
  parent.status = "waiting_child";
  const task = {
    id,
    runId: run.id,
    parentId: parent.id,
    depth,
    title: spec.title,
    instruction: spec.instruction,
    context: spec.context,
    outputSchema: structuredClone(spec.outputSchema),
    outputInstructions: spec.outputInstructions,
    status: "running",
    step: 0,
    maxSteps: spec.maxSteps,
    allowedTools: [...spec.allowedTools],
    workingDirectory: spec.workingDirectory,
    providerId: parent.providerId || run.providerId,
    createdAt: now,
    startedAt: now,
    completedAt: 0
  };
  run.tasks[id] = task;
  run.stack.push(id);
  run.budget.createdTasks += 1;
  run.updatedAt = now;
  return task;
}

export function recordTaskModelStep(run, taskId, options = {}) {
  assertTaskRun(run);
  const task = run.tasks[String(taskId || "")];
  if (!task) throw new Error(`Task not found: ${taskId || "unknown"}`);
  const max = run.budget.maxModelSteps;
  if (max > 0 && run.budget.usedModelSteps >= max && options.allowReservedContinuation !== true) {
    throw new Error(`Task run model-step budget reached (${max}).`);
  }
  task.step += 1;
  run.budget.usedModelSteps += 1;
  run.updatedAt = Date.now();
}

export function completeTask(run, taskId) {
  return removeStackTopTask(run, taskId, "completed");
}

export function failTask(run, taskId) {
  return removeStackTopTask(run, taskId, "failed");
}

export function completeRootTask(run, status = "completed") {
  assertTaskRun(run);
  const root = run.tasks[run.rootTaskId];
  if (root) {
    root.status = TASK_STATUSES.has(status) ? status : "completed";
    root.completedAt = Date.now();
  }
  run.stack = [];
  run.tasks = {};
  run.status = status;
  run.updatedAt = Date.now();
}

export function taskStackSnapshot(run) {
  if (!run) {
    return {
      active: false,
      runId: "",
      status: "idle",
      stack: [],
      budget: null
    };
  }
  assertTaskRun(run);
  return {
    active: run.status === "running",
    runId: run.id,
    sessionId: run.sessionId,
    status: run.status,
    rootTaskId: run.rootTaskId,
    stack: run.stack
      .map((id) => run.tasks[id])
      .filter(Boolean)
      .map((task) => ({
        id: task.id,
        parentId: task.parentId,
        depth: task.depth,
        title: task.title,
        status: task.status,
        step: task.step,
        maxSteps: task.maxSteps,
        workingDirectory: task.workingDirectory,
        createdAt: task.createdAt,
        startedAt: task.startedAt
      })),
    budget: {
      ...run.budget,
      remainingTasks: Math.max(0, run.budget.maxTasks - run.budget.createdTasks),
      remainingModelSteps: run.budget.maxModelSteps > 0
        ? Math.max(0, run.budget.maxModelSteps - run.budget.usedModelSteps)
        : null
    },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

export function validateTaskOutput(value, schema) {
  const errors = [];
  validateSchemaValue(value, schema || defaultTaskOutputSchema(), "$", errors, 0);
  return {
    valid: errors.length === 0,
    errors: errors.slice(0, 20)
  };
}

function removeStackTopTask(run, taskId, status) {
  assertTaskRun(run);
  const id = String(taskId || "");
  if (run.stack.at(-1) !== id) {
    throw new Error("Only the current stack-top task can leave the task stack.");
  }
  if (id === run.rootTaskId) {
    throw new Error("Use completeRootTask for the root task.");
  }
  const task = run.tasks[id];
  if (!task) throw new Error(`Task not found: ${id || "unknown"}`);
  task.status = status;
  task.completedAt = Date.now();
  run.stack.pop();
  delete run.tasks[id];
  run.completedTaskCount += 1;
  const parent = run.tasks[task.parentId];
  if (parent) parent.status = "running";
  run.updatedAt = Date.now();
  return task;
}

function normalizeTaskContext(value) {
  if (value === undefined || value === null || value === "") return {};
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("task context must be JSON serializable.");
  if (serialized.length > 30_000) throw new Error("task context is too large.");
  return JSON.parse(serialized);
}

function assertSupportedSchema(schema, path, depth) {
  if (depth > 8) throw new Error(`outputSchema exceeds maximum nesting depth at ${path}.`);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`outputSchema node must be an object at ${path}.`);
  }
  for (const unsupported of ["$ref", "$defs", "definitions", "oneOf", "anyOf", "allOf", "not"]) {
    if (Object.hasOwn(schema, unsupported)) {
      throw new Error(`outputSchema keyword ${unsupported} is not supported at ${path}.`);
    }
  }
  const supportedKeywords = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "const",
    "description",
    "title",
    "default",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum"
  ]);
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) {
      throw new Error(`outputSchema keyword ${keyword} is not supported at ${path}.`);
    }
  }
  const allowedTypes = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
  if (schema.type !== undefined && !allowedTypes.has(schema.type)) {
    throw new Error(`outputSchema type is invalid at ${path}.`);
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
      throw new Error(`outputSchema properties must be an object at ${path}.`);
    }
    for (const [name, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${path}.properties.${name}`, depth + 1);
    }
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new Error(`outputSchema required must be an array at ${path}.`);
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean" &&
    (!schema.additionalProperties || typeof schema.additionalProperties !== "object" || Array.isArray(schema.additionalProperties))
  ) {
    throw new Error(`outputSchema additionalProperties must be a boolean or Schema at ${path}.`);
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    assertSupportedSchema(schema.additionalProperties, `${path}.additionalProperties`, depth + 1);
  }
  if (schema.items !== undefined) assertSupportedSchema(schema.items, `${path}.items`, depth + 1);
}

function validateSchemaValue(value, schema, path, errors, depth) {
  if (errors.length >= 20 || depth > 16) return;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(item, value))) {
    errors.push({ path, message: `must equal one of ${JSON.stringify(schema.enum)}` });
    return;
  }
  if (Object.hasOwn(schema, "const") && !deepEqual(schema.const, value)) {
    errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    return;
  }
  const type = schema.type;
  if (type && !matchesType(value, type)) {
    errors.push({ path, message: `must be ${type}` });
    return;
  }
  if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, required)) {
        errors.push({ path: `${path}.${required}`, message: "is required" });
      }
    }
    for (const [name, item] of Object.entries(value)) {
      if (properties[name]) {
        validateSchemaValue(item, properties[name], `${path}.${name}`, errors, depth + 1);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${name}`, message: "is not allowed" });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateSchemaValue(item, schema.additionalProperties, `${path}.${name}`, errors, depth + 1);
      }
    }
  }
  if (type === "array" && Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      errors.push({ path, message: `must contain at least ${schema.minItems} items` });
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      errors.push({ path, message: `must contain at most ${schema.maxItems} items` });
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchemaValue(item, schema.items, `${path}[${index}]`, errors, depth + 1));
    }
  }
  if (type === "string" && typeof value === "string") {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
      errors.push({ path, message: `must contain at least ${schema.minLength} characters` });
    }
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      errors.push({ path, message: `must contain at most ${schema.maxLength} characters` });
    }
  }
  if ((type === "number" || type === "integer") && typeof value === "number") {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      errors.push({ path, message: `must be at least ${schema.minimum}` });
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      errors.push({ path, message: `must be at most ${schema.maximum}` });
    }
  }
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertTaskRun(run) {
  if (!run || typeof run !== "object" || !Array.isArray(run.stack) || !run.tasks) {
    throw new Error("Invalid task run.");
  }
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeTaskPath(value) {
  const path = String(value || "/workspace").trim();
  return path.startsWith("/") ? path : `/${path}`;
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
