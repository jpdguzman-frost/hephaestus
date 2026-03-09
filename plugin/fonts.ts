// ─── Font Loading Protocol ──────────────────────────────────────────────────
// Handles font preloading, on-demand loading, and weight-to-style resolution
// for the Figma plugin sandbox environment.

/** Fonts to preload on plugin start. */
var PRELOAD_FONTS: FontName[] = [
  { family: "Inter", style: "Regular" },
  { family: "Inter", style: "Medium" },
  { family: "Inter", style: "Semi Bold" },
  { family: "Inter", style: "Bold" },
  { family: "Plus Jakarta Sans", style: "Regular" },
  { family: "Plus Jakarta Sans", style: "Medium" },
  { family: "Plus Jakarta Sans", style: "Bold" },
];

/**
 * Mapping from numeric font weight to possible Figma style names.
 * Multiple alternatives are tried in order (fonts vary in naming).
 */
var WEIGHT_ALTERNATIVES: Record<number, string[]> = {
  100: ["Thin", "Hairline"],
  200: ["Extra Light", "ExtraLight", "Ultra Light", "UltraLight"],
  300: ["Light"],
  400: ["Regular", "Normal", "Book"],
  500: ["Medium"],
  600: ["Semi Bold", "SemiBold", "Demi Bold", "DemiBold"],
  700: ["Bold"],
  800: ["Extra Bold", "ExtraBold", "Ultra Bold", "UltraBold"],
  900: ["Black", "Heavy"],
};

/**
 * Preload common fonts on plugin start.
 * Failures are logged but do not block startup.
 */
export async function preloadFonts(): Promise<void> {
  for (var i = 0; i < PRELOAD_FONTS.length; i++) {
    try {
      await figma.loadFontAsync(PRELOAD_FONTS[i]);
    } catch {
      console.warn("Could not preload font: " + PRELOAD_FONTS[i].family + " " + PRELOAD_FONTS[i].style);
    }
  }
}

/**
 * Ensure the required font is loaded before text operations.
 * If fontName is provided, loads that specific font.
 * Otherwise, loads all fonts currently used by the text node.
 */
export async function ensureFont(node: TextNode, fontName?: FontName): Promise<void> {
  if (fontName) {
    await loadFontWithFallback(fontName.family, fontName.style);
    return;
  }

  // Load all fonts used by the existing text
  if (node.characters.length > 0) {
    var fonts = node.getRangeAllFontNames(0, node.characters.length);
    for (var i = 0; i < fonts.length; i++) {
      await figma.loadFontAsync(fonts[i]);
    }
  } else {
    // Empty text node — load the default font
    var fontNameVal = node.fontName;
    if (fontNameVal !== figma.mixed) {
      await figma.loadFontAsync(fontNameVal);
    }
  }
}

/**
 * Resolve a font family + numeric weight to a Figma FontName.
 * Tries loading with fallback style names if the primary one fails.
 * Defaults to weight 400 (Regular) if not specified.
 */
export function resolveFontName(family: string, weight: number): FontName {
  var alternatives = WEIGHT_ALTERNATIVES[weight];
  if (alternatives && alternatives.length > 0) {
    return { family: family, style: alternatives[0] };
  }
  return { family: family, style: "Regular" };
}

/**
 * Try to load a font, falling back to alternative style names for the same weight.
 * If all alternatives fail, falls back to nearest available weight.
 */
export async function loadFontWithFallback(family: string, style: string): Promise<FontName> {
  // First try the exact style
  try {
    var font: FontName = { family: family, style: style };
    await figma.loadFontAsync(font);
    return font;
  } catch {
    // Continue to fallbacks
  }

  // Find which weight this style belongs to, then try alternatives
  var weight = findWeightForStyle(style);
  if (weight !== null) {
    var alts = WEIGHT_ALTERNATIVES[weight];
    if (alts) {
      for (var i = 0; i < alts.length; i++) {
        if (alts[i] === style) continue; // Already tried
        try {
          var altFont: FontName = { family: family, style: alts[i] };
          await figma.loadFontAsync(altFont);
          return altFont;
        } catch {
          // Try next alternative
        }
      }
    }

    // Try nearest weights (prefer heavier, then lighter)
    var nearbyWeights = getNearbyWeights(weight);
    for (var j = 0; j < nearbyWeights.length; j++) {
      var nearAlts = WEIGHT_ALTERNATIVES[nearbyWeights[j]];
      if (nearAlts) {
        for (var k = 0; k < nearAlts.length; k++) {
          try {
            var nearFont: FontName = { family: family, style: nearAlts[k] };
            await figma.loadFontAsync(nearFont);
            console.warn("Font fallback: " + family + " " + style + " → " + nearAlts[k]);
            return nearFont;
          } catch {
            // Try next
          }
        }
      }
    }
  }

  // Last resort: try Regular
  try {
    var regularFont: FontName = { family: family, style: "Regular" };
    await figma.loadFontAsync(regularFont);
    console.warn("Font fallback: " + family + " " + style + " → Regular");
    return regularFont;
  } catch {
    throw new Error('Font "' + family + " " + style + '" could not be loaded and no fallback found');
  }
}

/**
 * Resolve a weight number to a FontName, trying all alternatives and fallbacks.
 */
export async function resolveFontWithFallback(family: string, weight: number): Promise<FontName> {
  var alternatives = WEIGHT_ALTERNATIVES[weight];
  if (alternatives) {
    for (var i = 0; i < alternatives.length; i++) {
      try {
        var font: FontName = { family: family, style: alternatives[i] };
        await figma.loadFontAsync(font);
        return font;
      } catch {
        // Try next alternative
      }
    }
  }

  // Try nearby weights
  var nearby = getNearbyWeights(weight);
  for (var j = 0; j < nearby.length; j++) {
    var nearAlts = WEIGHT_ALTERNATIVES[nearby[j]];
    if (nearAlts) {
      for (var k = 0; k < nearAlts.length; k++) {
        try {
          var nearFont: FontName = { family: family, style: nearAlts[k] };
          await figma.loadFontAsync(nearFont);
          console.warn("Font fallback: " + family + " weight " + weight + " → " + nearAlts[k]);
          return nearFont;
        } catch {
          // Try next
        }
      }
    }
  }

  // Last resort
  try {
    var regularFont: FontName = { family: family, style: "Regular" };
    await figma.loadFontAsync(regularFont);
    console.warn("Font fallback: " + family + " weight " + weight + " → Regular");
    return regularFont;
  } catch {
    throw new Error('Font "' + family + '" weight ' + weight + " could not be loaded");
  }
}

function findWeightForStyle(style: string): number | null {
  var lowerStyle = style.toLowerCase();
  for (var weightStr in WEIGHT_ALTERNATIVES) {
    var weight = parseInt(weightStr, 10);
    var alts = WEIGHT_ALTERNATIVES[weight];
    for (var i = 0; i < alts.length; i++) {
      if (alts[i].toLowerCase() === lowerStyle) {
        return weight;
      }
    }
  }
  return null;
}

function getNearbyWeights(weight: number): number[] {
  // Return nearby weights, preferring heavier then lighter
  var allWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  var result: number[] = [];
  for (var dist = 100; dist <= 800; dist += 100) {
    var heavier = weight + dist;
    var lighter = weight - dist;
    if (allWeights.indexOf(heavier) !== -1) result.push(heavier);
    if (allWeights.indexOf(lighter) !== -1) result.push(lighter);
  }
  return result;
}
