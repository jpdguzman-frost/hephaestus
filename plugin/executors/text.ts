// ─── Text Executor ──────────────────────────────────────────────────────────
// SET_TEXT: set text content and style, with automatic font loading.

import { serializeNode, hexToColor } from "../serializer";
import { ensureFont, resolveFontWithFallback } from "../fonts";

/**
 * Set text content and/or style on a text node.
 * Handles font loading automatically before any text mutation.
 */
export async function executeSetText(payload: Record<string, unknown>): Promise<unknown> {
  var nodeId = payload.nodeId as string;
  var node = figma.getNodeById(nodeId) as TextNode;
  if (!node || node.type !== "TEXT") {
    throw new Error("Node " + nodeId + " is not a TEXT node");
  }

  var text = payload.text as string | undefined;
  var style = payload.style as Record<string, unknown> | undefined;
  var styleRanges = payload.styleRanges as Array<{ start: number; end: number; style: Record<string, unknown> }> | undefined;

  // Resolve the base font if style specifies one (with fallback for unavailable weights)
  var baseFontName: FontName | undefined;
  if (style && style.fontFamily) {
    baseFontName = await resolveFontWithFallback(
      style.fontFamily as string,
      (style.fontWeight as number) || 400
    );
  }

  // Load the font before any mutations
  if (baseFontName) {
    // Already loaded by resolveFontWithFallback
  } else {
    await ensureFont(node);
  }

  // Set the base font
  if (baseFontName) {
    node.fontName = baseFontName;
  }

  // Set text content
  if (text !== undefined) {
    node.characters = text;
  }

  // Apply base style to the entire text
  if (style) {
    applyTextStyle(node, style, 0, node.characters.length);
  }

  // Apply style ranges (mixed styling)
  if (styleRanges && styleRanges.length > 0) {
    for (var i = 0; i < styleRanges.length; i++) {
      var range = styleRanges[i];

      if (range.style.fontFamily) {
        var rangeFontName = await resolveFontWithFallback(
          range.style.fontFamily as string,
          (range.style.fontWeight as number) || 400
        );
        node.setRangeFontName(range.start, range.end, rangeFontName);
      } else if (range.style.fontWeight) {
        // Same family, different weight
        var currentFont = node.getRangeFontName(range.start, range.end);
        var family = currentFont !== figma.mixed ? currentFont.family : "Inter";
        var rangeFontName2 = await resolveFontWithFallback(family, range.style.fontWeight as number);
        node.setRangeFontName(range.start, range.end, rangeFontName2);
      }

      applyTextStyle(node, range.style, range.start, range.end);
    }
  }

  return serializeNode(node, 0);
}

function applyTextStyle(
  node: TextNode,
  style: Record<string, unknown>,
  start: number,
  end: number
): void {
  if (start >= end) return;

  var isFullRange = start === 0 && end === node.characters.length;

  if (style.fontSize !== undefined) {
    if (isFullRange) {
      node.fontSize = style.fontSize as number;
    } else {
      node.setRangeFontSize(start, end, style.fontSize as number);
    }
  }

  if (style.lineHeight !== undefined) {
    var lh = style.lineHeight;
    var lineHeight: LineHeight;
    if (typeof lh === "number") {
      lineHeight = { value: lh, unit: "PIXELS" };
    } else {
      var lhObj = lh as { value: number; unit: string };
      lineHeight = {
        value: lhObj.value,
        unit: lhObj.unit === "percent" ? "PERCENT" : "PIXELS",
      };
    }
    if (isFullRange) {
      node.lineHeight = lineHeight;
    } else {
      node.setRangeLineHeight(start, end, lineHeight);
    }
  }

  if (style.letterSpacing !== undefined) {
    var ls = style.letterSpacing;
    var letterSpacing: LetterSpacing;
    if (typeof ls === "number") {
      letterSpacing = { value: ls, unit: "PIXELS" };
    } else {
      var lsObj = ls as { value: number; unit: string };
      letterSpacing = {
        value: lsObj.value,
        unit: lsObj.unit === "percent" ? "PERCENT" : "PIXELS",
      };
    }
    if (isFullRange) {
      node.letterSpacing = letterSpacing;
    } else {
      node.setRangeLetterSpacing(start, end, letterSpacing);
    }
  }

  if (style.textDecoration !== undefined) {
    var dec = style.textDecoration as "NONE" | "UNDERLINE" | "STRIKETHROUGH";
    if (isFullRange) {
      node.textDecoration = dec;
    } else {
      node.setRangeTextDecoration(start, end, dec);
    }
  }

  if (style.textCase !== undefined) {
    var tc = style.textCase as "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
    if (isFullRange) {
      node.textCase = tc;
    } else {
      node.setRangeTextCase(start, end, tc);
    }
  }

  if (style.color !== undefined) {
    var parsed = hexToColor(style.color as string);
    var fills: SolidPaint[] = [{ type: "SOLID", color: parsed.color, opacity: parsed.opacity, visible: true }];
    if (isFullRange) {
      node.fills = fills;
    } else {
      node.setRangeFills(start, end, fills);
    }
  }

  // These only apply to the whole node, not ranges
  if (isFullRange) {
    if (style.textAlignHorizontal !== undefined) {
      node.textAlignHorizontal = style.textAlignHorizontal as "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    }
    if (style.textAlignVertical !== undefined) {
      node.textAlignVertical = style.textAlignVertical as "TOP" | "CENTER" | "BOTTOM";
    }
    if (style.textAutoResize !== undefined) {
      node.textAutoResize = style.textAutoResize as "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
    }
    if (style.paragraphSpacing !== undefined) {
      node.paragraphSpacing = style.paragraphSpacing as number;
    }
  }
}
