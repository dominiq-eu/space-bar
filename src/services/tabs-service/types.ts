import { Context, Effect } from "effect"
import type {
  GroupId,
  Tab,
  TabGroup,
  TabGroupColor,
  TabId,
  WindowId,
} from "../state-service/schema.ts"

// Re-export error types
export {
  GroupNotFoundError,
  InvalidGroupDataError,
  InvalidTabDataError,
  InvalidTabUrlError,
  TabAlreadyInGroupError,
  TabNotFoundError,
  TabOperationFailedError,
} from "./errors.ts"

// Re-export event types
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
} from "./events.ts"

// ============================================================================
// TabsService Interface
// ============================================================================

/**
 * TabsService
 *
 * High-level service for tab and tab group operations.
 * Wraps BrowserApiService with domain-specific logic and validation.
 *
 * Responsibilities:
 * - Tab CRUD operations (get, create, update, remove)
 * - Tab group operations (create, update, collapse, ungroup)
 * - Tab movement and activation
 * - Event subscription for tab/group changes
 * - Data validation and mapping between Chrome types and domain types
 *
 * Dependencies:
 * - BrowserApiService for all Chrome API calls
 */
export interface TabsService {
  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get all tabs from all windows
   * Returns validated domain Tab objects
   * Never fails - invalid tabs are filtered out
   */
  readonly getTabs: () => Effect.Effect<Tab[], never>

  /**
   * Get a single tab by ID
   * Fails if tab doesn't exist or has invalid data
   */
  readonly getTab: (
    tabId: TabId,
  ) => Effect.Effect<
    Tab,
    | import("./errors.ts").TabNotFoundError
    | import("./errors.ts").InvalidTabDataError
    | import("./errors.ts").InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Get all tab groups from all windows
   * Returns validated domain TabGroup objects
   * Never fails - invalid groups are filtered out
   */
  readonly getTabGroups: () => Effect.Effect<TabGroup[], never>

  /**
   * Get a single tab group by ID
   * Fails if group doesn't exist or has invalid data
   */
  readonly getTabGroup: (
    groupId: GroupId,
  ) => Effect.Effect<
    TabGroup,
    | import("./errors.ts").GroupNotFoundError
    | import("./errors.ts").InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  // ==========================================================================
  // Tab Operations
  // ==========================================================================

  /**
   * Create a new tab
   * Returns validated domain Tab object
   */
  readonly createTab: (options: {
    windowId?: WindowId
    index?: number
    url?: string
    active?: boolean
    pinned?: boolean
  }) => Effect.Effect<
    Tab,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidTabDataError
    | import("./errors.ts").InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Update a tab's properties
   */
  readonly updateTab: (
    tabId: TabId,
    options: {
      url?: string
      active?: boolean
      pinned?: boolean
    },
  ) => Effect.Effect<
    Tab,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidTabDataError
    | import("./errors.ts").InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Activate a tab (make it the active tab in its window)
   */
  readonly activateTab: (
    tabId: TabId,
  ) => Effect.Effect<
    Tab,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidTabDataError
    | import("./errors.ts").InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Close/remove a single tab
   */
  readonly removeTab: (
    tabId: TabId,
  ) => Effect.Effect<void, import("./errors.ts").TabOperationFailedError>

  /**
   * Close/remove multiple tabs
   */
  readonly removeTabs: (
    tabIds: TabId[],
  ) => Effect.Effect<void, import("./errors.ts").TabOperationFailedError>

  /**
   * Move a tab to a different window or position
   */
  readonly moveTab: (
    tabId: TabId,
    options: {
      windowId?: WindowId
      index: number
    },
  ) => Effect.Effect<
    Tab,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidTabDataError
    | import("./errors.ts").InvalidTabUrlError
    | import("../validation-service/index.ts").InvalidIdError
  >

  // ==========================================================================
  // Tab Group Operations
  // ==========================================================================

  /**
   * Group tabs together
   * If groupId is provided, adds tabs to existing group
   * If not provided, creates new group
   * Returns the group ID
   */
  readonly groupTabs: (options: {
    tabIds: TabId[]
    groupId?: GroupId
  }) => Effect.Effect<
    GroupId,
    | import("./errors.ts").TabOperationFailedError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Ungroup tabs (remove from their group)
   */
  readonly ungroupTabs: (
    tabIds: TabId[],
  ) => Effect.Effect<void, import("./errors.ts").TabOperationFailedError>

  /**
   * Update a tab group's properties (title, color, collapsed state)
   */
  readonly updateTabGroup: (
    groupId: GroupId,
    options: {
      title?: string
      color?: TabGroupColor
      collapsed?: boolean
    },
  ) => Effect.Effect<
    TabGroup,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  /**
   * Toggle a group's collapsed state
   */
  readonly toggleGroupCollapsed: (
    groupId: GroupId,
    currentState: boolean,
  ) => Effect.Effect<
    TabGroup,
    | import("./errors.ts").TabOperationFailedError
    | import("./errors.ts").InvalidGroupDataError
    | import("../validation-service/index.ts").InvalidIdError
  >

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  /**
   * Subscribe to all tab and tab group events
   * Returns cleanup function to unsubscribe
   *
   * Events include:
   * - tab-created, tab-updated, tab-removed
   * - tab-moved, tab-attached, tab-detached, tab-activated
   * - tab-group-created, tab-group-updated, tab-group-removed
   */
  readonly subscribeToTabEvents: (
    listener: import("./events.ts").TabEventListener,
  ) => () => void
}

// ============================================================================
// Context Tag
// ============================================================================

/**
 * TabsService Context Tag
 *
 * Use this to inject TabsService:
 *
 * ```typescript
 * const make = Effect.gen(function*() {
 *   const tabs = yield* TabsService
 *
 *   yield* tabs.createTab({ url: "https://example.com" })
 * })
 * ```
 */
export const TabsService = Context.GenericTag<TabsService>("TabsService")
