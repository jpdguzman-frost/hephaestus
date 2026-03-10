/**
 * post_comment and delete_comment handlers.
 *
 * These use the Figma REST API directly (not the plugin command queue)
 * since comments are a REST-only feature.
 */

import { toRexError } from "../../shared/errors.js";
import {
  postComment as restPostComment,
  deleteComment as restDeleteComment,
  type PostCommentParams,
  type FigmaFrameOffset,
  type FigmaRegion,
} from "../../rest-api/comments.js";
import type { z } from "zod";
import type { postCommentSchema, deleteCommentSchema } from "../schemas.js";
import type { WriteHandlerContext } from "./types.js";

type PostCommentInput = z.infer<typeof postCommentSchema>;
type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;

/**
 * Handler for the post_comment tool.
 *
 * Posts a comment on the Figma file via the REST API.
 * Supports pinning to a node, positioning on canvas, and threaded replies.
 */
export async function postComment(
  params: PostCommentInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  try {
    const restParams: PostCommentParams = {
      message: params.message,
    };

    // Build client_meta for positioning
    if (params.nodeId && params.position) {
      // Pin at offset within a node
      restParams.client_meta = {
        node_id: params.nodeId,
        node_offset: { x: params.position.x, y: params.position.y },
      } satisfies FigmaFrameOffset;
    } else if (params.nodeId) {
      // Pin to node at origin
      restParams.client_meta = {
        node_id: params.nodeId,
        node_offset: { x: 0, y: 0 },
      } satisfies FigmaFrameOffset;
    } else if (params.position) {
      // Pin at canvas position
      restParams.client_meta = {
        x: params.position.x,
        y: params.position.y,
        region_height: 0,
        region_width: 0,
      } satisfies FigmaRegion;
    }

    // Thread reply
    if (params.replyTo) {
      restParams.comment_id = params.replyTo;
    }

    const response = await restPostComment(
      context.restApiClient,
      context.fileKey,
      restParams,
    );

    return {
      commentId: response.id,
      message: response.message,
      user: response.user,
      createdAt: response.created_at,
    };
  } catch (err) {
    throw toRexError(err);
  }
}

/**
 * Handler for the delete_comment tool.
 *
 * Deletes a comment from the Figma file via the REST API.
 */
export async function deleteComment(
  params: DeleteCommentInput,
  context: WriteHandlerContext,
): Promise<Record<string, unknown>> {
  try {
    await restDeleteComment(
      context.restApiClient,
      context.fileKey,
      params.commentId,
    );

    return {
      deleted: true,
      commentId: params.commentId,
    };
  } catch (err) {
    throw toRexError(err);
  }
}
