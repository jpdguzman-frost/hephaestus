// ─── SOM Extractor ──────────────────────────────────────────────────────────
// Extracts a Screen Object Model (SOM v2) from a live Figma frame with
// semantic role assignment and content/style separation.

import {
  serializePaints,
  serializeEffects,
  serializeTextStyle,
  colorToHex,
  getWeightFromStyle,
} from "../serializer";
import type { SerializedPaint, SerializedEffect } from "../serializer";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RoleResult {
  role: string;
  roleCategory: string;
  confidence: number;
}

interface SomContent {
  texts?: Array<{ value: string; role: string }>;
  images?: string[];
  componentRef?: string;
}

type Padding = number | { top: number; right: number; bottom: number; left: number };

interface SomStyle {
  w: number;
  h: number;
  fill?: string;
  fills?: SerializedPaint[];
  strokes?: SerializedPaint[];
  strokeWeight?: number;
  effects?: SerializedEffect[];
  opacity?: number;
  cornerRadius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  layout?: string;
  gap?: number;
  padding?: Padding;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
  primaryAxisSizing?: string;
  counterAxisSizing?: string;
  clipsContent?: boolean;
  blendMode?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  textAlign?: string;
  letterSpacing?: number | { value: number; unit: string };
  lineHeight?: number | { value: number; unit: string };
}

interface SomNode {
  id: string;
  name: string;
  type: string;
  role: string;
  roleCategory: string;
  confidence: number;
  content: SomContent;
  style: SomStyle;
  children?: SomNode[];
}

interface RoleMapEntry {
  nodeId: string;
  nodeName: string;
  role: string;
  category: string;
  confidence: number;
}

// ─── Name-Based Role Patterns (Tier 1) ──────────────────────────────────────

const NAME_PATTERNS: Array<{ pattern: RegExp; role: string; category: string }> = [
  // Structure
  { pattern: /(^|\b)(nav|nav-bar|header|top-bar|navigation)($|\b)/i, role: "nav", category: "structure" },
  { pattern: /(^|\b)(bottom-nav|tab-bar|footer-nav)($|\b)/i, role: "bottom-nav", category: "structure" },
  { pattern: /(^|\b)(status-bar|system-bar)($|\b)/i, role: "status-bar", category: "structure" },
  { pattern: /(^|\b)(tabs|segment|switcher)($|\b)/i, role: "tab-bar", category: "structure" },

  // Hero
  { pattern: /(^|\b)(hero|gradient-header|banner-hero|hero-section)($|\b)/i, role: "hero", category: "hero" },
  { pattern: /(^|\b)(carousel|slider|stories)($|\b)/i, role: "carousel", category: "hero" },

  // Content
  { pattern: /(^|\b)card(-|$)/i, role: "card", category: "content" },
  { pattern: /(^|\b)section($|\b)|-section$/i, role: "section", category: "content" },
  { pattern: /(^|\b)row($|\b)/i, role: "row", category: "content" },
  { pattern: /^list$/i, role: "list", category: "content" },
  { pattern: /(^|\b)(list-item|action-)($|\b)/i, role: "list-item", category: "content" },

  // Interactive
  { pattern: /(^|\b)(cta|cta-button)($|\b)|-btn$/i, role: "cta", category: "interactive" },
  { pattern: /(^|\b)(input|search-bar|text-field|amount-)($|\b)/i, role: "input", category: "interactive" },
  { pattern: /(^|\b)(toggle|switch)($|\b)/i, role: "toggle", category: "interactive" },

  // Decorative
  { pattern: /(^|\b)(divider|separator)($|\b)/i, role: "divider", category: "decorative" },
  { pattern: /(^|\b)(pill|chip|badge|tag)($|\b)/i, role: "pill", category: "decorative" },
  { pattern: /(^|\b)icon($|\b)/i, role: "icon", category: "decorative" },
  { pattern: /(^|\b)(avatar|profile-pic)($|\b)/i, role: "avatar", category: "decorative" },

  // Feedback
  { pattern: /(^|\b)(banner|alert|notification)($|\b)|^verify-/i, role: "banner", category: "feedback" },
  { pattern: /(^|\b)(modal|dialog|popup)($|\b)/i, role: "modal", category: "feedback" },
  { pattern: /(^|\b)(progress|stepper|step-)($|\b)/i, role: "progress", category: "feedback" },

  // Data
  { pattern: /(^|\b)label($|\b)|-label$/i, role: "label", category: "data" },
  { pattern: /(^|\b)(value)($|\b)|(-value|amount-|balance-)$/i, role: "value", category: "data" },
  { pattern: /(^|\b)(prompt|body)($|\b)/i, role: "prompt", category: "data" },
];

