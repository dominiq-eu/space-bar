import type { Tab, TabGroup } from "../services/state-service/types.ts"
import type { DragData } from "./types.ts"
import { TabItem } from "./tab-item.tsx"

export interface PinnedTabsProps {
  tabs: Tab[]
  currentWindowId?: number
  currentWindowTabGroups?: TabGroup[]
  onDragStart: (tab: Tab) => void
  draggedTab: DragData | null
}

export function PinnedTabs({
  tabs,
  currentWindowId,
  currentWindowTabGroups,
  onDragStart,
  draggedTab,
}: PinnedTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div class="mb-3">
      <div class="font-bold mb-1">📌 Pinned Tabs ({tabs.length}):</div>
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          currentWindowId={currentWindowId}
          allTabGroups={currentWindowTabGroups}
          onDragStart={onDragStart}
          isDragging={draggedTab?.tabId === tab.id}
        />
      ))}
    </div>
  )
}
