import { Effect } from "effect"
import { getWindows } from "../windows-service/index.ts"
import { getTabGroups } from "../tabs-service/index.ts"
import { mapChromeTabs } from "../tabs-service/mappers.ts"
import { STORAGE_KEY_WINDOW_WORKSPACE_MAP } from "../storage-service/index.ts"
import { getBookmarkTitlesForWorkspace } from "../workspaces-service/bookmark-title-lookup.ts"
import type { WorkspaceId } from "./types.ts"

/**
 * Get current timestamp
 */
export const getCurrentTime = () => Effect.succeed(new Date())

/**
 * Load window-workspace mappings from storage
 */
const loadWindowWorkspaceMap = (): Effect.Effect<
  Record<number, string>,
  never
> =>
  Effect.async<Record<number, string>, never>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {}
      resume(Effect.succeed(map))
    })
  })

/**
 * Get tabs with bookmark titles resolved
 * Loads bookmark titles for all linked workspaces and uses them when mapping tabs
 */
const getTabsWithBookmarkTitles = (): Effect.Effect<
  chrome.tabs.Tab[],
  never
> =>
  Effect.async<chrome.tabs.Tab[], never>((resume) => {
    chrome.tabs.query({}, (chromeTabs) => {
      resume(Effect.succeed(chromeTabs))
    })
  })

/**
 * Create complete app state by fetching all data
 * Includes bookmark title resolution for tabs in linked workspaces
 */
export const createAppState = () =>
  Effect.gen(function* () {
    // Load all data in parallel
    const [chromeTabs, tabGroups, windows, windowWorkspaceMap] = yield* Effect
      .all([
        getTabsWithBookmarkTitles(),
        getTabGroups(),
        getWindows(),
        loadWindowWorkspaceMap(),
      ])

    // Collect unique workspace IDs from the map
    const workspaceIds = new Set<WorkspaceId>(
      Object.values(windowWorkspaceMap).filter(Boolean) as WorkspaceId[],
    )

    // Load bookmark titles for all workspaces
    const workspaceBookmarkTitles = new Map<WorkspaceId, Map<string, string>>()
    for (const workspaceId of workspaceIds) {
      const titleMap = yield* getBookmarkTitlesForWorkspace(workspaceId)
      workspaceBookmarkTitles.set(workspaceId, titleMap)
    }

    // Create a combined bookmark title map for all tabs
    // Group by window and apply workspace-specific titles
    const bookmarkTitleMap = new Map<string, string>()
    for (const chromeTab of chromeTabs) {
      if (chromeTab.windowId !== undefined && chromeTab.url) {
        const workspaceId = windowWorkspaceMap[chromeTab.windowId] as
          | WorkspaceId
          | undefined
        if (workspaceId) {
          const titleMap = workspaceBookmarkTitles.get(workspaceId)
          const bookmarkTitle = titleMap?.get(chromeTab.url)
          if (bookmarkTitle) {
            bookmarkTitleMap.set(chromeTab.url, bookmarkTitle)
          }
        }
      }
    }

    // Map tabs with bookmark titles
    const tabs = yield* mapChromeTabs(chromeTabs, bookmarkTitleMap)

    return {
      timestamp: new Date(),
      tabs,
      tabGroups,
      windows,
    }
  })

// Re-export types for convenience
export type { AppState, Tab, TabGroup, Window } from "./types.ts"
