"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // plugin/idempotency.ts
  var MAX_ENTRIES = 500;
  var TTL_MS = 5 * 60 * 1e3;
  var IdempotencyCache = class {
    constructor() {
      this.cache = /* @__PURE__ */ new Map();
    }
    /** Check if a key exists and is not expired. */
    has(key) {
      const entry = this.cache.get(key);
      if (!entry) return false;
      if (Date.now() - entry.timestamp > TTL_MS) {
        this.cache.delete(key);
        return false;
      }
      return true;
    }
    /** Get cached result for a key. Returns undefined if not found or expired. */
    get(key) {
      const entry = this.cache.get(key);
      if (!entry) return void 0;
      if (Date.now() - entry.timestamp > TTL_MS) {
        this.cache.delete(key);
        return void 0;
      }
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.result;
    }
    /** Store a result with the given key. Evicts oldest entry if at capacity. */
    set(key, result2) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
      }
      if (this.cache.size >= MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== void 0) {
          this.cache.delete(oldest);
        }
      }
      this.cache.set(key, { result: result2, timestamp: Date.now() });
    }
  };

  // plugin/serializer.ts
  function colorToHex(color, opacity) {
    const r = Math.round(color.r * 255).toString(16).padStart(2, "0");
    const g = Math.round(color.g * 255).toString(16).padStart(2, "0");
    const b = Math.round(color.b * 255).toString(16).padStart(2, "0");
    if (opacity !== void 0 && opacity < 1) {
      const a = Math.round(opacity * 255).toString(16).padStart(2, "0");
      return `#${r}${g}${b}${a}`.toUpperCase();
    }
    return `#${r}${g}${b}`.toUpperCase();
  }
  function hexToColor(hex) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const opacity = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
    return { color: { r, g, b }, opacity };
  }
  function mapAxisAlign(align) {
    switch (align) {
      case "MIN":
        return "min";
      case "CENTER":
        return "center";
      case "MAX":
        return "max";
      case "SPACE_BETWEEN":
        return "space-between";
      default:
        return "min";
    }
  }
  function mapCounterAlign(align) {
    switch (align) {
      case "MIN":
        return "min";
      case "CENTER":
        return "center";
      case "MAX":
        return "max";
      case "BASELINE":
        return "baseline";
      default:
        return "min";
    }
  }
  function serializeAutoLayout(node) {
    if (node.layoutMode === "NONE") return void 0;
    return {
      direction: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
      wrap: node.layoutWrap === "WRAP" ? true : void 0,
      spacing: node.itemSpacing,
      padding: {
        top: node.paddingTop,
        right: node.paddingRight,
        bottom: node.paddingBottom,
        left: node.paddingLeft
      },
      primaryAxisAlign: mapAxisAlign(node.primaryAxisAlignItems),
      counterAxisAlign: mapCounterAlign(node.counterAxisAlignItems),
      primaryAxisSizing: node.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed",
      counterAxisSizing: node.counterAxisSizingMode === "AUTO" ? "hug" : "fixed"
    };
  }
  function serializePaint(paint) {
    if (!paint.visible && paint.visible !== void 0) return null;
    switch (paint.type) {
      case "SOLID": {
        const solid = paint;
        return {
          type: "solid",
          color: colorToHex(solid.color),
          opacity: solid.opacity
        };
      }
      case "GRADIENT_LINEAR": {
        const grad = paint;
        return {
          type: "linear-gradient",
          stops: grad.gradientStops.map((s) => ({
            position: s.position,
            color: colorToHex(s.color, s.color.a)
          }))
        };
      }
      case "GRADIENT_RADIAL": {
        const grad = paint;
        return {
          type: "radial-gradient",
          stops: grad.gradientStops.map((s) => ({
            position: s.position,
            color: colorToHex(s.color, s.color.a)
          }))
        };
      }
      case "IMAGE": {
        const img = paint;
        return {
          type: "image",
          imageHash: img.imageHash || "",
          scaleMode: img.scaleMode
        };
      }
      default:
        return { type: paint.type };
    }
  }
  function serializePaints(paints) {
    const result2 = [];
    for (const paint of paints) {
      const serialized = serializePaint(paint);
      if (serialized) result2.push(serialized);
    }
    return result2;
  }
  function serializeEffect(effect) {
    const base = {
      visible: effect.visible
    };
    switch (effect.type) {
      case "DROP_SHADOW": {
        const shadow = effect;
        return __spreadProps(__spreadValues({}, base), {
          type: "drop-shadow",
          color: colorToHex(shadow.color, shadow.color.a),
          offset: { x: shadow.offset.x, y: shadow.offset.y },
          blur: shadow.radius,
          spread: shadow.spread
        });
      }
      case "INNER_SHADOW": {
        const shadow = effect;
        return __spreadProps(__spreadValues({}, base), {
          type: "inner-shadow",
          color: colorToHex(shadow.color, shadow.color.a),
          offset: { x: shadow.offset.x, y: shadow.offset.y },
          blur: shadow.radius,
          spread: shadow.spread
        });
      }
      case "LAYER_BLUR": {
        const blur = effect;
        return __spreadProps(__spreadValues({}, base), {
          type: "layer-blur",
          blur: blur.radius
        });
      }
      case "BACKGROUND_BLUR": {
        const blur = effect;
        return __spreadProps(__spreadValues({}, base), {
          type: "background-blur",
          blur: blur.radius
        });
      }
      default:
        return __spreadProps(__spreadValues({}, base), { type: effect.type });
    }
  }
  function serializeEffects(effects) {
    return effects.map(serializeEffect);
  }
  function serializeTextStyle(node) {
    const style = {};
    const fontName = node.fontName;
    if (fontName !== figma.mixed) {
      style.fontFamily = fontName.family;
      style.fontWeight = getWeightFromStyle(fontName.style);
    }
    const fontSize = node.fontSize;
    if (fontSize !== figma.mixed) {
      style.fontSize = fontSize;
    }
    const lineHeight = node.lineHeight;
    if (lineHeight !== figma.mixed) {
      if (lineHeight.unit === "AUTO") {
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
    const fills = node.fills;
    if (fills !== figma.mixed && fills.length > 0) {
      const first = fills[0];
      if (first.type === "SOLID") {
        style.color = colorToHex(first.color, first.opacity);
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
  function getWeightFromStyle(style) {
    const lower = style.toLowerCase();
    if (lower.includes("thin")) return 100;
    if (lower.includes("extra light") || lower.includes("extralight")) return 200;
    if (lower.includes("light")) return 300;
    if (lower.includes("medium")) return 500;
    if (lower.includes("semi bold") || lower.includes("semibold")) return 600;
    if (lower.includes("extra bold") || lower.includes("extrabold")) return 800;
    if (lower.includes("bold")) return 700;
    if (lower.includes("black")) return 900;
    return 400;
  }
  function serializeNode(node, depth = 1, seen = /* @__PURE__ */ new Set()) {
    if (seen.has(node.id)) {
      return {
        nodeId: node.id,
        name: node.name,
        type: node.type,
        visible: true,
        locked: false,
        position: { x: node.x, y: node.y },
        size: { width: node.width, height: node.height },
        circular: true
      };
    }
    seen.add(node.id);
    const result2 = {
      nodeId: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
      locked: node.locked,
      position: { x: Math.round(node.x), y: Math.round(node.y) },
      size: { width: Math.round(node.width), height: Math.round(node.height) }
    };
    if (result2.visible === true) delete result2.visible;
    if (result2.locked === false) delete result2.locked;
    if ("rotation" in node) {
      const rot = node.rotation;
      if (rot !== 0) result2.rotation = Math.round(rot);
    }
    if (node.opacity !== 1) result2.opacity = Math.round(node.opacity * 100) / 100;
    if ("fills" in node) {
      const fills = node.fills;
      if (fills !== figma.mixed) {
        const serialized = serializePaints(fills);
        if (serialized.length > 0) result2.fills = serialized;
      }
    }
    if ("strokes" in node) {
      const strokes = node.strokes;
      const serialized = serializePaints(strokes);
      if (serialized.length > 0) {
        result2.strokes = serialized;
        if ("strokeWeight" in node) {
          const sw = node.strokeWeight;
          if (sw !== figma.mixed) result2.strokeWeight = sw;
        }
        if ("strokeAlign" in node) {
          const sa = node.strokeAlign;
          if (sa !== "INSIDE") result2.strokeAlign = sa;
        }
        if ("dashPattern" in node) {
          const dp = node.dashPattern;
          if (dp && dp.length > 0) result2.dashPattern = [...dp];
        }
      }
    }
    if ("blendMode" in node) {
      const bm = node.blendMode;
      if (bm !== "NORMAL" && bm !== "PASS_THROUGH") result2.blendMode = bm;
    }
    if ("effects" in node) {
      const effects = node.effects;
      if (effects.length > 0) result2.effects = serializeEffects(effects);
    }
    if ("cornerRadius" in node) {
      const cr = node.cornerRadius;
      if (cr !== figma.mixed) {
        if (cr !== 0) result2.cornerRadius = cr;
      } else {
        const rn = node;
        const tl = rn.topLeftRadius, tr = rn.topRightRadius;
        const br = rn.bottomRightRadius, bl = rn.bottomLeftRadius;
        if (tl !== 0 || tr !== 0 || br !== 0 || bl !== 0) {
          if (tl === tr && tr === br && br === bl) {
            result2.cornerRadius = tl;
          } else {
            result2.cornerRadius = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
          }
        }
      }
    }
    if ("clipsContent" in node) {
      if (!node.clipsContent) result2.clipsContent = false;
    }
    if ("layoutMode" in node) {
      const al = serializeAutoLayout(node);
      if (al) {
        const p = al.padding;
        if (p.top === p.right && p.right === p.bottom && p.bottom === p.left) {
          al.padding = p.top;
        }
        result2.autoLayout = al;
      }
    }
    if ("layoutSizingHorizontal" in node) {
      const lsh = node.layoutSizingHorizontal;
      if (lsh && lsh !== "FIXED") result2.layoutSizingHorizontal = lsh;
    }
    if ("layoutSizingVertical" in node) {
      const lsv = node.layoutSizingVertical;
      if (lsv && lsv !== "FIXED") result2.layoutSizingVertical = lsv;
    }
    if ("minWidth" in node) {
      const n = node;
      if (n.minWidth) result2.minWidth = n.minWidth;
      if (n.maxWidth) result2.maxWidth = n.maxWidth;
      if (n.minHeight) result2.minHeight = n.minHeight;
      if (n.maxHeight) result2.maxHeight = n.maxHeight;
    }
    if ("constraints" in node) {
      const c = node.constraints;
      if (!(c.horizontal === "SCALE" && c.vertical === "SCALE") && !(c.horizontal === "MIN" && c.vertical === "MIN")) {
        result2.constraints = { horizontal: c.horizontal, vertical: c.vertical };
      }
    }
    if (node.type === "TEXT") {
      const textNode = node;
      result2.characters = textNode.characters;
      result2.textStyle = serializeTextStyle(textNode);
    }
    if (node.type === "COMPONENT") {
      result2.componentKey = node.key;
    }
    if (node.type === "INSTANCE") {
      const instance = node;
      result2.componentKey = instance.mainComponent ? instance.mainComponent.key : void 0;
      try {
        const props = instance.componentProperties;
        if (props && Object.keys(props).length > 0) {
          result2.componentProperties = {};
          for (const [key, val] of Object.entries(props)) {
            result2.componentProperties[key] = {
              type: val.type,
              value: val.value
            };
          }
        }
      } catch (e) {
      }
    }
    if (depth > 0 && "children" in node) {
      const parent = node;
      const maxChildren = 100;
      const childSlice = parent.children.length > maxChildren ? parent.children.slice(0, maxChildren) : parent.children;
      result2.children = childSlice.map(
        (child) => serializeNode(child, depth - 1, new Set(seen))
      );
      if (parent.children.length > maxChildren) {
        result2._childrenTruncated = true;
        result2._totalChildren = parent.children.length;
      }
    }
    return result2;
  }

  // plugin/fonts.ts
  var PRELOAD_FONTS = [
    { family: "Inter", style: "Regular" },
    { family: "Inter", style: "Medium" },
    { family: "Inter", style: "Semi Bold" },
    { family: "Inter", style: "Bold" },
    { family: "Plus Jakarta Sans", style: "Regular" },
    { family: "Plus Jakarta Sans", style: "Medium" },
    { family: "Plus Jakarta Sans", style: "Bold" }
  ];
  var WEIGHT_ALTERNATIVES = {
    100: ["Thin", "Hairline"],
    200: ["Extra Light", "ExtraLight", "Ultra Light", "UltraLight"],
    300: ["Light"],
    400: ["Regular", "Normal", "Book"],
    500: ["Medium"],
    600: ["Semi Bold", "SemiBold", "Demi Bold", "DemiBold"],
    700: ["Bold"],
    800: ["Extra Bold", "ExtraBold", "Ultra Bold", "UltraBold"],
    900: ["Black", "Heavy"]
  };
  async function preloadFonts() {
    for (var i = 0; i < PRELOAD_FONTS.length; i++) {
      try {
        await figma.loadFontAsync(PRELOAD_FONTS[i]);
      } catch (e) {
        console.warn("Could not preload font: " + PRELOAD_FONTS[i].family + " " + PRELOAD_FONTS[i].style);
      }
    }
  }
  async function ensureFont(node, fontName) {
    if (fontName) {
      await loadFontWithFallback(fontName.family, fontName.style);
      return;
    }
    if (node.characters.length > 0) {
      var fonts = node.getRangeAllFontNames(0, node.characters.length);
      for (var i = 0; i < fonts.length; i++) {
        await figma.loadFontAsync(fonts[i]);
      }
    } else {
      var fontNameVal = node.fontName;
      if (fontNameVal !== figma.mixed) {
        await figma.loadFontAsync(fontNameVal);
      }
    }
  }
  async function loadFontWithFallback(family, style) {
    try {
      var font = { family, style };
      await figma.loadFontAsync(font);
      return font;
    } catch (e) {
    }
    var weight = findWeightForStyle(style);
    if (weight !== null) {
      var alts = WEIGHT_ALTERNATIVES[weight];
      if (alts) {
        for (var i = 0; i < alts.length; i++) {
          if (alts[i] === style) continue;
          try {
            var altFont = { family, style: alts[i] };
            await figma.loadFontAsync(altFont);
            return altFont;
          } catch (e) {
          }
        }
      }
      var nearbyWeights = getNearbyWeights(weight);
      for (var j = 0; j < nearbyWeights.length; j++) {
        var nearAlts = WEIGHT_ALTERNATIVES[nearbyWeights[j]];
        if (nearAlts) {
          for (var k = 0; k < nearAlts.length; k++) {
            try {
              var nearFont = { family, style: nearAlts[k] };
              await figma.loadFontAsync(nearFont);
              console.warn("Font fallback: " + family + " " + style + " \u2192 " + nearAlts[k]);
              return nearFont;
            } catch (e) {
            }
          }
        }
      }
    }
    try {
      var regularFont = { family, style: "Regular" };
      await figma.loadFontAsync(regularFont);
      console.warn("Font fallback: " + family + " " + style + " \u2192 Regular");
      return regularFont;
    } catch (e) {
      throw new Error('Font "' + family + " " + style + '" could not be loaded and no fallback found');
    }
  }
  async function resolveFontWithFallback(family, weight) {
    var alternatives = WEIGHT_ALTERNATIVES[weight];
    if (alternatives) {
      for (var i = 0; i < alternatives.length; i++) {
        try {
          var font = { family, style: alternatives[i] };
          await figma.loadFontAsync(font);
          return font;
        } catch (e) {
        }
      }
    }
    var nearby = getNearbyWeights(weight);
    for (var j = 0; j < nearby.length; j++) {
      var nearAlts = WEIGHT_ALTERNATIVES[nearby[j]];
      if (nearAlts) {
        for (var k = 0; k < nearAlts.length; k++) {
          try {
            var nearFont = { family, style: nearAlts[k] };
            await figma.loadFontAsync(nearFont);
            console.warn("Font fallback: " + family + " weight " + weight + " \u2192 " + nearAlts[k]);
            return nearFont;
          } catch (e) {
          }
        }
      }
    }
    try {
      var regularFont = { family, style: "Regular" };
      await figma.loadFontAsync(regularFont);
      console.warn("Font fallback: " + family + " weight " + weight + " \u2192 Regular");
      return regularFont;
    } catch (e) {
      throw new Error('Font "' + family + '" weight ' + weight + " could not be loaded");
    }
  }
  function findWeightForStyle(style) {
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
  function getNearbyWeights(weight) {
    var allWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    var result2 = [];
    for (var dist = 100; dist <= 800; dist += 100) {
      var heavier = weight + dist;
      var lighter = weight - dist;
      if (allWeights.indexOf(heavier) !== -1) result2.push(heavier);
      if (allWeights.indexOf(lighter) !== -1) result2.push(lighter);
    }
    return result2;
  }

  // plugin/transaction.ts
  async function executeAtomic(fn) {
    const createdNodes = [];
    try {
      return await fn(createdNodes);
    } catch (error) {
      for (const node of createdNodes.reverse()) {
        try {
          node.remove();
        } catch (e) {
        }
      }
      throw error;
    }
  }

  // plugin/executors/nodes.ts
  function getParent(parentId) {
    if (parentId) {
      const parent = figma.getNodeById(parentId);
      if (!parent) throw new Error(`Parent node ${parentId} not found`);
      if (!("children" in parent)) throw new Error(`Node ${parentId} cannot have children`);
      return parent;
    }
    return figma.currentPage;
  }
  function createSingleNode(type) {
    switch (type) {
      case "FRAME":
        return figma.createFrame();
      case "RECTANGLE":
        return figma.createRectangle();
      case "ELLIPSE":
        return figma.createEllipse();
      case "TEXT":
        return figma.createText();
      case "LINE":
        return figma.createLine();
      case "POLYGON":
        return figma.createPolygon();
      case "STAR":
        return figma.createStar();
      case "VECTOR":
        return figma.createVector();
      case "SECTION":
        return figma.createSection();
      case "COMPONENT":
        return figma.createComponent();
      case "COMPONENT_SET": {
        const c = figma.createComponent();
        c.name = "Variant 1";
        return figma.combineAsVariants([c], figma.currentPage);
      }
      default:
        throw new Error(`Unknown node type: ${type}`);
    }
  }
  function paintToFigmaPaint(paint) {
    var _a;
    switch (paint.type) {
      case "solid": {
        const { color, opacity: op } = hexToColor(paint.color);
        return {
          type: "SOLID",
          color,
          opacity: (_a = paint.opacity) != null ? _a : op,
          visible: true
        };
      }
      case "linear-gradient": {
        const stops = paint.stops.map((s) => {
          const { color, opacity: op } = hexToColor(s.color);
          return { position: s.position, color: __spreadProps(__spreadValues({}, color), { a: op }) };
        });
        return {
          type: "GRADIENT_LINEAR",
          gradientStops: stops,
          gradientTransform: [[1, 0, 0], [0, 1, 0]],
          visible: true
        };
      }
      case "radial-gradient": {
        const stops = paint.stops.map((s) => {
          const { color, opacity: op } = hexToColor(s.color);
          return { position: s.position, color: __spreadProps(__spreadValues({}, color), { a: op }) };
        });
        return {
          type: "GRADIENT_RADIAL",
          gradientStops: stops,
          gradientTransform: [[1, 0, 0], [0, 1, 0]],
          visible: true
        };
      }
      case "image": {
        return {
          type: "IMAGE",
          imageHash: paint.imageHash,
          scaleMode: paint.scaleMode || "FILL",
          visible: true
        };
      }
      default:
        return null;
    }
  }
  function applyFills(node, fills) {
    if (!("fills" in node)) return;
    const figmaFills = [];
    for (const fill of fills) {
      const paint = paintToFigmaPaint(fill);
      if (paint) figmaFills.push(paint);
    }
    node.fills = figmaFills;
  }
  function applyStrokes(node, strokes, weight, align) {
    if (!("strokes" in node)) return;
    const figmaStrokes = [];
    for (const stroke of strokes) {
      const paint = paintToFigmaPaint(stroke);
      if (paint) figmaStrokes.push(paint);
    }
    node.strokes = figmaStrokes;
    if (weight !== void 0) node.strokeWeight = weight;
    if (align && "strokeAlign" in node) {
      node.strokeAlign = align;
    }
  }
  function applyEffects(node, effects) {
    var _a, _b, _c, _d, _e, _f;
    if (!("effects" in node)) return;
    const figmaEffects = [];
    for (const effect of effects) {
      switch (effect.type) {
        case "drop-shadow": {
          const { color, opacity: op } = hexToColor(effect.color);
          figmaEffects.push({
            type: "DROP_SHADOW",
            color: __spreadProps(__spreadValues({}, color), { a: op }),
            offset: { x: effect.offset ? effect.offset.x : 0, y: effect.offset ? effect.offset.y : 0 },
            radius: (_a = effect.blur) != null ? _a : 0,
            spread: (_b = effect.spread) != null ? _b : 0,
            visible: effect.visible !== false,
            blendMode: "NORMAL"
          });
          break;
        }
        case "inner-shadow": {
          const { color, opacity: op } = hexToColor(effect.color);
          figmaEffects.push({
            type: "INNER_SHADOW",
            color: __spreadProps(__spreadValues({}, color), { a: op }),
            offset: { x: effect.offset ? effect.offset.x : 0, y: effect.offset ? effect.offset.y : 0 },
            radius: (_c = effect.blur) != null ? _c : 0,
            spread: (_d = effect.spread) != null ? _d : 0,
            visible: effect.visible !== false,
            blendMode: "NORMAL"
          });
          break;
        }
        case "layer-blur": {
          figmaEffects.push({
            type: "LAYER_BLUR",
            radius: (_e = effect.blur) != null ? _e : 0,
            visible: effect.visible !== false
          });
          break;
        }
        case "background-blur": {
          figmaEffects.push({
            type: "BACKGROUND_BLUR",
            radius: (_f = effect.blur) != null ? _f : 0,
            visible: effect.visible !== false
          });
          break;
        }
      }
    }
    node.effects = figmaEffects;
  }
  function applyCornerRadius(node, radius) {
    if (!("cornerRadius" in node)) return;
    const rn = node;
    if (typeof radius === "number") {
      rn.cornerRadius = radius;
    } else {
      rn.topLeftRadius = radius.topLeft;
      rn.topRightRadius = radius.topRight;
      rn.bottomRightRadius = radius.bottomRight;
      rn.bottomLeftRadius = radius.bottomLeft;
    }
  }
  function applyAutoLayout(node, params) {
    if (!("layoutMode" in node)) return;
    const frame = node;
    if (params.enabled === false) {
      frame.layoutMode = "NONE";
      return;
    }
    if (params.direction) {
      frame.layoutMode = params.direction === "horizontal" ? "HORIZONTAL" : "VERTICAL";
    } else if (frame.layoutMode === "NONE") {
      frame.layoutMode = "VERTICAL";
    }
    if (params.wrap !== void 0) {
      frame.layoutWrap = params.wrap ? "WRAP" : "NO_WRAP";
    }
    if (params.spacing !== void 0) {
      if (params.spacing === "auto") {
        frame.primaryAxisAlignItems = "SPACE_BETWEEN";
      } else {
        frame.itemSpacing = params.spacing;
      }
    }
    if (params.padding !== void 0) {
      if (typeof params.padding === "number") {
        frame.paddingTop = params.padding;
        frame.paddingRight = params.padding;
        frame.paddingBottom = params.padding;
        frame.paddingLeft = params.padding;
      } else {
        if (params.padding.top !== void 0) frame.paddingTop = params.padding.top;
        if (params.padding.right !== void 0) frame.paddingRight = params.padding.right;
        if (params.padding.bottom !== void 0) frame.paddingBottom = params.padding.bottom;
        if (params.padding.left !== void 0) frame.paddingLeft = params.padding.left;
      }
    }
    if (params.primaryAxisAlign) {
      const map = {
        min: "MIN",
        center: "CENTER",
        max: "MAX",
        "space-between": "SPACE_BETWEEN"
      };
      frame.primaryAxisAlignItems = map[params.primaryAxisAlign] || "MIN";
    }
    if (params.counterAxisAlign) {
      const map = {
        min: "MIN",
        center: "CENTER",
        max: "MAX",
        baseline: "BASELINE"
      };
      frame.counterAxisAlignItems = map[params.counterAxisAlign] || "MIN";
    }
    if (params.primaryAxisSizing) {
      frame.primaryAxisSizingMode = params.primaryAxisSizing === "hug" ? "AUTO" : "FIXED";
    }
    if (params.counterAxisSizing) {
      frame.counterAxisSizingMode = params.counterAxisSizing === "hug" ? "AUTO" : "FIXED";
    }
    if (params.strokesIncludedInLayout !== void 0) {
      frame.strokesIncludedInLayout = params.strokesIncludedInLayout;
    }
    if (params.itemReverseZIndex !== void 0) {
      frame.itemReverseZIndex = params.itemReverseZIndex;
    }
  }
  function applyLayoutChild(node, params) {
    if (params.alignSelf !== void 0) {
      node.layoutAlign = params.alignSelf === "stretch" ? "STRETCH" : "INHERIT";
    }
    if (params.grow !== void 0) {
      node.layoutGrow = params.grow;
    }
    if (params.positioning !== void 0) {
      node.layoutPositioning = params.positioning === "absolute" ? "ABSOLUTE" : "AUTO";
    }
  }
  async function applyProperties(node, payload2) {
    var _a, _b, _c;
    if (payload2.name) node.name = payload2.name;
    if (payload2.visible !== void 0) node.visible = payload2.visible;
    if (payload2.locked !== void 0) node.locked = payload2.locked;
    if (payload2.opacity !== void 0) node.opacity = payload2.opacity;
    if (payload2.position) {
      node.x = payload2.position.x;
      node.y = payload2.position.y;
    }
    if (payload2.size) {
      const w = (_a = payload2.size.width) != null ? _a : node.width;
      const h = (_c = (_b = payload2.size.height) != null ? _b : payload2.size.width) != null ? _c : node.height;
      node.resize(w, h);
    }
    if (payload2.fills) applyFills(node, payload2.fills);
    if (payload2.strokes) applyStrokes(node, payload2.strokes, payload2.strokeWeight, payload2.strokeAlign);
    if (payload2.effects) applyEffects(node, payload2.effects);
    if (payload2.cornerRadius !== void 0) applyCornerRadius(node, payload2.cornerRadius);
    if (payload2.autoLayout) applyAutoLayout(node, payload2.autoLayout);
    if (payload2.layoutChild) applyLayoutChild(node, payload2.layoutChild);
    if (payload2.blendMode && "blendMode" in node) {
      node.blendMode = payload2.blendMode;
    }
    if (payload2.clipsContent !== void 0 && "clipsContent" in node) {
      node.clipsContent = payload2.clipsContent;
    }
    if (node.type === "TEXT" && (payload2.text !== void 0 || payload2.textStyle)) {
      const textNode = node;
      var fontName;
      if (payload2.textStyle && payload2.textStyle.fontFamily) {
        fontName = await resolveFontWithFallback(
          payload2.textStyle.fontFamily,
          payload2.textStyle.fontWeight || 400
        );
      }
      if (!fontName) {
        await ensureFont(textNode);
      }
      if (fontName) {
        textNode.fontName = fontName;
      }
      if (payload2.text !== void 0) {
        textNode.characters = payload2.text;
      }
      if (payload2.textStyle) {
        const ts = payload2.textStyle;
        if (ts.fontSize !== void 0) textNode.fontSize = ts.fontSize;
        if (ts.lineHeight !== void 0) {
          if (typeof ts.lineHeight === "number") {
            textNode.lineHeight = { value: ts.lineHeight, unit: "PIXELS" };
          } else {
            textNode.lineHeight = {
              value: ts.lineHeight.value,
              unit: ts.lineHeight.unit === "percent" ? "PERCENT" : "PIXELS"
            };
          }
        }
        if (ts.letterSpacing !== void 0) {
          if (typeof ts.letterSpacing === "number") {
            textNode.letterSpacing = { value: ts.letterSpacing, unit: "PIXELS" };
          } else {
            textNode.letterSpacing = {
              value: ts.letterSpacing.value,
              unit: ts.letterSpacing.unit === "percent" ? "PERCENT" : "PIXELS"
            };
          }
        }
        if (ts.textAlignHorizontal) textNode.textAlignHorizontal = ts.textAlignHorizontal;
        if (ts.textAlignVertical) textNode.textAlignVertical = ts.textAlignVertical;
        if (ts.textAutoResize) textNode.textAutoResize = ts.textAutoResize;
        if (ts.textDecoration) textNode.textDecoration = ts.textDecoration;
        if (ts.textCase) textNode.textCase = ts.textCase;
        if (ts.paragraphSpacing !== void 0) textNode.paragraphSpacing = ts.paragraphSpacing;
        if (ts.maxLines !== void 0) textNode.maxLines = ts.maxLines;
        if (ts.color) {
          const { color, opacity: op } = hexToColor(ts.color);
          textNode.fills = [{ type: "SOLID", color, opacity: op, visible: true }];
        }
      }
    }
  }
  async function executeCreateNode(payload2) {
    return executeAtomic(async (createdNodes) => {
      async function createRecursive(p, parent2) {
        const node2 = createSingleNode(p.type);
        createdNodes.push(node2);
        parent2.appendChild(node2);
        await applyProperties(node2, p);
        if (p.children && "children" in node2) {
          for (const childPayload of p.children) {
            await createRecursive(childPayload, node2);
          }
        }
        return node2;
      }
      const parent = getParent(payload2.parentId);
      const node = await createRecursive(payload2, parent);
      return serializeNode(node, 2);
    });
  }
  async function executeUpdateNode(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    await applyProperties(node, payload2);
    return serializeNode(node, 1);
  }
  async function executeDeleteNodes(payload2) {
    const nodeIds = payload2.nodeIds;
    const deleted = [];
    const notFound = [];
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
  async function executeCloneNode(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const clone = node.clone();
    if (payload2.parentId) {
      const parent = getParent(payload2.parentId);
      parent.appendChild(clone);
    }
    if (payload2.position) {
      const pos = payload2.position;
      clone.x = pos.x;
      clone.y = pos.y;
    }
    if (payload2.name) {
      clone.name = payload2.name;
    }
    return serializeNode(clone, 1);
  }
  async function executeReparentNode(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const parent = getParent(payload2.parentId);
    const index = payload2.index;
    if (index !== void 0) {
      parent.insertChild(index, node);
    } else {
      parent.appendChild(node);
    }
    return serializeNode(node, 0);
  }
  async function executeReorderChildren(payload2) {
    const parentId = payload2.parentId;
    const childIds = payload2.childIds;
    const parent = figma.getNodeById(parentId);
    if (!parent || !("children" in parent)) {
      throw new Error(`Parent node ${parentId} not found or cannot have children`);
    }
    for (let i = 0; i < childIds.length; i++) {
      const child = figma.getNodeById(childIds[i]);
      if (child && child.parent === parent) {
        parent.insertChild(i, child);
      }
    }
    return serializeNode(parent, 1);
  }

  // plugin/executors/text.ts
  async function executeSetText(payload2) {
    var nodeId = payload2.nodeId;
    var node = figma.getNodeById(nodeId);
    if (!node || node.type !== "TEXT") {
      throw new Error("Node " + nodeId + " is not a TEXT node");
    }
    var text = payload2.text;
    var style = payload2.style;
    var styleRanges = payload2.styleRanges;
    var baseFontName;
    if (style && style.fontFamily) {
      baseFontName = await resolveFontWithFallback(
        style.fontFamily,
        style.fontWeight || 400
      );
    }
    if (baseFontName) {
    } else {
      await ensureFont(node);
    }
    if (baseFontName) {
      node.fontName = baseFontName;
    }
    if (text !== void 0) {
      node.characters = text;
    }
    if (style) {
      applyTextStyle(node, style, 0, node.characters.length);
    }
    if (styleRanges && styleRanges.length > 0) {
      for (var i = 0; i < styleRanges.length; i++) {
        var range = styleRanges[i];
        if (range.style.fontFamily) {
          var rangeFontName = await resolveFontWithFallback(
            range.style.fontFamily,
            range.style.fontWeight || 400
          );
          node.setRangeFontName(range.start, range.end, rangeFontName);
        } else if (range.style.fontWeight) {
          var currentFont = node.getRangeFontName(range.start, range.end);
          var family = currentFont !== figma.mixed ? currentFont.family : "Inter";
          var rangeFontName2 = await resolveFontWithFallback(family, range.style.fontWeight);
          node.setRangeFontName(range.start, range.end, rangeFontName2);
        }
        applyTextStyle(node, range.style, range.start, range.end);
      }
    }
    return serializeNode(node, 0);
  }
  function applyTextStyle(node, style, start, end) {
    if (start >= end) return;
    var isFullRange = start === 0 && end === node.characters.length;
    if (style.fontSize !== void 0) {
      if (isFullRange) {
        node.fontSize = style.fontSize;
      } else {
        node.setRangeFontSize(start, end, style.fontSize);
      }
    }
    if (style.lineHeight !== void 0) {
      var lh = style.lineHeight;
      var lineHeight;
      if (typeof lh === "number") {
        lineHeight = { value: lh, unit: "PIXELS" };
      } else {
        var lhObj = lh;
        lineHeight = {
          value: lhObj.value,
          unit: lhObj.unit === "percent" ? "PERCENT" : "PIXELS"
        };
      }
      if (isFullRange) {
        node.lineHeight = lineHeight;
      } else {
        node.setRangeLineHeight(start, end, lineHeight);
      }
    }
    if (style.letterSpacing !== void 0) {
      var ls = style.letterSpacing;
      var letterSpacing;
      if (typeof ls === "number") {
        letterSpacing = { value: ls, unit: "PIXELS" };
      } else {
        var lsObj = ls;
        letterSpacing = {
          value: lsObj.value,
          unit: lsObj.unit === "percent" ? "PERCENT" : "PIXELS"
        };
      }
      if (isFullRange) {
        node.letterSpacing = letterSpacing;
      } else {
        node.setRangeLetterSpacing(start, end, letterSpacing);
      }
    }
    if (style.textDecoration !== void 0) {
      var dec = style.textDecoration;
      if (isFullRange) {
        node.textDecoration = dec;
      } else {
        node.setRangeTextDecoration(start, end, dec);
      }
    }
    if (style.textCase !== void 0) {
      var tc = style.textCase;
      if (isFullRange) {
        node.textCase = tc;
      } else {
        node.setRangeTextCase(start, end, tc);
      }
    }
    if (style.color !== void 0) {
      var parsed = hexToColor(style.color);
      var fills = [{ type: "SOLID", color: parsed.color, opacity: parsed.opacity, visible: true }];
      if (isFullRange) {
        node.fills = fills;
      } else {
        node.setRangeFills(start, end, fills);
      }
    }
    if (isFullRange) {
      if (style.textAlignHorizontal !== void 0) {
        node.textAlignHorizontal = style.textAlignHorizontal;
      }
      if (style.textAlignVertical !== void 0) {
        node.textAlignVertical = style.textAlignVertical;
      }
      if (style.textAutoResize !== void 0) {
        node.textAutoResize = style.textAutoResize;
      }
      if (style.paragraphSpacing !== void 0) {
        node.paragraphSpacing = style.paragraphSpacing;
      }
    }
  }

  // plugin/executors/visual.ts
  async function executeSetFills(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("fills" in node)) throw new Error(`Node ${nodeId} does not support fills`);
    applyFills(node, payload2.fills);
    return serializeNode(node, 0);
  }
  async function executeSetStrokes(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("strokes" in node)) throw new Error(`Node ${nodeId} does not support strokes`);
    applyStrokes(
      node,
      payload2.strokes,
      payload2.strokeWeight,
      payload2.strokeAlign
    );
    if (payload2.dashPattern && "dashPattern" in node) {
      node.dashPattern = payload2.dashPattern;
    }
    if (payload2.strokeCap && "strokeCap" in node) {
      node.strokeCap = payload2.strokeCap;
    }
    if (payload2.strokeJoin && "strokeJoin" in node) {
      node.strokeJoin = payload2.strokeJoin;
    }
    return serializeNode(node, 0);
  }
  async function executeSetEffects(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("effects" in node)) throw new Error(`Node ${nodeId} does not support effects`);
    applyEffects(node, payload2.effects);
    return serializeNode(node, 0);
  }
  async function executeSetCornerRadius(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("cornerRadius" in node)) throw new Error(`Node ${nodeId} does not support corner radius`);
    applyCornerRadius(node, payload2.radius);
    return serializeNode(node, 0);
  }

  // plugin/executors/layout.ts
  async function executeSetAutoLayout(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("layoutMode" in node)) throw new Error(`Node ${nodeId} does not support auto-layout`);
    applyAutoLayout(node, payload2);
    return serializeNode(node, 1);
  }
  async function executeSetLayoutChild(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    applyLayoutChild(node, payload2);
    if (payload2.positioning === "absolute" && payload2.position) {
      const pos = payload2.position;
      node.x = pos.x;
      node.y = pos.y;
    }
    if (payload2.horizontalConstraint && "constraints" in node) {
      const constraints = node.constraints;
      const hMap = {
        min: "MIN",
        center: "CENTER",
        max: "MAX",
        stretch: "STRETCH",
        scale: "SCALE"
      };
      node.constraints = {
        horizontal: hMap[payload2.horizontalConstraint] || constraints.horizontal,
        vertical: constraints.vertical
      };
    }
    if (payload2.verticalConstraint && "constraints" in node) {
      const constraints = node.constraints;
      const vMap = {
        min: "MIN",
        center: "CENTER",
        max: "MAX",
        stretch: "STRETCH",
        scale: "SCALE"
      };
      node.constraints = {
        horizontal: constraints.horizontal,
        vertical: vMap[payload2.verticalConstraint] || constraints.vertical
      };
    }
    return serializeNode(node, 0);
  }
  async function executeBatchSetLayoutChildren(payload2) {
    const parentId = payload2.parentId;
    const parent = figma.getNodeById(parentId);
    if (!parent) throw new Error(`Parent node ${parentId} not found`);
    const children = payload2.children;
    const results = [];
    for (const child of children) {
      const result2 = await executeSetLayoutChild(child);
      results.push(result2);
    }
    return { parent: serializeNode(parent, 1), children: results };
  }
  async function executeSetLayoutGrid(payload2) {
    var _a, _b, _c, _d, _e, _f, _g;
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node || !("layoutGrids" in node)) {
      throw new Error(`Node ${nodeId} does not support layout grids`);
    }
    const grids = payload2.grids;
    const figmaGrids = [];
    for (const grid of grids) {
      const gridColor = grid.color ? hexToColor(grid.color) : { color: { r: 1, g: 0, b: 0 }, opacity: 0.1 };
      switch (grid.pattern) {
        case "columns":
          figmaGrids.push({
            pattern: "COLUMNS",
            alignment: mapGridAlignment(grid.alignment || "stretch"),
            gutterSize: (_a = grid.gutterSize) != null ? _a : 20,
            count: (_b = grid.count) != null ? _b : 12,
            sectionSize: grid.sectionSize,
            offset: (_c = grid.offset) != null ? _c : 0,
            visible: true,
            color: __spreadProps(__spreadValues({}, gridColor.color), { a: gridColor.opacity })
          });
          break;
        case "rows":
          figmaGrids.push({
            pattern: "ROWS",
            alignment: mapGridAlignment(grid.alignment || "stretch"),
            gutterSize: (_d = grid.gutterSize) != null ? _d : 20,
            count: (_e = grid.count) != null ? _e : 1,
            sectionSize: grid.sectionSize,
            offset: (_f = grid.offset) != null ? _f : 0,
            visible: true,
            color: __spreadProps(__spreadValues({}, gridColor.color), { a: gridColor.opacity })
          });
          break;
        case "grid":
          figmaGrids.push({
            pattern: "GRID",
            sectionSize: (_g = grid.sectionSize) != null ? _g : 10,
            visible: true,
            color: __spreadProps(__spreadValues({}, gridColor.color), { a: gridColor.opacity })
          });
          break;
      }
    }
    node.layoutGrids = figmaGrids;
    return serializeNode(node, 0);
  }
  function mapGridAlignment(align) {
    switch (align) {
      case "min":
        return "MIN";
      case "max":
        return "MAX";
      case "center":
        return "CENTER";
      case "stretch":
        return "STRETCH";
      default:
        return "STRETCH";
    }
  }
  async function executeSetConstraints(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (!("constraints" in node)) throw new Error(`Node ${nodeId} does not support constraints`);
    const constraintNode = node;
    const current = constraintNode.constraints;
    const hMap = {
      min: "MIN",
      center: "CENTER",
      max: "MAX",
      stretch: "STRETCH",
      scale: "SCALE"
    };
    const vMap = {
      min: "MIN",
      center: "CENTER",
      max: "MAX",
      stretch: "STRETCH",
      scale: "SCALE"
    };
    constraintNode.constraints = {
      horizontal: payload2.horizontal ? hMap[payload2.horizontal] || current.horizontal : current.horizontal,
      vertical: payload2.vertical ? vMap[payload2.vertical] || current.vertical : current.vertical
    };
    return serializeNode(node, 0);
  }

  // plugin/executors/components.ts
  async function executeInstantiateComponent(payload2) {
    let component = null;
    if (payload2.componentKey) {
      try {
        component = await figma.importComponentByKeyAsync(payload2.componentKey);
      } catch (e) {
        throw new Error(`Could not import component with key "${payload2.componentKey}": ${e}`);
      }
    } else if (payload2.nodeId) {
      const node = figma.getNodeById(payload2.nodeId);
      if (!node || node.type !== "COMPONENT") {
        throw new Error(`Node ${payload2.nodeId} is not a component`);
      }
      component = node;
    } else {
      throw new Error("Must provide either componentKey or nodeId");
    }
    if (!component) throw new Error("Component not found");
    if (payload2.variant && component.parent && component.parent.type === "COMPONENT_SET") {
      const componentSet = component.parent;
      const variant = payload2.variant;
      const variantName = Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(", ");
      const matchingVariant = componentSet.children.find(
        (child) => child.type === "COMPONENT" && child.name === variantName
      );
      if (matchingVariant) {
        component = matchingVariant;
      }
    }
    const instance = component.createInstance();
    if (payload2.parentId) {
      const parent = figma.getNodeById(payload2.parentId);
      if (parent && "children" in parent) {
        parent.appendChild(instance);
      }
    }
    if (payload2.position) {
      const pos = payload2.position;
      instance.x = pos.x;
      instance.y = pos.y;
    }
    if (payload2.overrides) {
      const overrides = payload2.overrides;
      for (const [propName, value] of Object.entries(overrides)) {
        try {
          instance.setProperties({ [propName]: value });
        } catch (e) {
          console.warn(`Could not set property "${propName}" on instance`);
        }
      }
    }
    return serializeNode(instance, 1);
  }
  async function executeSetInstanceProperties(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node || node.type !== "INSTANCE") {
      throw new Error(`Node ${nodeId} is not a component instance`);
    }
    const properties = payload2.properties;
    if (payload2.resetOverrides) {
      const resets = payload2.resetOverrides;
      for (const propName of resets) {
        try {
          node.resetOverrides();
        } catch (e) {
        }
      }
    }
    if (properties) {
      node.setProperties(properties);
    }
    return serializeNode(node, 1);
  }
  async function executeCreateComponent(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    const component = figma.createComponent();
    component.name = node.name;
    component.resize(node.width, node.height);
    component.x = node.x;
    component.y = node.y;
    while (node.children.length > 0) {
      component.appendChild(node.children[0]);
    }
    if (node.fills !== figma.mixed) component.fills = node.fills;
    component.strokes = node.strokes;
    component.effects = node.effects;
    component.clipsContent = node.clipsContent;
    if (node.layoutMode !== "NONE") {
      component.layoutMode = node.layoutMode;
      component.itemSpacing = node.itemSpacing;
      component.paddingTop = node.paddingTop;
      component.paddingRight = node.paddingRight;
      component.paddingBottom = node.paddingBottom;
      component.paddingLeft = node.paddingLeft;
      component.primaryAxisAlignItems = node.primaryAxisAlignItems;
      component.counterAxisAlignItems = node.counterAxisAlignItems;
      component.primaryAxisSizingMode = node.primaryAxisSizingMode;
      component.counterAxisSizingMode = node.counterAxisSizingMode;
    }
    if (node.parent) {
      const idx = node.parent.children.indexOf(node);
      node.parent.insertChild(idx, component);
    }
    if (payload2.description) {
      component.description = payload2.description;
    }
    node.remove();
    return __spreadProps(__spreadValues({}, serializeNode(component, 1)), {
      componentKey: component.key
    });
  }
  async function executeCreateComponentSet(payload2) {
    const componentIds = payload2.componentIds;
    const components = [];
    for (const id of componentIds) {
      const node = figma.getNodeById(id);
      if (!node || node.type !== "COMPONENT") {
        throw new Error(`Node ${id} is not a component`);
      }
      components.push(node);
    }
    const componentSet = figma.combineAsVariants(components, figma.currentPage);
    if (payload2.name) {
      componentSet.name = payload2.name;
    }
    return serializeNode(componentSet, 1);
  }
  async function executeAddComponentProperty(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node || node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node ${nodeId} is not a component or component set`);
    }
    const component = node;
    component.addComponentProperty(
      payload2.name,
      payload2.type,
      payload2.defaultValue
    );
    return serializeNode(component, 0);
  }
  async function executeEditComponentProperty(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node || node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node ${nodeId} is not a component or component set`);
    }
    const component = node;
    const updates = {};
    if (payload2.name !== void 0) updates.name = payload2.name;
    if (payload2.defaultValue !== void 0) updates.defaultValue = payload2.defaultValue;
    component.editComponentProperty(payload2.propertyName, updates);
    return serializeNode(component, 0);
  }
  async function executeDeleteComponentProperty(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node || node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
      throw new Error(`Node ${nodeId} is not a component or component set`);
    }
    const component = node;
    component.deleteComponentProperty(payload2.propertyName);
    return serializeNode(component, 0);
  }
  async function executeSetDescription(payload2) {
    const nodeId = payload2.nodeId;
    const node = figma.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if ("description" in node) {
      node.description = payload2.description;
    } else {
      throw new Error(`Node ${nodeId} does not support descriptions`);
    }
    return serializeNode(node, 0);
  }

  // plugin/executors/variables.ts
  async function executeCreateVariableCollection(payload2) {
    const collection = figma.variables.createVariableCollection(payload2.name);
    if (payload2.initialModeName) {
      collection.renameMode(collection.modes[0].modeId, payload2.initialModeName);
    }
    if (payload2.additionalModes) {
      for (const modeName of payload2.additionalModes) {
        collection.addMode(modeName);
      }
    }
    return {
      collectionId: collection.id,
      name: collection.name,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name }))
    };
  }
  async function executeDeleteVariableCollection(payload2) {
    const collectionId = payload2.collectionId;
    const collection = figma.variables.getVariableCollectionById(collectionId);
    if (!collection) throw new Error(`Variable collection ${collectionId} not found`);
    collection.remove();
    return { deleted: collectionId };
  }
  async function executeCreateVariables(payload2) {
    const collectionId = payload2.collectionId;
    const collection = figma.variables.getVariableCollectionById(collectionId);
    if (!collection) throw new Error(`Variable collection ${collectionId} not found`);
    const variables = payload2.variables;
    const created = [];
    for (const varDef of variables) {
      const variable = figma.variables.createVariable(
        varDef.name,
        collection,
        varDef.resolvedType
      );
      if (varDef.description) {
        variable.description = varDef.description;
      }
      if (varDef.valuesByMode) {
        for (const [modeKey, value] of Object.entries(varDef.valuesByMode)) {
          const mode = collection.modes.find((m) => m.modeId === modeKey || m.name === modeKey);
          if (mode) {
            const resolved = resolveVariableValue(varDef.resolvedType, value);
            variable.setValueForMode(mode.modeId, resolved);
          }
        }
      }
      created.push({ variableId: variable.id, name: variable.name });
    }
    return { created };
  }
  async function executeUpdateVariables(payload2) {
    const updates = payload2.updates;
    const results = [];
    for (const update of updates) {
      const variable = figma.variables.getVariableById(update.variableId);
      if (!variable) {
        results.push({ variableId: update.variableId, updated: false });
        continue;
      }
      const resolved = resolveVariableValue(variable.resolvedType, update.value);
      variable.setValueForMode(update.modeId, resolved);
      results.push({ variableId: update.variableId, updated: true });
    }
    return { results };
  }
  async function executeDeleteVariable(payload2) {
    const variableId = payload2.variableId;
    const variable = figma.variables.getVariableById(variableId);
    if (!variable) throw new Error(`Variable ${variableId} not found`);
    variable.remove();
    return { deleted: variableId };
  }
  async function executeRenameVariable(payload2) {
    const variableId = payload2.variableId;
    const variable = figma.variables.getVariableById(variableId);
    if (!variable) throw new Error(`Variable ${variableId} not found`);
    variable.name = payload2.newName;
    return { variableId, name: variable.name };
  }
  async function executeAddMode(payload2) {
    const collectionId = payload2.collectionId;
    const collection = figma.variables.getVariableCollectionById(collectionId);
    if (!collection) throw new Error(`Variable collection ${collectionId} not found`);
    collection.addMode(payload2.modeName);
    return {
      collectionId,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name }))
    };
  }
  async function executeRenameMode(payload2) {
    const collectionId = payload2.collectionId;
    const collection = figma.variables.getVariableCollectionById(collectionId);
    if (!collection) throw new Error(`Variable collection ${collectionId} not found`);
    collection.renameMode(payload2.modeId, payload2.newName);
    return {
      collectionId,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name }))
    };
  }
  async function executeSetupDesignTokens(payload2) {
    const collectionName = payload2.collectionName;
    const modeNames = payload2.modes;
    const tokens = payload2.tokens;
    const collection = figma.variables.createVariableCollection(collectionName);
    collection.renameMode(collection.modes[0].modeId, modeNames[0]);
    for (let i = 1; i < modeNames.length; i++) {
      collection.addMode(modeNames[i]);
    }
    const modeMap = /* @__PURE__ */ new Map();
    for (const mode of collection.modes) {
      modeMap.set(mode.name, mode.modeId);
    }
    const created = [];
    for (const tokenDef of tokens) {
      const variable = figma.variables.createVariable(
        tokenDef.name,
        collection,
        tokenDef.resolvedType
      );
      if (tokenDef.description) {
        variable.description = tokenDef.description;
      }
      for (const [modeName, value] of Object.entries(tokenDef.values)) {
        const modeId = modeMap.get(modeName);
        if (modeId) {
          const resolved = resolveVariableValue(tokenDef.resolvedType, value);
          variable.setValueForMode(modeId, resolved);
        }
      }
      created.push({ variableId: variable.id, name: variable.name });
    }
    return {
      collectionId: collection.id,
      collectionName: collection.name,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      variables: created
    };
  }
  function resolveVariableValue(resolvedType, value) {
    switch (resolvedType) {
      case "COLOR": {
        if (typeof value === "string") {
          const { color, opacity } = hexToColor(value);
          return { r: color.r, g: color.g, b: color.b, a: opacity };
        }
        return value;
      }
      case "FLOAT":
        return typeof value === "number" ? value : parseFloat(value);
      case "STRING":
        return String(value);
      case "BOOLEAN":
        return Boolean(value);
      default:
        return value;
    }
  }

  // plugin/executors/pages.ts
  async function executeCreatePage(payload2) {
    const page = figma.createPage();
    page.name = payload2.name;
    if (payload2.index !== void 0) {
      const idx = payload2.index;
      const doc = figma.root;
      doc.insertChild(Math.min(idx, doc.children.length), page);
    }
    return {
      pageId: page.id,
      name: page.name
    };
  }
  async function executeRenamePage(payload2) {
    const pageId = payload2.pageId;
    const page = figma.getNodeById(pageId);
    if (!page || page.type !== "PAGE") {
      throw new Error(`Page ${pageId} not found`);
    }
    page.name = payload2.name;
    return {
      pageId: page.id,
      name: page.name
    };
  }
  async function executeDeletePage(payload2) {
    const pageId = payload2.pageId;
    const page = figma.getNodeById(pageId);
    if (!page || page.type !== "PAGE") {
      throw new Error(`Page ${pageId} not found`);
    }
    if (figma.root.children.length <= 1) {
      throw new Error("Cannot delete the last page in the document");
    }
    if (figma.currentPage === page) {
      const otherPage = figma.root.children.find((p) => p.id !== pageId);
      if (otherPage) {
        figma.currentPage = otherPage;
      }
    }
    page.remove();
    return { deleted: pageId };
  }
  async function executeSetCurrentPage(payload2) {
    const pageId = payload2.pageId;
    const page = figma.getNodeById(pageId);
    if (!page || page.type !== "PAGE") {
      throw new Error(`Page ${pageId} not found`);
    }
    figma.currentPage = page;
    return {
      pageId: page.id,
      name: page.name
    };
  }

  // plugin/executors/utility.ts
  async function executeExecute(payload) {
    const code = payload.code;
    const timeout = Math.min(payload.timeout || 1e4, 3e4);
    if (code.includes("fetch(") || code.includes("fetch (")) {
      throw new Error("Access to fetch is not allowed in execute commands");
    }
    if (code.includes("__html__")) {
      throw new Error("Access to __html__ is not allowed in execute commands");
    }
    if (code.includes("XMLHttpRequest")) {
      throw new Error("Access to XMLHttpRequest is not allowed in execute commands");
    }
    const wrappedCode = `(async () => { ${code} })()`;
    const result = await Promise.race([
      eval(wrappedCode),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout);
      })
    ]);
    try {
      return JSON.parse(JSON.stringify(result));
    } catch (e) {
      return { value: String(result) };
    }
  }
  async function executePing(_payload) {
    return {
      status: "ok",
      timestamp: Date.now(),
      fileKey: figma.fileKey,
      fileName: figma.root.name,
      currentPage: {
        id: figma.currentPage.id,
        name: figma.currentPage.name
      }
    };
  }

  // plugin/executor.ts
  async function executeGetNode(payload2) {
    var _a;
    const nodeIds = payload2.nodeIds;
    const depth = (_a = payload2.depth) != null ? _a : 1;
    const results = [];
    for (const id of nodeIds) {
      const node = figma.getNodeById(id);
      if (node) {
        results.push(serializeNode(node, depth));
      } else {
        results.push({ nodeId: id, error: "not found" });
      }
    }
    return { nodes: results };
  }
  async function executeGetSelection(payload2) {
    var _a, _b;
    const selection = figma.currentPage.selection;
    const includeChildren = (_a = payload2.includeChildren) != null ? _a : false;
    const depth = includeChildren ? (_b = payload2.depth) != null ? _b : 1 : 0;
    return {
      nodes: selection.map((node) => serializeNode(node, depth)),
      count: selection.length
    };
  }
  async function executeSearchNodes(payload2) {
    var _a;
    const query = payload2.query;
    const type = payload2.type;
    const withinId = payload2.withinId;
    const limit = (_a = payload2.limit) != null ? _a : 20;
    const searchRoot = withinId ? figma.getNodeById(withinId) : figma.currentPage;
    if (!searchRoot || !("children" in searchRoot)) {
      throw new Error("Search root not found or cannot have children");
    }
    const results = [];
    function search(node) {
      if (results.length >= limit) return;
      if (type && node.type !== type) {
      } else if (query) {
        if (node.name.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            nodeId: node.id,
            name: node.name,
            type: node.type,
            parentId: node.parent ? node.parent.id : void 0
          });
        }
      } else if (type && node.type === type) {
        results.push({
          nodeId: node.id,
          name: node.name,
          type: node.type,
          parentId: node.parent ? node.parent.id : void 0
        });
      }
      if ("children" in node) {
        for (const child of node.children) {
          if (results.length >= limit) break;
          search(child);
        }
      }
    }
    for (const child of searchRoot.children) {
      if (results.length >= limit) break;
      search(child);
    }
    return { nodes: results, count: results.length };
  }
  async function executeScreenshot(payload2) {
    var _a;
    const nodeId = payload2.nodeId;
    const format = (_a = payload2.format) != null ? _a : "png";
    var requestedScale = payload2.scale || 0;
    var maxDimension = payload2.maxDimension || 0;
    let target;
    if (nodeId) {
      const node = figma.getNodeById(nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found`);
      target = node;
    } else {
      const selection = figma.currentPage.selection;
      if (selection.length > 0) {
        target = selection[0];
      } else if (figma.currentPage.children.length > 0) {
        target = figma.currentPage.children[0];
      } else {
        throw new Error("No node to capture \u2014 page is empty");
      }
    }
    var effectiveMaxDimension = maxDimension > 0 ? maxDimension : 2048;
    var scale = requestedScale || 2;
    var maxSide = Math.max(target.width, target.height);
    if (maxSide * scale > effectiveMaxDimension) {
      scale = effectiveMaxDimension / maxSide;
      scale = Math.max(0.5, Math.min(4, scale));
    }
    var settings;
    if (format === "svg") {
      settings = { format: "SVG" };
    } else if (format === "jpg") {
      settings = { format: "JPG", constraint: { type: "SCALE", value: scale } };
    } else {
      settings = { format: "PNG", constraint: { type: "SCALE", value: scale } };
    }
    var bytes = await target.exportAsync(settings);
    var base64 = uint8ArrayToBase64(bytes);
    return {
      data: base64,
      format,
      width: target.width * scale,
      height: target.height * scale,
      nodeId: target.id
    };
  }
  var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function uint8ArrayToBase64(bytes) {
    var result2 = "";
    var len = bytes.length;
    var i = 0;
    while (i < len) {
      var a = bytes[i++] || 0;
      var b = i < len ? bytes[i++] : 0;
      var c = i < len ? bytes[i++] : 0;
      var triplet = a << 16 | b << 8 | c;
      result2 += B64_CHARS[triplet >> 18 & 63];
      result2 += B64_CHARS[triplet >> 12 & 63];
      result2 += i - 2 < len ? B64_CHARS[triplet >> 6 & 63] : "=";
      result2 += i - 1 < len ? B64_CHARS[triplet & 63] : "=";
    }
    return result2;
  }
  async function executeGetStyles(payload2) {
    var types = payload2.types;
    var styles = [];
    var textStyles = figma.getLocalTextStyles();
    var paintStyles = figma.getLocalPaintStyles();
    var effectStyles = figma.getLocalEffectStyles();
    var gridStyles = figma.getLocalGridStyles();
    if (!types || types.indexOf("text") !== -1) {
      for (var i = 0; i < textStyles.length; i++) {
        var ts = textStyles[i];
        styles.push({
          key: ts.key,
          name: ts.name,
          type: "TEXT",
          description: ts.description,
          fontSize: ts.fontSize,
          fontName: ts.fontName
        });
      }
    }
    if (!types || types.indexOf("fill") !== -1) {
      for (var j = 0; j < paintStyles.length; j++) {
        var ps = paintStyles[j];
        styles.push({
          key: ps.key,
          name: ps.name,
          type: "FILL",
          description: ps.description,
          paintCount: ps.paints.length
        });
      }
    }
    if (!types || types.indexOf("effect") !== -1) {
      for (var k = 0; k < effectStyles.length; k++) {
        var es = effectStyles[k];
        styles.push({
          key: es.key,
          name: es.name,
          type: "EFFECT",
          description: es.description,
          effectCount: es.effects.length
        });
      }
    }
    if (!types || types.indexOf("grid") !== -1) {
      for (var g = 0; g < gridStyles.length; g++) {
        var gs = gridStyles[g];
        styles.push({
          key: gs.key,
          name: gs.name,
          type: "GRID",
          description: gs.description
        });
      }
    }
    return { styles, count: styles.length };
  }
  async function executeGetVariables(payload2) {
    var collections = figma.variables.getLocalVariableCollections();
    var collectionFilter = payload2.collection;
    var namePattern = payload2.namePattern;
    var resolvedType = payload2.resolvedType;
    var result2 = [];
    for (var i = 0; i < collections.length; i++) {
      var col = collections[i];
      if (collectionFilter && col.name.toLowerCase().indexOf(collectionFilter.toLowerCase()) === -1) {
        continue;
      }
      var variables = [];
      for (var j = 0; j < col.variableIds.length; j++) {
        var v = figma.variables.getVariableById(col.variableIds[j]);
        if (!v) continue;
        if (namePattern) {
          var regex = new RegExp(namePattern, "i");
          if (!regex.test(v.name)) continue;
        }
        if (resolvedType && v.resolvedType !== resolvedType) continue;
        var valuesByMode = {};
        for (var m = 0; m < col.modes.length; m++) {
          var mode = col.modes[m];
          valuesByMode[mode.name] = v.valuesByMode[mode.modeId];
        }
        variables.push({
          id: v.id,
          name: v.name,
          resolvedType: v.resolvedType,
          description: v.description,
          valuesByMode
        });
      }
      result2.push({
        id: col.id,
        name: col.name,
        modes: col.modes.map(function(m2) {
          return { modeId: m2.modeId, name: m2.name };
        }),
        variables
      });
    }
    return { collections: result2 };
  }
  async function executeGetComponents(payload2) {
    var query = payload2.query;
    var limit = payload2.limit || 25;
    var components = [];
    function searchForComponents(node) {
      if (components.length >= limit) return;
      if (node.type === "COMPONENT") {
        var comp = node;
        if (!query || comp.name.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
          components.push({
            nodeId: comp.id,
            key: comp.key,
            name: comp.name,
            description: comp.description,
            parent: comp.parent ? comp.parent.name : null
          });
        }
      }
      if (node.type === "COMPONENT_SET") {
        var set = node;
        if (!query || set.name.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
          components.push({
            nodeId: set.id,
            key: set.key,
            name: set.name,
            description: set.description,
            type: "COMPONENT_SET",
            variantCount: set.children.length
          });
        }
      }
      if ("children" in node) {
        var children = node.children;
        for (var i = 0; i < children.length; i++) {
          if (components.length >= limit) break;
          searchForComponents(children[i]);
        }
      }
    }
    for (var p = 0; p < figma.root.children.length; p++) {
      if (components.length >= limit) break;
      searchForComponents(figma.root.children[p]);
    }
    return { components, count: components.length };
  }
  var EXECUTOR_MAP = {
    // Node commands
    CREATE_NODE: executeCreateNode,
    UPDATE_NODE: executeUpdateNode,
    DELETE_NODES: executeDeleteNodes,
    CLONE_NODE: executeCloneNode,
    REPARENT_NODE: executeReparentNode,
    REORDER_CHILDREN: executeReorderChildren,
    // Text commands
    SET_TEXT: executeSetText,
    // Visual commands
    SET_FILLS: executeSetFills,
    SET_STROKES: executeSetStrokes,
    SET_EFFECTS: executeSetEffects,
    SET_CORNER_RADIUS: executeSetCornerRadius,
    // Layout commands
    SET_AUTO_LAYOUT: executeSetAutoLayout,
    SET_LAYOUT_CHILD: executeSetLayoutChild,
    BATCH_SET_LAYOUT_CHILDREN: executeBatchSetLayoutChildren,
    SET_LAYOUT_GRID: executeSetLayoutGrid,
    SET_CONSTRAINTS: executeSetConstraints,
    // Component commands
    INSTANTIATE_COMPONENT: executeInstantiateComponent,
    SET_INSTANCE_PROPERTIES: executeSetInstanceProperties,
    CREATE_COMPONENT: executeCreateComponent,
    CREATE_COMPONENT_SET: executeCreateComponentSet,
    ADD_COMPONENT_PROPERTY: executeAddComponentProperty,
    EDIT_COMPONENT_PROPERTY: executeEditComponentProperty,
    DELETE_COMPONENT_PROPERTY: executeDeleteComponentProperty,
    SET_DESCRIPTION: executeSetDescription,
    // Variable commands
    CREATE_VARIABLE_COLLECTION: executeCreateVariableCollection,
    DELETE_VARIABLE_COLLECTION: executeDeleteVariableCollection,
    CREATE_VARIABLES: executeCreateVariables,
    UPDATE_VARIABLES: executeUpdateVariables,
    DELETE_VARIABLE: executeDeleteVariable,
    RENAME_VARIABLE: executeRenameVariable,
    ADD_MODE: executeAddMode,
    RENAME_MODE: executeRenameMode,
    SETUP_DESIGN_TOKENS: executeSetupDesignTokens,
    // Page commands
    CREATE_PAGE: executeCreatePage,
    RENAME_PAGE: executeRenamePage,
    DELETE_PAGE: executeDeletePage,
    SET_CURRENT_PAGE: executeSetCurrentPage,
    // Read commands
    GET_NODE: executeGetNode,
    GET_SELECTION: executeGetSelection,
    SEARCH_NODES: executeSearchNodes,
    SCREENSHOT: executeScreenshot,
    GET_STYLES: executeGetStyles,
    GET_VARIABLES: executeGetVariables,
    GET_COMPONENTS: executeGetComponents,
    // Utility commands
    EXECUTE: executeExecute,
    PING: executePing
  };
  var READ_COMMANDS = /* @__PURE__ */ new Set(["GET_NODE", "GET_SELECTION", "SEARCH_NODES", "SCREENSHOT", "PING", "GET_STYLES", "GET_VARIABLES", "GET_COMPONENTS"]);
  var Executor = class {
    constructor() {
      this.cache = new IdempotencyCache();
      this.queue = [];
      this.processing = false;
    }
    /**
     * Get the list of supported command types.
     */
    getSupportedTypes() {
      return Object.keys(EXECUTOR_MAP);
    }
    /**
     * Execute a command and return a result envelope.
     * Commands are queued for sequential FIFO execution.
     */
    async executeCommand(command) {
      var start = Date.now();
      figma.ui.postMessage({ type: "forging-start" });
      try {
        if (Date.now() - command.timestamp > command.ttl) {
          return {
            id: command.id,
            status: "error",
            error: {
              category: "COMMAND_TIMEOUT",
              message: `Command expired (TTL: ${command.ttl}ms)`,
              retryable: false
            },
            duration: Date.now() - start,
            timestamp: Date.now(),
            batchId: command.batchId,
            batchSeq: command.batchSeq
          };
        }
        if (command.idempotencyKey && this.cache.has(command.idempotencyKey)) {
          const cached = this.cache.get(command.idempotencyKey);
          return {
            id: command.id,
            status: "success",
            result: cached,
            duration: Date.now() - start,
            timestamp: Date.now(),
            batchId: command.batchId,
            batchSeq: command.batchSeq
          };
        }
        const executor = EXECUTOR_MAP[command.type];
        if (!executor) {
          return {
            id: command.id,
            status: "error",
            error: {
              category: "INVALID_OPERATION",
              message: `Unknown command type: ${command.type}`,
              retryable: false,
              suggestion: `Supported types: ${Object.keys(EXECUTOR_MAP).join(", ")}`
            },
            duration: Date.now() - start,
            timestamp: Date.now(),
            batchId: command.batchId,
            batchSeq: command.batchSeq
          };
        }
        const timeout2 = command.ttl;
        const result2 = await Promise.race([
          executor(command.payload),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Command timed out after ${timeout2}ms`)), timeout2);
          })
        ]);
        if (command.idempotencyKey) {
          this.cache.set(command.idempotencyKey, result2);
        }
        return {
          id: command.id,
          status: "success",
          result: result2,
          duration: Date.now() - start,
          timestamp: Date.now(),
          batchId: command.batchId,
          batchSeq: command.batchSeq
        };
      } catch (error) {
        var err = error;
        var category = categorizeError(err);
        return {
          id: command.id,
          status: "error",
          error: {
            category,
            message: err.message || String(err),
            figmaError: err.message,
            retryable: isRetryable(category),
            suggestion: getSuggestion(category, err)
          },
          duration: Date.now() - start,
          timestamp: Date.now(),
          batchId: command.batchId,
          batchSeq: command.batchSeq
        };
      } finally {
        figma.ui.postMessage({ type: "forging-stop" });
      }
    }
    /**
     * Check if a command is a read-only operation that can run in parallel.
     */
    isReadCommand(command) {
      return READ_COMMANDS.has(command.type);
    }
    /**
     * Execute commands with parallel reads: partitions into consecutive
     * read/write groups, runs read groups concurrently (up to maxConcurrency),
     * and write groups sequentially. Preserves ordering between groups.
     */
    async executeCommandsParallel(commands, maxConcurrency = 5, onProgress) {
      if (commands.length === 0) return [];
      var groups = [];
      var currentIsRead = this.isReadCommand(commands[0]);
      var currentGroup = [];
      for (var i = 0; i < commands.length; i++) {
        var cmdIsRead = this.isReadCommand(commands[i]);
        if (cmdIsRead !== currentIsRead) {
          groups.push({ isRead: currentIsRead, commands: currentGroup });
          currentGroup = [];
          currentIsRead = cmdIsRead;
        }
        currentGroup.push({ cmd: commands[i], originalIndex: i });
      }
      if (currentGroup.length > 0) {
        groups.push({ isRead: currentIsRead, commands: currentGroup });
      }
      var allResults = [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (group.isRead && group.commands.length > 1) {
          var pending = [];
          var qi = 0;
          while (qi < group.commands.length) {
            var batch = group.commands.slice(qi, qi + maxConcurrency);
            pending = batch.map(function(entry2) {
              if (onProgress) onProgress(entry2.cmd, entry2.originalIndex, commands.length);
              return this.executeCommand(entry2.cmd).then(function(result3) {
                allResults.push({ index: entry2.originalIndex, result: result3 });
              });
            }.bind(this));
            await Promise.all(pending);
            qi += maxConcurrency;
          }
        } else {
          for (var s = 0; s < group.commands.length; s++) {
            var entry = group.commands[s];
            if (onProgress) onProgress(entry.cmd, entry.originalIndex, commands.length);
            var result2 = await this.executeCommand(entry.cmd);
            allResults.push({ index: entry.originalIndex, result: result2 });
          }
        }
      }
      allResults.sort(function(a, b) {
        return a.index - b.index;
      });
      return allResults.map(function(r) {
        return r.result;
      });
    }
    /**
     * Execute an array of commands sequentially (FIFO).
     * Commands with the same batchId and atomic flag are grouped —
     * if any command in a batch fails, the entire batch is rolled back.
     */
    async executeCommands(commands) {
      const results = [];
      const batches = /* @__PURE__ */ new Map();
      const standalone = [];
      for (const cmd of commands) {
        if (cmd.batchId && cmd.atomic) {
          const group = batches.get(cmd.batchId) || [];
          group.push(cmd);
          batches.set(cmd.batchId, group);
        } else {
          standalone.push(cmd);
        }
      }
      for (const cmd of standalone) {
        const result2 = await this.executeCommand(cmd);
        results.push(result2);
      }
      for (const [batchId, batchCmds] of batches) {
        batchCmds.sort((a, b) => {
          var _a, _b;
          return ((_a = a.batchSeq) != null ? _a : 0) - ((_b = b.batchSeq) != null ? _b : 0);
        });
        const snapshots = [];
        for (const cmd of batchCmds) {
          const nodeId = cmd.payload.nodeId;
          if (nodeId) {
            const node = figma.getNodeById(nodeId);
            if (node) {
              snapshots.push({
                nodeId,
                props: {
                  x: node.x,
                  y: node.y,
                  width: node.width,
                  height: node.height,
                  name: node.name,
                  visible: node.visible,
                  locked: node.locked,
                  opacity: node.opacity
                }
              });
            }
          }
        }
        const batchResults = [];
        let batchFailed = false;
        for (const cmd of batchCmds) {
          const result2 = await this.executeCommand(cmd);
          batchResults.push(result2);
          if (result2.status === "error") {
            batchFailed = true;
            break;
          }
        }
        if (batchFailed) {
          for (const snap of snapshots) {
            try {
              const node = figma.getNodeById(snap.nodeId);
              if (node) {
                node.x = snap.props.x;
                node.y = snap.props.y;
                node.resize(snap.props.width, snap.props.height);
                node.name = snap.props.name;
                node.visible = snap.props.visible;
                node.locked = snap.props.locked;
                node.opacity = snap.props.opacity;
              }
            } catch (e) {
            }
          }
          for (let i = batchResults.length; i < batchCmds.length; i++) {
            batchResults.push({
              id: batchCmds[i].id,
              status: "error",
              error: {
                category: "INTERNAL_ERROR",
                message: "Batch rolled back due to earlier failure",
                retryable: false
              },
              duration: 0,
              timestamp: Date.now(),
              batchId,
              batchSeq: batchCmds[i].batchSeq
            });
          }
        }
        results.push(...batchResults);
      }
      return results;
    }
  };
  function categorizeError(error) {
    const msg = (error.message ? error.message.toLowerCase() : "") || "";
    if (msg.includes("not found") || msg.includes("does not exist")) {
      return "NODE_NOT_FOUND";
    }
    if (msg.includes("font")) {
      return "FONT_NOT_LOADED";
    }
    if (msg.includes("read-only") || msg.includes("readonly") || msg.includes("cannot set")) {
      return "READ_ONLY_PROPERTY";
    }
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return "COMMAND_TIMEOUT";
    }
    if (msg.includes("invalid") || msg.includes("must provide") || msg.includes("unknown")) {
      return "INVALID_PARAMS";
    }
    return "INTERNAL_ERROR";
  }
  function isRetryable(category) {
    return ["COMMAND_TIMEOUT", "FONT_NOT_LOADED", "CONNECTION_LOST"].includes(category);
  }
  function getSuggestion(category, error) {
    switch (category) {
      case "NODE_NOT_FOUND":
        return "Use get_selection or search_nodes to find the correct node ID";
      case "FONT_NOT_LOADED":
        return "Ensure the font is installed or use a system font like 'Inter'";
      case "COMMAND_TIMEOUT":
        return "Try a simpler operation or increase the timeout";
      default:
        return void 0;
    }
  }

  // plugin/ws-client.ts
  var WSClient = class {
    constructor(baseUrl, executor) {
      this.sessionId = null;
      this.authToken = null;
      this._isConnected = false;
      this.reconnecting = false;
      this.shouldReconnect = true;
      this.reconnectAttempt = 0;
      this.statusCallback = null;
      // Bounded send queue for messages while disconnected
      this.pendingQueue = [];
      this.MAX_QUEUE = 20;
      // Exponential backoff: 500ms -> 1s -> 2s -> 4s -> 8s -> 15s
      this.backoffSchedule = [500, 1e3, 2e3, 4e3, 8e3, 15e3];
      this.baseUrl = baseUrl;
      this.executor = executor;
    }
    get isConnected() {
      return this._isConnected;
    }
    onStatusChange(callback) {
      this.statusCallback = callback;
    }
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    }
    setAuthToken(token) {
      this.authToken = token;
    }
    /**
     * Handle messages from the UI iframe related to WebSocket.
     * Must be called from the main message handler in code.ts.
     */
    handleUiMessage(msg) {
      switch (msg.type) {
        case "ws-open":
          this._isConnected = true;
          this.reconnecting = false;
          this.reconnectAttempt = 0;
          console.log("WebSocket connected");
          while (this.pendingQueue.length > 0) {
            const queued = this.pendingQueue.shift();
            this.send(queued);
          }
          this.send({
            type: "ack",
            id: "ws_init_" + Date.now(),
            payload: { sessionId: this.sessionId },
            timestamp: Date.now()
          });
          this.notifyStatus(true);
          break;
        case "ws-message":
          this.handleMessage(msg.data);
          break;
        case "ws-close":
          console.log("WebSocket closed: " + msg.code + " " + msg.reason);
          this._isConnected = false;
          this.notifyStatus(false);
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
          break;
        case "ws-error":
          console.error("WebSocket error");
          break;
      }
    }
    connect() {
      if (this._isConnected || this.reconnecting) return;
      if (!this.sessionId) {
        console.warn("WSClient: No session ID set, skipping WebSocket connection");
        return;
      }
      this.shouldReconnect = true;
      this.attemptConnect();
    }
    disconnect() {
      this.shouldReconnect = false;
      this._isConnected = false;
      this.pendingQueue = [];
      figma.ui.postMessage({ type: "ws-disconnect" });
      this.notifyStatus(false);
    }
    // ─── Private Methods ───────────────────────────────────────────────────────
    attemptConnect() {
      var wsUrl = this.baseUrl.replace("http://", "ws://").replace("https://", "wss://");
      var params = "?token=" + encodeURIComponent(this.authToken || "") + "&sessionId=" + encodeURIComponent(this.sessionId || "");
      figma.ui.postMessage({
        type: "ws-connect",
        url: wsUrl + "/ws" + params
      });
    }
    scheduleReconnect() {
      if (this.reconnecting) return;
      this.reconnecting = true;
      var index = Math.min(this.reconnectAttempt, this.backoffSchedule.length - 1);
      var delay = this.backoffSchedule[index];
      this.reconnectAttempt++;
      console.log("WebSocket reconnecting in " + delay + "ms (attempt " + this.reconnectAttempt + ")");
      setTimeout(() => {
        this.reconnecting = false;
        if (this.shouldReconnect) {
          this.attemptConnect();
        }
      }, delay);
    }
    async handleMessage(data) {
      try {
        var message = JSON.parse(data);
        switch (message.type) {
          case "ping":
            this.send({
              type: "pong",
              id: message.id,
              timestamp: Date.now()
            });
            break;
          case "command": {
            var payload2 = message.payload;
            if (message.id === "activity-signal" && payload2) {
              if (payload2.activity === true) {
                figma.ui.postMessage({ type: "forging-start" });
              } else {
                figma.ui.postMessage({ type: "forging-stop" });
              }
              break;
            }
            if (message.id === "chat-response" && payload2) {
              var chatResp = payload2.chatResponse;
              if (chatResp) {
                postChatResponseDeduped(
                  chatResp.id,
                  chatResp.message,
                  chatResp.isError || false
                );
              }
              break;
            }
            if (message.id === "chat-listening" && payload2) {
              if (payload2.listening === true) {
                figma.ui.postMessage({ type: "chat-available" });
              } else {
                figma.ui.postMessage({ type: "chat-unavailable" });
              }
              break;
            }
            if (message.id === "chat-chunk" && payload2) {
              var chatChunk = payload2.chatChunk;
              if (chatChunk) {
                figma.ui.postMessage({
                  type: "chat-chunk",
                  delta: chatChunk.delta,
                  id: chatChunk.id,
                  done: chatChunk.done || false
                });
              }
              break;
            }
            var command = payload2;
            var wsQueueDepth = payload2._queueDepth || 0;
            this.send({
              type: "ack",
              id: message.id,
              timestamp: Date.now()
            });
            figma.ui.postMessage({
              type: "forging-progress",
              commandType: command.type,
              current: 1,
              batchTotal: 1,
              queueDepth: Math.max(0, wsQueueDepth - 1)
            });
            var result2 = await this.executor.executeCommand(command);
            var resultMsg = {
              type: "result",
              id: message.id,
              payload: result2,
              timestamp: Date.now()
            };
            var serialized = JSON.stringify(resultMsg);
            if (serialized.length > 4 * 1024 * 1024) {
              console.warn("WS result too large (" + serialized.length + " bytes), truncating");
              var truncResult = result2;
              if (truncResult.result && typeof truncResult.result === "object") {
                var inner = truncResult.result;
                if (typeof inner.data === "string" && inner.data.length > 5e4) {
                  inner.data = inner.data.slice(0, 5e4);
                  inner._truncated = true;
                }
                if (Array.isArray(inner.children)) {
                  inner.children = inner.children.slice(0, 5);
                  inner._childrenTruncated = true;
                }
              }
              resultMsg.payload = truncResult;
            }
            this.send(resultMsg);
            break;
          }
        }
      } catch (e) {
        console.error("WebSocket message handling error:", e);
      }
    }
    send(message) {
      if (!this._isConnected) {
        if (this.pendingQueue.length < this.MAX_QUEUE) {
          this.pendingQueue.push(message);
        } else {
          console.warn("WSClient: send queue full, dropping message type=" + message.type);
        }
        return;
      }
      figma.ui.postMessage({
        type: "ws-send",
        data: JSON.stringify(message)
      });
    }
    notifyStatus(connected) {
      if (this.statusCallback) {
        this.statusCallback(connected);
      }
    }
  };
  var seenChatIds = /* @__PURE__ */ new Set();
  function postChatResponseDeduped(id, message, isError) {
    if (seenChatIds.has(id)) return;
    seenChatIds.add(id);
    figma.ui.postMessage({
      type: "chat-response",
      message,
      id,
      isError: isError || false
    });
    setTimeout(function() {
      seenChatIds.delete(id);
    }, 6e4);
  }

  // plugin/poller.ts
  var requestCounter = 0;
  var pendingRequests = /* @__PURE__ */ new Map();
  function setupHttpBridge() {
    figma.ui.onmessage = createMessageHandler(figma.ui.onmessage);
  }
  function createMessageHandler(existingHandler) {
    return (msg, props) => {
      const message = msg;
      if (message && message.type === "http-response") {
        const requestId = message.requestId;
        const resolver = pendingRequests.get(requestId);
        if (resolver) {
          pendingRequests.delete(requestId);
          resolver({
            status: message.status,
            body: message.body,
            error: message.error
          });
        }
        return;
      }
      if (existingHandler) {
        existingHandler(msg, props);
      }
    };
  }
  function httpRequest(method, url, body, headers, timeout2) {
    return new Promise((resolve) => {
      const requestId = `req_${++requestCounter}_${Date.now()}`;
      pendingRequests.set(requestId, resolve);
      const timer = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          resolve({ status: 0, body: null, error: "Timeout" });
        }
      }, (timeout2 || 1e4) + 2e3);
      pendingRequests.set(requestId, (resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
      figma.ui.postMessage({
        type: "http-request",
        requestId,
        method,
        url,
        body: body ? JSON.stringify(body) : void 0,
        headers,
        timeout: timeout2 || 1e4
      });
    });
  }
  var Poller = class {
    constructor(baseUrl, executor) {
      this.sessionId = null;
      this.authToken = null;
      this.polling = false;
      this.pollTimer = null;
      // Adaptive polling intervals
      this.burstInterval = 100;
      this.defaultInterval = 300;
      this.idleInterval = 500;
      this.idleThreshold = 1e4;
      this.lastCommandTime = 0;
      // Chat listening state tracking
      this.lastChatListening = false;
      // Connection health tracking
      this.consecutiveErrors = 0;
      this.maxConsecutiveErrors = 5;
      this.reconnecting = false;
      this.onReconnect = null;
      this.baseUrl = baseUrl;
      this.executor = executor;
      this.pluginId = "heph_" + generateId();
    }
    getSessionId() {
      return this.sessionId;
    }
    getPluginId() {
      return this.pluginId;
    }
    getAuthToken() {
      return this.authToken;
    }
    /** Send an authenticated POST request through the HTTP bridge. */
    async postAuthenticated(path, body) {
      return httpRequest("POST", this.baseUrl + path, body, this.getHeaders(), 5e3);
    }
    async connect() {
      try {
        const healthResp = await httpRequest("GET", this.baseUrl + "/health", void 0, void 0, 5e3);
        if (healthResp.status === 0 || !healthResp.body) {
          console.warn("Relay server not reachable");
          return false;
        }
        var currentUser = figma.currentUser;
        var currentPage = figma.currentPage;
        const connectPayload = {
          pluginId: this.pluginId,
          fileKey: figma.fileKey || "unknown",
          fileName: figma.root && figma.root.name ? figma.root.name : "Unknown File",
          pageId: currentPage ? currentPage.id : void 0,
          pageName: currentPage ? currentPage.name : void 0,
          user: currentUser ? {
            id: currentUser.id,
            name: currentUser.name,
            photoUrl: currentUser.photoUrl
          } : void 0,
          capabilities: {
            maxConcurrent: 1,
            supportedTypes: this.executor.getSupportedTypes(),
            pluginVersion: "0.1.0"
          }
        };
        const connectResp = await httpRequest(
          "POST",
          this.baseUrl + "/connect",
          connectPayload,
          { "X-Plugin-Id": this.pluginId },
          5e3
        );
        if (connectResp.status === 0 || !connectResp.body) {
          console.warn("Failed to connect to relay server");
          return false;
        }
        const connectData = JSON.parse(connectResp.body);
        this.sessionId = connectData.sessionId;
        const authSecret = connectData.authSecret;
        if (!authSecret) {
          console.warn("Server did not provide auth token");
          return false;
        }
        this.authToken = authSecret;
        if (connectData.config) {
          if (connectData.config.pollingInterval) this.defaultInterval = connectData.config.pollingInterval;
          if (connectData.config.burstInterval) this.burstInterval = connectData.config.burstInterval;
          if (connectData.config.idleInterval) this.idleInterval = connectData.config.idleInterval;
          if (connectData.config.idleThreshold) this.idleThreshold = connectData.config.idleThreshold;
        }
        console.log("Connected to relay server. Session: " + this.sessionId);
        return true;
      } catch (e) {
        console.error("Connection handshake failed:", e);
        return false;
      }
    }
    /**
     * Set a callback that fires when the poller auto-reconnects after connection loss.
     */
    setReconnectCallback(cb) {
      this.onReconnect = cb;
    }
    async startPolling() {
      if (this.polling) return;
      this.polling = true;
      this.consecutiveErrors = 0;
      this.poll();
    }
    async disconnect() {
      this.polling = false;
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.sessionId) {
        try {
          await httpRequest(
            "POST",
            this.baseUrl + "/disconnect",
            { sessionId: this.sessionId, reason: "plugin_closed" },
            this.getHeaders(),
            3e3
          );
        } catch (e) {
        }
      }
    }
    // ─── Private Methods ───────────────────────────────────────────────────────
    async poll() {
      if (!this.polling) return;
      var nextInterval = this.getAdaptiveInterval();
      try {
        const resp = await httpRequest("GET", this.baseUrl + "/commands", void 0, this.getHeaders(), 5e3);
        if (resp.status === 401 || resp.status === 403) {
          console.warn("Auth rejected (status " + resp.status + "), reconnecting...");
          this.consecutiveErrors++;
          await this.attemptReconnect();
          nextInterval = this.defaultInterval;
        } else if (resp.status >= 200 && resp.status < 300 && resp.body) {
          this.consecutiveErrors = 0;
          const data = JSON.parse(resp.body);
          const commands = data.commands;
          if (data.activity === true) {
            figma.ui.postMessage({ type: "forging-start" });
          } else if (data.activity === false) {
            figma.ui.postMessage({ type: "forging-stop" });
          }
          var serverQueueRemainder = data.queueDepth || 0;
          var localCommandCount = commands && commands.length ? commands.length : 0;
          figma.ui.postMessage({ type: "queue-update", count: serverQueueRemainder + localCommandCount });
          var chatListeningNow = data.chatListening === true;
          if (chatListeningNow !== this.lastChatListening) {
            this.lastChatListening = chatListeningNow;
            figma.ui.postMessage({ type: chatListeningNow ? "chat-available" : "chat-unavailable" });
          }
          var chatResponses = data.chatResponses;
          if (chatResponses && chatResponses.length > 0) {
            for (var j = 0; j < chatResponses.length; j++) {
              postChatResponseDeduped(chatResponses[j].id, chatResponses[j].message);
            }
          }
          if (commands && commands.length > 0) {
            this.lastCommandTime = Date.now();
            nextInterval = this.burstInterval;
            var serverQueueDepth = data.queueDepth || 0;
            var keepAliveTimer = setInterval(() => {
              httpRequest("GET", this.baseUrl + "/commands?keepalive=1", void 0, this.getHeaders(), 5e3).catch(function() {
              });
            }, 4e3);
            try {
              var groups = partitionReadWriteGroups(commands);
              var completedCount = 0;
              for (var gi = 0; gi < groups.length; gi++) {
                var group = groups[gi];
                if (group.isRead && group.cmds.length > 1) {
                  var readQueue = group.cmds.slice();
                  while (readQueue.length > 0) {
                    var batch = readQueue.splice(0, 5);
                    for (var bi = 0; bi < batch.length; bi++) {
                      figma.ui.postMessage({
                        type: "forging-progress",
                        commandType: batch[bi].type,
                        current: completedCount + bi + 1,
                        batchTotal: commands.length,
                        queueDepth: commands.length - completedCount + serverQueueDepth,
                        parallel: true
                      });
                    }
                    var readResults = await Promise.all(
                      batch.map(function(cmd2) {
                        return this.executor.executeCommand(cmd2);
                      }.bind(this))
                    );
                    for (var ri = 0; ri < readResults.length; ri++) {
                      await this.postResult(readResults[ri]);
                    }
                    completedCount += batch.length;
                  }
                } else {
                  for (var si = 0; si < group.cmds.length; si++) {
                    var cmd = group.cmds[si];
                    var remaining = commands.length - completedCount + serverQueueDepth;
                    figma.ui.postMessage({
                      type: "forging-progress",
                      commandType: cmd.type,
                      current: completedCount + 1,
                      batchTotal: commands.length,
                      queueDepth: remaining
                    });
                    var cmdResult = await this.executor.executeCommand(cmd);
                    await this.postResult(cmdResult);
                    completedCount++;
                  }
                }
              }
            } finally {
              if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                keepAliveTimer = null;
              }
            }
          }
        } else if (resp.status >= 200 && resp.status < 300 && !resp.body) {
          this.consecutiveErrors = 0;
          if (this.lastChatListening) {
            this.lastChatListening = false;
            figma.ui.postMessage({ type: "chat-unavailable" });
          }
        } else if (resp.status === 503) {
          console.warn("Session lost (503), reconnecting immediately...");
          this.consecutiveErrors++;
          await this.attemptReconnect();
          nextInterval = this.defaultInterval;
        } else if (resp.status >= 400) {
          this.consecutiveErrors++;
          console.warn("Server error " + resp.status + " (attempt " + this.consecutiveErrors + "/" + this.maxConsecutiveErrors + ")");
          if (this.consecutiveErrors >= 3) {
            console.warn("Repeated server errors, attempting reconnect...");
            await this.attemptReconnect();
          }
          nextInterval = this.defaultInterval;
        } else if (resp.status === 0) {
          this.consecutiveErrors++;
          console.warn("Server unreachable (attempt " + this.consecutiveErrors + "/" + this.maxConsecutiveErrors + ")");
          if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            console.warn("Too many errors, attempting reconnect...");
            await this.attemptReconnect();
          }
          nextInterval = Math.min(this.defaultInterval * this.consecutiveErrors, 3e3);
        }
      } catch (e) {
        console.error("Poll error:", e);
        this.consecutiveErrors++;
        nextInterval = Math.min(this.defaultInterval * this.consecutiveErrors, 3e3);
        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          await this.attemptReconnect();
        }
      }
      if (this.polling) {
        this.pollTimer = setTimeout(() => {
          this.poll();
        }, nextInterval);
      }
    }
    /** Post a command result back to the relay server with retry logic. */
    async postResult(resultPayload) {
      var posted = false;
      for (var attempt = 0; attempt < 3 && !posted; attempt++) {
        try {
          var postResp = await httpRequest("POST", this.baseUrl + "/results", resultPayload, this.getHeaders(), 15e3);
          if (postResp.status >= 200 && postResp.status < 300) {
            posted = true;
          } else if (postResp.status === 401) {
            await this.attemptReconnect();
          } else if (postResp.status === 413) {
            console.warn("Result too large (413), truncating and retrying");
            resultPayload = truncateResult(resultPayload);
          } else {
            console.warn("Failed to post result: status " + postResp.status);
          }
        } catch (e) {
          console.error("Failed to post result (attempt " + (attempt + 1) + "):", e);
        }
      }
      if (!posted) {
        console.error("Giving up posting result for command " + resultPayload.id + " after 3 attempts");
      }
    }
    async attemptReconnect() {
      if (this.reconnecting) return;
      this.reconnecting = true;
      console.log("Attempting reconnect...");
      try {
        var success = await this.connect();
        if (success) {
          console.log("Reconnected successfully. Session: " + this.sessionId);
          this.consecutiveErrors = 0;
          if (this.onReconnect) {
            this.onReconnect();
          }
        } else {
          console.warn("Reconnect failed, will retry on next poll");
          figma.ui.postMessage({ type: "status", connected: false, transport: null });
        }
      } catch (e) {
        console.error("Reconnect error:", e);
        figma.ui.postMessage({ type: "status", connected: false, transport: null });
      } finally {
        this.reconnecting = false;
      }
    }
    getAdaptiveInterval() {
      const timeSinceLastCommand = Date.now() - this.lastCommandTime;
      if (this.lastCommandTime > 0 && timeSinceLastCommand < 1e3) {
        return this.burstInterval;
      }
      if (timeSinceLastCommand > this.idleThreshold) {
        return this.idleInterval;
      }
      return this.defaultInterval;
    }
    getHeaders() {
      const headers = {
        "X-Plugin-Id": this.pluginId,
        "X-Plugin-File": figma.fileKey || "unknown",
        "X-Plugin-Page": figma.currentPage ? figma.currentPage.id : ""
      };
      if (this.sessionId) {
        headers["X-Session-Id"] = this.sessionId;
      }
      if (this.authToken) {
        headers["X-Auth-Token"] = this.authToken;
      }
      return headers;
    }
  };
  function generateId() {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var result2 = "";
    for (var i = 0; i < 8; i++) {
      result2 += chars[Math.floor(Math.random() * chars.length)];
    }
    return result2;
  }
  function partitionReadWriteGroups(commands) {
    if (commands.length === 0) return [];
    var groups = [];
    var currentIsRead = READ_COMMANDS.has(commands[0].type);
    var currentCmds = [commands[0]];
    for (var i = 1; i < commands.length; i++) {
      var isRead = READ_COMMANDS.has(commands[i].type);
      if (isRead !== currentIsRead) {
        groups.push({ isRead: currentIsRead, cmds: currentCmds });
        currentCmds = [];
        currentIsRead = isRead;
      }
      currentCmds.push(commands[i]);
    }
    groups.push({ isRead: currentIsRead, cmds: currentCmds });
    return groups;
  }
  function truncateResult(result2) {
    var truncated = { id: result2.id, status: result2.status, duration: result2.duration, timestamp: result2.timestamp, batchId: result2.batchId, batchSeq: result2.batchSeq };
    if (result2.error) {
      truncated.error = result2.error;
      return truncated;
    }
    var inner = result2.result;
    if (!inner) return truncated;
    var cleaned = {};
    for (var key in inner) {
      if (!inner.hasOwnProperty(key)) continue;
      var val = inner[key];
      if (key === "data" && typeof val === "string" && val.length > 5e4) {
        cleaned[key] = val.slice(0, 5e4);
        cleaned["_truncated"] = true;
        cleaned["_originalSize"] = val.length;
        continue;
      }
      if (key === "children" && Array.isArray(val) && JSON.stringify(val).length > 1e5) {
        cleaned[key] = val.slice(0, 5).map(function(child) {
          if (child && typeof child === "object" && "children" in child) {
            var shallow = Object.assign({}, child);
            delete shallow.children;
            shallow._childrenTruncated = true;
            return shallow;
          }
          return child;
        });
        cleaned["_childrenTruncated"] = true;
        continue;
      }
      cleaned[key] = val;
    }
    truncated.result = cleaned;
    return truncated;
  }

  // plugin/code.ts
  var RELAY_URL = "http://localhost:7780";
  var pollerRef = null;
  function reportStatus(transport) {
    figma.ui.postMessage({
      type: "status",
      connected: transport !== "disconnected",
      transport
    });
  }
  async function main() {
    figma.showUI(__html__, { visible: true, width: 360, height: 215 });
    var executor = new Executor();
    var ws = new WSClient(RELAY_URL, executor);
    setupHttpBridge();
    var existingHandler = figma.ui.onmessage;
    figma.ui.onmessage = function(msg) {
      var message = msg;
      if (message && (message.type === "ws-open" || message.type === "ws-message" || message.type === "ws-close" || message.type === "ws-error")) {
        ws.handleUiMessage(message);
        return;
      }
      if (message && message.type === "chat-send") {
        handleChatSend(message);
        return;
      }
      if (message && message.type === "resize") {
        figma.ui.resize(message.width, message.height);
        return;
      }
      if (message && message.type === "navigate-to-node") {
        var nodeId = message.nodeId;
        if (nodeId) {
          var node = figma.getNodeById(nodeId);
          if (node && "type" in node && node.type !== "DOCUMENT" && node.type !== "PAGE") {
            figma.viewport.scrollAndZoomIntoView([node]);
            figma.currentPage.selection = [node];
          }
        }
        return;
      }
      if (existingHandler) {
        existingHandler(msg);
      }
    };
    figma.on("selectionchange", function() {
      var sel = figma.currentPage.selection;
      var items = [];
      for (var i = 0; i < sel.length; i++) {
        items.push({ id: sel[i].id, name: sel[i].name, type: sel[i].type });
      }
      figma.ui.postMessage({
        type: "selection-changed",
        count: items.length,
        items: items.slice(0, 3)
      });
    });
    preloadFonts().catch(function(e) {
      console.warn("Font preload failed:", e);
    });
    var poller = new Poller(RELAY_URL, executor);
    pollerRef = poller;
    var connected = await poller.connect();
    if (connected) {
      await poller.startPolling();
      reportStatus("http");
      var sessionId = poller.getSessionId();
      if (sessionId) {
        ws.setSessionId(sessionId);
      }
      var token = poller.getAuthToken();
      if (token) {
        ws.setAuthToken(token);
      }
      ws.onStatusChange(function(wsConnected) {
        reportStatus(wsConnected ? "websocket" : "http");
      });
      ws.connect();
      poller.setReconnectCallback(function() {
        var newSid = poller.getSessionId();
        if (newSid) ws.setSessionId(newSid);
        var newTok = poller.getAuthToken();
        if (newTok) ws.setAuthToken(newTok);
        ws.disconnect();
        ws.connect();
        reportStatus("http");
      });
      figma.on("close", function() {
        poller.disconnect();
        ws.disconnect();
      });
    } else {
      reportStatus("disconnected");
      var retryInterval = setInterval(async function() {
        var retryConnected = await poller.connect();
        if (retryConnected) {
          clearInterval(retryInterval);
          await poller.startPolling();
          reportStatus("http");
          var sid = poller.getSessionId();
          if (sid) {
            ws.setSessionId(sid);
          }
          var tok = poller.getAuthToken();
          if (tok) {
            ws.setAuthToken(tok);
          }
          ws.onStatusChange(function(wsConnected) {
            reportStatus(wsConnected ? "websocket" : "http");
          });
          ws.connect();
          poller.setReconnectCallback(function() {
            var newSid = poller.getSessionId();
            if (newSid) ws.setSessionId(newSid);
            var newTok = poller.getAuthToken();
            if (newTok) ws.setAuthToken(newTok);
            ws.disconnect();
            ws.connect();
            reportStatus("http");
          });
          figma.on("close", function() {
            poller.disconnect();
            ws.disconnect();
          });
        }
      }, 3e3);
      figma.on("close", function() {
        clearInterval(retryInterval);
        poller.disconnect();
      });
    }
  }
  function handleChatSend(msg) {
    if (!pollerRef) {
      console.warn("Chat send failed: not connected");
      return;
    }
    var selection = [];
    var sel = figma.currentPage.selection;
    for (var i = 0; i < sel.length; i++) {
      selection.push({
        id: sel[i].id,
        name: sel[i].name,
        type: sel[i].type
      });
    }
    var thumbnailPromise;
    if (sel.length > 0) {
      var targetNode = sel[0];
      var exportSettings = {
        format: "PNG",
        constraint: { type: "WIDTH", value: 120 }
      };
      thumbnailPromise = targetNode.exportAsync(exportSettings).then(function(bytes) {
        var binary = "";
        for (var b = 0; b < bytes.length; b++) {
          binary += String.fromCharCode(bytes[b]);
        }
        var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var result2 = "";
        for (var bi = 0; bi < binary.length; bi += 3) {
          var a1 = binary.charCodeAt(bi);
          var a2 = bi + 1 < binary.length ? binary.charCodeAt(bi + 1) : 0;
          var a3 = bi + 2 < binary.length ? binary.charCodeAt(bi + 2) : 0;
          result2 += base64Chars[a1 >> 2];
          result2 += base64Chars[(a1 & 3) << 4 | a2 >> 4];
          result2 += bi + 1 < binary.length ? base64Chars[(a2 & 15) << 2 | a3 >> 6] : "=";
          result2 += bi + 2 < binary.length ? base64Chars[a3 & 63] : "=";
        }
        return "data:image/png;base64," + result2;
      }).catch(function() {
        return null;
      });
    } else {
      thumbnailPromise = Promise.resolve(null);
    }
    pollerRef.postAuthenticated("/chat/send", {
      id: msg.id,
      message: msg.message,
      selection
    }).then(function(resp) {
      if (resp.status < 200 || resp.status >= 300) {
        console.warn("Chat send failed: " + resp.status + " " + resp.body);
        figma.ui.postMessage({
          type: "chat-send-error",
          id: msg.id,
          error: "Failed to send message (status " + resp.status + ")"
        });
        return;
      }
      thumbnailPromise.then(function(thumbnail) {
        figma.ui.postMessage({
          type: "chat-sent-confirmation",
          id: msg.id,
          selectionCount: selection.length,
          selectionSummary: selection.slice(0, 3).map(function(s) {
            return s.name;
          }),
          selectionIds: selection.slice(0, 3).map(function(s) {
            return s.id;
          }),
          thumbnail
        });
      });
    });
  }
  main().catch(function(e) {
    console.error("Rex init failed:", e);
  });
})();
