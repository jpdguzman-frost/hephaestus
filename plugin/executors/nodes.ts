// ─── Node Executors ─────────────────────────────────────────────────────────
// CREATE_NODE, UPDATE_NODE, DELETE_NODES, CLONE_NODE, REPARENT_NODE, REORDER_CHILDREN

import { serializeNode, hexToColor } from "../serializer";
import { ensureFont, resolveFontWithFallback } from "../fonts";
import { executeAtomic } from "../transaction";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getParent(parentId?: string): BaseNode & ChildrenMixin {
  if (parentId) {
    const parent = figma.getNodeById(parentId);
    if (!parent) throw new Error(`Parent node ${parentId} not found`);
    if (!("children" in parent)) throw new Error(`Node ${parentId} cannot have children`);
    return parent as BaseNode & ChildrenMixin;
  }
  return figma.currentPage;
}

function createSingleNode(type: string): SceneNode {
  switch (type) {
    case "FRAME": return figma.createFrame();
    case "RECTANGLE": return figma.createRectangle();
    case "ELLIPSE": return figma.createEllipse();
    case "TEXT": return figma.createText();
    case "LINE": return figma.createLine();
    case "POLYGON": return figma.createPolygon();
    case "STAR": return figma.createStar();
    case "VECTOR": return figma.createVector();
    case "SECTION": return figma.createSection();
    case "COMPONENT": return figma.createComponent();
    case "COMPONENT_SET": {
      // Component sets need at least two components — create a temporary component
      const c = figma.createComponent();
      c.name = "Variant 1";
      return figma.combineAsVariants([c], figma.currentPage);
    }
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
}

function applyFills(node: SceneNode, fills: any[]): void {
  if (!("fills" in node)) return;
  const figmaFills: Paint[] = [];
  for (const fill of fills) {
    switch (fill.type) {
      case "solid": {
        const { color, opacity: op } = hexToColor(fill.color);
        figmaFills.push({
          type: "SOLID",
          color,
          opacity: fill.opacity ?? op,
          visible: true,
        });
        break;
      }
      case "linear-gradient": {
        const stops: ColorStop[] = fill.stops.map((s: any) => {
          const { color, opacity: op } = hexToColor(s.color);
          return { position: s.position, color: { ...color, a: op } };
        });
        figmaFills.push({
          type: "GRADIENT_LINEAR",
          gradientStops: stops,
          gradientTransform: [[1, 0, 0], [0, 1, 0]],
          visible: true,
        });
        break;
      }
      case "radial-gradient": {
        const stops: ColorStop[] = fill.stops.map((s: any) => {
          const { color, opacity: op } = hexToColor(s.color);
          return { position: s.position, color: { ...color, a: op } };
        });
        figmaFills.push({
          type: "GRADIENT_RADIAL",
          gradientStops: stops,
          gradientTransform: [[1, 0, 0], [0, 1, 0]],
          visible: true,
        });
        break;
      }
      case "image": {
        figmaFills.push({
          type: "IMAGE",
          imageHash: fill.imageHash,
          scaleMode: fill.scaleMode || "FILL",
          visible: true,
        } as ImagePaint);
        break;
      }
    }
  }
  (node as GeometryMixin).fills = figmaFills;
}

function applyStrokes(node: SceneNode, strokes: any[], weight?: number, align?: string): void {
  if (!("strokes" in node)) return;
  const figmaStrokes: Paint[] = [];
  for (const stroke of strokes) {
    if (stroke.type === "solid") {
      const { color, opacity: op } = hexToColor(stroke.color);
      figmaStrokes.push({
        type: "SOLID",
        color,
        opacity: stroke.opacity ?? op,
        visible: true,
      });
    }
  }
  (node as GeometryMixin).strokes = figmaStrokes;
  if (weight !== undefined) (node as GeometryMixin).strokeWeight = weight;
  if (align && "strokeAlign" in node) {
    (node as any).strokeAlign = align;
  }
}

function applyEffects(node: SceneNode, effects: any[]): void {
  if (!("effects" in node)) return;
  const figmaEffects: Effect[] = [];
  for (const effect of effects) {
    switch (effect.type) {
      case "drop-shadow": {
        const { color, opacity: op } = hexToColor(effect.color);
        figmaEffects.push({
          type: "DROP_SHADOW",
          color: { ...color, a: op },
          offset: { x: effect.offset ? effect.offset.x : 0, y: effect.offset ? effect.offset.y : 0 },
          radius: effect.blur ?? 0,
          spread: effect.spread ?? 0,
          visible: effect.visible !== false,
          blendMode: "NORMAL",
        } as DropShadowEffect);
        break;
      }
      case "inner-shadow": {
        const { color, opacity: op } = hexToColor(effect.color);
        figmaEffects.push({
          type: "INNER_SHADOW",
          color: { ...color, a: op },
          offset: { x: effect.offset ? effect.offset.x : 0, y: effect.offset ? effect.offset.y : 0 },
          radius: effect.blur ?? 0,
          spread: effect.spread ?? 0,
          visible: effect.visible !== false,
          blendMode: "NORMAL",
        } as InnerShadowEffect);
        break;
      }
      case "layer-blur": {
        figmaEffects.push({
          type: "LAYER_BLUR",
          radius: effect.blur ?? 0,
          visible: effect.visible !== false,
        } as BlurEffect);
        break;
      }
      case "background-blur": {
        figmaEffects.push({
          type: "BACKGROUND_BLUR",
          radius: effect.blur ?? 0,
          visible: effect.visible !== false,
        } as BlurEffect);
        break;
      }
    }
  }
  (node as BlendMixin).effects = figmaEffects;
}

function applyCornerRadius(node: SceneNode, radius: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }): void {
  if (!("cornerRadius" in node)) return;
  const rn = node as RectangleNode;
  if (typeof radius === "number") {
    rn.cornerRadius = radius;
  } else {
    rn.topLeftRadius = radius.topLeft;
    rn.topRightRadius = radius.topRight;
    rn.bottomRightRadius = radius.bottomRight;
    rn.bottomLeftRadius = radius.bottomLeft;
  }
}

