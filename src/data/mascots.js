// 首页悬浮小精灵素材：本地 SVG，不依赖生图服务。
// 每次页面加载随机选一个，同一次访问内保持不变。

const EYES = `
  <ellipse cx="25" cy="40" rx="2.1" ry="2.6" fill="#2b2118"/>
  <ellipse cx="39" cy="40" rx="2.1" ry="2.6" fill="#2b2118"/>
  <circle cx="25.7" cy="39.2" r="0.7" fill="#fff"/>
  <circle cx="39.7" cy="39.2" r="0.7" fill="#fff"/>
`;

export const MASCOTS = [
  {
    id: 'baozi',
    name: '包子',
    line: '刚出笼，热乎着呢。',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="52" rx="16" ry="3.4" fill="#000" opacity=".22"/>
      <path d="M12 38c0-11 9-19 20-19s20 8 20 19c0 9-9 14-20 14S12 47 12 38Z" fill="#f3e3c6"/>
      <path d="M32 19c-3 2-4 5-3 8 1 2 4 3 6 2" stroke="#d9c09a" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M32 19c3 2 4 5 3 8-1 2-4 3-6 2" stroke="#d9c09a" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M20 33c-2 2-3 4-3 6" stroke="#e2cba7" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M44 33c2 2 3 4 3 6" stroke="#e2cba7" stroke-width="1.4" stroke-linecap="round"/>
      ${EYES}
      <circle cx="18.5" cy="44" r="2.6" fill="#e8a08a" opacity=".55"/>
      <circle cx="45.5" cy="44" r="2.6" fill="#e8a08a" opacity=".55"/>
      <path d="M29 44c1.6 1.6 4.4 1.6 6 0" stroke="#8a6a4a" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'jiaozi',
    name: '饺子',
    line: '捏好了边，就等下锅。',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="53" rx="17" ry="3.2" fill="#000" opacity=".2"/>
      <path d="M8 38c0-13 11-22 24-22s24 9 24 22c0 7-5 10-10 10H18c-5 0-10-3-10-10Z" fill="#f7ecd8"/>
      <path d="M12 34c3-2 5-5 6-8M22 30c2-2 3-5 4-8M32 28c1-3 1-6 1-9M42 30c-1-2-2-5-3-8M52 34c-3-2-5-5-6-8" stroke="#e4d3b6" stroke-width="1.5" stroke-linecap="round"/>
      ${EYES}
      <circle cx="18.5" cy="45" r="2.4" fill="#e8a08a" opacity=".5"/>
      <circle cx="45.5" cy="45" r="2.4" fill="#e8a08a" opacity=".5"/>
      <path d="M29.5 45c1.4 1.4 3.6 1.4 5 0" stroke="#8a6a4a" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'tangyuan',
    name: '汤圆',
    line: '圆滚滚的，甜在里头。',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="55" rx="18" ry="3" fill="#000" opacity=".2"/>
      <path d="M7 36h50c0 12-11 19-25 19S7 48 7 36Z" fill="#d8c7ae"/>
      <path d="M7 36h50" stroke="#c2ad90" stroke-width="1.4"/>
      <circle cx="24" cy="34" r="11" fill="#fdf8ee"/>
      <circle cx="40" cy="35" r="9.5" fill="#fbf4e6"/>
      <ellipse cx="24" cy="30" rx="4" ry="2.6" fill="#fff" opacity=".9"/>
      ${EYES}
      <circle cx="18" cy="42" r="2.3" fill="#e8a08a" opacity=".5"/>
      <circle cx="45.5" cy="42" r="2.3" fill="#e8a08a" opacity=".5"/>
    </svg>`,
  },
  {
    id: 'tanghulu',
    name: '糖葫芦',
    line: '一串三颗，酸甜刚好。',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 58V26" stroke="#c9a06a" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="32" cy="16" r="9.5" fill="#c8402c"/>
      <circle cx="32" cy="30" r="10.5" fill="#d24a33"/>
      <circle cx="32" cy="45" r="9" fill="#bd3a28"/>
      <circle cx="28.5" cy="12.5" r="2.6" fill="#fff" opacity=".55"/>
      <circle cx="28" cy="26.5" r="3" fill="#fff" opacity=".5"/>
      <circle cx="28.5" cy="42" r="2.4" fill="#fff" opacity=".45"/>
      <circle cx="29" cy="30" r="1.6" fill="#2b2118"/>
      <circle cx="35" cy="30" r="1.6" fill="#2b2118"/>
      <path d="M29.5 34c1.2 1 3.2 1 4.4 0" stroke="#f6d9c9" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'lajiao',
    name: '小辣椒',
    line: '别看我小，脾气不小。',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="55" rx="14" ry="2.8" fill="#000" opacity=".2"/>
      <path d="M38 16c8 2 14 9 13 18-1 11-10 19-20 18-8-1-13-7-12-14 1-6 6-9 11-8 4 1 6 5 4 8" fill="#cf4430"/>
      <path d="M38 16c2-4 6-6 10-5-1 4-3 7-7 8" fill="#5f8a52"/>
      <circle cx="33" cy="34" r="1.9" fill="#2b2118"/>
      <circle cx="41" cy="33" r="1.9" fill="#2b2118"/>
      <circle cx="33.6" cy="33.3" r=".6" fill="#fff"/>
      <circle cx="41.6" cy="33.3" r=".6" fill="#fff"/>
      <path d="M34 39c1.6 1.4 4 1.4 5.6 0" stroke="#7d2418" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="27.5" cy="39" r="2.2" fill="#e8806a" opacity=".6"/>
    </svg>`,
  },
];

let cached = null;

export function currentMascot() {
  if (!cached) {
    // 每次页面加载随机一次，访问期间保持稳定
    cached = MASCOTS[Math.floor(Math.random() * MASCOTS.length)];
  }
  return cached;
}
