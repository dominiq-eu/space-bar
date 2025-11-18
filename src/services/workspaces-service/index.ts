import { Effect, Option } from "effect"
import type { AppState, TabGroup, GroupId, WindowId, WorkspaceId } from "../state-service/types.ts"
import { createAppState } from "../state-service/index.ts"
import { linkWindowToWorkspace, unlinkWindow } from "../storage-service/index.ts"
import {
  parseGroupMetadata,
  createGroupTitle,
  VALID_GROUP_COLORS,
  parseBookmarkPinnedStatus,
  createBookmarkTitle,
  PINNED_FOLDER_NAME,
} from "./metadata-parser.ts"
import {
  urlToString,
  optionToUndefined,
  getOrElse,
  isSome,
  optionContains,
} from "../../utils/type-conversions.ts"

// Global flag to prevent sync during workspace loading
let isLoadingWorkspace = false

/**
 * Check if a workspace is currently being loaded
 * This prevents sync loops during workspace restoration
 */
export const getIsLoadingWorkspace = () => isLoadingWorkspace

/**
 * Set the loading state
 * Internal use only
 */
const setIsLoadingWorkspace = (value: boolean) => {
  isLoadingWorkspace = value
}

// Global sync state management to prevent concurrent syncs
const syncState: Map<string, { isSyncing: boolean; timeoutId: number | null }> = new Map()

/**
 * Get or create sync state for a workspace
 */
const getSyncState = (workspaceId: string) => {
  if (!syncState.has(workspaceId)) {
    syncState.set(workspaceId, { isSyncing: false, timeoutId: null })
  }
  return syncState.get(workspaceId)!
}

// Constants for tab loading optimization
const BATCH_SIZE = 10 // Number of tabs to create in each batch
const BATCH_DELAY_MS = 200 // Delay between batches
const TAB_LOAD_TIMEOUT_MS = 3000 // Max time to wait for tab metadata (3 seconds)

/**
 * Wait for a tab to have loaded its metadata (title, favicon)
 * This prevents discarding tabs before they have proper metadata
 * which would result in "Untitled" tabs with "about:blank" URLs
 *
 * @param tabId - The tab ID to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @returns Promise that resolves when tab has metadata or timeout is reached
 */
