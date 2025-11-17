import type { Tab, TabGroup } from "../services/state-service/types.ts"
import { VALID_GROUP_COLORS } from "../services/workspaces-service/metadata-parser.ts"

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
  const handleClick = () => {
    if (!tab.id) return

    // If tab is in a different window, open URL in new tab in current window
    if (currentWindowId && tab.windowId !== currentWindowId && tab.url) {
      chrome.tabs.create(
        {
          windowId: currentWindowId,
          url: tab.url,
          active: true,
        },
        (newTab) => {
          // If the original tab was in a group, add the new tab to a matching group
          if (tabGroup && newTab.id) {
            // Find existing group with same name and color in current window
            const matchingGroup = allTabGroups?.find(
              (g) => g.title === tabGroup.title && g.color === tabGroup.color,
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
                const groupColor = VALID_GROUP_COLORS.includes(tabGroup.color as any)
                  ? tabGroup.color
                  : "grey"

                chrome.tabGroups.update(groupId, {
                  title: tabGroup.title,
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

  const getFaviconUrl = () => {
    if (tab.favIconUrl) {
      return tab.favIconUrl
    }

    // Use Chrome Extension favicon API for URLs without favicons
    if (tab.url) {
      // Normalize any browser-specific scheme to chrome:// (helium://, edge://, brave://, etc.)
      // Keep standard web protocols (http, https, file, data, ftp) unchanged
      const normalizedUrl = tab.url.replace(
        /^([a-z]+):\/\//,
        (match, scheme) => {
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
    <div
      draggable={!!tab.id}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      class={`group font-mono text-xs overflow-hidden flex items-center gap-2 cursor-pointer hover:bg-gray-200 px-1 py-0.5 rounded transition-colors ${isDragging ? "opacity-50" : ""}`}
      onClick={handleClick}
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">
        {tab.active && <span>🔸</span>}
        {faviconUrl ? (
          <img src={faviconUrl} alt="" class="w-4 h-4 flex-shrink-0" />
        ) : (
          <span class="w-4 h-4 flex-shrink-0 text-center">📄</span>
        )}
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
  )
}
