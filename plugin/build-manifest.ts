// ─── Build Manifest & Document Change Observer ──────────────────────────────
// Tracks nodes Rex built or the user asked to observe. Captures property
// changes from the designer's refinements and batches them for relay to Osiris.

import { colorToHex, serializePaints } from "./serializer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManifestEntry {
  role: string;
  name: string;
  parentRole: string;
  appliedValues: Record<string, unknown>;
}

interface PropertyChange {
  nodeId: string;
  role: string;
  name: string;
  property: string;
  from: unknown;
  to: unknown;
}

export interface ObservationBatch {
  frameId: string;
  brandId: string;
  screenType: string;
  templateId?: string;
  changes: PropertyChange[];
  observationDuration: number;
}

// ─── Observable Properties ──────────────────────────────────────────────────
// The set of Figma properties we capture changes for.

const OBSERVABLE_PROPS: ReadonlyArray<string> = [
  "x", "y", "width", "height",
  "opacity", "visible",
  "fills", "strokes", "strokeWeight",
  "cornerRadius",
  "effects",
  "clipsContent",
  "layoutMode",
  "primaryAxisAlignItems", "counterAxisAlignItems",
  "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "layoutSizingHorizontal", "layoutSizingVertical",
  "fontSize", "fontName", "textAlignHorizontal",
];

const OBSERVABLE_SET = new Set(OBSERVABLE_PROPS);

// ─── Build Manifest ─────────────────────────────────────────────────────────

export class BuildManifest {
  private readonly entries = new Map<string, ManifestEntry>();
  frameId: string = "";
  brandId: string = "";
  screenType: string = "";
  templateId?: string;

  addEntry(nodeId: string, role: string, name: string, parentRole: string, appliedValues: Record<string, unknown>): void {
    this.entries.set(nodeId, { role, name, parentRole, appliedValues });
  }

  isTracked(nodeId: string): boolean {
    return this.entries.has(nodeId);
  }

  getEntry(nodeId: string): ManifestEntry | undefined {
    return this.entries.get(nodeId);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Build manifest from an extract_som roleMap + live frame. */
  buildFromSom(
    frameId: string,
    roleMap: Array<{ nodeId: string; nodeName: string; role: string; category: string }>,
    brandId: string,
    screenType: string,
    templateId?: string,
  ): void {
    this.clear();
    this.frameId = frameId;
    this.brandId = brandId;
    this.screenType = screenType;
    this.templateId = templateId;

    for (const entry of roleMap) {
      const node = figma.getNodeById(entry.nodeId) as SceneNode | null;
      if (!node) continue;
      const snapshot = captureNodeValues(node);
      this.addEntry(entry.nodeId, entry.role, entry.nodeName, "", snapshot);
    }
  }
}

// ─── Capture Current Node Values ────────────────────────────────────────────

function captureNodeValues(node: SceneNode): Record<string, unknown> {
  const vals: Record<string, unknown> = {};
  for (const prop of OBSERVABLE_PROPS) {
    vals[prop] = readNodeProperty(node, prop);
  }
  return vals;
}

/** Serialize fills to a simple comparable format. */
function serializeFills(paints: readonly Paint[]): string {
  const visible = paints.filter((p) => p.visible !== false);
  if (visible.length === 0) return "";
  if (visible.length === 1 && visible[0].type === "SOLID") {
    const s = visible[0] as SolidPaint;
    return colorToHex(s.color, s.opacity);
  }
  return JSON.stringify(serializePaints(visible));
}

// ─── Document Change Observer ───────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 10_000;

export class DocumentChangeObserver {
  private manifest: BuildManifest | null = null;
  private changeBuffer = new Map<string, PropertyChange>();
  private flushCallback: ((batch: ObservationBatch) => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt: number = 0;
  private lastChangeTime: number = 0;

  start(manifest: BuildManifest, flushCallback: (batch: ObservationBatch) => void): void {
    this.stop();
    this.manifest = manifest;
    this.flushCallback = flushCallback;
    this.startedAt = Date.now();
    this.lastChangeTime = 0;
    this.changeBuffer.clear();

    this.flushTimer = setInterval(() => { this.flush(); }, FLUSH_INTERVAL_MS);
    console.log("[Observer] Started watching " + manifest.size + " nodes on frame " + manifest.frameId);
  }

  stop(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.changeBuffer.size > 0) this.flush();
    this.manifest = null;
    this.flushCallback = null;
  }

  get active(): boolean {
    return this.manifest !== null;
  }

  handleDocumentChange(event: DocumentChangeEvent): void {
    if (!this.manifest) return;

    let foundRelevant = false;

    for (const change of event.documentChanges) {
      if (change.type !== "PROPERTY_CHANGE") continue;
      if (!this.manifest.isTracked(change.id)) continue;

      const node = figma.getNodeById(change.id) as SceneNode | null;
      if (!node) continue;

      const entry = this.manifest.getEntry(change.id)!;

      // Check each changed property
      for (const prop of change.properties) {
        if (!OBSERVABLE_SET.has(prop)) continue;

        const currentValue = readNodeProperty(node, prop);
        const originalValue = entry.appliedValues[prop];
        const bufferKey = change.id + ":" + prop;

        this.changeBuffer.set(bufferKey, {
          nodeId: change.id,
          role: entry.role,
          name: entry.name,
          property: prop,
          from: originalValue,
          to: currentValue,
        });
        foundRelevant = true;
      }
    }

    // Reset idle timer only when relevant changes were found
    if (foundRelevant) {
      this.lastChangeTime = Date.now();
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { this.flush(); }, IDLE_TIMEOUT_MS);
    }
  }

