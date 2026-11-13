/**
 * 全站背景音乐清单。
 *
 * 原始文件在仓库根目录 music/；部署副本放在 public/music/，
 * 文件名改为 ASCII，避免中文、空格和长破折号在不同静态服务器 / CDN 上出现 URL 兼容问题。
 * source 保留原始文件名，便于核对资源来源。
 *
 * 播放顺序不按此数组固定：播放器会在整份清单里随机抽取，
 * 一轮内每首最多播放一次，轮次之间也不会紧接着重复上一首。
 */
export const MUSIC_TRACKS = [
  {
    id: 'tokyo-lofi',
    file: '01-tokyo-lofi.mp3',
    title: '东京洛菲',
    source: '东京洛菲.mp3',
  },
  {
    id: 'warm-acoustic-guitar',
    file: '02-warm-acoustic-guitar.mp3',
    title: '暖声木吉他',
    source: '吉他Warm Acoustic Guitar.mp3',
  },
  {
    id: 'ambient-lofi',
    file: '03-ambient-lofi.mp3',
    title: '环境洛菲',
    source: '环境洛菲.mp3',
  },
  {
    id: 'mountain-spring',
    file: '04-mountain-spring.mp3',
    title: '山泉笛声',
    source: '笛Mountain Spring (full version) Chinese Music.mp3',
  },
  {
    id: 'bamboo-flute-guzheng',
    file: '05-bamboo-flute-guzheng.mp3',
    title: '竹笛与古筝',
    source: '筝Chinese Bamboo Flute & Guzheng – Relaxing Zen Music.mp3',
  },
  {
    id: 'cozy-coffee',
    file: '06-cozy-coffee.mp3',
    title: '咖啡馆轻爵士',
    source: '轻爵士Cozy - Cozy Coffee Music.mp3',
  },
  {
    id: 'cozy-soulful',
    file: '07-cozy-soulful.mp3',
    title: '灵魂轻爵士',
    source: '轻爵士Cozy Soulful Music .mp3',
  },
  {
    id: 'calm-piano',
    file: '08-calm-piano.mp3',
    title: '静谧钢琴',
    source: '钢琴Calm Piano.mp3',
  },
  {
    id: 'gentle-morning-keys',
    file: '09-gentle-morning-keys.mp3',
    title: '晨光轻钢琴',
    source: '钢琴Piano Soft Gentle Morning Keys.mp3',
  },
  {
    id: 'soft-piano',
    file: '10-soft-piano.mp3',
    title: '柔和钢琴',
    source: '钢琴Soft Piano - Soft Piano Music.mp3',
  },
  {
    id: 'lofi-cafe',
    file: '11-lofi-cafe.mp3',
    title: '咖啡馆 Lofi',
    source: '鼓Lofi咖啡馆.mp3',
  },
  {
    id: 'lofi-restaurant',
    file: '12-lofi-restaurant.mp3',
    title: '餐厅 Lofi',
    source: '鼓Lofi餐厅.mp3',
  },
];