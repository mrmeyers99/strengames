"""Cut TR-on-moose out of every frame of the TSL banner GIF -> animated WebP with real alpha."""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, out_webp, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
step = int(sys.argv[4]) if len(sys.argv) > 4 else 1
quality = int(sys.argv[5]) if len(sys.argv) > 5 else 72
im = Image.open(src)
frames, durs = [], []
for i in range(0, im.n_frames, step):
    im.seek(i)
    a = np.asarray(im.convert('RGB')).astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mn = np.minimum(np.minimum(r, g), b)
    gd = g - np.maximum(r, b)
    alpha = np.clip(1 - (gd - 6) / 16.0, 0, 1)
    # region of interest: below the lettering baseline area, above the button
    alpha[:440] = 0; alpha[880:] = 0; alpha[:, :480] = 0; alpha[:, 920:] = 0
    # white "LIFE" lettering: flood from seeds inside the letters (pure white only)
    white = mn > 236
    lab, _ = ndimage.label(white)
    seeds = np.unique(lab[425:445, 560:835]); seeds = seeds[seeds > 0]
    letters = np.isin(lab, seeds)
    letters = ndimage.binary_dilation(letters, iterations=2) & (mn > 228)
    alpha[letters] = 0
    # 1-px anti-alias traces of the letters in the hat band: morphological opening there only
    band = alpha[440:505] > 0.35
    opened = ndimage.binary_opening(band, structure=np.ones((3, 3)))
    alpha[440:505][~opened] = 0
    # keep only the biggest blob (the rider); drops grain and leftover traces
    lab2, n = ndimage.label(alpha > 0.35)
    if n:
        sizes = ndimage.sum(np.ones_like(lab2), lab2, range(1, n + 1))
        keep = lab2 == (1 + int(np.argmax(sizes)))
        keep = ndimage.binary_dilation(keep, iterations=2)  # keep soft edges around it
        alpha[~keep] = 0
    luma = 0.3 * r + 0.59 * g + 0.11 * b
    rgb = np.where(gd[..., None] > 3, np.stack([luma] * 3, -1), a)
    frames.append(np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8))
    durs.append(im.info.get('duration', 40) * step)
# common crop box across all frames
A = np.max(np.stack([f[..., 3] for f in frames]), 0)
ys, xs = np.where(A > 30)
x0, x1, y0, y1 = xs.min() - 4, xs.max() + 5, ys.min() - 4, ys.max() + 5
h = round((y1 - y0) * width / (x1 - x0))
out = [Image.fromarray(f[y0:y1, x0:x1], 'RGBA').resize((width, h), Image.LANCZOS) for f in frames]
out[0].save(out_webp, save_all=True, append_images=out[1:], duration=durs, loop=0, quality=quality, method=4, lossless=False)
out[0].save(out_webp.replace('.webp', '-still.png'))
print('crop', (x0, y0, x1, y1), '->', (width, h), 'frames', len(out))
