"""
Synthetic Thai plate number lines ("1กข 1234") for training the plate-text recognizer.

Each sample is the number line of a plate: optional leading digit, one or two consonants, a
gap, then one to four digits, drawn in a bold Thai font on plate-coloured paint, then made
realistic: embossing, dirt, uneven light, blur, noise, perspective, JPEG artefacts, and a
loose crop like the one the app's line finder produces.

Labels have no spaces: leading digits, letters and trailing digits are unambiguous.
"""

from __future__ import annotations

import io
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DIGITS = "0123456789"
# Same set as lib/plate/chars.ts: ก..ฮ without ฃ ฅ ฤ ฦ.
CONSONANTS = "".join(chr(c) for c in range(0x0E01, 0x0E2F) if chr(c) not in "ฃฅฤฦ")
CHARSET = DIGITS + CONSONANTS  # index + 1 in the model output (0 is the CTC blank)

HEIGHT = 48
WIDTH = 192

FONT_DIR = Path("C:/Windows/Fonts")
# Bold Thai faces installed on Windows. Real plates use a bold, looped face.
FONT_FILES = [
    ("tahomabd.ttf", 0),
    ("tahoma.ttf", 0),
    ("leelawdb.ttf", 0),
    ("LeelaUIb.ttf", 0),
    ("upcdb.ttf", 0),
    ("upceb.ttf", 0),
    ("upcfb.ttf", 0),
    ("upcib.ttf", 0),
    ("upcjb.ttf", 0),
    ("upckb.ttf", 0),
    ("upclb.ttf", 0),
    ("angsana.ttc", 1),  # Angsana New Bold
    ("browalia.ttc", 1),
    ("cordia.ttc", 1),
]

PAINTS = [
    ((238, 238, 232), 0.55),  # white private plates
    ((250, 250, 245), 0.1),
    ((225, 190, 45), 0.12),  # yellow (taxi, old plates)
    ((215, 235, 215), 0.08),  # light green patterned
    ((200, 200, 200), 0.08),  # silver / reflective
    ((245, 235, 200), 0.07),  # aged
]
INKS = [((20, 20, 20), 0.7), ((25, 90, 45), 0.2), ((30, 30, 110), 0.05), ((80, 20, 20), 0.05)]


def _pick(weighted):
    r = random.random() * sum(w for _, w in weighted)
    for value, w in weighted:
        r -= w
        if r <= 0:
            return value
    return weighted[-1][0]


def random_text() -> str:
    prefix = str(random.randint(1, 9)) if random.random() < 0.6 else ""
    letters = "".join(random.choice(CONSONANTS) for _ in range(2 if random.random() < 0.9 else 1))
    n = random.choices([1, 2, 3, 4], weights=[0.05, 0.1, 0.25, 0.6])[0]
    number = str(random.randint(1, 9)) + "".join(random.choice(DIGITS) for _ in range(n - 1))
    return prefix + letters + number


@dataclass
class Fonts:
    faces: list

    @classmethod
    def load(cls, size: int = 96) -> "Fonts":
        faces = []
        for name, index in FONT_FILES:
            path = FONT_DIR / name
            if path.exists():
                faces.append(ImageFont.truetype(str(path), size, index=index))
        if not faces:
            raise SystemExit("no Thai fonts found")
        return cls(faces)


