import { Effect } from "effect"
import type { BrowserApiService } from "../browser-api-service/index.ts"

// ============================================================================
// Constants
// ============================================================================

export const BATCH_SIZE = 10 // Number of tabs to create in each batch
export const BATCH_DELAY_MS = 200 // Delay between batches (milliseconds)
export const TAB_LOAD_TIMEOUT_MS = 3000 // Max time to wait for tab metadata
export const SYNC_DEBOUNCE_MS = 300 // Debounce time for workspace sync

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for a tab to have loaded its metadata (title, favicon)
 * This prevents discarding tabs before they have proper metadata
 * which would result in "Untitled" tabs with "about:blank" URLs
 *
 * @param tabId - The tab ID to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Effect that completes when tab has metadata or timeout is reached
 */
export const waitForTabMetadata = (
  tabId: number,
  timeoutMs: number,
): Effect.Effect<void, never> =>
  Effect.async<void>((resume) => {
    let timeoutId: number | null = null
    let resolved = false

    const resolveOnce = () => {
      if (resolved) return
      resolved = true

      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      resume(Effect.succeed(undefined))
    }

    // Listen for tab updates
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId) {
        // Wait for the tab to have a title (means metadata is loaded)
        // We check changeInfo.title OR changeInfo.status === 'complete'
        if (changeInfo.title || changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener)
          resolveOnce()
        }
      }
    }

    chrome.tabs.onUpdated.addListener(listener)

    // Fallback timeout - don't wait forever
    timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolveOnce()
    }, timeoutMs)
  })

/**
 * Helper function to discard tabs after their metadata has loaded
 * Waits for tabs to have proper titles and URLs before discarding
 * This prevents "Untitled" / "about:blank" discarded tabs
 *
 * @param browserApi - BrowserApiService instance
 * @param tabIds - Array of tab IDs to discard
 * @returns Effect that completes when all tabs are discarded
 */
export const discardTabs = (
  browserApi: BrowserApiService,
  tabIds: number[],
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    // Wait for all tabs to have metadata loaded (with timeout)
    yield* Effect.all(
      tabIds.map((tabId) => waitForTabMetadata(tabId, TAB_LOAD_TIMEOUT_MS)),
      { concurrency: "unbounded" },
    )

    // Now discard all tabs
    for (const tabId of tabIds) {
      yield* browserApi.tabs.discard(tabId).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)), // Ignore errors
      )
    }
  })

/**
 * Find bookmark by URL in a workspace folder (recursive search)
 * Returns the bookmark ID if found, null otherwise
 *
 * @param node - The bookmark tree node to search in
 * @param targetUrl - The URL to search for
 * @returns The bookmark ID if found, null otherwise
 */
export const findBookmarkByUrl = (
  node: chrome.bookmarks.BookmarkTreeNode,
  targetUrl: string,
): string | null => {
  // If this is a bookmark with matching URL, return its ID
  if (node.url && node.url === targetUrl) {
    return node.id
  }

  // If this has children, search recursively
  if (node.children) {
    for (const child of node.children) {
      const found = findBookmarkByUrl(child, targetUrl)
      if (found) {
        return found
      }
    }
  }

  return null
}
