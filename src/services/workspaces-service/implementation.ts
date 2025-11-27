import { Effect, Layer, SubscriptionRef } from "effect"
import {
  BrowserApiService,
  ChromeApiServiceLive,
} from "../browser-api-service/index.ts"
import { WorkspacesService } from "./types.ts"
import { BookmarkNotFoundError, WorkspaceOperationError } from "./types.ts"
import type {
  AppState,
  Tab,
  TabGroup,
  WindowId,
} from "../state-service/schema.ts"
import { StateService, StateServiceLive } from "../state-service/index.ts"
import { StorageService, StorageServiceLive } from "../storage-service/index.ts"
import { Validators } from "../validation-service/index.ts"
import {
  createBookmarkTitle,
  createGroupTitle,
  parseGroupMetadata,
  PINNED_FOLDER_NAME,
} from "./metadata-parser.ts"
import { Option } from "effect"
import {
  getOrElse,
  isSome,
  optionContains,
  urlToString,
} from "../../utils/type-conversions.ts"
import { annotateOperation } from "../../utils/logging.ts"
import {
  BATCH_DELAY_MS,
  BATCH_SIZE,
  discardTabs,
  findBookmarkByUrl,
  SYNC_DEBOUNCE_MS,
} from "./utils.ts"

// ============================================================================
// Types
// ============================================================================

interface WorkspaceSyncState {
  readonly isSyncing: boolean
  readonly timeoutId: number | null
}

interface TabJob {
  readonly url: string
  readonly pinned: boolean
  readonly groupInfo?: {
    readonly title: string
    readonly color: string
    readonly collapsed: boolean
  }
}

