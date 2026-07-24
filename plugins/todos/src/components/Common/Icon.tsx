import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Inbox,
  FileText,
  X,
  Trash2,
  Search,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from 'lucide-react';

export {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Inbox,
  FileText,
  X,
  Trash2,
  Search,
  Maximize2,
  Minimize2,
};

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'inbox'
  | 'file-text'
  | 'x'
  | 'trash-2'
  | 'search'
  | 'maximize-2'
  | 'minimize-2';

const iconMap: Record<IconName, LucideIcon> = {
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  'inbox': Inbox,
  'file-text': FileText,
  'x': X,
  'trash-2': Trash2,
  'search': Search,
  'maximize-2': Maximize2,
  'minimize-2': Minimize2,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, className, strokeWidth = 2 }: IconProps) {
  const IconComponent = iconMap[name];
  return <IconComponent size={size} className={className} strokeWidth={strokeWidth} />;
}
