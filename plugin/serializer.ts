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
      visible: node.visible,
      locked: node.locked,
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
    position: { x: node.x, y: node.y },
    size: { width: node.width, height: node.height },
  };

  // Rotation
  if ("rotation" in node) {
    result.rotation = (node as SceneNode & { rotation: number }).rotation;
  }

  // Opacity
  result.opacity = node.opacity;

  // Fills
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      result.fills = serializePaints(fills as readonly Paint[]);
    }
  }

  // Strokes
  if ("strokes" in node) {
    const strokes = (node as GeometryMixin).strokes;
    result.strokes = serializePaints(strokes);
  }

  // Effects
  if ("effects" in node) {
    const effects = (node as BlendMixin).effects;
    result.effects = serializeEffects(effects);
  }

  // Corner radius
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== figma.mixed) {
      result.cornerRadius = cr;
    } else {
      const rn = node as RectangleNode;
      result.cornerRadius = {
        topLeft: rn.topLeftRadius,
        topRight: rn.topRightRadius,
        bottomRight: rn.bottomRightRadius,
        bottomLeft: rn.bottomLeftRadius,
      };
    }
  }

  // Auto-layout
  if ("layoutMode" in node) {
    const frameNode = node as FrameNode;
    result.autoLayout = serializeAutoLayout(frameNode);
  }

  // Constraints
  if ("constraints" in node) {
    const c = (node as ConstraintMixin).constraints;
    result.constraints = {
      horizontal: c.horizontal,
      vertical: c.vertical,
    };
  }

  // Text-specific
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    result.characters = textNode.characters;
    result.textStyle = serializeTextStyle(textNode);
  }

  // Component-specific
  if (node.type === "COMPONENT") {
    result.componentKey = (node as ComponentNode).key;
  }
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    result.componentKey = instance.mainComponent ? instance.mainComponent.key : undefined;
    // Serialize component properties
    try {
      const props = instance.componentProperties;
      if (props) {
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

  // Children
  if (depth > 0 && "children" in node) {
    const parent = node as ChildrenMixin;
    result.children = parent.children.map(child =>
      serializeNode(child as SceneNode, depth - 1, new Set(seen))
    );
  }

  return result;
}
