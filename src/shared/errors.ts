import { ErrorCategory } from "./types.js";

// ─── Error Class ─────────────────────────────────────────────────────────────

/**
 * Structured error for all Rex operations.
 * Carries category, retryable flag, and optional suggestion for the AI client.
 */
export class RexError extends Error {
  public readonly category: ErrorCategory;
  public readonly retryable: boolean;
  public readonly suggestion?: string;
  public readonly commandId?: string;
  public readonly nodeId?: string;
  public readonly figmaError?: string;

  constructor(options: {
    category: ErrorCategory;
    message: string;
    retryable: boolean;
    suggestion?: string;
    commandId?: string;
    nodeId?: string;
    figmaError?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "RexError";
    this.category = options.category;
    this.retryable = options.retryable;
    this.suggestion = options.suggestion;
    this.commandId = options.commandId;
    this.nodeId = options.nodeId;
    this.figmaError = options.figmaError;
  }

  /**
   * Serialize to the error response format defined in SPEC.md section 5.2.
   */
  toResponse(): ErrorResponse {
    return {
      error: {
        category: this.category,
        message: this.message,
        ...(this.commandId && { commandId: this.commandId }),
        retryable: this.retryable,
        ...(this.suggestion && { suggestion: this.suggestion }),
        ...(this.figmaError && { figmaError: this.figmaError }),
        ...(this.nodeId && { nodeId: this.nodeId }),
      },
    };
  }
}

// ─── Error Response Type ─────────────────────────────────────────────────────

/** Serialized error response matching SPEC.md section 5.2. */
export interface ErrorResponse {
  error: {
    category: ErrorCategory;
    message: string;
    commandId?: string;
    retryable: boolean;
    suggestion?: string;
    figmaError?: string;
    nodeId?: string;
  };
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/** Create a connection-related error (transient, auto-retry). */
export function connectionError(
  message: string,
  options?: {
    category?: ErrorCategory.CONNECTION_LOST | ErrorCategory.PLUGIN_NOT_RUNNING | ErrorCategory.COMMAND_TIMEOUT;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
  },
): RexError {
  return new RexError({
    category: options?.category ?? ErrorCategory.CONNECTION_LOST,
    message,
    retryable: true,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "Check that the Figma plugin is running and connected.",
    cause: options?.cause,
  });
}

/** Create a Figma API error (may or may not be retryable). */
export function figmaApiError(
  message: string,
  options?: {
    category?:
      | ErrorCategory.NODE_NOT_FOUND
      | ErrorCategory.INVALID_OPERATION
      | ErrorCategory.FONT_NOT_LOADED
      | ErrorCategory.READ_ONLY_PROPERTY;
    retryable?: boolean;
    commandId?: string;
    nodeId?: string;
    figmaError?: string;
    suggestion?: string;
    cause?: unknown;
  },
): RexError {
  const category = options?.category ?? ErrorCategory.INVALID_OPERATION;
  const retryable = options?.retryable ?? category === ErrorCategory.FONT_NOT_LOADED;

  return new RexError({
    category,
    message,
    retryable,
    commandId: options?.commandId,
    nodeId: options?.nodeId,
    figmaError: options?.figmaError,
    suggestion: options?.suggestion,
    cause: options?.cause,
  });
}

/** Create a validation error (never retryable, fix input). */
export function validationError(
  message: string,
  options?: {
    category?: ErrorCategory.INVALID_PARAMS | ErrorCategory.SCHEMA_VIOLATION;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
  },
): RexError {
  return new RexError({
    category: options?.category ?? ErrorCategory.INVALID_PARAMS,
    message,
    retryable: false,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "Check the tool parameters and try again.",
    cause: options?.cause,
  });
}

/** Create an internal error (bug in Rex, never retryable). */
export function internalError(
  message: string,
  options?: {
    category?: ErrorCategory.INTERNAL_ERROR | ErrorCategory.SERIALIZATION_ERROR;
    commandId?: string;
    suggestion?: string;
    cause?: unknown;
  },
): RexError {
  return new RexError({
    category: options?.category ?? ErrorCategory.INTERNAL_ERROR,
    message,
    retryable: false,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "This is an internal error. Please report it.",
    cause: options?.cause,
  });
}

/**
 * Convert any unknown error into a RexError.
 * Preserves RexError instances, wraps everything else.
 */
export function toRexError(err: unknown, commandId?: string): RexError {
  if (err instanceof RexError) {
    if (commandId && !err.commandId) {
      return new RexError({
        category: err.category,
        message: err.message,
        retryable: err.retryable,
        suggestion: err.suggestion,
        commandId,
        nodeId: err.nodeId,
        figmaError: err.figmaError,
        cause: err.cause,
      });
    }
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  return internalError(message, { commandId, cause: err });
}
