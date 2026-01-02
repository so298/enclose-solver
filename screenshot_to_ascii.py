#!/usr/bin/env python3
"""
enclose_horse_screenshot_to_ascii.py

Usage:
  # auto gridline detection
  python enclose_horse_screenshot_to_ascii.py screenshot.png

  # manual grid size (rows, cols)
  python enclose_horse_screenshot_to_ascii.py screenshot.png --rows 16 --cols 19

  # manual grid size + crop (fractions of width/height)
  # crop = left,top,right,bottom (0.0..0.5 recommended)
  python enclose_horse_screenshot_to_ascii.py screenshot.png --rows 16 --cols 19 --crop 0.02,0.02,0.02,0.04

Output chars:
  '.' grass
  '#' water
  'H' horse
"""

from __future__ import annotations
import argparse
from typing import List, Tuple, Optional

import numpy as np
from PIL import Image, ImageGrab


INF = 10**9


def to_rgb(img: Image.Image) -> np.ndarray:
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    arr = np.array(img)
    if arr.shape[-1] == 4:
        arr = arr[..., :3]
    return arr


def parse_crop(s: str) -> Tuple[float, float, float, float]:
    # "l,t,r,b"
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise ValueError("--crop must be 'left,top,right,bottom' (fractions)")
    vals = tuple(float(p) for p in parts)
    if any(v < 0.0 or v >= 1.0 for v in vals):
        raise ValueError("--crop values must be in [0.0, 1.0)")
    return vals  # type: ignore


def apply_crop(
    img: Image.Image, crop: Tuple[float, float, float, float]
) -> Image.Image:
    w, h = img.size
    l, t, r, b = crop
    x0 = int(round(w * l))
    y0 = int(round(h * t))
    x1 = int(round(w * (1.0 - r)))
    y1 = int(round(h * (1.0 - b)))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("Crop is too large; results in empty image.")
    return img.crop((x0, y0, x1, y1))


def smooth_1d(x: np.ndarray, win: int = 7) -> np.ndarray:
    win = max(3, int(win) | 1)  # odd
    k = np.ones(win, dtype=np.float32) / win
    return np.convolve(x, k, mode="same")


def find_line_centers(
    energy: np.ndarray,
    percentile: float = 92.0,
    group_gap: int = 10,
    smooth_win: int = 7,
) -> List[int]:
    e = smooth_1d(energy.astype(np.float32), smooth_win)
    thr = np.percentile(e, percentile)
    peaks = []
    for i in range(1, len(e) - 1):
        if e[i] > thr and e[i] > e[i - 1] and e[i] >= e[i + 1]:
            peaks.append(i)
    if not peaks:
        return []
    groups = []
    cur = [peaks[0]]
    for p in peaks[1:]:
        if p - cur[-1] <= group_gap:
            cur.append(p)
        else:
            groups.append(cur)
            cur = [p]
    groups.append(cur)
    centers = [int(round(float(np.mean(g)))) for g in groups]
    return centers


def detect_grid_lines(
    rgb: np.ndarray, min_line_percentile: float
) -> Tuple[List[int], List[int]]:
    gray = (
        0.299 * rgb[..., 0].astype(np.float32)
        + 0.587 * rgb[..., 1].astype(np.float32)
        + 0.114 * rgb[..., 2].astype(np.float32)
    )
    gx = np.abs(np.diff(gray, axis=1))
    col_energy = gx.mean(axis=0)
    gy = np.abs(np.diff(gray, axis=0))
    row_energy = gy.mean(axis=1)

    xlines = find_line_centers(col_energy, percentile=min_line_percentile)
    ylines = find_line_centers(row_energy, percentile=min_line_percentile)

    if len(xlines) < 2 or len(ylines) < 2:
        raise RuntimeError(
            f"Failed to detect enough grid lines: x={len(xlines)}, y={len(ylines)}. "
            f"Try --min-line-percentile 90..97, or use --rows/--cols manual mode."
        )
    return xlines, ylines


def classify_tile(patch_rgb: np.ndarray) -> str:
    mean = patch_rgb.reshape(-1, 3).mean(axis=0)
    r, g, b = (float(mean[0]), float(mean[1]), float(mean[2]))
    white = np.mean(
        (patch_rgb[..., 0] > 235)
        & (patch_rgb[..., 1] > 235)
        & (patch_rgb[..., 2] > 235)
    )
    is_water = (b - g > 10.0) and (b - r > 30.0)
    if white > 0.01 and not is_water:
        return "H"
    return "#" if is_water else "."


