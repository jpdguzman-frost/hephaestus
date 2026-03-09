import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import {
  setInstancePropertiesSchema,
  addComponentPropertySchema,
  editComponentPropertySchema,
  deleteComponentPropertySchema,
  setDescriptionSchema,
} from "../schemas.js";
import type { ToolContext } from "./instantiate.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function executeCommand(
  commandType: CommandType,
  payload: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const commandId = uuid();

  const command: Command = {
    id: commandId,
    type: commandType,
    payload,
    timestamp: Date.now(),
    ttl: ctx.config.defaultTtl,
  };

  try {
    const result: CommandResult = await ctx.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error!.category,
        message: result.error!.message,
        retryable: result.error!.retryable,
        commandId,
        nodeId: result.error!.nodeId,
        figmaError: result.error!.figmaError,
        suggestion: result.error!.suggestion,
      });
    }

    return result.result ?? { success: true };
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * set_instance_properties — Update properties on a component instance.
 */
export async function setInstanceProperties(
  params: z.infer<typeof setInstancePropertiesSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.SET_INSTANCE_PROPERTIES,
    {
      nodeId: params.nodeId,
      properties: params.properties,
      ...(params.resetOverrides !== undefined && { resetOverrides: params.resetOverrides }),
    },
    ctx,
  );
}

/**
 * add_component_property — Add a property to a component or component set.
 */
export async function addComponentProperty(
  params: z.infer<typeof addComponentPropertySchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.ADD_COMPONENT_PROPERTY,
    {
      nodeId: params.nodeId,
      name: params.name,
      type: params.type,
      defaultValue: params.defaultValue,
    },
    ctx,
  );
}

/**
 * edit_component_property — Modify an existing component property.
 */
export async function editComponentProperty(
  params: z.infer<typeof editComponentPropertySchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.EDIT_COMPONENT_PROPERTY,
    {
      nodeId: params.nodeId,
      propertyName: params.propertyName,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.defaultValue !== undefined && { defaultValue: params.defaultValue }),
    },
    ctx,
  );
}

/**
 * delete_component_property — Remove a property from a component.
 */
export async function deleteComponentProperty(
  params: z.infer<typeof deleteComponentPropertySchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.DELETE_COMPONENT_PROPERTY,
    {
      nodeId: params.nodeId,
      propertyName: params.propertyName,
    },
    ctx,
  );
}

/**
 * set_description — Set description text on a component, component set, or style.
 */
export async function setDescription(
  params: z.infer<typeof setDescriptionSchema>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  return executeCommand(
    CommandType.SET_DESCRIPTION,
    {
      nodeId: params.nodeId,
      description: params.description,
    },
    ctx,
  );
}
