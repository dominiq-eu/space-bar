import { Effect } from "effect"
import type { AppState, TabGroup } from "../state-service/types.ts"
import { createAppState } from "../state-service/index.ts"
import { linkWindowToWorkspace, unlinkWindow } from "../storage-service/index.ts"
import { parseGroupMetadata, createGroupTitle, VALID_GROUP_COLORS } from "./metadata-parser.ts"

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
      windowTabs.some((tab) => tab.groupId === group.id),
    )

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
        // Save entire group
        const group = tabGroupMap.get(tab.groupId)
        if (group) {
          const groupTabs = windowTabs.filter((t) => t.groupId === tab.groupId)

          // Create folder for group with metadata
          const groupFolder =
            yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
              chrome.bookmarks.create(
                {
                  parentId: workspaceFolder.id,
                  title: createGroupTitle(group.title || "", group.color, group.collapsed),
                },
                (folder) => resume(Effect.succeed(folder)),
              )
            })

          // Add tabs to group folder
          for (const groupTab of groupTabs) {
            if (groupTab.url && groupTab.title) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: groupTab.url,
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  )
                },
              )
            }
          }

          renderedGroups.add(tab.groupId)
        }
      } else if (tab.groupId === undefined) {
        // Save ungrouped tab
        if (tab.url && tab.title) {
          yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
            chrome.bookmarks.create(
              {
                parentId: workspaceFolder.id,
                title: tab.title,
                url: tab.url,
              },
              (bookmark) => resume(Effect.succeed(bookmark)),
            )
          })
        }
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
      windowTabs.some((tab) => tab.groupId === group.id),
    )

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>()
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group))

    const renderedGroups = new Set<number>()

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
        // Save entire group
        const group = tabGroupMap.get(tab.groupId)
        if (group) {
          const groupTabs = windowTabs.filter((t) => t.groupId === tab.groupId)

          // Create folder for group with metadata
          const groupFolder =
            yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
              chrome.bookmarks.create(
                {
                  parentId: workspaceId,
                  title: createGroupTitle(group.title || "", group.color, group.collapsed),
                },
                (folder) => resume(Effect.succeed(folder)),
              )
            })

          // Add tabs to group folder
          for (const groupTab of groupTabs) {
            if (groupTab.url && groupTab.title) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: groupTab.url,
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  )
                },
              )
            }
          }

          renderedGroups.add(tab.groupId)
        }
      } else if (tab.groupId === undefined) {
        // Save ungrouped tab
        if (tab.url && tab.title) {
          yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
            chrome.bookmarks.create(
              {
                parentId: workspaceId,
                title: tab.title,
                url: tab.url,
              },
              (bookmark) => resume(Effect.succeed(bookmark)),
            )
          })
        }
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
      yield* unlinkWindow(windowId)

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
      yield* linkWindowToWorkspace(windowId, workspaceId)

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
    yield* linkWindowToWorkspace(windowId, workspaceId)

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

// Re-export utilities
export { parseGroupMetadata, createGroupTitle, VALID_GROUP_COLORS }
