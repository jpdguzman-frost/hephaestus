// ─── TRACK_FRAME Executor ────────────────────────────────────────────────────
// Explicitly marks a frame for observation. Extracts the SOM to build a
// BuildManifest, then starts the DocumentChange Observer.

import { executeExtractSom } from "./som-extractor";
import {
  BuildManifest,
  startObservation,
  stopObservation,
  getObserver,
  getFlushCallback,
} from "../build-manifest";

/**
 * Track a frame for refinement observation.
 * Extracts the SOM, builds a manifest from the roleMap, and starts observing.
 */
export async function executeTrackFrame(payload: Record<string, unknown>): Promise<unknown> {
  const nodeId = payload.nodeId as string;
  const brandId = (payload.brandId as string) || "unknown";
  const screenType = (payload.screenType as string) || "unknown";
  const templateId = payload.templateId as string | undefined;

  // Validate the node
  const node = figma.getNodeById(nodeId) as SceneNode | null;
  if (!node) throw new Error("Node " + nodeId + " not found");
  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
    throw new Error("TRACK_FRAME requires a frame-like node, got " + node.type);
  }

  // Need a flush callback to send observations
  const flushCb = getFlushCallback();
  if (!flushCb) {
    throw new Error("Cannot track frame — no relay connection (flush callback not registered)");
  }

  // Stop any existing observation
  if (getObserver().active) {
    stopObservation();
  }

  // Extract SOM to get the roleMap
  const somResult = await executeExtractSom({
    nodeId,
    screenType,
    platform: "mobile",
    assignRoles: true,
    depth: 20,
  }) as { roleMap: Array<{ nodeId: string; nodeName: string; role: string; category: string }> };

  // Build manifest from roleMap
  const manifest = new BuildManifest();
  manifest.buildFromSom(nodeId, somResult.roleMap, brandId, screenType, templateId);

  // Start observation with the registered flush callback
  startObservation(manifest, flushCb);

  return {
    tracked: true,
    frameId: nodeId,
    frameName: node.name,
    brandId,
    screenType,
    nodeCount: manifest.size,
  };
}
