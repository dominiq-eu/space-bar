import { Effect, Option, Schema } from "effect"
import {
  GroupId,
  Tab,
  TabGroup,
  TabGroupColor,
  TabId,
  WindowId,
} from "../state-service/types.ts"
import {
  mapChromeTab,
  mapChromeTabGroup,
  mapChromeTabGroups,
  mapChromeTabs,
  mapTabChangeInfo,
} from "./mappers.ts"
import {
  GroupNotFoundError,
  InvalidGroupDataError,
  InvalidTabDataError,
  InvalidTabUrlError,
  TabAlreadyInGroupError,
  TabNotFoundError,
  TabOperationFailedError,
} from "./errors.ts"
import type {
  TabActivatedEvent,
  TabAttachedEvent,
  TabCreatedEvent,
  TabDetachedEvent,
  TabEvent,
  TabEventListener,
  TabGroupCreatedEvent,
  TabGroupRemovedEvent,
  TabGroupUpdatedEvent,
  TabMovedEvent,
  TabRemovedEvent,
  TabUpdatedEvent,
} from "./events.ts"

// Re-export constants
export * from "./constants.ts"

// Re-export event types for consumers
export type {
  TabActivatedEvent,
  TabAttachedEvent,
  TabCreatedEvent,
  TabDetachedEvent,
  TabEvent,
  TabEventListener,
  TabGroupCreatedEvent,
  TabGroupRemovedEvent,
  TabGroupUpdatedEvent,
  TabMovedEvent,
  TabRemovedEvent,
  TabUpdatedEvent,
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get all tabs from all windows
 * Uses mappers for proper validation and error handling
 */
export const getTabs = (): Effect.Effect<Tab[]> =>
  Effect.async<Tab[], never>((resume) => {
    chrome.tabs.query({}, (chromeTabs) => {
      Effect.runPromise(mapChromeTabs(chromeTabs))
        .then((tabs) => resume(Effect.succeed(tabs)))
        .catch(() => resume(Effect.succeed([]))) // Return empty array on error, invalid tabs are filtered
    })
  })

/**
 * Get a single tab by ID
 */
export const getTab = (
  tabId: TabId,
): Effect.Effect<
  Tab,
  TabNotFoundError | InvalidTabDataError | InvalidTabUrlError
> =>
  Effect.gen(function* () {
    const chromeTab = yield* Effect.async<chrome.tabs.Tab, TabNotFoundError>(
      (resume) => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            resume(Effect.fail(new TabNotFoundError({ tabId })))
          } else {
            resume(Effect.succeed(tab))
          }
        })
      },
    )

    return yield* mapChromeTab(chromeTab)
  })

/**
 * Get all tab groups
 * Uses mappers for proper validation
 */
export const getTabGroups = (): Effect.Effect<TabGroup[]> =>
  Effect.async<TabGroup[], never>((resume) => {
    chrome.tabGroups.query({}, (chromeGroups) => {
      Effect.runPromise(mapChromeTabGroups(chromeGroups))
        .then((groups) => resume(Effect.succeed(groups)))
        .catch(() => resume(Effect.succeed([]))) // Return empty array on error, invalid groups are filtered
    })
  })

/**
 * Get a single tab group by ID
 */
export const getTabGroup = (
  groupId: GroupId,
): Effect.Effect<TabGroup, GroupNotFoundError | InvalidGroupDataError> =>
  Effect.gen(function* () {
    const chromeGroup = yield* Effect.async<
      chrome.tabGroups.TabGroup,
      GroupNotFoundError
    >((resume) => {
      chrome.tabGroups.get(groupId, (group) => {
        if (chrome.runtime.lastError) {
          resume(Effect.fail(new GroupNotFoundError({ groupId })))
        } else {
          resume(Effect.succeed(group))
        }
      })
    })

    return yield* mapChromeTabGroup(chromeGroup)
  })

// ============================================================================
// Tab Operations
// ============================================================================

/**
 * Create a new tab
 * Returns our domain Tab, not Chrome's
 */
export const createTab = (options: {
  windowId?: WindowId
  index?: number
  url?: string
  active?: boolean
  pinned?: boolean
}): Effect.Effect<
  Tab,
  TabOperationFailedError | InvalidTabDataError | InvalidTabUrlError
