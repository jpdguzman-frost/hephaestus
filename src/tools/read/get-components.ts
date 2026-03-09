/**
 * get_components handler — retrieves published components and component sets
 * from the current file via the Figma REST API.
 *
 * Supports filtering by name query and optionally including variant details.
 */

import type { z } from "zod";
import type { getComponentsSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import { getFileComponents, getFileComponentSets } from "../../rest-api/components.js";
import type { FigmaComponentEntry, FigmaComponentSetEntry } from "../../rest-api/components.js";
import { HephaestusError, figmaApiError, internalError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetComponentsParams = z.infer<typeof getComponentsSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get published components and component sets from the current file.
 */
export async function getComponents(
  params: GetComponentsParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { query, includeVariants = false, limit = 25 } = params;
  const { restApiClient, fileKey } = context;

  if (!fileKey) {
    throw figmaApiError("No file key available. The plugin must be connected to identify the current file.", {
      category: ErrorCategory.INVALID_OPERATION,
      suggestion: "Ensure the Figma plugin is running and connected to a file.",
    });
  }

  try {
    // Fetch components and optionally component sets in parallel
    const [componentsResponse, componentSetsResponse] = await Promise.all([
      getFileComponents(restApiClient, fileKey),
      includeVariants
        ? getFileComponentSets(restApiClient, fileKey)
        : Promise.resolve(null),
    ]);

    let components = componentsResponse.meta.components;

    // Filter by query if provided
    if (query) {
      const queryLower = query.toLowerCase();
      components = components.filter((c) =>
        c.name.toLowerCase().includes(queryLower),
      );
    }

    // Apply limit
    components = components.slice(0, limit);

    // Serialize components
    const serializedComponents = components.map((c) =>
      serializeComponent(c),
    );

    // Build result
    const result: Record<string, unknown> = {
      components: serializedComponents,
      count: serializedComponents.length,
    };

    // Include component sets (variants) if requested
    if (includeVariants && componentSetsResponse) {
      let componentSets = componentSetsResponse.meta.component_sets;

      if (query) {
        const queryLower = query.toLowerCase();
        componentSets = componentSets.filter((cs) =>
          cs.name.toLowerCase().includes(queryLower),
        );
      }

      componentSets = componentSets.slice(0, limit);

      result.componentSets = componentSets.map((cs) =>
        serializeComponentSet(cs, components),
      );
      result.componentSetCount = componentSets.length;
    }

    return result;
  } catch (err) {
    if (err instanceof HephaestusError) throw err;
    throw internalError(
      `Failed to fetch components: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ─── Serialization ──────────────────────────────────────────────────────────

function serializeComponent(
  component: FigmaComponentEntry,
): Record<string, unknown> {
  return {
    key: component.key,
    nodeId: component.node_id,
    name: component.name,
    description: component.description,
    containingFrame: component.containing_frame
      ? {
          nodeId: component.containing_frame.nodeId,
          name: component.containing_frame.name,
          pageName: component.containing_frame.pageName,
        }
      : undefined,
  };
}

function serializeComponentSet(
  componentSet: FigmaComponentSetEntry,
  allComponents: FigmaComponentEntry[],
): Record<string, unknown> {
  // Find variants belonging to this component set
  const variants = allComponents
    .filter((c) => {
      // Components in a set typically have the set's node_id as containing_frame
      // or share the same containing_frame nodeId
      return c.containing_frame?.nodeId === componentSet.node_id;
    })
    .map((c) => ({
      key: c.key,
      nodeId: c.node_id,
      name: c.name,
    }));

  return {
    key: componentSet.key,
    nodeId: componentSet.node_id,
    name: componentSet.name,
    description: componentSet.description,
    variants,
    containingFrame: componentSet.containing_frame
      ? {
          nodeId: componentSet.containing_frame.nodeId,
          name: componentSet.containing_frame.name,
          pageName: componentSet.containing_frame.pageName,
        }
      : undefined,
  };
}
