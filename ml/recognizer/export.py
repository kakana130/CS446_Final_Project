"""
Export the trained recognizer for the browser (lib/ocr/recognizer.ts).

    python ml/recognizer/export.py <model.pt> <out.bin> [<test-vector.json>]

Format (little endian): "P2HR" magic, uint32 header length, UTF-8 JSON header, then float16
weights. BatchNorm is folded into the preceding convolution, so the browser only runs
conv → (relu) → (maxpool) layers and a 1-D head. The optional test vector holds a few inputs
and PyTorch's logits, to check the TypeScript runtime gives the same answer.
"""

from __future__ import annotations

import json
import struct
import sys

import numpy as np
import torch
import torch.nn as nn

import synth
from train import Recognizer


def fold(conv: nn.Conv2d, bn: nn.BatchNorm2d | None):
    w = conv.weight.detach().double()
    b = conv.bias.detach().double() if conv.bias is not None else torch.zeros(w.shape[0], dtype=torch.float64)
    if bn is not None:
        scale = bn.weight.detach().double() / torch.sqrt(bn.running_var.double() + bn.eps)
        w = w * scale.view(-1, 1, 1, 1)
        b = (b - bn.running_mean.double()) * scale + bn.bias.detach().double()
    return w.float().numpy(), b.float().numpy()


def layers_of(model: Recognizer):
    """Flatten the network into simple ops the browser runtime understands."""
    ops = []
    mods = list(model.features)
    i = 0
    while i < len(mods):
        m = mods[i]
        if isinstance(m, nn.Conv2d):
            bn = mods[i + 1] if i + 1 < len(mods) and isinstance(mods[i + 1], nn.BatchNorm2d) else None
            w, b = fold(m, bn)
            ops.append({"op": "conv2d", "w": w, "b": b, "pad": [m.padding[0], m.padding[1]]})
            i += 2 if bn is not None else 1
        elif isinstance(m, nn.ReLU):
            ops.append({"op": "relu"})
            i += 1
        elif isinstance(m, nn.MaxPool2d):
            k = m.kernel_size if isinstance(m.kernel_size, tuple) else (m.kernel_size, m.kernel_size)
            ops.append({"op": "maxpool", "k": [k[0], k[1]]})
            i += 1
        else:
            raise SystemExit(f"unsupported layer {m}")
    ops.append({"op": "squeeze_h"})
    for m in model.head:
        if isinstance(m, nn.Conv1d):
            w = m.weight.detach().float().numpy()[:, :, None, :]  # as conv2d with height 1
            ops.append({"op": "conv2d", "w": w, "b": m.bias.detach().float().numpy(), "pad": [0, m.padding[0]]})
        elif isinstance(m, nn.ReLU):
            ops.append({"op": "relu"})
        elif isinstance(m, nn.Dropout):
            pass
        else:
            raise SystemExit(f"unsupported head layer {m}")
    return ops


def main():
    model = Recognizer()
    model.load_state_dict(torch.load(sys.argv[1], map_location="cpu"))
    model.eval()
    ops = layers_of(model)
    header = {"version": 1, "height": synth.HEIGHT, "width": synth.WIDTH, "charset": synth.CHARSET, "ops": []}
    blobs = []
    offset = 0
    for op in ops:
        entry = {k: v for k, v in op.items() if k not in ("w", "b")}
        if "w" in op:
            w = op["w"].astype(np.float16)
            b = op["b"].astype(np.float16)
            entry["shape"] = list(w.shape)  # [out, in, kh, kw]
            entry["offset"] = offset
            blobs += [w.tobytes(), b.tobytes()]
            offset += w.size + b.size
        header["ops"].append(entry)
    head = json.dumps(header, ensure_ascii=False).encode("utf8")
    with open(sys.argv[2], "wb") as f:
        f.write(b"P2HR")
        f.write(struct.pack("<I", len(head)))
        f.write(head)
        f.write(b"".join(blobs))
    print("wrote", sys.argv[2], f"{(8 + len(head) + offset * 2) / 1024:.0f} KB,", len(ops), "ops")

    if len(sys.argv) > 3:
        import base64
        import random

        random.seed(7)
        np.random.seed(7)
        fonts = synth.Fonts.load()
        cases = []
        for _ in range(3):
            t = synth.random_text()
            q = (synth.to_input(synth.render(t, fonts)) * 255).round().astype(np.uint8)
            x = q.astype(np.float32) / 255.0
            with torch.no_grad():
                logits = model(torch.from_numpy(x)[None, None]).numpy()[0]
            cases.append(
                {
                    "text": t,
                    "input": base64.b64encode(q.tobytes()).decode(),
                    "argmax": logits.argmax(0).tolist(),
                    "decoded": synth.decode(logits.argmax(0).tolist()),
                }
            )
        json.dump({"cases": cases}, open(sys.argv[3], "w", encoding="utf8"), ensure_ascii=False)
        print("wrote test vector")


if __name__ == "__main__":
    main()
