import { Effect, Layer, Option } from "effect"
import { BrowserApiService } from "../browser-api-service/index.ts"
import { TabsService } from "./types.ts"
import {
  GroupNotFoundError,
  InvalidGroupDataError,
  InvalidTabDataError,
  InvalidTabUrlError,
  TabNotFoundError,
  TabOperationFailedError,
} from "./errors.ts"
import type {
  GroupId,
  Tab,
  TabGroup,
  TabGroupColor,
  TabId,
  WindowId,
} from "../state-service/schema.ts"
import type { TabEventListener } from "./events.ts"
import {
  mapChromeTab,
  mapChromeTabGroup,
  mapChromeTabGroups,
  mapChromeTabs,
  mapTabChangeInfo,
} from "./mappers.ts"
import { Validators } from "../validation-service/index.ts"
import { annotateOperation } from "../../utils/logging.ts"

// ============================================================================
// Service Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all tabs from all windows
   * Uses mappers for proper validation and error handling
   */
  const getTabs = (): Effect.Effect<Tab[], never> =>
    Effect.gen(function* () {
      const chromeTabs = yield* browserApi.tabs.query({})
      const tabs = yield* mapChromeTabs(chromeTabs).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            "Some tabs failed validation, returning valid tabs only",
            error,
          ).pipe(
            Effect.annotateLogs({ totalTabs: chromeTabs.length }),
          )
        ),
        Effect.catchAll(() => Effect.succeed([])),
      )
      return tabs
    }).pipe(
      annotateOperation("TabsService", "getTabs"),
    )

  /**
   * Get a single tab by ID
   */
  const getTab = (
    tabId: TabId,
  ): Effect.Effect<
    Tab,
    | TabNotFoundError
    | InvalidTabDataError
    | InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeTab = yield* browserApi.tabs.get(tabId).pipe(
        Effect.mapError(() => new TabNotFoundError({ tabId })),
      )
      return yield* mapChromeTab(chromeTab)
    })

  /**
   * Get all tab groups
   * Uses mappers for proper validation
   */
  const getTabGroups = (): Effect.Effect<TabGroup[], never> =>
    Effect.gen(function* () {
      const chromeGroups = yield* browserApi.tabGroups.query({})
      const groups = yield* mapChromeTabGroups(chromeGroups).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            "Some tab groups failed validation, returning valid groups only",
            error,
          ).pipe(
            Effect.annotateLogs({ totalGroups: chromeGroups.length }),
          )
        ),
        Effect.catchAll(() => Effect.succeed([])),
      )
      return groups
    }).pipe(
      annotateOperation("TabsService", "getTabGroups"),
    )

  /**
   * Get a single tab group by ID
   */
  const getTabGroup = (
    groupId: GroupId,
  ): Effect.Effect<
    TabGroup,
    | GroupNotFoundError
    | InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeGroup = yield* browserApi.tabGroups.get(groupId).pipe(
        Effect.mapError(() => new GroupNotFoundError({ groupId })),
      )
      return yield* mapChromeTabGroup(chromeGroup)
    })

  // ==========================================================================
  // Tab Operations
  // ==========================================================================

  /**
   * Create a new tab
   * Returns our domain Tab, not Chrome's
   */
  const createTab = (options: {
    windowId?: WindowId
    index?: number
    url?: string
    active?: boolean
    pinned?: boolean
  }): Effect.Effect<
    Tab,
    | TabOperationFailedError
    | InvalidTabDataError
    | InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeTab = yield* browserApi.tabs.create({
        windowId: options.windowId,
        index: options.index,
        url: options.url,
        active: options.active,
        pinned: options.pinned,
      }).pipe(
        Effect.mapError((error) =>
          new TabOperationFailedError({
            operation: "create",
            reason: error.reason,
          })
        ),
      )

      return yield* mapChromeTab(chromeTab)
    })

  /**
   * Update a tab
   */
  const updateTab = (
    tabId: TabId,
    options: {
      url?: string
      active?: boolean
      pinned?: boolean
    },
  ): Effect.Effect<
    Tab,
    | TabOperationFailedError
    | InvalidTabDataError
    | InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeTab = yield* browserApi.tabs.update(tabId, options).pipe(
        Effect.mapError((error) =>
          new TabOperationFailedError({
            operation: "update",
            reason: error.reason,
            tabId,
          })
        ),
      )

      return yield* mapChromeTab(chromeTab)
    })

  /**
   * Activate a tab
   */
  const activateTab = (
    tabId: TabId,
  ): Effect.Effect<
    Tab,
    | TabOperationFailedError
    | InvalidTabDataError
    | InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  > => updateTab(tabId, { active: true })

  /**
   * Close/remove a tab
   */
  const removeTab = (
    tabId: TabId,
  ): Effect.Effect<void, TabOperationFailedError> =>
    browserApi.tabs.remove(tabId).pipe(
      Effect.mapError((error) =>
        new TabOperationFailedError({
          operation: "remove",
          reason: error.reason,
          tabId,
        })
      ),
    )

  /**
   * Close/remove multiple tabs
   */
  const removeTabs = (
    tabIds: TabId[],
  ): Effect.Effect<void, TabOperationFailedError> =>
    browserApi.tabs.remove(tabIds).pipe(
      Effect.mapError((error) =>
        new TabOperationFailedError({
          operation: "remove-multiple",
          reason: error.reason,
        })
      ),
    )

  /**
   * Move tab to a different window or position
   */
  const moveTab = (
    tabId: TabId,
    options: {
      windowId?: WindowId
      index: number
    },
  ): Effect.Effect<
    Tab,
    | TabOperationFailedError
    | InvalidTabDataError
    | InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const result = yield* browserApi.tabs.move(tabId, {
        windowId: options.windowId,
        index: options.index,
      }).pipe(
        Effect.mapError((error) =>
          new TabOperationFailedError({
            operation: "move",
            reason: error.reason,
            tabId,
          })
        ),
      )

      // chrome.tabs.move can return Tab or Tab[]
      const chromeTab = Array.isArray(result) ? result[0] : result
      return yield* mapChromeTab(chromeTab)
    })

  // ==========================================================================
  // Tab Group Operations
  // ==========================================================================

  /**
   * Group tabs together
   * If groupId is provided, adds tabs to existing group
   * If not provided, creates new group
   */
  const groupTabs = (options: {
    tabIds: TabId[]
    groupId?: GroupId
  }): Effect.Effect<
    GroupId,
    | TabOperationFailedError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const rawGroupId = yield* browserApi.tabs.group({
        tabIds: options.tabIds,
        groupId: options.groupId,
      }).pipe(
        Effect.mapError((error) =>
          new TabOperationFailedError({
            operation: "group",
            reason: error.reason,
          })
        ),
      )

      // Validate the returned group ID
      return yield* Validators.groupId(rawGroupId)
    })

  /**
   * Ungroup tabs (remove from group)
   */
  const ungroupTabs = (
    tabIds: TabId[],
  ): Effect.Effect<void, TabOperationFailedError> =>
    browserApi.tabs.ungroup(tabIds).pipe(
      Effect.mapError((error) =>
        new TabOperationFailedError({
          operation: "ungroup",
          reason: error.reason,
        })
      ),
    )

  /**
   * Update a tab group (title, color, collapsed state)
   */
  const updateTabGroup = (
    groupId: GroupId,
    options: {
      title?: string
      color?: TabGroupColor
      collapsed?: boolean
    },
  ): Effect.Effect<
    TabGroup,
    | TabOperationFailedError
    | InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  > =>
    Effect.gen(function* () {
      const chromeGroup = yield* browserApi.tabGroups.update(groupId, options)
        .pipe(
          Effect.mapError((error) =>
            new TabOperationFailedError({
              operation: "update-group",
              reason: error.reason,
            })
          ),
        )

      return yield* mapChromeTabGroup(chromeGroup)
    })

  /**
   * Toggle group collapsed state
   */
  const toggleGroupCollapsed = (
    groupId: GroupId,
    currentState: boolean,
  ): Effect.Effect<
    TabGroup,
    | TabOperationFailedError
    | InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  > => updateTabGroup(groupId, { collapsed: !currentState })

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  /**
   * Subscribe to all tab and tab group events
   * Returns cleanup function to unsubscribe
   */
  const subscribeToTabEvents = (
    listener: TabEventListener,
  ): () => void => {
    // Tab Created
    const onTabCreated = browserApi.events.onTabCreated((chromeTab) => {
      Effect.runPromise(
        mapChromeTab(chromeTab).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Failed to map created tab", error).pipe(
              Effect.annotateLogs({ tabId: chromeTab.id }),
            )
          ),
        ),
      )
        .then((tab) => {
          listener({
            type: "tab-created" as const,
            tab,
          })
        })
        .catch(() => {
          // Error already logged via tapError
        })
    })

    // Tab Updated
    const onTabUpdated = browserApi.events.onTabUpdated((
      tabId,
      changeInfo,
      chromeTab,
    ) => {
      if (chromeTab.windowId === undefined) return

      Effect.runPromise(
        mapTabChangeInfo(changeInfo).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Failed to map tab changes", error).pipe(
              Effect.annotateLogs({ tabId, windowId: chromeTab.windowId }),
            )
          ),
        ),
      )
        .then((changes) => {
          listener({
            type: "tab-updated" as const,
            tabId: tabId as TabId,
            windowId: chromeTab.windowId as WindowId,
            changes,
          })
        })
        .catch(() => {
          // Error already logged via tapError
        })
    })

    // Tab Removed
    const onTabRemoved = browserApi.events.onTabRemoved((tabId, removeInfo) => {
      listener({
        type: "tab-removed" as const,
        tabId: tabId as TabId,
        windowId: removeInfo.windowId as WindowId,
        isWindowClosing: removeInfo.isWindowClosing,
      })
    })

    // Tab Moved
    const onTabMoved = browserApi.events.onTabMoved((tabId, moveInfo) => {
      listener({
        type: "tab-moved" as const,
        tabId: tabId as TabId,
        windowId: moveInfo.windowId as WindowId,
        fromIndex: moveInfo.fromIndex,
        toIndex: moveInfo.toIndex,
      })
    })

    // Tab Attached
    const onTabAttached = browserApi.events.onTabAttached((
      tabId,
      attachInfo,
    ) => {
      listener({
        type: "tab-attached" as const,
        tabId: tabId as TabId,
        newWindowId: attachInfo.newWindowId as WindowId,
        newPosition: attachInfo.newPosition,
      })
    })

    // Tab Detached
    const onTabDetached = browserApi.events.onTabDetached((
      tabId,
      detachInfo,
    ) => {
      listener({
        type: "tab-detached" as const,
        tabId: tabId as TabId,
        oldWindowId: detachInfo.oldWindowId as WindowId,
        oldPosition: detachInfo.oldPosition,
      })
    })

    // Tab Activated
    const onTabActivated = browserApi.events.onTabActivated((activeInfo) => {
      listener({
        type: "tab-activated" as const,
        tabId: activeInfo.tabId as TabId,
        windowId: activeInfo.windowId as WindowId,
        previousTabId: undefined, // Chrome doesn't provide previousTabId
      })
    })

    // Tab Group Created
    const onTabGroupCreated = browserApi.events.onTabGroupCreated((
      chromeGroup,
    ) => {
      listener({
        type: "tab-group-created" as const,
        groupId: chromeGroup.id as GroupId,
        windowId: chromeGroup.windowId as WindowId,
      })
    })

    // Tab Group Updated
    const onTabGroupUpdated = browserApi.events.onTabGroupUpdated((
      chromeGroup,
    ) => {
      listener({
        type: "tab-group-updated" as const,
        groupId: chromeGroup.id as GroupId,
        windowId: chromeGroup.windowId as WindowId,
        changes: {
          title: chromeGroup.title && chromeGroup.title.trim() !== ""
            ? Option.some(chromeGroup.title)
            : undefined,
          color: chromeGroup.color,
          collapsed: chromeGroup.collapsed,
        },
      })
    })

    // Tab Group Removed
    const onTabGroupRemoved = browserApi.events.onTabGroupRemoved((
      chromeGroup,
    ) => {
      listener({
        type: "tab-group-removed" as const,
        groupId: chromeGroup.id as GroupId,
        windowId: chromeGroup.windowId as WindowId,
      })
    })

    // Return cleanup function that removes all listeners
    return () => {
      onTabCreated()
      onTabUpdated()
      onTabRemoved()
      onTabMoved()
      onTabAttached()
      onTabDetached()
      onTabActivated()
      onTabGroupCreated()
      onTabGroupUpdated()
      onTabGroupRemoved()
    }
  }

  return {
    getTabs,
    getTab,
    getTabGroups,
    getTabGroup,
    createTab,
    updateTab,
    activateTab,
    removeTab,
    removeTabs,
    moveTab,
    groupTabs,
    ungroupTabs,
    updateTabGroup,
    toggleGroupCollapsed,
    subscribeToTabEvents,
  } satisfies TabsService
})

// ============================================================================
// Layer
// ============================================================================

/**
 * Base TabsService layer without dependencies provided.
 * Use this for testing with mock dependencies.
 */
const TabsServiceLayer = Layer.effect(TabsService, make)

/**
 * TabsService Live Layer
 *
 * Dependencies:
 * - BrowserApiService (for all Chrome API calls)
 */
export const TabsServiceLive = TabsServiceLayer

/**
 * TabsService layer for testing.
 * Does NOT provide BrowserApiService - caller must provide it.
 *
 * Usage in tests:
 * ```typescript
 * const mockLayer = createMockBrowserApiService()
 * const testLayer = TabsServiceTest.pipe(Layer.provide(mockLayer))
 * ```
 */
export const TabsServiceTest = TabsServiceLayer
