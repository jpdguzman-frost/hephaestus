// src/shared/types.ts
var CommandType = /* @__PURE__ */ ((CommandType2) => {
  CommandType2["CREATE_NODE"] = "CREATE_NODE";
  CommandType2["UPDATE_NODE"] = "UPDATE_NODE";
  CommandType2["DELETE_NODES"] = "DELETE_NODES";
  CommandType2["CLONE_NODE"] = "CLONE_NODE";
  CommandType2["REPARENT_NODE"] = "REPARENT_NODE";
  CommandType2["REORDER_CHILDREN"] = "REORDER_CHILDREN";
  CommandType2["SET_TEXT"] = "SET_TEXT";
  CommandType2["SET_FILLS"] = "SET_FILLS";
  CommandType2["SET_STROKES"] = "SET_STROKES";
  CommandType2["SET_EFFECTS"] = "SET_EFFECTS";
  CommandType2["SET_CORNER_RADIUS"] = "SET_CORNER_RADIUS";
  CommandType2["SET_AUTO_LAYOUT"] = "SET_AUTO_LAYOUT";
  CommandType2["SET_LAYOUT_CHILD"] = "SET_LAYOUT_CHILD";
  CommandType2["BATCH_SET_LAYOUT_CHILDREN"] = "BATCH_SET_LAYOUT_CHILDREN";
  CommandType2["SET_LAYOUT_GRID"] = "SET_LAYOUT_GRID";
  CommandType2["SET_CONSTRAINTS"] = "SET_CONSTRAINTS";
  CommandType2["INSTANTIATE_COMPONENT"] = "INSTANTIATE_COMPONENT";
  CommandType2["SET_INSTANCE_PROPERTIES"] = "SET_INSTANCE_PROPERTIES";
  CommandType2["CREATE_COMPONENT"] = "CREATE_COMPONENT";
  CommandType2["CREATE_COMPONENT_SET"] = "CREATE_COMPONENT_SET";
  CommandType2["ADD_COMPONENT_PROPERTY"] = "ADD_COMPONENT_PROPERTY";
  CommandType2["EDIT_COMPONENT_PROPERTY"] = "EDIT_COMPONENT_PROPERTY";
  CommandType2["DELETE_COMPONENT_PROPERTY"] = "DELETE_COMPONENT_PROPERTY";
  CommandType2["SET_DESCRIPTION"] = "SET_DESCRIPTION";
  CommandType2["CREATE_VARIABLE_COLLECTION"] = "CREATE_VARIABLE_COLLECTION";
  CommandType2["DELETE_VARIABLE_COLLECTION"] = "DELETE_VARIABLE_COLLECTION";
  CommandType2["CREATE_VARIABLES"] = "CREATE_VARIABLES";
  CommandType2["UPDATE_VARIABLES"] = "UPDATE_VARIABLES";
  CommandType2["DELETE_VARIABLE"] = "DELETE_VARIABLE";
  CommandType2["RENAME_VARIABLE"] = "RENAME_VARIABLE";
  CommandType2["ADD_MODE"] = "ADD_MODE";
  CommandType2["RENAME_MODE"] = "RENAME_MODE";
  CommandType2["SETUP_DESIGN_TOKENS"] = "SETUP_DESIGN_TOKENS";
  CommandType2["CREATE_PAGE"] = "CREATE_PAGE";
  CommandType2["RENAME_PAGE"] = "RENAME_PAGE";
  CommandType2["DELETE_PAGE"] = "DELETE_PAGE";
  CommandType2["SET_CURRENT_PAGE"] = "SET_CURRENT_PAGE";
  CommandType2["GET_NODE"] = "GET_NODE";
  CommandType2["GET_SELECTION"] = "GET_SELECTION";
  CommandType2["SEARCH_NODES"] = "SEARCH_NODES";
  CommandType2["SCREENSHOT"] = "SCREENSHOT";
  CommandType2["GET_STYLES"] = "GET_STYLES";
  CommandType2["GET_VARIABLES"] = "GET_VARIABLES";
  CommandType2["GET_COMPONENTS"] = "GET_COMPONENTS";
  CommandType2["EXECUTE"] = "EXECUTE";
  CommandType2["PING"] = "PING";
  return CommandType2;
})(CommandType || {});
var CommandStatus = /* @__PURE__ */ ((CommandStatus2) => {
  CommandStatus2["QUEUED"] = "QUEUED";
  CommandStatus2["SENT"] = "SENT";
  CommandStatus2["ACKNOWLEDGED"] = "ACKNOWLEDGED";
  CommandStatus2["COMPLETED"] = "COMPLETED";
  CommandStatus2["TIMEOUT"] = "TIMEOUT";
  CommandStatus2["RETRY"] = "RETRY";
  CommandStatus2["FAILED"] = "FAILED";
  CommandStatus2["EXPIRED"] = "EXPIRED";
  return CommandStatus2;
})(CommandStatus || {});
var ConnectionState = /* @__PURE__ */ ((ConnectionState2) => {
  ConnectionState2["WAITING"] = "WAITING";
  ConnectionState2["POLLING"] = "POLLING";
  ConnectionState2["CONNECTED"] = "CONNECTED";
  ConnectionState2["DEGRADED"] = "DEGRADED";
  return ConnectionState2;
})(ConnectionState || {});
var ErrorCategory = /* @__PURE__ */ ((ErrorCategory2) => {
  ErrorCategory2["CONNECTION_LOST"] = "CONNECTION_LOST";
  ErrorCategory2["PLUGIN_NOT_RUNNING"] = "PLUGIN_NOT_RUNNING";
  ErrorCategory2["COMMAND_TIMEOUT"] = "COMMAND_TIMEOUT";
  ErrorCategory2["NODE_NOT_FOUND"] = "NODE_NOT_FOUND";
  ErrorCategory2["INVALID_OPERATION"] = "INVALID_OPERATION";
  ErrorCategory2["FONT_NOT_LOADED"] = "FONT_NOT_LOADED";
  ErrorCategory2["READ_ONLY_PROPERTY"] = "READ_ONLY_PROPERTY";
  ErrorCategory2["INVALID_PARAMS"] = "INVALID_PARAMS";
  ErrorCategory2["SCHEMA_VIOLATION"] = "SCHEMA_VIOLATION";
  ErrorCategory2["INTERNAL_ERROR"] = "INTERNAL_ERROR";
  ErrorCategory2["SERIALIZATION_ERROR"] = "SERIALIZATION_ERROR";
  return ErrorCategory2;
})(ErrorCategory || {});
var NodeType = /* @__PURE__ */ ((NodeType2) => {
  NodeType2["FRAME"] = "FRAME";
  NodeType2["RECTANGLE"] = "RECTANGLE";
  NodeType2["ELLIPSE"] = "ELLIPSE";
  NodeType2["TEXT"] = "TEXT";
  NodeType2["LINE"] = "LINE";
  NodeType2["POLYGON"] = "POLYGON";
  NodeType2["STAR"] = "STAR";
  NodeType2["VECTOR"] = "VECTOR";
  NodeType2["SECTION"] = "SECTION";
  NodeType2["COMPONENT"] = "COMPONENT";
  NodeType2["COMPONENT_SET"] = "COMPONENT_SET";
  return NodeType2;
})(NodeType || {});
var BlendMode = /* @__PURE__ */ ((BlendMode2) => {
  BlendMode2["NORMAL"] = "NORMAL";
  BlendMode2["DARKEN"] = "DARKEN";
  BlendMode2["MULTIPLY"] = "MULTIPLY";
  BlendMode2["COLOR_BURN"] = "COLOR_BURN";
  BlendMode2["LIGHTEN"] = "LIGHTEN";
  BlendMode2["SCREEN"] = "SCREEN";
  BlendMode2["COLOR_DODGE"] = "COLOR_DODGE";
  BlendMode2["OVERLAY"] = "OVERLAY";
  BlendMode2["SOFT_LIGHT"] = "SOFT_LIGHT";
  BlendMode2["HARD_LIGHT"] = "HARD_LIGHT";
  BlendMode2["DIFFERENCE"] = "DIFFERENCE";
  BlendMode2["EXCLUSION"] = "EXCLUSION";
  BlendMode2["HUE"] = "HUE";
  BlendMode2["SATURATION"] = "SATURATION";
  BlendMode2["COLOR"] = "COLOR";
  BlendMode2["LUMINOSITY"] = "LUMINOSITY";
  return BlendMode2;
})(BlendMode || {});