  flush(): void {
    if (!this.manifest || !this.flushCallback || this.changeBuffer.size === 0) return;

    // Net-zero detection: drop changes where value reverted to original
    const changes: PropertyChange[] = [];
    for (const change of this.changeBuffer.values()) {
      if (!valuesEqual(change.from, change.to)) {
        changes.push(change);
      }
    }

    this.changeBuffer.clear();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }

    if (changes.length === 0) {
      console.log("[Observer] Flush skipped — all changes were net-zero");
      return;
    }

    const batch: ObservationBatch = {
      frameId: this.manifest.frameId,
      brandId: this.manifest.brandId,
      screenType: this.manifest.screenType,
      templateId: this.manifest.templateId,
      changes,
      observationDuration: Date.now() - this.startedAt,
    };

    console.log("[Observer] Flushing " + changes.length + " changes for frame " + this.manifest.frameId);
    this.flushCallback(batch);
  }
}

// ─── Property Reader ────────────────────────────────────────────────────────

function readNodeProperty(node: SceneNode, prop: string): unknown {
  switch (prop) {
    case "x": return Math.round(node.x);
    case "y": return Math.round(node.y);
    case "width": return Math.round(node.width);
    case "height": return Math.round(node.height);
    case "opacity": return node.opacity;
    case "visible": return node.visible;
    case "fills":
      if ("fills" in node) {
        const f = (node as GeometryMixin).fills;
        return f !== figma.mixed ? serializeFills(f as readonly Paint[]) : "";
      }
      return "";
    case "strokes":
      if ("strokes" in node) return serializeFills((node as GeometryMixin).strokes);
      return "";
    case "strokeWeight":
      if ("strokeWeight" in node) {
        const sw = (node as GeometryMixin).strokeWeight;
        return sw !== figma.mixed ? sw : 1;
      }
      return 1;
    case "cornerRadius":
      if ("cornerRadius" in node) {
        const cr = (node as RectangleNode).cornerRadius;
        if (cr !== figma.mixed) return cr;
        return {
          topLeft: (node as RectangleNode).topLeftRadius,
          topRight: (node as RectangleNode).topRightRadius,
          bottomRight: (node as RectangleNode).bottomRightRadius,
          bottomLeft: (node as RectangleNode).bottomLeftRadius,
        };
      }
      return 0;
    case "effects":
      if ("effects" in node) return (node as BlendMixin).effects.length;
      return 0;
    case "clipsContent":
      if ("clipsContent" in node) return (node as FrameNode).clipsContent;
      return true;
    case "layoutMode":
      if ("layoutMode" in node) return (node as FrameNode).layoutMode;
      return "NONE";
    case "itemSpacing":
      if ("itemSpacing" in node) return (node as FrameNode).itemSpacing;
      return 0;
    case "paddingTop":
    case "paddingRight":
    case "paddingBottom":
    case "paddingLeft":
      if (prop in node) return (node as any)[prop];
      return 0;
    case "primaryAxisAlignItems":
      if ("primaryAxisAlignItems" in node) return (node as FrameNode).primaryAxisAlignItems;
      return "MIN";
    case "counterAxisAlignItems":
      if ("counterAxisAlignItems" in node) return (node as FrameNode).counterAxisAlignItems;
      return "MIN";
    case "layoutSizingHorizontal":
    case "layoutSizingVertical":
      if (prop in node) return (node as any)[prop];
      return "FIXED";
    case "fontSize":
      if (node.type === "TEXT") {
        const fs = (node as TextNode).fontSize;
        return fs !== figma.mixed ? fs : 0;
      }
      return 0;
    case "fontName":
      if (node.type === "TEXT") {
        const fn = (node as TextNode).fontName;
        return fn !== figma.mixed ? fn.family + " " + fn.style : "";
      }
      return "";
    case "textAlignHorizontal":
      if (node.type === "TEXT") return (node as TextNode).textAlignHorizontal;
      return "LEFT";
    default:
      return undefined;
  }
}

// ─── Equality Check ─────────────────────────────────────────────────────────

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// ─── Module-Level Singleton ─────────────────────────────────────────────────

let activeManifest: BuildManifest | null = null;
let registeredFlushCallback: ((batch: ObservationBatch) => void) | null = null;
const observer = new DocumentChangeObserver();

export function getActiveManifest(): BuildManifest | null {
  return activeManifest;
}

export function getObserver(): DocumentChangeObserver {
  return observer;
}

/** Register the flush callback once (from code.ts when poller connects). */
export function setFlushCallback(cb: (batch: ObservationBatch) => void): void {
  registeredFlushCallback = cb;
}

/** Get the registered flush callback (used by TRACK_FRAME executor). */
export function getFlushCallback(): ((batch: ObservationBatch) => void) | null {
  return registeredFlushCallback;
}

export function startObservation(
  manifest: BuildManifest,
  flushCallback: (batch: ObservationBatch) => void,
): void {
  activeManifest = manifest;
  observer.start(manifest, flushCallback);
}

export function stopObservation(): void {
  observer.stop();
  activeManifest = null;
}
