import { Effect, Layer } from "effect"
import {
  BookmarkNotFoundError,
  BookmarkOperationError,
  BrowserApiService,
  GroupNotFoundError,
  StorageError,
  TabGroupOperationError,
  TabNotFoundError,
  TabOperationError,
  WindowNotFoundError,
  WindowOperationError,
} from "./types.ts"

// ============================================================================
// Chrome API Service Implementation
// ============================================================================

/**
 * ChromeApiService
 *
 * Concrete implementation of BrowserApiService using Chrome Extension APIs.
 * This is the ONLY place where chrome.* APIs should be called directly.
 *
 * All methods wrap chrome.* callbacks in Effect.async for type-safe async handling.
 */
const make = Effect.sync(() => {
  return {
    // ========================================================================
    // Tabs API
    // ========================================================================
    tabs: {
      query: (queryInfo: chrome.tabs.QueryInfo) =>
        Effect.async<chrome.tabs.Tab[], never>((resume) => {
          chrome.tabs.query(queryInfo, (tabs) => {
            resume(Effect.succeed(tabs))
          })
        }),

      get: (tabId: number) =>
        Effect.async<chrome.tabs.Tab, TabNotFoundError>((resume) => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
              resume(Effect.fail(new TabNotFoundError({ tabId })))
            } else {
              resume(Effect.succeed(tab))
            }
          })
        }),

      create: (createProperties: chrome.tabs.CreateProperties) =>
        Effect.async<chrome.tabs.Tab, TabOperationError>((resume) => {
          chrome.tabs.create(createProperties, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "create",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(tab))
            }
          })
        }),

      update: (
        tabId: number,
        updateProperties: chrome.tabs.UpdateProperties,
      ) =>
        Effect.async<chrome.tabs.Tab, TabOperationError>((resume) => {
          chrome.tabs.update(tabId, updateProperties, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "update",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                    tabId,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(tab))
            }
          })
        }),

      remove: (tabIds: number | number[]) =>
        Effect.async<void, TabOperationError>((resume) => {
          chrome.tabs.remove(tabIds, () => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "remove",
                    reason: chrome.runtime.lastError.message || "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        }),

      move: (
        tabIds: number | number[],
        moveProperties: chrome.tabs.MoveProperties,
      ) =>
        Effect.async<chrome.tabs.Tab | chrome.tabs.Tab[], TabOperationError>(
          (resume) => {
            chrome.tabs.move(tabIds, moveProperties, (result) => {
              if (chrome.runtime.lastError) {
                resume(
                  Effect.fail(
                    new TabOperationError({
                      operation: "move",
                      reason: chrome.runtime.lastError.message ||
                        "Unknown error",
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(result))
              }
            })
          },
        ),

      group: (options: chrome.tabs.GroupOptions) =>
        Effect.async<number, TabOperationError>((resume) => {
          chrome.tabs.group(options, (groupId) => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "group",
                    reason: chrome.runtime.lastError.message || "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(groupId))
            }
          })
        }),

      ungroup: (tabIds: number | number[]) =>
        Effect.async<void, TabOperationError>((resume) => {
          chrome.tabs.ungroup(tabIds, () => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "ungroup",
                    reason: chrome.runtime.lastError.message || "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        }),

      discard: (tabId: number) =>
        Effect.async<chrome.tabs.Tab, TabOperationError>((resume) => {
          chrome.tabs.discard(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              resume(
                Effect.fail(
                  new TabOperationError({
                    operation: "discard",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                    tabId,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(tab))
            }
          })
        }),
    },

    // ========================================================================
    // Tab Groups API
    // ========================================================================
    tabGroups: {
      query: (queryInfo: chrome.tabGroups.QueryInfo) =>
        Effect.async<chrome.tabGroups.TabGroup[], never>((resume) => {
          chrome.tabGroups.query(queryInfo, (groups) => {
            resume(Effect.succeed(groups))
          })
        }),

      get: (groupId: number) =>
        Effect.async<chrome.tabGroups.TabGroup, GroupNotFoundError>(
          (resume) => {
            chrome.tabGroups.get(groupId, (group) => {
              if (chrome.runtime.lastError) {
                resume(Effect.fail(new GroupNotFoundError({ groupId })))
              } else {
                resume(Effect.succeed(group))
              }
            })
          },
        ),

      update: (
        groupId: number,
        updateProperties: chrome.tabGroups.UpdateProperties,
      ) =>
        Effect.async<chrome.tabGroups.TabGroup, TabGroupOperationError>(
          (resume) => {
            chrome.tabGroups.update(groupId, updateProperties, (group) => {
              if (chrome.runtime.lastError || !group) {
                resume(
                  Effect.fail(
                    new TabGroupOperationError({
                      operation: "update",
                      reason: chrome.runtime.lastError?.message ||
                        "Unknown error",
                      groupId,
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(group))
              }
            })
          },
        ),

      move: (
        groupId: number,
        moveProperties: chrome.tabGroups.MoveProperties,
      ) =>
        Effect.async<chrome.tabGroups.TabGroup, TabGroupOperationError>(
          (resume) => {
            chrome.tabGroups.move(groupId, moveProperties, (group) => {
              if (chrome.runtime.lastError || !group) {
                resume(
                  Effect.fail(
                    new TabGroupOperationError({
                      operation: "move",
                      reason: chrome.runtime.lastError?.message ||
                        "Unknown error",
                      groupId,
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(group))
              }
            })
          },
        ),
    },

    // ========================================================================
    // Windows API
    // ========================================================================
    windows: {
      getAll: (getInfo?: chrome.windows.GetInfo) =>
        Effect.async<chrome.windows.Window[], never>((resume) => {
          chrome.windows.getAll(getInfo ?? {}, (windows) => {
            resume(Effect.succeed(windows))
          })
        }),

      get: (windowId: number) =>
        Effect.async<chrome.windows.Window, WindowNotFoundError>((resume) => {
          chrome.windows.get(windowId, (window) => {
            if (chrome.runtime.lastError) {
              resume(Effect.fail(new WindowNotFoundError({ windowId })))
            } else {
              resume(Effect.succeed(window))
            }
          })
        }),

      getCurrent: () =>
        Effect.async<chrome.windows.Window, WindowNotFoundError>((resume) => {
          chrome.windows.getCurrent((window) => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new WindowNotFoundError({ windowId: window?.id ?? -1 }),
                ),
              )
            } else {
              resume(Effect.succeed(window))
            }
          })
        }),

      create: (createData?: chrome.windows.CreateData) =>
        Effect.async<chrome.windows.Window, WindowOperationError>((resume) => {
          chrome.windows.create(createData ?? {}, (window) => {
            if (chrome.runtime.lastError || !window) {
              resume(
                Effect.fail(
                  new WindowOperationError({
                    operation: "create",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(window))
            }
          })
        }),

      update: (windowId: number, updateInfo: chrome.windows.UpdateInfo) =>
        Effect.async<chrome.windows.Window, WindowOperationError>((resume) => {
          chrome.windows.update(windowId, updateInfo, (window) => {
            if (chrome.runtime.lastError || !window) {
              resume(
                Effect.fail(
                  new WindowOperationError({
                    operation: "update",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                    windowId,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(window))
            }
          })
        }),

      remove: (windowId: number) =>
        Effect.async<void, WindowOperationError>((resume) => {
          chrome.windows.remove(windowId, () => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new WindowOperationError({
                    operation: "remove",
                    reason: chrome.runtime.lastError.message ||
                      "Unknown error",
                    windowId,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        }),
    },

    // ========================================================================
    // Bookmarks API
    // ========================================================================
    bookmarks: {
      getTree: () =>
        Effect.async<chrome.bookmarks.BookmarkTreeNode[], never>((resume) => {
          chrome.bookmarks.getTree((tree) => {
            resume(Effect.succeed(tree))
          })
        }),

      getChildren: (id: string) =>
        Effect.async<chrome.bookmarks.BookmarkTreeNode[], never>((resume) => {
          chrome.bookmarks.getChildren(id, (children) => {
            // Handle error case gracefully
            if (chrome.runtime.lastError || !children) {
              resume(Effect.succeed([]))
            } else {
              resume(Effect.succeed(children))
            }
          })
        }),

      getSubTree: (id: string) =>
        Effect.async<
          chrome.bookmarks.BookmarkTreeNode[],
          BookmarkNotFoundError
        >((resume) => {
          chrome.bookmarks.getSubTree(id, (results) => {
            if (chrome.runtime.lastError || !results) {
              resume(Effect.fail(new BookmarkNotFoundError({ id })))
            } else {
              resume(Effect.succeed(results))
            }
          })
        }),

      create: (bookmark: chrome.bookmarks.BookmarkCreateArg) =>
        Effect.async<
          chrome.bookmarks.BookmarkTreeNode,
          BookmarkOperationError
        >((resume) => {
          chrome.bookmarks.create(bookmark, (result) => {
            if (chrome.runtime.lastError || !result) {
              resume(
                Effect.fail(
                  new BookmarkOperationError({
                    operation: "create",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(result))
            }
          })
        }),

      update: (id: string, changes: chrome.bookmarks.BookmarkChangesArg) =>
        Effect.async<
          chrome.bookmarks.BookmarkTreeNode,
          BookmarkOperationError
        >((resume) => {
          chrome.bookmarks.update(id, changes, (result) => {
            if (chrome.runtime.lastError || !result) {
              resume(
                Effect.fail(
                  new BookmarkOperationError({
                    operation: "update",
                    reason: chrome.runtime.lastError?.message ||
                      "Unknown error",
                    bookmarkId: id,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(result))
            }
          })
        }),

      remove: (id: string) =>
        Effect.async<void, BookmarkOperationError>((resume) => {
          chrome.bookmarks.remove(id, () => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new BookmarkOperationError({
                    operation: "remove",
                    reason: chrome.runtime.lastError.message ||
                      "Unknown error",
                    bookmarkId: id,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        }),

      removeTree: (id: string) =>
        Effect.async<void, BookmarkOperationError>((resume) => {
          chrome.bookmarks.removeTree(id, () => {
            if (chrome.runtime.lastError) {
              resume(
                Effect.fail(
                  new BookmarkOperationError({
                    operation: "removeTree",
                    reason: chrome.runtime.lastError.message ||
                      "Unknown error",
                    bookmarkId: id,
                  }),
                ),
              )
            } else {
              resume(Effect.succeed(undefined))
            }
          })
        }),
    },

    // ========================================================================
    // Storage API
    // ========================================================================
    storage: {
      local: {
        get: (keys?: string | string[]) =>
          Effect.async<Record<string, unknown>, never>((resume) => {
            chrome.storage.local.get(keys, (result) => {
              // Never fail - return empty object on error
              if (chrome.runtime.lastError) {
                resume(Effect.succeed({}))
              } else {
                resume(Effect.succeed(result))
              }
            })
          }),

        set: (items: Record<string, unknown>) =>
          Effect.async<void, StorageError>((resume) => {
            chrome.storage.local.set(items, () => {
              if (chrome.runtime.lastError) {
                resume(
                  Effect.fail(
                    new StorageError({
                      operation: "set",
                      reason: chrome.runtime.lastError.message ||
                        "Unknown error",
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(undefined))
              }
            })
          }),

        remove: (keys: string | string[]) =>
          Effect.async<void, StorageError>((resume) => {
            chrome.storage.local.remove(keys, () => {
              if (chrome.runtime.lastError) {
                resume(
                  Effect.fail(
                    new StorageError({
                      operation: "remove",
                      reason: chrome.runtime.lastError.message ||
                        "Unknown error",
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(undefined))
              }
            })
          }),

        clear: () =>
          Effect.async<void, StorageError>((resume) => {
            chrome.storage.local.clear(() => {
              if (chrome.runtime.lastError) {
                resume(
                  Effect.fail(
                    new StorageError({
                      operation: "clear",
                      reason: chrome.runtime.lastError.message ||
                        "Unknown error",
                    }),
                  ),
                )
              } else {
                resume(Effect.succeed(undefined))
              }
            })
          }),
      },
    },

    // ========================================================================
    // Runtime API
    // ========================================================================
    runtime: {
      getId: () => chrome.runtime.id,
    },

    // ========================================================================
    // Event Subscriptions
    // ========================================================================
    events: {
      // --- Tab Events ---
      onTabCreated: (callback: (tab: chrome.tabs.Tab) => void) => {
        chrome.tabs.onCreated.addListener(callback)
        return () => chrome.tabs.onCreated.removeListener(callback)
      },

      onTabUpdated: (
        callback: (
          tabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => void,
      ) => {
        chrome.tabs.onUpdated.addListener(callback)
        return () => chrome.tabs.onUpdated.removeListener(callback)
      },

      onTabRemoved: (
        callback: (
          tabId: number,
          removeInfo: chrome.tabs.TabRemoveInfo,
        ) => void,
      ) => {
        chrome.tabs.onRemoved.addListener(callback)
        return () => chrome.tabs.onRemoved.removeListener(callback)
      },

      onTabMoved: (
        callback: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void,
      ) => {
        chrome.tabs.onMoved.addListener(callback)
        return () => chrome.tabs.onMoved.removeListener(callback)
      },

      onTabAttached: (
        callback: (
          tabId: number,
          attachInfo: chrome.tabs.TabAttachInfo,
        ) => void,
      ) => {
        chrome.tabs.onAttached.addListener(callback)
        return () => chrome.tabs.onAttached.removeListener(callback)
      },

      onTabDetached: (
        callback: (
          tabId: number,
          detachInfo: chrome.tabs.TabDetachInfo,
        ) => void,
      ) => {
        chrome.tabs.onDetached.addListener(callback)
        return () => chrome.tabs.onDetached.removeListener(callback)
      },

      onTabActivated: (
        callback: (activeInfo: chrome.tabs.TabActiveInfo) => void,
      ) => {
        chrome.tabs.onActivated.addListener(callback)
        return () => chrome.tabs.onActivated.removeListener(callback)
      },

      // --- Tab Group Events ---
      onTabGroupCreated: (
        callback: (group: chrome.tabGroups.TabGroup) => void,
      ) => {
        chrome.tabGroups.onCreated.addListener(callback)
        return () => chrome.tabGroups.onCreated.removeListener(callback)
      },

      onTabGroupUpdated: (
        callback: (group: chrome.tabGroups.TabGroup) => void,
      ) => {
        chrome.tabGroups.onUpdated.addListener(callback)
        return () => chrome.tabGroups.onUpdated.removeListener(callback)
      },

      onTabGroupRemoved: (
        callback: (group: chrome.tabGroups.TabGroup) => void,
      ) => {
        chrome.tabGroups.onRemoved.addListener(callback)
        return () => chrome.tabGroups.onRemoved.removeListener(callback)
      },

      // --- Window Events ---
      onWindowCreated: (callback: (window: chrome.windows.Window) => void) => {
        chrome.windows.onCreated.addListener(callback)
        return () => chrome.windows.onCreated.removeListener(callback)
      },

      onWindowRemoved: (callback: (windowId: number) => void) => {
        chrome.windows.onRemoved.addListener(callback)
        return () => chrome.windows.onRemoved.removeListener(callback)
      },

      onWindowFocusChanged: (callback: (windowId: number) => void) => {
        chrome.windows.onFocusChanged.addListener(callback)
        return () => chrome.windows.onFocusChanged.removeListener(callback)
      },

      // --- Bookmark Events ---
      onBookmarkCreated: (
        callback: (
          id: string,
          bookmark: chrome.bookmarks.BookmarkTreeNode,
        ) => void,
      ) => {
        chrome.bookmarks.onCreated.addListener(callback)
        return () => chrome.bookmarks.onCreated.removeListener(callback)
      },

      onBookmarkRemoved: (
        callback: (
          id: string,
          removeInfo: chrome.bookmarks.BookmarkRemoveInfo,
        ) => void,
      ) => {
        chrome.bookmarks.onRemoved.addListener(callback)
        return () => chrome.bookmarks.onRemoved.removeListener(callback)
      },

      onBookmarkChanged: (
        callback: (
          id: string,
          changeInfo: chrome.bookmarks.BookmarkChangeInfo,
        ) => void,
      ) => {
        chrome.bookmarks.onChanged.addListener(callback)
        return () => chrome.bookmarks.onChanged.removeListener(callback)
      },

      // --- Storage Events ---
      onStorageChanged: (
        callback: (
          changes: Record<string, chrome.storage.StorageChange>,
        ) => void,
      ) => {
        chrome.storage.onChanged.addListener(callback)
        return () => chrome.storage.onChanged.removeListener(callback)
      },
    },
  } satisfies BrowserApiService
})

// ============================================================================
// Layer Export
// ============================================================================

/**
 * ChromeApiServiceLive
 *
 * Layer that provides BrowserApiService using Chrome Extension APIs.
 *
 * Usage in other services:
 * ```typescript
 * export const MyServiceLive = Layer.effect(MyService, make).pipe(
 *   Layer.provide(ChromeApiServiceLive)
 * )
 * ```
 *
 * Usage in tests (with mock):
 * ```typescript
 * const MockBrowserApiServiceLive = Layer.succeed(
 *   BrowserApiService,
 *   mockBrowserApi
 * )
 *
 * const result = Effect.runSync(
 *   program.pipe(
 *     Effect.provide(MyServiceLive),
 *     Effect.provide(MockBrowserApiServiceLive)  // Mock instead of real
 *   )
 * )
 * ```
 */
export const ChromeApiServiceLive = Layer.effect(BrowserApiService, make)
