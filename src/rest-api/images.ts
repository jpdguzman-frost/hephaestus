/**
 * Figma REST API — Image export endpoint.
 *
 * Renders nodes as images (PNG, JPG, SVG, PDF) via the Figma REST API.
 */

import { FigmaClient } from "./client.js";

// ─── Request Parameter Types ────────────────────────────────────────────────

/** Parameters for getImage(). */
export interface GetImageParams {
  /** Image scale factor (0.01 to 4). Default: 1. */
  scale?: number;
  /** Image output format. Default: "png". */
  format?: "jpg" | "png" | "svg" | "pdf";
  /** SVG only: include the id attribute on SVG elements. */
  svg_include_id?: boolean;
  /** SVG only: simplify stroke/fill to a single opacity attribute. */
  svg_simplify_stroke?: boolean;
  /** SVG only: include node id as outline class. */
  svg_outline_text?: boolean;
  /** Use absolute bounds for rendering (includes strokes, shadows). */
  use_absolute_bounds?: boolean;
  /** Specific version to render from. */
  version?: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────

/** Response from GET /images/:key. */
export interface GetImageResponse {
  err: string | null;
  /** Map of node ID to image URL (temporary, expires after ~14 days). */
  images: Record<string, string | null>;
}

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Render nodes as images and get temporary URLs to the rendered images.
 *
 * The returned URLs are temporary and typically expire after ~14 days.
 * Multiple node IDs can be rendered in a single request.
 *
 * @param client  - Figma API client
 * @param fileKey - File key
 * @param nodeIds - Node IDs to render
 * @param params  - Image export parameters (scale, format, etc.)
 *
 * @see https://www.figma.com/developers/api#get-images-endpoint
 */
export async function getImage(
  client: FigmaClient,
  fileKey: string,
  nodeIds: string[],
  params?: GetImageParams,
): Promise<GetImageResponse> {
  const queryParams: Record<string, string | number | boolean | string[]> = {
    ids: nodeIds,
  };

  if (params?.scale !== undefined) queryParams["scale"] = params.scale;
  if (params?.format) queryParams["format"] = params.format;
  if (params?.svg_include_id !== undefined) queryParams["svg_include_id"] = params.svg_include_id;
  if (params?.svg_simplify_stroke !== undefined) queryParams["svg_simplify_stroke"] = params.svg_simplify_stroke;
  if (params?.svg_outline_text !== undefined) queryParams["svg_outline_text"] = params.svg_outline_text;
  if (params?.use_absolute_bounds !== undefined) queryParams["use_absolute_bounds"] = params.use_absolute_bounds;
  if (params?.version) queryParams["version"] = params.version;

  // Image rendering can take time; don't cache with default TTL since
  // node content may change frequently during design sessions.
  return client.get<GetImageResponse>(`/images/${fileKey}`, {
    params: queryParams,
    cacheTtlMs: 10_000,
  });
}
