import { useState } from "preact/hooks"
import type { Tab, TabGroup, Window } from "../services/state-service/types.ts"
import { WindowSection } from "./WindowSection.tsx"
import { useDragDropService } from "../hooks/useDragDropService.ts"
import { useSyncService } from "../hooks/useSyncService.ts"
import { DragData } from "./types.ts"
import { isSome } from "../utils/type-conversions.ts"

interface WindowListProps {
  windows: readonly Window[]
  tabsByWindow: Map<number, Tab[]>
  tabGroupsByWindow: Map<number, TabGroup[]>
  currentWindowId: number | null
  workspaceNames: Record<string, string>
  onLinkWorkspace: (windowId: number) => void
}

export function WindowList({
  windows,
  tabsByWindow,
  tabGroupsByWindow,
  currentWindowId,
  workspaceNames,
  onLinkWorkspace,
}: WindowListProps) {
  const [collapsedWindows, setCollapsedWindows] = useState<Set<number>>(
    new Set(),
  )
  const {
    dragState,
    startDrag,
    handleDropOnGroup,
    handleDropOnWindow,
  } = useDragDropService()
  const { windowWorkspaceMap } = useSyncService()

  const handleDragStart = (tab: Tab) => {
    startDrag("tab", tab)
  }

  const draggedTabData: DragData | null = dragState.isDragging &&
      dragState.dragType === "tab" &&
      dragState.draggedItem &&
      "windowId" in dragState.draggedItem // Check if it is a Tab
    ? {
      type: "tab",
      tabId: dragState.draggedItem.id,
      windowId: dragState.draggedItem.windowId,
      groupId: isSome(dragState.draggedItem.groupId)
        ? dragState.draggedItem.groupId.value
        : undefined,
    }
    : null

  // Sort windows: current window first, then others
  const sortedWindows = [...windows].sort((a, b) => {
    if (a.id === currentWindowId) return -1
    if (b.id === currentWindowId) return 1
    return 0
  })

  const currentWindow = sortedWindows[0]
  const otherWindows = sortedWindows.slice(1)

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
    <div class="pb-16">
      {currentWindow && (
        <WindowSection
          key={currentWindow.id}
          window={currentWindow}
          tabs={tabsByWindow.get(currentWindow.id!) || []}
          tabGroups={tabGroupsByWindow.get(currentWindow.id!) || []}
          currentWindowId={currentWindowId || undefined}
          currentWindowTabGroups={(currentWindowId
            ? tabGroupsByWindow.get(currentWindowId)
            : []) || []}
          linkedWorkspaceName={currentWindow.id &&
              windowWorkspaceMap[currentWindow.id]
            ? workspaceNames[windowWorkspaceMap[currentWindow.id]]
            : undefined}
          onLinkWorkspace={onLinkWorkspace}
          onDragStart={handleDragStart}
          onDropOnGroup={handleDropOnGroup}
          onDropOnWindow={handleDropOnWindow}
          draggedTab={draggedTabData}
          isCurrentWindow
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
              currentWindowTabGroups={(currentWindowId
                ? tabGroupsByWindow.get(currentWindowId)
                : []) || []}
              linkedWorkspaceName={window.id && windowWorkspaceMap[window.id]
                ? workspaceNames[windowWorkspaceMap[window.id]]
                : undefined}
              onLinkWorkspace={onLinkWorkspace}
              onDragStart={handleDragStart}
              onDropOnGroup={handleDropOnGroup}
              onDropOnWindow={handleDropOnWindow}
              draggedTab={draggedTabData}
              collapsed={collapsedWindows.has(window.id!)}
              onToggleCollapsed={() =>
                window.id && handleToggleWindow(window.id)}
            />
          ))}
        </>
      )}
    </div>
  )
}
