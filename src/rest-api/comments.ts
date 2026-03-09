/**
 * Figma REST API — Comments endpoints.
 *
 * Read, post, and delete comments on Figma files.
 */

import { FigmaClient } from "./client.js";

// ─── Request Parameter Types ────────────────────────────────────────────────

/** Parameters for postComment(). */
export interface PostCommentParams {
  /** Comment message text. Supports some markdown. */
  message: string;
  /** Client-generated metadata (JSON string). */
  client_meta?: FigmaClientMeta;
  /** Comment ID to reply to (creates a threaded reply). */
  comment_id?: string;
}

/** Client metadata for positioning a comment on the canvas. */
export type FigmaClientMeta =
  | FigmaFrameOffset
  | FigmaRegion
  | FigmaFrameOffsetRegion;

/** Pin a comment at a specific offset within a node/frame. */
export interface FigmaFrameOffset {
  node_id: string;
  node_offset: { x: number; y: number };
}

/** Pin a comment at a canvas region. */
export interface FigmaRegion {
  x: number;
  y: number;
  region_height: number;
  region_width: number;
  comment_pin_corner?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

/** Pin a comment at a region offset within a node/frame. */
export interface FigmaFrameOffsetRegion {
  node_id: string;
  node_offset: { x: number; y: number };
  region_height: number;
  region_width: number;
  comment_pin_corner?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

// ─── Response Types ─────────────────────────────────────────────────────────

/** Response from GET /files/:key/comments. */
export interface GetCommentsResponse {
  comments: FigmaComment[];
}

/** Response from POST /files/:key/comments. */
export interface PostCommentResponse {
  id: string;
  file_key: string;
  parent_id: string;
  user: FigmaCommentUser;
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta: FigmaClientMeta | null;
  order_id: string;
}

/** A comment on a Figma file. */
export interface FigmaComment {
  id: string;
  file_key: string;
  parent_id: string;
  user: FigmaCommentUser;
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta: FigmaClientMeta | null;
  order_id: string;
}

/** User who authored a comment. */
export interface FigmaCommentUser {
  id: string;
  handle: string;
  img_url: string;
  email?: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Get all comments on a file.
 *
 * Returns comments in chronological order, including resolved comments.
 * Threaded replies reference their parent via parent_id.
 *
 * @see https://www.figma.com/developers/api#get-comments-endpoint
 */
export async function getComments(
  client: FigmaClient,
  fileKey: string,
): Promise<GetCommentsResponse> {
  return client.get<GetCommentsResponse>(`/files/${fileKey}/comments`, {
    // Comments change frequently; use a short cache TTL
    cacheTtlMs: 5_000,
  });
}

/**
 * Post a new comment or reply to an existing comment on a file.
 *
 * @param client  - Figma API client
 * @param fileKey - File key
 * @param params  - Comment content and positioning
 *
 * @see https://www.figma.com/developers/api#post-comments-endpoint
 */
export async function postComment(
  client: FigmaClient,
  fileKey: string,
  params: PostCommentParams,
): Promise<PostCommentResponse> {
  return client.post<PostCommentResponse>(`/files/${fileKey}/comments`, params);
}

/**
 * Delete a comment from a file.
 *
 * @param client    - Figma API client
 * @param fileKey   - File key
 * @param commentId - Comment ID to delete
 *
 * @see https://www.figma.com/developers/api#delete-comments-endpoint
 */
export async function deleteComment(
  client: FigmaClient,
  fileKey: string,
  commentId: string,
): Promise<void> {
  await client.delete(`/files/${fileKey}/comments/${commentId}`);
}
