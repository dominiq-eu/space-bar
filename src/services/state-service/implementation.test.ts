/**
 * StateService Tests
 *
 * Tests for the StateService implementation using Deno's test framework
 * and Effect-TS testing patterns.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts"
import { Effect, Layer } from "effect"
import { StateService } from "./types.ts"
import { StateServiceTest } from "./implementation.ts"
import { WindowsServiceTest } from "../windows-service/index.ts"
import { StorageServiceTest } from "../storage-service/index.ts"
import { TabsServiceTest } from "../tabs-service/index.ts"
import type { BrowserApiService as BrowserApiServiceType } from "../browser-api-service/types.ts"
import {
  BrowserApiService,
  GroupNotFoundError,
  TabNotFoundError,
  WindowNotFoundError,
} from "../browser-api-service/index.ts"

// ============================================================================
// Mock BrowserApiService for Testing
// ============================================================================

/**
 * Creates a complete mock BrowserApiService for testing
 */
const createMockBrowserApiService = (
  mockTabs: chrome.tabs.Tab[] = [],
  mockTabGroups: chrome.tabGroups.TabGroup[] = [],
  mockWindows: chrome.windows.Window[] = [],
  mockStorage: Record<string, unknown> = {},
  mockBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [],
) => {
  const mockBrowserApi: BrowserApiServiceType = {
    tabs: {
      query: (_query) => Effect.succeed(mockTabs),
      get: (tabId) =>
        mockTabs.find((t) => t.id === tabId)
          ? Effect.succeed(mockTabs.find((t) => t.id === tabId)!)
          : Effect.fail(new TabNotFoundError({ tabId })),
      create: (_options) =>
        Effect.succeed(mockTabs[0] || { id: 1 } as chrome.tabs.Tab),
      update: (_tabId, _options) =>
        Effect.succeed(mockTabs[0] || { id: 1 } as chrome.tabs.Tab),
      remove: (_tabId) => Effect.succeed(undefined),
      move: (_tabId, _options) =>
        Effect.succeed(mockTabs[0] || { id: 1 } as chrome.tabs.Tab),
      group: (_options) => Effect.succeed(1),
      ungroup: (_tabIds) => Effect.succeed(undefined),
      discard: (_tabId) =>
        Effect.succeed(mockTabs[0] || { id: 1 } as chrome.tabs.Tab),
    },
    tabGroups: {
      query: (_query) => Effect.succeed(mockTabGroups),
      get: (groupId) =>
        mockTabGroups.find((g) => g.id === groupId)
          ? Effect.succeed(mockTabGroups.find((g) => g.id === groupId)!)
          : Effect.fail(new GroupNotFoundError({ groupId })),
      update: (_groupId, _options) =>
        Effect.succeed(
          mockTabGroups[0] || { id: 1 } as chrome.tabGroups.TabGroup,
        ),
      move: (_groupId, _options) =>
        Effect.succeed(
          mockTabGroups[0] || { id: 1 } as chrome.tabGroups.TabGroup,
        ),
    },
    windows: {
      getAll: (_options) => Effect.succeed(mockWindows),
      get: (windowId) =>
        mockWindows.find((w) => w.id === windowId)
          ? Effect.succeed(mockWindows.find((w) => w.id === windowId)!)
          : Effect.fail(new WindowNotFoundError({ windowId })),
      getCurrent: () =>
        Effect.succeed(mockWindows[0] || { id: 1 } as chrome.windows.Window),
      create: (_options) =>
        Effect.succeed(mockWindows[0] || { id: 1 } as chrome.windows.Window),
      update: (_windowId, _options) =>
        Effect.succeed(mockWindows[0] || { id: 1 } as chrome.windows.Window),
      remove: (_windowId) => Effect.succeed(undefined),
    },
    bookmarks: {
      getTree: () =>
        Effect.succeed(
          mockBookmarks.length > 0 ? mockBookmarks : [{
            id: "0",
            title: "Bookmarks Bar",
            children: [],
          }] as chrome.bookmarks.BookmarkTreeNode[],
        ),
      getSubTree: (_id) =>
        Effect.succeed([{
          id: _id,
          title: "Test Workspace",
          children: [],
        }] as chrome.bookmarks.BookmarkTreeNode[]),
      getChildren: (_id) =>
        Effect.succeed([] as chrome.bookmarks.BookmarkTreeNode[]),
      create: (_bookmark) =>
        Effect.succeed({
          id: "bookmark-1",
          title: _bookmark.title || "",
          url: _bookmark.url,
        } as chrome.bookmarks.BookmarkTreeNode),
      update: (_id, _changes) =>
        Effect.succeed({
          id: _id,
          title: _changes.title || "",
        } as chrome.bookmarks.BookmarkTreeNode),
      remove: (_id) => Effect.succeed(undefined),
      removeTree: (_id) => Effect.succeed(undefined),
      move: (_id, _destination) =>
        Effect.succeed({
          id: _id,
          title: "Moved",
        } as chrome.bookmarks.BookmarkTreeNode),
    },
    storage: {
      local: {
        get: (_keys) => Effect.succeed(mockStorage),
        set: (_items) => Effect.succeed(undefined),
        remove: (_keys) => Effect.succeed(undefined),
        clear: () => Effect.succeed(undefined),
      },
    },
    runtime: {
      getId: () => "test-extension-id",
    },
    events: {
      onTabCreated: (_listener) => () => {},
      onTabUpdated: (_listener) => () => {},
      onTabRemoved: (_listener) => () => {},
      onTabMoved: (_listener) => () => {},
      onTabAttached: (_listener) => () => {},
      onTabDetached: (_listener) => () => {},
      onTabActivated: (_listener) => () => {},
      onTabGroupCreated: (_listener) => () => {},
      onTabGroupUpdated: (_listener) => () => {},
      onTabGroupRemoved: (_listener) => () => {},
      onWindowCreated: (_listener) => () => {},
      onWindowRemoved: (_listener) => () => {},
      onWindowFocusChanged: (_listener) => () => {},
      onBookmarkCreated: (_listener) => () => {},
      onBookmarkRemoved: (_listener) => () => {},
      onBookmarkMoved: (_listener) => () => {},
      onBookmarkChanged: (_listener) => () => {},
      onStorageChanged: (_listener) => () => {},
    },
  }

  return Layer.succeed(BrowserApiService, mockBrowserApi)
}

