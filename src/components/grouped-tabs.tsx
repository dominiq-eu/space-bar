import { Effect, Option } from "effect"
import {
  BrowserApiService,
  ChromeApiServiceLive,
} from "../services/browser-api-service/index.ts"
import type { Tab, TabGroup, TabId } from "../services/state-service/types.ts"
import type { DragData } from "./types.ts"
import { TabItem } from "./tab-item.tsx"

import { colorMap } from "../services/tabs-service/index.ts"

// Helper to get BrowserApiService instance
const getBrowserApi = () => {
  const program = Effect.gen(function* () {
    return yield* BrowserApiService
  })
  return Effect.runSync(program.pipe(Effect.provide(ChromeApiServiceLive)))
}

export interface GroupedTabsProps {
  group: TabGroup
  tabs: Tab[]
  currentWindowId?: number
  currentWindowTabGroups?: TabGroup[]
  onDragStart: (tab: Tab) => void
  onDropOnGroup: (groupId: number) => void
  draggedTab: DragData | null
}

// Helper function to convert hex to rgba
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
    const browserApi = getBrowserApi()
    Effect.runPromise(
      browserApi.tabGroups.update(group.id, { collapsed: !group.collapsed }),
    )
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
    const tabIds: TabId[] = tabs.map((tab) => tab.id)
    if (tabIds.length > 0) {
      const browserApi = getBrowserApi()
      Effect.runPromise(browserApi.tabs.remove(tabIds))
    }
  }

  const groupColor = colorMap[group.color] || "#5f6368"
  const backgroundColor = hexToRgba(groupColor, 0.1)
  const borderColor = groupColor

  return (
    <div
      class="mb-3 rounded px-2 py-2"
      style={{
        backgroundColor: backgroundColor,
        border: `1px solid ${borderColor}`,
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        class="group font-bold mb-1 cursor-pointer hover:opacity-70 transition-opacity flex items-center justify-between"
        style={{
          color: groupColor,
        }}
      >
        <div onClick={handleToggle} class="flex-1">
          {group.collapsed ? "▶ " : "▼ "}
          {Option.getOrElse(group.title, () => "Unnamed Group")} ({tabs.length})
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
          <div key={tab.id}>
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
