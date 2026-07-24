export interface TagDropdownMenuItem {
  key: string
  label: string
  icon?: string
  danger?: boolean
}

export interface TagDropdownMenuProps {
  menuItems: TagDropdownMenuItem[]
}

export interface TagDropdownMenuEmits {
  (e: 'select', key: string): void
}
