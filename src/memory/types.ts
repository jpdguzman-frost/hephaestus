// ─── Rex Memory Types ────────────────────────────────────────────────────────

export type MemoryScope = "user" | "team" | "file" | "page";

export type MemoryCategory =
  | "decision"
  | "convention"
  | "context"
  | "rejection"
  | "relationship"
  | "preference"
  | "correction";

export type MemorySource = "explicit" | "inferred" | "corrected";

export interface MemoryUser {
  id: string;
  name: string;
}

export interface MemoryEntry {
  _id: string;
  scope: MemoryScope;

  // Scope keys
  userId?: string;
  fileKey?: string;
  fileName?: string;

  // Design system reference (stable across publishes)
  componentKey?: string;

  // Content
  category: MemoryCategory;
  content: string;
  tags: string[];

  // Provenance
  source: MemorySource;
  createdBy: MemoryUser;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;

  // Lifecycle
  confidence: number;
  supersededBy?: string;
  relatedTo?: string[];
  accessCount: number;
}

export interface MemoryConfig {
  enabled: boolean;
  serviceUrl: string;
  maxMemoriesPerSession: number;
  cleanupIntervalHours: number;
}

/** A chat session grouping messages together. */
export interface ChatSession {
  sessionId: string;
  name: string;
  summary: string;
  fileKey: string;
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
}

/** A single chat message persisted for history. */
export interface ChatHistoryEntry {
  id: string;
  role: "user" | "assistant";
  message: string;
  timestamp: number;
  fileKey: string;
  sessionId?: string;
  selection?: Array<{ id: string; name: string; type: string }>;
}

/** Context passed to memory operations from the active session. */
export interface MemoryContext {
  userId?: string;
  userName?: string;
  fileKey?: string;
  fileName?: string;
  pageId?: string;
  pageName?: string;
  componentKey?: string;
}
