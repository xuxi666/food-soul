/**
 * 3D 开书动画（独立组件）
 * ------------------------------------------------------------
 * 只做一件事：一本完全合上的精装书，绕书脊掀起封面、纸页跟着舒展，
 * 最后平摊成一本打开的画册。不涉及页面内容、路由、翻页系统 ——
 * 首页的章节内容仍由 book/index.js 的那套纸张负责，这里只接管「合上 → 打开」这一瞬。
 *
 * 用的都是项目已有依赖：three（package.json 里本来就有）。
 * 没有引入 GSAP：这里需要的是「播放 / 暂停 / 重置 / 拖到某一帧」，
 * 所以动画写成「时间 t → 所有姿态」的纯函数（apply(t)），
 * 再配一个 40 行的播放器，暂停、反向、任意 seek 都是天然支持的。
 *
 * 结构（都是独立几何，不是一张贴图）：
 *   后封面板 · 圆书脊 · 纸芯（10 张独立纸页 + 纸边层）· 前面板
 * 纸页弯曲：每张纸按顶点重写 z（书脊处下凹 + 轻微波浪），逐帧更新，不是整体旋转。
 * 光照：方向光投影 + 半球环境光，纸页与封面都是 receiveShadow/castShadow，
 *       所以封面掀起的每一帧，背景上的投影都会跟着变形。
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ 缓动 */

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a));
const mix = (a, b, k) => a + (b - a) * k;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutQuint = (x) => 1 - Math.pow(1 - x, 5);
const easeInOutQuart = (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2);
const easeOutBack = (x) => {
  const c1 = 1.28;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/* ---------------------------------------------------------------- 贴图 */

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') };
}