> =>
  Effect.gen(function* () {
    const chromeTab = yield* Effect.async<
      chrome.tabs.Tab,
      TabOperationFailedError
    >((resume) => {
      chrome.tabs.create(
        {
          windowId: options.windowId,
          index: options.index,
          url: options.url,
          active: options.active,
          pinned: options.pinned,
        },
        (tab) => {
          if (chrome.runtime.lastError || !tab) {
            resume(
              Effect.fail(
                new TabOperationFailedError({
                  operation: "create",
                  reason: chrome.runtime.lastError?.message || "Unknown error",
                }),
              ),
            )
          } else {
            resume(Effect.succeed(tab))
          }
        },
      )
    })

    return yield* mapChromeTab(chromeTab)
  })

/**
 * Update a tab
 */
export const updateTab = (
  tabId: TabId,
  options: {
    url?: string
    active?: boolean
    pinned?: boolean
  },
): Effect.Effect<
  Tab,
  TabOperationFailedError | InvalidTabDataError | InvalidTabUrlError
> =>
  Effect.gen(function* () {
    const chromeTab = yield* Effect.async<
      chrome.tabs.Tab,
      TabOperationFailedError
    >((resume) => {
      chrome.tabs.update(tabId, options, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resume(
            Effect.fail(
              new TabOperationFailedError({
                operation: "update",
                reason: chrome.runtime.lastError?.message || "Unknown error",
                tabId,
              }),
            ),
          )
        } else {
          resume(Effect.succeed(tab))
        }
      })
    })

    return yield* mapChromeTab(chromeTab)
  })

/**
 * Activate a tab
 */
export const activateTab = (
  tabId: TabId,
): Effect.Effect<
  Tab,
  TabOperationFailedError | InvalidTabDataError | InvalidTabUrlError
> => updateTab(tabId, { active: true })

/**
 * Close/remove a tab
 */
export const removeTab = (
  tabId: TabId,
): Effect.Effect<void, TabOperationFailedError> =>
  Effect.async<void, TabOperationFailedError>((resume) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new TabOperationFailedError({
              operation: "remove",
              reason: chrome.runtime.lastError.message || "Unknown error",
              tabId,
            }),
          ),
        )
      } else {
        resume(Effect.succeed(undefined))
      }
    })
  })

/**
 * Close/remove multiple tabs
 */
export const removeTabs = (
  tabIds: TabId[],
): Effect.Effect<void, TabOperationFailedError> =>
  Effect.async<void, TabOperationFailedError>((resume) => {
    chrome.tabs.remove(tabIds, () => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new TabOperationFailedError({
              operation: "remove-multiple",
              reason: chrome.runtime.lastError.message || "Unknown error",
            }),
          ),
        )
      } else {
        resume(Effect.succeed(undefined))
      }
    })
  })

/**
 * Move tab to a different window or position
 */
export const moveTab = (
  tabId: TabId,
  options: {
    windowId?: WindowId
    index: number
  },
): Effect.Effect<
  Tab,
  TabOperationFailedError | InvalidTabDataError | InvalidTabUrlError
> =>
  Effect.gen(function* () {
    const result = yield* Effect.async<
      chrome.tabs.Tab | chrome.tabs.Tab[],
      TabOperationFailedError
    >((resume) => {
      chrome.tabs.move(
        tabId,
        { windowId: options.windowId, index: options.index },
        (result) => {
          if (chrome.runtime.lastError) {
            resume(
              Effect.fail(
                new TabOperationFailedError({
                  operation: "move",
                  reason: chrome.runtime.lastError.message || "Unknown error",
                  tabId,
                }),
              ),
            )
          } else {
            resume(Effect.succeed(result))
          }
        },
      )
    })

    // chrome.tabs.move can return Tab or Tab[]
    const chromeTab = Array.isArray(result) ? result[0] : result
    return yield* mapChromeTab(chromeTab)
  })

// ============================================================================
// Tab Group Operations
// ============================================================================

