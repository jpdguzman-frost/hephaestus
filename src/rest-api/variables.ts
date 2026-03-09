/**
 * Figma REST API — Variable endpoints.
 *
 * Retrieves local and published variables and their collections from a file.
 */

import { FigmaClient } from "./client.js";

// ─── Response Types ─────────────────────────────────────────────────────────

/** Response from GET /files/:key/variables/local. */
export interface GetLocalVariablesResponse {
  error: boolean;
  status: number;
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}

/** Response from GET /files/:key/variables/published. */
export interface GetPublishedVariablesResponse {
  error: boolean;
  status: number;
  meta: {
    variables: Record<string, FigmaPublishedVariable>;
    variableCollections: Record<string, FigmaPublishedVariableCollection>;
  };
}

// ─── Figma Variable Types ───────────────────────────────────────────────────

/** A local variable definition. */
export interface FigmaVariable {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR";
  description: string;
  hiddenFromPublishing: boolean;
  scopes: string[];
  codeSyntax: Record<string, string>;
  valuesByMode: Record<string, FigmaVariableValue>;
}

/** A published variable definition. */
export interface FigmaPublishedVariable {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR";
  description: string;
  hiddenFromPublishing: boolean;
  scopes: string[];
  codeSyntax: Record<string, string>;
  /** Published variables include subscribed_id for library consumers. */
  subscribed_id?: string;
  /** Updated timestamp. */
  updated_at?: string;
}

/** Variable value — can be a primitive or a color or an alias. */
export type FigmaVariableValue =
  | boolean
  | number
  | string
  | FigmaVariableColor
  | FigmaVariableAlias;

/** RGBA color value for COLOR variables. */
export interface FigmaVariableColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Variable alias — references another variable. */
export interface FigmaVariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

/** A variable collection. */
export interface FigmaVariableCollection {
  id: string;
  name: string;
  key: string;
  modes: FigmaVariableMode[];
  defaultModeId: string;
  remote: boolean;
  hiddenFromPublishing: boolean;
  variableIds: string[];
}

/** A published variable collection. */
export interface FigmaPublishedVariableCollection {
  id: string;
  name: string;
  key: string;
  modes: FigmaVariableMode[];
  defaultModeId: string;
  remote: boolean;
  hiddenFromPublishing: boolean;
  /** Updated timestamp. */
  updated_at?: string;
  /** Subscribed ID for library consumers. */
  subscribed_id?: string;
}

/** A mode within a variable collection. */
export interface FigmaVariableMode {
  modeId: string;
  name: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Get all local variables and collections in a file.
 *
 * Returns every variable defined locally in the file, organized by collection.
 * Includes values for each mode.
 *
 * @see https://www.figma.com/developers/api#get-local-variables-endpoint
 */
export async function getLocalVariables(
  client: FigmaClient,
  fileKey: string,
): Promise<GetLocalVariablesResponse> {
  return client.get<GetLocalVariablesResponse>(`/files/${fileKey}/variables/local`);
}

/**
 * Get all published variables and collections in a file.
 *
 * Returns variables that have been published from this file for library consumption.
 *
 * @see https://www.figma.com/developers/api#get-published-variables-endpoint
 */
export async function getPublishedVariables(
  client: FigmaClient,
  fileKey: string,
): Promise<GetPublishedVariablesResponse> {
  return client.get<GetPublishedVariablesResponse>(`/files/${fileKey}/variables/published`);
}
