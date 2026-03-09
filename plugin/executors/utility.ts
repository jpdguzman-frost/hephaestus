// ─── Utility Executors ──────────────────────────────────────────────────────
// EXECUTE (eval code), PING (health check)

/**
 * Execute arbitrary JavaScript code in the Figma plugin context.
 * Code is wrapped in an async IIFE with timeout enforcement.
 * Blocks access to fetch and __html__ for security.
 */
export async function executeExecute(payload: Record<string, unknown>): Promise<unknown> {
  const code = payload.code as string;
  const timeout = Math.min((payload.timeout as number) || 10000, 30000);

  // Security: block dangerous globals
  if (code.includes("fetch(") || code.includes("fetch (")) {
    throw new Error("Access to fetch is not allowed in execute commands");
  }
  if (code.includes("__html__")) {
    throw new Error("Access to __html__ is not allowed in execute commands");
  }
  if (code.includes("XMLHttpRequest")) {
    throw new Error("Access to XMLHttpRequest is not allowed in execute commands");
  }

  // Wrap code in async IIFE
  const wrappedCode = `(async () => { ${code} })()`;

  // Execute with timeout
  const result = await Promise.race([
    eval(wrappedCode),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout);
    }),
  ]);

  // Attempt to serialize the result
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return { value: String(result) };
  }
}

/**
 * Health check / ping. Returns basic plugin info.
 */
export async function executePing(_payload: Record<string, unknown>): Promise<unknown> {
  return {
    status: "ok",
    timestamp: Date.now(),
    fileKey: figma.fileKey,
    fileName: figma.root.name,
    currentPage: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
    },
  };
}
