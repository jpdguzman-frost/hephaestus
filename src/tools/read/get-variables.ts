/**
 * get_variables handler — retrieves variables and collections from the current
 * file via the Figma REST API.
 *
 * Supports filtering by collection name, variable name pattern, and resolved type.
 * When resolveAliases is true, walks alias chains to resolve final values.
 */

import type { z } from "zod";
import type { getVariablesSchema } from "../schemas.js";
import type { FigmaClient } from "../../rest-api/client.js";
import type { CommandQueue } from "../../relay/command-queue.js";
import type { Config } from "../../shared/config.js";
import { getLocalVariables } from "../../rest-api/variables.js";
import type {
  FigmaVariable,
  FigmaVariableAlias,
  FigmaVariableCollection,
  FigmaVariableColor,
  FigmaVariableValue,
} from "../../rest-api/variables.js";
import { HephaestusError, figmaApiError, internalError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GetVariablesParams = z.infer<typeof getVariablesSchema>;

export interface HandlerContext {
  restApiClient: FigmaClient;
  commandQueue: CommandQueue;
  config: Config;
  fileKey: string;
}

// ─── Alias Resolution ───────────────────────────────────────────────────────

/** Check if a variable value is an alias reference. */
function isAlias(value: FigmaVariableValue): value is FigmaVariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as FigmaVariableAlias).type === "VARIABLE_ALIAS"
  );
}

/** Check if a variable value is a color. */
function isColor(value: FigmaVariableValue): value is FigmaVariableColor {
  return (
    typeof value === "object" &&
    value !== null &&
    "r" in value &&
    "g" in value &&
    "b" in value &&
    "a" in value
  );
}

/**
 * Resolve an alias chain to its final concrete value.
 * Guards against circular references with a max depth.
 */
function resolveAlias(
  value: FigmaVariableValue,
  modeId: string,
  variables: Record<string, FigmaVariable>,
  maxDepth = 10,
): FigmaVariableValue {
  let current = value;
  let depth = 0;

  while (isAlias(current) && depth < maxDepth) {
    const referenced = variables[current.id];
    if (!referenced) {
      // Referenced variable not found — return the alias as-is
      return current;
    }
    const modeValue = referenced.valuesByMode[modeId];
    if (modeValue === undefined) {
      // Mode not found on referenced variable — try default mode
      const firstModeId = Object.keys(referenced.valuesByMode)[0];
      if (firstModeId) {
        current = referenced.valuesByMode[firstModeId];
      } else {
        return current;
      }
    } else {
      current = modeValue;
    }
    depth++;
  }

  return current;
}

/**
 * Convert a Figma RGBA color to a hex string.
 */
function colorToHex(color: FigmaVariableColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);

  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  if (a < 255) {
    return `${hex}${a.toString(16).padStart(2, "0")}`.toUpperCase();
  }
  return hex.toUpperCase();
}

/**
 * Serialize a variable value into a human-readable form.
 */
function serializeValue(value: FigmaVariableValue): unknown {
  if (isAlias(value)) {
    return { alias: value.id };
  }
  if (isColor(value)) {
    return colorToHex(value);
  }
  return value;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Get variables and collections from the current file via the Figma REST API.
 */
export async function getVariables(
  params: GetVariablesParams,
  context: HandlerContext,
): Promise<Record<string, unknown>> {
  const { collection, namePattern, resolvedType, resolveAliases = false } = params;
  const { restApiClient, fileKey } = context;

  if (!fileKey) {
    throw figmaApiError("No file key available. The plugin must be connected to identify the current file.", {
      category: ErrorCategory.INVALID_OPERATION,
      suggestion: "Ensure the Figma plugin is running and connected to a file.",
    });
  }

  try {
    const response = await getLocalVariables(restApiClient, fileKey);
    const allVariables = response.meta.variables;
    const allCollections = response.meta.variableCollections;

    // Build name regex if pattern is provided
    let nameRegex: RegExp | null = null;
    if (namePattern) {
      try {
        nameRegex = new RegExp(namePattern, "i");
      } catch {
        throw figmaApiError(`Invalid name pattern regex: ${namePattern}`, {
          category: ErrorCategory.INVALID_OPERATION,
          suggestion: "Provide a valid JavaScript regular expression for namePattern.",
        });
      }
    }

    // Filter collections by name substring
    const filteredCollections = Object.values(allCollections).filter((col) => {
      if (!collection) return true;
      return col.name.toLowerCase().includes(collection.toLowerCase());
    });

    // Build result: collections with their variables
    const result = filteredCollections.map((col) => {
      return serializeCollection(
        col,
        allVariables,
        { nameRegex, resolvedType, resolveAliases },
      );
    });

    return {
      collections: result,
      count: result.reduce((sum, c) => sum + ((c.variables as unknown[])?.length ?? 0), 0),
    };
  } catch (err) {
    if (err instanceof HephaestusError) throw err;
    throw internalError(
      `Failed to fetch variables: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ─── Serialization ──────────────────────────────────────────────────────────

function serializeCollection(
  collection: FigmaVariableCollection,
  allVariables: Record<string, FigmaVariable>,
  filters: {
    nameRegex: RegExp | null;
    resolvedType?: string;
    resolveAliases: boolean;
  },
): Record<string, unknown> {
  // Get variables belonging to this collection
  const collectionVariables = collection.variableIds
    .map((id) => allVariables[id])
    .filter((v): v is FigmaVariable => v !== undefined)
    .filter((v) => {
      if (filters.nameRegex && !filters.nameRegex.test(v.name)) return false;
      if (filters.resolvedType && v.resolvedType !== filters.resolvedType) return false;
      return true;
    });

  // Serialize each variable
  const serializedVariables = collectionVariables.map((variable) => {
    const valuesByMode: Record<string, unknown> = {};

    for (const mode of collection.modes) {
      let value = variable.valuesByMode[mode.modeId];
      if (value === undefined) continue;

      if (filters.resolveAliases && isAlias(value)) {
        value = resolveAlias(value, mode.modeId, allVariables);
      }

      valuesByMode[mode.name] = serializeValue(value);
    }

    return {
      id: variable.id,
      name: variable.name,
      key: variable.key,
      resolvedType: variable.resolvedType,
      description: variable.description,
      valuesByMode,
      scopes: variable.scopes,
    };
  });

  return {
    id: collection.id,
    name: collection.name,
    key: collection.key,
    modes: collection.modes.map((m) => ({ id: m.modeId, name: m.name })),
    defaultModeId: collection.defaultModeId,
    variables: serializedVariables,
  };
}
