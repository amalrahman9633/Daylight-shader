import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = "/mnt/user-data/outputs/daylight-masks/"
SIZE = 2048
SS = 2  # supersample factor for smoother edges


def save(img, name):
    img.convert("L").save(OUT + name, optimize=True)


def leaf_polygon(cx, cy, length, width, angle, curve=0.15):
    pts = []
    n = 24
    for i in range(n + 1):
        t = i / n
        x = t * length
        y = math.sin(math.pi * t) ** 0.8 * width / 2
        y += curve * length * math.sin(math.pi * t) * 0.15
        pts.append((x, y))
    for i in range(n, -1, -1):
        t = i / n
        x = t * length
        y = -math.sin(math.pi * t) ** 0.8 * width / 2
        y += curve * length * math.sin(math.pi * t) * 0.15
        pts.append((x, y))
    ca, sa = math.cos(angle), math.sin(angle)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


# ---------- 1. Branch with leaf clusters (not tiled, enters from right) ----------
def make_branch(seed=7):
    rnd = random.Random(seed)
    S = SIZE * SS
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)

    def seg(x0, y0, x1, y1, w):
        d.line([(x0, y0), (x1, y1)], fill=255, width=max(1, int(w)))
        r = w / 2
        d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=255)

    def leaf(x, y, ang, scale):
        L = rnd.uniform(150, 230) * scale * SS
        W = L * rnd.uniform(0.32, 0.42)
        d.polygon(leaf_polygon(x, y, L, W, ang, rnd.uniform(-0.3, 0.3)), fill=255)

    def branch(x, y, ang, length, width, depth):
        steps = 8
        for _ in range(steps):
            ang += rnd.uniform(-0.09, 0.09)
            nx = x + math.cos(ang) * length / steps
            ny = y + math.sin(ang) * length / steps
            seg(x, y, nx, ny, width)
            if depth >= 2 and rnd.random() < 0.55:
                side = rnd.choice([-1, 1])
                leaf(nx, ny, ang + side * rnd.uniform(0.7, 1.2), 1.0 - depth * 0.08)
            x, y = nx, ny
        if depth >= 4 or length < 60 * SS:
            for k in range(rnd.randint(3, 5)):
                leaf(x, y, ang + rnd.uniform(-1.0, 1.0), 1.0)
            return
        n_child = 2 if depth < 3 else rnd.choice([2, 2, 3])
        for k in range(n_child):
            spread = rnd.uniform(0.35, 0.75) * (1 if k % 2 == 0 else -1)
            branch(x, y, ang + spread,
                   length * rnd.uniform(0.62, 0.78),
                   max(2.0, width * 0.62), depth + 1)
        # keep the main limb going
        if depth < 3:
            branch(x, y, ang + rnd.uniform(-0.15, 0.15),
                   length * 0.7, max(2.0, width * 0.7), depth + 1)

    # main limb enters from the right edge heading left and slightly up
    branch(S * 1.02, S * 0.78, math.pi + 0.28, 420 * SS, 30 * SS, 0)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return img


# ---------- 2. Window blinds (stripes with slight frame) ----------
def make_blinds(slats=14, duty=0.55):
    S = SIZE * SS
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    pitch = S / slats
    for i in range(slats):
        y0 = i * pitch
        d.rectangle([0, y0, S, y0 + pitch * duty], fill=255)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return img


# ---------- 3. Dappled leaf layers (tileable, 3 scales) ----------
def make_leaves(seed, count, lmin, lmax):
    rnd = random.Random(seed)
    S = SIZE * SS
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    for _ in range(count):
        cx, cy = rnd.uniform(0, S), rnd.uniform(0, S)
        L = rnd.uniform(lmin, lmax) * SS
        W = L * rnd.uniform(0.35, 0.5)
        ang = rnd.uniform(0, math.tau)
        poly0 = leaf_polygon(0, 0, L, W, ang, rnd.uniform(-0.3, 0.3))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                ox, oy = cx + dx * S, cy + dy * S
                if -L < ox < S + L and -L < oy < S + L:
                    d.polygon([(ox + x, oy + y) for x, y in poly0], fill=255)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return img


# ---------- 4. Soft cloud noise (tileable, FFT-filtered) ----------
def make_cloud(seed=3):
    rng = np.random.default_rng(seed)
    n = SIZE // 2  # compute smaller, upscale smoothly
    noise = rng.standard_normal((n, n))
    f = np.fft.fft2(noise)
    fx = np.fft.fftfreq(n)[:, None]
    fy = np.fft.fftfreq(n)[None, :]
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1
    f *= 1.0 / (r ** 2.2)  # steep falloff -> big soft blobs
    f[0, 0] = 0
    out = np.real(np.fft.ifft2(f))
    out = (out - out.min()) / (out.max() - out.min())
    # push contrast so there are clear clear/cloudy areas
    out = np.clip((out - 0.35) / 0.4, 0, 1)
    out = out * out * (3 - 2 * out)
    img = Image.fromarray((out * 255).astype(np.uint8))
    img = img.resize((SIZE, SIZE), Image.BICUBIC)
    return img


if __name__ == "__main__":
    save(make_branch(), "branch.png")
    save(make_blinds(), "blinds.png")
    save(make_leaves(11, 260, 70, 130), "leaves-large.png")
    save(make_leaves(22, 700, 40, 80), "leaves-medium.png")
    save(make_leaves(33, 1800, 22, 45), "leaves-small.png")
    save(make_cloud(), "cloud.png")
    print("done")
