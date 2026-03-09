/**
 * get_node handler — retrieves detailed data for one or more nodes via the REST API.
 *
 * Uses the Figma REST API `/files/:key/nodes` endpoint to fetch node data
 * without requiring the plugin to be connected.
 */

import type { z } from "zod";
import type { getNodeSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import { getFileNodes } from "../../rest-api/files.js";
import type { FigmaNode } from "../../rest-api/files.js";
import { HephaestusError, figmaApiError, internalError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetNodeParams = z.infer<typeof getNodeSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Serialization Helpers ──────────────────────────────────────────────────

/**
 * Convert a Figma REST API node into the canonical serialized shape,
 * optionally filtering to specific properties and limiting child depth.
 */
function serializeNode(
  node: FigmaNode,
  depth: number,
  properties?: string[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    nodeId: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible ?? true,
    locked: node.locked ?? false,
  };

  // Position and size from absoluteBoundingBox
  if (node.absoluteBoundingBox) {
    base.position = {
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y,
    };
    base.size = {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  // Optional properties — include all if no filter is specified
  const includeAll = !properties || properties.length === 0;

  if (includeAll || properties?.includes("opacity")) {
    if (node.opacity !== undefined) base.opacity = node.opacity;
  }

  if (includeAll || properties?.includes("fills")) {
    if (node.fills) base.fills = node.fills;
  }

  if (includeAll || properties?.includes("strokes")) {
    if (node.strokes) base.strokes = node.strokes;
  }

  if (includeAll || properties?.includes("effects")) {
    if (node.effects) base.effects = node.effects;
  }

  if (includeAll || properties?.includes("cornerRadius")) {
    if (node.cornerRadius !== undefined) {
      base.cornerRadius = node.cornerRadius;
    } else if (node.rectangleCornerRadii) {
      base.cornerRadius = {
        topLeft: node.rectangleCornerRadii[0],
        topRight: node.rectangleCornerRadii[1],
        bottomRight: node.rectangleCornerRadii[2],
        bottomLeft: node.rectangleCornerRadii[3],
      };
    }
  }

  if (includeAll || properties?.includes("autoLayout")) {
    if (node.layoutMode && node.layoutMode !== "NONE") {
      base.autoLayout = {
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
  }

  if (includeAll || properties?.includes("constraints")) {
    if (node.constraints) base.constraints = node.constraints;
  }

  if (includeAll || properties?.includes("blendMode")) {
    if (node.blendMode) base.blendMode = node.blendMode;
  }

  if (includeAll || properties?.includes("characters")) {
    if (node.characters !== undefined) base.characters = node.characters;
  }

  if (includeAll || properties?.includes("textStyle")) {
    if (node.style) base.textStyle = node.style;
  }

  if (includeAll || properties?.includes("componentProperties")) {
    if (node.componentProperties) base.componentProperties = node.componentProperties;
  }

  if (includeAll || properties?.includes("componentId")) {
    if (node.componentId) base.componentKey = node.componentId;
  }

  // Recurse into children if depth > 0
  if (depth > 0 && node.children) {
    base.children = node.children.map((child) =>
      serializeNode(child, depth - 1, properties),
    );
  }

  return base;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get detailed data for one or more nodes via the Figma REST API.
 */
export async function getNode(
  params: GetNodeParams,
  context: HandlerContext,
): Promise<Record<string, unknown>[]> {
  const { nodeIds, depth = 1, properties } = params;
  const { restApiClient, fileKey } = context;

  if (!fileKey) {
    throw figmaApiError("No file key available. The plugin must be connected to identify the current file.", {
      category: ErrorCategory.INVALID_OPERATION,
      suggestion: "Ensure the Figma plugin is running and connected to a file.",
    });
  }

  try {
    const response = await getFileNodes(restApiClient, fileKey, nodeIds, {
      depth,
    });

    const results: Record<string, unknown>[] = [];
    const notFound: string[] = [];

    for (const nodeId of nodeIds) {
      const nodeResult = response.nodes[nodeId];
      if (!nodeResult) {
        notFound.push(nodeId);
        continue;
      }
      results.push(serializeNode(nodeResult.document, depth, properties));
    }

    if (notFound.length > 0 && results.length === 0) {
      throw figmaApiError(
        `Node(s) not found: ${notFound.join(", ")}`,
        {
          category: ErrorCategory.NODE_NOT_FOUND,
          suggestion: "Verify the node IDs are correct. Use search_nodes or get_selection to find valid node IDs.",
        },
      );
    }

    return results;
  } catch (err) {
    if (err instanceof HephaestusError) throw err;
    throw internalError(
      `Failed to fetch node data: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
