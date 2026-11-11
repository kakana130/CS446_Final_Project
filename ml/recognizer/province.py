"""
EXPERIMENTAL, not shipped (D-074): on real plates it scored 50–70% while OCR + snapping
already gets about 70%. Needs province text closer to the real plate font, or real data.

Province-line classifier: the province name printed under the number (78 classes, same list as
data/provinces.json). Trained on synthetic province lines, evaluated on real ones.

    python ml/recognizer/province.py train --data <dir> [--real <dir with truth.json>]
    python ml/recognizer/province.py export <model.pt> <out.bin>
"""

from __future__ import annotations

import argparse
import io
import json
import multiprocessing as mp
import random
import struct
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter

import synth

ROOT = Path(__file__).resolve().parents[2]
PROVINCES = json.loads((ROOT / "data" / "provinces.json").read_text(encoding="utf8"))
CODES = [p["code"] for p in PROVINCES]
NAMES = [p["name_th"] for p in PROVINCES]
HEIGHT, WIDTH = 32, 256


def render(name: str, fonts: synth.Fonts) -> Image.Image:
    font = random.choice(fonts.faces)
    paint = np.array(synth._pick(synth.PAINTS)) + np.random.randint(-12, 12, 3)
    ink = np.array(synth._pick(synth.INKS)) + np.random.randint(-10, 10, 3)
    probe = ImageDraw.Draw(Image.new("L", (10, 10)))
    x0, y0, x1, y1 = probe.textbbox((0, 0), name, font=font)
    padx, pt, pb = random.randint(4, 40), random.randint(4, 24), random.randint(4, 24)
    img = Image.new("RGB", (x1 - x0 + 2 * padx, y1 - y0 + pt + pb), tuple(int(v) for v in np.clip(paint, 0, 255)))
    d = ImageDraw.Draw(img)
    if random.random() < 0.5:
        lo = tuple(int(v) for v in np.clip(paint - 45, 0, 255))
        d.text((padx - x0 + 1, pt - y0 + 1), name, font=font, fill=lo)
    d.text((padx - x0, pt - y0), name, font=font, fill=tuple(int(v) for v in np.clip(ink, 0, 255)),
           stroke_width=random.choice([0, 0, 1]), stroke_fill=tuple(int(v) for v in np.clip(ink, 0, 255)))
    img = img.resize((max(8, int(img.width * random.uniform(0.75, 1.15))), img.height), Image.BICUBIC)
    # Bits of the number line above or the plate edge below leak into real crops.
    if random.random() < 0.4:
        d = ImageDraw.Draw(img)
        c = tuple(int(v) for v in np.clip(ink, 0, 255))
        y = random.choice([0, img.height - random.randint(2, 6)])
        for _ in range(random.randint(2, 8)):
            x = random.randint(0, img.width)
            d.rectangle([x, y, x + random.randint(5, 40), y + random.randint(2, 6)], fill=c)
    arr = np.asarray(img).astype(np.float32)
    gy, gx = np.mgrid[0 : arr.shape[0], 0 : arr.shape[1]]
    arr += (gx / arr.shape[1] * random.uniform(-60, 60))[..., None]
    for _ in range(random.choice([0, 0, 1, 3])):
        cx, cy, r = random.randint(0, arr.shape[1]), random.randint(0, arr.shape[0]), random.randint(3, arr.shape[0])
        arr[((gx - cx) ** 2 + (gy - cy) ** 2) < r * r] *= random.uniform(0.5, 0.9)
    arr += np.random.normal(0, random.uniform(0, 12), arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if random.random() < 0.6:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.5)))
    if random.random() < 0.5:
        s = random.uniform(0.25, 0.7)
        img = img.resize((max(8, int(img.width * s)), max(8, int(img.height * s))), Image.BILINEAR).resize(img.size, Image.BILINEAR)
    if random.random() < 0.6:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=random.randint(25, 90))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def to_input(img: Image.Image) -> np.ndarray:
    g = img.convert("L")
    w = max(1, round(g.width * HEIGHT / g.height))
    g = g.resize((min(w, WIDTH), HEIGHT), Image.BILINEAR)
    out = Image.new("L", (WIDTH, HEIGHT), int(np.median(np.asarray(g))))
    out.paste(g, (0, 0))
    a = np.asarray(out).astype(np.float32) / 255.0
    lo, hi = np.percentile(a, 2), np.percentile(a, 98)
    return np.clip((a - lo) / max(1e-3, hi - lo), 0, 1)


class ProvinceNet(nn.Module):
    def __init__(self, classes: int = len(CODES)):
        super().__init__()

        def block(cin, cout):
            return [nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True)]

        self.features = nn.Sequential(
            *block(1, 32), nn.MaxPool2d(2),  # 16×128
            *block(32, 64), nn.MaxPool2d(2),  # 8×64
            *block(64, 96), nn.MaxPool2d(2),  # 4×32
            *block(96, 128), nn.MaxPool2d(2),  # 2×16
            nn.Conv2d(128, 160, (2, 1), bias=False), nn.BatchNorm2d(160), nn.ReLU(inplace=True),  # 1×16
        )
        self.classifier = nn.Conv1d(160, classes, 1)

    def forward(self, x):
        f = self.features(x).squeeze(2).mean(2, keepdim=True)  # N×160×1
        return self.classifier(f).squeeze(2)


