/**
 * get_page handler — retrieves page structure and metadata via the REST API.
 *
 * Supports verbosity filtering to control the amount of detail returned:
 *   - "summary" (default): node ID, name, type, position, size only
 *   - "standard": summary + fills, strokes, effects, auto-layout
 *   - "full": all available properties
 */

import type { z } from "zod";
import type { getPageSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import { getFile, getFileNodes } from "../../rest-api/files.js";
import type { FigmaNode } from "../../rest-api/files.js";
import { HephaestusError, figmaApiError, internalError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetPageParams = z.infer<typeof getPageSchema>;

type Verbosity = "summary" | "standard" | "full";

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Verbosity Filtering ────────────────────────────────────────────────────

/**
 * Serialize a Figma node to the canonical shape with verbosity filtering.
 */
function serializeNode(
  node: FigmaNode,
  depth: number,
  verbosity: Verbosity,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Always include core identification
  result.nodeId = node.id;
  result.name = node.name;
  result.type = node.type;
  result.visible = node.visible ?? true;
  result.locked = node.locked ?? false;

  if (node.absoluteBoundingBox) {
    result.position = {
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y,
    };
    result.size = {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  if (verbosity === "summary") {
    // Children only (no extra properties)
    if (depth > 0 && node.children) {
      result.children = node.children.map((child) =>
        serializeNode(child, depth - 1, verbosity),
      );
    }
    return result;
  }

  // Standard and full: include visual properties
  if (node.opacity !== undefined) result.opacity = node.opacity;
  if (node.fills && (node.fills as unknown[]).length > 0) result.fills = node.fills;
  if (node.strokes && (node.strokes as unknown[]).length > 0) result.strokes = node.strokes;
  if (node.effects && (node.effects as unknown[]).length > 0) result.effects = node.effects;
  if (node.blendMode) result.blendMode = node.blendMode;

  if (node.cornerRadius !== undefined) {
    result.cornerRadius = node.cornerRadius;
  } else if (node.rectangleCornerRadii) {
    result.cornerRadius = {
      topLeft: node.rectangleCornerRadii[0],
      topRight: node.rectangleCornerRadii[1],
      bottomRight: node.rectangleCornerRadii[2],
      bottomLeft: node.rectangleCornerRadii[3],
    };
  }

  if (node.layoutMode && node.layoutMode !== "NONE") {
    result.autoLayout = {
      direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
      spacing: node.itemSpacing ?? 0,
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
      primaryAxisAlign: node.primaryAxisAlignItems ?? "MIN",
      counterAxisAlign: node.counterAxisAlignItems ?? "MIN",
      primaryAxisSizing: node.primaryAxisSizingMode === "FIXED" ? "fixed" : "hug",
      counterAxisSizing: node.counterAxisSizingMode === "FIXED" ? "fixed" : "hug",
    };
  }

  if (node.constraints) result.constraints = node.constraints;
  if (node.characters !== undefined) result.characters = node.characters;

  // Full verbosity: include everything else
  if (verbosity === "full") {
    if (node.style) result.textStyle = node.style;
    if (node.componentId) result.componentKey = node.componentId;
    if (node.componentProperties) result.componentProperties = node.componentProperties;
    if (node.clipsContent !== undefined) result.clipsContent = node.clipsContent;
  }

  // Recurse into children
  if (depth > 0 && node.children) {
    result.children = node.children.map((child) =>
      serializeNode(child, depth - 1, verbosity),
    );
  }

  return result;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get page structure and metadata via the Figma REST API.
 */
export async function getPage(
  params: GetPageParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { pageId, depth = 1, verbosity = "summary" } = params;
  const { restApiClient, fileKey } = context;

  if (!fileKey) {
    throw figmaApiError("No file key available. The plugin must be connected to identify the current file.", {
      category: ErrorCategory.INVALID_OPERATION,
      suggestion: "Ensure the Figma plugin is running and connected to a file.",
    });
  }

  try {
    if (pageId) {
      // Fetch specific page by ID
      const response = await getFileNodes(restApiClient, fileKey, [pageId], {
        depth,
      });

      const nodeResult = response.nodes[pageId];
      if (!nodeResult) {
        throw figmaApiError(`Page not found: ${pageId}`, {
          category: ErrorCategory.NODE_NOT_FOUND,
          suggestion: "Use get_page without a pageId to see all pages, then use the correct page ID.",
        });
      }

      return serializeNode(nodeResult.document, depth, verbosity);
    }

    // No pageId — fetch entire file at the requested depth to get page list
    // Use depth 1 at file level to get pages + their immediate children
    const response = await getFile(restApiClient, fileKey, {
      depth: depth + 1, // +1 because document root is depth 0, pages are depth 1
    });

    const document = response.document;
    const pages = document.children.map((page) =>
      serializeNode(page, depth, verbosity),
    );

    return {
      nodeId: document.id,
      name: document.name,
      type: "DOCUMENT",
      pages,
    };
  } catch (err) {
    if (err instanceof HephaestusError) throw err;
    throw internalError(
      `Failed to fetch page data: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