function applyAutoLayout(node: SceneNode, params: any): void {
  if (!("layoutMode" in node)) return;
  const frame = node as FrameNode;

  if (params.enabled === false) {
    frame.layoutMode = "NONE";
    return;
  }

  if (params.direction) {
    frame.layoutMode = params.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  } else if (frame.layoutMode === "NONE") {
    frame.layoutMode = "VERTICAL";
  }

  if (params.wrap !== undefined) {
    frame.layoutWrap = params.wrap ? "WRAP" : "NO_WRAP";
  }

  if (params.spacing !== undefined) {
    if (params.spacing === "auto") {
      frame.primaryAxisAlignItems = "SPACE_BETWEEN";
    } else {
      frame.itemSpacing = params.spacing;
    }
  }

  if (params.padding !== undefined) {
    if (typeof params.padding === "number") {
      frame.paddingTop = params.padding;
      frame.paddingRight = params.padding;
      frame.paddingBottom = params.padding;
      frame.paddingLeft = params.padding;
    } else {
      if (params.padding.top !== undefined) frame.paddingTop = params.padding.top;
      if (params.padding.right !== undefined) frame.paddingRight = params.padding.right;
      if (params.padding.bottom !== undefined) frame.paddingBottom = params.padding.bottom;
      if (params.padding.left !== undefined) frame.paddingLeft = params.padding.left;
    }
  }

  if (params.primaryAxisAlign) {
    const map: Record<string, "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"> = {
      min: "MIN", center: "CENTER", max: "MAX", "space-between": "SPACE_BETWEEN",
    };
    frame.primaryAxisAlignItems = map[params.primaryAxisAlign] || "MIN";
  }

  if (params.counterAxisAlign) {
    const map: Record<string, "MIN" | "CENTER" | "MAX" | "BASELINE"> = {
      min: "MIN", center: "CENTER", max: "MAX", baseline: "BASELINE",
    };
    frame.counterAxisAlignItems = map[params.counterAxisAlign] || "MIN";
  }

  if (params.primaryAxisSizing) {
    frame.primaryAxisSizingMode = params.primaryAxisSizing === "hug" ? "AUTO" : "FIXED";
  }

  if (params.counterAxisSizing) {
    frame.counterAxisSizingMode = params.counterAxisSizing === "hug" ? "AUTO" : "FIXED";
  }

  if (params.strokesIncludedInLayout !== undefined) {
    frame.strokesIncludedInLayout = params.strokesIncludedInLayout;
  }

  if (params.itemReverseZIndex !== undefined) {
    frame.itemReverseZIndex = params.itemReverseZIndex;
  }
}

