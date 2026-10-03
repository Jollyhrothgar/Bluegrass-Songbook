# Traces design/inlays/*.svg from a photo of a flying eagle inlay set laid in
# ebony (see README.md for the source and how to re-run).
#
# For each inlay: upsample its grey levels, map wood to 0 and pearl to 1,
# average it with its own mirror image (the inlays are symmetric left to
# right), and cut at 0.5. The sub-pixel cut keeps fine points and notches;
# the mirror average halves the wobble from the pearl's figure and the JPEG
# and makes the shape exactly symmetric. Before that, an opening (min then max,
# 3 px) wipes the ebony's bright grain lines, which are 1-2 px wide; after the
# cut, any enclosed hole is filled, since these inlays have none (dark bands in
# the pearl's figure would otherwise leave slits).
import re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = 'ebay.jpg'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'svg'
S = 4                                   # upsample factor
WOOD, CUT = 75, 0.5                     # median ebony level; cut level
SMOOTH = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0   # source pixels

L = Image.open(SRC).convert('L')
L = L.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))   # drop grain lines
L = L.filter(ImageFilter.GaussianBlur(0.6))
A = np.asarray(L).astype(float)

# (name, y0, y1, x0, x1) in source pixels
PIECES = [
    ('marker-01',   27,  209, 1040, 1360),
    ('marker-02',  217,  401, 1040, 1360),   # two stacked pieces
    ('marker-03',  429,  617, 1040, 1360),
    ('marker-04',  645,  768, 1040, 1360),
    ('marker-05',  824,  943, 1040, 1360),
    ('marker-06',  979, 1106, 1040, 1360),
    ('marker-07', 1127, 1234, 1040, 1360),
    ('marker-08', 1269, 1349, 1036, 1360),
    ('marker-09', 1367, 1458, 1036, 1360),
    ('marker-10', 1473, 1552, 1036, 1360),
    ('diamond',     70,  180,  360,  470),   # top of the peghead
]

def blur(a, sigma):
    """Separable Gaussian blur (Pillow can't blur float images)."""
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    a = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), 1, a)

def centroid_x(a):
    ys, xs = np.nonzero(a > CUT)
    return xs.mean()

def shift_x(a, dx):
    img = Image.fromarray(a.astype(np.float32), mode='F')
    return np.asarray(img.transform(img.size, Image.AFFINE, (1, 0, -dx, 0, 1, 0), resample=Image.BILINEAR))

for n, y0, y1, x0, x1 in PIECES:
    c = A[y0 - 8:y1 + 8, x0:x1]
    pearl = np.percentile(c[c > 150], 60)
    c = np.clip((c - WOOD) / (pearl - WOOD), 0, 1.2)
    h, w = c.shape
    u = np.asarray(Image.fromarray(c.astype(np.float32), mode='F').resize((w * S, h * S), Image.BICUBIC))
    cx = centroid_x(u)
    m = u[:, ::-1]
    m = shift_x(m, cx - centroid_x(m))
    u = (u + m) / 2
    # smooth the averaged field by ~1 source pixel: removes ragged edges left by
    # pearl figure at the rim and the photo's slight skew between the halves
    u = blur(u, SMOOTH * S)
    ys, xs = np.nonzero(u > CUT)
    pad = 3 * S
    u = u[max(ys.min() - pad, 0):ys.max() + pad, max(xs.min() - pad, 0):xs.max() + pad]
    bmp = Image.fromarray(np.where(u > CUT, 0, 255).astype(np.uint8)).copy()  # shape black; copy: fromarray is read-only
    ImageDraw.floodfill(bmp, (0, 0), 128)                                 # mark the outside
    bmp = bmp.point(lambda v: 255 if v == 128 else 0).convert('1')        # holes join the shape
    bmp.save('pbm4/%s.pbm' % n)
    out = '%s/%s.svg' % (OUT, n)
    subprocess.run(['potrace', '-s', '-t', '150', '-a', '1.1', '-O', '0.2', 'pbm4/%s.pbm' % n, '-o', out], check=True)
    s = open(out).read()
    s = re.sub(r'<\?xml.*?\?>\s*', '', s, flags=re.S); s = re.sub(r'<!DOCTYPE.*?>\s*', '', s, flags=re.S)
    s = re.sub(r'<metadata>.*?</metadata>\s*', '', s, flags=re.S)
    s = s.replace('fill="#000000"', 'fill="currentColor"')
    hh, ww = u.shape
    s = re.sub(r'width="[\d.]+pt" height="[\d.]+pt"', 'width="%d" height="%d"' % (round(ww / S), round(hh / S)), s)
    open(out, 'w').write(s)
    print(n, round(ww / S), round(hh / S))
