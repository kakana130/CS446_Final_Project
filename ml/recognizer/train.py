"""
Train the plate-text recognizer (CTC) on synthetic number lines; evaluate on real ones.

    python ml/recognizer/train.py --data <dir> [--real <dir with truth.json>] [--samples 150000]

Writes <data>/model.pt (best on the real set if given, else on synthetic validation).
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image

import synth

torch.backends.cudnn.benchmark = True


class Recognizer(nn.Module):
    """Small all-convolutional CRNN: image 1×48×192 → 48 time steps × (classes + blank)."""

    def __init__(self, classes: int = len(synth.CHARSET) + 1):
        super().__init__()

        def block(cin, cout):
            return [nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True)]

        self.features = nn.Sequential(
            *block(1, 32), nn.MaxPool2d(2),  # 24×96
            *block(32, 64), nn.MaxPool2d(2),  # 12×48
            *block(64, 96), *block(96, 96), nn.MaxPool2d((2, 1)),  # 6×48
            *block(96, 160), *block(160, 160), nn.MaxPool2d((2, 1)),  # 3×48
            nn.Conv2d(160, 192, (3, 1), bias=False), nn.BatchNorm2d(192), nn.ReLU(inplace=True),  # 1×48
        )
        self.head = nn.Sequential(
            nn.Conv1d(192, 192, 3, padding=1), nn.ReLU(inplace=True),
            nn.Conv1d(192, 192, 3, padding=1), nn.ReLU(inplace=True),
            nn.Dropout(0.1),
            nn.Conv1d(192, classes, 1),
        )

    def forward(self, x):  # x: N×1×48×192 in [0, 1]
        f = self.features(x).squeeze(2)  # N×192×48
        return self.head(f)  # N×C×48 (logits)


# ------------------------------------------------------------------------------ data


def _gen(args):
    seed, n = args
    random.seed(seed)
    np.random.seed(seed % (2**32))
    fonts = synth.Fonts.load()
    xs = np.zeros((n, synth.HEIGHT, synth.WIDTH), np.uint8)
    ys = []
    for i in range(n):
        t = synth.random_text()
        xs[i] = (synth.to_input(synth.render(t, fonts)) * 255).astype(np.uint8)
        ys.append(t)
    return xs, ys


def generate(n: int, workers: int, seed: int):
    chunk = 2000
    jobs = [(seed * 100_000 + k, min(chunk, n - k * chunk)) for k in range((n + chunk - 1) // chunk)]
    with mp.Pool(workers) as pool:
        parts = pool.map(_gen, jobs)
    return np.concatenate([p[0] for p in parts]), sum((p[1] for p in parts), [])


def load_real(folder: Path):
    items = json.loads((folder / "truth.json").read_text(encoding="utf8"))
    xs, ys = [], []
    for it in items:
        img = Image.open(folder / it["file"]).convert("RGB")
        xs.append((synth.to_input(img) * 255).astype(np.uint8))
        ys.append(it["text"])
    return np.stack(xs), ys


def batches(xs, ys, size, shuffle):
    idx = np.arange(len(xs))
    if shuffle:
        np.random.shuffle(idx)
    for i in range(0, len(idx), size):
        j = idx[i : i + size]
        yield xs[j], [ys[k] for k in j]


def to_tensor(xb, device):
    return torch.from_numpy(xb).float().div_(255).unsqueeze(1).to(device, non_blocking=True)


def evaluate(model, xs, ys, device):
    model.eval()
    right = 0
    char_err = 0
    chars = 0
    preds = []
    with torch.no_grad():
        for xb, yb in batches(xs, ys, 512, False):
            out = model(to_tensor(xb, device)).argmax(1).cpu().numpy()
            for o, y in zip(out, yb):
                p = synth.decode(o.tolist())
                preds.append(p)
                right += p == y
                chars += len(y)
                char_err += _edit(p, y)
    model.train()
    return right / max(1, len(ys)), 1 - char_err / max(1, chars), preds


def _edit(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


# ----------------------------------------------------------------------------- train


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--real")
    ap.add_argument("--samples", type=int, default=150_000)
    ap.add_argument("--epochs", type=int, default=24)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()
    data = Path(args.data)
    data.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    cache = data / f"synth_{args.samples}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        xs, ys = z["xs"], list(z["ys"])
    else:
        t0 = time.time()
        xs, ys = generate(args.samples, args.workers, seed=1)
        np.savez(cache, xs=xs, ys=np.array(ys, dtype=object))
        print(f"generated {len(xs)} in {time.time() - t0:.0f}s")
    vx, vy = generate(4000, args.workers, seed=999)
    real = load_real(Path(args.real)) if args.real else None

    model = Recognizer().to(device)
    print("params", sum(p.numel() for p in model.parameters()))
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = args.epochs * ((len(xs) + 255) // 256)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.1)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    best = -1.0
    for epoch in range(args.epochs):
        t0 = time.time()
        total = 0.0
        for xb, yb in batches(xs, ys, 256, True):
            x = to_tensor(xb, device)
            # Light on-the-fly augmentation: random invert-free contrast/brightness and shifts.
            if random.random() < 0.5:
                x = (x * torch.empty(x.size(0), 1, 1, 1, device=device).uniform_(0.7, 1.2)).clamp_(0, 1)
            logits = model(x)  # N×C×T
            logp = logits.log_softmax(1).permute(2, 0, 1)  # T×N×C
            targets = torch.tensor([c for y in yb for c in synth.encode(y)], dtype=torch.long)
            tl = torch.tensor([len(y) for y in yb], dtype=torch.long)
            il = torch.full((len(yb),), logp.size(0), dtype=torch.long)
            loss = ctc(logp, targets, il, tl)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            opt.step()
            sched.step()
            total += loss.item() * len(yb)
        acc, cacc, _ = evaluate(model, vx, vy, device)
        msg = f"epoch {epoch + 1:2d} loss {total / len(xs):.3f} synth exact {acc:.3f} chars {cacc:.3f}"
        score = acc
        if real is not None:
            racc, rcacc, preds = evaluate(model, real[0], real[1], device)
            msg += f" | real exact {racc:.3f} chars {rcacc:.3f}"
            score = rcacc + racc
        print(msg, f"({time.time() - t0:.0f}s)", flush=True)
        if score > best:
            best = score
            torch.save(model.state_dict(), data / "model.pt")
    if real is not None:
        model.load_state_dict(torch.load(data / "model.pt"))
        racc, rcacc, preds = evaluate(model, real[0], real[1], device)
        print(f"best real exact {racc:.3f} chars {rcacc:.3f}")
        for p, y in zip(preds, real[1]):
            if p != y:
                print("   ", y, "->", p)


if __name__ == "__main__":
    mp.freeze_support()
    main()