// src/shared/errors.ts
var RexError = class extends Error {
  category;
  retryable;
  suggestion;
  commandId;
  nodeId;
  figmaError;
  constructor(options) {
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
  toResponse() {
    return {
      error: {
        category: this.category,
        message: this.message,
        ...this.commandId && { commandId: this.commandId },
        retryable: this.retryable,
        ...this.suggestion && { suggestion: this.suggestion },
        ...this.figmaError && { figmaError: this.figmaError },
        ...this.nodeId && { nodeId: this.nodeId }
      }
    };
  }
};
function connectionError(message, options) {
  return new RexError({
    category: options?.category ?? "CONNECTION_LOST" /* CONNECTION_LOST */,
    message,
    retryable: true,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "Check that the Figma plugin is running and connected.",
    cause: options?.cause
  });
}
function figmaApiError(message, options) {
  const category = options?.category ?? "INVALID_OPERATION" /* INVALID_OPERATION */;
  const retryable = options?.retryable ?? category === "FONT_NOT_LOADED" /* FONT_NOT_LOADED */;
  return new RexError({
    category,
    message,
    retryable,
    commandId: options?.commandId,
    nodeId: options?.nodeId,
    figmaError: options?.figmaError,
    suggestion: options?.suggestion,
    cause: options?.cause
  });
}
function validationError(message, options) {
  return new RexError({
    category: options?.category ?? "INVALID_PARAMS" /* INVALID_PARAMS */,
    message,
    retryable: false,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "Check the tool parameters and try again.",
    cause: options?.cause
  });
}
function internalError(message, options) {
  return new RexError({
    category: options?.category ?? "INTERNAL_ERROR" /* INTERNAL_ERROR */,
    message,
    retryable: false,
    commandId: options?.commandId,
    suggestion: options?.suggestion ?? "This is an internal error. Please report it.",
    cause: options?.cause
  });
}
function toRexError(err, commandId) {
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
        cause: err.cause
      });
    }
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return internalError(message, { commandId, cause: err });
}

export {
  CommandType,
  CommandStatus,
  ConnectionState,
  ErrorCategory,
  NodeType,
  BlendMode,
  RexError,
  connectionError,
  figmaApiError,
  validationError,
  internalError,
  toRexError
};
//# sourceMappingURL=chunk-ZSHX4C3A.js.map