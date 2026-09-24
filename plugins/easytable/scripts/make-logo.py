"""绘制「简单记录」插件 logo（扁平几何图标，非 AI 生成）。

用法: python scripts/make-logo.py
输出: src-ztools/logo.png（1024）、logo-256.png（便于预览）
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_ICON = ROOT / "src-ztools" / "logo.png"
OUT_256 = ROOT / "logo-256.png"

# 色板：象牙卡片 / 墨蓝线条 / 珊瑚勾选
IVORY = (250, 246, 238, 255)
IVORY_EDGE = (232, 224, 208, 255)
INK = (36, 52, 86, 255)
INK_SOFT = (36, 52, 86, 210)
CORAL = (232, 108, 92, 255)
CORAL_DEEP = (200, 78, 64, 255)
TRANSPARENT = (0, 0, 0, 0)


def rounded_rect(draw: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_logo(size: int = 1024) -> Image.Image:
    S = size / 1024
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    d = ImageDraw.Draw(img)

    # 外层圆角方垫（便于在深浅底上识别）
    pad = int(64 * S)
    rounded_rect(d, (pad, pad, size - pad, size - pad), int(220 * S), IVORY, IVORY_EDGE, int(10 * S))

    # 卡片
    card_l, card_t = int(220 * S), int(210 * S)
    card_r, card_b = int(820 * S), int(780 * S)
    rounded_rect(d, (card_l, card_t, card_r, card_b), int(48 * S), (255, 255, 255, 255), INK, int(18 * S))

    # 三条记录线
    line_x1 = int(300 * S)
    line_x2 = int(720 * S)
    line_ys = (int(340 * S), int(460 * S), int(580 * S))
    widths = (int(28 * S), int(28 * S), int(28 * S))
    radii = (int(14 * S), int(14 * S), int(14 * S))
    # 前两行短一点，第三行更短，像未写完的记录
    rights = (line_x2, line_x2 - int(40 * S), line_x2 - int(120 * S))
    for y, w, r, x2 in zip(line_ys, widths, radii, rights):
        rounded_rect(d, (line_x1, y - w // 2, x2, y + w // 2), r, INK_SOFT)

    # 左侧小勾选点（每行行首）
    for y in line_ys:
        cx, cy = int(270 * S), y
        rr = int(14 * S)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=INK)

    # 右下角勾选徽章
    bx, by = int(740 * S), int(700 * S)
    br = int(110 * S)
    d.ellipse((bx - br, by - br, bx + br, by + br), fill=CORAL, outline=CORAL_DEEP, width=int(10 * S))
    # 对勾（两段折线，圆角感用粗线）
    check = [
        (bx - int(48 * S), by + int(4 * S)),
        (bx - int(12 * S), by + int(40 * S)),
        (bx + int(52 * S), by - int(36 * S)),
    ]
    d.line(check, fill=(255, 255, 255, 255), width=int(28 * S), joint="curve")
    # 线头圆帽
    r_cap = int(14 * S)
    for x, y in check:
        d.ellipse((x - r_cap, y - r_cap, x + r_cap, y + r_cap), fill=(255, 255, 255, 255))

    return img


def main() -> None:
    OUT_ICON.parent.mkdir(parents=True, exist_ok=True)
    icon = draw_logo(1024)
    icon.save(OUT_ICON, "PNG")
    icon.resize((256, 256), Image.Resampling.LANCZOS).save(OUT_256, "PNG")
    print("wrote", OUT_ICON)
    print("wrote", OUT_256)


if __name__ == "__main__":
    main()
