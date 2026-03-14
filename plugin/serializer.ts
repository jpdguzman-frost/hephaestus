// ─── Node Serialization ─────────────────────────────────────────────────────
// Converts Figma nodes into plain JSON objects for transport.
// Handles circular references, color conversion, and auto-layout serialization.

// ─── Types (duplicated from shared/types.ts for plugin sandbox isolation) ───

export interface SerializedPaint {
  type: string;
  color?: string;
  opacity?: number;
  stops?: { position: number; color: string }[];
  angle?: number;
  center?: { x: number; y: number };
  imageHash?: string;
  scaleMode?: string;
}

export interface SerializedEffect {
  type: string;
  color?: string;
  offset?: { x: number; y: number };
  blur?: number;
  spread?: number;
  visible?: boolean;
}

export interface SerializedAutoLayout {
  direction: "horizontal" | "vertical";
  wrap?: boolean;
  spacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  primaryAxisAlign: string;
  counterAxisAlign: string;
  primaryAxisSizing: "hug" | "fixed";
  counterAxisSizing: "hug" | "fixed";
}

export interface SerializedTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: number | { value: number; unit: "percent" | "pixels" };
  letterSpacing?: number | { value: number; unit: "percent" | "pixels" };
  color?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textDecoration?: string;
  textCase?: string;
  textAutoResize?: string;
}

export interface SerializedNode {
  nodeId: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  opacity?: number;
  fills?: SerializedPaint[];
  strokes?: SerializedPaint[];
  effects?: SerializedEffect[];
  cornerRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  autoLayout?: SerializedAutoLayout;
  constraints?: { horizontal: string; vertical: string };
  children?: SerializedNode[];
  characters?: string;
  textStyle?: SerializedTextStyle;
  strokeWeight?: number;
  strokeAlign?: string;
  dashPattern?: number[];
  blendMode?: string;
  clipsContent?: boolean;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  componentKey?: string;
  componentProperties?: Record<string, { type: string; value: string | boolean }>;
  circular?: boolean;
}

// ─── Color Conversion ───────────────────────────────────────────────────────

