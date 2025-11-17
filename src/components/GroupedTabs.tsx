import type { Tab, TabGroup } from "../services/state-service/types.ts"
import type { DragData } from "./types.ts"
import { TabItem } from "./TabItem.tsx"
import { colorMap } from "../services/tabs-service/index.ts"

export interface GroupedTabsProps {
  group: TabGroup
  tabs: Tab[]
  currentWindowId?: number
  currentWindowTabGroups?: TabGroup[]
  onDragStart: (tab: Tab) => void
  onDropOnGroup: (groupId: number) => void
  draggedTab: DragData | null
}

export function GroupedTabs({
  group,
  tabs,
  currentWindowId,
  currentWindowTabGroups,
  onDragStart,
  onDropOnGroup,
  draggedTab,
}: GroupedTabsProps) {
  if (tabs.length === 0) return null

  const handleToggle = () => {
    chrome.tabGroups.update(group.id, { collapsed: !group.collapsed })
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDropOnGroup(group.id)
  }

  const handleCloseGroup = (e: MouseEvent) => {
    e.stopPropagation()
    const tabIds = tabs
      .map((tab) => tab.id)
      .filter((id): id is number => id !== undefined)
    if (tabIds.length > 0) {
      chrome.tabs.remove(tabIds)
    }
  }

  return (
    <div class="mb-3">
      <div
        class="group font-bold mb-1 cursor-pointer hover:opacity-70 transition-opacity rounded px-2 py-1 flex items-center justify-between"
        style={{
          color: colorMap[group.color] || "#000",
          backgroundColor: draggedTab ? "rgba(0,0,0,0.05)" : "transparent",
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div onClick={handleToggle} class="flex-1">
          {group.collapsed ? "▶ " : "▼ "}
          {group.title || "Unnamed Group"} ({tabs.length})
        </div>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:bg-gray-300 rounded px-1 transition-opacity"
          onClick={handleCloseGroup}
        >
          ×
        </button>
      </div>
      {!group.collapsed &&
        tabs.map((tab) => (
          <div key={tab.id} class="pl-4">
            <TabItem
              tab={tab}
              currentWindowId={currentWindowId}
              tabGroup={group}
              allTabGroups={currentWindowTabGroups}
              onDragStart={onDragStart}
              isDragging={draggedTab?.tabId === tab.id}
            />
          </div>
        ))}
    </div>
  )
}
