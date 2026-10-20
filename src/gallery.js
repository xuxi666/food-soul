import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Geometry / feel constants
 * ------------------------------------------------------------------ */
const CARD_W = 1.58;
const CARD_H = 1.82;
const BASE_RADIUS = 2.46;
const FOV = 42;
const LIFT = 0.3; // how far a selected card travels along its normal
const SEL_SCALE = 1.06;
const DRAG_GAIN = 2.1; // 拖动灵敏度：>1 表示环跟随指针快于 1:1（本次由 1.5 提升约 40%）

const TEX_W = 560;
const TEX_H = Math.round((TEX_W * CARD_H) / CARD_W);
const CORNER = 26;
/** 信息区与卡片顶边之间的间距（px，随字号档位微调） */
const INFO_GAP = 20;
// 卡片朝向阻尼：0=完全侧转，1=始终面向镜头；0.72 让相邻卡片半转身、更可读
const YAW_DAMP = 0.72;
/** 空闲自转：无操作 IDLE_AFTER 秒后开始，单位 rad/s（0.024 -> 0.036 -> 0.054，共提速 125%） */
const IDLE_SPIN_SPEED = 0.054;
const IDLE_AFTER = 2.4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ *
 * Capability check
 * ------------------------------------------------------------------ */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Canvas helpers
 * ------------------------------------------------------------------ */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawCover(ctx, img, w, h) {
  const ir = img.width / img.height;
  const tr = w / h;
  let sw, sh, sx, sy;
  if (ir > tr) {
    sh = img.height;
    sw = sh * tr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / tr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

/** Rounded card face: cover-cropped photo + hairline + a whisper of sheen. */
function bakeFace(img) {
  const c = makeCanvas(TEX_W, TEX_H);
  const ctx = c.getContext('2d');
  ctx.save();
  roundRect(ctx, 0, 0, TEX_W, TEX_H, CORNER);
  ctx.clip();

  if (img) {
    drawCover(ctx, img, TEX_W, TEX_H);
  } else {
    const g = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
    g.addColorStop(0, '#1b2030');
    g.addColorStop(1, '#0b0d14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
  }

  // faint top-left sheen, like glass over a print
  const sheen = ctx.createLinearGradient(0, 0, TEX_W * 0.45, TEX_H * 0.85);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // very light bottom falloff for volume
  const shade = ctx.createLinearGradient(0, TEX_H * 0.6, 0, TEX_H);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // inner hairline edge
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, 1.1, 1.1, TEX_W - 2.2, TEX_H - 2.2, CORNER - 1);
  ctx.stroke();

  ctx.restore();
  return c;
}

/** Soft halo used as the selected card's edge light. */
function bakeRim() {
  const pad = 0.16;
  const w = Math.round(TEX_W * (1 + pad * 2));
  const h = Math.round(TEX_H * (1 + pad * 2));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const ox = (w - TEX_W) / 2;
  const oy = (h - TEX_H) / 2;
  ctx.shadowColor = 'rgba(255,247,235,0.85)';
  ctx.shadowBlur = 30;
  ctx.strokeStyle = 'rgba(255,248,238,0.95)';
  ctx.lineWidth = 4;
  roundRect(ctx, ox + 2, oy + 2, TEX_W - 4, TEX_H - 4, CORNER);
  ctx.stroke();
  ctx.stroke();
  return c;
}

/** Soft drop shadow blob. */
function bakeShadow() {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  // keep the falloff inside the canvas, otherwise the gradient is clipped
  // and the plane shows a hard rectangular edge
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.68, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, s / 2, s / 2.15, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Very soft pool of light behind the ring, so shadows read on black. */
function bakeGlow() {
  const s = 512;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(138,154,190,0.5)');
  g.addColorStop(0.3, 'rgba(110,124,156,0.32)');
  g.addColorStop(0.58, 'rgba(74,84,110,0.14)');
  g.addColorStop(0.82, 'rgba(48,54,72,0.04)');
  g.addColorStop(1, 'rgba(40,46,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return c;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ------------------------------------------------------------------ *
 * Gallery
 * ------------------------------------------------------------------ */
export function createGallery({ canvas, stage, overlay, items, panelMode = 'full', onProgress, onReady, onSelect, onHover, onActivate, panelMinTop }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    return null;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const count = items.length;
  const step = (Math.PI * 2) / count;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05060a, 6.2, 16.5);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);
  camera.position.set(0, 0.2, 9.07);

  const world = new THREE.Group();
  scene.add(world);
  const ring = new THREE.Group();
  world.add(ring);

  /* ---------- shared textures ---------- */
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // WebGL1 can only mip-map power-of-two textures; without this the browser
  // silently resizes (and therefore distorts) the prints.
  const canMipmap = renderer.capabilities.isWebGL2 === true;
  const makeTexture = (canvasEl, mip = true) => {
    const t = new THREE.CanvasTexture(canvasEl);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    const useMips = mip && canMipmap;
    t.generateMipmaps = useMips;
    t.minFilter = useMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };

  const shadowTex = makeTexture(bakeShadow(), false);
  const rimTex = makeTexture(bakeRim(), false);
  const glowTex = makeTexture(bakeGlow(), false);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 14),
    new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.9,
      fog: false,
    })
  );
  backdrop.position.set(0, 0, -4.6);
  scene.add(backdrop);

  /* ---------- shared geometries ---------- */
  const faceGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const shadowGeo = new THREE.PlaneGeometry(CARD_W * 1.14, CARD_H * 0.98);
  const rimGeo = new THREE.PlaneGeometry(CARD_W * 1.32, CARD_H * 1.32);

  const cards = [];
  const pickables = [];

  /* ---------- state ---------- */
  let rot = 0;
  let vel = 0;
  let spinTarget = null;
  let selected = -1;
  let hovered = -1;
  let dragging = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastMoveAt = 0;
  let movedPx = 0;
  let downAt = 0;
  let idleFor = 0;
  let raf = 0;
  let lastFrame = performance.now();
  let hoverDirty = false;
  let hoverX = 0;
  let hoverY = 0;
  let ready = false;
  let destroyed = false;
  let rotOffset = 0;

  const view = {
    w: 1,
    h: 1,
    scale: 1,
    camZ: 9.07,
    sens: 0.002,
    radius: BASE_RADIUS,
    ringY: -0.92,
    infoGapExtra: 0,
    cardPx: 300,
    panelMaxW: 320,
  };
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ------------------------------------------------------------------ *
   * HTML 信息面板：真实 DOM 文本，用单应矩阵贴到卡片的平面上
   * ------------------------------------------------------------------ */
  const _pv = new THREE.Vector3();
  const _quad = [
    { x: 0, y: 0, ok: true },
    { x: 0, y: 0, ok: true },
    { x: 0, y: 0, ok: true },
    { x: 0, y: 0, ok: true },
  ];

  function solveHomography(w, h, p) {
    // 求 3x3 单应矩阵，把 (0,0)-(w,h) 映射到四个屏幕点
    const src = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    const A = [];
    for (let i = 0; i < 4; i += 1) {
      const [u, v] = src[i];
      const { x, y } = p[i];
      A.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
      A.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
    }
    for (let col = 0; col < 8; col += 1) {
      let pivot = col;
      for (let r = col + 1; r < 8; r += 1) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      }
      if (Math.abs(A[pivot][col]) < 1e-9) return null;
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
      const d = A[col][col];
      for (let c = col; c < 9; c += 1) A[col][c] /= d;
      for (let r = 0; r < 8; r += 1) {
        if (r === col) continue;
        const f = A[r][col];
        if (!f) continue;
        for (let c = col; c < 9; c += 1) A[r][c] -= f * A[col][c];
      }
    }
    const [a, b, c, d, e, f, g, hh] = A.map((row) => row[8]);
    return `matrix3d(${a},${d},0,${g},${b},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
  }

  function projectCorner(card, lx, ly, out) {
    _pv.set(lx, ly, 0.02).applyMatrix4(card.group.matrixWorld);
    _pv.project(camera);
    out.x = (_pv.x * 0.5 + 0.5) * view.w;
    out.y = (-_pv.y * 0.5 + 0.5) * view.h;
    out.ok = _pv.z > -1 && _pv.z < 1;
  }

  function buildPanel(item) {
    const el = document.createElement('div');
    el.className = 'cp';

    const body = document.createElement('div');
    body.className = 'cp__body';

    const name = document.createElement('h3');
    name.className = 'cp__name';
    name.textContent = item.label;

    const meta = document.createElement('p');
    meta.className = 'cp__meta';
    meta.textContent = item.meta || '';

    const tags = document.createElement('p');
    tags.className = 'cp__tags';
    (item.tags || []).slice(0, 3).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'cp__tag';
      chip.textContent = t;
      tags.append(chip);
    });

    const desc = document.createElement('p');
    desc.className = 'cp__desc';
    desc.textContent = item.desc || '';

    const cta = document.createElement('a');
    cta.className = 'cp__cta';
    cta.href = item.href || '#';
    cta.dataset.link = '';
    cta.textContent = item.ctaLabel || '进入';
    if (item.ctaTitle) cta.title = item.ctaTitle;

    // 第二个动作：进入菜系 / 口味页（可选）
    const ctaAlt = document.createElement('a');
    ctaAlt.className = 'cp__cta cp__cta--alt';
    ctaAlt.dataset.link = '';
    ctaAlt.textContent = item.secondaryLabel || '查看详情';
    if (!item.secondaryHref) ctaAlt.hidden = true;

    // 按钮独立响应：不启动环形拖拽，拖动后松手也不触发跳转
    let downX = 0;
    let downY = 0;
    const guard = (node, kind) => {
      node.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        downX = e.clientX;
        downY = e.clientY;
      });
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) {
          e.preventDefault();
          return;
        }
        if (onActivate) {
          e.preventDefault();
          onActivate(el.__item || item, node, kind);
        }
      });
    };
    guard(cta, 'primary');
    guard(ctaAlt, 'alt');

    const actions = document.createElement('div');
    actions.className = 'cp__actions';
    actions.append(cta, ctaAlt);

    body.append(name, meta, tags, desc, actions);
    el.append(body);
    el.__item = item;
    return el;
  }

  /* ---------- build ---------- */
  function buildCard(item, index, faceCanvas) {
    const angle = index * step;
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);

    const faceTex = makeTexture(faceCanvas);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(0, -0.24, -0.05);
    inner.add(shadow);

    const photoMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(faceGeo, photoMat);
    mesh.position.z = 0.014;
    mesh.userData.index = index;
    inner.add(mesh);

    const rimMat = new THREE.MeshBasicMaterial({
      map: rimTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      color: 0xfff6e8,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.z = 0.004;
    inner.add(rim);

    const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const base = new THREE.Vector3(normal.x * BASE_RADIUS, 0, normal.z * BASE_RADIUS);
    group.position.copy(base);
    group.rotation.y = angle;
    ring.add(group);

    const card = {
      index,
      angle,
      group,
      inner,
      mesh,
      shadow,
      shadowMat,
      rim,
      rimMat,
      photoMat,
      faceTex,
      normal,
      base,
      sel: 0,
      hover: 0,
      item,
      label: item.label,
    };
    if (overlay) {
      card.panel = buildPanel(item);
      overlay.append(card.panel);
    }

    cards.push(card);
    pickables.push(mesh);
    return card;
  }

  async function init() {
    const images = await Promise.all(items.map((p) => loadImage(p.src)));
    if (destroyed) return;

    let done = 0;
    for (let i = 0; i < items.length; i++) {
      if (destroyed) return;
      const faceCanvas = bakeFace(images[i]);
      buildCard(items[i], i, faceCanvas);
      done += 1;
      onProgress?.(done, items.length);
    }

    resize();
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
    ready = true;
    onReady?.();
  }

  /* ---------- layout ---------- */
  function resize() {
    // measure the stage itself: it is sized in svh, which can differ from
    // innerHeight on mobile browsers
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    view.w = w;
    view.h = h;

    const aspect = w / h;
    let scale;
    let camZ;
    let radius;
    let ringY;
    let infoGapExtra;
    if (aspect >= 1.45) {
      scale = 1;
      camZ = 9.07;
      radius = BASE_RADIUS;
      ringY = -1.04;
      infoGapExtra = 0;
    } else if (aspect >= 1.12) {
      scale = 0.95;
      camZ = 8.8;
      radius = 2.4;
      ringY = -0.86;
      infoGapExtra = 0;
    } else if (aspect >= 0.62) {
      scale = 0.9;
      camZ = 8.55;
      radius = 2.34;
      ringY = -0.72;
      infoGapExtra = -2;
    } else {
      scale = 0.85;
      camZ = 8.2;
      radius = 2.28;
      ringY = -0.58;
      infoGapExtra = 2;
    }

    view.scale = scale;
    view.camZ = camZ;
    view.radius = radius;
    view.ringY = ringY;
    view.infoGapExtra = infoGapExtra;
    world.scale.setScalar(scale);
    backdrop.position.y = ringY;
    layoutRing(radius);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);

    camera.aspect = aspect;
    camera.position.z = camZ;
    camera.updateProjectionMatrix();

    // pointer -> radians so the ring tracks the finger / mouse at any screen size
    const frontDist = Math.max(0.8, camZ - radius * scale);
    const pxPerWorld = h / (2 * Math.tan((FOV * Math.PI) / 360) * frontDist);
    const pxPerRad = radius * scale * pxPerWorld;
    // 上限随 DRAG_GAIN 同步上调，避免小屏被旧的 0.008 上限吃掉提速
    view.sens = clamp(DRAG_GAIN / Math.max(1, pxPerRad), 0.0012, 0.0112);

    // 信息块最大宽度跟随前景卡片像素宽度；字号用 em 体系随之下调
    const cardPx = CARD_W * scale * pxPerWorld;
    view.cardPx = cardPx;
    view.panelMaxW = Math.round(cardPx * 1.04);
    const fs = clamp(cardPx * 0.062, 11.5, 16.2);
    for (const c of cards) {
      if (!c.panel) continue;
      c.panel.style.fontSize = `${fs.toFixed(2)}px`;
      c.infoH = null;
    }
  }

  function layoutRing(radius) {
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      c.base.set(c.normal.x * radius, 0, c.normal.z * radius);
      c.group.position.copy(c.base).addScaledVector(c.normal, LIFT * c.sel);
    }
  }

  /* ---------- selection ---------- */
  function select(index) {
    const next = index === undefined ? -1 : index;
    if (next === selected) return;
    selected = next;
    onSelect?.(selected);
  }

  function rotateTo(index) {
    const target = -index * step;
    const twoPi = Math.PI * 2;
    spinTarget = target + Math.round((rot - target) / twoPi) * twoPi;
    vel = 0;
  }

  /* ---------- pointer ---------- */
  function setRay(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function pick(cx, cy) {
    setRay(cx, cy);
    scene.updateMatrixWorld();
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.index : -1;
  }

  function onPointerDown(e) {
    if (!ready) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveAt = performance.now();
    movedPx = 0;
    downAt = lastMoveAt;
    vel = 0;
    spinTarget = null;
    idleFor = 0;
    stage.classList.add('is-dragging');
    try {
      stage.setPointerCapture(e.pointerId);
    } catch (err) {
      /* no-op */
    }
  }

  function onPointerMove(e) {
    if (!ready) return;

    if (!dragging) {
      if (finePointer) {
        hoverX = e.clientX;
        hoverY = e.clientY;
        hoverDirty = true;
      }
      if (e.pointerType === 'mouse') {
        parallax.tx = (e.clientX / view.w - 0.5) * 0.42;
        parallax.ty = -(e.clientY / view.h - 0.5) * 0.26;
      }
      return;
    }
    if (e.pointerId !== pointerId) return;

    const now = performance.now();
    const dt = Math.max(now - lastMoveAt, 1) / 1000;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    lastMoveAt = now;
    movedPx += Math.abs(dx) + Math.abs(dy);

    // immediate, 1:1 mapping — no state updates, no easing in the drag path
    rot += dx * view.sens;

    const instantVel = (dx * view.sens) / dt;
    vel = vel * 0.35 + instantVel * 0.65;

    idleFor = 0;
    parallax.tx = 0;
    parallax.ty = 0;
  }

  function endDrag(e, cancelled) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    try {
      if (pointerId !== null) stage.releasePointerCapture(pointerId);
    } catch (err) {
      /* no-op */
    }
    pointerId = null;

    if (!cancelled) {
      const elapsed = performance.now() - downAt;
      if (movedPx < 8 && elapsed < 700) {
        // a click, not a drag
        vel = 0;
        const hit = pick(e.clientX, e.clientY);
        select(hit);
        return;
      }
    }

    // natural, restrained inertia
    vel = clamp(vel, -3.4, 3.4);
    if (Math.abs(vel) < 0.06) vel = 0;
    idleFor = 0;
  }

  const onPointerUp = (e) => endDrag(e, false);
  const onPointerCancel = (e) => endDrag(e, true);
  const onWindowBlur = () => endDrag({ clientX: 0, clientY: 0 }, true);

  /* ---------- frame ---------- */
  function updateCards(dt) {
    const k = 1 - Math.exp(-dt * 10);
    const s = view.scale;

    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      c.sel += ((i === selected ? 1 : 0) - c.sel) * k;
      c.hover += ((i === hovered ? 1 : 0) - c.hover) * k;

      const e = c.sel;
      const h = c.hover;

      c.inner.scale.setScalar(1 + (SEL_SCALE - 1) * e + 0.02 * h);
      c.group.position.copy(c.base).addScaledVector(c.normal, LIFT * e);

      // how squarely this card faces the camera（含整环偏移，与实际渲染角度一致）
      const a = c.angle + rot + rotOffset;

      // 卡片朝向做阻尼：侧边卡片只半转身，既有纵深又保持可读。
      // 角度先折到 (-π, π]，保证左右两侧对称、背面卡片自然背向。
      const twoPi = Math.PI * 2;
      let aa = a % twoPi;
      if (aa > Math.PI) aa -= twoPi;
      else if (aa < -Math.PI) aa += twoPi;
      c.group.rotation.y = aa * YAW_DAMP - (rot + rotOffset);

      const nx = Math.sin(a);
      const nz = Math.cos(a);
      const px = nx * view.radius * s;
      const pz = nz * view.radius * s;
      const dx = camera.position.x - px;
      const dz = camera.position.z - pz;
      const inv = 1 / (Math.hypot(dx, dz) || 1);
      const face = Math.max(0, (nx * dx + nz * dz) * inv);
      c.face = face;
      c.depth = view.camZ - pz;

      // prints lose their light as they turn away from the viewer
      const falloff = 0.34 + 0.66 * Math.pow(face, 1.5);
      const lit = falloff + (1 - falloff) * e * 0.85;
      c.photoMat.color.setScalar(lit * (1 + 0.18 * e + 0.05 * h));

      c.shadowMat.opacity = 0.3 * Math.pow(face, 0.9);
      c.shadow.visible = face > 0.25;
      const rimOp = (0.62 * e + 0.12 * h) * face;
      c.rimMat.opacity = rimOp;
      c.rim.visible = rimOp > 0.006;
    }
  }

  function applyPanelContent(panel, item) {
    panel.__item = item;
    const name = panel.querySelector('.cp__name');
    const meta = panel.querySelector('.cp__meta');
    const tags = panel.querySelector('.cp__tags');
    const desc = panel.querySelector('.cp__desc');
    const cta = panel.querySelector('.cp__cta:not(.cp__cta--alt)');
    const ctaAlt = panel.querySelector('.cp__cta--alt');
    if (name) name.textContent = item.label || '';
    if (meta) meta.textContent = item.meta || '';
    if (tags) {
      tags.textContent = '';
      (item.tags || []).slice(0, 3).forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'cp__tag';
        chip.textContent = t;
        tags.append(chip);
      });
    }
    if (desc) desc.textContent = item.desc || '';
    if (cta && item.href) {
      cta.href = item.href;
      cta.textContent = item.ctaLabel || '进入';
      if (item.ctaTitle) cta.title = item.ctaTitle;
    }
    if (ctaAlt) {
      if (item.secondaryHref) {
        ctaAlt.href = item.secondaryHref;
        ctaAlt.textContent = item.secondaryLabel || '查看详情';
        ctaAlt.hidden = false;
      } else {
        ctaAlt.hidden = true;
      }
    }
  }

  async function setItems(nextItems) {
    if (!cards.length || destroyed) return false;
    const images = await Promise.all(nextItems.map((it) => loadImage(it.src)));
    if (destroyed) return false;
    for (let i = 0; i < cards.length && i < nextItems.length; i += 1) {
      const c = cards[i];
      const item = nextItems[i];
      const faceCanvas = bakeFace(images[i]);
      const tex = makeTexture(faceCanvas);
      const prev = c.faceTex;
      c.faceTex = tex;
      c.photoMat.map = tex;
      c.photoMat.needsUpdate = true;
      prev.dispose();
      if (c.panel) {
        applyPanelContent(c.panel, item);
        c.infoH = null;
      }
      c.item = item;
    }
    return true;
  }

  /** 卡片在屏幕上的中心与半径，供圆形转场取起点 */
  function screenInfo(index) {
    const c = cards[index];
    if (!c) return null;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    scene.updateMatrixWorld();
    const rect = canvas.getBoundingClientRect();
    const pts = [
      [-CARD_W / 2, CARD_H / 2],
      [CARD_W / 2, CARD_H / 2],
      [CARD_W / 2, -CARD_H / 2],
      [-CARD_W / 2, -CARD_H / 2],
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of pts) {
      _pv.set(lx, ly, 0.02).applyMatrix4(c.group.matrixWorld).project(camera);
      const x = (_pv.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-_pv.y * 0.5 + 0.5) * rect.height + rect.top;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      r: Math.max(28, Math.min(maxX - minX, maxY - minY) / 2),
    };
  }

  function updatePanels() {
    if (!overlay) return;
    const halfW = (CARD_W * 0.5) * 0.94;
    const halfH = CARD_H * 0.5;

    // 找出最靠前的一张（拖拽中信息跟随它，避免中心空白）
    let front = -1;
    let frontFace = 0;
    for (const c of cards) {
      const f = c.face || 0;
      if (f > frontFace) {
        frontFace = f;
        front = c.index;
      }
    }
    const sel = cards.find((c) => c.index === selected);
    const selFace = sel?.face || 0;

    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      const el = c.panel;
      if (!el) continue;

      const face = c.face || 0;
      const full = c.index === selected && face >= 0.45;
      // 未选中时，仅让最靠前的卡片保留一条紧凑标题，且不与选中卡片信息重叠
      const compact = !full && c.index === front && frontFace >= 0.8 && selFace < 0.45;
      const visible = full || compact;

      if (el.dataset.full !== String(full)) {
        el.classList.toggle('is-full', full);
        el.dataset.full = String(full);
        // 内容层级变化后重新测量高度，避免布局跳动
        c.infoH = null;
      }

      if (!visible || face < 0.3) {
        if (el.dataset.vis !== '0') {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          el.dataset.vis = '0';
        }
        continue;
      }

      // 取卡片顶边中点作为文字块锚点：文字块正立且与图片顶边对齐
      // 选中/悬停会放大卡片本体（inner.scale），锚点要跟随视觉边缘而不是几何边缘
      const innerS = Math.max(1, c.inner?.scale?.x || 1);
      projectCorner(c, 0, halfH * innerS, _quad[0]);
      projectCorner(c, -halfW * innerS, halfH * innerS, _quad[1]);
      projectCorner(c, halfW * innerS, halfH * innerS, _quad[2]);
      if (!_quad[0].ok || !_quad[1].ok || !_quad[2].ok) {
        el.style.opacity = '0';
        el.dataset.vis = '0';
        continue;
      }

      const topY = _quad[0].y;
      const cardW = Math.abs(_quad[2].x - _quad[1].x);
      const centerX = _quad[0].x;
      const minTop = typeof panelMinTop === 'function' ? Number(panelMinTop()) || 0 : Number(panelMinTop) || 0;
      const width = clamp(cardW, full ? 200 : 150, view.panelMaxW);
      const gap = INFO_GAP + (view.infoGapExtra || 0);

      el.style.width = `${Math.round(width)}px`;
      // 直接读真实高度，避免窗口/字体变化后沿用旧测量值
      const height = el.offsetHeight || (full ? 132 : 44);
      // 竖向空间不足时优先保证「不压图片」，间距在 6–gap 之间自适应
      const gapEff = Math.max(6, Math.min(gap, topY - minTop - height));
      const panelY = Math.max(minTop, topY - height - gapEff);
      el.style.transform = `translate3d(${(centerX - width / 2).toFixed(1)}px, ${panelY.toFixed(1)}px, 0)`;
      el.style.opacity = full ? '1' : '0.68';
      el.style.zIndex = String(full ? 900 : 700 - i * 10);
      el.style.pointerEvents = full ? 'auto' : 'none';
      el.dataset.vis = '1';
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.05) || 0.016;
    lastFrame = now;
    const t = now / 1000;

    if (!dragging) {
      if (spinTarget !== null) {
        const diff = spinTarget - rot;
        // 7 -> 10.5：切换卡片的收敛速度提升约 50%（约 1.18s -> 0.75s）
        rot += diff * (1 - Math.exp(-dt * 10.5));
        if (Math.abs(diff) < 0.0015) {
          rot = spinTarget;
          spinTarget = null;
        }
      } else if (Math.abs(vel) > 0.002) {
        rot += vel * dt;
        // 惯性衰减 2.3 -> 1.9：甩动后滑行更远一点，但不至于失控
        vel *= Math.exp(-dt * 1.9);
        idleFor = 0;
      } else {
        vel = 0;
        idleFor += dt;
        // 只影响「完全空闲」时的自转；拖动/切换/惯性路径完全不变
        if (idleFor > IDLE_AFTER && !reducedMotion) rot += IDLE_SPIN_SPEED * dt;
      }
    }

    ring.rotation.y = rot + rotOffset;

    if (!reducedMotion) {
      world.position.y = view.ringY + Math.sin(t * 0.55) * 0.03 + Math.sin(t * 0.31 + 1.3) * 0.012;
      world.rotation.z = Math.sin(t * 0.4) * 0.0035;
    } else {
      world.position.y = view.ringY;
    }

    parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 2.6);
    parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 2.6);
    camera.position.x = parallax.x;
    camera.position.y = 0.2 + parallax.y;
    camera.lookAt(0, 0, 0);

    if (hoverDirty && !dragging && finePointer) {
      hoverDirty = false;
      const hit = pick(hoverX, hoverY);
      if (hit !== hovered) {
        hovered = hit;
        stage.classList.toggle('is-hovering', hit >= 0);
        onHover?.(hit);
      }
    }

    updateCards(dt);

    // 面板投影前手动刷新矩阵，保证与画面同一帧
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    scene.updateMatrixWorld();
    updatePanels();

    renderer.render(scene, camera);
  }

  /* ---------- listeners ---------- */
  stage.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  init();

  /* ---------- teardown ---------- */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    stage.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);

    cards.forEach((c) => {
      c.panel?.remove();
      c.faceTex.dispose();
      c.photoMat.dispose();
      c.shadowMat.dispose();
      c.rimMat.dispose();
    });
    [faceGeo, shadowGeo, rimGeo].forEach((g) => g.dispose());
    [shadowTex, rimTex, glowTex].forEach((t) => t.dispose());
    backdrop.geometry.dispose();
    backdrop.material.dispose();
    renderer.dispose();
  }

  return {
    select,
    rotateTo,
    setItems,
    screenInfo,
    setOffset(value) {
      rotOffset = value;
    },
    get items() {
      return cards.map((c) => c.item);
    },
    /** 只读诊断：每张卡的世界角度、正面度与屏幕位置 */
    get layout() {
      return cards.map((c) => {
        const p = new THREE.Vector3();
        c.group.getWorldPosition(p);
        return { index: c.index, face: +(c.face || 0).toFixed(3), angle: +c.angle.toFixed(3), x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +c.group.rotation.y.toFixed(3) };
      });
    },
    pause() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    resume() {
      if (!raf && ready && !destroyed) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    get selected() {
      return selected;
    },
    get rotation() {
      return rot;
    },
    get debug() {
      return {
        camZ: camera.position.z,
        fov: camera.fov,
        aspect: camera.aspect,
        scale: view.scale,
        radius: view.radius,
        viewW: view.w,
        viewH: view.h,
        buffer: [renderer.domElement.width, renderer.domElement.height],
        css: [renderer.domElement.clientWidth, renderer.domElement.clientHeight],
      };
    },
    /** 只读诊断：卡片几何顶边在屏幕上的绝对位置 */
    geomTop(index) {
      const c = cards[index];
      if (!c) return null;
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      _pv.set(0, CARD_H / 2, 0.02).applyMatrix4(c.group.matrixWorld).project(camera);
      return +((-_pv.y * 0.5 + 0.5) * view.h).toFixed(1);
    },
    get ready() {
      return ready;
    },
    destroy,
  };
}
