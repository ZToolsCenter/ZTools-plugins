import type { ReactElement } from 'react'

export type IconName =
  | 'copy'
  | 'check'
  | 'x'
  | 'sliders'
  | 'search'
  | 'chevron'
  | 'note'

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

const paths: Record<IconName, ReactElement> = {
  copy: (
    <>
      <rect x="5.2" y="5.2" width="7.3" height="7.3" rx="1.2" />
      <path d="M10.5 3.6V3a1.3 1.3 0 0 0-1.3-1.3H3.6A1.3 1.3 0 0 0 2.3 3v6.6A1.3 1.3 0 0 0 3.6 10.9h.5" />
    </>
  ),
  check: <path d="m3.2 8.4 3 3 6.6-6.8" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  sliders: (
    <>
      <path d="M2.4 4.6h11.2M2.4 8h11.2M2.4 11.4h11.2" />
      <circle cx="6.1" cy="4.6" r="1.35" fill="currentColor" />
      <circle cx="10.1" cy="8" r="1.35" fill="currentColor" />
      <circle cx="5.1" cy="11.4" r="1.35" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3.5 3.5" />
    </>
  ),
  chevron: <path d="m6 3.5 4.5 4.5L6 12.5" />,
  note: (
    <>
      <rect x="3" y="2.6" width="10" height="10.8" rx="1.4" />
      <path d="M5.3 6h5.4M5.3 8.4h5.4M5.3 10.8h3.2" />
    </>
  )
}

export default function Icon({ name, size = 14, className }: IconProps) {
  return (
    <svg
      className={className ? `ct-icon ${className}` : 'ct-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
