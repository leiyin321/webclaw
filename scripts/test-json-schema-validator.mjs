import assert from "node:assert/strict";
import { validateJsonSchema } from "../src/json-schema-validator.js";

const schema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["read", "write"] },
    count: { type: "integer", minimum: 1, maximum: 3 },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { name: { type: "string", minLength: 2 } },
        required: ["name"],
        additionalProperties: false
      }
    }
  },
  required: ["action", "items"],
  additionalProperties: false
};

assert.deepEqual(validateJsonSchema({ action: "read", count: 2, items: [{ name: "ok" }] }, schema), []);
const errors = validateJsonSchema({ action: "bad", count: 4, items: [{ name: "", extra: true }], extra: true }, schema);
assert.ok(errors.some((error) => error.includes("args.action")));
assert.ok(errors.some((error) => error.includes("args.count")));
assert.ok(errors.some((error) => error.includes("args.items[0].name")));
assert.ok(errors.some((error) => error.includes("args.items[0].extra")));
assert.ok(errors.some((error) => error.includes("args.extra")));

console.log("JSON Schema validator tests passed.");
