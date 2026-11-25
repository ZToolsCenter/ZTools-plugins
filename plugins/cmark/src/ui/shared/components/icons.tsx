/** 自绘图标（16x16，stroke 版），不引用任何原版资源 */
export function IconBranch() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 5v6M10.5 6H7a3 3 0 0 0-3 3" strokeLinecap="round" />
    </svg>
  )
}

export function IconPull() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 2.5v9M4.5 8L8 11.5 11.5 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 13.5h11" strokeLinecap="round" />
    </svg>
  )
}

export function IconPush() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 13V4M4.5 7.5L8 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 13.5h11" strokeLinecap="round" />
    </svg>
  )
}

export function IconSync() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M13.2 7a5.2 5.2 0 0 0-9-3.1" strokeLinecap="round" />
      <path d="M4.2 1.6v2.6h2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.8 9a5.2 5.2 0 0 0 9 3.1" strokeLinecap="round" />
      <path d="M11.8 14.4v-2.6H9.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconGear() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" strokeLinecap="round" />
    </svg>
  )
}

export function IconChevron(props: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={props.open ? 'M3.5 6.5L8 11l4.5-4.5' : 'M6.5 3.5L11 8l-4.5 4.5'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconMenu() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2 4.5h12M2 8h8M2 11.5h12" strokeLinecap="round" />
    </svg>
  )
}

export function IconWidth() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.2" />
      <path d="M4.6 5.6v4.8M11.4 5.6v4.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconHistory() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.6V8l2.4 1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconLock() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3.2" y="7" width="9.6" height="6.2" rx="1.2" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" strokeLinecap="round" />
    </svg>
  )
}