// ─── Text Role Helper ────────────────────────────────────────────────────────

function determineTextRole(textNode: TextNode): string {
  // Check name for role hints (highest priority)
  const name = textNode.name.toLowerCase();
  if (name.includes("prompt") || name.includes("body") || name.includes("description")) {
    return "prompt";
  }
  if (name.includes("value") || name.includes("amount") || name.includes("balance") || name.includes("price")) {
    return "value";
  }
  if (name.includes("label") || name.includes("title") || name.includes("heading")) {
    return "label";
  }

  // Fall back to font weight heuristic
  const fontName = textNode.fontName;
  if (fontName !== figma.mixed) {
    const weight = getWeightFromStyle(fontName.style);
    if (weight >= 600) return "value";
  }

  return "label";
}

// ─── Role Assignment ────────────────────────────────────────────────────────

function assignRole(node: SceneNode): RoleResult {
  const name = node.name.toLowerCase();

  // Tier 1: Name-based pattern matching (confidence 0.9)
  for (const p of NAME_PATTERNS) {
    if (p.pattern.test(name)) {
      return { role: p.role, roleCategory: p.category, confidence: 0.9 };
    }
  }

  // Tier 2: Type-based (0.5-0.8)
  if (node.type === "ELLIPSE") {
    return { role: "avatar", roleCategory: "decorative", confidence: 0.6 };
  }
  if (node.type === "TEXT") {
    const role = determineTextRole(node as TextNode);
    return { role, roleCategory: "data", confidence: 0.5 };
  }
  if (node.type === "LINE") {
    return { role: "divider", roleCategory: "decorative", confidence: 0.8 };
  }

  // Tier 3: Position-based (0.3-0.5)
  if (node.parent && "height" in node.parent) {
    const parentHeight = (node.parent as FrameNode).height;

    // Bottom 100px of parent
    if (parentHeight - node.y - node.height < 100 && node.height < 100) {
      return { role: "bottom-nav", roleCategory: "structure", confidence: 0.4 };
    }

    // Top 80px of parent
    if (node.y < 80 && node.height < 80) {
      return { role: "nav", roleCategory: "structure", confidence: 0.4 };
    }
  }

  // Check for gradient fill → hero
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      for (const fill of fills) {
        if (fill.type === "GRADIENT_LINEAR" || fill.type === "GRADIENT_RADIAL") {
          return { role: "hero", roleCategory: "hero", confidence: 0.5 };
        }
      }
    }
  }

  // Tier 4: Fallback (0-0.3)
  if ("children" in node && (node as ChildrenMixin).children.length > 0) {
    return { role: "section", roleCategory: "content", confidence: 0.3 };
  }

  return { role: "unknown", roleCategory: "unknown", confidence: 0 };
}

// ─── Content Extraction ─────────────────────────────────────────────────────