function applyLayoutChild(node: SceneNode, params: any): void {
  if (params.alignSelf !== undefined) {
    (node as any).layoutAlign = params.alignSelf === "stretch" ? "STRETCH" : "INHERIT";
  }
  if (params.grow !== undefined) {
    (node as any).layoutGrow = params.grow;
  }
  if (params.positioning !== undefined) {
    (node as any).layoutPositioning = params.positioning === "absolute" ? "ABSOLUTE" : "AUTO";
  }
}

async function applyProperties(node: SceneNode, payload: any): Promise<void> {
  if (payload.name) node.name = payload.name;
  if (payload.visible !== undefined) node.visible = payload.visible;
  if (payload.locked !== undefined) node.locked = payload.locked;
  if (payload.opacity !== undefined) node.opacity = payload.opacity;

  if (payload.position) {
    node.x = payload.position.x;
    node.y = payload.position.y;
  }

  if (payload.size) {
    const w = payload.size.width ?? node.width;
    const h = payload.size.height ?? payload.size.width ?? node.height;
    node.resize(w, h);
  }

  if (payload.fills) applyFills(node, payload.fills);
  if (payload.strokes) applyStrokes(node, payload.strokes, payload.strokeWeight, payload.strokeAlign);
  if (payload.effects) applyEffects(node, payload.effects);
  if (payload.cornerRadius !== undefined) applyCornerRadius(node, payload.cornerRadius);
  if (payload.autoLayout) applyAutoLayout(node, payload.autoLayout);
  if (payload.layoutChild) applyLayoutChild(node, payload.layoutChild);

  if (payload.blendMode && "blendMode" in node) {
    (node as any).blendMode = payload.blendMode;
  }

  if (payload.clipsContent !== undefined && "clipsContent" in node) {
    (node as FrameNode).clipsContent = payload.clipsContent;
  }

  // Text content
  if (node.type === "TEXT" && (payload.text !== undefined || payload.textStyle)) {
    const textNode = node as TextNode;
    var fontName: FontName | undefined;
    if (payload.textStyle && payload.textStyle.fontFamily) {
      fontName = await resolveFontWithFallback(
        payload.textStyle.fontFamily as string,
        (payload.textStyle.fontWeight as number) || 400
      );
    }
    if (!fontName) {
      await ensureFont(textNode);
    }

    if (fontName) {
      textNode.fontName = fontName;
    }

    if (payload.text !== undefined) {
      textNode.characters = payload.text;
    }

    if (payload.textStyle) {
      const ts = payload.textStyle;
      if (ts.fontSize !== undefined) textNode.fontSize = ts.fontSize;
      if (ts.lineHeight !== undefined) {
        if (typeof ts.lineHeight === "number") {
          textNode.lineHeight = { value: ts.lineHeight, unit: "PIXELS" };
        } else {
          textNode.lineHeight = {
            value: ts.lineHeight.value,
            unit: ts.lineHeight.unit === "percent" ? "PERCENT" : "PIXELS",
          };
        }
      }
      if (ts.letterSpacing !== undefined) {
        if (typeof ts.letterSpacing === "number") {
          textNode.letterSpacing = { value: ts.letterSpacing, unit: "PIXELS" };
        } else {
          textNode.letterSpacing = {
            value: ts.letterSpacing.value,
            unit: ts.letterSpacing.unit === "percent" ? "PERCENT" : "PIXELS",
          };
        }
      }
      if (ts.textAlignHorizontal) textNode.textAlignHorizontal = ts.textAlignHorizontal;
      if (ts.textAlignVertical) textNode.textAlignVertical = ts.textAlignVertical;
      if (ts.textAutoResize) textNode.textAutoResize = ts.textAutoResize;
      if (ts.textDecoration) textNode.textDecoration = ts.textDecoration;
      if (ts.textCase) textNode.textCase = ts.textCase;
      if (ts.paragraphSpacing !== undefined) textNode.paragraphSpacing = ts.paragraphSpacing;
      if (ts.maxLines !== undefined) (textNode as any).maxLines = ts.maxLines;

      // Text fill color from style
      if (ts.color) {
        const { color, opacity: op } = hexToColor(ts.color);
        textNode.fills = [{ type: "SOLID", color, opacity: op, visible: true }];
      }
    }
  }
}

