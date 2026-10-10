# -*- coding: utf-8 -*-
# 生成插件 logo：圆角方块 + 提桶（bucket）+ 手柄，配色沿用 Scoop 官方蓝。
from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景圆角方块 + 垂直渐变
BLUE_TOP = (96, 165, 250)
BLUE_BOT = (37, 99, 235)
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    col = tuple(int(BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t) for i in range(3))
    gd.line([(0, y), (S, y)], fill=col + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([16, 16, 240, 240], radius=52, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, 240, 240], radius=52, outline=(219, 234, 254), width=4)

# 提桶：梯形桶身 + 桶沿 + 弧形手柄
WHITE = (248, 250, 252)
d.polygon([(76, 96), (180, 96), (166, 196), (90, 196)], fill=WHITE)
d.rounded_rectangle([68, 84, 188, 102], radius=9, fill=WHITE)
d.arc([86, 44, 170, 118], start=180, end=360, fill=WHITE, width=12)

# 桶里的两个"包"：一深一浅两个圆角小块
d.rounded_rectangle([94, 118, 124, 146], radius=7, fill=(37, 99, 235))
d.rounded_rectangle([130, 118, 160, 146], radius=7, fill=(147, 197, 253))

# 右上角更新箭头（⬆），表示"更新"这个核心动作
GOLD = (253, 224, 71)
d.line([(196, 66), (196, 34)], fill=GOLD, width=11)
d.polygon([(184, 44), (208, 44), (196, 26)], fill=GOLD)

img.save("logo.png")
print("saved logo.png", img.size)