function extractContent(node: SceneNode): SomContent {
  const content: SomContent = {};

  // Self is a text node
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    content.texts = [{ value: textNode.characters, role: determineTextRole(textNode) }];
  }

  // Extract texts from immediate text children (not recursive)
  if ("children" in node) {
    const children = (node as ChildrenMixin).children;
    const texts: Array<{ value: string; role: string }> = [];
    for (const child of children) {
      if (child.type === "TEXT") {
        const textNode = child as TextNode;
        texts.push({ value: textNode.characters, role: determineTextRole(textNode) });
      }
    }
    if (texts.length > 0) content.texts = texts;
  }

  // Image fills
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed) {
      const images: string[] = [];
      for (const fill of fills) {
        if (fill.type === "IMAGE") {
          const imgPaint = fill as ImagePaint;
          if (imgPaint.imageHash) images.push(imgPaint.imageHash);
        }
      }
      if (images.length > 0) content.images = images;
    }
  }

  // Component ref from INSTANCE nodes
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    if (instance.mainComponent) {
      content.componentRef = instance.mainComponent.key;
    }
  }

  return content;
}

// ─── Style Extraction ───────────────────────────────────────────────────────

function extractStyle(node: SceneNode): SomStyle {
  const style: SomStyle = {
    w: Math.round(node.width),
    h: Math.round(node.height),
  };

  // Fills
  if ("fills" in node) {
    const fills = (node as GeometryMixin).fills;
    if (fills !== figma.mixed && fills.length > 0) {
      const visibleFills = fills.filter((f) => f.visible !== false);
      if (visibleFills.length === 1 && visibleFills[0].type === "SOLID") {
        const solid = visibleFills[0] as SolidPaint;
        style.fill = colorToHex(solid.color, solid.opacity);
      } else if (visibleFills.length > 0) {
        style.fills = serializePaints(visibleFills);
      }
    }
  }

  // Strokes
  if ("strokes" in node) {
    const strokes = (node as GeometryMixin).strokes;
    const serializedStrokes = serializePaints(strokes);
    if (serializedStrokes.length > 0) {
      style.strokes = serializedStrokes;
      if ("strokeWeight" in node) {
        const sw = (node as GeometryMixin).strokeWeight;
        if (sw !== figma.mixed) style.strokeWeight = sw;
      }
    }
  }

  // Effects
  if ("effects" in node) {
    const effects = (node as BlendMixin).effects;
    if (effects.length > 0) {
      style.effects = serializeEffects(effects);
    }
  }

  // Opacity
  if (node.opacity !== 1) {
    style.opacity = Math.round(node.opacity * 100) / 100;
  }

  // Corner radius
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr !== figma.mixed) {
      if (cr !== 0) style.cornerRadius = cr;
    } else {
      const rn = node as RectangleNode;
      const tl = rn.topLeftRadius, tr = rn.topRightRadius;
      const br = rn.bottomRightRadius, bl = rn.bottomLeftRadius;
      if (tl !== 0 || tr !== 0 || br !== 0 || bl !== 0) {
        if (tl === tr && tr === br && br === bl) {
          style.cornerRadius = tl;
        } else {
          style.cornerRadius = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
        }
      }
    }
  }

  // Auto-layout (flat properties per spec)
  if ("layoutMode" in node) {
    const frame = node as FrameNode;
    if (frame.layoutMode !== "NONE") {
      style.layout = frame.layoutMode;
      style.gap = frame.itemSpacing;
      style.primaryAxisAlign = frame.primaryAxisAlignItems;
      style.counterAxisAlign = frame.counterAxisAlignItems;
      style.primaryAxisSizing = frame.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed";
      style.counterAxisSizing = frame.counterAxisSizingMode === "AUTO" ? "hug" : "fixed";

      const pt = frame.paddingTop, pr = frame.paddingRight;
      const pb = frame.paddingBottom, pl = frame.paddingLeft;
      if (pt === pr && pr === pb && pb === pl) {
        style.padding = pt;
      } else {
        style.padding = { top: pt, right: pr, bottom: pb, left: pl };
      }
    }
  }

  // Clips content
  if ("clipsContent" in node) {
    style.clipsContent = (node as FrameNode).clipsContent;
  }

  // Blend mode
  if ("blendMode" in node) {
    const bm = (node as BlendMixin).blendMode;
    if (bm !== "NORMAL" && bm !== "PASS_THROUGH") {
      style.blendMode = bm;
    }
  }

  // Text style
  if (node.type === "TEXT") {
    const textStyle = serializeTextStyle(node as TextNode);
    if (textStyle) {
      if (textStyle.fontSize) style.fontSize = textStyle.fontSize;
      if (textStyle.fontFamily) style.fontFamily = textStyle.fontFamily;
      if (textStyle.fontWeight) style.fontWeight = textStyle.fontWeight;
      if (textStyle.textAlignHorizontal) style.textAlign = textStyle.textAlignHorizontal;
      if (textStyle.letterSpacing) style.letterSpacing = textStyle.letterSpacing;
      if (textStyle.lineHeight) style.lineHeight = textStyle.lineHeight;
    }
  }

  return style;
}

