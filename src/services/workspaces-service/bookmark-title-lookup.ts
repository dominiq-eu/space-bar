import { Effect } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import type { WorkspaceId } from "../state-service/schema.ts"
import { parseBookmarkPinnedStatus } from "./metadata-parser.ts"
import { annotateOperation } from "../../utils/logging.ts"

/**
 * Recursively collects all bookmark URLs and titles from a workspace folder
 * Returns a Map of URL → Bookmark Title (without [pinned] prefix)
 */
const collectBookmarkTitles = (
  bookmarkNode: chrome.bookmarks.BookmarkTreeNode,
  titleMap: Map<string, string>,
): void => {
  // If this is a bookmark (has URL), add it to the map
  if (bookmarkNode.url) {
    // Parse title to remove [pinned] prefix if present
    const { title } = parseBookmarkPinnedStatus(bookmarkNode.title || "")
    titleMap.set(bookmarkNode.url, title)
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
): Effect.Effect<Map<string, string>, never, BrowserApiService> => {
  const program = Effect.gen(function* () {
    const browserApi = yield* BrowserApiService

    const results = yield* browserApi.bookmarks.getSubTree(workspaceId).pipe(
      Effect.tapError((error) =>
        Effect.logWarning(
          "Failed to load bookmark subtree, returning empty map",
          error,
        ).pipe(
          Effect.annotateLogs({ workspaceId }),
        )
      ),
      Effect.catchAll(() => Effect.succeed([])),
    )

    if (results.length === 0) {
      return new Map<string, string>()
    }

    const workspaceNode = results[0]
    const titleMap = new Map<string, string>()

    // Recursively collect all bookmark titles
    collectBookmarkTitles(workspaceNode, titleMap)

    return titleMap
  })

  return program.pipe(
    Effect.tapError((error) =>
      Effect.logWarning(
        "Failed to get bookmark titles for workspace",
        error,
      ).pipe(
        Effect.annotateLogs({ workspaceId }),
      )
    ),
    Effect.catchAll(() => Effect.succeed(new Map())),
    annotateOperation("WorkspacesService", "getBookmarkTitlesForWorkspace", {
      workspaceId,
    }),
  )
}

/**
 * Get bookmark titles for multiple workspaces
 * Returns a Map of WorkspaceId → Map<url, title>
 *
 * @param workspaceIds - Array of workspace IDs
 * @returns Effect that resolves to a Map<workspaceId, Map<url, title>>
 */
export const getBookmarkTitlesForWorkspaces = (
  workspaceIds: WorkspaceId[],
): Effect.Effect<
  Map<WorkspaceId, Map<string, string>>,
  never,
  BrowserApiService
> =>
  Effect.gen(function* () {
    const result = new Map<WorkspaceId, Map<string, string>>()

    for (const workspaceId of workspaceIds) {
      const titleMap = yield* getBookmarkTitlesForWorkspace(workspaceId)
      result.set(workspaceId, titleMap)
    }

    return result
  })
