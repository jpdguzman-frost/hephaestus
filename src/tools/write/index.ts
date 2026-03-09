/**
 * Write tool handlers — barrel export.
 *
 * All write operations that modify the Figma document,
 * either via plugin commands or the REST API.
 */

// Types
export type { WriteHandlerContext } from "./types.js";

// Node operations
export { createNode } from "./create-node.js";
export { updateNode, batchUpdateNodes } from "./update-node.js";
export { deleteNodes } from "./delete-node.js";
export { cloneNode } from "./clone-node.js";
export { reparentNode } from "./reparent-node.js";
export { reorderChildren } from "./reorder-children.js";

// Text
export { setText } from "./set-text.js";

// Visual properties
export { setFills } from "./set-fills.js";
export { setStrokes } from "./set-strokes.js";
export { setEffects } from "./set-effects.js";
export { setCornerRadius } from "./set-corner-radius.js";

// Comments (REST API)
export { postComment, deleteComment } from "./comments.js";

// Utility
export { execute, batchExecute } from "./execute.js";

// Pages
export { createPage, renamePage, deletePage, setCurrentPage } from "./pages.js";
