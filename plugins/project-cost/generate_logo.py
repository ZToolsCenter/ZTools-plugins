"""生成插件图标：陶土底 + 米白房子剪影（4 倍超采样抗锯齿）。"""
import zlib
import struct

S = 4                      # 超采样倍数
W = H = 128 * S
CLAY = (168, 98, 76)       # 主色 #A8624C
PAPER = (251, 243, 234)    # 米白 #FBF3EA
OCHRE = (217, 165, 102)    # 赭石 #D9A566

R = 28 * S                 # 圆角半径


def rounded(x, y):
    """圆角矩形内的判定"""
    if R <= x <= W - R or R <= y <= H - R:
        return 0 <= x < W and 0 <= y < H
    cx = R if x < R else W - R
    cy = R if y < R else H - R
    return (x - cx) ** 2 + (y - cy) ** 2 <= R * R


def in_tri(x, y, a, b, c):
    """重心法判定点是否在三角形内"""
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1 = sign((x, y), a, b)
    d2 = sign((x, y), b, c)
    d3 = sign((x, y), c, a)
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)


ROOF = [(24 * S, 60 * S), (64 * S, 26 * S), (104 * S, 60 * S)]
BODY = (40 * S, 60 * S, 88 * S, 100 * S)    # x1,y1,x2,y2
DOOR = (57 * S, 77 * S, 71 * S, 100 * S)
WIN = (0, 0, 0, 0)                          # 无窗，保持剪影干净


def color(x, y):
    if not rounded(x, y):
        return (0, 0, 0, 0)
    if in_tri(x, y, *ROOF) or (BODY[0] <= x <= BODY[2] and BODY[1] <= y <= BODY[3]):
        if DOOR[0] <= x <= DOOR[2] and DOOR[1] <= y <= DOOR[3]:
            return OCHRE + (255,)
        if WIN[0] <= x <= WIN[2] and WIN[1] <= y <= WIN[3]:
            return CLAY + (255,)
        return PAPER + (255,)
    return CLAY + (255,)


def build():
    raw = bytearray()
    for y in range(0, H, S):
        raw.append(0)                       # filter type 0
        for x in range(0, W, S):
            rs = gs = bs = as_ = 0
            for dy in range(S):
                for dx in range(S):
                    r, g, b, a = color(x + dx, y + dy)
                    rs += r * a
                    gs += g * a
                    bs += b * a
                    as_ += a
            n = S * S
            if as_ == 0:
                raw += bytes((0, 0, 0, 0))
            else:
                raw += bytes((rs // as_, gs // as_, bs // as_, as_ // n))
    return bytes(raw)


def png():
    def chunk(typ, body):
        return (struct.pack('>I', len(body)) + typ + body
                + struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff))
    raw = build()
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', 128, 128, 8, 6, 0, 0, 0)   # 8bit RGBA
    return (sig + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


with open('logo.png', 'wb') as f:
    f.write(png())
print('logo.png written')
