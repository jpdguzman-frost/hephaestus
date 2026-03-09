// ─── Page Executors ─────────────────────────────────────────────────────────
// CREATE_PAGE, RENAME_PAGE, DELETE_PAGE, SET_CURRENT_PAGE

/**
 * Create a new page in the document.
 */
export async function executeCreatePage(payload: Record<string, unknown>): Promise<unknown> {
  const page = figma.createPage();
  page.name = payload.name as string;

  // Optionally reorder the page
  if (payload.index !== undefined) {
    const idx = payload.index as number;
    const doc = figma.root;
    // Move page to desired index by re-inserting
    doc.insertChild(Math.min(idx, doc.children.length), page);
  }

  return {
    pageId: page.id,
    name: page.name,
  };
}

/**
 * Rename a page.
 */
export async function executeRenamePage(payload: Record<string, unknown>): Promise<unknown> {
  const pageId = payload.pageId as string;
  const page = figma.getNodeById(pageId) as PageNode;
  if (!page || page.type !== "PAGE") {
    throw new Error(`Page ${pageId} not found`);
  }

  page.name = payload.name as string;

  return {
    pageId: page.id,
    name: page.name,
  };
}

/**
 * Delete a page and all its contents.
 */
export async function executeDeletePage(payload: Record<string, unknown>): Promise<unknown> {
  const pageId = payload.pageId as string;
  const page = figma.getNodeById(pageId) as PageNode;
  if (!page || page.type !== "PAGE") {
    throw new Error(`Page ${pageId} not found`);
  }

  // Don't delete the last page
  if (figma.root.children.length <= 1) {
    throw new Error("Cannot delete the last page in the document");
  }

  // If we're deleting the current page, switch to another page first
  if (figma.currentPage === page) {
    const otherPage = figma.root.children.find(p => p.id !== pageId);
    if (otherPage) {
      figma.currentPage = otherPage as PageNode;
    }
  }

  page.remove();

  return { deleted: pageId };
}

/**
 * Switch the active page in Figma.
 */
export async function executeSetCurrentPage(payload: Record<string, unknown>): Promise<unknown> {
  const pageId = payload.pageId as string;
  const page = figma.getNodeById(pageId) as PageNode;
  if (!page || page.type !== "PAGE") {
    throw new Error(`Page ${pageId} not found`);
  }

  figma.currentPage = page;

  return {
    pageId: page.id,
    name: page.name,
  };
}