const waitForTabMetadata = (tabId: number, timeoutMs: number): Promise<void> => {
  return new Promise((resolve) => {
    let timeoutId: number | null = null
    let resolved = false

    const resolveOnce = () => {
      if (resolved) return
      resolved = true

      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      resolve()
    }

    // Listen for tab updates
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId) {
        // Wait for the tab to have a title (means metadata is loaded)
        // We check changeInfo.title OR changeInfo.status === 'complete'
        if (changeInfo.title || changeInfo.status === 'complete') {
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
}

/**
 * Helper function to discard tabs after their metadata has loaded
 * Waits for tabs to have proper titles and URLs before discarding
 * This prevents "Untitled" / "about:blank" discarded tabs
 *
 * @param tabIds - Array of tab IDs to discard
 */
const discardTabs = async (tabIds: number[]): Promise<void> => {
  // Wait for all tabs to have metadata loaded (with timeout)
  await Promise.all(
    tabIds.map(tabId => waitForTabMetadata(tabId, TAB_LOAD_TIMEOUT_MS))
  )

  // Now discard all tabs
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.discard(tabId)
    } catch (error) {
      // Ignore errors - tab might be active or already discarded
      console.debug(`Could not discard tab ${tabId}:`, error)
    }
  }
}

/**
 * Get the bookmarks bar folder
 */
export const getBookmarksBar = Effect.async<chrome.bookmarks.BookmarkTreeNode>(
  (resume) => {
    chrome.bookmarks.getTree((tree) => {
      const bookmarksBar = tree[0]?.children?.find(
        (node) => node.title === "Bookmarks bar" || node.id === "1",
      )
      if (bookmarksBar) {
        resume(Effect.succeed(bookmarksBar))
      }
    })
  },
)

/**
 * Save current window state as a workspace
 */
export const saveWorkspace = (workspaceName: string, state: AppState) =>
  Effect.gen(function* () {
    const bookmarksBar = yield* getBookmarksBar

    // Create or find workspace folder
    const workspaceFolder =
      yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
        chrome.bookmarks.create(
          {
            parentId: bookmarksBar.id,
            title: workspaceName,
          },
          (folder) => resume(Effect.succeed(folder)),
        )
      })

    // Get current window tabs and groups
    const currentWindow = state.windows.find((w) => w.focused)
    if (!currentWindow?.id) {
      return workspaceFolder
    }

    const windowTabs = state.tabs.filter(
      (tab) => tab.windowId === currentWindow.id,
    )
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => optionContains(tab.groupId, group.id)),
    )

    // Separate pinned and unpinned tabs
    const pinnedTabs = windowTabs.filter((tab) => tab.pinned)
    const unpinnedTabs = windowTabs.filter((tab) => !tab.pinned)

    // Create [pinned] folder if there are pinned tabs
    if (pinnedTabs.length > 0) {
      const pinnedFolder =
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: workspaceFolder.id,
              title: PINNED_FOLDER_NAME,
            },
            (folder) => resume(Effect.succeed(folder)),
          )
        })

      // Add pinned tabs to the [pinned] folder
      for (const pinnedTab of pinnedTabs) {
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: pinnedFolder.id,
              title: pinnedTab.title,
              url: urlToString(pinnedTab.url),
            },
            (bookmark) => resume(Effect.succeed(bookmark)),
          )
        })
      }
    }

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save unpinned tabs and groups in order
    for (const tab of unpinnedTabs) {
      if (isSome(tab.groupId)) {
        const groupId = tab.groupId.value
        if (!renderedGroups.has(groupId)) {
          // Save entire group
          const group = tabGroupMap.get(groupId)
          if (group) {
            const groupTabs = unpinnedTabs.filter((t) =>
              optionContains(t.groupId, groupId)
            )

            // Create folder for group with metadata
            const groupFolder =
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: workspaceFolder.id,
                      title: createGroupTitle(
                        getOrElse(group.title, ""),
                        group.color,
                        group.collapsed,
                      ),
                    },
                    (folder) => resume(Effect.succeed(folder)),
                  )
                },
              )

            // Add tabs to group folder
            for (const groupTab of groupTabs) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: urlToString(groupTab.url),
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  )
                },
              )
            }

            renderedGroups.add(groupId)
          }
        }
      } else {
        // Save ungrouped tab (groupId is None)
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: workspaceFolder.id,
              title: tab.title,
              url: urlToString(tab.url),
            },
            (bookmark) => resume(Effect.succeed(bookmark)),
          )
        })
      }
    }

    return workspaceFolder
  })

/**
 * Internal sync implementation - performs the actual sync
 */
const syncWorkspaceInternal = (windowId: number, workspaceId: string) =>
  Effect.gen(function* () {
    // Get current state
    const state = yield* createAppState()

    // Get workspace bookmark
    const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
      (resume) => {
        chrome.bookmarks.getSubTree(workspaceId, (results) =>
          resume(Effect.succeed(results)),
        )
      },
    )

    const workspace = results[0]
    if (!workspace) {
      return
    }

    // Delete all children (tabs and groups) in one go
    if (workspace.children && workspace.children.length > 0) {
      // Collect all child IDs first
      const childIds = workspace.children.map((child) => child.id)

      // Delete all children sequentially to avoid race conditions
      for (const childId of childIds) {
        yield* Effect.async<void>((resume) => {
          chrome.bookmarks.removeTree(childId, () =>
            resume(Effect.succeed(undefined)),
          )
        })
      }
    }

    // Get tabs for this window
    const windowTabs = state.tabs.filter(
      (tab) => tab.windowId === windowId,
    )
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => optionContains(tab.groupId, group.id)),
    )

    // Separate pinned and unpinned tabs
    const pinnedTabs = windowTabs.filter((tab) => tab.pinned)
    const unpinnedTabs = windowTabs.filter((tab) => !tab.pinned)

    // Create [pinned] folder if there are pinned tabs
    if (pinnedTabs.length > 0) {
      const pinnedFolder =
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: workspaceId,
              title: PINNED_FOLDER_NAME,
            },
            (folder) => resume(Effect.succeed(folder)),
          )
        })

      // Add pinned tabs to the [pinned] folder
      for (const pinnedTab of pinnedTabs) {
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: pinnedFolder.id,
              title: pinnedTab.title,
              url: urlToString(pinnedTab.url),
            },
            (bookmark) => resume(Effect.succeed(bookmark)),
          )
        })
      }
    }

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save unpinned tabs and groups in order
    for (const tab of unpinnedTabs) {
      if (isSome(tab.groupId)) {
        const groupId = tab.groupId.value
        if (!renderedGroups.has(groupId)) {
          // Save entire group
          const group = tabGroupMap.get(groupId)
          if (group) {
            const groupTabs = unpinnedTabs.filter((t) =>
              optionContains(t.groupId, groupId)
            )

            // Create folder for group with metadata
            const groupFolder =
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: workspaceId,
                      title: createGroupTitle(
                        getOrElse(group.title, ""),
                        group.color,
                        group.collapsed,
                      ),
                    },
                    (folder) => resume(Effect.succeed(folder)),
                  )
                },
              )

            // Add tabs to group folder
            for (const groupTab of groupTabs) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: urlToString(groupTab.url),
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  )
                },
              )
            }

            renderedGroups.add(groupId)
          }
        }
      } else {
        // Save ungrouped tab (groupId is None)
        yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
          chrome.bookmarks.create(
            {
              parentId: workspaceId,
              title: tab.title,
              url: urlToString(tab.url),
            },
            (bookmark) => resume(Effect.succeed(bookmark)),
          )
        })
      }
    }
  })

