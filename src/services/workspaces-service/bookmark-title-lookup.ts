import { Effect } from "effect"
import type { WorkspaceId } from "../state-service/types.ts"

/**
 * Recursively collects all bookmark URLs and titles from a workspace folder
 * Returns a Map of URL → Bookmark Title
 */
const collectBookmarkTitles = (
  bookmarkNode: chrome.bookmarks.BookmarkTreeNode,
  titleMap: Map<string, string>,
): void => {
  // If this is a bookmark (has URL), add it to the map
  if (bookmarkNode.url) {
    titleMap.set(bookmarkNode.url, bookmarkNode.title || "")
  }

  // If this has children (is a folder), recurse
  if (bookmarkNode.children) {
    for (const child of bookmarkNode.children) {
      collectBookmarkTitles(child, titleMap)
    }
  }
}

/**
 * Get all bookmark titles for a workspace
 * Returns a Map of URL → Bookmark Title
 *
 * @param workspaceId - The ID of the workspace folder
 * @returns Effect that resolves to a Map<url, title>
 *
 * @example
 * const titles = yield* getBookmarkTitlesForWorkspace(workspaceId)
 * const title = titles.get("https://github.com") // "My GitHub"
 */
export const getBookmarkTitlesForWorkspace = (
  workspaceId: WorkspaceId,
): Effect.Effect<Map<string, string>, never> =>
  Effect.async<Map<string, string>, never>((resume) => {
    chrome.bookmarks.getSubTree(workspaceId, (results) => {
      // Immediately check and consume lastError to prevent Chrome from logging it
      // This handles cases where the workspace bookmark was deleted
      const error = chrome.runtime.lastError
      if (error || !results || results.length === 0) {
        // Silently handle error - workspace bookmark might have been deleted
        resume(Effect.succeed(new Map()))
        return
      }

      const workspaceNode = results[0]
      const titleMap = new Map<string, string>()

      // Recursively collect all bookmark titles
      collectBookmarkTitles(workspaceNode, titleMap)

      resume(Effect.succeed(titleMap))
    })
  })

/**
 * Get bookmark titles for multiple workspaces
 * Returns a Map of WorkspaceId → Map<url, title>
 *
 * @param workspaceIds - Array of workspace IDs
 * @returns Effect that resolves to a Map<workspaceId, Map<url, title>>
 */
export const getBookmarkTitlesForWorkspaces = (
  workspaceIds: WorkspaceId[],
): Effect.Effect<Map<WorkspaceId, Map<string, string>>, never> =>
  Effect.gen(function* () {
    const result = new Map<WorkspaceId, Map<string, string>>()

    for (const workspaceId of workspaceIds) {
      const titleMap = yield* getBookmarkTitlesForWorkspace(workspaceId)
      result.set(workspaceId, titleMap)
    }

    return result
  })
