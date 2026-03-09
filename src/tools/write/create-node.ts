/**
 * create_node handler — Creates a single node or composite node tree.
 *
 * Translates createNode params into a CREATE_NODE command, handling
 * recursive children arrays as part of an atomic tree creation.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import { ErrorCategory } from "../../shared/types.js";
import type { CreateNodeInput } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

/**
 * Build the node tree payload for CREATE_NODE, flattening children
 * into the payload structure that the plugin expects.
 */
function buildNodePayload(params: CreateNodeInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: params.type,
  };

  if (params.parentId !== undefined) payload.parentId = params.parentId;
  if (params.name !== undefined) payload.name = params.name;
  if (params.position !== undefined) payload.position = params.position;
  if (params.size !== undefined) payload.size = params.size;
  if (params.fills !== undefined) payload.fills = params.fills;
  if (params.strokes !== undefined) payload.strokes = params.strokes;
  if (params.strokeWeight !== undefined) payload.strokeWeight = params.strokeWeight;
  if (params.effects !== undefined) payload.effects = params.effects;
  if (params.cornerRadius !== undefined) payload.cornerRadius = params.cornerRadius;
  if (params.opacity !== undefined) payload.opacity = params.opacity;
  if (params.autoLayout !== undefined) payload.autoLayout = params.autoLayout;
  if (params.layoutGrids !== undefined) payload.layoutGrids = params.layoutGrids;
  if (params.constraints !== undefined) payload.constraints = params.constraints;
  if (params.text !== undefined) payload.text = params.text;
  if (params.textStyle !== undefined) payload.textStyle = params.textStyle;
  if (params.layoutChild !== undefined) payload.layoutChild = params.layoutChild;

  // Recursively build children payloads
  if (params.children && params.children.length > 0) {
    payload.children = params.children.map(buildNodePayload);
  }

  return payload;
}

/**
 * Handler for the create_node tool.
 *
 * Creates a node (optionally with a recursive children tree) by sending
 * a CREATE_NODE command to the plugin via the relay command queue.
 */
export async function createNode(
  params: CreateNodeInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();
  const hasChildren = params.children && params.children.length > 0;

  const payload = buildNodePayload(params);

  const command: Command = {
    id: commandId,
    type: CommandType.CREATE_NODE,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `create_node_${commandId}`,
    // Composite trees are atomic
    ...(hasChildren && { atomic: true }),
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "CREATE_NODE command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? { nodeId: null };
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