// ─── Exported Executors ─────────────────────────────────────────────────────

/**
 * Create a node (optionally with children). Atomic — rolls back on failure.
 */
export async function executeCreateNode(payload: Record<string, unknown>): Promise<unknown> {
  return executeAtomic(async (createdNodes) => {
    async function createRecursive(p: any, parent: BaseNode & ChildrenMixin): Promise<SceneNode> {
      const node = createSingleNode(p.type);
      createdNodes.push(node);

      // Append to parent
      parent.appendChild(node);

      // Apply properties before children (auto-layout needs to be set first)
      await applyProperties(node, p);

      // Create children recursively
      if (p.children && "children" in node) {
        for (const childPayload of p.children) {
          await createRecursive(childPayload, node as BaseNode & ChildrenMixin);
        }
      }

      return node;
    }

    const parent = getParent(payload.parentId as string | undefined);
    const node = await createRecursive(payload, parent);
    return serializeNode(node, 2);
  });
}

/**
 * Update properties on an existing node.
 */
export async function executeUpdateNode(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  await applyProperties(node, payload);
  return serializeNode(node, 1);
}

/**
 * Delete one or more nodes.
 */
export async function executeDeleteNodes(payload: Record<string, unknown>): Promise<unknown> {
  const nodeIds = payload.nodeIds as string[];
  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const id of nodeIds) {
    const node = figma.getNodeById(id);
    if (node) {
      node.remove();
      deleted.push(id);
    } else {
      notFound.push(id);
    }
  }

  return { deleted, notFound };
}

/**
 * Clone (duplicate) a node.
 */
export async function executeCloneNode(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const clone = node.clone();

  if (payload.parentId) {
    const parent = getParent(payload.parentId as string);
    parent.appendChild(clone);
  }

  if (payload.position) {
    const pos = payload.position as { x: number; y: number };
    clone.x = pos.x;
    clone.y = pos.y;
  }

  if (payload.name) {
    clone.name = payload.name as string;
  }

  return serializeNode(clone, 1);
}

/**
 * Move a node to a different parent.
 */
export async function executeReparentNode(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const node = figma.getNodeById(nodeId) as SceneNode;
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const parent = getParent(payload.parentId as string);
  const index = payload.index as number | undefined;

  if (index !== undefined) {
    parent.insertChild(index, node);
  } else {
    parent.appendChild(node);
  }

  return serializeNode(node, 0);
}

/**
 * Reorder children within a parent (z-index control).
 */
export async function executeReorderChildren(payload: Record<string, unknown>): Promise<unknown> {
  const parentId = payload.parentId as string;
  const childIds = payload.childIds as string[];
  const parent = figma.getNodeById(parentId) as BaseNode & ChildrenMixin;
  if (!parent || !("children" in parent)) {
    throw new Error(`Parent node ${parentId} not found or cannot have children`);
  }

  // Reorder by re-inserting children in the desired order
  for (let i = 0; i < childIds.length; i++) {
    const child = figma.getNodeById(childIds[i]) as SceneNode;
    if (child && child.parent === parent) {
      parent.insertChild(i, child);
    }
  }

  return serializeNode(parent as SceneNode, 1);
}

// Re-export helpers for use by other executors
export { applyFills, applyStrokes, applyEffects, applyCornerRadius, applyAutoLayout, applyLayoutChild, applyProperties };
