#!/usr/bin/env python3
"""首页动态美食墙缩略图

把 public/dishes/*.jpg（原图 3:2，平均 100KB）压成 1.5:1 的 400×267 WebP（约 20KB），
动态墙一次要填几十上百张图，用原图会把首屏拖到十几 MB。

用法：
    python scripts/gen-wall-thumbs.py            # 全部重生成
    python scripts/gen-wall-thumbs.py --force    # 忽略时间戳

输出：public/wall/<菜名>.webp（与 public/dishes/<id>.jpg 一一对应）
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'dishes'
OUT = ROOT / 'public' / 'wall'
SIZE = (400, 267)  # 1.5:1
QUALITY = 72


def center_crop_15(im: Image.Image) -> Image.Image:
    w, h = im.size
    target = SIZE[0] / SIZE[1]
    if w / h > target:  # 太宽：裁左右
        nw = int(h * target)
        left = (w - nw) // 2
        return im.crop((left, 0, left + nw, h))
    nh = int(w / target)  # 太高：裁上下
    top = (h - nh) // 2
    return im.crop((0, top, w, top + nh))


def main() -> int:
    force = '--force' in sys.argv
    if not SRC.is_dir():
        print(f'缺少原图目录 {SRC}')
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    made = skipped = failed = 0
    before = after = 0
    for src in sorted(SRC.glob('*.jpg')):
        dst = OUT / (src.stem + '.webp')
        before += src.stat().st_size
        if dst.exists() and not force and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            after += dst.stat().st_size
            continue
        try:
            with Image.open(src) as im:
                im = im.convert('RGB')
                im = center_crop_15(im).resize(SIZE, Image.LANCZOS)
                im.save(dst, 'WEBP', quality=QUALITY, method=6)
            made += 1
            after += dst.stat().st_size
        except Exception as err:  # noqa: BLE001
            failed += 1
            print(f'FAIL {src.name}: {err}')
    print(f'生成 {made} 张，跳过 {skipped} 张，失败 {failed} 张')
    print(f'原图 {before / 1024 / 1024:.2f} MB → 缩略图 {after / 1024 / 1024:.2f} MB')
    if made:
        avg = after / max(1, made + skipped) / 1024
        print(f'平均 {avg:.1f} KB/张')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())