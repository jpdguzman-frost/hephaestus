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
import { RexError, figmaApiError, internalError } from "../../shared/errors.js";
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
  };

  // Omit defaults: visible=true, locked=false
  if (node.visible === false) base.visible = false;
  if (node.locked === true) base.locked = true;

  // Position and size from absoluteBoundingBox
  if (node.absoluteBoundingBox) {
    const bb = node.absoluteBoundingBox;
    base.position = {
      x: Math.round(bb.x),
      y: Math.round(bb.y),
    };
    base.size = {
      width: Math.round(bb.width),
      height: Math.round(bb.height),
    };
  }

  // Optional properties — include all if no filter is specified
  const includeAll = !properties || properties.length === 0;

  // Opacity — omit if 1
  if (includeAll || properties?.includes("opacity")) {
    if (node.opacity !== undefined && node.opacity !== 1) base.opacity = node.opacity;
  }

  // Fills — omit if empty
  if (includeAll || properties?.includes("fills")) {
    if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) base.fills = node.fills;
  }

  // Strokes — omit if empty
  if (includeAll || properties?.includes("strokes")) {
    if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) base.strokes = node.strokes;
  }

  // Effects — omit if empty
  if (includeAll || properties?.includes("effects")) {
    if (node.effects && Array.isArray(node.effects) && node.effects.length > 0) base.effects = node.effects;
  }

  // Corner radius — omit if 0
  if (includeAll || properties?.includes("cornerRadius")) {
    if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
      base.cornerRadius = node.cornerRadius;
    } else if (node.rectangleCornerRadii) {
      const [tl, tr, br, bl] = node.rectangleCornerRadii;
      if (tl !== 0 || tr !== 0 || br !== 0 || bl !== 0) {
        if (tl === tr && tr === br && br === bl) {
          base.cornerRadius = tl;
        } else {
          base.cornerRadius = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
        }
      }
    }
  }

  // Auto-layout — omit if NONE
  if (includeAll || properties?.includes("autoLayout")) {
    if (node.layoutMode && node.layoutMode !== "NONE") {
      const pt = node.paddingTop ?? 0, pr = node.paddingRight ?? 0;
      const pb = node.paddingBottom ?? 0, pl = node.paddingLeft ?? 0;
      const padding = (pt === pr && pr === pb && pb === pl)
        ? pt
        : { top: pt, right: pr, bottom: pb, left: pl };

      base.autoLayout = {
        direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
        spacing: node.itemSpacing ?? 0,
        padding,
        primaryAxisAlign: node.primaryAxisAlignItems ?? "MIN",
        counterAxisAlign: node.counterAxisAlignItems ?? "MIN",
        primaryAxisSizing: node.primaryAxisSizingMode === "FIXED" ? "fixed" : "hug",
        counterAxisSizing: node.counterAxisSizingMode === "FIXED" ? "fixed" : "hug",
      };
    }
  }

  // Constraints — omit if default
  if (includeAll || properties?.includes("constraints")) {
    if (node.constraints) {
      const { horizontal, vertical } = node.constraints;
      if (!(horizontal === "SCALE" && vertical === "SCALE") &&
          !(horizontal === "MIN" && vertical === "MIN")) {
        base.constraints = node.constraints;
      }
    }
  }

  // Blend mode — omit if NORMAL or PASS_THROUGH
  if (includeAll || properties?.includes("blendMode")) {
    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      base.blendMode = node.blendMode;
    }
  }

  // Text — always meaningful
  if (includeAll || properties?.includes("characters")) {
    if (node.characters !== undefined) base.characters = node.characters;
  }

  if (includeAll || properties?.includes("textStyle")) {
    if (node.style) base.textStyle = node.style;
  }

  if (includeAll || properties?.includes("componentProperties")) {
    if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
      base.componentProperties = node.componentProperties;
    }
  }

  if (includeAll || properties?.includes("componentId")) {
    if (node.componentId) base.componentKey = node.componentId;
  }

  // Recurse into children if depth > 0, cap at 100
  if (depth > 0 && node.children) {
    const maxChildren = 100;
    const childSlice = node.children.length > maxChildren
      ? node.children.slice(0, maxChildren)
      : node.children;
    base.children = childSlice.map((child) =>
      serializeNode(child, depth - 1, properties),
    );
    if (node.children.length > maxChildren) {
      base._childrenTruncated = true;
      base._totalChildren = node.children.length;
    }
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
    if (err instanceof RexError) throw err;
    throw internalError(
      `Failed to fetch node data: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
