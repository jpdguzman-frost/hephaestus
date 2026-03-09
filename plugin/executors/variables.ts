// ─── Variable Executors ─────────────────────────────────────────────────────
// CREATE_VARIABLE_COLLECTION, DELETE_VARIABLE_COLLECTION, CREATE_VARIABLES,
// UPDATE_VARIABLES, DELETE_VARIABLE, RENAME_VARIABLE, ADD_MODE, RENAME_MODE,
// SETUP_DESIGN_TOKENS

import { hexToColor } from "../serializer";

/**
 * Create a new variable collection.
 */
export async function executeCreateVariableCollection(payload: Record<string, unknown>): Promise<unknown> {
  const collection = figma.variables.createVariableCollection(payload.name as string);

  // Rename the default mode
  if (payload.initialModeName) {
    collection.renameMode(collection.modes[0].modeId, payload.initialModeName as string);
  }

  // Add additional modes
  if (payload.additionalModes) {
    for (const modeName of payload.additionalModes as string[]) {
      collection.addMode(modeName);
    }
  }

  return {
    collectionId: collection.id,
    name: collection.name,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
  };
}

/**
 * Delete a variable collection and all its variables.
 */
export async function executeDeleteVariableCollection(payload: Record<string, unknown>): Promise<unknown> {
  const collectionId = payload.collectionId as string;
  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection ${collectionId} not found`);

  collection.remove();
  return { deleted: collectionId };
}

/**
 * Create one or more variables in a collection.
 */
export async function executeCreateVariables(payload: Record<string, unknown>): Promise<unknown> {
  const collectionId = payload.collectionId as string;
  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection ${collectionId} not found`);

  const variables = payload.variables as Array<{
    name: string;
    resolvedType: string;
    description?: string;
    valuesByMode?: Record<string, unknown>;
  }>;

  const created: Array<{ variableId: string; name: string }> = [];

  for (const varDef of variables) {
    const variable = figma.variables.createVariable(
      varDef.name,
      collection,
      varDef.resolvedType as VariableResolvedDataType
    );

    if (varDef.description) {
      variable.description = varDef.description;
    }

    // Set values by mode
    if (varDef.valuesByMode) {
      for (const [modeKey, value] of Object.entries(varDef.valuesByMode)) {
        // modeKey could be a mode ID or mode name
        const mode = collection.modes.find(m => m.modeId === modeKey || m.name === modeKey);
        if (mode) {
          const resolved = resolveVariableValue(varDef.resolvedType, value);
          variable.setValueForMode(mode.modeId, resolved);
        }
      }
    }

    created.push({ variableId: variable.id, name: variable.name });
  }

  return { created };
}

/**
 * Update variable values.
 */
export async function executeUpdateVariables(payload: Record<string, unknown>): Promise<unknown> {
  const updates = payload.updates as Array<{
    variableId: string;
    modeId: string;
    value: unknown;
  }>;

  const results: Array<{ variableId: string; updated: boolean }> = [];

  for (const update of updates) {
    const variable = figma.variables.getVariableById(update.variableId);
    if (!variable) {
      results.push({ variableId: update.variableId, updated: false });
      continue;
    }

    const resolved = resolveVariableValue(variable.resolvedType, update.value);
    variable.setValueForMode(update.modeId, resolved);
    results.push({ variableId: update.variableId, updated: true });
  }

  return { results };
}

/**
 * Delete a single variable.
 */
export async function executeDeleteVariable(payload: Record<string, unknown>): Promise<unknown> {
  const variableId = payload.variableId as string;
  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable ${variableId} not found`);

  variable.remove();
  return { deleted: variableId };
}

/**
 * Rename a variable.
 */
export async function executeRenameVariable(payload: Record<string, unknown>): Promise<unknown> {
  const variableId = payload.variableId as string;
  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable ${variableId} not found`);

  variable.name = payload.newName as string;
  return { variableId, name: variable.name };
}

/**
 * Add a mode to a collection.
 */
export async function executeAddMode(payload: Record<string, unknown>): Promise<unknown> {
  const collectionId = payload.collectionId as string;
  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection ${collectionId} not found`);

  collection.addMode(payload.modeName as string);

  return {
    collectionId,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
  };
}

/**
 * Rename an existing mode.
 */
export async function executeRenameMode(payload: Record<string, unknown>): Promise<unknown> {
  const collectionId = payload.collectionId as string;
  const collection = figma.variables.getVariableCollectionById(collectionId);
  if (!collection) throw new Error(`Variable collection ${collectionId} not found`);

  collection.renameMode(payload.modeId as string, payload.newName as string);

  return {
    collectionId,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
  };
}

/**
 * Create a complete token system in one atomic operation.
 * Creates collection + modes + variables with values.
 */
export async function executeSetupDesignTokens(payload: Record<string, unknown>): Promise<unknown> {
  const collectionName = payload.collectionName as string;
  const modeNames = payload.modes as string[];
  const tokens = payload.tokens as Array<{
    name: string;
    resolvedType: string;
    description?: string;
    values: Record<string, unknown>;
  }>;

  // Create collection
  const collection = figma.variables.createVariableCollection(collectionName);

  // Rename default mode to first mode name
  collection.renameMode(collection.modes[0].modeId, modeNames[0]);

  // Add additional modes
  for (let i = 1; i < modeNames.length; i++) {
    collection.addMode(modeNames[i]);
  }

  // Build mode name-to-id mapping
  const modeMap = new Map<string, string>();
  for (const mode of collection.modes) {
    modeMap.set(mode.name, mode.modeId);
  }

  // Create variables with values
  const created: Array<{ variableId: string; name: string }> = [];

  for (const tokenDef of tokens) {
    const variable = figma.variables.createVariable(
      tokenDef.name,
      collection,
      tokenDef.resolvedType as VariableResolvedDataType
    );

    if (tokenDef.description) {
      variable.description = tokenDef.description;
    }

    // Set values for each mode (keyed by mode NAME)
    for (const [modeName, value] of Object.entries(tokenDef.values)) {
      const modeId = modeMap.get(modeName);
      if (modeId) {
        const resolved = resolveVariableValue(tokenDef.resolvedType, value);
        variable.setValueForMode(modeId, resolved);
      }
    }

    created.push({ variableId: variable.id, name: variable.name });
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    modes: collection.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    variables: created,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveVariableValue(resolvedType: string, value: unknown): VariableValue {
  switch (resolvedType) {
    case "COLOR": {
      if (typeof value === "string") {
        const { color, opacity } = hexToColor(value);
        return { r: color.r, g: color.g, b: color.b, a: opacity };
      }
      return value as RGBA;
    }
    case "FLOAT":
      return typeof value === "number" ? value : parseFloat(value as string);
    case "STRING":
      return String(value);
    case "BOOLEAN":
      return Boolean(value);
    default:
      return value as VariableValue;
  }
}
