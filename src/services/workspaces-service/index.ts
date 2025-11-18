import { Effect, Option } from "effect"
import type { AppState, TabGroup, GroupId, WindowId, WorkspaceId } from "../state-service/types.ts"
import { createAppState } from "../state-service/index.ts"
import { linkWindowToWorkspace, unlinkWindow } from "../storage-service/index.ts"
import { parseGroupMetadata, createGroupTitle, VALID_GROUP_COLORS } from "./metadata-parser.ts"
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
      (tab) => tab.windowId === currentWindow.id && !tab.pinned,
    )
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => optionContains(tab.groupId, group.id)),
    )

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (isSome(tab.groupId)) {
        const groupId = tab.groupId.value
        if (!renderedGroups.has(groupId)) {
          // Save entire group
          const group = tabGroupMap.get(groupId)
          if (group) {
            const groupTabs = windowTabs.filter((t) =>
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
 * Sync workspace with current window state
 */
export const syncWorkspace = (windowId: number, workspaceId: string) =>
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

    // Delete all children (tabs and groups)
    if (workspace.children) {
      for (const child of workspace.children) {
        yield* Effect.async<void>((resume) => {
          chrome.bookmarks.removeTree(child.id, () =>
            resume(Effect.succeed(undefined)),
          )
        })
      }
    }

    // Get tabs for this window
    const windowTabs = state.tabs.filter(
      (tab) => tab.windowId === windowId && !tab.pinned,
    )
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => optionContains(tab.groupId, group.id)),
    )

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (isSome(tab.groupId)) {
        const groupId = tab.groupId.value
        if (!renderedGroups.has(groupId)) {
          // Save entire group
          const group = tabGroupMap.get(groupId)
          if (group) {
            const groupTabs = windowTabs.filter((t) =>
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
 * Load workspace into existing window
 */
export const loadWorkspaceInWindow = (workspaceId: string, windowId: number) =>
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

      const unpinnedTabIds = currentTabs
        .filter((tab) => !tab.pinned && tab.id)
        .map((tab) => tab.id!)

      // First, restore tabs and groups from workspace
      for (const item of workspace.children) {
        if (item.url) {
          // It's a bookmark (ungrouped tab)
          yield* Effect.async<chrome.tabs.Tab>((resume) => {
            chrome.tabs.create(
              {
                windowId,
                url: item.url,
                active: false,
              },
              (tab) => resume(Effect.succeed(tab)),
            )
          })
        } else if (item.children) {
          // It's a folder (tab group)
          const { color, collapsed, title } = parseGroupMetadata(item.title)

          // Create tabs first
          const tabIds: number[] = []
          for (const bookmark of item.children) {
            if (bookmark.url) {
              const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
                chrome.tabs.create(
                  {
                    windowId,
                    url: bookmark.url,
                    active: false,
                  },
                  (tab) => resume(Effect.succeed(tab)),
                )
              })
              if (tab.id) tabIds.push(tab.id)
            }
          }

          // Group the tabs
          if (tabIds.length > 0) {
            const groupId = yield* Effect.async<number>((resume) => {
              chrome.tabs.group({ tabIds }, (groupId) =>
                resume(Effect.succeed(groupId)),
              )
            })

            // Update group properties
            yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
              chrome.tabGroups.update(
                groupId,
                {
                  title,
                  color: color as chrome.tabGroups.ColorEnum,
                  collapsed,
                },
                (group) => resume(Effect.succeed(group)),
              )
            })
          }
        }
      }

      // Now link the window to the new workspace
      yield* linkWindowToWorkspace(windowId as WindowId, workspaceId as WorkspaceId)

      // Finally, close all old unpinned tabs AFTER loading the new ones
      if (unpinnedTabIds.length > 0) {
        yield* Effect.async<void>((resume) => {
          chrome.tabs.remove(unpinnedTabIds, () =>
            resume(Effect.succeed(undefined)),
          )
        })
      }
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

    // Restore tabs and groups
    for (const item of workspace.children) {
      if (item.url) {
        // It's a bookmark (ungrouped tab)
        yield* Effect.async<chrome.tabs.Tab>((resume) => {
          chrome.tabs.create(
            {
              windowId,
              url: item.url,
              active: false,
            },
            (tab) => resume(Effect.succeed(tab)),
          )
        })
      } else if (item.children) {
        // It's a folder (tab group)
        const { color, collapsed, title } = parseGroupMetadata(item.title)

        // Create tabs first
        const tabIds: number[] = []
        for (const bookmark of item.children) {
          if (bookmark.url) {
            const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
              chrome.tabs.create(
                {
                  windowId,
                  url: bookmark.url,
                  active: false,
                },
                (tab) => resume(Effect.succeed(tab)),
              )
            })
            if (tab.id) tabIds.push(tab.id)
          }
        }

        // Group the tabs
        if (tabIds.length > 0) {
          const groupId = yield* Effect.async<number>((resume) => {
            chrome.tabs.group({ tabIds }, (groupId) =>
              resume(Effect.succeed(groupId)),
            )
          })

          // Update group properties
          yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
            chrome.tabGroups.update(
              groupId,
              {
                title,
                color: color as chrome.tabGroups.ColorEnum,
                collapsed,
              },
              (group) => resume(Effect.succeed(group)),
            )
          })
        }
      }
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
 *
 * @param windowId - The window ID to find the linked workspace
 * @param tabUrl - The URL of the tab to rename
 * @param newTitle - The new title for the bookmark
 * @returns Effect that completes when rename is done, or fails if not in a workspace
 */
export const renameTabBookmark = (
  windowId: WindowId,
  tabUrl: string,
  newTitle: string,
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

    // Update bookmark title
    yield* Effect.async<void, Error>((resume) => {
      chrome.bookmarks.update(bookmarkId, { title: newTitle }, () => {
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
export { parseGroupMetadata, createGroupTitle, VALID_GROUP_COLORS }
