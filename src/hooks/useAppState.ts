import { useEffect, useState } from "preact/hooks"
import { Effect, Option } from "effect"
import {
  BrowserApiService,
  ChromeApiServiceLive,
} from "../services/browser-api-service/index.ts"
import type { AppState, WindowId } from "../services/state-service/types.ts"
import { createAppState } from "../services/state-service/index.ts"
import {
  STORAGE_KEY_WINDOW_WORKSPACE_MAP,
  unlinkWindow,
} from "../services/storage-service/index.ts"

// Helper to get BrowserApiService instance
const getBrowserApi = () => {
  const program = Effect.gen(function* () {
    return yield* BrowserApiService
  })
  return Effect.runSync(program.pipe(Effect.provide(ChromeApiServiceLive)))
}

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null)

  const loadState = () => {
    Effect.runPromise(createAppState()).then(setState)
  }

  // Debounced version for heavy updates
  const loadStateDebounced = (() => {
    let timeoutId: number | null = null
    const debounce = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        loadState()
        timeoutId = null
      }, 100)
    }
    debounce.cancel = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }
    return debounce
  })()

  useEffect(() => {
    loadState()

    const browserApi = getBrowserApi()

    // --- Incremental Update Handlers ---

    const onTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      _tab: chrome.tabs.Tab,
    ) => {
      // If URL changed, we need to reload to potentially resolve new bookmark title
      if (changeInfo.url) {
        loadStateDebounced()
        return
      }

      // For other changes (status, title, favicon), update locally
      setState((prev) => {
        if (!prev) return null
        const updatedTabs = prev.tabs.map((t) => {
          if (t.id === tabId) {
            // Merge changes. Note: domain Tab has different structure than chrome.tabs.Tab
            // We need to be careful. Ideally we map the chrome tab to domain tab again.
            // But for simple props like status/title/favIconUrl, we can just patch.
            // Update favIconUrl if it changed
            let newFavIconUrl = t.favIconUrl
            if (changeInfo.favIconUrl !== undefined) {
              try {
                newFavIconUrl = Option.some(new URL(changeInfo.favIconUrl))
              } catch {
                newFavIconUrl = Option.none()
              }
            }

            return {
              ...t,
              title: changeInfo.title || t.title,
              favIconUrl: newFavIconUrl,
            }
          }
          return t
        })
        return { ...prev, tabs: updatedTabs }
      })

      // If title changed, we reload to be safe about bookmark titles
      if (changeInfo.title) {
        loadStateDebounced()
      }
    }

    const onTabRemoved = (tabId: number) => {
      setState((prev) => {
        if (!prev) return null
        return {
          ...prev,
          tabs: prev.tabs.filter((t) => t.id !== tabId),
        }
      })
    }

    const onWindowFocusChanged = (windowId: number) => {
      setState((prev) => {
        if (!prev) return null
        const updatedWindows = prev.windows.map((w) => ({
          ...w,
          focused: w.id === windowId,
        }))
        return { ...prev, windows: updatedWindows }
      })
    }

    // --- Full Reload Handlers (for now) ---
    const onTabCreated = () => loadStateDebounced()
    const onTabMoved = () => loadStateDebounced()
    const onTabAttached = () => loadStateDebounced()
    const onTabDetached = () => loadStateDebounced()

    const onTabGroupUpdated = () => loadStateDebounced()
    const onTabGroupCreated = () => loadStateDebounced()
    const onTabGroupRemoved = () => loadStateDebounced()

    const onWindowCreated = () => loadStateDebounced()
    const onWindowRemoved = (windowId: number) => {
      loadStateDebounced()
      Effect.runPromise(unlinkWindow(windowId as WindowId))
    }

    const onBookmarksChanged = () => loadStateDebounced()

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
        loadStateDebounced()
      }
    }

    // Register Listeners using BrowserApiService
    const cleanupTabUpdated = browserApi.events.onTabUpdated(onTabUpdated)
    const cleanupTabCreated = browserApi.events.onTabCreated(onTabCreated)
    const cleanupTabRemoved = browserApi.events.onTabRemoved(onTabRemoved)
    const cleanupTabMoved = browserApi.events.onTabMoved(onTabMoved)
    const cleanupTabAttached = browserApi.events.onTabAttached(onTabAttached)
    const cleanupTabDetached = browserApi.events.onTabDetached(onTabDetached)

    const cleanupTabGroupUpdated = browserApi.events.onTabGroupUpdated(
      onTabGroupUpdated,
    )
    const cleanupTabGroupCreated = browserApi.events.onTabGroupCreated(
      onTabGroupCreated,
    )
    const cleanupTabGroupRemoved = browserApi.events.onTabGroupRemoved(
      onTabGroupRemoved,
    )

    const cleanupWindowCreated = browserApi.events.onWindowCreated(
      onWindowCreated,
    )
    const cleanupWindowRemoved = browserApi.events.onWindowRemoved(
      onWindowRemoved,
    )
    const cleanupWindowFocusChanged = browserApi.events.onWindowFocusChanged(
      onWindowFocusChanged,
    )

    const cleanupBookmarkCreated = browserApi.events.onBookmarkCreated(
      onBookmarksChanged,
    )
    const cleanupBookmarkRemoved = browserApi.events.onBookmarkRemoved(
      onBookmarksChanged,
    )
    const cleanupBookmarkChanged = browserApi.events.onBookmarkChanged(
      onBookmarksChanged,
    )

    const cleanupStorageChanged = browserApi.events.onStorageChanged(
      onStorageChanged,
    )

    return () => {
      loadStateDebounced.cancel()
      cleanupTabUpdated()
      cleanupTabCreated()
      cleanupTabRemoved()
      cleanupTabMoved()
      cleanupTabAttached()
      cleanupTabDetached()
      cleanupTabGroupUpdated()
      cleanupTabGroupCreated()
      cleanupTabGroupRemoved()
      cleanupWindowCreated()
      cleanupWindowRemoved()
      cleanupWindowFocusChanged()
      cleanupBookmarkCreated()
      cleanupBookmarkRemoved()
      cleanupBookmarkChanged()
      cleanupStorageChanged()
    }
  }, [])

  return { state, loadState }
}
