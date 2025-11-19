import { useEffect, useState } from "preact/hooks"
import { Effect } from "effect"

import { getBookmarksBar } from "../services/workspaces-service/index.ts"
import { LinkWorkspaceDialog } from "./LinkWorkspaceDialog.tsx"
import { WorkspaceBar } from "./WorkspaceBar.tsx"
import { optionContains } from "../utils/type-conversions.ts"
import { WindowList } from "./WindowList.tsx"
import { useAppState } from "../hooks/useAppState.ts"
import { useSyncService } from "../hooks/useSyncService.ts"

function AppContent() {
  const { state } = useAppState()
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>(
    {},
  )
  const [showLinkDialog, setShowLinkDialog] = useState<number | null>(null)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const { linkWindow, windowWorkspaceMap } = useSyncService()

  const loadCurrentWindowId = () => {
    chrome.windows.getCurrent((window) => {
      if (window.id) {
        setCurrentWindowId(window.id)
      }
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

  const openLinkDialog = (windowId: number) => {
    setShowLinkDialog(windowId)
  }

  const handleConfirmLink = (windowId: number, workspaceId: string) => {
    linkWindow(windowId, workspaceId)
    setShowLinkDialog(null)
  }

  useEffect(() => {
    // Initial load
    loadCurrentWindowId()
    loadWorkspaceNames()

    // Listen for bookmark changes to update workspace names
    const onBookmarksChanged = () => {
      loadWorkspaceNames()
    }
    chrome.bookmarks.onCreated.addListener(onBookmarksChanged)
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged)
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged)

    return () => {
      chrome.bookmarks.onCreated.removeListener(onBookmarksChanged)
      chrome.bookmarks.onRemoved.removeListener(onBookmarksChanged)
      chrome.bookmarks.onChanged.removeListener(onBookmarksChanged)
    }
  }, [])

  if (!state) {
    return null
  }

  // Calculate linked workspace for current window
  const currentLinkedWorkspaceId =
    currentWindowId && windowWorkspaceMap[currentWindowId]
      ? windowWorkspaceMap[currentWindowId]
      : undefined

  return (
    <div class="pb-16">
      {showLinkDialog !== null && (
        <LinkWorkspaceDialog
          windowId={showLinkDialog}
          onConfirm={handleConfirmLink}
          onCancel={() => setShowLinkDialog(null)}
        />
      )}

      <div class="p-4 space-y-4">
        {state.windows.map((window) => {
          const windowTabs = state.tabs.filter(
            (t) => t.windowId === window.id,
          )
          const windowGroups = state.tabGroups.filter(
            (g) =>
              state.tabs.some(
                (t) =>
                  optionContains(t.groupId, g.id) && t.windowId === window.id,
              ),
          )

          return (
            <div key={window.id} class="space-y-2">
              <WindowList
                windows={[window]}
                tabsByWindow={new Map([[window.id, windowTabs]])}
                tabGroupsByWindow={new Map([[window.id, windowGroups]])}
                currentWindowId={currentWindowId}
                workspaceNames={workspaceNames}
                onLinkWorkspace={openLinkDialog}
              />
            </div>
          )
        })}
      </div>

      <WorkspaceBar
        currentWindowId={currentWindowId}
        linkedWorkspaceId={currentLinkedWorkspaceId}
        state={state}
      />
    </div>
  )
}

export function App() {
  return <AppContent />
}
