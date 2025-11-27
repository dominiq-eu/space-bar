import { useEffect, useState } from "preact/hooks"
import { Effect } from "effect"
import { useBrowserApi, useWorkspacesService } from "./service-context.tsx"

export interface LinkWorkspaceDialogProps {
  windowId: number
  onConfirm: (windowId: number, workspaceId: string) => void
  onCancel: () => void
}

export function LinkWorkspaceDialog({
  windowId,
  onConfirm,
  onCancel,
}: LinkWorkspaceDialogProps) {
  const browserApi = useBrowserApi()
  const workspacesService = useWorkspacesService()

  const [workspaces, setWorkspaces] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([])

  useEffect(() => {
    Effect.runPromise(workspacesService.getBookmarksBar()).then(
      (bookmarksBar) => {
        Effect.runPromise(
          browserApi.bookmarks.getChildren(bookmarksBar.id).pipe(
            Effect.catchAll(() => Effect.succeed([])),
          ),
        ).then((children) => {
          setWorkspaces(children.filter((child) => !child.url))
        })
      },
    )
  }, [])

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full">
        <h3 class="font-bold mb-3">Link Window to Workspace</h3>
        <div class="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              class="w-full text-left px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded transition-colors text-sm"
              onClick={() => onConfirm(windowId, workspace.id)}
            >
              {workspace.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="w-full px-3 py-2 bg-gray-300 hover:bg-gray-400 rounded transition-colors text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
