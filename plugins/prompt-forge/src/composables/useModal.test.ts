import { afterEach, describe, expect, it } from 'vitest'
import { useModal } from './useModal'

const modal = useModal()

afterEach(() => {
  if (modal.state.value.visible) modal.handleCancel()
})

describe('应用内 Modal', () => {
  it('确认操作返回 true', async () => {
    const result = modal.confirm('确认删除？')

    expect(modal.state.value.visible).toBe(true)
    modal.handleConfirm()

    await expect(result).resolves.toBe(true)
  })

  it('取消输入返回 null', async () => {
    const result = modal.prompt('请输入标题')

    modal.handleCancel()

    await expect(result).resolves.toBeNull()
  })
})
