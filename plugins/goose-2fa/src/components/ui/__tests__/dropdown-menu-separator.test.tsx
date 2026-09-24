import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect } from "vitest"

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../dropdown-menu"

/**
 * 回归测试:DropdownMenuSeparator 必须是 HeroUI Dropdown.Menu collection 的合法
 * 分隔节点。历史回归(commit e0b4fa7 HeroUI v3 迁移)中,Separator 误从
 * "react-aria-components/Separator" 子路径单独 import,该组件与 HeroUI Dropdown/Menu
 * 内部使用的 react-aria collection 入口不配对,被 collection 解析器当成未知节点,
 * 连同其后所有兄弟项一起截断,导致 separator 之后的 DropdownMenuItem 不渲染。
 */
function MenuFixture() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Item A</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Item B</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe("DropdownMenuSeparator", () => {
  it("renders menu items on both sides of the separator", async () => {
    render(<MenuFixture />)
    fireEvent.click(screen.getByText("open"))

    // separator 之前的项
    expect(await screen.findByText("Item A")).toBeInTheDocument()
    // 关键:separator 之后的项必须渲染(回归点)
    await waitFor(() =>
      expect(screen.queryByText("Item B")).toBeInTheDocument()
    )
    // separator 节点本身也在
    expect(document.querySelector('[role="separator"]')).toBeInTheDocument()
  })
})
