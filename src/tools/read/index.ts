/**
 * Read tool handlers — barrel export.
 *
 * All read operations for the Rex MCP server.
 * REST API handlers use the FigmaClient directly; plugin handlers
 * send commands via the CommandQueue.
 */

export { getNode } from "./get-node.js";
export { getSelection } from "./get-selection.js";
export { getPage } from "./get-page.js";
export { searchNodes } from "./search.js";
export { screenshot } from "./screenshot.js";
export { getStyles } from "./get-styles.js";
export { getVariables } from "./get-variables.js";
export { getComponents } from "./get-components.js";

// Re-export the shared handler context type
export type { HandlerContext } from "./get-node.js";