/**
 * Group tabs together
 * If groupId is provided, adds tabs to existing group
 * If not provided, creates new group
 */
export const groupTabs = (options: {
  tabIds: TabId[]
  groupId?: GroupId
}): Effect.Effect<GroupId, TabOperationFailedError> =>
  Effect.async<GroupId, TabOperationFailedError>((resume) => {
    chrome.tabs.group(
      {
        tabIds: options.tabIds,
        groupId: options.groupId,
      },
      (groupId) => {
        if (chrome.runtime.lastError) {
          resume(
            Effect.fail(
              new TabOperationFailedError({
                operation: "group",
                reason: chrome.runtime.lastError.message || "Unknown error",
              }),
            ),
          )
        } else {
          // Cast to GroupId - we trust Chrome API returns valid positive integer
          resume(Effect.succeed(groupId as GroupId))
        }
      },
    )
  })

/**
 * Ungroup tabs (remove from group)
 */
export const ungroupTabs = (
  tabIds: TabId[],
): Effect.Effect<void, TabOperationFailedError> =>
  Effect.async<void, TabOperationFailedError>((resume) => {
    chrome.tabs.ungroup(tabIds, () => {
      if (chrome.runtime.lastError) {
        resume(
          Effect.fail(
            new TabOperationFailedError({
              operation: "ungroup",
              reason: chrome.runtime.lastError.message || "Unknown error",
            }),
          ),
        )
      } else {
        resume(Effect.succeed(undefined))
      }
    })
  })

/**
 * Update a tab group (title, color, collapsed state)
 */
export const updateTabGroup = (
  groupId: GroupId,
  options: {
    title?: string
    color?: TabGroupColor
    collapsed?: boolean
  },
): Effect.Effect<TabGroup, TabOperationFailedError | InvalidGroupDataError> =>
  Effect.gen(function* () {
    const chromeGroup = yield* Effect.async<
      chrome.tabGroups.TabGroup,
      TabOperationFailedError
    >((resume) => {
      chrome.tabGroups.update(groupId, options, (group) => {
        if (chrome.runtime.lastError || !group) {
          resume(
            Effect.fail(
              new TabOperationFailedError({
                operation: "update-group",
                reason: chrome.runtime.lastError?.message || "Unknown error",
              }),
            ),
          )
        } else {
          resume(Effect.succeed(group))
        }
      })
    })

    return yield* mapChromeTabGroup(chromeGroup)
  })

/**
 * Toggle group collapsed state
 */
export const toggleGroupCollapsed = (
  groupId: GroupId,
  currentState: boolean,
): Effect.Effect<TabGroup, TabOperationFailedError | InvalidGroupDataError> =>
  updateTabGroup(groupId, { collapsed: !currentState })

// ============================================================================
// Event Subscription
// ============================================================================

/**
 * Subscribe to all tab and tab group events
 * Returns cleanup function to unsubscribe
 */