def build_uniform_lines(ncells: int, length: int) -> List[int]:
    """
    Create ncells+1 boundaries splitting [0,length] nearly evenly.
    This is used in manual mode (rows/cols given).
    """
    # Using linspace is fine; we want monotonic ints
    xs = np.linspace(0, length, ncells + 1)
    lines = [int(round(v)) for v in xs]
    # enforce monotonic non-decreasing and unique-ish
    for i in range(1, len(lines)):
        if lines[i] <= lines[i - 1]:
            lines[i] = lines[i - 1] + 1
    lines[-1] = length
    return lines


def screenshot_to_ascii(
    img: Image.Image,
    *,
    min_line_percentile: float = 92.0,
    inner_crop_ratio: float = 0.18,
    rows: Optional[int] = None,
    cols: Optional[int] = None,
) -> Tuple[List[str], List[int], List[int]]:
    rgb = to_rgb(img)
    H, W = rgb.shape[0], rgb.shape[1]

    if rows is not None or cols is not None:
        if rows is None or cols is None:
            raise ValueError("Manual mode requires BOTH --rows and --cols.")
        if rows <= 0 or cols <= 0:
            raise ValueError("--rows/--cols must be positive.")
        xlines = build_uniform_lines(cols, W - 1)
        ylines = build_uniform_lines(rows, H - 1)
    else:
        xlines, ylines = detect_grid_lines(rgb, min_line_percentile)

    out = []
    nrows = len(ylines) - 1
    ncols = len(xlines) - 1

    for i in range(nrows):
        y0, y1 = ylines[i], ylines[i + 1]
        row_chars = []
        for j in range(ncols):
            x0, x1 = xlines[j], xlines[j + 1]
            dy, dx = (y1 - y0), (x1 - x0)
            m = int(min(dx, dy) * inner_crop_ratio)
            yy0, yy1 = y0 + m, y1 - m
            xx0, xx1 = x0 + m, x1 - m
            if yy1 <= yy0 or xx1 <= xx0:
                row_chars.append("?")
                continue
            patch = rgb[yy0:yy1, xx0:xx1, :]
            row_chars.append(classify_tile(patch))
        out.append("".join(row_chars))

    return out, xlines, ylines


def read_image_from_clipboard() -> Image.Image:
    img = ImageGrab.grabclipboard()
    if img is None:
        raise RuntimeError("クリップボードに画像がありません")
    elif isinstance(img, list):
        # macOS sometimes returns file paths
        if len(img) > 0:
            img = Image.open(img[0])
        else:
            raise RuntimeError("クリップボードに画像がありません")
    elif not isinstance(img, Image.Image):
        raise RuntimeError("クリップボードの内容が画像ではありません")
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "image",
        nargs="?",
        default=None,
        help="Path to screenshot PNG/JPG (optional if --clipboard is used)",
    )
    ap.add_argument(
        "--clipboard",
        action="store_true",
        help="Get image from clipboard instead of file",
    )
    ap.add_argument(
        "--out", default="", help="Write ASCII grid to this file (optional)"
    )

    # manual mode
    ap.add_argument(
        "--rows",
        "-r",
        type=int,
        default=None,
        help="Manual grid rows (enables uniform split)",
    )
    ap.add_argument(
        "--cols",
        "-c",
        type=int,
        default=None,
        help="Manual grid cols (enables uniform split)",
    )
    ap.add_argument(
        "--crop",
        type=str,
        default="",
        help="Optional pre-crop in fractions: left,top,right,bottom (e.g. 0.02,0.02,0.02,0.04)",
    )

    # auto mode params
    ap.add_argument(
        "--min-line-percentile",
        type=float,
        default=92.0,
        help="(auto mode) grid-line detection threshold percentile (try 90..97)",
    )

    ap.add_argument(
        "--inner-crop-ratio",
        type=float,
        default=0.18,
        help="Crop ratio per tile to ignore borders (0.10..0.25)",
    )
    ap.add_argument(
        "--print-info", action="store_true", help="Print detected size/lines info"
    )
    args = ap.parse_args()

    # Get image from clipboard or file
    if args.clipboard:
        img = read_image_from_clipboard()
    elif args.image:
        img = Image.open(args.image)
    else:
        print(
            "エラー: 画像ファイルを指定するか、--clipboard オプションを使用してください"
        )
        return

    if args.crop:
        img = apply_crop(img, parse_crop(args.crop))

    grid_rows, xlines, ylines = screenshot_to_ascii(
        img,
        min_line_percentile=args.min_line_percentile,
        inner_crop_ratio=args.inner_crop_ratio,
        rows=args.rows,
        cols=args.cols,
    )

    text = "\n".join(grid_rows)
    if args.print_info:
        print(f"rows={len(ylines)-1}, cols={len(xlines)-1}")
        # print a short preview of line positions
        print(f"xlines[:5]={xlines[:5]} ... xlines[-5:]={xlines[-5:]}")
        print(f"ylines[:5]={ylines[:5]} ... ylines[-5:]={ylines[-5:]}")
        print()

    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    main()
