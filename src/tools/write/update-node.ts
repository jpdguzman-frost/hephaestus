/**
 * update_node and batch_update_nodes handlers.
 *
 * Single update sends an UPDATE_NODE command.
 * Batch update sends all updates with the same batchId and atomic: true.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type { updateNodeSchema, batchUpdateNodesSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
type BatchUpdateNodesInput = z.infer<typeof batchUpdateNodesSchema>;

/**
 * Build the payload for an UPDATE_NODE command from validated params.
 */
function buildUpdatePayload(params: UpdateNodeInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nodeId: params.nodeId,
  };

  if (params.name !== undefined) payload.name = params.name;
  if (params.position !== undefined) payload.position = params.position;
  if (params.size !== undefined) payload.size = params.size;
  if (params.fills !== undefined) payload.fills = params.fills;
  if (params.strokes !== undefined) payload.strokes = params.strokes;
  if (params.strokeWeight !== undefined) payload.strokeWeight = params.strokeWeight;
  if (params.effects !== undefined) payload.effects = params.effects;
  if (params.cornerRadius !== undefined) payload.cornerRadius = params.cornerRadius;
  if (params.opacity !== undefined) payload.opacity = params.opacity;
  if (params.visible !== undefined) payload.visible = params.visible;
  if (params.locked !== undefined) payload.locked = params.locked;
  if (params.blendMode !== undefined) payload.blendMode = params.blendMode;
  if (params.clipsContent !== undefined) payload.clipsContent = params.clipsContent;
  if (params.autoLayout !== undefined) payload.autoLayout = params.autoLayout;
  if (params.layoutGrids !== undefined) payload.layoutGrids = params.layoutGrids;
  if (params.constraints !== undefined) payload.constraints = params.constraints;
  if (params.layoutChild !== undefined) payload.layoutChild = params.layoutChild;

  return payload;
}

/**
 * Handler for the update_node tool.
 *
 * Updates one or more properties on an existing node.
 */
export async function updateNode(
  params: UpdateNodeInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type: CommandType.UPDATE_NODE,
    payload: buildUpdatePayload(params),
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `update_node_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "UPDATE_NODE command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId ?? params.nodeId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toRexError(err, commandId);
  }
}

/**
 * Handler for the batch_update_nodes tool.
 *
 * Sends all updates with the same batchId for atomic execution.
 * If any update fails, all are rolled back by the plugin.
 */
export async function batchUpdateNodes(
  params: BatchUpdateNodesInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const batchId = randomUUID();
  const batchTotal = params.updates.length;

  const promises: Promise<CommandResult>[] = params.updates.map(
    (update, index) => {
      const commandId = randomUUID();

      const command: Command = {
        id: commandId,
        type: CommandType.UPDATE_NODE,
        payload: buildUpdatePayload(update),
        timestamp: Date.now(),
        ttl: context.config.commands.defaultTtl,
        idempotencyKey: `batch_update_${batchId}_${index}`,
        atomic: true,
        batchId,
        batchSeq: index,
        batchTotal,
      };

      return context.commandQueue.enqueue(command);
    },
  );

  try {
    const results = await Promise.all(promises);

    // Check for any failures
    const errors = results.filter((r) => r.status === "error");
    if (errors.length > 0) {
      const firstError = errors[0]!.error;
      throw new RexError({
        category: firstError?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: `Batch update failed: ${errors.length}/${batchTotal} operations failed. First error: ${firstError?.message ?? "Unknown"}`,
        retryable: firstError?.retryable ?? false,
        nodeId: firstError?.nodeId,
        figmaError: firstError?.figmaError,
        suggestion: firstError?.suggestion,
      });
    }

    return {
      batchId,
      updates: results.map((r) => r.result ?? {}),
    };
  } catch (err) {
    throw toRexError(err);
  }
}