def _gen(args):
    seed, n = args
    random.seed(seed)
    np.random.seed(seed % (2**32))
    fonts = synth.Fonts.load(64)
    xs = np.zeros((n, HEIGHT, WIDTH), np.uint8)
    ys = np.zeros(n, np.int64)
    for i in range(n):
        k = random.randrange(len(NAMES))
        xs[i] = (to_input(render(NAMES[k], fonts)) * 255).astype(np.uint8)
        ys[i] = k
    return xs, ys


def generate(n, workers, seed):
    jobs = [(seed * 100_000 + k, min(2000, n - k * 2000)) for k in range((n + 1999) // 2000)]
    with mp.Pool(workers) as pool:
        parts = pool.map(_gen, jobs)
    return np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts])


def load_real(folder: Path):
    items = json.loads((folder / "truth.json").read_text(encoding="utf8"))
    xs, ys = [], []
    for it in items:
        if it["code"] not in CODES:
            continue
        xs.append((to_input(Image.open(folder / it["file"]).convert("RGB")) * 255).astype(np.uint8))
        ys.append(CODES.index(it["code"]))
    return np.stack(xs), np.array(ys)


def train(args):
    data = Path(args.data)
    data.mkdir(parents=True, exist_ok=True)
    device = "cuda"
    cache = data / f"prov_{args.samples}.npz"
    if cache.exists():
        z = np.load(cache)
        xs, ys = z["xs"], z["ys"]
    else:
        t0 = time.time()
        xs, ys = generate(args.samples, args.workers, 3)
        np.savez(cache, xs=xs, ys=ys)
        print(f"generated {len(xs)} in {time.time() - t0:.0f}s", flush=True)
    vx, vy = generate(4000, args.workers, 998)
    real = load_real(Path(args.real)) if args.real else None
    model = ProvinceNet().to(device)
    print("params", sum(p.numel() for p in model.parameters()), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = args.epochs * ((len(xs) + 255) // 256)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.1)
    lossf = nn.CrossEntropyLoss(label_smoothing=0.05)

    def acc(x, y):
        model.eval()
        right = 0
        with torch.no_grad():
            for i in range(0, len(x), 512):
                t = torch.from_numpy(x[i : i + 512]).float().div(255).unsqueeze(1).to(device)
                right += (model(t).argmax(1).cpu().numpy() == y[i : i + 512]).sum()
        model.train()
        return right / len(x)

    best = -1
    for epoch in range(args.epochs):
        idx = np.random.permutation(len(xs))
        for i in range(0, len(idx), 256):
            j = idx[i : i + 256]
            x = torch.from_numpy(xs[j]).float().div(255).unsqueeze(1).to(device)
            loss = lossf(model(x), torch.from_numpy(ys[j]).to(device))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
        msg = f"epoch {epoch + 1:2d} synth {acc(vx, vy):.3f}"
        score = acc(vx, vy)
        if real is not None:
            r = acc(*real)
            msg += f" | real {r:.3f}"
            score = r + score * 0.01
        print(msg, flush=True)
        if score > best:
            best = score
            torch.save(model.state_dict(), data / "province.pt")


def export(args):
    from export import fold

    model = ProvinceNet()
    model.load_state_dict(torch.load(args.model, map_location="cpu"))
    model.eval()
    ops = []
    mods = list(model.features)
    i = 0
    while i < len(mods):
        m = mods[i]
        if isinstance(m, nn.Conv2d):
            bn = mods[i + 1] if isinstance(mods[i + 1], nn.BatchNorm2d) else None
            w, b = fold(m, bn)
            ops.append({"op": "conv2d", "w": w, "b": b, "pad": [m.padding[0], m.padding[1]]})
            i += 2 if bn is not None else 1
        elif isinstance(m, nn.ReLU):
            ops.append({"op": "relu"})
            i += 1
        else:
            k = m.kernel_size if isinstance(m.kernel_size, tuple) else (m.kernel_size, m.kernel_size)
            ops.append({"op": "maxpool", "k": [k[0], k[1]]})
            i += 1
    ops.append({"op": "squeeze_h"})
    ops.append({"op": "mean_w"})
    c = model.classifier
    ops.append({"op": "conv2d", "w": c.weight.detach().numpy()[:, :, None, :], "b": c.bias.detach().numpy(), "pad": [0, 0]})
    header = {"version": 1, "height": HEIGHT, "width": WIDTH, "labels": CODES, "ops": []}
    blobs, offset = [], 0
    for op in ops:
        entry = {k: v for k, v in op.items() if k not in ("w", "b")}
        if "w" in op:
            w = op["w"].astype(np.float16)
            b = op["b"].astype(np.float16)
            entry["shape"], entry["offset"] = list(w.shape), offset
            blobs += [w.tobytes(), b.tobytes()]
            offset += w.size + b.size
        header["ops"].append(entry)
    head = json.dumps(header, ensure_ascii=False).encode("utf8")
    with open(args.out, "wb") as f:
        f.write(b"P2HR" + struct.pack("<I", len(head)) + head + b"".join(blobs))
    print("wrote", args.out, f"{(8 + len(head) + offset * 2) / 1024:.0f} KB")


if __name__ == "__main__":
    mp.freeze_support()
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--data", required=True)
    t.add_argument("--real")
    t.add_argument("--samples", type=int, default=120_000)
    t.add_argument("--epochs", type=int, default=16)
    t.add_argument("--workers", type=int, default=10)
    e = sub.add_parser("export")
    e.add_argument("model")
    e.add_argument("out")
    a = ap.parse_args()
    train(a) if a.cmd == "train" else export(a)
