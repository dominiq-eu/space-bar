import { useEffect, useState } from "preact/hooks"
import { Effect } from "effect"

import {
  useBrowserApi,
  useWindowsService,
  useWorkspacesService,
} from "./service-context.tsx"
import { LinkWorkspaceDialog } from "./link-workspace-dialog.tsx"
import { WorkspaceBar } from "./workspace-bar.tsx"
import { optionContains } from "../utils/type-conversions.ts"
import { WindowList } from "./window-list.tsx"
import { useAppState } from "../hooks/useAppState.ts"
import { useSyncService } from "../hooks/useSyncService.ts"
import type { Tab, TabGroup } from "../services/state-service/types.ts"

function AppContent() {
  const { state } = useAppState()
  const browserApi = useBrowserApi()
  const windowsService = useWindowsService()
  const workspacesService = useWorkspacesService()

  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>(
    {},
  )
  const [showLinkDialog, setShowLinkDialog] = useState<number | null>(null)
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null)
  const { linkWindow, windowWorkspaceMap } = useSyncService()

  const loadCurrentWindowId = () => {
    Effect.runPromise(windowsService.getCurrentWindow())
      .then((window) => {
        setCurrentWindowId(window.id)
      })
      .catch(() => {
        // Ignore errors
      })
  }

  const loadWorkspaceNames = () => {
    Effect.runPromise(workspacesService.getBookmarksBar()).then(
      (bookmarksBar) => {
        Effect.runPromise(
          browserApi.bookmarks.getChildren(bookmarksBar.id).pipe(
            Effect.catchAll(() => Effect.succeed([])),
          ),
        ).then((children) => {
          const names: Record<string, string> = {}
          children
            .filter((child) => !child.url)
            .forEach((workspace) => {
              names[workspace.id] = workspace.title || "Unnamed Workspace"
            })
          setWorkspaceNames(names)
        })
      },
    )
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

    const cleanupBookmarkCreated = browserApi.events.onBookmarkCreated(
      onBookmarksChanged,
    )
    const cleanupBookmarkRemoved = browserApi.events.onBookmarkRemoved(
      onBookmarksChanged,
    )
    const cleanupBookmarkChanged = browserApi.events.onBookmarkChanged(
      onBookmarksChanged,
    )

    return () => {
      cleanupBookmarkCreated()
      cleanupBookmarkRemoved()
      cleanupBookmarkChanged()
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

  // Only render the current window
  const currentWindow = state.windows.find((w) => w.id === currentWindowId)

  if (!currentWindow) {
    return null
  }

  const windowTabs = state.tabs.filter((t) => t.windowId === currentWindow.id)
  const windowGroups = state.tabGroups.filter((g) =>
    state.tabs.some(
      (t) => optionContains(t.groupId, g.id) && t.windowId === currentWindow.id,
    )
  )

  const tabsByWindow = new Map<number, Tab[]>([[currentWindow.id, windowTabs]])
  const tabGroupsByWindow = new Map<number, TabGroup[]>([
    [currentWindow.id, windowGroups],
  ])

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
        <WindowList
          windows={[currentWindow]}
          tabsByWindow={tabsByWindow}
          tabGroupsByWindow={tabGroupsByWindow}
          currentWindowId={currentWindowId}
          workspaceNames={workspaceNames}
          onLinkWorkspace={openLinkDialog}
        />
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
