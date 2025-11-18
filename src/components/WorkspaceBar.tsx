import { useEffect, useState } from "preact/hooks"
import { Effect } from "effect"
import type {
  AppState,
  WindowId,
  WorkspaceId,
} from "../services/state-service/types.ts"
import {
  getBookmarksBar,
  loadWorkspaceInWindow,
  restoreWorkspace,
  saveWorkspace,
} from "../services/workspaces-service/index.ts"
import {
  linkWindowToWorkspace,
  unlinkWindow,
} from "../services/storage-service/index.ts"

export interface WorkspaceBarProps {
  currentWindowId: number | null
  linkedWorkspaceId?: string
  state: AppState
}

export function WorkspaceBar({
  currentWindowId,
  linkedWorkspaceId,
  state,
}: WorkspaceBarProps) {
  const [workspaces, setWorkspaces] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([])
  const [contextMenu, setContextMenu] = useState<
    {
      workspaceId: string
      x: number
      y: number
    } | null
  >(null)
  const [workspaceDialog, setWorkspaceDialog] = useState<
    {
      mode: "create" | "rename"
      workspaceId?: string
      currentName: string
    } | null
  >(null)
  const [workspaceName, setWorkspaceName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [takeoverDialog, setTakeoverDialog] = useState<
    {
      workspaceId: string
    } | null
  >(null)

  const loadWorkspaces = () => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        setWorkspaces(children.filter((child) => !child.url))
      })
    })
  }

  useEffect(() => {
    loadWorkspaces()

    // Listen for bookmark changes to update the workspace bar
    const onBookmarksChanged = () => {
      loadWorkspaces()
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

  useEffect(() => {
    if (contextMenu) {
      const handleClickOutside = () => setContextMenu(null)
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [contextMenu])

  useEffect(() => {
    if (workspaceDialog) {
      // Focus the input field when dialog opens
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="Workspace name..."]',
        )
        if (input) {
          input.focus()
          input.select()
        }
      }, 0)
    }
  }, [workspaceDialog])

  const handleLoadWorkspace = (workspaceId: string) => {
    if (!currentWindowId) return

    // Check if switching from unlinked state to a workspace
    if (!linkedWorkspaceId) {
      // Show takeover dialog
      setTakeoverDialog({ workspaceId })
      return
    }

    setIsLoading(true)
    Effect.runPromise(
      loadWorkspaceInWindow(workspaceId, currentWindowId, false),
    )
      .then(() => {
        setIsLoading(false)
      })
      .catch((error) => {
        console.error("Failed to load workspace:", error)
        setIsLoading(false)
      })
  }

  const handleTakeoverConfirm = (keepTabs: boolean) => {
    if (!takeoverDialog || !currentWindowId) return

    setIsLoading(true)
    Effect.runPromise(
      loadWorkspaceInWindow(
        takeoverDialog.workspaceId,
        currentWindowId,
        keepTabs,
      ),
    )
      .then(() => {
        setIsLoading(false)
        setTakeoverDialog(null)
      })
      .catch((error) => {
        console.error("Failed to load workspace:", error)
        setIsLoading(false)
        setTakeoverDialog(null)
      })
  }

  const handleRestoreWorkspace = (workspaceId: string) => {
    Effect.runPromise(restoreWorkspace(workspaceId)).catch((error) => {
      console.error("Failed to restore workspace:", error)
    })
    setContextMenu(null)
  }

  const handleDeleteWorkspace = (workspaceId: string) => {
    if (confirm("Delete this workspace?")) {
      chrome.bookmarks.removeTree(workspaceId, () => {
        loadWorkspaces()
      })
    }
    setContextMenu(null)
  }

  const handleRenameWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId)
    if (workspace) {
      setWorkspaceDialog({
        mode: "rename",
        workspaceId,
        currentName: workspace.title || "",
      })
      setWorkspaceName(workspace.title || "")
    }
    setContextMenu(null)
  }

  const handleCreateWorkspace = () => {
    setWorkspaceDialog({
      mode: "create",
      currentName: "",
    })
    setWorkspaceName("")
  }

  const handleUnlinkWorkspace = () => {
    if (!currentWindowId) return

    // Unlink the window from the workspace (tabs stay open)
    Effect.runPromise(unlinkWindow(currentWindowId as WindowId))
      .catch((error) => {
        console.error("Failed to unlink workspace:", error)
      })
  }

  const handleConfirmDialog = () => {
    if (!workspaceDialog || !workspaceName.trim()) return

    if (workspaceDialog.mode === "rename") {
      // Rename existing workspace
      if (!workspaceDialog.workspaceId) return

      // Check if another workspace with the same name already exists
      const duplicateName = workspaces.some(
        (w) =>
          w.id !== workspaceDialog.workspaceId &&
          w.title === workspaceName.trim(),
      )

      if (duplicateName) {
        alert(
          "A workspace with this name already exists. Please choose a different name.",
        )
        return
      }

      chrome.bookmarks.update(
        workspaceDialog.workspaceId,
        { title: workspaceName },
        () => {
          loadWorkspaces()
          setWorkspaceDialog(null)
          setWorkspaceName("")
        },
      )
    } else {
      // Create new workspace
      if (!currentWindowId) return

      // Check if a workspace with the same name already exists
      const duplicateName = workspaces.some(
        (w) => w.title === workspaceName.trim(),
      )

      if (duplicateName) {
        alert(
          "A workspace with this name already exists. Please choose a different name.",
        )
        return
      }

      Effect.runPromise(saveWorkspace(workspaceName, state))
        .then((workspaceFolder) => {
          setWorkspaceName("")
          setWorkspaceDialog(null)
          loadWorkspaces()

          // Automatically link the new workspace to the current window
          if (workspaceFolder.id && currentWindowId !== null) {
            Effect.runPromise(
              linkWindowToWorkspace(
                currentWindowId as WindowId,
                workspaceFolder.id as WorkspaceId,
              ),
            ).catch((error) => {
              console.error("Failed to link workspace:", error)
            })
          }
        })
        .catch((error) => {
          console.error("Failed to save workspace:", error)
        })
    }
  }

  const handleContextMenu = (
    e: MouseEvent,
    workspaceId: string,
  ) => {
    e.preventDefault()

    // Estimate context menu height (2 buttons with padding)
    const menuHeight = 80 // Approximate height
    const menuWidth = 150 // Approximate width

    // Calculate position, opening upward if not enough space below
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

    setContextMenu({
      workspaceId,
      x,
      y,
    })
  }

  return (
    <div class="fixed bottom-0 left-0 right-0 bg-gray-100 border-t border-gray-300 p-2">
      <div class="flex gap-2 overflow-x-auto items-center">
        {/* Unlinked state button */}
        <button
          type="button"
          class={`px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${
            !linkedWorkspaceId
              ? "bg-blue-500 text-white hover:bg-blue-600"
              : "bg-gray-300 text-gray-700 hover:bg-gray-400"
          }`}
          onClick={handleUnlinkWorkspace}
          title={!linkedWorkspaceId
            ? "Unlinked workspace"
            : "Unlink from workspace"}
        >
          ☰
        </button>

        {/* Vertical separator */}
        <div class="h-6 w-px bg-gray-400 flex-shrink-0"></div>

        {/* Workspace buttons */}
        {workspaces.map((workspace) => {
          const isLinked = linkedWorkspaceId === workspace.id
          return (
            <button
              key={workspace.id}
              type="button"
              class={`px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${
                isLinked
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "bg-gray-300 text-gray-700 hover:bg-gray-400"
              }`}
              onClick={() => handleLoadWorkspace(workspace.id)}
              onContextMenu={(e) => handleContextMenu(e, workspace.id)}
            >
              {workspace.title}
            </button>
          )
        })}

        {/* Create new workspace button at the end */}
        <button
          type="button"
          class="px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap flex-shrink-0 bg-green-500 text-white hover:bg-green-600 font-bold"
          onClick={handleCreateWorkspace}
          title="Save current workspace"
        >
          +
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
            onClick={() => handleRestoreWorkspace(contextMenu.workspaceId)}
          >
            Restore
          </button>
          <button
            type="button"
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
            onClick={() => handleRenameWorkspace(contextMenu.workspaceId)}
          >
            Rename
          </button>
          <button
            type="button"
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors text-red-600"
            onClick={() => handleDeleteWorkspace(contextMenu.workspaceId)}
          >
            Delete
          </button>
        </div>
      )}
      {workspaceDialog && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full mx-4">
            <h3 class="font-bold mb-3 text-sm">
              {workspaceDialog.mode === "create"
                ? "Create Workspace"
                : "Rename Workspace"}
            </h3>
            <input
              type="text"
              placeholder="Workspace name..."
              class="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-3"
              value={workspaceName}
              onInput={(e) => setWorkspaceName(e.currentTarget.value)}
              onKeyPress={(e) => e.key === "Enter" && handleConfirmDialog()}
              autoFocus
            />
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={handleConfirmDialog}
              >
                {workspaceDialog.mode === "create" ? "Create" : "Rename"}
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 transition-colors"
                onClick={() => {
                  setWorkspaceDialog(null)
                  setWorkspaceName("")
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {takeoverDialog && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full mx-4">
            <h3 class="font-bold mb-3 text-sm">Switch to Workspace</h3>
            <p class="text-xs text-gray-600 mb-4">
              Would you like to keep the current tabs when switching to this
              workspace?
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={() => handleTakeoverConfirm(true)}
              >
                Keep Tabs
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-2 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 transition-colors"
                onClick={() => handleTakeoverConfirm(false)}
              >
                Close Tabs
              </button>
              <button
                type="button"
                class="px-3 py-2 bg-gray-200 text-gray-600 text-xs rounded hover:bg-gray-300 transition-colors"
                onClick={() => setTakeoverDialog(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isLoading && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-6 rounded shadow-lg">
            <div class="flex flex-col items-center gap-3">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500">
              </div>
              <p class="text-sm font-medium text-gray-700">
                Loading workspace...
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