// ============================================================================
// Test Cases
// ============================================================================

Deno.test("StateService - getCurrentTime returns current date", async () => {
  const mockBrowserApi = createMockBrowserApiService()
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.getCurrentTime
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertEquals(result instanceof Date, true)
})

Deno.test("StateService - createAppState returns AppState with empty data", async () => {
  const mockBrowserApi = createMockBrowserApiService()
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.createAppState
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertExists(result.timestamp)
  assertEquals(Array.isArray(result.tabs), true)
  assertEquals(Array.isArray(result.tabGroups), true)
  assertEquals(Array.isArray(result.windows), true)
})

Deno.test("StateService - createAppState with mock tabs", async () => {
  const mockTabs: chrome.tabs.Tab[] = [
    {
      id: 1,
      windowId: 1,
      index: 0,
      url: "https://example.com",
      title: "Example",
      active: true,
      pinned: false,
      highlighted: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
    },
  ]

  const mockWindows: chrome.windows.Window[] = [
    {
      id: 1,
      focused: true,
      alwaysOnTop: false,
      incognito: false,
      type: "normal",
      state: "normal",
      tabs: mockTabs,
    },
  ]

  const mockBrowserApi = createMockBrowserApiService(mockTabs, [], mockWindows)
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.createAppState
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertEquals(result.tabs.length, 1)
  assertEquals(result.windows.length, 1)
})

Deno.test("StateService - getTabs returns empty array", async () => {
  const mockBrowserApi = createMockBrowserApiService()
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.getTabs
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertEquals(Array.isArray(result), true)
  assertEquals(result.length, 0)
})

Deno.test("StateService - getTabGroups returns empty array", async () => {
  const mockBrowserApi = createMockBrowserApiService()
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.getTabGroups
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertEquals(Array.isArray(result), true)
  assertEquals(result.length, 0)
})

Deno.test("StateService - getWindows returns empty array", async () => {
  const mockBrowserApi = createMockBrowserApiService()
  // WindowsServiceTest, StorageServiceTest, and TabsServiceTest need BrowserApiService
  const windowsLayer = WindowsServiceTest.pipe(Layer.provide(mockBrowserApi))
  const storageLayer = StorageServiceTest.pipe(Layer.provide(mockBrowserApi))
  const tabsLayer = TabsServiceTest.pipe(Layer.provide(mockBrowserApi))
  // StateServiceTest needs WindowsService, StorageService, TabsService, and BrowserApiService
  const testLayer = StateServiceTest.pipe(
    Layer.provide(Layer.mergeAll(
      windowsLayer,
      storageLayer,
      tabsLayer,
      mockBrowserApi,
    )),
  )

  const program = Effect.gen(function* () {
    const stateService = yield* StateService
    return yield* stateService.getWindows
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(testLayer)),
  )

  assertExists(result)
  assertEquals(Array.isArray(result), true)
  assertEquals(result.length, 0)
})
