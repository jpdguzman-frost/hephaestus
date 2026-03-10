/**
 * Page management handlers — createPage, renamePage, deletePage, setCurrentPage.
 *
 * All page operations go through the plugin command queue since they
 * require plugin-context access to the Figma document.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { RexError, toRexError } from "../../shared/errors.js";
import type { z } from "zod";
import type {
  createPageSchema,
  renamePageSchema,
  deletePageSchema,
  setCurrentPageSchema,
} from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type CreatePageInput = z.infer<typeof createPageSchema>;
type RenamePageInput = z.infer<typeof renamePageSchema>;
type DeletePageInput = z.infer<typeof deletePageSchema>;
type SetCurrentPageInput = z.infer<typeof setCurrentPageSchema>;

/**
 * Helper to create, enqueue, and handle a page command.
 */
async function sendPageCommand(
  type: CommandType,
  payload: Record<string, unknown>,
  context: WriteHandlerContext,
  errorLabel: string,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const command: Command = {
    id: commandId,
    type,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `${type.toLowerCase()}_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new RexError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? `${errorLabel} command failed`,
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId,
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
 * Handler for the create_page tool.
 *
 * Creates a new page in the Figma document.
 */
export async function createPage(
  params: CreatePageInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { name: params.name };
  if (params.index !== undefined) payload.index = params.index;

  return sendPageCommand(
    CommandType.CREATE_PAGE,
    payload,
    context,
    "CREATE_PAGE",
  );
}

/**
 * Handler for the rename_page tool.
 *
 * Renames an existing page.
 */
export async function renamePage(
  params: RenamePageInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  return sendPageCommand(
    CommandType.RENAME_PAGE,
    { pageId: params.pageId, name: params.name },
    context,
    "RENAME_PAGE",
  );
}

/**
 * Handler for the delete_page tool.
 *
 * Deletes a page and all its contents.
 */
export async function deletePage(
  params: DeletePageInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  return sendPageCommand(
    CommandType.DELETE_PAGE,
    { pageId: params.pageId },
    context,
    "DELETE_PAGE",
  );
}

/**
 * Handler for the set_current_page tool.
 *
 * Switches the active page in Figma.
 */
export async function setCurrentPage(
  params: SetCurrentPageInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  return sendPageCommand(
    CommandType.SET_CURRENT_PAGE,
    { pageId: params.pageId },
    context,
    "SET_CURRENT_PAGE",
  );
}
