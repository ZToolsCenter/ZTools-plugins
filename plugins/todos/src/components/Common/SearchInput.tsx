import React, { useState, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import './Common.css'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
  onClear?: () => void
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索任务...',
  debounceMs = 300,
  onClear,
  className
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue)
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [localValue, debounceMs, onChange])

  const handleClear = () => {
    setLocalValue('')
    onChange('')
    onClear?.()
  }

  return (
    <div className={`search-input ${className || ''}`}>
      <Search size={16} className="search-icon" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
      />
      {localValue && (
        <button className="clear-btn" onClick={handleClear}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
