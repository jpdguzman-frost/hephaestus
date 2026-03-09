import { describe, it, expect } from "vitest";
import {
  HephaestusError,
  connectionError,
  figmaApiError,
  validationError,
  internalError,
  toHephaestusError,
} from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── HephaestusError Class ──────────────────────────────────────────────────

describe("HephaestusError", () => {
  it("extends Error", () => {
    const err = new HephaestusError({
      category: ErrorCategory.INTERNAL_ERROR,
      message: "test error",
      retryable: false,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HephaestusError);
  });

  it("has name set to 'HephaestusError'", () => {
    const err = new HephaestusError({
      category: ErrorCategory.INTERNAL_ERROR,
      message: "test",
      retryable: false,
    });
    expect(err.name).toBe("HephaestusError");
  });

  it("stores all provided fields", () => {
    const err = new HephaestusError({
      category: ErrorCategory.NODE_NOT_FOUND,
      message: "Node not found",
      retryable: false,
      suggestion: "Check the node ID",
      commandId: "cmd-123",
      nodeId: "456:789",
      figmaError: "Cannot find node",
    });

    expect(err.category).toBe(ErrorCategory.NODE_NOT_FOUND);
    expect(err.message).toBe("Node not found");
    expect(err.retryable).toBe(false);
    expect(err.suggestion).toBe("Check the node ID");
    expect(err.commandId).toBe("cmd-123");
    expect(err.nodeId).toBe("456:789");
    expect(err.figmaError).toBe("Cannot find node");
  });

  it("supports cause chain", () => {
    const cause = new Error("root cause");
    const err = new HephaestusError({
      category: ErrorCategory.INTERNAL_ERROR,
      message: "wrapper",
      retryable: false,
      cause,
    });
    expect(err.cause).toBe(cause);
  });
});

// ─── Error Serialization ────────────────────────────────────────────────────

describe("HephaestusError.toResponse()", () => {
  it("serializes to the SPEC.md section 5.2 format", () => {
    const err = new HephaestusError({
      category: ErrorCategory.NODE_NOT_FOUND,
      message: "Node 123:456 not found",
      retryable: false,
      suggestion: "Verify the node exists.",
      commandId: "cmd-001",
    });

    const response = err.toResponse();

    expect(response).toEqual({
      error: {
        category: "NODE_NOT_FOUND",
        message: "Node 123:456 not found",
        commandId: "cmd-001",
        retryable: false,
        suggestion: "Verify the node exists.",
      },
    });
  });

  it("omits optional fields when not set", () => {
    const err = new HephaestusError({
      category: ErrorCategory.INTERNAL_ERROR,
      message: "Something broke",
      retryable: false,
    });

    const response = err.toResponse();

    expect(response.error.commandId).toBeUndefined();
    expect(response.error.suggestion).toBeUndefined();
    expect(response.error.figmaError).toBeUndefined();
    expect(response.error.nodeId).toBeUndefined();
    // These should NOT be keys in the serialized object
    expect("commandId" in response.error).toBe(false);
    expect("suggestion" in response.error).toBe(false);
    expect("figmaError" in response.error).toBe(false);
    expect("nodeId" in response.error).toBe(false);
  });

  it("includes figmaError and nodeId when set", () => {
    const err = new HephaestusError({
      category: ErrorCategory.INVALID_OPERATION,
      message: "Cannot resize",
      retryable: false,
      figmaError: "Figma internal: resize not supported",
      nodeId: "999:1",
    });

    const response = err.toResponse();
    expect(response.error.figmaError).toBe("Figma internal: resize not supported");
    expect(response.error.nodeId).toBe("999:1");
  });

  it("always includes category, message, and retryable", () => {
    const err = new HephaestusError({
      category: ErrorCategory.COMMAND_TIMEOUT,
      message: "Timed out",
      retryable: true,
    });

    const response = err.toResponse();
    expect(response.error.category).toBe("COMMAND_TIMEOUT");
    expect(response.error.message).toBe("Timed out");
    expect(response.error.retryable).toBe(true);
  });
});

// ─── Factory: connectionError ───────────────────────────────────────────────

describe("connectionError factory", () => {
  it("produces CONNECTION_LOST category by default", () => {
    const err = connectionError("Connection lost");
    expect(err.category).toBe(ErrorCategory.CONNECTION_LOST);
  });

  it("is always retryable", () => {
    const err = connectionError("Connection lost");
    expect(err.retryable).toBe(true);
  });

  it("has a default suggestion", () => {
    const err = connectionError("Connection lost");
    expect(err.suggestion).toBeDefined();
    expect(err.suggestion).toContain("plugin");
  });

  it("allows overriding category to PLUGIN_NOT_RUNNING", () => {
    const err = connectionError("Plugin not running", {
      category: ErrorCategory.PLUGIN_NOT_RUNNING,
    });
    expect(err.category).toBe(ErrorCategory.PLUGIN_NOT_RUNNING);
  });

  it("allows overriding category to COMMAND_TIMEOUT", () => {
    const err = connectionError("Command timed out", {
      category: ErrorCategory.COMMAND_TIMEOUT,
    });
    expect(err.category).toBe(ErrorCategory.COMMAND_TIMEOUT);
  });

  it("stores commandId when provided", () => {
    const err = connectionError("Lost", { commandId: "cmd-999" });
    expect(err.commandId).toBe("cmd-999");
  });

  it("allows custom suggestion", () => {
    const err = connectionError("Lost", { suggestion: "Restart the plugin." });
    expect(err.suggestion).toBe("Restart the plugin.");
  });
});

// ─── Factory: figmaApiError ─────────────────────────────────────────────────

describe("figmaApiError factory", () => {
  it("produces INVALID_OPERATION category by default", () => {
    const err = figmaApiError("Cannot perform this operation");
    expect(err.category).toBe(ErrorCategory.INVALID_OPERATION);
  });

  it("is not retryable by default for INVALID_OPERATION", () => {
    const err = figmaApiError("Cannot perform this operation");
    expect(err.retryable).toBe(false);
  });

  it("is retryable by default for FONT_NOT_LOADED", () => {
    const err = figmaApiError("Font not loaded", {
      category: ErrorCategory.FONT_NOT_LOADED,
    });
    expect(err.retryable).toBe(true);
  });

  it("allows explicit retryable override", () => {
    const err = figmaApiError("Temporary issue", { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it("stores nodeId and figmaError", () => {
    const err = figmaApiError("Node issue", {
      nodeId: "123:456",
      figmaError: "Figma API: node locked",
    });
    expect(err.nodeId).toBe("123:456");
    expect(err.figmaError).toBe("Figma API: node locked");
  });

  it("allows NODE_NOT_FOUND category", () => {
    const err = figmaApiError("Not found", {
      category: ErrorCategory.NODE_NOT_FOUND,
    });
    expect(err.category).toBe(ErrorCategory.NODE_NOT_FOUND);
  });

  it("allows READ_ONLY_PROPERTY category", () => {
    const err = figmaApiError("Read only", {
      category: ErrorCategory.READ_ONLY_PROPERTY,
    });
    expect(err.category).toBe(ErrorCategory.READ_ONLY_PROPERTY);
  });
});

// ─── Factory: validationError ───────────────────────────────────────────────

describe("validationError factory", () => {
  it("produces INVALID_PARAMS category by default", () => {
    const err = validationError("Missing required field");
    expect(err.category).toBe(ErrorCategory.INVALID_PARAMS);
  });

  it("is never retryable", () => {
    const err = validationError("Bad input");
    expect(err.retryable).toBe(false);
  });

  it("has a default suggestion about checking parameters", () => {
    const err = validationError("Bad input");
    expect(err.suggestion).toBeDefined();
    expect(err.suggestion).toContain("parameters");
  });

  it("allows SCHEMA_VIOLATION category", () => {
    const err = validationError("Schema mismatch", {
      category: ErrorCategory.SCHEMA_VIOLATION,
    });
    expect(err.category).toBe(ErrorCategory.SCHEMA_VIOLATION);
  });

  it("stores commandId when provided", () => {
    const err = validationError("Bad", { commandId: "cmd-123" });
    expect(err.commandId).toBe("cmd-123");
  });
});

// ─── Factory: internalError ─────────────────────────────────────────────────

describe("internalError factory", () => {
  it("produces INTERNAL_ERROR category by default", () => {
    const err = internalError("Something went wrong");
    expect(err.category).toBe(ErrorCategory.INTERNAL_ERROR);
  });

  it("is never retryable", () => {
    const err = internalError("Bug");
    expect(err.retryable).toBe(false);
  });

  it("has a default suggestion about reporting", () => {
    const err = internalError("Bug");
    expect(err.suggestion).toBeDefined();
    expect(err.suggestion).toContain("internal error");
  });

  it("allows SERIALIZATION_ERROR category", () => {
    const err = internalError("Serialization failed", {
      category: ErrorCategory.SERIALIZATION_ERROR,
    });
    expect(err.category).toBe(ErrorCategory.SERIALIZATION_ERROR);
  });
});

// ─── toHephaestusError ──────────────────────────────────────────────────────

describe("toHephaestusError", () => {
  it("returns HephaestusError instances unchanged", () => {
    const original = validationError("test");
    const result = toHephaestusError(original);
    expect(result).toBe(original);
  });

  it("attaches commandId to HephaestusError if not already set", () => {
    const original = validationError("test");
    const result = toHephaestusError(original, "cmd-new");
    expect(result.commandId).toBe("cmd-new");
    // Should be a new instance since commandId was added
    expect(result).not.toBe(original);
  });

  it("preserves existing commandId on HephaestusError", () => {
    const original = validationError("test", { commandId: "cmd-existing" });
    const result = toHephaestusError(original, "cmd-new");
    expect(result.commandId).toBe("cmd-existing");
    expect(result).toBe(original);
  });

  it("wraps plain Error as internalError", () => {
    const plainError = new Error("plain error");
    const result = toHephaestusError(plainError);

    expect(result).toBeInstanceOf(HephaestusError);
    expect(result.category).toBe(ErrorCategory.INTERNAL_ERROR);
    expect(result.message).toBe("plain error");
    expect(result.retryable).toBe(false);
    expect(result.cause).toBe(plainError);
  });

  it("wraps string errors", () => {
    const result = toHephaestusError("something broke");
    expect(result).toBeInstanceOf(HephaestusError);
    expect(result.message).toBe("something broke");
  });

  it("wraps non-Error objects", () => {
    const result = toHephaestusError({ code: 500 });
    expect(result).toBeInstanceOf(HephaestusError);
    expect(result.category).toBe(ErrorCategory.INTERNAL_ERROR);
  });

  it("attaches commandId to wrapped errors", () => {
    const result = toHephaestusError(new Error("oops"), "cmd-456");
    expect(result.commandId).toBe("cmd-456");
  });
});
