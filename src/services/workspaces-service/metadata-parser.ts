/**
 * Valid tab group colors in Chrome
 */
export const VALID_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const

export type GroupColor = typeof VALID_GROUP_COLORS[number]

/**
 * Parse group metadata from bookmark folder title
 * Format: [color][collapsed] Title or [color] Title
 *
 * @example
 * parseGroupMetadata("[blue][collapsed] Development")
 * // Returns: { color: "blue", collapsed: true, title: "Development" }
 */
export function parseGroupMetadata(title: string): {
  color: GroupColor
  collapsed: boolean
  title: string
} {
  const collapsedMatch = title.match(/\[collapsed\]/)
  const isCollapsed = collapsedMatch !== null

  const colorMatch = title.match(/^\[(.*?)\]/)
  const color = colorMatch?.[1] || "grey"

  const groupTitle = title
    .replace(/^\[.*?\]/, "") // Remove color
    .replace(/\[collapsed\]/, "") // Remove collapsed marker
    .trim()

  const validColor = VALID_GROUP_COLORS.includes(color as GroupColor)
    ? (color as GroupColor)
    : "grey"

  return {
    color: validColor,
    collapsed: isCollapsed,
    title: groupTitle,
  }
}

/**
 * Create bookmark folder title with group metadata
 *
 * @example
 * createGroupTitle("Development", "blue", true)
 * // Returns: "[blue][collapsed] Development"
 */
export function createGroupTitle(
  title: string,
  color: string,
  collapsed: boolean,
): string {
  const collapsedMarker = collapsed ? "[collapsed]" : ""
  return `[${color}]${collapsedMarker} ${title || "Unnamed Group"}`
}
