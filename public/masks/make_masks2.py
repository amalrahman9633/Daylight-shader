import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from make_masks import leaf_polygon, save, SIZE, SS


def make_branch(seed=5):
    rnd = random.Random(seed)
    S = SIZE * SS
    u = S / 2048.0  # unit scale
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)

    def seg(x0, y0, x1, y1, w):
        d.line([(x0, y0), (x1, y1)], fill=255, width=max(1, int(w)))
        r = w / 2
        d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=255)

    def leaf(x, y, ang, scale=1.0):
        L = rnd.uniform(95, 150) * scale * u
        W = L * rnd.uniform(0.30, 0.40)
        d.polygon(leaf_polygon(x, y, L, W, ang, rnd.uniform(-0.35, 0.35)), fill=255)

    def branch(x, y, ang, length, width, depth, droop=0.0):
        steps = 14
        for i in range(steps):
            ang += rnd.uniform(-0.06, 0.06) + droop
            nx = x + math.cos(ang) * length / steps
            ny = y + math.sin(ang) * length / steps
            seg(x, y, nx, ny, width * (1 - 0.35 * i / steps))
            # sparse leaves on twigs only
            if depth >= 2 and i > 3 and rnd.random() < 0.42:
                side = rnd.choice([-1, 1])
                leaf(nx, ny, ang + side * rnd.uniform(0.6, 1.1), 1.0)
            x, y = nx, ny
        if depth >= 4:
            for _ in range(rnd.randint(2, 3)):
                leaf(x, y, ang + rnd.uniform(-0.8, 0.8), 1.0)
            return
        # side twigs along the way are spawned at the end for simplicity
        kids = rnd.choice([2, 2, 3])
        for k in range(kids):
            sign = -1 if k % 2 else 1
            branch(x, y, ang + sign * rnd.uniform(0.35, 0.8),
                   length * rnd.uniform(0.62, 0.78),
                   max(3.0 * u, width * 0.58), depth + 1, droop * 0.5)

    def limb_with_twigs(x, y, ang, length, width):
        # main limb, drops side branches at intervals
        n = 5
        seg_len = length / n
        for i in range(n):
            ang += rnd.uniform(-0.05, 0.05) + 0.015
            nx = x + math.cos(ang) * seg_len
            ny = y + math.sin(ang) * seg_len
            seg(x, y, nx, ny, width * (1 - 0.1 * i))
            if i >= 1:
                sign = -1 if i % 2 else 1
                branch(nx, ny, ang + sign * rnd.uniform(0.5, 0.9),
                       seg_len * rnd.uniform(1.4, 1.9), width * 0.5, 1)
            x, y = nx, ny
        # tip cluster
        branch(x, y, ang + rnd.uniform(-0.2, 0.2), seg_len * 1.5, width * 0.5, 2)

    limb_with_twigs(S * 1.03, S * 0.30, math.pi + 0.22, 1750 * u, 34 * u)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    return img


def make_cloud(seed=3):
    rng = np.random.default_rng(seed)
    n = 512
    noise = rng.standard_normal((n, n))
    f = np.fft.fft2(noise)
    fx = np.fft.fftfreq(n)[:, None]
    fy = np.fft.fftfreq(n)[None, :]
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1
    f *= 1.0 / (r ** 1.6)
    f[0, 0] = 0
    out = np.real(np.fft.ifft2(f))
    lo, hi = np.percentile(out, [3, 97])
    out = np.clip((out - lo) / (hi - lo), 0, 1)
    # gentle contrast so it reads as soft patches, not hard blobs
    out = 0.15 + 0.7 * out
    img = Image.fromarray((out * 255).astype(np.uint8))
    img = img.resize((SIZE, SIZE), Image.BICUBIC)
    return img


if __name__ == "__main__":
    save(make_branch(), "branch.png")
    save(make_cloud(), "cloud.png")
    print("done")
