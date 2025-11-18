import { useEffect, useState } from "preact/hooks"
import { Effect, Option } from "effect"
import type {
  Tab,
  TabGroup,
  WindowId,
} from "../services/state-service/types.ts"
import { VALID_GROUP_COLORS } from "../services/workspaces-service/metadata-parser.ts"
import { renameTabBookmark } from "../services/workspaces-service/index.ts"
import {
  optionalUrlToString,
  optionToUndefined,
  urlToString,
} from "../utils/type-conversions.ts"

export interface TabItemProps {
  tab: Tab
  currentWindowId?: number
  tabGroup?: TabGroup
  allTabGroups?: TabGroup[]
  onDragStart?: (tab: Tab) => void
  onDragOver?: (e: DragEvent) => void
  onDrop?: (tab: Tab) => void
  isDragging?: boolean
}

export function TabItem({
  tab,
  currentWindowId,
  tabGroup,
  allTabGroups,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: TabItemProps) {
  const [contextMenu, setContextMenu] = useState<
    {
      x: number
      y: number
    } | null
  >(null)
  const [renameDialog, setRenameDialog] = useState<
    {
      currentTitle: string
    } | null
  >(null)
  const [newTitle, setNewTitle] = useState("")

  // Close context menu on outside click
  useEffect(() => {
    if (contextMenu) {
      const handleClickOutside = () => setContextMenu(null)
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [contextMenu])

  // Focus input when rename dialog opens
  useEffect(() => {
    if (renameDialog) {
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="New tab name..."]',
        )
        if (input) {
          input.focus()
          input.select()
        }
      }, 0)
    }
  }, [renameDialog])

  const handleClick = () => {
    if (!tab.id) return

    // If tab is in a different window, open URL in new tab in current window
    if (currentWindowId && tab.windowId !== currentWindowId && tab.url) {
      chrome.tabs.create(
        {
          windowId: currentWindowId,
          url: urlToString(tab.url),
          active: true,
        },
        (newTab) => {
          // If the original tab was in a group, add the new tab to a matching group
          if (tabGroup && newTab.id) {
            // Find existing group with same name and color in current window
            const matchingGroup = allTabGroups?.find(
              (g) =>
                Option.getOrElse(g.title, () => "") ===
                  Option.getOrElse(tabGroup.title, () => "") &&
                g.color === tabGroup.color,
            )

            if (matchingGroup) {
              // Add to existing group
              chrome.tabs.group({
                tabIds: [newTab.id],
                groupId: matchingGroup.id,
              })
            } else {
              // Create new group with same properties
              chrome.tabs.group({ tabIds: [newTab.id] }, (groupId) => {
                const groupColor =
                  VALID_GROUP_COLORS.includes(tabGroup.color as any)
                    ? tabGroup.color
                    : "grey"

                chrome.tabGroups.update(groupId, {
                  title: optionToUndefined(tabGroup.title),
                  color: groupColor as chrome.tabGroups.ColorEnum,
                  collapsed: tabGroup.collapsed,
                })
              })
            }
          }
        },
      )
    } else {
      chrome.tabs.update(tab.id, { active: true })
    }
  }

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation()
    if (tab.id) {
      chrome.tabs.remove(tab.id)
    }
  }

  const handleDragStart = (e: DragEvent) => {
    e.stopPropagation()
    if (onDragStart) {
      onDragStart(tab)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onDragOver) {
      onDragOver(e)
    }
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onDrop) {
      onDrop(tab)
    }
  }

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Estimate context menu height and width
    const menuHeight = 120 // 3 buttons now (Rename, Pin/Unpin, Close)
    const menuWidth = 150

    // Calculate position
    let x = e.clientX
    let y = e.clientY

    // Check vertical overflow
    if (y + menuHeight > window.innerHeight) {
      y = e.clientY - menuHeight
    }

    // Check horizontal overflow
    if (x + menuWidth > window.innerWidth) {
      x = e.clientX - menuWidth
    }

    setContextMenu({ x, y })
  }

  const handleRename = () => {
    setRenameDialog({ currentTitle: tab.title })
    setNewTitle(tab.title)
    setContextMenu(null)
  }

  const handleConfirmRename = () => {
    if (!newTitle.trim() || !currentWindowId) return

    const tabUrl = urlToString(tab.url)

    Effect.runPromise(
      renameTabBookmark(
        currentWindowId as WindowId,
        tabUrl,
        newTitle.trim(),
        tab.pinned,
      ),
    )
      .then(() => {
        setRenameDialog(null)
        setNewTitle("")
      })
      .catch((error) => {
        console.error("Failed to rename tab:", error)
        alert(`Failed to rename: ${error.message}`)
      })
  }

  const handleCloseFromMenu = () => {
    if (tab.id) {
      chrome.tabs.remove(tab.id)
    }
    setContextMenu(null)
  }

  const handleTogglePin = () => {
    if (tab.id) {
      chrome.tabs.update(tab.id, { pinned: !tab.pinned })
    }
    setContextMenu(null)
  }

  const getFaviconUrl = (): string | null => {
    // Check if tab has a favIconUrl (Option<URL>)
    if (Option.isSome(tab.favIconUrl)) {
      return urlToString(tab.favIconUrl.value)
    }

    // Use Chrome Extension favicon API for URLs without favicons
    if (tab.url) {
      const urlString = urlToString(tab.url)

      // Normalize any browser-specific scheme to chrome:// (helium://, edge://, brave://, etc.)
      // Keep standard web protocols (http, https, file, data, ftp) unchanged
      const normalizedUrl = urlString.replace(
        /^([a-z]+):\/\//,
        (match: string, scheme: string) => {
          const standardSchemes = [
            "http",
            "https",
            "file",
            "data",
            "ftp",
            "chrome",
          ]
          return standardSchemes.includes(scheme) ? match : "chrome://"
        },
      )

      const extensionId = chrome.runtime.id
      const encodedUrl = encodeURIComponent(normalizedUrl)
      const size = 32
      return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodedUrl}&size=${size}`
    }

    return null
  }

  const faviconUrl = getFaviconUrl()

  return (
    <>
      <div
        draggable={!!tab.id}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
        class={`group font-mono text-xs overflow-hidden flex items-center gap-2 cursor-pointer hover:bg-gray-200 px-1 py-0.5 rounded transition-colors ${
          isDragging ? "opacity-50" : ""
        } ${tab.active ? "bg-gray-300 bg-opacity-50" : ""}`}
        onClick={handleClick}
      >
        <div class="flex items-center gap-2 flex-1 min-w-0">
          {faviconUrl
            ? <img src={faviconUrl} alt="" class="w-4 h-4 flex-shrink-0" />
            : <span class="w-4 h-4 flex-shrink-0 text-center">📄</span>}
          <span class="truncate">{tab.title || "Untitled"}</span>
        </div>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:bg-gray-300 rounded px-1 transition-opacity"
          onClick={handleClose}
        >
          ×
        </button>
      </div>

      {contextMenu && (
        <div
          class="fixed bg-white border border-gray-300 rounded shadow-lg z-50"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
            onClick={handleRename}
          >
            Rename
          </button>
          <button
            type="button"
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
            onClick={handleTogglePin}
          >
            {tab.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors text-red-600"
            onClick={handleCloseFromMenu}
          >
            Close
          </button>
        </div>
      )}

      {renameDialog && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full mx-4">
            <h3 class="font-bold mb-3 text-sm">Rename Tab</h3>
            <input
              type="text"
              placeholder="New tab name..."
              class="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-3"
              value={newTitle}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyPress={(e) => e.key === "Enter" && handleConfirmRename()}
              autoFocus
            />
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={handleConfirmRename}
              >
                Rename
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 transition-colors"
                onClick={() => {
                  setRenameDialog(null)
                  setNewTitle("")
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
