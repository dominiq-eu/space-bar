import { useEffect, useState } from "preact/hooks"
import { Effect, Option } from "effect"
import type { AppState, WindowId } from "../services/state-service/types.ts"
import { createAppState } from "../services/state-service/index.ts"
import {
  STORAGE_KEY_WINDOW_WORKSPACE_MAP,
  unlinkWindow,
} from "../services/storage-service/index.ts"

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

    // Register Listeners
    chrome.tabs.onUpdated.addListener(onTabUpdated)
    chrome.tabs.onCreated.addListener(onTabCreated)
    chrome.tabs.onRemoved.addListener(onTabRemoved)
    chrome.tabs.onMoved.addListener(onTabMoved)
    chrome.tabs.onAttached.addListener(onTabAttached)
    chrome.tabs.onDetached.addListener(onTabDetached)

    chrome.tabGroups.onUpdated.addListener(onTabGroupUpdated)
    chrome.tabGroups.onCreated.addListener(onTabGroupCreated)
    chrome.tabGroups.onRemoved.addListener(onTabGroupRemoved)

    chrome.windows.onCreated.addListener(onWindowCreated)
    chrome.windows.onRemoved.addListener(onWindowRemoved)
    chrome.windows.onFocusChanged.addListener(onWindowFocusChanged)

    chrome.bookmarks.onCreated.addListener(onBookmarksChanged)
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged)
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged)

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
        loadStateDebounced()
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged)

    return () => {
      loadStateDebounced.cancel()
      chrome.tabs.onUpdated.removeListener(onTabUpdated)
      chrome.tabs.onCreated.removeListener(onTabCreated)
      chrome.tabs.onRemoved.removeListener(onTabRemoved)
      chrome.tabs.onMoved.removeListener(onTabMoved)
      chrome.tabs.onAttached.removeListener(onTabAttached)
      chrome.tabs.onDetached.removeListener(onTabDetached)
      chrome.tabGroups.onUpdated.removeListener(onTabGroupUpdated)
      chrome.tabGroups.onCreated.removeListener(onTabGroupCreated)
      chrome.tabGroups.onRemoved.removeListener(onTabGroupRemoved)
      chrome.windows.onCreated.removeListener(onWindowCreated)
      chrome.windows.onRemoved.removeListener(onWindowRemoved)
      chrome.windows.onFocusChanged.removeListener(onWindowFocusChanged)
      chrome.bookmarks.onCreated.removeListener(onBookmarksChanged)
      chrome.bookmarks.onRemoved.removeListener(onBookmarksChanged)
      chrome.bookmarks.onChanged.removeListener(onBookmarksChanged)
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  return { state, loadState }
}
