type DropdownValueType = string | number

export interface DropdownOption {
  label: string
  value: DropdownValueType
}

export interface DropdownProps {
  modelValue: string | number
  options: DropdownOption[]
  placeholder?: string
}

export interface DropdownEmits {
  (e: 'update:modelValue', value: DropdownValueType): void
  (e: 'change', value: DropdownValueType): void
}
