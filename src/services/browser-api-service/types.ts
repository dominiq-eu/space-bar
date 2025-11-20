import { Context, Data, Effect } from "effect"

// ============================================================================
// Re-export Types from state-service
// ============================================================================

export type {
  GroupId,
  TabId,
  WindowId,
  WorkspaceId,
} from "../state-service/types.ts"

// ============================================================================
// Tagged Errors
// ============================================================================

/**
 * Generic Browser API Error
 * Used for unexpected errors from Chrome API
 */
export class BrowserApiError extends Data.TaggedError("BrowserApiError")<{
  readonly api: string
  readonly operation: string
  readonly reason: string
}> {}

/**
 * Tab Not Found Error
 * Thrown when chrome.tabs.get fails
 */
export class TabNotFoundError extends Data.TaggedError("TabNotFoundError")<{
  readonly tabId: number
}> {}

/**
 * Tab Operation Failed Error
 * Generic error for tab operations (create, update, remove, etc.)
 */
export class TabOperationError extends Data.TaggedError("TabOperationError")<{
  readonly operation: string
  readonly reason: string
  readonly tabId?: number
}> {}

/**
 * Tab Group Not Found Error
 */
export class GroupNotFoundError extends Data.TaggedError("GroupNotFoundError")<{
  readonly groupId: number
}> {}

/**
 * Tab Group Operation Failed Error
 */
export class TabGroupOperationError
  extends Data.TaggedError("TabGroupOperationError")<{
    readonly operation: string
    readonly reason: string
    readonly groupId?: number
  }> {}

/**
 * Window Not Found Error
 */
export class WindowNotFoundError
  extends Data.TaggedError("WindowNotFoundError")<{
    readonly windowId: number
  }> {}

/**
 * Window Operation Failed Error
 */
export class WindowOperationError
  extends Data.TaggedError("WindowOperationError")<{
    readonly operation: string
    readonly reason: string
    readonly windowId?: number
  }> {}

/**
 * Bookmark Not Found Error
 */
export class BookmarkNotFoundError
  extends Data.TaggedError("BookmarkNotFoundError")<{
    readonly id: string
  }> {}

/**
 * Bookmark Operation Failed Error
 */
export class BookmarkOperationError
  extends Data.TaggedError("BookmarkOperationError")<{
    readonly operation: string
    readonly reason: string
    readonly bookmarkId?: string
  }> {}

/**
 * Storage Operation Failed Error
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string
  readonly reason: string
  readonly key?: string
}> {}

// ============================================================================
// BrowserApiService Interface
// ============================================================================

/**
 * BrowserApiService
 *
 * Abstraction layer for Browser Extension APIs.
 * This is the ONLY layer that is allowed to call chrome.* APIs directly.
 *
 * All other services must depend on BrowserApiService.
 *
 * Benefits:
 * - Testability: Easy to mock for unit tests
 * - Browser-agnostic: Can implement FirefoxApiService later
 * - Type-safe: All operations return Effect with typed errors
 * - Single responsibility: Only one place to handle chrome.* API quirks
 */
export interface BrowserApiService {
  // ==========================================================================
  // Tabs API
  // ==========================================================================
  readonly tabs: {
    /**
     * Query tabs matching the given criteria
     * Never fails - returns empty array on error
     */
    readonly query: (
      queryInfo: chrome.tabs.QueryInfo,
    ) => Effect.Effect<chrome.tabs.Tab[], never>

    /**
     * Get a specific tab by ID
     * Fails with TabNotFoundError if tab doesn't exist
     */
    readonly get: (
      tabId: number,
    ) => Effect.Effect<chrome.tabs.Tab, TabNotFoundError>

    /**
     * Create a new tab
     * Fails with TabOperationError if creation fails
     */
    readonly create: (
      createProperties: chrome.tabs.CreateProperties,
    ) => Effect.Effect<chrome.tabs.Tab, TabOperationError>

    /**
     * Update a tab's properties
     * Fails with TabOperationError if update fails
     */
    readonly update: (
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
    ) => Effect.Effect<chrome.tabs.Tab, TabOperationError>

    /**
     * Remove one or multiple tabs
     * Fails with TabOperationError if removal fails
     */
    readonly remove: (
      tabIds: number | number[],
    ) => Effect.Effect<void, TabOperationError>

    /**
     * Move one or multiple tabs
     * Returns single Tab or Tab[] depending on input
     */
    readonly move: (
      tabIds: number | number[],
      moveProperties: chrome.tabs.MoveProperties,
    ) => Effect.Effect<
      chrome.tabs.Tab | chrome.tabs.Tab[],
      TabOperationError
    >

    /**
     * Group tabs together
     * If groupId provided, adds to existing group
     * Returns the group ID
     */
    readonly group: (
      options: chrome.tabs.GroupOptions,
    ) => Effect.Effect<number, TabOperationError>

    /**
     * Remove tabs from their group
     */
    readonly ungroup: (
      tabIds: number | number[],
    ) => Effect.Effect<void, TabOperationError>

    /**
     * Discard a tab (unload from memory but keep in tab strip)
     * Used for memory optimization
     */
    readonly discard: (
      tabId: number,
    ) => Effect.Effect<chrome.tabs.Tab, TabOperationError>
  }

