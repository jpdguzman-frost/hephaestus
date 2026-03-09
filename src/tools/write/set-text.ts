/**
 * set_text handler — Sets text content and style on a text node.
 *
 * Includes font info in the payload so the plugin can pre-load fonts
 * before applying text changes.
 */

import { randomUUID } from "node:crypto";
import type { Command, CommandResult } from "../../shared/types.js";
import { CommandType, ErrorCategory } from "../../shared/types.js";
import { HephaestusError, toHephaestusError } from "../../shared/errors.js";
import type { z } from "zod";
import type { setTextSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type SetTextInput = z.infer<typeof setTextSchema>;

/**
 * Extract font info from text style for pre-loading in the plugin.
 */
function extractFontInfo(
  params: SetTextInput,
): { fontFamily?: string; fontWeight?: number }[] {
  const fonts: { fontFamily?: string; fontWeight?: number }[] = [];

  if (params.style) {
    if (params.style.fontFamily || params.style.fontWeight) {
      fonts.push({
        fontFamily: params.style.fontFamily,
        fontWeight: params.style.fontWeight,
      });
    }
  }

  if (params.styleRanges) {
    for (const range of params.styleRanges) {
      if (range.style.fontFamily || range.style.fontWeight) {
        fonts.push({
          fontFamily: range.style.fontFamily,
          fontWeight: range.style.fontWeight,
        });
      }
    }
  }

  return fonts;
}

/**
 * Handler for the set_text tool.
 *
 * Sets text content and optionally styles it. Font info is included
 * in the payload so the plugin can handle font loading automatically.
 */
export async function setText(
  params: SetTextInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  const commandId = randomUUID();

  const payload: Record<string, unknown> = {
    nodeId: params.nodeId,
  };

  if (params.text !== undefined) payload.text = params.text;
  if (params.style !== undefined) payload.style = params.style;
  if (params.styleRanges !== undefined) payload.styleRanges = params.styleRanges;

  // Include font info for pre-loading
  const fonts = extractFontInfo(params);
  if (fonts.length > 0) {
    payload.fonts = fonts;
  }

  const command: Command = {
    id: commandId,
    type: CommandType.SET_TEXT,
    payload,
    timestamp: Date.now(),
    ttl: context.config.commands.defaultTtl,
    idempotencyKey: `set_text_${commandId}`,
  };

  try {
    const result: CommandResult = await context.commandQueue.enqueue(command);

    if (result.status === "error") {
      throw new HephaestusError({
        category: result.error?.category ?? ErrorCategory.INTERNAL_ERROR,
        message: result.error?.message ?? "SET_TEXT command failed",
        retryable: result.error?.retryable ?? false,
        commandId,
        nodeId: result.error?.nodeId ?? params.nodeId,
        figmaError: result.error?.figmaError,
        suggestion: result.error?.suggestion,
      });
    }

    return result.result ?? {};
  } catch (err) {
    throw toHephaestusError(err, commandId);
  }
}
