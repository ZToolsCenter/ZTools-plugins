import { useRef, useState } from "react"
import * as LucideIcons from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { formatShortcut } from "@/lib/utils"
import { getShortcutFromMouseEvent } from "@/lib/shortcut-match"

const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]"

const MODIFIER_KEYS = new Set(["control", "ctrl", "meta", "alt", "shift"])
const MODIFIER_ORDER = ["Ctrl", "Meta", "Alt", "Shift"]

function normalizeShortcutKey(rawKey: string) {
  if (rawKey === " ") return "Space"
  if (rawKey === "+") return "Plus"
  const key = rawKey.trim().toLowerCase()
  if (!key) return ""
  if (key === "control" || key === "ctrl") return "Ctrl"
  if (key === "meta" || key === "command" || key === "cmd") return "Meta"
  if (key === "alt" || key === "option") return "Alt"
  if (key === "shift") return "Shift"
  if (key === "escape" || key === "esc") return "Esc"
  if (key.length === 1) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

interface ShortcutInputEvent {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

/** Extract the canonical main key from an event, using event.code as fallback
 *  when a modifier (especially Alt on Mac) causes event.key to be a non-ASCII
 *  composed character (e.g. ⌥C → "ç"). */
function resolveMainKey(event: ShortcutInputEvent): string {
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey
  const isAsciiPrintable = event.key.length === 1 && event.key.codePointAt(0)! < 128
  if (hasModifier && !isAsciiPrintable && event.code) {
    // KeyX → X, Digit5 → 5, Space → Space, etc.
    const code = event.code
    if (code.startsWith("Key")) return code.slice(3)
    if (code.startsWith("Digit")) return code.slice(5)
    return code
  }
  return event.key
}

export function getShortcutFromKeyEvent(event: ShortcutInputEvent) {
  const baseModifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean)
  const normalizedKey = normalizeShortcutKey(resolveMainKey(event))
  const isModifierKey = MODIFIER_KEYS.has(event.key.toLowerCase())
  const hasKey = normalizedKey && !isModifierKey
  if (!hasKey) return ""
  const tokens = [...baseModifiers, normalizedKey]
  const ordered = MODIFIER_ORDER.filter((key) => tokens.includes(key))
  ordered.push(normalizedKey)
  return ordered.join("+")
}

export interface ShortcutFieldProps {
  id: string
  title: string
  description: string
  value: string
  onChange: (shortcut: string) => void
  resetValue?: string
}

export function ShortcutField({
  id,
  title,
  description,
  value,
  onChange,
  resetValue,
}: ShortcutFieldProps) {
  const [isCapturing, setIsCapturing] = useState(false)
  const pendingModifierRef = useRef("")
  const modifierUsedInChordRef = useRef(false)
  const displayValue = value ? formatShortcut(value) : ""
  const hintText = isCapturing
    ? "正在监听，可按键盘快捷键或鼠标侧键"
    : "点击输入框后，按键盘快捷键或鼠标侧键"
  const resetPendingModifier = () => {
    pendingModifierRef.current = ""
    modifierUsedInChordRef.current = false
  }

  return (
    <div className={`space-y-2 p-4 ${SETTINGS_OPTION_ROW_CLASS}`}>
      <div>
        <div className="flex items-center gap-3">
          <LucideIcons.Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <Label htmlFor={id} className="cursor-pointer">
            {title}
          </Label>
        </div>
        <p className="mt-1 pl-7 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={displayValue}
          readOnly
          data-shortcut-recorder
          placeholder={isCapturing ? "现在可以按下快捷键..." : "点击后按下快捷键"}
          className={cn(
            "h-9 text-sm transition-colors",
            isCapturing && "placeholder:text-[var(--goose-color-capture-hint)]",
          )}
          onFocus={() => {
            resetPendingModifier()
            setIsCapturing(true)
          }}
          onBlur={() => {
            resetPendingModifier()
            setIsCapturing(false)
          }}
          onMouseDown={(event) => {
            const shortcut = getShortcutFromMouseEvent(event.nativeEvent)
            if (!shortcut) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.focus()
            setIsCapturing(true)
            onChange(shortcut)
          }}
          onAuxClick={(event) => {
            if (!getShortcutFromMouseEvent(event.nativeEvent)) return
            event.preventDefault()
            event.stopPropagation()
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Tab" &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey
            ) {
              return
            }

            if (
              (event.key === "Backspace" || event.key === "Delete") &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey
            ) {
              event.preventDefault()
              event.stopPropagation()
              onChange("")
              return
            }

            event.preventDefault()
            event.stopPropagation()

            const isModifierKey = MODIFIER_KEYS.has(event.key.toLowerCase())
            if (isModifierKey) {
              const modifier = normalizeShortcutKey(event.key)
              if (!pendingModifierRef.current) {
                pendingModifierRef.current = modifier
                modifierUsedInChordRef.current = false
              } else if (pendingModifierRef.current !== modifier) {
                modifierUsedInChordRef.current = true
              }
              return
            }

            if (pendingModifierRef.current) {
              modifierUsedInChordRef.current = true
            }
            const shortcut = getShortcutFromKeyEvent(event)
            if (shortcut) onChange(shortcut)
          }}
          onKeyUp={(event) => {
            if (!MODIFIER_KEYS.has(event.key.toLowerCase())) return
            event.preventDefault()
            event.stopPropagation()

            const modifier = normalizeShortcutKey(event.key)
            if (
              pendingModifierRef.current === modifier &&
              !modifierUsedInChordRef.current
            ) {
              onChange(modifier)
            }
            if (pendingModifierRef.current === modifier) {
              resetPendingModifier()
            }
          }}
        />
        {resetValue !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-[10px]"
            onClick={() => onChange(resetValue)}
          >
            恢复默认
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 rounded-[10px]"
          onClick={() => onChange("")}
        >
          清空
        </Button>
      </div>
      <p
        className={cn(
          "text-[11px] transition-colors",
          isCapturing
            ? "shortcut-capture-hint font-medium"
            : "text-muted-foreground",
        )}
      >
        {hintText}
      </p>
    </div>
  )
}
