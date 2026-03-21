// ─── Osiris HTTP Client ──────────────────────────────────────────────────────
// Forwards refinement observations and queries property patterns from Osiris.

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

  async getPatterns(query: { brandId?: string; role?: string; status?: string }): Promise<Array<{ role: string; property: string; modeValue: unknown; status: string; consistency: number; occurrences: number }>> {
    try {
      const params = new URLSearchParams();
      if (query.brandId) params.set("brandId", query.brandId);
      if (query.role) params.set("role", query.role);
      if (query.status) params.set("status", query.status);
      const resp = await fetch(this.baseUrl + "/api/property-patterns?" + params.toString());
      if (!resp.ok) return [];
      const data = await resp.json() as { patterns?: unknown[] };
      return (data.patterns || []) as Array<{ role: string; property: string; modeValue: unknown; status: string; consistency: number; occurrences: number }>;
    } catch (err) {
      this.logger.warn("Osiris pattern fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
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
