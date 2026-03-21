// ─── Osiris HTTP Client ──────────────────────────────────────────────────────
// Forwards refinement observations from the Rex relay to Osiris for storage.

import type { Logger } from "../shared/logger.js";

export interface RefinementRecord {
  sessionId?: string;
  brandId: string;
  screenType: string;
  frameId: string;
  templateId?: string;
  changes: Array<{
    nodeId: string;
    role: string;
    name: string;
    property: string;
    from: unknown;
    to: unknown;
  }>;
  observationDuration: number;
  changeCount: number;
  fileKey?: string;
  user?: { id: string; name: string };
  createdAt: string;
}

export class OsirisClient {
  private baseUrl: string;
  private logger: Logger;

  constructor(baseUrl: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger;
  }

  async saveRefinementRecord(record: RefinementRecord): Promise<void> {
    try {
      const resp = await fetch(this.baseUrl + "/api/refinement-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      if (!resp.ok) {
        const body = await resp.text();
        this.logger.warn("Osiris refinement save failed", {
          status: resp.status,
          body: body.slice(0, 200),
        });
      }
    } catch (err) {
      this.logger.warn("Osiris refinement save error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
