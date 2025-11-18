import { useState, useEffect } from "preact/hooks"
import { Effect, Option } from "effect"
import type { Tab, TabGroup, AppState, WindowId, WorkspaceId } from "../services/state-service/types.ts"
import type { DragData } from "./types.ts"
import { createAppState } from "../services/state-service/index.ts"
import {
  linkWindowToWorkspace,
  unlinkWindow,
  getWorkspaceForWindow,
  cleanupWindowWorkspaceMap,
  STORAGE_KEY_WINDOW_WORKSPACE_MAP,
} from "../services/storage-service/index.ts"
import {
  syncWorkspace,
  getBookmarksBar,
  getIsLoadingWorkspace,
} from "../services/workspaces-service/index.ts"
import { WindowSection } from "./WindowSection.tsx"
import { LinkWorkspaceDialog } from "./LinkWorkspaceDialog.tsx"
import { WorkspaceBar } from "./WorkspaceBar.tsx"
import { optionToUndefined, optionContains, isSome } from "../utils/type-conversions.ts"

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [windowWorkspaceMap, setWindowWorkspaceMap] = useState<
    Record<number, string>
  >({})
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>(
    {},
  )
  const [showLinkDialog, setShowLinkDialog] = useState<number | null>(null)
  const [draggedTab, setDraggedTab] = useState<DragData | null>(null)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const [collapsedWindows, setCollapsedWindows] = useState<Set<number>>(
    new Set(),
  )

  const loadState = () => {
    Effect.runPromise(createAppState()).then((newState) => {
      setState(newState)
    })
  }

  // Debounced version to prevent too many updates
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

  const loadCurrentWindowId = () => {
    chrome.windows.getCurrent((window) => {
      if (window.id) {
        setCurrentWindowId(window.id)
      }
    })
  }

  const loadWindowWorkspaceMap = () => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      setWindowWorkspaceMap(result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {})
    })
  }

  const loadWorkspaceNames = () => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        const names: Record<string, string> = {}
        children
          .filter((child) => !child.url)
          .forEach((workspace) => {
            names[workspace.id] = workspace.title || "Unnamed Workspace"
          })
        setWorkspaceNames(names)
      })
    })
  }

  const handleLinkWorkspace = (windowId: number) => {
    setShowLinkDialog(windowId)
  }

  const handleConfirmLink = (windowId: number, workspaceId: string) => {
    Effect.runPromise(linkWindowToWorkspace(windowId as WindowId, workspaceId as WorkspaceId))
      .then(() => {
        loadWindowWorkspaceMap()
        setShowLinkDialog(null)
        // Trigger initial sync
        syncWorkspace(windowId, workspaceId).catch((error) => {
          console.error("Failed to sync workspace:", error)
        })
      })
      .catch((error) => {
        console.error("Failed to link workspace:", error)
      })
  }

  const handleDragStart = (tab: Tab) => {
    if (tab.id && tab.windowId !== undefined) {
      setDraggedTab({
        type: "tab",
        tabId: tab.id,
        windowId: tab.windowId,
        groupId: optionToUndefined(tab.groupId),
      })
    }
  }

  const handleDragEnd = () => {
    setDraggedTab(null)
  }

  const handleDropOnGroup = (targetGroupId: number) => {
    if (!draggedTab) return

    const { tabId, groupId } = draggedTab

    // If already in target group, do nothing
    if (groupId === targetGroupId) {
      handleDragEnd()
      return
    }

    // Add tab to group
    chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId }, () => {
      handleDragEnd()
      loadStateDebounced()
    })
  }

  const handleDropOnWindow = (targetWindowId: number) => {
    if (!draggedTab) return

    const { tabId, windowId } = draggedTab

    // If already in target window, ungroup if needed
    if (windowId === targetWindowId) {
      // Ungroup the tab
      chrome.tabs.ungroup([tabId], () => {
        handleDragEnd()
        loadStateDebounced()
      })
    } else {
      // Move to different window
      chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 }, () => {
        handleDragEnd()
        loadStateDebounced()
      })
    }
  }

  useEffect(() => {
    const handleGlobalDragEnd = () => {
      handleDragEnd()
    }

    document.addEventListener("dragend", handleGlobalDragEnd)
    return () => {
      document.removeEventListener("dragend", handleGlobalDragEnd)
    }
  }, [])

  // Initialize other windows as collapsed
  useEffect(() => {
    if (state && currentWindowId !== null) {
      const otherWindowIds = state.windows
        .map((w) => w.id)
        .filter((id) => id !== undefined && id !== currentWindowId) as number[]

      setCollapsedWindows(new Set(otherWindowIds))
    }
  }, [currentWindowId, state?.windows.length])

  const syncIfLinked = (tabId?: number, windowId?: number) => {
    // Skip sync if workspace is currently being loaded
    if (getIsLoadingWorkspace()) {
      return
    }

    const getWindowId = () => {
      if (windowId !== undefined) {
        return Promise.resolve(windowId)
      }
      if (tabId !== undefined) {
        return new Promise<number | undefined>((resolve) => {
          chrome.tabs.get(tabId, (tab) => {
            resolve(tab?.windowId)
          })
        })
      }
      return Promise.resolve(undefined)
    }

    getWindowId().then((wId) => {
      if (wId !== undefined) {
        Effect.runPromise(getWorkspaceForWindow(wId as WindowId)).then((workspaceIdOption) => {
          if (isSome(workspaceIdOption)) {
            const workspaceId = workspaceIdOption.value
            syncWorkspace(wId, workspaceId).catch(
              (error) => {
                console.error("Failed to sync workspace:", error)
              },
            )
          }
        })
      }
    })
  }

  useEffect(() => {
    // Cleanup window-workspace mappings for closed windows
    Effect.runPromise(cleanupWindowWorkspaceMap(getBookmarksBar)).catch((error) => {
      console.error("Failed to cleanup window-workspace map:", error)
    })

    // Initial load
    loadState()
    loadWindowWorkspaceMap()
    loadCurrentWindowId()
    loadWorkspaceNames()

    // Listen for storage changes to update workspace map
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
        loadWindowWorkspaceMap()
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged)

    // Listen for bookmark changes to update workspace names AND tab titles
    const onBookmarksChanged = () => {
      loadWorkspaceNames()
      // Reload state to update tab titles from bookmark titles
      loadStateDebounced()
    }
    chrome.bookmarks.onCreated.addListener(onBookmarksChanged)
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged)
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged)

    // Listen for tab updates (sync only on URL changes)
    const onTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      loadStateDebounced()
      // Sync workspace only if URL changed
      if (changeInfo.url) {
        syncIfLinked(_tabId, tab.windowId)
      }
    }
    const onTabCreated = (tab: chrome.tabs.Tab) => {
      loadStateDebounced()
      syncIfLinked(tab.id, tab.windowId)
    }
    const onTabRemoved = (
      _tabId: number,
      removeInfo: chrome.tabs.TabRemoveInfo,
    ) => {
      loadStateDebounced()
      syncIfLinked(undefined, removeInfo.windowId)
    }
    const onTabMoved = (_tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => {
      loadStateDebounced()
      syncIfLinked(_tabId, moveInfo.windowId)
    }
    const onTabAttached = (
      _tabId: number,
      attachInfo: chrome.tabs.TabAttachInfo,
    ) => {
      loadStateDebounced()
      syncIfLinked(_tabId, attachInfo.newWindowId)
    }
    const onTabDetached = (
      _tabId: number,
      detachInfo: chrome.tabs.TabDetachInfo,
    ) => {
      loadStateDebounced()
      syncIfLinked(undefined, detachInfo.oldWindowId)
    }

    chrome.tabs.onUpdated.addListener(onTabUpdated)
    chrome.tabs.onCreated.addListener(onTabCreated)
    chrome.tabs.onRemoved.addListener(onTabRemoved)
    chrome.tabs.onMoved.addListener(onTabMoved)
    chrome.tabs.onAttached.addListener(onTabAttached)
    chrome.tabs.onDetached.addListener(onTabDetached)

    // Listen for tab group updates
    const onTabGroupUpdated = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced()
      syncIfLinked(undefined, group.windowId)
    }
    const onTabGroupCreated = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced()
      syncIfLinked(undefined, group.windowId)
    }
    const onTabGroupRemoved = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced()
      syncIfLinked(undefined, group.windowId)
    }

    chrome.tabGroups.onUpdated.addListener(onTabGroupUpdated)
    chrome.tabGroups.onCreated.addListener(onTabGroupCreated)
    chrome.tabGroups.onRemoved.addListener(onTabGroupRemoved)

    // Listen for window updates
    const onWindowCreated = () => loadStateDebounced()
    const onWindowRemoved = (windowId: number) => {
      loadStateDebounced()
      Effect.runPromise(unlinkWindow(windowId as WindowId))
    }
    const onWindowFocusChanged = () => loadStateDebounced()

    chrome.windows.onCreated.addListener(onWindowCreated)
    chrome.windows.onRemoved.addListener(onWindowRemoved)
    chrome.windows.onFocusChanged.addListener(onWindowFocusChanged)

    // Cleanup listeners
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
      chrome.storage.onChanged.removeListener(onStorageChanged)
      chrome.bookmarks.onCreated.removeListener(onBookmarksChanged)
      chrome.bookmarks.onRemoved.removeListener(onBookmarksChanged)
      chrome.bookmarks.onChanged.removeListener(onBookmarksChanged)
    }
  }, [])

  if (!state) {
    return null
  }

  // Group tabs by window
  const tabsByWindow = new Map<number, Tab[]>()
  state.tabs.forEach((tab) => {
    const windowId = tab.windowId
    if (windowId !== undefined) {
      if (!tabsByWindow.has(windowId)) {
        tabsByWindow.set(windowId, [])
      }
      tabsByWindow.get(windowId)!.push(tab)
    }
  })

  // Group tab groups by window (based on tabs)
  const tabGroupsByWindow = new Map<number, TabGroup[]>()
  state.tabGroups.forEach((group) => {
    const groupTab = state.tabs.find((tab) => optionContains(tab.groupId, group.id))
    if (groupTab?.windowId !== undefined) {
      if (!tabGroupsByWindow.has(groupTab.windowId)) {
        tabGroupsByWindow.set(groupTab.windowId, [])
      }
      tabGroupsByWindow.get(groupTab.windowId)!.push(group)
    }
  })

  // Sort windows: current window (where sidepanel is open) first, then others
  const sortedWindows = [...state.windows].sort((a, b) => {
    if (a.id === currentWindowId) return -1
    if (b.id === currentWindowId) return 1
    return 0
  })

  const currentWindow = sortedWindows[0]
  const otherWindows = sortedWindows.slice(1)

  // Get tab groups for current window
  const currentWindowTabGroups = currentWindowId
    ? tabGroupsByWindow.get(currentWindowId) || []
    : []

  const handleToggleWindow = (windowId: number) => {
    setCollapsedWindows((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(windowId)) {
        newSet.delete(windowId)
      } else {
        newSet.add(windowId)
      }
      return newSet
    })
  }

  return (
    <>
      <div class="pb-16">
        {showLinkDialog !== null && (
          <LinkWorkspaceDialog
            windowId={showLinkDialog}
            onConfirm={handleConfirmLink}
            onCancel={() => setShowLinkDialog(null)}
          />
        )}
        {currentWindow && (
          <WindowSection
            key={currentWindow.id}
            window={currentWindow}
            tabs={tabsByWindow.get(currentWindow.id!) || []}
            tabGroups={tabGroupsByWindow.get(currentWindow.id!) || []}
            currentWindowId={currentWindowId || undefined}
            currentWindowTabGroups={currentWindowTabGroups}
            linkedWorkspaceName={
              currentWindow.id && windowWorkspaceMap[currentWindow.id]
                ? workspaceNames[windowWorkspaceMap[currentWindow.id]]
                : undefined
            }
            onLinkWorkspace={handleLinkWorkspace}
            onDragStart={handleDragStart}
            onDropOnGroup={handleDropOnGroup}
            onDropOnWindow={handleDropOnWindow}
            draggedTab={draggedTab}
            isCurrentWindow={true}
          />
        )}
        {otherWindows.length > 0 && (
          <>
            <div class="mt-6 mb-3 px-3 py-2 bg-gray-100 rounded">
              <h3 class="font-bold text-sm">Other Windows</h3>
            </div>
            {otherWindows.map((window) => (
              <WindowSection
                key={window.id}
                window={window}
                tabs={tabsByWindow.get(window.id!) || []}
                tabGroups={tabGroupsByWindow.get(window.id!) || []}
                currentWindowId={currentWindowId || undefined}
                currentWindowTabGroups={currentWindowTabGroups}
                linkedWorkspaceName={
                  window.id && windowWorkspaceMap[window.id]
                    ? workspaceNames[windowWorkspaceMap[window.id]]
                    : undefined
                }
                onLinkWorkspace={handleLinkWorkspace}
                onDragStart={handleDragStart}
                onDropOnGroup={handleDropOnGroup}
                onDropOnWindow={handleDropOnWindow}
                draggedTab={draggedTab}
                collapsed={collapsedWindows.has(window.id!)}
                onToggleCollapsed={() =>
                  window.id && handleToggleWindow(window.id)
                }
              />
            ))}
          </>
        )}
      </div>
      <WorkspaceBar
        currentWindowId={currentWindowId}
        linkedWorkspaceId={
          currentWindowId ? windowWorkspaceMap[currentWindowId] : undefined
        }
        state={state}
      />
    </>
  )
}
