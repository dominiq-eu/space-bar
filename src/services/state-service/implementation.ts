import { Effect, Layer } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import { WindowsService, WindowsServiceLive } from "../windows-service/index.ts"
import { StorageService, StorageServiceLive } from "../storage-service/index.ts"
import { TabsService, TabsServiceLive } from "../tabs-service/index.ts"
import { mapChromeTabs } from "../tabs-service/mappers.ts"
import { getBookmarkTitlesForWorkspace } from "../workspaces-service/bookmark-title-lookup.ts"
import { StateLoadError, StateService, StateServiceInterface } from "./types.ts"
import type { WorkspaceId } from "./schema.ts"
import { annotateOperation } from "../../utils/logging.ts"

// ============================================================================
// Service Implementation
// ============================================================================

const make = Effect.gen(function* () {
  // Declare dependencies
  const browserApi = yield* BrowserApiService
  const windowsService = yield* WindowsService
  const storageService = yield* StorageService
  const tabsService = yield* TabsService

  // =========================================================================
  // Private Helper Functions
  // =========================================================================

  /**
   * Load window-workspace mappings from storage
   */
  const loadWindowWorkspaceMap = (): Effect.Effect<
    Record<number, string>,
    never
  > =>
    storageService.getWindowWorkspaceMap().pipe(
      Effect.map((map) => {
        // Convert string keys to number keys
        const result: Record<number, string> = {}
        for (const [key, value] of Object.entries(map)) {
          result[Number(key)] = value
        }
        return result
      }),
      Effect.tapError((error) =>
        Effect.logWarning(
          "Failed to load window-workspace map, using empty map",
          error,
        )
      ),
      Effect.catchAll(() => Effect.succeed({})),
    ).pipe(
      annotateOperation("StateService", "loadWindowWorkspaceMap"),
    )

  /**
   * Get all Chrome tabs using BrowserApiService
   * Returns raw chrome.tabs.Tab[] for further processing
   */
  const getChromeTabs = (): Effect.Effect<chrome.tabs.Tab[], never> =>
    browserApi.tabs.query({}).pipe(
      Effect.tapError((error) =>
        Effect.logError("Failed to query tabs, returning empty array", error)
      ),
      Effect.catchAll(() => Effect.succeed([])),
    ).pipe(
      annotateOperation("StateService", "getChromeTabs"),
    )

  // =========================================================================
  // Service Operations
  // =========================================================================

  return {
    getCurrentTime: Effect.sync(() => new Date()),

    createAppState: Effect.gen(function* () {
      // Load all data in parallel
      const [chromeTabs, tabGroups, windows, windowWorkspaceMap] = yield* Effect
        .all([
          getChromeTabs(),
          tabsService.getTabGroups(),
          windowsService.getWindows(),
          loadWindowWorkspaceMap(),
        ])

      // Collect unique workspace IDs from the map
      const workspaceIds = new Set<WorkspaceId>(
        Object.values(windowWorkspaceMap).filter(Boolean) as WorkspaceId[],
      )

      // Load bookmark titles for all workspaces
      const workspaceBookmarkTitles = new Map<
        WorkspaceId,
        Map<string, string>
      >()
      for (const workspaceId of workspaceIds) {
        const titleMap = yield* getBookmarkTitlesForWorkspace(workspaceId).pipe(
          Effect.provideService(BrowserApiService, browserApi),
        )
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
    }).pipe(
      Effect.catchAll((error: unknown) =>
        Effect.fail(
          new StateLoadError({
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      ),
    ),

    getTabs: Effect.gen(function* () {
      const state = yield* Effect.gen(function* () {
        const chromeTabs = yield* getChromeTabs()
        const windowWorkspaceMap = yield* loadWindowWorkspaceMap()

        // Collect workspace IDs
        const workspaceIds = new Set<WorkspaceId>(
          Object.values(windowWorkspaceMap).filter(Boolean) as WorkspaceId[],
        )

        // Load bookmark titles
        const workspaceBookmarkTitles = new Map<
          WorkspaceId,
          Map<string, string>
        >()
        for (const workspaceId of workspaceIds) {
          const titleMap = yield* getBookmarkTitlesForWorkspace(workspaceId)
            .pipe(
              Effect.provideService(BrowserApiService, browserApi),
            )
          workspaceBookmarkTitles.set(workspaceId, titleMap)
        }

        // Create bookmark title map
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

        return yield* mapChromeTabs(chromeTabs, bookmarkTitleMap)
      })

      return state
    }).pipe(
      Effect.catchAll((error: unknown) =>
        Effect.fail(
          new StateLoadError({
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      ),
    ),

    getTabGroups: Effect.gen(function* () {
      return yield* tabsService.getTabGroups()
    }).pipe(
      Effect.catchAll((error: unknown) =>
        Effect.fail(
          new StateLoadError({
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      ),
    ),

    getWindows: Effect.gen(function* () {
      return yield* windowsService.getWindows()
    }).pipe(
      Effect.catchAll((error: unknown) =>
        Effect.fail(
          new StateLoadError({
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      ),
    ),
  } satisfies StateServiceInterface
})

// ============================================================================
// Layer Export
// ============================================================================

/**
 * Base StateService layer without dependencies provided.
 * Use this for testing with mock dependencies.
 */
const StateServiceLayer = Layer.effect(StateService, make)

/**
 * StateServiceLive
 *
 * Layer that provides StateService implementation with dependencies.
 * Provides WindowsServiceLive, StorageServiceLive, and ChromeApiServiceLive as soon as possible.
 *
 * Usage:
 * ```typescript
 * const program = Effect.gen(function*() {
 *   const stateService = yield* StateService
 *   const appState = yield* stateService.createAppState
 *   return appState
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(StateServiceLive))
 * )
 * ```
 */
export const StateServiceLive = StateServiceLayer.pipe(
  Layer.provide(Layer.mergeAll(
    WindowsServiceLive,
    StorageServiceLive,
    TabsServiceLive,
  )),
)

/**
 * StateService layer for testing.
 * Does NOT provide BrowserApiService - caller must provide it.
 *
 * Usage in tests:
 * ```typescript
 * const mockLayer = createMockBrowserApiService()
 * const testLayer = StateServiceTest.pipe(Layer.provide(mockLayer))
 * ```
 */
export const StateServiceTest = StateServiceLayer
