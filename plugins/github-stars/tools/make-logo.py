# -*- coding: utf-8 -*-
"""生成插件 logo.png（256×256）：深色圆角底 + 金色五角星。"""
import math, os
from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 深色圆角底（带一点垂直渐变）
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    r = int(22 + 8 * t); g = int(26 + 10 * t); b = int(32 + 12 * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=56, fill=255)
img.paste(grad, (0, 0), mask)

# 金色五角星
cx, cy, R, r = S / 2, S / 2 + 6, 88, 36
pts = []
for i in range(10):
    ang = -math.pi / 2 + i * math.pi / 5
    rad = R if i % 2 == 0 else r
    pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
d = ImageDraw.Draw(img)
d.polygon(pts, fill=(240, 196, 60, 255), outline=(255, 226, 130, 255))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "logo.png")
out = os.path.normpath(out)
img.save(out)
print("logo written:", out, img.size)
