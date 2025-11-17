import type { Tab, TabGroup, Window } from "../services/state-service/types.ts"
import type { DragData } from "./types.ts"
import { TabItem } from "./TabItem.tsx"
import { PinnedTabs } from "./PinnedTabs.tsx"
import { GroupedTabs } from "./GroupedTabs.tsx"

export interface WindowSectionProps {
  window: Window
  tabs: Tab[]
  tabGroups: TabGroup[]
  currentWindowId?: number
  currentWindowTabGroups?: TabGroup[]
  linkedWorkspaceName?: string
  onLinkWorkspace: (windowId: number) => void
  onDragStart: (tab: Tab) => void
  onDropOnGroup: (groupId: number) => void
  onDropOnWindow: (windowId: number) => void
  draggedTab: DragData | null
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function WindowSection({
  window,
  tabs,
  tabGroups,
  currentWindowId,
  currentWindowTabGroups,
  linkedWorkspaceName,
  onLinkWorkspace,
  onDragStart,
  onDropOnGroup,
  onDropOnWindow,
  draggedTab,
  collapsed,
  onToggleCollapsed,
}: WindowSectionProps) {
  const pinnedTabs = tabs.filter((tab) => tab.pinned)
  const unpinnedTabs = tabs.filter((tab) => !tab.pinned)

  // Create a map of tab groups for quick lookup
  const tabGroupMap = new Map<number, TabGroup>()
  tabGroups.forEach((group) => tabGroupMap.set(group.id, group))

  // Build ordered items (tabs and tab groups)
  const items: Array<
    { type: "tab"; tab: Tab } | { type: "group"; group: TabGroup; tabs: Tab[] }
  > = []
  const renderedGroups = new Set<number>()

  unpinnedTabs.forEach((tab) => {
    if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
      // This is the first tab of a group, render the entire group
      const group = tabGroupMap.get(tab.groupId)
      if (group) {
        const groupTabs = unpinnedTabs.filter((t) => t.groupId === tab.groupId)
        items.push({ type: "group", group, tabs: groupTabs })
        renderedGroups.add(tab.groupId)
      }
    } else if (tab.groupId === undefined) {
      // This is an ungrouped tab
      items.push({ type: "tab", tab })
    }
  })

  return (
    <div class="mb-4">
      <div
        class="flex items-center justify-between mb-2 px-3 py-2 bg-gray-200 rounded cursor-pointer hover:bg-gray-300 transition-colors"
        onClick={onToggleCollapsed}
      >
        <div class="font-bold">
          {collapsed !== undefined && (
            <span class="mr-2">{collapsed ? "▶" : "▼"}</span>
          )}
          Window {window.id} ({tabs.length} tabs)
        </div>
        <div class="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {linkedWorkspaceName ? (
            <span class="text-xs bg-green-500 text-white px-2 py-0.5 rounded">
              {linkedWorkspaceName}
            </span>
          ) : (
            window.id && (
              <button
                type="button"
                class="px-2 py-0.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={() => onLinkWorkspace(window.id!)}
              >
                Link to Workspace
              </button>
            )
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          class="px-2 min-h-[100px]"
          onDragOver={(e) => {
            e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (window.id) {
              onDropOnWindow(window.id)
            }
          }}
        >
          <PinnedTabs
            tabs={pinnedTabs}
            currentWindowId={currentWindowId}
            currentWindowTabGroups={currentWindowTabGroups}
            onDragStart={onDragStart}
            draggedTab={draggedTab}
          />
          {items.map((item, index) => {
            if (item.type === "tab") {
              return (
                <div key={`tab-${item.tab.id}-${index}`} class="mb-3">
                  <TabItem
                    tab={item.tab}
                    currentWindowId={currentWindowId}
                    allTabGroups={currentWindowTabGroups}
                    onDragStart={onDragStart}
                    isDragging={draggedTab?.tabId === item.tab.id}
                  />
                </div>
              )
            } else {
              return (
                <GroupedTabs
                  key={`group-${item.group.id}`}
                  group={item.group}
                  tabs={item.tabs}
                  currentWindowId={currentWindowId}
                  currentWindowTabGroups={currentWindowTabGroups}
                  onDragStart={onDragStart}
                  onDropOnGroup={onDropOnGroup}
                  draggedTab={draggedTab}
                />
              )
            }
          })}
        </div>
      )}
    </div>
  )
}