export const subscribeToTabEvents = (
  listener: TabEventListener,
): () => void => {
  // Tab Created
  const onTabCreated = (chromeTab: chrome.tabs.Tab) => {
    Effect.runPromise(mapChromeTab(chromeTab))
      .then((tab) => {
        listener({
          type: "tab-created" as const,
          tab,
        })
      })
      .catch((error) => {
        console.warn("Failed to map created tab:", error)
      })
  }

  // Tab Updated
  const onTabUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    chromeTab: chrome.tabs.Tab,
  ) => {
    if (chromeTab.windowId === undefined) return

    Effect.runPromise(mapTabChangeInfo(changeInfo))
      .then((changes) => {
        listener({
          type: "tab-updated" as const,
          tabId: tabId as TabId,
          windowId: chromeTab.windowId as WindowId,
          changes,
        })
      })
      .catch((error) => {
        console.warn("Failed to map tab changes:", error)
      })
  }

  // Tab Removed
  const onTabRemoved = (
    tabId: number,
    removeInfo: chrome.tabs.TabRemoveInfo,
  ) => {
    listener({
      type: "tab-removed" as const,
      tabId: tabId as TabId,
      windowId: removeInfo.windowId as WindowId,
      isWindowClosing: removeInfo.isWindowClosing,
    })
  }

  // Tab Moved
  const onTabMoved = (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => {
    listener({
      type: "tab-moved" as const,
      tabId: tabId as TabId,
      windowId: moveInfo.windowId as WindowId,
      fromIndex: moveInfo.fromIndex,
      toIndex: moveInfo.toIndex,
    })
  }

  // Tab Attached
  const onTabAttached = (
    tabId: number,
    attachInfo: chrome.tabs.TabAttachInfo,
  ) => {
    listener({
      type: "tab-attached" as const,
      tabId: tabId as TabId,
      newWindowId: attachInfo.newWindowId as WindowId,
      newPosition: attachInfo.newPosition,
    })
  }

  // Tab Detached
  const onTabDetached = (
    tabId: number,
    detachInfo: chrome.tabs.TabDetachInfo,
  ) => {
    listener({
      type: "tab-detached" as const,
      tabId: tabId as TabId,
      oldWindowId: detachInfo.oldWindowId as WindowId,
      oldPosition: detachInfo.oldPosition,
    })
  }

  // Tab Activated (fires when active tab changes)
  const onTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
    listener({
      type: "tab-activated" as const,
      tabId: activeInfo.tabId as TabId,
      windowId: activeInfo.windowId as WindowId,
      previousTabId: undefined, // Chrome doesn't provide previousTabId
    })
  }

  // Tab Group Created
  const onTabGroupCreated = (chromeGroup: chrome.tabGroups.TabGroup) => {
    listener({
      type: "tab-group-created" as const,
      groupId: chromeGroup.id as GroupId,
      windowId: chromeGroup.windowId as WindowId,
    })
  }

  // Tab Group Updated
  const onTabGroupUpdated = (chromeGroup: chrome.tabGroups.TabGroup) => {
    // We don't have access to what changed, so we just pass the current state
    listener({
      type: "tab-group-updated" as const,
      groupId: chromeGroup.id as GroupId,
      windowId: chromeGroup.windowId as WindowId,
      changes: {
        // Chrome doesn't tell us what changed, so we pass current values
        // Consumer can compare with their state if needed
        title: chromeGroup.title && chromeGroup.title.trim() !== ""
          ? Option.some(chromeGroup.title)
          : undefined,
        color: chromeGroup.color,
        collapsed: chromeGroup.collapsed,
      },
    })
  }

  // Tab Group Removed
  const onTabGroupRemoved = (chromeGroup: chrome.tabGroups.TabGroup) => {
    listener({
      type: "tab-group-removed" as const,
      groupId: chromeGroup.id as GroupId,
      windowId: chromeGroup.windowId as WindowId,
    })
  }

  // Register all listeners
  chrome.tabs.onCreated.addListener(onTabCreated)
  chrome.tabs.onUpdated.addListener(onTabUpdated)
  chrome.tabs.onRemoved.addListener(onTabRemoved)
  chrome.tabs.onMoved.addListener(onTabMoved)
  chrome.tabs.onAttached.addListener(onTabAttached)
  chrome.tabs.onDetached.addListener(onTabDetached)
  chrome.tabs.onActivated.addListener(onTabActivated)
  chrome.tabGroups.onCreated.addListener(onTabGroupCreated)
  chrome.tabGroups.onUpdated.addListener(onTabGroupUpdated)
  chrome.tabGroups.onRemoved.addListener(onTabGroupRemoved)

  // Return cleanup function
  return () => {
    chrome.tabs.onCreated.removeListener(onTabCreated)
    chrome.tabs.onUpdated.removeListener(onTabUpdated)
    chrome.tabs.onRemoved.removeListener(onTabRemoved)
    chrome.tabs.onMoved.removeListener(onTabMoved)
    chrome.tabs.onAttached.removeListener(onTabAttached)
    chrome.tabs.onDetached.removeListener(onTabDetached)
    chrome.tabs.onActivated.removeListener(onTabActivated)
    chrome.tabGroups.onCreated.removeListener(onTabGroupCreated)
    chrome.tabGroups.onUpdated.removeListener(onTabGroupUpdated)
    chrome.tabGroups.onRemoved.removeListener(onTabGroupRemoved)
  }
}
