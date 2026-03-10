/**
 * get_styles handler — retrieves all styles from the current file via the REST API.
 *
 * Uses the file endpoint to get style metadata and node data for resolved values.
 * Supports filtering by style type (fill, text, effect, grid).
 */

import type { z } from "zod";
import type { getStylesSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import { getFile } from "../../rest-api/files.js";
import type { FigmaStyleMeta } from "../../rest-api/files.js";
import { RexError, figmaApiError, internalError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetStylesParams = z.infer<typeof getStylesSchema>;

type StyleType = "fill" | "text" | "effect" | "grid";

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Figma Style Type Mapping ───────────────────────────────────────────────

/** Map Figma's styleType values to our filter types. */
const FIGMA_STYLE_TYPE_MAP: Record<string, StyleType> = {
  FILL: "fill",
  TEXT: "text",
  EFFECT: "effect",
  GRID: "grid",
};

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get all styles from the current file via the Figma REST API.
 */
export async function getStyles(
  params: GetStylesParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { types } = params;
  const { restApiClient, fileKey } = context;

  if (!fileKey) {
    throw figmaApiError("No file key available. The plugin must be connected to identify the current file.", {
      category: ErrorCategory.INVALID_OPERATION,
      suggestion: "Ensure the Figma plugin is running and connected to a file.",
    });
  }

  try {
    // Fetch the file — styles metadata is included in the file response
    const response = await getFile(restApiClient, fileKey, { depth: 1 });

    const styleEntries = Object.entries(response.styles);

    // Filter by type if specified
    const filteredStyles = styleEntries
      .filter(([_key, meta]) => {
        if (!types || types.length === 0) return true;
        const mappedType = FIGMA_STYLE_TYPE_MAP[meta.styleType];
        return mappedType !== undefined && types.includes(mappedType);
      })
      .map(([nodeId, meta]) => serializeStyle(nodeId, meta));

    return {
      styles: filteredStyles,
      count: filteredStyles.length,
    };
  } catch (err) {
    if (err instanceof RexError) throw err;
    throw internalError(
      `Failed to fetch styles: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ─── Serialization ──────────────────────────────────────────────────────────

function serializeStyle(
  nodeId: string,
  meta: FigmaStyleMeta,
): Record<string, unknown> {
  return {
    nodeId,
    key: meta.key,
    name: meta.name,
    styleType: FIGMA_STYLE_TYPE_MAP[meta.styleType] ?? meta.styleType,
    description: meta.description,
    remote: meta.remote,
  };
}