/**
 * Sync workspace with current window state
 * Uses debouncing to prevent multiple concurrent syncs
 */
export const syncWorkspace = (windowId: number, workspaceId: string): Promise<void> => {
  const state = getSyncState(workspaceId)

  // Clear any existing timeout
  if (state.timeoutId !== null) {
    clearTimeout(state.timeoutId)
    state.timeoutId = null
  }

  // Return a promise that resolves after debounced sync
  return new Promise((resolve, reject) => {
    state.timeoutId = setTimeout(() => {
      state.timeoutId = null

      // If already syncing, skip this sync
      if (state.isSyncing) {
        resolve()
        return
      }

      // Mark as syncing
      state.isSyncing = true

      // Perform the actual sync
      Effect.runPromise(syncWorkspaceInternal(windowId, workspaceId))
        .then(() => {
          state.isSyncing = false
          resolve()
        })
        .catch((error) => {
          state.isSyncing = false
          reject(error)
        })
    }, 300) // 300ms debounce
  })
}

/**
 * Load workspace into existing window
 * @param workspaceId - The workspace to load
 * @param windowId - The window to load into
 * @param keepCurrentTabs - If true, keeps current tabs and adds workspace tabs before them
 */
export const loadWorkspaceInWindow = (
  workspaceId: string,
  windowId: number,
  keepCurrentTabs: boolean = false
) =>
  Effect.gen(function* () {
    // Set flag to prevent sync during loading
    setIsLoadingWorkspace(true)

    try {
      // First, unlink the window from any existing workspace
      yield* unlinkWindow(windowId as WindowId)

      // Get workspace folder
      const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
        (resume) => {
          chrome.bookmarks.getSubTree(workspaceId, (results) =>
            resume(Effect.succeed(results)),
          )
        },
      )

      const workspace = results[0]
      if (!workspace?.children) {
        setIsLoadingWorkspace(false)
        return
      }

      // Get current tabs in the window BEFORE loading new ones
      const currentTabs = yield* Effect.async<chrome.tabs.Tab[]>((resume) => {
        chrome.tabs.query({ windowId }, (tabs) => resume(Effect.succeed(tabs)))
      })

      // Collect ALL tab IDs (both pinned and unpinned) to be removed later
      // IMPORTANT: We collect IDs now but delete AFTER creating new tabs
      // to prevent the window from closing (Chrome auto-closes empty windows)
      const oldTabIds = currentTabs
        .filter((tab) => tab.id)
        .map((tab) => tab.id!)

      // Find the position to insert new tabs
      // If keeping tabs, insert after pinned tabs; otherwise doesn't matter
      const pinnedTabsCount = currentTabs.filter((tab) => tab.pinned).length
      const insertIndex = keepCurrentTabs ? pinnedTabsCount : undefined

      // Prepare all tab creation jobs
      type TabJob = {
        url: string
        pinned: boolean
        groupInfo?: {
          title: string
          color: string
          collapsed: boolean
        }
      }

      const tabJobs: TabJob[] = []
      for (const item of workspace.children) {
        if (item.url) {
          // It's a bookmark (ungrouped tab)
          tabJobs.push({ url: item.url, pinned: false })
        } else if (item.children) {
          // Check if it's the [pinned] folder
          if (item.title === PINNED_FOLDER_NAME) {
            // It's the [pinned] folder - all tabs inside are pinned
            for (const bookmark of item.children) {
              if (bookmark.url) {
                tabJobs.push({ url: bookmark.url, pinned: true })
              }
            }
          } else {
            // It's a regular tab group
            const { color, collapsed, title } = parseGroupMetadata(item.title)
            const groupInfo = { title, color, collapsed }

            for (const bookmark of item.children) {
              if (bookmark.url) {
                tabJobs.push({ url: bookmark.url, pinned: false, groupInfo })
              }
            }
          }
        }
      }

      // Phase 1: Create all tabs in batches (NO discard yet)
      const createdTabs: Array<{ id: number; groupInfo?: TabJob['groupInfo'] }> = []
      let currentIndex = insertIndex

      for (let i = 0; i < tabJobs.length; i += BATCH_SIZE) {
        const batch = tabJobs.slice(i, i + BATCH_SIZE)

        // Create batch of tabs
        for (const job of batch) {
          const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
            chrome.tabs.create(
              {
                windowId,
                url: job.url,
                active: false,
                pinned: job.pinned,
                index: currentIndex,
              },
              (tab) => resume(Effect.succeed(tab)),
            )
          })

          if (tab.id) {
            createdTabs.push({ id: tab.id, groupInfo: job.groupInfo })
          }
          if (currentIndex !== undefined) currentIndex++
        }

        // Delay before next batch (except for last batch)
        // This keeps the browser responsive without discarding
        if (i + BATCH_SIZE < tabJobs.length) {
          yield* Effect.async<void>((resume) => {
            setTimeout(() => resume(Effect.succeed(undefined)), BATCH_DELAY_MS)
          })
        }
      }

      // Phase 2: Create groups for tabs that need to be grouped
      const groupMap = new Map<string, number[]>() // groupKey -> tabIds

      for (const { id, groupInfo } of createdTabs) {
        if (groupInfo) {
          const groupKey = `${groupInfo.title}|${groupInfo.color}|${groupInfo.collapsed}`
          if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, [])
          }
          groupMap.get(groupKey)!.push(id)
        }
      }

      // Create and configure groups
      for (const [groupKey, tabIds] of groupMap.entries()) {
        if (tabIds.length > 0) {
          const [title, color, collapsed] = groupKey.split('|')

          const groupId = yield* Effect.async<number>((resume) => {
            chrome.tabs.group({ tabIds }, (groupId) =>
              resume(Effect.succeed(groupId)),
            )
          })

          yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
            chrome.tabGroups.update(
              groupId,
              {
                title: title || undefined,
                color: color as chrome.tabGroups.ColorEnum,
                collapsed: collapsed === 'true',
              },
              (group) => resume(Effect.succeed(group)),
            )
          })
        }
      }

      // Phase 3: Now discard ALL tabs at once
      const allTabIds = createdTabs.map(t => t.id)
      if (allTabIds.length > 0) {
        // Use Promise wrapper for async discard
        yield* Effect.async<void>((resume) => {
          discardTabs(allTabIds)
            .then(() => resume(Effect.succeed(undefined)))
            .catch((error) => {
              console.error('Failed to discard tabs:', error)
              resume(Effect.succeed(undefined)) // Continue even if discard fails
            })
        })
      }

      // Phase 4: NOW delete old tabs AFTER new tabs are created
      // CRITICAL: This MUST happen AFTER creating new tabs to prevent window closure
      // Chrome automatically closes windows when the last tab is removed
      // By creating new tabs first, we ensure the window always has at least one tab
      if (!keepCurrentTabs && oldTabIds.length > 0) {
        yield* Effect.async<void>((resume) => {
          chrome.tabs.remove(oldTabIds, () =>
            resume(Effect.succeed(undefined)),
          )
        })
      }

      // Now link the window to the new workspace
      yield* linkWindowToWorkspace(windowId as WindowId, workspaceId as WorkspaceId)
    } finally {
      // Reset flag after loading is complete
      setIsLoadingWorkspace(false)
    }
  })

