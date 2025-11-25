// ============================================================================
// Apply Algorithm - Apply Operations to Tabs or Bookmarks
// ============================================================================

import { Effect } from "effect"
import type { BrowserApiService } from "../browser-api-service/types.ts"
import type { Operation } from "./reconciliation.ts"
import {
  createBookmarkTitle,
  createGroupTitle,
  parseBookmarkPinnedStatus,
  parseGroupMetadata,
  PINNED_FOLDER_NAME,
} from "../workspaces-service/metadata-parser.ts"
import { findBookmarkByUrl } from "../workspaces-service/utils.ts"

// ============================================================================
// Apply Operations to Tabs
// ============================================================================

/**
 * Apply operations to Chrome Tabs
 *
 * @param windowId - Target window ID
 * @param operations - List of operations to apply
 * @param browserApi - Browser API service
 */
export const applyOperationsToTabs = (
  windowId: number,
  operations: ReadonlyArray<Operation>,
  browserApi: BrowserApiService,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    console.log(`Applying ${operations.length} operations to tabs in window ${windowId}`)

    // Get current tabs and groups for lookups
    const currentTabs = yield* browserApi.tabs.query({ windowId })
    const currentGroups = yield* browserApi.tabGroups.query({ windowId })

    // Create lookup maps (by ID and URL)
    const tabsByUrl = new Map(
      currentTabs
        .filter((t) => t.url)
        .map((t) => [t.url!, t]),
    )

    for (const op of operations) {
      try {
        switch (op.type) {
          case "ADD_ITEM": {
            console.log(`  [ADD_ITEM] ${op.item.url}`)

            // Create tab
            const createProps: chrome.tabs.CreateProperties = {
              windowId,
              url: op.item.url,
              pinned: op.item.pinned,
              active: false,
              index: op.item.index,
            }

            const newTab = yield* browserApi.tabs.create(createProps).pipe(
              Effect.catchAll((error) => {
                console.error(`Failed to create tab: ${error}`)
                return Effect.succeed(undefined)
              }),
            )

            // If item has a group, add to group
            if (op.item.groupId && newTab?.id) {
              yield* browserApi.tabs
                .group({
                  tabIds: newTab.id,
                  groupId: Number(op.item.groupId),
                })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to add tab to group: ${error}`)
                    return Effect.succeed(0)
                  }),
                )
            }

            break
          }

          case "DELETE_ITEM": {
            console.log(`  [DELETE_ITEM] ${op.itemId}`)

            // Find tab by ID or URL
            const tab = currentTabs.find((t) => String(t.id) === op.itemId)

            if (tab?.id) {
              yield* browserApi.tabs.remove(tab.id).pipe(
                Effect.catchAll((error) => {
                  console.error(`Failed to remove tab: ${error}`)
                  return Effect.succeed(undefined)
                }),
              )
            }

            break
          }

          case "UPDATE_ITEM": {
            console.log(`  [UPDATE_ITEM] ${op.itemId}`, op.changes)

            // Find tab
            const tab = currentTabs.find((t) => String(t.id) === op.itemId)

            if (!tab?.id) {
              console.warn(`Tab ${op.itemId} not found for update`)
              break
            }

            // Apply property updates
            const updates: chrome.tabs.UpdateProperties = {}

            if (op.changes.pinned !== undefined) {
              updates.pinned = op.changes.pinned
            }

            // Apply updates if any
            if (Object.keys(updates).length > 0) {
              yield* browserApi.tabs.update(tab.id, updates).pipe(
                Effect.catchAll((error) => {
                  console.error(`Failed to update tab: ${error}`)
                  return Effect.succeed(undefined)
                }),
              )
            }

            // Handle group changes
            if (op.changes.groupId !== undefined) {
              if (op.changes.groupId === null) {
                // Remove from group
                yield* browserApi.tabs.ungroup(tab.id).pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to ungroup tab: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
              } else {
                // Add to group
                yield* browserApi.tabs
                  .group({
                    tabIds: tab.id,
                    groupId: Number(op.changes.groupId),
                  })
                  .pipe(
                    Effect.catchAll((error) => {
                      console.error(`Failed to group tab: ${error}`)
                      return Effect.succeed(0)
                    }),
                  )
              }
            }

            break
          }

          case "MOVE_ITEM": {
            console.log(`  [MOVE_ITEM] ${op.itemId} to index ${op.newIndex}`)

            const tab = currentTabs.find((t) => String(t.id) === op.itemId)

            if (tab?.id) {
              yield* browserApi.tabs
                .move(tab.id, { index: op.newIndex })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to move tab: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            }

            break
          }

          case "ADD_GROUP": {
            console.log(`  [ADD_GROUP] ${op.group.title}`)

            // Tab groups are created implicitly when tabs are added to them
            // We can't create an empty group, so this is a no-op
            // The group will be created when ADD_ITEM operations are applied

            break
          }

          case "DELETE_GROUP": {
            console.log(`  [DELETE_GROUP] ${op.groupId}`)

            // Find group
            const group = currentGroups.find(
              (g) => String(g.id) === op.groupId,
            )

            if (group?.id) {
              // Ungroup all tabs in this group
              const tabsInGroup = yield* browserApi.tabs.query({
                windowId,
                groupId: group.id,
              })

              const tabIds = tabsInGroup
                .map((t) => t.id)
                .filter((id): id is number => id !== undefined)

              if (tabIds.length > 0) {
                yield* browserApi.tabs.ungroup(tabIds).pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to ungroup tabs: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
              }
            }

            break
          }

          case "UPDATE_GROUP": {
            console.log(`  [UPDATE_GROUP] ${op.groupId}`, op.changes)

            const group = currentGroups.find(
              (g) => String(g.id) === op.groupId,
            )

            if (group?.id) {
              const updates: chrome.tabGroups.UpdateProperties = {}

              if (op.changes.title !== undefined) {
                updates.title = op.changes.title
              }
              if (op.changes.color !== undefined) {
                updates.color = op.changes.color as chrome.tabGroups.ColorEnum
              }
              if (op.changes.collapsed !== undefined) {
                updates.collapsed = op.changes.collapsed
              }

              if (Object.keys(updates).length > 0) {
                yield* browserApi.tabGroups.update(group.id, updates).pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to update group: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
              }
            }

            break
          }
        }
      } catch (error) {
        console.error(`Error applying operation:`, op, error)
      }
    }

    console.log(`Finished applying operations to tabs`)
  })

// ============================================================================
// Apply Operations to Bookmarks
// ============================================================================

/**
 * Apply operations to Chrome Bookmarks
 *
 * @param workspaceId - Target workspace ID (bookmark folder)
 * @param operations - List of operations to apply
 * @param browserApi - Browser API service
 */
export const applyOperationsToBookmarks = (
  workspaceId: string,
  operations: ReadonlyArray<Operation>,
  browserApi: BrowserApiService,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    console.log(`Applying ${operations.length} operations to bookmarks in workspace ${workspaceId}`)

    // Get workspace tree
    const workspaceTree = yield* browserApi.bookmarks
      .getSubTree(workspaceId)
      .pipe(
        Effect.catchAll((error) => {
          console.error(`Failed to get workspace tree: ${error}`)
          return Effect.succeed([])
        }),
      )

    if (workspaceTree.length === 0) {
      console.error("Workspace not found")
      return
    }

    const workspace = workspaceTree[0]

    // ✅ Cache [pinned] folder ID
    let pinnedFolderId: string | null = null

    //  Cleanup duplicate [pinned] folders
    if (workspace.children) {
      const pinnedFolders = workspace.children.filter(
        (c) => c.title === PINNED_FOLDER_NAME,
      )

      if (pinnedFolders.length > 1) {
        console.warn(
          `  Found ${pinnedFolders.length} [pinned] folders, cleaning up duplicates`,
        )

        const folderWithItems = pinnedFolders.find(
          (f) => f.children && f.children.length > 0,
        )
        const folderToKeep = folderWithItems || pinnedFolders[0]

        for (const folder of pinnedFolders) {
          if (folder.id !== folderToKeep.id) {
            console.log(`  Deleting duplicate [pinned] folder: ${folder.id}`)
            yield* browserApi.bookmarks.removeTree(folder.id).pipe(
              Effect.catchAll((error) => {
                console.error(`Failed to remove duplicate folder: ${error}`)
                return Effect.succeed(undefined)
              }),
            )
          }
        }

        pinnedFolderId = folderToKeep.id
      } else if (pinnedFolders.length === 1) {
        pinnedFolderId = pinnedFolders[0].id
      }
    }

    // ✅ Helper: Find group folder by title+color
    const findGroupFolder = (title: string, color: string): string | null => {
      if (!workspace.children) return null

      for (const child of workspace.children) {
        if (!child.children || child.title === PINNED_FOLDER_NAME) continue

        const metadata = parseGroupMetadata(child.title)
        if (metadata.title === title && metadata.color === color) {
          return child.id
        }
      }
      return null
    }

    // Helper: Find or create [pinned] folder
    const ensurePinnedFolder = (): Effect.Effect<string> =>
      Effect.gen(function* () {
        // ✅ FIX: Check cache first to prevent duplicates
        if (pinnedFolderId) {
          console.log(`  Using cached [pinned] folder ID: ${pinnedFolderId}`)
          return pinnedFolderId
        }

        // Check if folder already exists
        const pinnedFolder = workspace.children?.find(
          (c) => c.title === PINNED_FOLDER_NAME,
        )

        if (pinnedFolder) {
          console.log(`  Found existing [pinned] folder: ${pinnedFolder.id}`)
          pinnedFolderId = pinnedFolder.id  // ✅ Cache it
          return pinnedFolder.id
        }

        // Create [pinned] folder
        console.log(`  Creating new [pinned] folder`)
        const newFolder = yield* browserApi.bookmarks.create({
          parentId: workspaceId,
          title: PINNED_FOLDER_NAME,
          index: 0,
        })

        // ✅ FIX: Cache the created folder ID
        pinnedFolderId = newFolder.id
        console.log(`  Created and cached [pinned] folder: ${newFolder.id}`)

        return newFolder.id
      })

    // Helper: Find or create group folder by title+color
    const ensureGroupFolder = (
      groupTitle: string,
      groupColor: string,
      groupCollapsed: boolean,
    ): Effect.Effect<string> =>
      Effect.gen(function* () {
        // ✅ Try to find existing folder by title+color
        const existingFolderId = findGroupFolder(groupTitle, groupColor)
        if (existingFolderId) {
          console.log(`  Found existing group folder for "${groupTitle}" (${groupColor})`)
          return existingFolderId
        }

        // Create new group folder
        console.log(`  Creating new group folder for "${groupTitle}" (${groupColor})`)
        const folderTitle = createGroupTitle(
          groupTitle,
          groupColor,
          groupCollapsed,
        )

        const newFolder = yield* browserApi.bookmarks.create({
          parentId: workspaceId,
          title: folderTitle,
        })

        return newFolder.id
      })

    // ✅ Sort operations - ADD_GROUP before ADD_ITEM
    const sortedOperations = [...operations].sort((a, b) => {
      const priority: Record<string, number> = {
        'ADD_GROUP': 0,
        'ADD_ITEM': 1,
        'UPDATE_GROUP': 2,
        'UPDATE_ITEM': 3,
        'MOVE_ITEM': 4,
        'DELETE_ITEM': 5,
        'DELETE_GROUP': 6,
      }
      return (priority[a.type] || 99) - (priority[b.type] || 99)
    })

    for (const op of sortedOperations) {
      try {
        switch (op.type) {
          case "ADD_ITEM": {
            console.log(`  [ADD_ITEM] ${op.item.url}`)

            // Determine parent folder
            let parentId = workspaceId

            if (op.item.pinned) {
              parentId = yield* ensurePinnedFolder()
            } else if (op.item.groupId) {
              // ✅ Find corresponding ADD_GROUP operation to get group title+color
              const groupOp = sortedOperations.find(
                (o) => o.type === "ADD_GROUP" && o.group.id === op.item.groupId,
              )

              if (groupOp && groupOp.type === "ADD_GROUP") {
                // Use group metadata to find/create folder
                parentId = yield* ensureGroupFolder(
                  groupOp.group.title,
                  groupOp.group.color,
                  groupOp.group.collapsed,
                )
              } else {
                console.warn(`  No ADD_GROUP operation found for group ${op.item.groupId}`)
              }
            }

            // Create bookmark
            const bookmarkTitle = createBookmarkTitle(
              op.item.title,
              op.item.pinned,
              op.item.renamed, // ✅ Preserve renamed status
            )

            yield* browserApi.bookmarks
              .create({
                parentId,
                title: bookmarkTitle,
                url: op.item.url,
                index: op.item.index,
              })
              .pipe(
                Effect.catchAll((error) => {
                  console.error(`Failed to create bookmark: ${error}`)
                  return Effect.succeed(undefined)
                }),
              )

            break
          }

          case "DELETE_ITEM": {
            console.log(`  [DELETE_ITEM] ${op.itemId}`)

            // Find bookmark by ID
            const bookmarkId = findBookmarkById(workspace, op.itemId)

            if (bookmarkId) {
              yield* browserApi.bookmarks.remove(bookmarkId).pipe(
                Effect.catchAll((error) => {
                  console.error(`Failed to remove bookmark: ${error}`)
                  return Effect.succeed(undefined)
                }),
              )
            }

            break
          }

          case "UPDATE_ITEM": {
            console.log(`  [UPDATE_ITEM] ${op.itemId}`, op.changes)

            const bookmarkId = findBookmarkById(workspace, op.itemId)

            if (!bookmarkId) {
              console.warn(`Bookmark ${op.itemId} not found for update`)
              break
            }

            // ✅ FIX: Get current bookmark to read current state
            const currentBookmark = findBookmarkNodeById(workspace, op.itemId)
            const currentStatus = currentBookmark
              ? parseBookmarkPinnedStatus(currentBookmark.title)
              : { pinned: false, renamed: false, title: "" }

            // Update title if changed
            if (op.changes.title !== undefined || op.changes.renamed !== undefined || op.changes.pinned !== undefined) {
              const newTitle = createBookmarkTitle(
                op.changes.title ?? currentStatus.title,
                op.changes.pinned ?? currentStatus.pinned,
                op.changes.renamed ?? currentStatus.renamed,
              )

              yield* browserApi.bookmarks
                .update(bookmarkId, { title: newTitle })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to update bookmark title: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            }

            // Handle pinned or group changes (requires moving bookmark)
            if (
              op.changes.pinned !== undefined ||
              op.changes.groupId !== undefined
            ) {
              let newParentId = workspaceId

              if (op.changes.pinned) {
                newParentId = yield* ensurePinnedFolder()
              } else if (op.changes.groupId && op.changes.groupId !== null) {
                // ✅ Find corresponding ADD_GROUP operation to get group title+color
                const groupOp = sortedOperations.find(
                  (o) => o.type === "ADD_GROUP" && o.group.id === op.changes.groupId,
                )

                if (groupOp && groupOp.type === "ADD_GROUP") {
                  newParentId = yield* ensureGroupFolder(
                    groupOp.group.title,
                    groupOp.group.color,
                    groupOp.group.collapsed,
                  )
                } else {
                  console.warn(`  No ADD_GROUP operation found for group ${op.changes.groupId}`)
                }
              }

              // Move bookmark
              yield* browserApi.bookmarks
                .move(bookmarkId, { parentId: newParentId })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to move bookmark: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            }

            break
          }

          case "MOVE_ITEM": {
            console.log(`  [MOVE_ITEM] ${op.itemId} to index ${op.newIndex}`)

            const bookmarkId = findBookmarkById(workspace, op.itemId)

            if (bookmarkId) {
              yield* browserApi.bookmarks
                .move(bookmarkId, { index: op.newIndex })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to move bookmark: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            }

            break
          }

          case "ADD_GROUP": {
            console.log(`  [ADD_GROUP] ${op.group.title}`)

            // ✅ Find or create folder by title+color
            const existingFolderId = findGroupFolder(op.group.title, op.group.color)

            if (existingFolderId) {
              console.log(`  Group folder already exists: ${existingFolderId}`)
            } else {
              const folderTitle = createGroupTitle(
                op.group.title,
                op.group.color,
                op.group.collapsed,
              )

              yield* browserApi.bookmarks
                .create({
                  parentId: workspaceId,
                  title: folderTitle,
                  index: op.group.index,
                })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to create group folder: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            }

            break
          }

          case "DELETE_GROUP": {
            console.log(`  [DELETE_GROUP] ${op.groupId}`)

            // op.groupId is the bookmark folder ID (from diff target)
            yield* browserApi.bookmarks.removeTree(op.groupId).pipe(
              Effect.catchAll((error) => {
                console.error(`Failed to remove group folder: ${error}`)
                return Effect.succeed(undefined)
              }),
            )

            break
          }

          case "UPDATE_GROUP": {
            console.log(`  [UPDATE_GROUP] ${op.groupId}`, op.changes)

            // op.groupId is the bookmark folder ID (from diff target)
            const groupFolder = workspace.children?.find(
              (c) => c.id === op.groupId,
            )

            if (groupFolder) {
              // Get current metadata
              const { title, color, collapsed } = parseGroupMetadata(groupFolder.title)

              // Apply changes (note: title and color shouldn't change as they're used for matching)
              const newTitle = createGroupTitle(
                title, // Keep original title
                color, // Keep original color
                op.changes.collapsed ?? collapsed,
              )

              yield* browserApi.bookmarks
                .update(groupFolder.id, { title: newTitle })
                .pipe(
                  Effect.catchAll((error) => {
                    console.error(`Failed to update group folder: ${error}`)
                    return Effect.succeed(undefined)
                  }),
                )
            } else {
              console.warn(`Group folder ${op.groupId} not found for update`)
            }

            break
          }
        }
      } catch (error) {
        console.error(`Error applying operation:`, op, error)
      }
    }

    console.log(`Finished applying operations to bookmarks`)
  })

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find bookmark by ID in tree (recursive)
 */
const findBookmarkById = (
  node: chrome.bookmarks.BookmarkTreeNode,
  targetId: string,
): string | null => {
  if (node.id === targetId) {
    return node.id
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findBookmarkById(child, targetId)
      if (found) {
        return found
      }
    }
  }

  return null
}

/**
 * Find bookmark node by ID in tree (recursive) - returns the full node
 */
const findBookmarkNodeById = (
  node: chrome.bookmarks.BookmarkTreeNode,
  targetId: string,
): chrome.bookmarks.BookmarkTreeNode | null => {
  if (node.id === targetId) {
    return node
  }

  if (node.children) {
    for (const child of node.children) {
      const found = findBookmarkNodeById(child, targetId)
      if (found) {
        return found
      }
    }
  }

  return null
}

/**
 * Parse group metadata from bookmark folder
 */
const parseGroupMetadata = (
  title: string,
): { title: string; color: string; collapsed: boolean } => {
  // Format: "[color|collapsed] Title"
  // Example: "[blue|true] Work" or "[red|false] Personal"

  const match = title.match(/^\[([^|]+)\|([^|]+)\]\s*(.*)$/)

  if (match) {
    return {
      color: match[1],
      collapsed: match[2] === "true",
      title: match[3] || "Untitled",
    }
  }

  // Fallback
  return {
    color: "grey",
    collapsed: false,
    title: title || "Untitled",
  }
}
