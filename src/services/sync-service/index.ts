// ============================================================================
// Sync Service - Reconciliation-based Bidirectional Sync
// ============================================================================

import { Context, Effect, Layer, SubscriptionRef } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import type { WindowId, WorkspaceId } from "../state-service/types.ts"
import {
  cleanupWindowWorkspaceMap,
  getWindowWorkspaceMap,
  getWorkspaceForWindow,
  linkWindowToWorkspace,
  STORAGE_KEY_WINDOW_WORKSPACE_MAP,
} from "../storage-service/index.ts"
import { getBookmarksBar, getIsLoadingWorkspace } from "../workspaces-service/index.ts"
import { isSome } from "../../utils/type-conversions.ts"

// Import reconciliation modules
import { diffStates, getStateStats } from "./reconciliation.ts"
import { mapTabsToNormalizedStateEnhanced, mapBookmarksToNormalizedState } from "./mappers.ts"
import { applyOperationsToTabs, applyOperationsToBookmarks } from "./apply.ts"

// ============================================================================
// Types
// ============================================================================

export type SyncDirection = "tabs-to-bookmarks" | "bookmarks-to-tabs"

export interface SyncJob {
  readonly windowId: number
  readonly workspaceId: string
  readonly direction: SyncDirection
  readonly timestamp: number
  readonly source: "tab-change" | "bookmark-change" | "manual"
}

interface SyncLockState {
  readonly isLocked: boolean
  readonly currentJob: SyncJob | null
}

interface SyncQueueState {
  readonly queue: SyncJob[]
  readonly timeoutId: number | null
}

// ============================================================================
// Constants
// ============================================================================

const MAX_QUEUE_SIZE = 5
const SYNC_DEBOUNCE_MS = 300

// ============================================================================
// Service Interface
// ============================================================================

export interface SyncService {
  readonly windowWorkspaceMap: SubscriptionRef.SubscriptionRef<
    Record<number, string>
  >
  readonly linkWindow: (
    windowId: number,
    workspaceId: string,
  ) => Effect.Effect<void>
  readonly syncIfLinked: (
    tabId?: number,
    windowId?: number,
  ) => Effect.Effect<void>
}

export const SyncService = Context.GenericTag<SyncService>("SyncService")

