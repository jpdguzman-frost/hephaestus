// ─── Layout Executors ───────────────────────────────────────────────────────
// SET_AUTO_LAYOUT, SET_LAYOUT_CHILD, BATCH_SET_LAYOUT_CHILDREN,
// SET_LAYOUT_GRID, SET_CONSTRAINTS

import { serializeNode, hexToColor } from "../serializer";
import { applyAutoLayout, applyLayoutChild } from "./nodes";

/**
 * Configure auto-layout on a frame (per PROTOCOL.md section 5.3).
 */
export async function executeSetAutoLayout(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("layoutMode" in node)) throw new Error(`Node ${nodeId} does not support auto-layout`);

  applyAutoLayout(node, payload);
  return serializeNode(node, 1);
}

/**
 * Configure how a child behaves within its auto-layout parent.
 */
export async function executeSetLayoutChild(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  applyLayoutChild(node, payload);

  // Handle absolute positioning
  if (payload.positioning === "absolute" && payload.position) {
    const pos = payload.position as { x: number; y: number };
    node.x = pos.x;
    node.y = pos.y;
  }

  // Handle constraints for absolute positioning
  if (payload.horizontalConstraint && "constraints" in node) {
    const constraints = (node as ConstraintMixin).constraints;
    const hMap: Record<string, ConstraintType> = {
      min: "MIN", center: "CENTER", max: "MAX", stretch: "STRETCH", scale: "SCALE",
    };
    (node as ConstraintMixin).constraints = {
      horizontal: hMap[payload.horizontalConstraint as string] || constraints.horizontal,
      vertical: constraints.vertical,
    };
  }

  if (payload.verticalConstraint && "constraints" in node) {
    const constraints = (node as ConstraintMixin).constraints;
    const vMap: Record<string, ConstraintType> = {
      min: "MIN", center: "CENTER", max: "MAX", stretch: "STRETCH", scale: "SCALE",
    };
    (node as ConstraintMixin).constraints = {
      horizontal: constraints.horizontal,
      vertical: vMap[payload.verticalConstraint as string] || constraints.vertical,
    };
  }

  return serializeNode(node, 0);
}

/**
 * Configure multiple children's layout behavior in one call.
 */
export async function executeBatchSetLayoutChildren(payload: Record<string, unknown>): Promise<unknown> {
  const parentId = payload.parentId as string;
  const parent = figma.getNodeById(parentId) as SceneNode;
  if (!parent) throw new Error(`Parent node ${parentId} not found`);

  const children = payload.children as Array<{ nodeId: string; [key: string]: unknown }>;
  const results: unknown[] = [];

  for (const child of children) {
    const result = await executeSetLayoutChild(child);
    results.push(result);
  }

  return { parent: serializeNode(parent, 1), children: results };
}

/**
 * Set layout grids on a frame.
 */
export async function executeSetLayoutGrid(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as FrameNode;
  if (!node || !("layoutGrids" in node)) {
    throw new Error(`Node ${nodeId} does not support layout grids`);
  }

  const grids = payload.grids as any[];
  const figmaGrids: LayoutGrid[] = [];

  for (const grid of grids) {
    const gridColor = grid.color ? hexToColor(grid.color) : { color: { r: 1, g: 0, b: 0 }, opacity: 0.1 };

    switch (grid.pattern) {
      case "columns":
        figmaGrids.push({
          pattern: "COLUMNS",
          alignment: mapGridAlignment(grid.alignment || "stretch"),
          gutterSize: grid.gutterSize ?? 20,
          count: grid.count ?? 12,
          sectionSize: grid.sectionSize,
          offset: grid.offset ?? 0,
          visible: true,
          color: { ...gridColor.color, a: gridColor.opacity },
        } as LayoutGrid);
        break;
      case "rows":
        figmaGrids.push({
          pattern: "ROWS",
          alignment: mapGridAlignment(grid.alignment || "stretch"),
          gutterSize: grid.gutterSize ?? 20,
          count: grid.count ?? 1,
          sectionSize: grid.sectionSize,
          offset: grid.offset ?? 0,
          visible: true,
          color: { ...gridColor.color, a: gridColor.opacity },
        } as LayoutGrid);
        break;
      case "grid":
        figmaGrids.push({
          pattern: "GRID",
          sectionSize: grid.sectionSize ?? 10,
          visible: true,
          color: { ...gridColor.color, a: gridColor.opacity },
        } as LayoutGrid);
        break;
    }
  }

  node.layoutGrids = figmaGrids;
  return serializeNode(node, 0);
}

function mapGridAlignment(align: string): "MIN" | "MAX" | "CENTER" | "STRETCH" {
  switch (align) {
    case "min": return "MIN";
    case "max": return "MAX";
    case "center": return "CENTER";
    case "stretch": return "STRETCH";
    default: return "STRETCH";
  }
}

/**
 * Set constraints for a node inside a non-auto-layout frame.
 */
export async function executeSetConstraints(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!("constraints" in node)) throw new Error(`Node ${nodeId} does not support constraints`);

  const constraintNode = node as ConstraintMixin;
  const current = constraintNode.constraints;

  const hMap: Record<string, ConstraintType> = {
    min: "MIN", center: "CENTER", max: "MAX", stretch: "STRETCH", scale: "SCALE",
  };
  const vMap: Record<string, ConstraintType> = {
    min: "MIN", center: "CENTER", max: "MAX", stretch: "STRETCH", scale: "SCALE",
  };

  constraintNode.constraints = {
    horizontal: payload.horizontal ? hMap[payload.horizontal as string] || current.horizontal : current.horizontal,
    vertical: payload.vertical ? vMap[payload.vertical as string] || current.vertical : current.vertical,
  };

  return serializeNode(node, 0);
}