  // ==========================================================================
  // Tab Groups API
  // ==========================================================================
  readonly tabGroups: {
    /**
     * Query tab groups matching criteria
     * Never fails - returns empty array on error
     */
    readonly query: (
      queryInfo: chrome.tabGroups.QueryInfo,
    ) => Effect.Effect<chrome.tabGroups.TabGroup[], never>

    /**
     * Get a specific tab group by ID
     */
    readonly get: (
      groupId: number,
    ) => Effect.Effect<chrome.tabGroups.TabGroup, GroupNotFoundError>

    /**
     * Update tab group properties (title, color, collapsed)
     */
    readonly update: (
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties,
    ) => Effect.Effect<chrome.tabGroups.TabGroup, TabGroupOperationError>

    /**
     * Move a tab group to different window or position
     */
    readonly move: (
      groupId: number,
      moveProperties: chrome.tabGroups.MoveProperties,
    ) => Effect.Effect<chrome.tabGroups.TabGroup, TabGroupOperationError>
  }

  // ==========================================================================
  // Windows API
  // ==========================================================================
  readonly windows: {
    /**
     * Get all windows
     * Never fails - returns empty array on error
     */
    readonly getAll: (
      getInfo?: chrome.windows.QueryOptions,
    ) => Effect.Effect<chrome.windows.Window[], never>

    /**
     * Get a specific window by ID
     */
    readonly get: (
      windowId: number,
    ) => Effect.Effect<chrome.windows.Window, WindowNotFoundError>

    /**
     * Get the current window (where extension is running)
     */
    readonly getCurrent: () => Effect.Effect<
      chrome.windows.Window,
      WindowNotFoundError
    >

    /**
     * Create a new window
     */
    readonly create: (
      createData?: chrome.windows.CreateData,
    ) => Effect.Effect<chrome.windows.Window, WindowOperationError>

    /**
     * Update window properties (focused, bounds, state, etc.)
     */
    readonly update: (
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ) => Effect.Effect<chrome.windows.Window, WindowOperationError>

    /**
     * Close a window
     */
    readonly remove: (
      windowId: number,
    ) => Effect.Effect<void, WindowOperationError>
  }

  // ==========================================================================
  // Bookmarks API
  // ==========================================================================
  readonly bookmarks: {
    /**
     * Get the entire bookmark tree
     * Never fails - returns empty array on error
     */
    readonly getTree: () => Effect.Effect<
      chrome.bookmarks.BookmarkTreeNode[],
      never
    >

    /**
     * Get children of a bookmark folder
     * Never fails - returns empty array on error
     */
    readonly getChildren: (
      id: string,
    ) => Effect.Effect<chrome.bookmarks.BookmarkTreeNode[], never>

    /**
     * Get subtree of a bookmark node
     * Fails if bookmark doesn't exist
     */
    readonly getSubTree: (
      id: string,
    ) => Effect.Effect<
      chrome.bookmarks.BookmarkTreeNode[],
      BookmarkNotFoundError
    >

    /**
     * Create a bookmark or folder
     */
    readonly create: (
      bookmark: chrome.bookmarks.BookmarkCreateArg,
    ) => Effect.Effect<
      chrome.bookmarks.BookmarkTreeNode,
      BookmarkOperationError
    >

    /**
     * Update bookmark properties (title, url)
     */
    readonly update: (
      id: string,
      changes: chrome.bookmarks.BookmarkChangesArg,
    ) => Effect.Effect<
      chrome.bookmarks.BookmarkTreeNode,
      BookmarkOperationError
    >

    /**
     * Remove a bookmark
     */
    readonly remove: (
      id: string,
    ) => Effect.Effect<void, BookmarkOperationError>

    /**
     * Remove a bookmark folder and all its contents
     */
    readonly removeTree: (
      id: string,
    ) => Effect.Effect<void, BookmarkOperationError>
  }

  // ==========================================================================
  // Storage API
  // ==========================================================================
  readonly storage: {
    readonly local: {
      /**
       * Get items from local storage
       * Returns empty object if keys don't exist
       * Never fails - returns empty object on error
       */
      readonly get: (
        keys?: string | string[],
      ) => Effect.Effect<Record<string, unknown>, never>

      /**
       * Set items in local storage
       * Fails with StorageError if operation fails
       */
      readonly set: (
        items: Record<string, unknown>,
      ) => Effect.Effect<void, StorageError>

      /**
       * Remove items from local storage
       */
      readonly remove: (
        keys: string | string[],
      ) => Effect.Effect<void, StorageError>

      /**
       * Clear all items from local storage
       */
      readonly clear: () => Effect.Effect<void, StorageError>
    }
  }