// ============================================================================
// Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  // ==========================================================================
  // State Management
  // ==========================================================================

  const windowWorkspaceMap = yield* SubscriptionRef.make<
    Record<number, string>
  >({})

  const syncLockRef = yield* SubscriptionRef.make<SyncLockState>({
    isLocked: false,
    currentJob: null,
  })

  const syncQueueRef = yield* SubscriptionRef.make<SyncQueueState>({
    queue: [],
    timeoutId: null,
  })

  // ==========================================================================
  // Window-Workspace Map Management
  // ==========================================================================

  const loadWindowWorkspaceMap = (): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const map = yield* getWindowWorkspaceMap().pipe(
        Effect.map((stringMap) => {
          const result: Record<number, string> = {}
          for (const [key, value] of Object.entries(stringMap)) {
            result[Number(key)] = value
          }
          return result
        }),
        Effect.catchAll(() => Effect.succeed({})),
      )
      yield* SubscriptionRef.set(windowWorkspaceMap, map)
    })

  // Initial load
  yield* loadWindowWorkspaceMap()

  // Storage Listener
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onStorageChanged = browserApi.events.onStorageChanged((changes) => {
        if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
          Effect.runFork(loadWindowWorkspaceMap())
        }
      })
      return onStorageChanged
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Cleanup Listener
  yield* Effect.promise(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* cleanupWindowWorkspaceMap(getBookmarksBar)
      }),
    )
  )

  // ==========================================================================
  // Lock Management
  // ==========================================================================

  const acquireSyncLock = (job: SyncJob): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(syncLockRef)

      if (state.isLocked) {
        console.log("[SyncService] Sync already in progress, cannot acquire lock")
        return false
      }

      yield* SubscriptionRef.set(syncLockRef, {
        isLocked: true,
        currentJob: job,
      })

      console.log(`[SyncService] Lock acquired for ${job.direction}`)
      return true
    })

  const releaseSyncLock = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* SubscriptionRef.set(syncLockRef, {
        isLocked: false,
        currentJob: null,
      })
      console.log("[SyncService] Lock released")
    })

  const isSyncLocked = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(syncLockRef)
      return state.isLocked
    })

  const getCurrentSyncJob = (): Effect.Effect<SyncJob | null> =>
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(syncLockRef)
      return state.currentJob
    })

  // ==========================================================================
  // Queue Management
  // ==========================================================================

  const enqueueSyncJob = (job: SyncJob): Effect.Effect<void> =>
    Effect.gen(function* () {
      const queueState = yield* SubscriptionRef.get(syncQueueRef)

      // Deduplizierung: Entferne ältere Jobs für gleiches Window/Workspace
      const filteredQueue = queueState.queue.filter(
        (j) =>
          j.windowId !== job.windowId || j.workspaceId !== job.workspaceId,
      )

      // Füge neuen Job hinzu
      let newQueue = [...filteredQueue, job]

      // Limitiere Queue-Größe
      if (newQueue.length > MAX_QUEUE_SIZE) {
        newQueue = newQueue.slice(-MAX_QUEUE_SIZE)
        console.warn(
          `[SyncService] Queue overflow, keeping only latest ${MAX_QUEUE_SIZE} jobs`,
        )
      }

      // Clear existing timeout
      if (queueState.timeoutId !== null) {
        clearTimeout(queueState.timeoutId)
      }

      // Schedule processing mit Debounce
      const timeoutId = setTimeout(() => {
        Effect.runPromise(processSyncQueue()).catch(console.error)
      }, SYNC_DEBOUNCE_MS) as unknown as number

      yield* SubscriptionRef.set(syncQueueRef, {
        queue: newQueue,
        timeoutId,
      })

      console.log(
        `[SyncService] Job enqueued (queue size: ${newQueue.length})`,
        job,
      )
    })

  const processSyncQueue = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const queueState = yield* SubscriptionRef.get(syncQueueRef)

      if (queueState.queue.length === 0) {
        return
      }

      // Check if sync is already in progress
      const locked = yield* isSyncLocked()
      if (locked) {
        console.log(
          "[SyncService] Sync in progress, deferring queue processing",
        )
        // Reschedule
        const timeoutId = setTimeout(() => {
          Effect.runPromise(processSyncQueue()).catch(console.error)
        }, SYNC_DEBOUNCE_MS) as unknown as number

        yield* SubscriptionRef.update(syncQueueRef, (s) => ({
          ...s,
          timeoutId,
        }))
        return
      }

      // Take first job from queue
      const [job, ...restQueue] = queueState.queue

      // Update queue
      yield* SubscriptionRef.set(syncQueueRef, {
        queue: restQueue,
        timeoutId: null,
      })

      console.log(`[SyncService] Processing sync job:`, job)

      // Execute reconciliation
      yield* reconcile(job).pipe(
        Effect.catchAll((error) => {
          console.error("[SyncService] Reconciliation failed:", error)
          return Effect.logError(error)
        }),
      )

      // Process next job if queue not empty
      if (restQueue.length > 0) {
        yield* processSyncQueue()
      }
    })

  // ==========================================================================
  // Reconciliation - Core Algorithm
  // ==========================================================================

  const reconcile = (job: SyncJob): Effect.Effect<void> =>
    Effect.gen(function* () {
      // 1. Acquire Lock
      const acquired = yield* acquireSyncLock(job)
      if (!acquired) {
        console.warn("[SyncService] Failed to acquire lock, requeueing")
        yield* enqueueSyncJob(job)
        return
      }

      try {
        console.log(`[SyncService] === RECONCILIATION START ===`)
        console.log(`[SyncService] Direction: ${job.direction}`)
        console.log(
          `[SyncService] Window: ${job.windowId}, Workspace: ${job.workspaceId}`,
        )

        // 2. Load Source State
        console.log("[SyncService] Loading source state...")
        const sourceState = yield* (job.direction === "tabs-to-bookmarks"
          ? Effect.gen(function* () {
              const tabs = yield* browserApi.tabs.query({
                windowId: job.windowId,
              })
              const groups = yield* browserApi.tabGroups.query({
                windowId: job.windowId,
              })
              return yield* mapTabsToNormalizedStateEnhanced(tabs, groups)
            })
          : Effect.gen(function* () {
              const workspaceTree = yield* browserApi.bookmarks.getSubTree(
                job.workspaceId,
              )
              return yield* mapBookmarksToNormalizedState(workspaceTree[0])
            }))

        console.log(
          "[SyncService] Source state loaded:",
          getStateStats(sourceState),
        )

        // 3. Load Target State
        console.log("[SyncService] Loading target state...")
        const targetState = yield* (job.direction === "tabs-to-bookmarks"
          ? Effect.gen(function* () {
              const workspaceTree = yield* browserApi.bookmarks.getSubTree(
                job.workspaceId,
              )
              return yield* mapBookmarksToNormalizedState(workspaceTree[0])
            })
          : Effect.gen(function* () {
              const tabs = yield* browserApi.tabs.query({
                windowId: job.windowId,
              })
              const groups = yield* browserApi.tabGroups.query({
                windowId: job.windowId,
              })
              return yield* mapTabsToNormalizedStateEnhanced(tabs, groups)
            }))

        console.log(
          "[SyncService] Target state loaded:",
          getStateStats(targetState),
        )

        // 4. Diff
        console.log("[SyncService] Computing diff...")
        const diffResult = diffStates(sourceState, targetState)

        console.log(
          `[SyncService] Diff completed: ${diffResult.operations.length} operations`,
        )

        if (!diffResult.hasChanges) {
          console.log("[SyncService] No changes detected, skipping apply")
          return
        }

        // Log operations for debugging
        diffResult.operations.forEach((op, idx) => {
          console.log(`  [${idx}] ${op.type}`, op)
        })

        // 5. Apply
        console.log("[SyncService] Applying operations...")
        if (job.direction === "tabs-to-bookmarks") {
          yield* applyOperationsToBookmarks(
            job.workspaceId,
            diffResult.operations,
            browserApi,
          )
        } else {
          yield* applyOperationsToTabs(
            job.windowId,
            diffResult.operations,
            browserApi,
          )
        }

        console.log("[SyncService] === RECONCILIATION COMPLETE ===")
      } finally {
        // 6. Release Lock (ALWAYS, auch bei Fehler)
        yield* releaseSyncLock()
      }
    })

  // ==========================================================================
  // Event Listeners - Tab Changes
  // ==========================================================================

  // Tab Updated Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onTabUpdated(
        (tabId, changeInfo, tab) => {
          Effect.runFork(
            Effect.gen(function* () {
              // Ignore if sync is locked AND syncing in opposite direction
              const locked = yield* isSyncLocked()
              if (locked) {
                const currentJob = yield* getCurrentSyncJob()
                if (currentJob?.direction === "bookmarks-to-tabs") {
                  console.log(
                    "[SyncService] Ignoring tab update (syncing bookmarks to tabs)",
                  )
                  return
                }
              }

              // Ignore if loading workspace
              if (getIsLoadingWorkspace()) {
                console.log(
                  "[SyncService] Ignoring tab update (loading workspace)",
                )
                return
              }

              // Only react to relevant changes
              const isRelevantChange =
                changeInfo.pinned !== undefined ||
                changeInfo.title !== undefined ||
                changeInfo.url !== undefined

              if (!isRelevantChange) {
                return
              }

              // Find workspace for this window
              const map = yield* SubscriptionRef.get(windowWorkspaceMap)
              const workspaceId = map[tab.windowId]

              if (!workspaceId) {
                return
              }

              console.log(
                `[SyncService] Tab ${tabId} updated, enqueueing sync`,
              )

              // Enqueue sync job
              yield* enqueueSyncJob({
                windowId: tab.windowId,
                workspaceId,
                direction: "tabs-to-bookmarks",
                timestamp: Date.now(),
                source: "tab-change",
              })
            }),
          )
        },
      )
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Tab Removed Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onTabRemoved(
        (tabId, removeInfo) => {
          Effect.runFork(
            Effect.gen(function* () {
              const locked = yield* isSyncLocked()
              if (locked) {
                const currentJob = yield* getCurrentSyncJob()
                if (currentJob?.direction === "bookmarks-to-tabs") {
                  return
                }
              }

              if (getIsLoadingWorkspace()) return

              const map = yield* SubscriptionRef.get(windowWorkspaceMap)
              const workspaceId = map[removeInfo.windowId]

              if (!workspaceId) return

              console.log(
                `[SyncService] Tab ${tabId} removed, enqueueing sync`,
              )

              yield* enqueueSyncJob({
                windowId: removeInfo.windowId,
                workspaceId,
                direction: "tabs-to-bookmarks",
                timestamp: Date.now(),
                source: "tab-change",
              })
            }),
          )
        },
      )
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Tab Created Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onTabCreated((tab) => {
        Effect.runFork(
          Effect.gen(function* () {
            const locked = yield* isSyncLocked()
            if (locked) {
              const currentJob = yield* getCurrentSyncJob()
              if (currentJob?.direction === "bookmarks-to-tabs") {
                return
              }
            }

            if (getIsLoadingWorkspace()) return

            if (!tab.windowId) return

            const map = yield* SubscriptionRef.get(windowWorkspaceMap)
            const workspaceId = map[tab.windowId]

            if (!workspaceId) return

            console.log(`[SyncService] Tab ${tab.id} created, enqueueing sync`)

            yield* enqueueSyncJob({
              windowId: tab.windowId,
              workspaceId,
              direction: "tabs-to-bookmarks",
              timestamp: Date.now(),
              source: "tab-change",
            })
          }),
        )
      })
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Tab Moved Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onTabMoved((tabId, moveInfo) => {
        Effect.runFork(
          Effect.gen(function* () {
            const locked = yield* isSyncLocked()
            if (locked) {
              const currentJob = yield* getCurrentSyncJob()
              if (currentJob?.direction === "bookmarks-to-tabs") {
                return
              }
            }

            if (getIsLoadingWorkspace()) return

            const map = yield* SubscriptionRef.get(windowWorkspaceMap)
            const workspaceId = map[moveInfo.windowId]

            if (!workspaceId) return

            console.log(`[SyncService] Tab ${tabId} moved, enqueueing sync`)

            yield* enqueueSyncJob({
              windowId: moveInfo.windowId,
              workspaceId,
              direction: "tabs-to-bookmarks",
              timestamp: Date.now(),
              source: "tab-change",
            })
          }),
        )
      })
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // ✅ FIX Bug #2: Tab Group Updated Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onTabGroupUpdated((group) => {
        Effect.runFork(
          Effect.gen(function* () {
            const locked = yield* isSyncLocked()
            if (locked) {
              const currentJob = yield* getCurrentSyncJob()
              if (currentJob?.direction === "bookmarks-to-tabs") {
                return
              }
            }

            if (getIsLoadingWorkspace()) return

            // Find which window this group belongs to
            const tabs = yield* browserApi.tabs.query({ groupId: group.id })

            if (tabs.length === 0) return

            const windowId = tabs[0]?.windowId

            if (!windowId) return

            const map = yield* SubscriptionRef.get(windowWorkspaceMap)
            const workspaceId = map[windowId]

            if (!workspaceId) return

            console.log(
              `[SyncService] Tab group ${group.id} updated, enqueueing sync`,
            )

            yield* enqueueSyncJob({
              windowId,
              workspaceId,
              direction: "tabs-to-bookmarks",
              timestamp: Date.now(),
              source: "tab-change",
            })
          }),
        )
      })
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // ==========================================================================
  // Event Listeners - Bookmark Changes
  // ==========================================================================

  // Helper: Check if bookmark is in a linked workspace
  const findWorkspaceForBookmark = (
    bookmarkId: string,
  ): Effect.Effect<{ windowId: number; workspaceId: string } | null> =>
    Effect.gen(function* () {
      const map = yield* SubscriptionRef.get(windowWorkspaceMap)

      for (const [windowIdStr, workspaceId] of Object.entries(map)) {
        const workspaceTree = yield* browserApi.bookmarks
          .getSubTree(workspaceId)
          .pipe(Effect.catchAll(() => Effect.succeed([])))

        if (workspaceTree.length === 0) continue

        // Check if bookmark ID is in this workspace
        const isInWorkspace = findBookmarkByIdRecursive(
          workspaceTree[0],
          bookmarkId,
        )

        if (isInWorkspace) {
          return {
            windowId: Number(windowIdStr),
            workspaceId,
          }
        }
      }

      return null
    })

  // Bookmark Changed Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onBookmarkChanged(
        (id, changeInfo) => {
          Effect.runFork(
            Effect.gen(function* () {
              const locked = yield* isSyncLocked()
              if (locked) {
                const currentJob = yield* getCurrentSyncJob()
                if (currentJob?.direction === "tabs-to-bookmarks") {
                  console.log(
                    "[SyncService] Ignoring bookmark change (syncing tabs to bookmarks)",
                  )
                  return
                }
              }

              if (getIsLoadingWorkspace()) return

              const workspace = yield* findWorkspaceForBookmark(id)

              if (workspace) {
                console.log(
                  `[SyncService] Bookmark ${id} changed, enqueueing sync`,
                )

                yield* enqueueSyncJob({
                  windowId: workspace.windowId,
                  workspaceId: workspace.workspaceId,
                  direction: "bookmarks-to-tabs",
                  timestamp: Date.now(),
                  source: "bookmark-change",
                })
              }
            }),
          )
        },
      )
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Bookmark Created Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onBookmarkCreated(
        (id, bookmark) => {
          Effect.runFork(
            Effect.gen(function* () {
              const locked = yield* isSyncLocked()
              if (locked) {
                const currentJob = yield* getCurrentSyncJob()
                if (currentJob?.direction === "tabs-to-bookmarks") {
                  return
                }
              }

              if (getIsLoadingWorkspace()) return

              // Check if bookmark's parent is a workspace
              if (bookmark.parentId) {
                const workspace = yield* findWorkspaceForBookmark(
                  bookmark.parentId,
                )

                if (workspace) {
                  console.log(
                    `[SyncService] Bookmark ${id} created, enqueueing sync`,
                  )

                  yield* enqueueSyncJob({
                    windowId: workspace.windowId,
                    workspaceId: workspace.workspaceId,
                    direction: "bookmarks-to-tabs",
                    timestamp: Date.now(),
                    source: "bookmark-change",
                  })
                }
              }
            }),
          )
        },
      )
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // Bookmark Removed Event
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const cleanup = browserApi.events.onBookmarkRemoved(
        (id, removeInfo) => {
          Effect.runFork(
            Effect.gen(function* () {
              const locked = yield* isSyncLocked()
              if (locked) {
                const currentJob = yield* getCurrentSyncJob()
                if (currentJob?.direction === "tabs-to-bookmarks") {
                  return
                }
              }

              if (getIsLoadingWorkspace()) return

              const workspace = yield* findWorkspaceForBookmark(
                removeInfo.parentId,
              )

              if (workspace) {
                console.log(
                  `[SyncService] Bookmark ${id} removed, enqueueing sync`,
                )

                yield* enqueueSyncJob({
                  windowId: workspace.windowId,
                  workspaceId: workspace.workspaceId,
                  direction: "bookmarks-to-tabs",
                  timestamp: Date.now(),
                  source: "bookmark-change",
                })
              }
            }),
          )
        },
      )
      return cleanup
    }),
    (cleanup) => Effect.sync(() => cleanup()),
  )

  // ==========================================================================
  // Public API
  // ==========================================================================

  const linkWindow = (
    windowId: number,
    workspaceId: string,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* linkWindowToWorkspace(
        windowId as WindowId,
        workspaceId as WorkspaceId,
      )
      yield* loadWindowWorkspaceMap()
      yield* syncIfLinked(undefined, windowId)
    }).pipe(Effect.catchAll((error) => Effect.logError(error)))

  const syncIfLinked = (
    tabId?: number,
    windowId?: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (getIsLoadingWorkspace()) {
        return
      }

      let targetWindowId: number | undefined = windowId

      if (targetWindowId === undefined && tabId !== undefined) {
        const tab = yield* browserApi.tabs.get(tabId).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        )
        targetWindowId = tab?.windowId
      }

      if (targetWindowId !== undefined) {
        const workspaceIdOption = yield* getWorkspaceForWindow(
          targetWindowId as WindowId,
        )
        if (isSome(workspaceIdOption)) {
          // Enqueue instead of direct sync
          yield* enqueueSyncJob({
            windowId: targetWindowId,
            workspaceId: workspaceIdOption.value,
            direction: "tabs-to-bookmarks",
            timestamp: Date.now(),
            source: "manual",
          })
        }
      }
    }).pipe(Effect.catchAll((error) => Effect.logError(error)))

  return {
    windowWorkspaceMap,
    linkWindow,
    syncIfLinked,
  }
})

export const SyncServiceLive = Layer.scoped(SyncService, make)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find bookmark by ID in tree (recursive)
 */
const findBookmarkByIdRecursive = (
  node: chrome.bookmarks.BookmarkTreeNode,
  targetId: string,
): boolean => {
  if (node.id === targetId) {
    return true
  }

  if (node.children) {
    for (const child of node.children) {
      if (findBookmarkByIdRecursive(child, targetId)) {
        return true
      }
    }
  }

  return false
}