def render(text: str, fonts: Fonts) -> Image.Image:
    """Draw the line large, with a gap between series and number, then degrade it."""
    font = random.choice(fonts.faces)
    paint = np.array(_pick(PAINTS)) + np.random.randint(-12, 12, 3)
    ink = np.array(_pick(INKS)) + np.random.randint(-10, 10, 3)

    # Split into series and number for the visible gap.
    i = len(text)
    while i > 0 and text[i - 1].isdigit():
        i -= 1
    series, number = text[:i], text[i:]
    gap = " " * random.choice([1, 1, 2, 3])
    shown = series + gap + number

    probe = Image.new("L", (10, 10))
    x0, y0, x1, y1 = ImageDraw.Draw(probe).textbbox((0, 0), shown, font=font)
    tw, th = x1 - x0, y1 - y0
    # Horizontal squeeze/stretch like condensed plate lettering.
    squeeze = random.uniform(0.7, 1.15)
    padx = random.randint(4, 40)
    pady_t = random.randint(4, 30)
    pady_b = random.randint(4, 30)
    W = tw + 2 * padx
    H = th + pady_t + pady_b
    img = Image.new("RGB", (W, H), tuple(int(v) for v in np.clip(paint, 0, 255)))
    draw = ImageDraw.Draw(img)

    # Emboss: a lighter and a darker copy offset around the text.
    if random.random() < 0.6:
        off = random.randint(1, 3)
        hi = tuple(int(v) for v in np.clip(paint + 25, 0, 255))
        lo = tuple(int(v) for v in np.clip(paint - 45, 0, 255))
        draw.text((padx - x0 - off, pady_t - y0 - off), shown, font=font, fill=hi)
        draw.text((padx - x0 + off, pady_t - y0 + off), shown, font=font, fill=lo)
    stroke = random.choice([0, 0, 1, 2, 3])
    draw.text(
        (padx - x0, pady_t - y0),
        shown,
        font=font,
        fill=tuple(int(v) for v in np.clip(ink, 0, 255)),
        stroke_width=stroke,
        stroke_fill=tuple(int(v) for v in np.clip(ink, 0, 255)),
    )
    img = img.resize((max(8, int(W * squeeze)), H), Image.BICUBIC)

    # Real crops often catch the top of the province line or a frame edge at the bottom/top.
    if random.random() < 0.35:
        d = ImageDraw.Draw(img)
        small = random.choice(fonts.faces).font_variant(size=random.randint(28, 44))
        name = "".join(random.choice(CONSONANTS + "าิีุูเแโะัำ่้") for _ in range(random.randint(5, 12)))
        y = img.height - random.randint(4, 14)
        d.text((random.randint(0, max(1, img.width // 3)), y), name, font=small,
               fill=tuple(int(v) for v in np.clip(ink, 0, 255)))
    if random.random() < 0.25:
        d = ImageDraw.Draw(img)
        y = random.choice([random.randint(0, 3), img.height - random.randint(1, 4)])
        d.rectangle([0, y, img.width, y + random.randint(1, 4)], fill=tuple(int(v) for v in np.clip(ink, 0, 255)))

    # Plate border / frame fragments at the crop edges (the line finder leaves some margin).
    if random.random() < 0.3:
        d = ImageDraw.Draw(img)
        c = tuple(int(v) for v in np.clip(ink, 0, 255))
        w_ = random.randint(2, 6)
        if random.random() < 0.5:
            d.rectangle([0, 0, w_, img.height], fill=c)
        if random.random() < 0.5:
            d.rectangle([img.width - w_, 0, img.width, img.height], fill=c)

    arr = np.asarray(img).astype(np.float32)

    # Uneven light: a smooth gradient.
    gy, gx = np.mgrid[0 : arr.shape[0], 0 : arr.shape[1]]
    grad = (gx / arr.shape[1] * random.uniform(-60, 60) + gy / arr.shape[0] * random.uniform(-40, 40))
    arr += grad[..., None]
    # Dirt: dark soft blobs.
    for _ in range(random.choice([0, 0, 1, 2, 4])):
        cx, cy = random.randint(0, arr.shape[1]), random.randint(0, arr.shape[0])
        r = random.randint(3, max(4, arr.shape[0] // 2))
        mask = ((gx - cx) ** 2 + (gy - cy) ** 2) < r * r
        arr[mask] *= random.uniform(0.5, 0.9)
    # Glare.
    if random.random() < 0.2:
        cx = random.randint(0, arr.shape[1])
        arr += (np.exp(-((gx - cx) ** 2) / (2 * (arr.shape[1] / 8) ** 2)) * random.uniform(30, 90))[..., None]
    arr += np.random.normal(0, random.uniform(0, 12), arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    # Perspective / rotation.
    if random.random() < 0.7:
        w_, h_ = img.size
        m = 0.08
        src = [(0, 0), (w_, 0), (w_, h_), (0, h_)]
        dst = [(x + random.uniform(-m, m) * w_, y + random.uniform(-m, m) * h_) for x, y in src]
        coeffs = _perspective_coeffs(dst, src)
        img = img.transform(img.size, Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=tuple(int(v) for v in paint))

    if random.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.6)))
    # Low resolution then back (far-away plates).
    if random.random() < 0.4:
        s = random.uniform(0.25, 0.7)
        small = img.resize((max(8, int(img.width * s)), max(8, int(img.height * s))), Image.BILINEAR)
        img = small.resize(img.size, Image.BILINEAR)
    if random.random() < 0.6:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=random.randint(25, 90))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def _perspective_coeffs(pa, pb):
    matrix = []
    for p1, p2 in zip(pa, pb):
        matrix.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        matrix.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.array(matrix, dtype=np.float64)
    B = np.array(pb, dtype=np.float64).reshape(8)
    return np.linalg.solve(A, B).tolist()


def to_input(img: Image.Image) -> np.ndarray:
    """Grey, resized to HEIGHT keeping aspect, padded/squeezed to WIDTH; float32 in [0, 1]."""
    g = img.convert("L")
    w = max(1, round(g.width * HEIGHT / g.height))
    g = g.resize((min(w, WIDTH), HEIGHT), Image.BILINEAR)
    out = Image.new("L", (WIDTH, HEIGHT), int(np.median(np.asarray(g))))
    out.paste(g, (0, 0))
    a = np.asarray(out).astype(np.float32) / 255.0
    # Per-image contrast normalisation (the browser does the same).
    lo, hi = np.percentile(a, 2), np.percentile(a, 98)
    return np.clip((a - lo) / max(1e-3, hi - lo), 0, 1)


def encode(text: str) -> list[int]:
    return [CHARSET.index(c) + 1 for c in text]


def decode(indices) -> str:
    out, prev = [], 0
    for i in indices:
        if i != prev and i != 0:
            out.append(CHARSET[i - 1])
        prev = i
    return "".join(out)


if __name__ == "__main__":
    import sys

    fonts = Fonts.load()
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "synth_preview.png")
    rows = []
    for _ in range(24):
        t = random_text()
        rows.append((render(t, fonts), t))
    sheet = Image.new("L", (WIDTH * 2 + 20, (HEIGHT + 6) * 12), 128)
    for k, (img, t) in enumerate(rows):
        a = (to_input(img) * 255).astype(np.uint8)
        sheet.paste(Image.fromarray(a), ((k % 2) * (WIDTH + 20), (k // 2) * (HEIGHT + 6)))
    sheet.save(out)
    print(len(CHARSET), "classes;", [t for _, t in rows[:6]])
