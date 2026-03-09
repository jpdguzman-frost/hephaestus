// ─── Visual Executors ───────────────────────────────────────────────────────
// SET_FILLS, SET_STROKES, SET_EFFECTS, SET_CORNER_RADIUS

import { serializeNode } from "../serializer";
import { applyFills, applyStrokes, applyEffects, applyCornerRadius } from "./nodes";

/**
 * Set fill paints on a node.
 */
export async function executeSetFills(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("fills" in node)) throw new Error(`Node ${nodeId} does not support fills`);

  applyFills(node, payload.fills as any[]);
  return serializeNode(node, 0);
}

/**
 * Set strokes on a node.
 */
export async function executeSetStrokes(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("strokes" in node)) throw new Error(`Node ${nodeId} does not support strokes`);

  applyStrokes(
    node,
    payload.strokes as any[],
    payload.strokeWeight as number | undefined,
    payload.strokeAlign as string | undefined
  );

  if (payload.dashPattern && "dashPattern" in node) {
    (node as any).dashPattern = payload.dashPattern as number[];
  }

  if (payload.strokeCap && "strokeCap" in node) {
    (node as any).strokeCap = payload.strokeCap as string;
  }

  if (payload.strokeJoin && "strokeJoin" in node) {
    (node as any).strokeJoin = payload.strokeJoin as string;
  }

  return serializeNode(node, 0);
}

/**
 * Set effects (shadows, blur) on a node.
 */
export async function executeSetEffects(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("effects" in node)) throw new Error(`Node ${nodeId} does not support effects`);

  applyEffects(node, payload.effects as any[]);
  return serializeNode(node, 0);
}

/**
 * Set corner radius on a node.
 */
export async function executeSetCornerRadius(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("cornerRadius" in node)) throw new Error(`Node ${nodeId} does not support corner radius`);

  applyCornerRadius(node, payload.radius as number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number });
  return serializeNode(node, 0);
}