function toTexture(canvas, { repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 纸纤维：底色 + 极细的短纤维与斑点，避免大面积纯色像塑料 */
function paperTexture(size = 512, base = '#f8f1e2') {
  const { c, ctx } = canvasOf(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n * 0.95, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n * 0.86, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#9b7a4e';
  for (let i = 0; i < size * 0.9; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 6 + Math.random() * 26;
    ctx.lineWidth = Math.random() < 0.6 ? 0.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}

/** 封面：暖羊皮纸底 + 细布纹 + 金色双框 + 烫金书名（和首页封面同一套字） */
function coverTexture(w, h) {
  const { c, ctx } = canvasOf(w, h);
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, '#f7ead2');
  g.addColorStop(0.5, '#eedabb');
  g.addColorStop(1, '#dfc59a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 布纹：横竖两组极淡的线
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#8a6234';
  for (let x = 0; x < w; x += 3) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 右侧书口处的暗部（真实精装书装订侧的略深）
  const shade = ctx.createLinearGradient(w * 0.72, 0, w, 0);
  shade.addColorStop(0, 'rgba(120, 82, 42, 0)');
  shade.addColorStop(1, 'rgba(120, 82, 42, 0.16)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  // 金色双框
  const pad = Math.round(w * 0.055);
  ctx.strokeStyle = 'rgba(176, 132, 66, 0.66)';
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  ctx.strokeStyle = 'rgba(176, 132, 66, 0.34)';
  ctx.lineWidth = Math.max(1, w * 0.002);
  ctx.strokeRect(pad * 1.7, pad * 1.7, w - pad * 3.4, h - pad * 3.4);

  // 四角花饰
  const cs = Math.round(w * 0.03);
  const corners = [
    [pad, pad, 1, 1],
    [w - pad, pad, -1, 1],
    [pad, h - pad, 1, -1],
    [w - pad, h - pad, -1, -1],
  ];
  ctx.strokeStyle = 'rgba(150, 108, 52, 0.62)';
  ctx.lineWidth = Math.max(1.5, w * 0.003);
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * cs, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * cs);
    ctx.stroke();
  }

  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(96, 58, 30, 0.82)';
  ctx.font = `500 ${Math.round(w * 0.036)}px "Inter", "PingFang SC", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(w * 0.012)}px`;
  ctx.fillText('CHINESE CUISINE ATLAS', cx, h * 0.24);

  // 书名：烫金 + 深褐底影，模拟压凹
  const titleSize = Math.round(w * 0.2);
  ctx.font = `600 ${titleSize}px "Songti SC", "STSong", "Noto Serif SC", serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(w * 0.045)}px`;
  ctx.fillStyle = 'rgba(90, 44, 20, 0.92)';
  ctx.fillText('食有灵', cx, h * 0.47);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(214, 168, 96, 0.9)';
  ctx.fillText('食有灵', cx, h * 0.47 - Math.max(1, w * 0.004));
  ctx.globalAlpha = 1;

  ctx.font = `500 ${Math.round(w * 0.062)}px "Inter", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(w * 0.03)}px`;
  ctx.fillStyle = 'rgba(84, 48, 24, 0.86)';
  ctx.fillText('FOOD SOUL', cx, h * 0.575);

  // 中间细金线
  ctx.strokeStyle = 'rgba(150, 108, 52, 0.5)';
  ctx.lineWidth = Math.max(1, w * 0.0016);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.14, h * 0.635);
  ctx.lineTo(cx + w * 0.14, h * 0.635);
  ctx.stroke();

  ctx.font = `400 ${Math.round(w * 0.036)}px "Songti SC", serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(w * 0.01)}px`;
  ctx.fillStyle = 'rgba(96, 58, 30, 0.72)';
  ctx.fillText('一本可以翻的中国美食典藏', cx, h * 0.685);

  ctx.font = `400 ${Math.round(w * 0.03)}px "Songti SC", serif`;
  ctx.fillStyle = 'rgba(126, 84, 44, 0.6)';
  ctx.fillText('轻点封面 · 翻开画册', cx, h * 0.8);

  return c;
}

/** 内页版式：极淡的金线框 + 一段抽象图文，让 3D 摊开后像印了东西的纸 */
function printTexture(side, w = 512, h = 700) {
  const { c, ctx } = canvasOf(w, h);
  ctx.fillStyle = '#fbf4e6';
  ctx.fillRect(0, 0, w, h);

  // 版心金线
  const m = Math.round(w * 0.085);
  ctx.strokeStyle = 'rgba(196, 160, 104, 0.34)';
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);

  if (side === 'left') {
    // 一幅暖调大图（抽象的美食摄影）
    const iy = m + h * 0.05;
    const ih = h * 0.5;
    ctx.fillStyle = '#a86b3c';
    ctx.fillRect(m + w * 0.04, iy, w - (m + w * 0.04) * 2, ih);
    const rg = ctx.createRadialGradient(w * 0.42, iy + ih * 0.34, 8, w * 0.46, iy + ih * 0.5, ih * 0.8);
    rg.addColorStop(0, 'rgba(255, 224, 170, 0.5)');
    rg.addColorStop(0.5, 'rgba(190, 120, 64, 0.28)');
    rg.addColorStop(1, 'rgba(70, 34, 16, 0.42)');
    ctx.fillStyle = rg;
    ctx.fillRect(m + w * 0.04, iy, w - (m + w * 0.04) * 2, ih);
    // 几笔「菜品」的暗色块
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#3c1d10';
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(w * (0.25 + Math.random() * 0.5), iy + ih * (0.3 + Math.random() * 0.45), w * 0.09, w * 0.05, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 图注两行
    ctx.fillStyle = 'rgba(96, 66, 34, 0.5)';
    for (let i = 0; i < 2; i += 1) {
      ctx.fillRect(m + w * 0.06, iy + ih + 18 + i * 12, (w - m * 2) * (0.62 - i * 0.16), 4);
    }
    // 正文行
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = 'rgba(120, 92, 58, 0.28)';
      ctx.fillRect(m + w * 0.06, h - m - 70 + i * 13, (w - m * 2) * (0.86 - (i % 2) * 0.12), 3.4);
    }
  } else {
    // 右页：标题 + 细金线 + 正文 + 小图
    ctx.fillStyle = 'rgba(72, 44, 22, 0.52)';
    ctx.fillRect(m + w * 0.06, m + h * 0.05, (w - m * 2) * 0.46, 12);
    ctx.fillStyle = 'rgba(72, 44, 22, 0.3)';
    ctx.fillRect(m + w * 0.06, m + h * 0.05 + 24, (w - m * 2) * 0.3, 6);
    ctx.strokeStyle = 'rgba(196, 160, 104, 0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(m + w * 0.06, m + h * 0.05 + 44);
    ctx.lineTo(w - m - w * 0.06, m + h * 0.05 + 44);
    ctx.stroke();
    for (let i = 0; i < 9; i += 1) {
      ctx.fillStyle = 'rgba(120, 92, 58, 0.26)';
      const ww = (w - m * 2) * (i % 3 === 2 ? 0.52 : 0.88);
      ctx.fillRect(m + w * 0.06, m + h * 0.05 + 64 + i * 15, ww, 3.4);
    }
    // 右下小图
    const iy = h * 0.58;
    ctx.fillStyle = '#b07a46';
    ctx.fillRect(m + w * 0.06, iy, w - (m + w * 0.06) * 2, h * 0.26);
    const rg = ctx.createRadialGradient(w * 0.5, iy + 40, 6, w * 0.5, iy + 60, h * 0.22);
    rg.addColorStop(0, 'rgba(255, 226, 176, 0.45)');
    rg.addColorStop(1, 'rgba(72, 34, 14, 0.4)');
    ctx.fillStyle = rg;
    ctx.fillRect(m + w * 0.06, iy, w - (m + w * 0.06) * 2, h * 0.26);
    for (let i = 0; i < 2; i += 1) {
      ctx.fillStyle = 'rgba(120, 92, 58, 0.22)';
      ctx.fillRect(m + w * 0.06, iy + h * 0.26 + 16 + i * 12, (w - m * 2) * (0.8 - i * 0.2), 3.4);
    }
  }
  return c;
}

/** 内衬（封面背面 / 环衬）：暖米色，带非常淡的暗纹 */
function endpaperTexture(size = 256) {
  const { c, ctx } = canvasOf(size, size);
  ctx.fillStyle = '#f3e7cf';
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#a1763c';
  for (let i = -size; i < size * 2; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}

/** 纸边：一整块纸芯的侧壁，画上书页层的细线 */
function edgeTexture(w = 64, h = 512) {
  const { c, ctx } = canvasOf(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f6ecd6');
  g.addColorStop(0.5, '#efe1c4');
  g.addColorStop(1, '#e6d4b1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#b08a52';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random());
    ctx.lineTo(w, y + Math.random());
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}

/* --------------------------------------------------------------- 组件 */

export function createBookOpen3D({
  stage,
  coverEl,
  bookEl,
  reducedMotion = false,
} = {}) {
  if (!stage || !coverEl) return null;

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'bk-3d__canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const layer = document.createElement('div');
  layer.className = 'bk-3d';
  layer.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 40000);

  /* ---------- 尺寸：1 世界单位 = 1 CSS 像素（z=0 平面上） ---------- */
  const pageW = Math.max(120, coverEl.offsetWidth || 300);
  const pageH = Math.max(160, coverEl.offsetHeight || 420);
  const coverT = Math.max(2.4, pageW * 0.012); // 封面硬壳厚度
  const sheetCount = coarse ? 7 : 10;
  const sheetGap = Math.max(0.32, pageH * 0.0009);
  const blockT = sheetGap * (sheetCount - 1) + coverT * 2.2;

  /* ---------- 材质 ---------- */
  const paperMap = toTexture(paperTexture(512, '#f8f1e2'), { repeat: 2 });
  const endMap = toTexture(endpaperTexture(256), { repeat: 2 });
  const edgeMap = toTexture(edgeTexture(), { repeat: 1 });
  const coverMap = toTexture(coverTexture(Math.round(512 * (pageW / pageH)), 512));

  const printLeft = new THREE.MeshStandardMaterial({
    map: toTexture(printTexture('left')),
    roughness: 0.93,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const printRight = new THREE.MeshStandardMaterial({
    map: toTexture(printTexture('right')),
    roughness: 0.93,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const paperMat = new THREE.MeshStandardMaterial({
    map: paperMap,
    color: 0xfffaf0,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const coverArtMat = new THREE.MeshStandardMaterial({ map: coverMap, roughness: 0.72, metalness: 0.06 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xe3cba6, roughness: 0.9, metalness: 0.02 });
  const endMat = new THREE.MeshStandardMaterial({ map: endMap, color: 0xfff6e6, roughness: 0.95 });
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeMap, color: 0xfaf0da, roughness: 0.95 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xbe9856, roughness: 0.42, metalness: 0.55 });

  /* ---------- 书 ---------- */
  const book = new THREE.Group();
  scene.add(book);

  // 后封：一整块硬壳
  const back = new THREE.Mesh(new THREE.BoxGeometry(pageW, pageH, coverT), clothMat);
  back.castShadow = true;
  back.receiveShadow = true;
  back.position.z = -blockT / 2 - coverT / 2;
  book.add(back);

  // 圆书脊：竖向圆柱，贴在左边缘
  const spineGeo = new THREE.CylinderGeometry(blockT / 2 + coverT * 0.35, blockT / 2 + coverT * 0.35, pageH + 2, 24, 1, false, Math.PI * 0.5, Math.PI);
  const spine = new THREE.Mesh(spineGeo, clothMat);
  spine.castShadow = true;
  spine.receiveShadow = true;
  spine.position.set(-pageW / 2 - coverT * 0.2, 0, 0);
  book.add(spine);

  // 书脊烫金横线
  for (let i = 0; i < 3; i += 1) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(blockT * 0.9, 2.2, blockT * 0.9), goldMat);
    band.position.set(-pageW / 2 - coverT * 0.1, pageH * 0.3 - i * pageH * 0.14, 0.2);
    book.add(band);
  }

  // 纸芯：一块实心纸边 + 若干可弯曲的纸页
  const core = new THREE.Mesh(new THREE.BoxGeometry(pageW - 3, pageH - 4, blockT * 0.92), edgeMat);
  core.castShadow = true;
  core.receiveShadow = true;
  core.position.set(0, 0, 0);
  book.add(core);

  const sheets = [];
  const sheetGeoBase = new THREE.PlaneGeometry(pageW - 5, pageH - 6, 24, 1);
  sheetGeoBase.translate((pageW - 5) / 2, 0, 0); // 以书脊为原点，绕 Y 转就是翻页
  for (let i = 0; i < sheetCount; i += 1) {
    const geo = sheetGeoBase.clone();
    const base = i < 3 ? printLeft : i > sheetCount - 4 ? printRight : paperMat;
    const mat = base.clone();
    mat.color = new THREE.Color(0xfff8ea).offsetHSL(0, 0, (i % 3) * 0.008);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const z = (i - (sheetCount - 1) / 2) * sheetGap;
    mesh.position.set(-(pageW - 5) / 2, 0, z);
    mesh.userData = {
      baseZ: z,
      jitter: (Math.random() - 0.5) * 0.8,
      phase: Math.random() * Math.PI,
      geo,
      flat: geo.attributes.position.array.slice(),
    };
    sheets.push(mesh);
    book.add(mesh);
  }

  // 前封：绕书脊转，所以挂在以书脊为原点的转轴上
  const coverPivot = new THREE.Group();
  coverPivot.position.set(-pageW / 2, 0, blockT / 2 + coverT / 2);
  book.add(coverPivot);
  const front = new THREE.Mesh(
    new THREE.BoxGeometry(pageW, pageH, coverT),
    [clothMat, clothMat, clothMat, clothMat, coverArtMat, endMat]
  );
  front.castShadow = true;
  front.receiveShadow = true;
  front.position.set(pageW / 2, 0, 0);
  coverPivot.add(front);

  /* ---------- 展示面：接影子的背景板 + 接触阴影 ---------- */
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(pageW * 6, pageH * 5),
    new THREE.ShadowMaterial({ color: 0x2a1a0e, opacity: 0.36 })
  );
  shadowCatcher.receiveShadow = true;
  shadowCatcher.position.z = -pageW * 0.55;
  scene.add(shadowCatcher);

  const contactCanvas = (() => {
    const { c, ctx } = canvasOf(256, 256);
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 126);
    g.addColorStop(0, 'rgba(58, 34, 16, 0.42)');
    g.addColorStop(0.55, 'rgba(58, 34, 16, 0.16)');
    g.addColorStop(1, 'rgba(58, 34, 16, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return c;
  })();
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(pageW * 1.7, pageH * 1.3),
    new THREE.MeshBasicMaterial({
      map: toTexture(contactCanvas),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    })
  );
  contact.position.z = -pageW * 0.4;
  scene.add(contact);

  /* ---------- 灯光 ---------- */
  const hemi = new THREE.HemisphereLight(0xfff3df, 0x2a1b10, 0.72);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffeccc, 2.5);
  key.position.set(-pageW * 1.5, pageH * 1.25, pageW * 1.35);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  key.shadow.camera.left = -pageW * 2.2;
  key.shadow.camera.right = pageW * 2.2;
  key.shadow.camera.top = pageH * 1.6;
  key.shadow.camera.bottom = -pageH * 1.6;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = pageW * 12;
  key.shadow.bias = -0.0012;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xd9e6ff, 0.42);
  fill.position.set(pageW * 1.6, -pageH * 0.4, pageW);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9a8, 0.5);
  rim.position.set(0, -pageH, pageW * 0.6);
  scene.add(rim);

  /* ---------- 时间轴：t ∈ [0,1] → 全部姿态 ---------- */
  const TILT_CLOSED = THREE.MathUtils.degToRad(-11); // 合上时略微俯视（够看得出厚度，又不脱离首页版面）
  const TILT_OPEN = THREE.MathUtils.degToRad(-27); // 打开后更接近「桌面俯视」
  const CLOSED_ROT_Z = THREE.MathUtils.degToRad(15); // 和首页合书状态的 15° 对齐

  let closedPose = { scale: 0.585, x: 0, y: 0 };
  let openPose = { scale: 0.66 };

  const state = {
    t: 0,
    playing: false,
    visible: true,
    fps: 60,
  };

  function measure() {
    const camRect = stage.getBoundingClientRect();
    const covRect = coverEl.getBoundingClientRect();
    const w = Math.max(1, camRect.width);
    const h = Math.max(1, camRect.height);

    camera.aspect = w / h;
    // 让 z=0 平面上的 1 单位 = 1 CSS 像素
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, 0, dist);
    camera.updateProjectionMatrix();

    renderer.setSize(w, h, false);

    const layoutW = coverEl.offsetWidth || pageW;
    const layoutH = coverEl.offsetHeight || pageH;
    const cos = Math.abs(Math.cos(CLOSED_ROT_Z));
    const sin = Math.abs(Math.sin(CLOSED_ROT_Z));
    const bboxW = layoutW * cos + layoutH * sin;
    const scale = bboxW > 1 ? covRect.width / bboxW : 0.585;
    closedPose = {
      scale,
      x: covRect.left - camRect.left + covRect.width / 2 - w / 2,
      y: -(covRect.top - camRect.top + covRect.height / 2 - h / 2),
    };

    const openScaleVar = bookEl ? parseFloat(getComputedStyle(bookEl).getPropertyValue('--open-scale')) : NaN;
    openPose = { scale: Number.isFinite(openScaleVar) && openScaleVar > 0 ? openScaleVar : 0.66 };
    apply(state.t);
  }

  /** 单张纸页的弯曲：书脊一侧下凹 + 中段极轻的波浪 */
  function bend(mesh, amount, dir) {
    const geo = mesh.userData.geo;
    const pos = geo.attributes.position;
    const arr = pos.array;
    const w = pageW - 5;
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i];
      const u = clamp(x / w, 0, 1);
      // 书脊附近（u 小）往下凹，逐渐回到平面 —— 深度按纸宽走，窗口缩放也跟着成立
      const gutter = Math.pow(1 - clamp(u / 0.3), 2.1);
      // 中段轻微起伏，让纸看起来是软的
      const wave = Math.sin(u * Math.PI * 1.15 + mesh.userData.phase) * 0.35 + 0.65;
      const dip = -amount * gutter * pageW * 0.085;
      const sag = amount * pageH * 0.018 * Math.sin(u * Math.PI) * wave;
      arr[i + 2] = dip + sag;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function apply(t) {
    state.t = t;

    // 大姿态：从「合上的小书」到「摊开的双页」，动作基本在 0.86 前完成
    const poseT = easeInOutQuart(seg(t, 0.18, 0.86));
    const scale = mix(closedPose.scale, openPose.scale, poseT);
    const px = mix(closedPose.x, 0, poseT);
    const py = mix(closedPose.y, 0, poseT);
    // 收势：末尾把整本书按住（极小的回弹），不是硬停
    const settle = Math.sin(clamp(seg(t, 0.84, 1)) * Math.PI) * 0.004;
    book.position.set(px, py, 0);
    book.scale.setScalar(scale * (1 - settle));
    book.rotation.z = mix(CLOSED_ROT_Z, 0, easeInOutCubic(seg(t, 0.08, 0.84)));
    book.rotation.x = mix(TILT_CLOSED, TILT_OPEN, easeInOutQuart(seg(t, 0.06, 0.9)));
    book.rotation.y = mix(THREE.MathUtils.degToRad(4), 0, poseT);

    // 封面：先蓄力（微微掀起又压回），再加速掀开；0.78 之后收力，末尾一点点过冲回弹
    const press = seg(t, 0.02, 0.14);
    const openT = seg(t, 0.1, 0.84);
    const openE = openT < 0.62 ? easeInOutCubic(openT * 1.35) * 0.5 : 0.5 + easeOutQuint((openT - 0.62) / 0.38) * 0.5;
    const overshoot = easeOutBack(clamp(seg(t, 0.7, 1))) * 0.016;
    const pressBack = Math.sin(press * Math.PI) * 0.022;
    coverPivot.rotation.y = -(Math.PI * 0.995) * clamp(openE) + pressBack - overshoot;

    /*
     * 纸页：不是各自匀速转，而是「跟着封面走、略慢一点」——
     * 每张纸的进度 = 封面的进度 × 系数（层数越靠下越慢），
     * 这样纸永远在封面里侧，不会穿过封面跑到外面去。
     */
    const half = Math.ceil(sheetCount * 0.45);
    sheets.forEach((mesh, i) => {
      const toLeft = i < half;
      const lag = toLeft ? 1 - (half - 1 - i) * 0.085 : 0.12 + (i - half) * 0.03;
      const p = clamp(openE * lag + (toLeft ? 0 : 0.06));
      mesh.rotation.y = toLeft ? -Math.PI * 0.995 * p : -THREE.MathUtils.degToRad(2.4) * p;
      const bendAmt = mix(0.02, toLeft ? 0.9 : 0.75, p);
      mesh.position.z = mesh.userData.baseZ * (1 - 0.2 * p) + (toLeft ? -1.6 * p : 0.5 * p);
      mesh.position.x = -(pageW - 5) / 2 + mesh.userData.jitter * (1 - p);
      bend(mesh, bendAmt);
    });

    // 纸芯随书打开逐渐「摊平」：厚度收一点，避免打开后仍像一块砖
    core.scale.z = mix(1, 0.94, poseT);
    core.position.z = mix(0, -0.6, poseT);

    // 合上时按倾角补偿，让 3D 书的投影尺寸和 DOM 封面一致（换回来时不跳）
    lastT = t;
    return t;
  }

  let lastT = 0;

  /* ---------- 播放器 ---------- */
  const DURATION = 2180; // ms
  let raf = 0;
  let startedAt = 0;
  let pausedAt = 0;
  let onDone = null;
  let dirty = true;

  function render() {
    if (!state.visible) return;
    renderer.render(scene, camera);
  }

  function loop(now) {
    if (!state.playing) return;
    const elapsed = now - startedAt;
    const t = clamp(elapsed / DURATION, 0, 1);
    apply(t);
    render();
    if (t >= 1) {
      state.playing = false;
      state.t = 1;
      const cb = onDone;
      const res = resolveFinish;
      onDone = null;
      resolveFinish = null;
      if (cb) cb();
      if (res) res({ t: 1 });
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  let resolveFinish = null;
  let finishPromise = Promise.resolve();

  function play(opts = {}) {
    cancelAnimationFrame(raf);
    // 从当前进度接着播；已经播完则从头再来
    const startT = typeof opts.t === 'number' ? clamp(opts.t) : state.t >= 1 ? 0 : state.t;
    apply(startT);
    onDone = opts.onDone || null;
    state.playing = true;
    startedAt = performance.now() - startT * DURATION;
    finishPromise = new Promise((res) => {
      resolveFinish = res;
    });
    raf = requestAnimationFrame(loop);
    render();
    return finishPromise;
  }

  function pause() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(raf);
  }

  function resume() {
    if (state.playing || state.t >= 1) return;
    play({ t: state.t });
  }

  function seek(t) {
    apply(clamp(t));
    render();
  }

  function reset() {
    cancelAnimationFrame(raf);
    state.playing = false;
    state.t = 0;
    apply(0);
    render();
  }

  /* ---------- 可见性 / 交接 ---------- */
  function showClosed() {
    state.visible = true;
    layer.classList.add('is-on');
    measure();
    render();
  }

  function hide(ms = 260) {
    layer.classList.remove('is-on');
    if (ms <= 0) {
      state.visible = false;
      return Promise.resolve();
    }
    return new Promise((res) => {
      window.setTimeout(() => {
        state.visible = false;
        res();
      }, ms);
    });
  }

  /* ---------- 尺寸变化 ---------- */
  const ro = new ResizeObserver(() => {
    measure();
    if (!state.playing) render();
  });
  ro.observe(stage);
  window.addEventListener('resize', onWinResize);
  function onWinResize() {
    measure();
    if (!state.playing) render();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('resize', onWinResize);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => {
        for (const k of ['map', 'alphaMap', 'roughnessMap', 'normalMap']) {
          const tex = m[k];
          if (tex && tex.dispose) tex.dispose();
        }
        m.dispose();
      });
    });
    renderer.dispose();
    layer.remove();
  }

  /* 字体晚一点加载完时重画一次封面（书名/英文名要跟站点字体一致） */
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      const fresh = coverTexture(Math.round(512 * (pageW / pageH)), 512);
      coverMap.image = fresh;
      coverMap.needsUpdate = true;
      if (!state.playing) render();
    });
  }

  // 首次测量（等一帧，避免布局还没算完）
  requestAnimationFrame(() => {
    if (reducedMotion) {
      layer.classList.add('is-static');
      return;
    }
    measure();
    render();
  });

  const api = {
    el: layer,
    play,
    pause,
    resume,
    reset,
    seek,
    showClosed,
    hide,
    dispose,
    measure,
    get state() {
      return { ...state };
    },
    get duration() {
      return DURATION;
    },
  };

  return api;
}

export const OPEN3D_PRESENT = true;