  // ==========================================================================
  // Runtime API
  // ==========================================================================
  readonly runtime: {
    /**
     * Get extension ID
     */
    readonly getId: () => string
  }

  // ==========================================================================
  // Event Subscriptions
  // ==========================================================================
  readonly events: {
    // --- Tab Events ---

    /**
     * Subscribe to tab created events
     * Returns cleanup function to unsubscribe
     */
    readonly onTabCreated: (
      callback: (tab: chrome.tabs.Tab) => void,
    ) => () => void

    /**
     * Subscribe to tab updated events
     * Returns cleanup function
     */
    readonly onTabUpdated: (
      callback: (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => void,
    ) => () => void

    /**
     * Subscribe to tab removed events
     */
    readonly onTabRemoved: (
      callback: (
        tabId: number,
        removeInfo: chrome.tabs.TabRemoveInfo,
      ) => void,
    ) => () => void

    /**
     * Subscribe to tab moved events
     */
    readonly onTabMoved: (
      callback: (
        tabId: number,
        moveInfo: chrome.tabs.TabMoveInfo,
      ) => void,
    ) => () => void

    /**
     * Subscribe to tab attached events (moved to different window)
     */
    readonly onTabAttached: (
      callback: (
        tabId: number,
        attachInfo: chrome.tabs.TabAttachInfo,
      ) => void,
    ) => () => void

    /**
     * Subscribe to tab detached events (removed from window)
     */
    readonly onTabDetached: (
      callback: (
        tabId: number,
        detachInfo: chrome.tabs.TabDetachInfo,
      ) => void,
    ) => () => void

    /**
     * Subscribe to tab activated events (tab becomes active)
     */
    readonly onTabActivated: (
      callback: (activeInfo: chrome.tabs.TabActiveInfo) => void,
    ) => () => void

    // --- Tab Group Events ---

    /**
     * Subscribe to tab group created events
     */
    readonly onTabGroupCreated: (
      callback: (group: chrome.tabGroups.TabGroup) => void,
    ) => () => void

    /**
     * Subscribe to tab group updated events
     */
    readonly onTabGroupUpdated: (
      callback: (group: chrome.tabGroups.TabGroup) => void,
    ) => () => void

    /**
     * Subscribe to tab group removed events
     */
    readonly onTabGroupRemoved: (
      callback: (group: chrome.tabGroups.TabGroup) => void,
    ) => () => void

    // --- Window Events ---

    /**
     * Subscribe to window created events
     */
    readonly onWindowCreated: (
      callback: (window: chrome.windows.Window) => void,
    ) => () => void

    /**
     * Subscribe to window removed events
     */
    readonly onWindowRemoved: (
      callback: (windowId: number) => void,
    ) => () => void

    /**
     * Subscribe to window focus changed events
     */
    readonly onWindowFocusChanged: (
      callback: (windowId: number) => void,
    ) => () => void

    // --- Bookmark Events ---

    /**
     * Subscribe to bookmark created events
     */
    readonly onBookmarkCreated: (
      callback: (
        id: string,
        bookmark: chrome.bookmarks.BookmarkTreeNode,
      ) => void,
    ) => () => void

    /**
     * Subscribe to bookmark removed events
     */
    readonly onBookmarkRemoved: (
      callback: (
        id: string,
        removeInfo: chrome.bookmarks.BookmarkRemoveInfo,
      ) => void,
    ) => () => void

    /**
     * Subscribe to bookmark changed events (title/url updated)
     */
    readonly onBookmarkChanged: (
      callback: (
        id: string,
        changeInfo: chrome.bookmarks.BookmarkChangeInfo,
      ) => void,
    ) => () => void

    // --- Storage Events ---

    /**
     * Subscribe to storage changed events
     */
    readonly onStorageChanged: (
      callback: (
        changes: Record<string, chrome.storage.StorageChange>,
      ) => void,
    ) => () => void
  }
}

// ============================================================================
// Context Tag
// ============================================================================

/**
 * BrowserApiService Context Tag
 *
 * Use this to inject BrowserApiService into other services:
 *
 * ```typescript
 * const make = Effect.gen(function*() {
 *   const browserApi = yield* BrowserApiService
 *
 *   return {
 *     myOperation: Effect.gen(function*() {
 *       const tabs = yield* browserApi.tabs.query({})
 *       // ...
 *     })
 *   }
 * })
 * ```
 */
export const BrowserApiService = Context.GenericTag<BrowserApiService>(
  "BrowserApiService",
)
