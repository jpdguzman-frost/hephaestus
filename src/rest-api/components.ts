/**
 * Figma REST API — Component endpoints.
 *
 * Retrieves component and component set metadata from a file.
 */

import { FigmaClient } from "./client.js";

// ─── Response Types ─────────────────────────────────────────────────────────

/** Response from GET /files/:key/components. */
export interface GetFileComponentsResponse {
  error: boolean;
  status: number;
  meta: {
    components: FigmaComponentEntry[];
  };
}

/** Response from GET /files/:key/component_sets. */
export interface GetFileComponentSetsResponse {
  error: boolean;
  status: number;
  meta: {
    component_sets: FigmaComponentSetEntry[];
  };
}

/** Individual component entry returned by the components endpoint. */
export interface FigmaComponentEntry {
  key: string;
  file_key: string;
  node_id: string;
  thumbnail_url: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  containing_frame?: {
    nodeId: string;
    name: string;
    backgroundColor?: string;
    pageName: string;
    pageId: string;
  };
  user: {
    id: string;
    handle: string;
    img_url: string;
  };
}

/** Individual component set entry returned by the component_sets endpoint. */
export interface FigmaComponentSetEntry {
  key: string;
  file_key: string;
  node_id: string;
  thumbnail_url: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  containing_frame?: {
    nodeId: string;
    name: string;
    backgroundColor?: string;
    pageName: string;
    pageId: string;
  };
  user: {
    id: string;
    handle: string;
    img_url: string;
  };
}

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Get all published components in a file.
 *
 * Returns metadata for every component published from this file,
 * including keys, names, descriptions, and thumbnail URLs.
 *
 * @see https://www.figma.com/developers/api#get-file-components-endpoint
 */
export async function getFileComponents(
  client: FigmaClient,
  fileKey: string,
): Promise<GetFileComponentsResponse> {
  return client.get<GetFileComponentsResponse>(`/files/${fileKey}/components`);
}

/**
 * Get all published component sets (variant groups) in a file.
 *
 * @see https://www.figma.com/developers/api#get-file-component-sets-endpoint
 */
export async function getFileComponentSets(
  client: FigmaClient,
  fileKey: string,
): Promise<GetFileComponentSetsResponse> {
  return client.get<GetFileComponentSetsResponse>(`/files/${fileKey}/component_sets`);
}