// ============================================================================
// Service Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService
  const storageService = yield* StorageService

  // State management with SubscriptionRef (replaces global variables)
  const isLoadingWorkspaceRef = yield* SubscriptionRef.make(false)
  const syncStateRef = yield* SubscriptionRef.make<
    Map<string, WorkspaceSyncState>
  >(new Map())

  /**
   * Helper: Get or create sync state for a workspace
   */
  const getSyncState = (workspaceId: string) =>
    Effect.gen(function* () {
      const syncStateMap = yield* SubscriptionRef.get(syncStateRef)
      const existing = syncStateMap.get(workspaceId)

      if (existing) {
        return existing
      }

      // Create new sync state
      const newState: WorkspaceSyncState = {
        isSyncing: false,
        timeoutId: null,
      }
      const newMap = new Map(syncStateMap)
      newMap.set(workspaceId, newState)
      yield* SubscriptionRef.set(syncStateRef, newMap)

      return newState
    })

  /**
   * Helper: Update sync state for a workspace
   */
  const updateSyncState = (
    workspaceId: string,
    update: Partial<WorkspaceSyncState>,
  ) =>
    Effect.gen(function* () {
      const syncStateMap = yield* SubscriptionRef.get(syncStateRef)
      const current = syncStateMap.get(workspaceId) || {
        isSyncing: false,
        timeoutId: null,
      }
      const updated = { ...current, ...update }
      const newMap = new Map(syncStateMap)
      newMap.set(workspaceId, updated)
      yield* SubscriptionRef.set(syncStateRef, newMap)
    })

  // ==========================================================================
  // Get Bookmarks Bar
  // ==========================================================================

  const getBookmarksBar = (): Effect.Effect<
    chrome.bookmarks.BookmarkTreeNode,
    WorkspaceOperationError
  > =>
    Effect.gen(function* () {
      const tree = yield* browserApi.bookmarks.getTree()
      const bookmarksBar = tree[0]?.children?.find(
        (node) => node.title === "Bookmarks bar" || node.id === "1",
      )

      if (!bookmarksBar) {
        return yield* Effect.fail(
          new WorkspaceOperationError({
            operation: "getBookmarksBar",
            reason: "Bookmarks bar not found",
          }),
        )
      }

      return bookmarksBar
    })

  // ==========================================================================
  // Save Workspace
  // ==========================================================================

  const saveWorkspace = (
    workspaceName: string,
    state: AppState,
  ): Effect.Effect<
    chrome.bookmarks.BookmarkTreeNode,
    WorkspaceOperationError
  > =>
    Effect.gen(function* () {
      const bookmarksBar = yield* getBookmarksBar()

      // Create workspace folder
      const workspaceFolder = yield* browserApi.bookmarks.create({
        parentId: bookmarksBar.id,
        title: workspaceName,
      }).pipe(
        Effect.catchAll((_error) =>
          Effect.fail(
            new WorkspaceOperationError({
              operation: "saveWorkspace",
              reason: "Failed to create workspace folder",
            }),
          )
        ),
      )

      // Get current window tabs and groups
      const currentWindow = state.windows.find((w) => w.focused)
      if (!currentWindow?.id) {
        return workspaceFolder
      }

      const windowTabs = state.tabs.filter(
        (tab) => tab.windowId === currentWindow.id,
      )
      const windowGroups = state.tabGroups.filter((group) =>
        windowTabs.some((tab) => optionContains(tab.groupId, group.id))
      )

      // Separate pinned and unpinned tabs
      const pinnedTabs = windowTabs.filter((tab) => tab.pinned)
      const unpinnedTabs = windowTabs.filter((tab) => !tab.pinned)

      // Create [pinned] folder if there are pinned tabs
      if (pinnedTabs.length > 0) {
        const pinnedFolder = yield* browserApi.bookmarks.create({
          parentId: workspaceFolder.id,
          title: PINNED_FOLDER_NAME,
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              id: "",
              title: PINNED_FOLDER_NAME,
            } as chrome.bookmarks.BookmarkTreeNode)
          ),
        )

        // Add pinned tabs to the [pinned] folder
        for (const pinnedTab of pinnedTabs) {
          yield* browserApi.bookmarks.create({
            parentId: pinnedFolder.id,
            title: pinnedTab.title,
            url: urlToString(pinnedTab.url),
          }).pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                id: "",
                title: pinnedTab.title,
              } as chrome.bookmarks.BookmarkTreeNode)
            ),
          )
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
              const groupFolder = yield* browserApi.bookmarks.create({
                parentId: workspaceFolder.id,
                title: createGroupTitle(
                  getOrElse(group.title, ""),
                  group.color,
                  group.collapsed,
                ),
              }).pipe(
                Effect.catchAll(() =>
                  Effect.succeed({} as chrome.bookmarks.BookmarkTreeNode)
                ),
              )

              // Add tabs to group folder
              for (const groupTab of groupTabs) {
                yield* browserApi.bookmarks.create({
                  parentId: groupFolder.id,
                  title: groupTab.title,
                  url: urlToString(groupTab.url),
                }).pipe(
                  Effect.catchAll(() =>
                    Effect.succeed({
                      id: "",
                      title: "",
                    } as chrome.bookmarks.BookmarkTreeNode)
                  ),
                )
              }

              renderedGroups.add(groupId)
            }
          }
        } else {
          // Save ungrouped tab
          yield* browserApi.bookmarks.create({
            parentId: workspaceFolder.id,
            title: tab.title,
            url: urlToString(tab.url),
          }).pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                id: "",
                title: "",
              } as chrome.bookmarks.BookmarkTreeNode)
            ),
          )
        }
      }

      return workspaceFolder
    }).pipe(
      annotateOperation("WorkspacesService", "saveWorkspace", {
        workspaceName,
        tabCount: state.tabs.length,
      }),
    )

  // ==========================================================================
  // Sync Workspace (Internal)
  // ==========================================================================

  const syncWorkspaceInternal = (
    windowId: number,
    workspaceId: string,
  ): Effect.Effect<void, WorkspaceOperationError, StateService> =>
    Effect.gen(function* () {
      // Get current state
      const stateService = yield* StateService
      const state = yield* stateService.createAppState.pipe(
        Effect.mapError((error) =>
          new WorkspaceOperationError({
            operation: "sync",
            reason: `Failed to load state: ${error._tag}`,
            workspaceId,
          })
        ),
      )

      // Get workspace bookmark
      const results = yield* browserApi.bookmarks.getSubTree(workspaceId).pipe(
        Effect.catchAll(() => Effect.succeed([])),
      )

      const workspace = results[0]
      if (!workspace) {
        return
      }

      // Delete all children (tabs and groups) in one go
      if (workspace.children && workspace.children.length > 0) {
        for (const child of workspace.children) {
          yield* browserApi.bookmarks.removeTree(child.id).pipe(
            Effect.catchAll(() => Effect.succeed(undefined)),
          )
        }
      }

      // Get tabs for this window
      const windowTabs = state.tabs.filter(
        (tab: Tab) => tab.windowId === windowId,
      )
      const windowGroups = state.tabGroups.filter((group) =>
        windowTabs.some((tab) => optionContains(tab.groupId, group.id))
      )

      // Separate pinned and unpinned tabs
      const pinnedTabs = windowTabs.filter((tab) => tab.pinned)
      const unpinnedTabs = windowTabs.filter((tab) => !tab.pinned)

      // Create [pinned] folder if there are pinned tabs
      if (pinnedTabs.length > 0) {
        const pinnedFolder = yield* browserApi.bookmarks.create({
          parentId: workspaceId,
          title: PINNED_FOLDER_NAME,
        }).pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              id: "",
              title: PINNED_FOLDER_NAME,
            } as chrome.bookmarks.BookmarkTreeNode)
          ),
        )

        // Add pinned tabs to the [pinned] folder
        for (const pinnedTab of pinnedTabs) {
          yield* browserApi.bookmarks.create({
            parentId: pinnedFolder.id,
            title: pinnedTab.title,
            url: urlToString(pinnedTab.url),
          }).pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                id: "",
                title: "",
              } as chrome.bookmarks.BookmarkTreeNode)
            ),
          )
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
              const groupFolder = yield* browserApi.bookmarks.create({
                parentId: workspaceId,
                title: createGroupTitle(
                  getOrElse(group.title, ""),
                  group.color,
                  group.collapsed,
                ),
              }).pipe(
                Effect.catchAll(() =>
                  Effect.succeed({} as chrome.bookmarks.BookmarkTreeNode)
                ),
              )

              // Add tabs to group folder
              for (const groupTab of groupTabs) {
                yield* browserApi.bookmarks.create({
                  parentId: groupFolder.id,
                  title: groupTab.title,
                  url: urlToString(groupTab.url),
                }).pipe(
                  Effect.catchAll(() =>
                    Effect.succeed({
                      id: "",
                      title: "",
                    } as chrome.bookmarks.BookmarkTreeNode)
                  ),
                )
              }

              renderedGroups.add(groupId)
            }
          }
        } else {
          // Save ungrouped tab (groupId is None)
          yield* browserApi.bookmarks.create({
            parentId: workspaceId,
            title: tab.title,
            url: urlToString(tab.url),
          }).pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                id: "",
                title: "",
              } as chrome.bookmarks.BookmarkTreeNode)
            ),
          )
        }
      }
    })

  // ==========================================================================
  // Sync Workspace (with debouncing)
  // ==========================================================================

  const syncWorkspace = (
    windowId: number,
    workspaceId: string,
  ): Effect.Effect<void, WorkspaceOperationError> =>
    Effect.gen(function* () {
      const state = yield* getSyncState(workspaceId)

      // Clear any existing timeout
      if (state.timeoutId !== null) {
        clearTimeout(state.timeoutId)
      }

      // Set up new debounced timeout
      yield* Effect.async<void>((resume) => {
        const timeoutId = setTimeout(() => {
          Effect.runPromise(
            Effect.gen(function* () {
              const currentState = yield* getSyncState(workspaceId)

              // If already syncing, skip this sync
              if (currentState.isSyncing) {
                return
              }

              // Mark as syncing
              yield* updateSyncState(workspaceId, {
                isSyncing: true,
                timeoutId: null,
              })

              // Perform the actual sync
              yield* syncWorkspaceInternal(windowId, workspaceId).pipe(
                Effect.provide(StateServiceLive),
                Effect.provide(ChromeApiServiceLive),
                Effect.catchAll(() => Effect.succeed(undefined)),
              )

              // Mark as done
              yield* updateSyncState(workspaceId, { isSyncing: false })
            }),
          ).then(() => resume(Effect.succeed(undefined)))
            .catch(() => resume(Effect.succeed(undefined)))
        }, SYNC_DEBOUNCE_MS)

        // Store timeout ID
        Effect.runPromise(
          updateSyncState(workspaceId, { timeoutId }),
        )
      })
    })

  // ==========================================================================
  // Load Workspace In Window
  // ==========================================================================

  const loadWorkspaceInWindow = (
    workspaceId: string,
    windowId: number,
    keepCurrentTabs: boolean = false,
  ): Effect.Effect<
    void,
    | WorkspaceOperationError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      // Set loading flag
      yield* SubscriptionRef.set(isLoadingWorkspaceRef, true)

      // Validate IDs
      const validatedWindowId = yield* Validators.windowId(windowId)
      const validatedWorkspaceId = yield* Validators.workspaceId(workspaceId)

      try {
        // First, unlink the window from any existing workspace
        yield* storageService.unlinkWindow(validatedWindowId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )

        // Get workspace folder
        const results = yield* browserApi.bookmarks.getSubTree(workspaceId)
          .pipe(
            Effect.catchAll(() => Effect.succeed([])),
          )

        const workspace = results[0]
        if (!workspace?.children) {
          yield* SubscriptionRef.set(isLoadingWorkspaceRef, false)
          return
        }

        // Get current tabs in the window BEFORE loading new ones
        const currentTabs = yield* browserApi.tabs.query({ windowId })

        // Collect ALL tab IDs to be removed later
        const oldTabIds = currentTabs
          .filter((tab) => tab.id)
          .map((tab) => tab.id!)

        // Find the position to insert new tabs
        const pinnedTabsCount = currentTabs.filter((tab) => tab.pinned).length
        const insertIndex = keepCurrentTabs ? pinnedTabsCount : undefined

        // Prepare all tab creation jobs
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
        const createdTabs: Array<
          { id: number; groupInfo?: TabJob["groupInfo"] }
        > = []
        let currentIndex = insertIndex

        for (let i = 0; i < tabJobs.length; i += BATCH_SIZE) {
          const batch = tabJobs.slice(i, i + BATCH_SIZE)

          // Create batch of tabs
          for (const job of batch) {
            const tab = yield* browserApi.tabs.create({
              windowId,
              url: job.url,
              active: false,
              pinned: job.pinned,
              index: currentIndex,
            }).pipe(
              Effect.catchAll(() =>
                Effect.succeed({ id: undefined } as chrome.tabs.Tab)
              ),
            )

            if (tab.id) {
              createdTabs.push({ id: tab.id, groupInfo: job.groupInfo })
            }
            if (currentIndex !== undefined) currentIndex++
          }

          // Delay before next batch (except for last batch)
          if (i + BATCH_SIZE < tabJobs.length) {
            yield* Effect.sleep(BATCH_DELAY_MS)
          }
        }

        // Phase 2: Create groups for tabs that need to be grouped
        const groupMap = new Map<string, number[]>() // groupKey -> tabIds

        for (const { id, groupInfo } of createdTabs) {
          if (groupInfo) {
            const groupKey =
              `${groupInfo.title}|${groupInfo.color}|${groupInfo.collapsed}`
            if (!groupMap.has(groupKey)) {
              groupMap.set(groupKey, [])
            }
            groupMap.get(groupKey)!.push(id)
          }
        }

        // Create and configure groups
        for (const [groupKey, tabIds] of groupMap.entries()) {
          if (tabIds.length > 0) {
            const [title, color, collapsed] = groupKey.split("|")

            const groupId = yield* browserApi.tabs.group({ tabIds }).pipe(
              Effect.catchAll(() => Effect.succeed(-1)),
            )

            if (groupId !== -1) {
              yield* browserApi.tabGroups.update(groupId, {
                title: title || undefined,
                color: color as chrome.tabGroups.ColorEnum,
                collapsed: collapsed === "true",
              }).pipe(
                Effect.catchAll(() =>
                  Effect.succeed({
                    id: "",
                    title: "",
                  } as chrome.bookmarks.BookmarkTreeNode)
                ),
              )
            }
          }
        }

        // Phase 3: Now discard ALL tabs at once
        const allTabIds = createdTabs.map((t) => t.id)
        if (allTabIds.length > 0) {
          yield* discardTabs(browserApi, allTabIds)
        }

        // Phase 4: NOW delete old tabs AFTER new tabs are created
        if (!keepCurrentTabs && oldTabIds.length > 0) {
          yield* browserApi.tabs.remove(oldTabIds).pipe(
            Effect.catchAll(() => Effect.succeed(undefined)),
          )
        }

        // Now link the window to the new workspace
        yield* storageService.linkWindowToWorkspace(
          validatedWindowId,
          validatedWorkspaceId,
        ).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
      } finally {
        // Reset flag after loading is complete
        yield* SubscriptionRef.set(isLoadingWorkspaceRef, false)
      }
    }).pipe(
      annotateOperation("WorkspacesService", "loadWorkspaceInWindow", {
        windowId,
        workspaceId,
      }),
    )

  // ==========================================================================
  // Restore Workspace
  // ==========================================================================

  const restoreWorkspace = (
    workspaceId: string,
  ): Effect.Effect<
    chrome.windows.Window | undefined,
    | WorkspaceOperationError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      // Get workspace folder
      const results = yield* browserApi.bookmarks.getSubTree(workspaceId).pipe(
        Effect.catchAll(() => Effect.succeed([])),
      )

      const workspace = results[0]
      if (!workspace?.children) {
        return undefined
      }

      // Create new window for workspace
      const newWindow = yield* browserApi.windows.create({}).pipe(
        Effect.catchAll(() =>
          Effect.succeed(undefined as chrome.windows.Window | undefined)
        ),
      )

      const windowId = newWindow?.id
      if (!windowId) {
        return undefined
      }

      // Validate IDs
      const validatedWindowId = yield* Validators.windowId(windowId)
      const validatedWorkspaceId = yield* Validators.workspaceId(workspaceId)

      // Link window to workspace
      yield* storageService.linkWindowToWorkspace(
        validatedWindowId,
        validatedWorkspaceId,
      ).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      )

      // Close the default new tab
      const firstTab = newWindow.tabs?.[0]
      if (firstTab?.id) {
        yield* browserApi.tabs.remove(firstTab.id).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
      }

      // Prepare all tab creation jobs
      const tabJobs: TabJob[] = []
      for (const item of workspace.children) {
        if (item.url) {
          tabJobs.push({ url: item.url, pinned: false })
        } else if (item.children) {
          if (item.title === PINNED_FOLDER_NAME) {
            for (const bookmark of item.children) {
              if (bookmark.url) {
                tabJobs.push({ url: bookmark.url, pinned: true })
              }
            }
          } else {
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

      // Phase 1: Create all tabs in batches
      const createdTabs: Array<
        { id: number; groupInfo?: TabJob["groupInfo"] }
      > = []

      for (let i = 0; i < tabJobs.length; i += BATCH_SIZE) {
        const batch = tabJobs.slice(i, i + BATCH_SIZE)

        for (const job of batch) {
          const tab = yield* browserApi.tabs.create({
            windowId,
            url: job.url,
            active: false,
            pinned: job.pinned,
          }).pipe(
            Effect.catchAll(() =>
              Effect.succeed({ id: undefined } as chrome.tabs.Tab)
            ),
          )

          if (tab.id) {
            createdTabs.push({ id: tab.id, groupInfo: job.groupInfo })
          }
        }

        if (i + BATCH_SIZE < tabJobs.length) {
          yield* Effect.sleep(BATCH_DELAY_MS)
        }
      }

      // Phase 2: Create groups
      const groupMap = new Map<string, number[]>()

      for (const { id, groupInfo } of createdTabs) {
        if (groupInfo) {
          const groupKey =
            `${groupInfo.title}|${groupInfo.color}|${groupInfo.collapsed}`
          if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, [])
          }
          groupMap.get(groupKey)!.push(id)
        }
      }

      for (const [groupKey, tabIds] of groupMap.entries()) {
        if (tabIds.length > 0) {
          const [title, color, collapsed] = groupKey.split("|")

          const groupId = yield* browserApi.tabs.group({ tabIds }).pipe(
            Effect.catchAll(() => Effect.succeed(-1)),
          )

          if (groupId !== -1) {
            yield* browserApi.tabGroups.update(groupId, {
              title: title || undefined,
              color: color as chrome.tabGroups.ColorEnum,
              collapsed: collapsed === "true",
            }).pipe(
              Effect.catchAll(() =>
                Effect.succeed({
                  id: "",
                  title: "",
                } as chrome.bookmarks.BookmarkTreeNode)
              ),
            )
          }
        }
      }

      // Phase 3: Discard all tabs
      const allTabIds = createdTabs.map((t) => t.id)
      if (allTabIds.length > 0) {
        yield* discardTabs(browserApi, allTabIds)
      }

      return newWindow
    }).pipe(
      annotateOperation("WorkspacesService", "restoreWorkspace", {
        workspaceId,
      }),
    )

  // ==========================================================================
  // Delete Workspace
  // ==========================================================================

  const deleteWorkspace = (
    workspaceId: string,
  ): Effect.Effect<void, WorkspaceOperationError> =>
    browserApi.bookmarks.removeTree(workspaceId).pipe(
      Effect.catchAll((_error) =>
        Effect.fail(
          new WorkspaceOperationError({
            operation: "deleteWorkspace",
            reason: "Failed to delete workspace",
            workspaceId,
          }),
        )
      ),
      annotateOperation("WorkspacesService", "deleteWorkspace", {
        workspaceId,
      }),
    )

  // ==========================================================================
  // Rename Workspace
  // ==========================================================================

  const renameWorkspace = (
    workspaceId: string,
    newName: string,
  ): Effect.Effect<
    chrome.bookmarks.BookmarkTreeNode,
    WorkspaceOperationError
  > =>
    browserApi.bookmarks.update(workspaceId, { title: newName }).pipe(
      Effect.catchAll((_error) =>
        Effect.fail(
          new WorkspaceOperationError({
            operation: "renameWorkspace",
            reason: "Failed to rename workspace",
            workspaceId,
          }),
        )
      ),
      annotateOperation("WorkspacesService", "renameWorkspace", {
        workspaceId,
        newName,
      }),
    )

  // ==========================================================================
  // Rename Tab Bookmark
  // ==========================================================================

  const renameTabBookmark = (
    windowId: WindowId,
    tabUrl: string,
    newTitle: string,
    isPinned: boolean,
  ): Effect.Effect<void, BookmarkNotFoundError> =>
    Effect.gen(function* () {
      // Get workspace for window
      const workspaceIdOption = yield* storageService.getWorkspaceForWindow(
        windowId,
      ).pipe(
        Effect.catchAll(() => Effect.succeed(Option.none())),
      )

      if (!isSome(workspaceIdOption)) {
        return yield* Effect.fail(
          new BookmarkNotFoundError({
            url: tabUrl,
            workspaceId: "none",
          }),
        )
      }

      const workspaceId = workspaceIdOption.value

      // Get workspace bookmark tree
      const workspaceTree = yield* browserApi.bookmarks.getSubTree(
        workspaceId,
      ).pipe(
        Effect.catchAll(() =>
          Effect.fail(
            new BookmarkNotFoundError({
              url: tabUrl,
              workspaceId,
            }),
          )
        ),
      )

      // Find bookmark by URL
      const workspaceNode = workspaceTree[0]
      const bookmarkId = findBookmarkByUrl(workspaceNode, tabUrl)

      if (!bookmarkId) {
        return yield* Effect.fail(
          new BookmarkNotFoundError({
            url: tabUrl,
            workspaceId,
          }),
        )
      }

      // Create bookmark title with [pinned] prefix if needed
      const bookmarkTitle = createBookmarkTitle(newTitle, isPinned)

      // Update bookmark title
      yield* browserApi.bookmarks.update(bookmarkId, { title: bookmarkTitle })
        .pipe(
          Effect.catchAll(() =>
            Effect.fail(
              new BookmarkNotFoundError({
                url: tabUrl,
                workspaceId,
              }),
            )
          ),
        )
    }).pipe(
      annotateOperation("WorkspacesService", "renameTabBookmark", {
        windowId,
        tabUrl,
        newTitle,
      }),
    )

  // ==========================================================================
  // Is Loading Workspace
  // ==========================================================================

  const isLoadingWorkspace: Effect.Effect<boolean> = SubscriptionRef.get(
    isLoadingWorkspaceRef,
  )

  return {
    getBookmarksBar,
    saveWorkspace,
    syncWorkspace,
    loadWorkspaceInWindow,
    restoreWorkspace,
    deleteWorkspace,
    renameWorkspace,
    renameTabBookmark,
    isLoadingWorkspace,
  } satisfies WorkspacesService
})

// ============================================================================
// Layer
// ============================================================================

/**
 * Base WorkspacesService layer without dependencies provided.
 * Use this for testing with mock dependencies.
 */
const WorkspacesServiceLayer = Layer.effect(WorkspacesService, make)

/**
 * WorkspacesService Live Layer
 *
 * Dependencies:
 * - BrowserApiService (for all Chrome API calls)
 * - StorageService (for window-workspace mappings)
 */
export const WorkspacesServiceLive = WorkspacesServiceLayer.pipe(
  Layer.provide(StorageServiceLive),
)

/**
 * WorkspacesService layer for testing.
 * Does NOT provide BrowserApiService or StorageService - caller must provide them.
 *
 * Usage in tests:
 * ```typescript
 * const mockBrowserApi = createMockBrowserApiService()
 * const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
 * const testLayer = WorkspacesServiceTest.pipe(
 *   Layer.provide(Layer.mergeAll(storageLayer, mockBrowserApi))
 * )
 * ```
 */
export const WorkspacesServiceTest = WorkspacesServiceLayer
