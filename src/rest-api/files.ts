/**
 * Figma REST API — File data endpoints.
 *
 * Provides access to file structure, specific nodes, and version history
 * without requiring the plugin to be connected.
 */

import { FigmaClient } from "./client.js";

// ─── Request Parameter Types ────────────────────────────────────────────────

/** Parameters for getFile(). */
export interface GetFileParams {
  /** Specific version to fetch (version ID string). */
  version?: string;
  /** Comma-separated list of node IDs to include. If omitted, returns entire file. */
  ids?: string[];
  /** Traversal depth for the document tree (default: full). */
  depth?: number;
  /** Geometry data: "paths" to include vector path data. */
  geometry?: "paths";
  /** Exclude plugin data to reduce response size. */
  plugin_data?: string;
  /** Branch data: include branch metadata. */
  branch_data?: boolean;
}

/** Parameters for getFileNodes(). */
export interface GetFileNodesParams {
  /** Specific version to fetch. */
  version?: string;
  /** Traversal depth within each returned node subtree. */
  depth?: number;
  /** Geometry data: "paths" to include vector path data. */
  geometry?: "paths";
  /** Plugin data to include. */
  plugin_data?: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────

/** Top-level response from GET /files/:key. */
export interface GetFileResponse {
  name: string;
  role: string;
  lastModified: string;
  editorType: string;
  thumbnailUrl: string;
  version: string;
  document: FigmaDocument;
  components: Record<string, FigmaComponentMeta>;
  componentSets: Record<string, FigmaComponentSetMeta>;
  schemaVersion: number;
  styles: Record<string, FigmaStyleMeta>;
  mainFileKey?: string;
  branches?: FigmaBranch[];
}

/** Top-level response from GET /files/:key/nodes. */
export interface GetFileNodesResponse {
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  role: string;
  err?: string;
  nodes: Record<string, FileNodeResult | null>;
}

/** Individual node result within GetFileNodesResponse. */
export interface FileNodeResult {
  document: FigmaNode;
  components: Record<string, FigmaComponentMeta>;
  componentSets: Record<string, FigmaComponentSetMeta>;
  schemaVersion: number;
  styles: Record<string, FigmaStyleMeta>;
}

/** Response from GET /files/:key/versions. */
export interface GetFileVersionsResponse {
  versions: FigmaVersion[];
  pagination: {
    prev_page?: string;
    next_page?: string;
  };
}

// ─── Figma Data Types ───────────────────────────────────────────────────────

/** Figma document root node. */
export interface FigmaDocument {
  id: string;
  name: string;
  type: string;
  children: FigmaNode[];
}

/** Generic Figma node (loosely typed — Figma returns many node types). */
export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number } | null;
  fills?: unknown[];
  strokes?: unknown[];
  effects?: unknown[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  opacity?: number;
  blendMode?: string;
  constraints?: { horizontal: string; vertical: string };
  clipsContent?: boolean;
  layoutMode?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  characters?: string;
  style?: Record<string, unknown>;
  componentId?: string;
  componentProperties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Component metadata from file response. */
export interface FigmaComponentMeta {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks?: { uri: string }[];
}

/** Component set metadata from file response. */
export interface FigmaComponentSetMeta {
  key: string;
  name: string;
  description: string;
  documentationLinks?: { uri: string }[];
}

/** Style metadata from file response. */
export interface FigmaStyleMeta {
  key: string;
  name: string;
  styleType: string;
  remote: boolean;
  description: string;
}

/** Branch metadata. */
export interface FigmaBranch {
  key: string;
  name: string;
  thumbnail_url: string;
  last_modified: string;
  link_access: string;
}

/** File version entry. */
export interface FigmaVersion {
  id: string;
  created_at: string;
  label: string;
  description: string;
  user: {
    id: string;
    handle: string;
    img_url: string;
  };
  thumbnail_url?: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Get a complete Figma file's document tree.
 *
 * @see https://www.figma.com/developers/api#get-files-endpoint
 */
export async function getFile(
  client: FigmaClient,
  fileKey: string,
  params?: GetFileParams,
): Promise<GetFileResponse> {
  const queryParams: Record<string, string | number | boolean | string[]> = {};

  if (params?.version) queryParams["version"] = params.version;
  if (params?.ids) queryParams["ids"] = params.ids;
  if (params?.depth !== undefined) queryParams["depth"] = params.depth;
  if (params?.geometry) queryParams["geometry"] = params.geometry;
  if (params?.plugin_data) queryParams["plugin_data"] = params.plugin_data;
  if (params?.branch_data) queryParams["branch_data"] = params.branch_data;

  return client.get<GetFileResponse>(`/files/${fileKey}`, { params: queryParams });
}

/**
 * Get specific nodes from a Figma file by their IDs.
 * More efficient than getFile when you only need a few nodes.
 *
 * @see https://www.figma.com/developers/api#get-file-nodes-endpoint
 */
export async function getFileNodes(
  client: FigmaClient,
  fileKey: string,
  nodeIds: string[],
  params?: GetFileNodesParams,
): Promise<GetFileNodesResponse> {
  const queryParams: Record<string, string | number | boolean | string[]> = {
    ids: nodeIds,
  };

  if (params?.version) queryParams["version"] = params.version;
  if (params?.depth !== undefined) queryParams["depth"] = params.depth;
  if (params?.geometry) queryParams["geometry"] = params.geometry;
  if (params?.plugin_data) queryParams["plugin_data"] = params.plugin_data;

  return client.get<GetFileNodesResponse>(`/files/${fileKey}/nodes`, { params: queryParams });
}

/**
 * Get version history for a Figma file.
 *
 * @see https://www.figma.com/developers/api#get-file-versions-endpoint
 */
export async function getFileVersions(
  client: FigmaClient,
  fileKey: string,
): Promise<GetFileVersionsResponse> {
  return client.get<GetFileVersionsResponse>(`/files/${fileKey}/versions`);
}
