from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- Rounded body with vertical gradient ---
x0, y0, x1, y1 = 56, 122, 200, 224
r = 28
BLUE_TOP = (96, 165, 250)
BLUE_BOT = (37, 99, 235)

grad = Image.new("RGBA", (S, S), (0,0,0,0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    col = tuple(int(BLUE_TOP[i] + (BLUE_BOT[i]-BLUE_TOP[i])*t) for i in range(3))
    gd.line([(0,y),(S,y)], fill=col+(255,))

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)
body = Image.new("RGBA", (S, S), (0,0,0,0))
body.paste(grad, (0,0), mask)
img.alpha_composite(body)
d = ImageDraw.Draw(img)

d.rounded_rectangle([x0, y0, x1, y1], radius=r, outline=(186, 230, 253), width=3)

# keyhole
d.ellipse([118, 150, 138, 170], fill=(15, 23, 42))
d.rectangle([124, 168, 132, 196], fill=(15, 23, 42))

# --- Shackle (open = unlocked), gold ---
GOLD = (251, 191, 36)
d.arc([84, 40, 156, 126], start=175, end=350, fill=GOLD, width=20)
d.ellipse([94, 40, 108, 60], fill=GOLD)      # top bar cap
d.ellipse([84-10, 106, 84+10, 132], fill=GOLD)  # left cap at body

img.save("logo.png")
print("saved logo.png", img.size)