/**
 * Restore workspace in a new window
 */
export const restoreWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    // Get workspace folder
    const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
      (resume) => {
        chrome.bookmarks.getSubTree(workspaceId, (results) =>
          resume(Effect.succeed(results)),
        )
      },
    )

    const workspace = results[0]
    if (!workspace?.children) {
      return
    }

    // Create new window for workspace
    const newWindow = yield* Effect.async<chrome.windows.Window>((resume) => {
      chrome.windows.create({}, (window) => {
        if (window) {
          resume(Effect.succeed(window))
        }
      })
    })

    const windowId = newWindow.id
    if (!windowId) {
      return
    }

    // Link window to workspace
    yield* linkWindowToWorkspace(windowId as WindowId, workspaceId as WorkspaceId)

    // Close the default new tab
    const firstTab = newWindow.tabs?.[0]
    if (firstTab?.id) {
      yield* Effect.async<void>((resume) => {
        chrome.tabs.remove(firstTab.id!, () =>
          resume(Effect.succeed(undefined)),
        )
      })
    }

    // Prepare all tab creation jobs
    type TabJob = {
      url: string
      pinned: boolean
      groupInfo?: {
        title: string
        color: string
        collapsed: boolean
      }
    }

    const tabJobs: TabJob[] = []
    for (const item of workspace.children) {
      if (item.url) {
        // It's a bookmark (ungrouped tab)
        tabJobs.push({ url: item.url, pinned: false })
      } else if (item.children) {
        // Check if it's the [pinned] folder
        if (item.title === PINNED_FOLDER_NAME) {
          // It's the [pinned] folder - all tabs inside are pinned
          for (const bookmark of item.children) {
            if (bookmark.url) {
              tabJobs.push({ url: bookmark.url, pinned: true })
            }
          }
        } else {
          // It's a regular tab group
          const { color, collapsed, title } = parseGroupMetadata(item.title)
          const groupInfo = { title, color, collapsed }

          for (const bookmark of item.children) {
            if (bookmark.url) {
              tabJobs.push({ url: bookmark.url, pinned: false, groupInfo })
            }
          }
        }
      }
    }

    // Phase 1: Create all tabs in batches (NO discard yet)
    const createdTabs: Array<{ id: number; groupInfo?: TabJob['groupInfo'] }> = []

    for (let i = 0; i < tabJobs.length; i += BATCH_SIZE) {
      const batch = tabJobs.slice(i, i + BATCH_SIZE)

      // Create batch of tabs
      for (const job of batch) {
        const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
          chrome.tabs.create(
            {
              windowId,
              url: job.url,
              active: false,
              pinned: job.pinned,
            },
            (tab) => resume(Effect.succeed(tab)),
          )
        })

        if (tab.id) {
          createdTabs.push({ id: tab.id, groupInfo: job.groupInfo })
        }
      }

      // Delay before next batch (except for last batch)
      // This keeps the browser responsive without discarding
      if (i + BATCH_SIZE < tabJobs.length) {
        yield* Effect.async<void>((resume) => {
          setTimeout(() => resume(Effect.succeed(undefined)), BATCH_DELAY_MS)
        })
      }
    }

    // Phase 2: Create groups for tabs that need to be grouped
    const groupMap = new Map<string, number[]>() // groupKey -> tabIds

    for (const { id, groupInfo } of createdTabs) {
      if (groupInfo) {
        const groupKey = `${groupInfo.title}|${groupInfo.color}|${groupInfo.collapsed}`
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, [])
        }
        groupMap.get(groupKey)!.push(id)
      }
    }

    // Create and configure groups
    for (const [groupKey, tabIds] of groupMap.entries()) {
      if (tabIds.length > 0) {
        const [title, color, collapsed] = groupKey.split('|')

        const groupId = yield* Effect.async<number>((resume) => {
          chrome.tabs.group({ tabIds }, (groupId) =>
            resume(Effect.succeed(groupId)),
          )
        })

        yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
          chrome.tabGroups.update(
            groupId,
            {
              title: title || undefined,
              color: color as chrome.tabGroups.ColorEnum,
              collapsed: collapsed === 'true',
            },
            (group) => resume(Effect.succeed(group)),
          )
        })
      }
    }

    // Phase 3: Now discard ALL tabs at once
    const allTabIds = createdTabs.map(t => t.id)
    if (allTabIds.length > 0) {
      // Use Promise wrapper for async discard
      yield* Effect.async<void>((resume) => {
        discardTabs(allTabIds)
          .then(() => resume(Effect.succeed(undefined)))
          .catch((error) => {
            console.error('Failed to discard tabs:', error)
            resume(Effect.succeed(undefined)) // Continue even if discard fails
          })
      })
    }

    return newWindow
  })

