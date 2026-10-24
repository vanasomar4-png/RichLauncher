"""Draws assets/ui/items/ai-robot.png: a green isometric robot head in the style of the other 16x16 item icons."""
import os
from PIL import Image, ImageDraw

ROOT = r'C:\Users\XMr_agentX\Downloads\RichLauncher-recovery\source'
OUT = os.path.join(ROOT, 'assets', 'ui', 'items', 'ai-robot.png')

TOP, LEFT, RIGHT = (134, 230, 168, 255), (79, 191, 127, 255), (47, 143, 95, 255)
RIM = (178, 250, 206, 255)
OUTLINE = (30, 92, 68, 255)
VISOR = (14, 28, 24, 255)
EYE = (222, 255, 242, 255)
GRILL = (34, 104, 76, 255)
METAL = (186, 198, 194, 255)
METAL_DARK = (98, 114, 110, 255)
BALL = (255, 226, 110, 255)
BALL_HI = (255, 252, 214, 255)
BALL_DARK = (226, 170, 60, 255)

im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
d = ImageDraw.Draw(im)

# Same cube geometry as grass-block / chest / heads.
d.polygon([(8, 1), (15, 5), (8, 9), (1, 5)], fill=TOP)
d.polygon([(1, 5), (8, 9), (8, 15), (1, 11)], fill=LEFT)
d.polygon([(8, 9), (15, 5), (15, 11), (8, 15)], fill=RIGHT)
px = im.load()


def left_top(x):  # y of the top edge of the left (front) face
    return round(5 + (x - 1) * 4 / 7)


def right_top(x):  # y of the top edge of the right face
    return round(9 - (x - 8) * 4 / 7)


# Light rim on the two upper edges of the top face.
rim_pixels = set()
for x in range(1, 9):
    rim_pixels.add((x, round(5 - (x - 1) * 4 / 7)))
for x in range(8, 16):
    rim_pixels.add((x, round(1 + (x - 8) * 4 / 7)))

# Face on the left side: dark visor, two bright eyes, small grille.
for x in range(3, 8):
    for dy in (1, 2):
        px[x, left_top(x) + dy] = VISOR
for x in (4, 6):
    px[x, left_top(x) + 1] = EYE
    px[x, left_top(x) + 2] = EYE
for x in (4, 5, 6):
    px[x, left_top(x) + 4] = GRILL

# Ear plate with a bolt on the right side.
for x in (11, 12, 13):
    px[x, right_top(x) + 2] = METAL
    px[x, right_top(x) + 3] = METAL
px[12, right_top(12) + 3] = METAL_DARK

# Dark outline around the silhouette, except on the light top edges.
alpha = [[px[x, y][3] for x in range(16)] for y in range(16)]
for y in range(16):
    for x in range(16):
        if alpha[y][x] == 0:
            continue
        edge = any(
            nx < 0 or ny < 0 or nx > 15 or ny > 15 or alpha[ny][nx] == 0
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
        )
        if edge:
            px[x, y] = RIM if (x, y) in rim_pixels else OUTLINE

# Antenna on top of the head: short stem and a glowing ball.
px[8, 5] = METAL_DARK
px[8, 4] = METAL
px[8, 3] = METAL
for x, y in ((7, 1), (8, 1), (7, 2), (8, 2)):
    px[x, y] = BALL
px[7, 1] = BALL_HI
px[8, 2] = BALL_DARK

os.makedirs(os.path.dirname(OUT), exist_ok=True)
im.save(OUT)

# Preview next to its neighbours on the launcher background colour.
names = ['grass-block', 'crafting-table', 'chest', 'friends', 'player-head', 'ai-robot', 'compass']
S = 10
sheet = Image.new('RGBA', (len(names) * (16 * S + 10) + 10, 16 * S + 20), (20, 30, 26, 255))
for i, name in enumerate(names):
    icon = Image.open(os.path.join(ROOT, 'assets', 'ui', 'items', name + '.png')).convert('RGBA')
    icon = icon.resize((16 * S, 16 * S), Image.NEAREST)
    sheet.paste(icon, (10 + i * (16 * S + 10), 10), icon)
sheet.save(os.path.join(ROOT, '..', 'robot-preview.png'))
print('ok')
