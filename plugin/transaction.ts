// ─── Atomic Transaction Support ─────────────────────────────────────────────
// Provides state capture/restore for rollback, and an atomic execution wrapper.

/** Captured state of a node for rollback purposes. */
export interface NodeState {
  fills?: readonly Paint[];
  strokes?: readonly Paint[];
  effects?: readonly Effect[];
  opacity?: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  cornerRadius?: number | typeof figma.mixed;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  name?: string;
  visible?: boolean;
  locked?: boolean;
}

/**
 * Capture the current state of a node so it can be restored on rollback.
 */
export function captureState(nodeId: string): NodeState {
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found for state capture`);

  const state: NodeState = {
    opacity: node.opacity,
    position: { x: node.x, y: node.y },
    size: { width: node.width, height: node.height },
    name: node.name,
    visible: node.visible,
    locked: node.locked,
  };

  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      state.fills = [...(fills as readonly Paint[])];
    }
  }

  if ("strokes" in node) {
    state.strokes = [...(node as GeometryMixin).strokes];
  }

  if ("effects" in node) {
    state.effects = [...(node as BlendMixin).effects];
  }

  if ("cornerRadius" in node) {
    const rn = node as RectangleNode;
    state.cornerRadius = rn.cornerRadius;
    state.topLeftRadius = rn.topLeftRadius;
    state.topRightRadius = rn.topRightRadius;
    state.bottomRightRadius = rn.bottomRightRadius;
    state.bottomLeftRadius = rn.bottomLeftRadius;
  }

  if ("layoutMode" in node) {
    const frame = node as FrameNode;
    state.layoutMode = frame.layoutMode;
    state.itemSpacing = frame.itemSpacing;
    state.paddingTop = frame.paddingTop;
    state.paddingRight = frame.paddingRight;
    state.paddingBottom = frame.paddingBottom;
    state.paddingLeft = frame.paddingLeft;
  }

  return state;
}

/**
 * Restore a node to a previously captured state.
 */
export function restoreState(nodeId: string, state: NodeState): void {
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) return; // Node may have been deleted

  try {
    if (state.name !== undefined) node.name = state.name;
    if (state.visible !== undefined) node.visible = state.visible;
    if (state.locked !== undefined) node.locked = state.locked;
    if (state.opacity !== undefined) node.opacity = state.opacity;

    if (state.position) {
      node.x = state.position.x;
      node.y = state.position.y;
    }

    if (state.size) {
      node.resize(state.size.width, state.size.height);
    }

    if (state.fills !== undefined && "fills" in node) {
      (node as GeometryMixin).fills = state.fills;
    }

    if (state.strokes !== undefined && "strokes" in node) {
      (node as GeometryMixin).strokes = state.strokes;
    }

    if (state.effects !== undefined && "effects" in node) {
      (node as BlendMixin).effects = state.effects;
    }

    if ("cornerRadius" in node && state.cornerRadius !== undefined) {
      const rn = node as RectangleNode;
      if (state.cornerRadius === figma.mixed) {
        if (state.topLeftRadius !== undefined) rn.topLeftRadius = state.topLeftRadius;
        if (state.topRightRadius !== undefined) rn.topRightRadius = state.topRightRadius;
        if (state.bottomRightRadius !== undefined) rn.bottomRightRadius = state.bottomRightRadius;
        if (state.bottomLeftRadius !== undefined) rn.bottomLeftRadius = state.bottomLeftRadius;
      } else {
        rn.cornerRadius = state.cornerRadius;
      }
    }

    if ("layoutMode" in node && state.layoutMode !== undefined) {
      const frame = node as FrameNode;
      frame.layoutMode = state.layoutMode;
      if (state.itemSpacing !== undefined) frame.itemSpacing = state.itemSpacing;
      if (state.paddingTop !== undefined) frame.paddingTop = state.paddingTop;
      if (state.paddingRight !== undefined) frame.paddingRight = state.paddingRight;
      if (state.paddingBottom !== undefined) frame.paddingBottom = state.paddingBottom;
      if (state.paddingLeft !== undefined) frame.paddingLeft = state.paddingLeft;
    }
  } catch (e) {
    console.error(`Failed to restore state for node ${nodeId}:`, e);
  }
}

/**
 * Execute a function atomically. If it throws, roll back any nodes
 * tracked in the createdNodes array by removing them.
 */
export async function executeAtomic<T>(
  fn: (createdNodes: SceneNode[]) => Promise<T>
): Promise<T> {
  const createdNodes: SceneNode[] = [];

  try {
    return await fn(createdNodes);
  } catch (error) {
    // Rollback: remove all created nodes in reverse order
    for (const node of createdNodes.reverse()) {
      try {
        node.remove();
      } catch {
        // Node may already be removed
      }
    }
    throw error;
  }
}
