/**
 * Figma REST API client — barrel export.
 *
 * Usage:
 *   import { FigmaClient, getFile, getFileComponents, getLocalVariables } from "./rest-api/index.js";
 *
 *   const client = new FigmaClient();
 *   const file = await getFile(client, "abc123");
 */

// Base client
export { FigmaClient } from "./client.js";
export type { FigmaClientOptions, RequestOptions } from "./client.js";

// File endpoints
export { getFile, getFileNodes, getFileVersions } from "./files.js";
export type {
  GetFileParams,
  GetFileNodesParams,
  GetFileResponse,
  GetFileNodesResponse,
  GetFileVersionsResponse,
  FileNodeResult,
  FigmaDocument,
  FigmaNode,
  FigmaComponentMeta,
  FigmaComponentSetMeta,
  FigmaStyleMeta,
  FigmaBranch,
  FigmaVersion,
} from "./files.js";

// Component endpoints
export { getFileComponents, getFileComponentSets } from "./components.js";
export type {
  GetFileComponentsResponse,
  GetFileComponentSetsResponse,
  FigmaComponentEntry,
  FigmaComponentSetEntry,
} from "./components.js";

// Variable endpoints
export { getLocalVariables, getPublishedVariables } from "./variables.js";
export type {
  GetLocalVariablesResponse,
  GetPublishedVariablesResponse,
  FigmaVariable,
  FigmaPublishedVariable,
  FigmaVariableValue,
  FigmaVariableColor,
  FigmaVariableAlias,
  FigmaVariableCollection,
  FigmaPublishedVariableCollection,
  FigmaVariableMode,
} from "./variables.js";

// Image endpoints
export { getImage } from "./images.js";
export type { GetImageParams, GetImageResponse } from "./images.js";

// Comment endpoints
export { getComments, postComment, deleteComment } from "./comments.js";
export type {
  GetCommentsResponse,
  PostCommentParams,
  PostCommentResponse,
  FigmaComment,
  FigmaCommentUser,
  FigmaClientMeta,
  FigmaFrameOffset,
  FigmaRegion,
  FigmaFrameOffsetRegion,
} from "./comments.js";