/** Convert Figma RGB (0-1 range) to hex string. */
export function colorToHex(color: RGB, opacity?: number): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(color.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(color.b * 255).toString(16).padStart(2, "0");
  if (opacity !== undefined && opacity < 1) {
    const a = Math.round(opacity * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`.toUpperCase();
  }
  return `#${r}${g}${b}`.toUpperCase();
}

/** Convert hex string to Figma RGB + opacity. */
export function hexToColor(hex: string): { color: RGB; opacity: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const opacity = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
  return { color: { r, g, b }, opacity };
}

// ─── Auto-Layout Serialization ──────────────────────────────────────────────

function mapAxisAlign(align: string): string {
  switch (align) {
    case "MIN": return "min";
    case "CENTER": return "center";
    case "MAX": return "max";
    case "SPACE_BETWEEN": return "space-between";
    default: return "min";
  }
}

function mapCounterAlign(align: string): string {
  switch (align) {
    case "MIN": return "min";
    case "CENTER": return "center";
    case "MAX": return "max";
    case "BASELINE": return "baseline";
    default: return "min";
  }
}

/** Serialize a frame's auto-layout properties. Returns undefined if no auto-layout. */
export function serializeAutoLayout(node: FrameNode | ComponentNode | ComponentSetNode): SerializedAutoLayout | undefined {
  if (node.layoutMode === "NONE") return undefined;
  return {
    direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    wrap: node.layoutWrap === "WRAP" ? true : undefined,
    spacing: node.itemSpacing,
    padding: {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    },
    primaryAxisAlign: mapAxisAlign(node.primaryAxisAlignItems),
    counterAxisAlign: mapCounterAlign(node.counterAxisAlignItems),
    primaryAxisSizing: node.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed",
    counterAxisSizing: node.counterAxisSizingMode === "AUTO" ? "hug" : "fixed",
  };
}

// ─── Paint Serialization ────────────────────────────────────────────────────

function serializePaint(paint: Paint): SerializedPaint | null {
  if (!paint.visible && paint.visible !== undefined) return null;

  switch (paint.type) {
    case "SOLID": {
      const solid = paint as SolidPaint;
      return {
        type: "solid",
        color: colorToHex(solid.color),
        opacity: solid.opacity,
      };
    }
    case "GRADIENT_LINEAR": {
      const grad = paint as GradientPaint;
      return {
        type: "linear-gradient",
        stops: grad.gradientStops.map(s => ({
          position: s.position,
          color: colorToHex(s.color, s.color.a),
        })),
      };
    }
    case "GRADIENT_RADIAL": {
      const grad = paint as GradientPaint;
      return {
        type: "radial-gradient",
        stops: grad.gradientStops.map(s => ({
          position: s.position,
          color: colorToHex(s.color, s.color.a),
        })),
      };
    }
    case "IMAGE": {
      const img = paint as ImagePaint;
      return {
        type: "image",
        imageHash: img.imageHash || "",
        scaleMode: img.scaleMode,
      };
    }
    default:
      return { type: paint.type };
  }
}

function serializePaints(paints: readonly Paint[]): SerializedPaint[] {
  const result: SerializedPaint[] = [];
  for (const paint of paints) {
    const serialized = serializePaint(paint);
    if (serialized) result.push(serialized);
  }
  return result;
}

// ─── Effect Serialization ───────────────────────────────────────────────────

function serializeEffect(effect: Effect): SerializedEffect {
  const base: SerializedEffect = {
    visible: effect.visible,
  };

  switch (effect.type) {
    case "DROP_SHADOW": {
      const shadow = effect as DropShadowEffect;
      return {
        ...base,
        type: "drop-shadow",
        color: colorToHex(shadow.color, shadow.color.a),
        offset: { x: shadow.offset.x, y: shadow.offset.y },
        blur: shadow.radius,
        spread: shadow.spread,
      };
    }
    case "INNER_SHADOW": {
      const shadow = effect as InnerShadowEffect;
      return {
        ...base,
        type: "inner-shadow",
        color: colorToHex(shadow.color, shadow.color.a),
        offset: { x: shadow.offset.x, y: shadow.offset.y },
        blur: shadow.radius,
        spread: shadow.spread,
      };
    }
    case "LAYER_BLUR": {
      const blur = effect as BlurEffect;
      return {
        ...base,
        type: "layer-blur",
        blur: blur.radius,
      };
    }
    case "BACKGROUND_BLUR": {
      const blur = effect as BlurEffect;
      return {
        ...base,
        type: "background-blur",
        blur: blur.radius,
      };
    }
    default:
      return { ...base, type: effect.type };
  }
}

function serializeEffects(effects: readonly Effect[]): SerializedEffect[] {
  return effects.map(serializeEffect);
}

// ─── Text Style Serialization ───────────────────────────────────────────────

function serializeTextStyle(node: TextNode): SerializedTextStyle | undefined {
  const style: SerializedTextStyle = {};

  const fontName = node.fontName;
  if (fontName !== figma.mixed) {
    style.fontFamily = fontName.family;
    // Reverse lookup weight from style
    style.fontWeight = getWeightFromStyle(fontName.style);
  }

  const fontSize = node.fontSize;
  if (fontSize !== figma.mixed) {
    style.fontSize = fontSize;
  }

  const lineHeight = node.lineHeight;
  if (lineHeight !== figma.mixed) {
    if (lineHeight.unit === "AUTO") {
      // Skip — auto line height
    } else if (lineHeight.unit === "PERCENT") {
      style.lineHeight = { value: lineHeight.value, unit: "percent" };
    } else {
      style.lineHeight = { value: lineHeight.value, unit: "pixels" };
    }
  }

  const letterSpacing = node.letterSpacing;
  if (letterSpacing !== figma.mixed) {
    if (letterSpacing.unit === "PERCENT") {
      style.letterSpacing = { value: letterSpacing.value, unit: "percent" };
    } else {
      style.letterSpacing = { value: letterSpacing.value, unit: "pixels" };
    }
  }

  // Text fill color
  const fills = node.fills;
  if (fills !== figma.mixed && fills.length > 0) {
    const first = fills[0];
    if (first.type === "SOLID") {
      style.color = colorToHex((first as SolidPaint).color, (first as SolidPaint).opacity);
    }
  }

  style.textAlignHorizontal = node.textAlignHorizontal;
  style.textAlignVertical = node.textAlignVertical;

  const decoration = node.textDecoration;
  if (decoration !== figma.mixed) {
    style.textDecoration = decoration;
  }

  const textCase = node.textCase;
  if (textCase !== figma.mixed) {
    style.textCase = textCase;
  }

  style.textAutoResize = node.textAutoResize;

  return style;
}

function getWeightFromStyle(style: string): number {
  const lower = style.toLowerCase();
  if (lower.includes("thin")) return 100;
  if (lower.includes("extra light") || lower.includes("extralight")) return 200;
  if (lower.includes("light")) return 300;
  if (lower.includes("medium")) return 500;
  if (lower.includes("semi bold") || lower.includes("semibold")) return 600;
  if (lower.includes("extra bold") || lower.includes("extrabold")) return 800;
  if (lower.includes("bold")) return 700;
  if (lower.includes("black")) return 900;
  return 400; // Regular
}

// ─── Node Serialization ─────────────────────────────────────────────────────

/**
 * Recursively serialize a Figma node into a plain object.
 * @param node - The Figma scene node to serialize
 * @param depth - How many levels of children to include (0 = no children)
 * @param seen - Set of node IDs already visited (for circular ref prevention)
 */
export function serializeNode(node: SceneNode, depth: number = 1, seen: Set<string> = new Set()): SerializedNode {
  // Circular reference guard
  if (seen.has(node.id)) {
    return {
      nodeId: node.id,
      name: node.name,
      type: node.type,
      visible: true,
      locked: false,
      position: { x: node.x, y: node.y },
      size: { width: node.width, height: node.height },
      circular: true,
    };
  }
  seen.add(node.id);

  const result: SerializedNode = {
    nodeId: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    locked: node.locked,
    position: { x: Math.round(node.x), y: Math.round(node.y) },
    size: { width: Math.round(node.width), height: Math.round(node.height) },
  };

  // ── Omit defaults to reduce payload ──────────────────────────────────────
  // Only include non-default values. The AI should assume:
  //   visible=true, locked=false, opacity=1, rotation=0,
  //   blendMode="NORMAL", clipsContent=true, cornerRadius=0,
  //   layoutSizing="FIXED", constraints=SCALE/SCALE

  if (result.visible === true) delete result.visible;
  if (result.locked === false) delete result.locked;

  // Rotation — omit if 0
  if ("rotation" in node) {
    const rot = (node as SceneNode & { rotation: number }).rotation;
    if (rot !== 0) result.rotation = Math.round(rot);
  }

  // Opacity — omit if 1
  if (node.opacity !== 1) result.opacity = Math.round(node.opacity * 100) / 100;

  // Fills — omit if empty
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      const serialized = serializePaints(fills as readonly Paint[]);
      if (serialized.length > 0) result.fills = serialized;
    }
  }

  // Strokes — omit if empty
  if ("strokes" in node) {
    const strokes = (node as GeometryMixin).strokes;
    const serialized = serializePaints(strokes);
    if (serialized.length > 0) {
      result.strokes = serialized;

      // Only include stroke properties when strokes exist
      if ("strokeWeight" in node) {
        const sw = (node as GeometryMixin).strokeWeight;
        if (sw !== figma.mixed) result.strokeWeight = sw;
      }
      if ("strokeAlign" in node) {
        const sa = (node as GeometryMixin).strokeAlign;
        if (sa !== "INSIDE") result.strokeAlign = sa;
      }
      if ("dashPattern" in node) {
        const dp = (node as GeometryMixin).dashPattern;
        if (dp && dp.length > 0) result.dashPattern = [...dp];
      }
    }
  }

  // Blend mode — omit if NORMAL or PASS_THROUGH
  if ("blendMode" in node) {
    const bm = (node as BlendMixin).blendMode;
    if (bm !== "NORMAL" && bm !== "PASS_THROUGH") result.blendMode = bm;
  }

  // Effects — omit if empty
  if ("effects" in node) {
    const effects = (node as BlendMixin).effects;
    if (effects.length > 0) result.effects = serializeEffects(effects);
  }

  // Corner radius — omit if 0
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== figma.mixed) {
      if (cr !== 0) result.cornerRadius = cr;
    } else {
      const rn = node as RectangleNode;
      const tl = rn.topLeftRadius, tr = rn.topRightRadius;
      const br = rn.bottomRightRadius, bl = rn.bottomLeftRadius;
      if (tl !== 0 || tr !== 0 || br !== 0 || bl !== 0) {
        // If all same, use single value
        if (tl === tr && tr === br && br === bl) {
          result.cornerRadius = tl;
        } else {
          result.cornerRadius = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
        }
      }
    }
  }

  // Clips content — omit if true (default for frames)
  if ("clipsContent" in node) {
    if (!(node as FrameNode).clipsContent) result.clipsContent = false;
  }

  // Auto-layout — omit if none (serializeAutoLayout returns undefined for NONE)
  if ("layoutMode" in node) {
    const al = serializeAutoLayout(node as FrameNode);
    if (al) {
      // Compact padding: use single number if all sides equal
      const p = al.padding;
      if (p.top === p.right && p.right === p.bottom && p.bottom === p.left) {
        (al as any).padding = p.top;
      }
      result.autoLayout = al;
    }
  }

  // Layout sizing — omit if FIXED (default)
  if ("layoutSizingHorizontal" in node) {
    const lsh = (node as any).layoutSizingHorizontal;
    if (lsh && lsh !== "FIXED") result.layoutSizingHorizontal = lsh;
  }
  if ("layoutSizingVertical" in node) {
    const lsv = (node as any).layoutSizingVertical;
    if (lsv && lsv !== "FIXED") result.layoutSizingVertical = lsv;
  }

  // Min/max size — omit if 0/null/undefined
  if ("minWidth" in node) {
    const n = node as any;
    if (n.minWidth) result.minWidth = n.minWidth;
    if (n.maxWidth) result.maxWidth = n.maxWidth;
    if (n.minHeight) result.minHeight = n.minHeight;
    if (n.maxHeight) result.maxHeight = n.maxHeight;
  }

  // Constraints — omit if default (SCALE, SCALE) or (MIN, MIN)
  if ("constraints" in node) {
    const c = (node as ConstraintMixin).constraints;
    if (!(c.horizontal === "SCALE" && c.vertical === "SCALE") &&
        !(c.horizontal === "MIN" && c.vertical === "MIN")) {
      result.constraints = { horizontal: c.horizontal, vertical: c.vertical };
    }
  }

  // Text-specific — always include (meaningful data)
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    result.characters = textNode.characters;
    result.textStyle = serializeTextStyle(textNode);
  }

  // Component-specific — always include (meaningful data)
  if (node.type === "COMPONENT") {
    result.componentKey = (node as ComponentNode).key;
  }
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    result.componentKey = instance.mainComponent ? instance.mainComponent.key : undefined;
    try {
      const props = instance.componentProperties;
      if (props && Object.keys(props).length > 0) {
        result.componentProperties = {};
        for (const [key, val] of Object.entries(props)) {
          result.componentProperties[key] = {
            type: val.type,
            value: val.value as string | boolean,
          };
        }
      }
    } catch {
      // Component properties may not be available
    }
  }

  // Children — cap at 100 to prevent oversized payloads
  if (depth > 0 && "children" in node) {
    const parent = node as ChildrenMixin;
    const maxChildren = 100;
    const childSlice = parent.children.length > maxChildren
      ? parent.children.slice(0, maxChildren)
      : parent.children;
    result.children = childSlice.map(child =>
      serializeNode(child as SceneNode, depth - 1, new Set(seen))
    );
    if (parent.children.length > maxChildren) {
      (result as Record<string, unknown>)._childrenTruncated = true;
      (result as Record<string, unknown>)._totalChildren = parent.children.length;
    }
  }

  return result;
}
