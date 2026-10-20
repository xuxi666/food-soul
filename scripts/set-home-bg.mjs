/**
 * 导入首页全屏背景插画。
 *
 * 用法：node scripts/set-home-bg.mjs <图片路径>
 *
 * 做三件事：
 *  1. 校验扩展名 + 文件头（防止把非图片改名后塞进来）
 *  2. 复制到 public/bg/home-illustration.<ext>，删除旧格式文件
 *  3. 把 src/styles/base.css 里的 --hero-bg-image 指向新文件
 *
 * 不做压缩/裁剪：原图按原样发布，避免二次编码损失细节。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'bg');
const CSS_FILE = path.join(ROOT, 'src', 'styles', 'base.css');
const MAX_BYTES = 12 * 1024 * 1024;

const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/set-home-bg.mjs <图片路径>');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`文件不存在: ${src}`);
  process.exit(1);
}

const buf = fs.readFileSync(src);
if (buf.length > MAX_BYTES) {
  console.error(`文件过大: ${(buf.length / 1024 / 1024).toFixed(1)}MB（上限 12MB）`);
  process.exit(1);
}

/** 按文件头判定真实格式，不信任扩展名 */
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** 读取像素尺寸，仅用于日志 */
function dimensions(b, ext) {
  try {
    if (ext === 'png') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (ext === 'jpg') {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i += 1; continue; }
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (ext === 'webp' && b.subarray(12, 16).toString('ascii') === 'VP8X') {
      const w = 1 + b.readUIntLE(24, 3);
      const h = 1 + b.readUIntLE(27, 3);
      return { w, h };
    }
  } catch {
    /* 解析失败不影响导入 */
  }
  return null;
}

const ext = sniff(buf);
if (!ext) {
  console.error('不是有效的 JPG / PNG / WebP 图片');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
// 清理旧格式，避免同目录留下两份
for (const old of fs.readdirSync(OUT_DIR)) {
  if (old.startsWith('home-illustration.')) fs.unlinkSync(path.join(OUT_DIR, old));
}

const outName = `home-illustration.${ext}`;
fs.writeFileSync(path.join(OUT_DIR, outName), buf);

const css = fs.readFileSync(CSS_FILE, 'utf8');
const next = css.replace(
  /--hero-bg-image:\s*(?:none|url\('\/bg\/home-illustration\.[a-z]+'\));/,
  `--hero-bg-image: url('/bg/${outName}');`
);
if (next === css) {
  console.error('未在 base.css 找到 --hero-bg-image 声明，请手动检查');
  process.exit(1);
}
fs.writeFileSync(CSS_FILE, next);

const dim = dimensions(buf, ext);
console.log(`已导入: public/bg/${outName}`);
console.log(`大小: ${(buf.length / 1024).toFixed(0)} KB${dim ? ` · 尺寸: ${dim.w}×${dim.h}` : ''}`);
console.log(`CSS: --hero-bg-image: url('/bg/${outName}')`);
