import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders with default placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} />)
    expect(screen.getByPlaceholderText('搜索任务...')).toBeInTheDocument()
  })

  it('renders with custom placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="查找任务..." />)
    expect(screen.getByPlaceholderText('查找任务...')).toBeInTheDocument()
  })

  it('displays the current value', () => {
    render(<SearchInput value="hello" onChange={() => {}} />)
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument()
  })

  it('calls onChange after debounce', () => {
    const handleChange = jest.fn()
    render(<SearchInput value="" onChange={handleChange} debounceMs={300} />)
    
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } })
    expect(handleChange).not.toHaveBeenCalled()
    
    act(() => {
      jest.advanceTimersByTime(300)
    })
    expect(handleChange).toHaveBeenCalledWith('test')
  })

  it('clears value when clear button clicked', () => {
    const handleChange = jest.fn()
    const handleClear = jest.fn()
    const { container } = render(<SearchInput value="" onChange={handleChange} onClear={handleClear} />)
    
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } })
    
    act(() => {
      jest.advanceTimersByTime(300)
    })
    
    const clearBtn = container.querySelector('.clear-btn') as HTMLElement
    fireEvent.click(clearBtn)
    
    expect(handleClear).toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(0)
    })
    expect(handleChange).toHaveBeenCalledWith('')
  })

  it('does not show clear button when empty', () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} />)
    expect(container.querySelector('.clear-btn')).not.toBeInTheDocument()
  })

  it('shows clear button when has value', () => {
    const { container } = render(<SearchInput value="test" onChange={() => {}} />)
    expect(container.querySelector('.clear-btn')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} className="custom" />)
    expect(container.firstChild).toHaveClass('search-input', 'custom')
  })
})