/**
 * Delete a workspace
 */
export const deleteWorkspace = (workspaceId: string) =>
  Effect.async<void>((resume) => {
    chrome.bookmarks.removeTree(workspaceId, () =>
      resume(Effect.succeed(undefined)),
    )
  })

/**
 * Rename a workspace
 */
export const renameWorkspace = (workspaceId: string, newName: string) =>
  Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
    chrome.bookmarks.update(workspaceId, { title: newName }, (result) =>
      resume(Effect.succeed(result)),
    )
  })

/**
 * Find bookmark by URL in a workspace folder (recursive search)
 * Returns the bookmark ID if found, None otherwise
 */
const findBookmarkByUrl = (
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

/**
 * Rename a tab's bookmark in a workspace
 * Finds the bookmark by URL and updates its title
 * Preserves the [pinned] prefix if the tab is pinned
 *
 * @param windowId - The window ID to find the linked workspace
 * @param tabUrl - The URL of the tab to rename
 * @param newTitle - The new title for the bookmark (without [pinned] prefix)
 * @param isPinned - Whether the tab is currently pinned
 * @returns Effect that completes when rename is done, or fails if not in a workspace
 */
export const renameTabBookmark = (
  windowId: WindowId,
  tabUrl: string,
  newTitle: string,
  isPinned: boolean,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    // Import here to avoid circular dependency
    const { getWorkspaceForWindow } = yield* Effect.promise(() =>
      import("../storage-service/index.ts")
    )

    // Get workspace for window
    const workspaceIdOption = yield* getWorkspaceForWindow(windowId)

    if (!isSome(workspaceIdOption)) {
      return yield* Effect.fail(
        new Error("Window is not linked to a workspace"),
      )
    }

    const workspaceId = workspaceIdOption.value

    // Get workspace bookmark tree
    const workspaceTree = yield* Effect.async<
      chrome.bookmarks.BookmarkTreeNode[],
      Error
    >((resume) => {
      chrome.bookmarks.getSubTree(workspaceId, (results) => {
        const error = chrome.runtime.lastError
        if (error || !results || results.length === 0) {
          resume(Effect.fail(new Error("Failed to load workspace bookmarks")))
          return
        }
        resume(Effect.succeed(results))
      })
    })

    // Find bookmark by URL
    const workspaceNode = workspaceTree[0]
    const bookmarkId = findBookmarkByUrl(workspaceNode, tabUrl)

    if (!bookmarkId) {
      return yield* Effect.fail(
        new Error("Bookmark not found for this tab URL"),
      )
    }

    // Create bookmark title with [pinned] prefix if needed
    const bookmarkTitle = createBookmarkTitle(newTitle, isPinned)

    // Update bookmark title
    yield* Effect.async<void, Error>((resume) => {
      chrome.bookmarks.update(bookmarkId, { title: bookmarkTitle }, () => {
        const error = chrome.runtime.lastError
        if (error) {
          resume(Effect.fail(new Error(`Failed to rename bookmark: ${error.message}`)))
          return
        }
        resume(Effect.succeed(undefined))
      })
    })
  })

// Re-export utilities
export {
  parseGroupMetadata,
  createGroupTitle,
  VALID_GROUP_COLORS,
  parseBookmarkPinnedStatus,
  createBookmarkTitle,
}