// ─── Tree Walker ────────────────────────────────────────────────────────────

const MAX_CHILDREN = 100;

function walkNode(
  node: SceneNode,
  depth: number,
  maxDepth: number,
  doAssignRoles: boolean,
  roleMap: RoleMapEntry[],
): SomNode {
  const roleResult: RoleResult = doAssignRoles
    ? assignRole(node)
    : { role: "unknown", roleCategory: "unknown", confidence: 0 };

  const somNode: SomNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    role: roleResult.role,
    roleCategory: roleResult.roleCategory,
    confidence: roleResult.confidence,
    content: extractContent(node),
    style: extractStyle(node),
  };

  // Collect role map entry during walk (avoids separate tree traversal)
  roleMap.push({
    nodeId: node.id,
    nodeName: node.name,
    role: roleResult.role,
    category: roleResult.roleCategory,
    confidence: roleResult.confidence,
  });

  // Recurse into children
  if (depth < maxDepth && "children" in node) {
    const parent = node as ChildrenMixin;
    const childCount = Math.min(parent.children.length, MAX_CHILDREN);
    const children: SomNode[] = [];
    for (let i = 0; i < childCount; i++) {
      children.push(walkNode(parent.children[i] as SceneNode, depth + 1, maxDepth, doAssignRoles, roleMap));
    }
    if (children.length > 0) {
      somNode.children = children;
    }
    if (parent.children.length > MAX_CHILDREN) {
      (somNode as any)._childrenTruncated = true;
      (somNode as any)._totalChildren = parent.children.length;
    }
  }

  return somNode;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function executeExtractSom(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const screenType = (payload.screenType as string) || "unknown";
  const platform = (payload.platform as string) || "unknown";
  const maxDepth = (payload.depth as number) || 10;
  const doAssignRoles = (payload.assignRoles as boolean) !== false; // default true

  const node = figma.getNodeById(nodeId) as SceneNode | null;
  if (!node) {
    throw new Error("Node " + nodeId + " not found");
  }

  // Walk the tree — collects roleMap during traversal (single walk)
  const roleMap: RoleMapEntry[] = [];
  const root = walkNode(node, 0, maxDepth, doAssignRoles, roleMap);

  // Override root node role to "screen"
  root.role = "screen";
  root.roleCategory = "structure";
  root.confidence = 1.0;
  roleMap[0].role = "screen";
  roleMap[0].category = "structure";
  roleMap[0].confidence = 1.0;

  // Derive stats from roleMap (no extra tree walk needed)
  const unknownNodes: string[] = [];
  let rolesAssigned = 0;
  let confidenceSum = 0;
  for (const entry of roleMap) {
    if (entry.role === "unknown") {
      unknownNodes.push(entry.nodeName);
    } else {
      rolesAssigned++;
    }
    confidenceSum += entry.confidence;
  }

  const totalNodes = roleMap.length;
  const overallConfidence = totalNodes > 0 ? Math.round((confidenceSum / totalNodes) * 100) / 100 : 0;

  return {
    som: {
      version: 2,
      platform,
      screenType,
      referenceFrame: {
        width: Math.round(node.width),
        height: Math.round(node.height),
      },
      root,
    },
    roleMap,
    unknownNodes,
    stats: {
      totalNodes,
      rolesAssigned,
      unknownCount: unknownNodes.length,
      overallConfidence,
    },
  };
}
