// 菜品去重合并登记表
// ------------------------------------------------------------
// 原始迁移库和 AI 补全库保留完整记录，便于回滚与追溯；
// 这里声明哪些记录不再进入运行时菜品目录，以及合并到哪一道标准菜。
// 只处理菜品数据和分类/口味关联，不涉及页面布局或图片文件。
//
// kind:
//   duplicate  同名、同核心做法 -> A 类完全重复
//   alias      不同名称但实际是同一道菜 -> C 类别名/异名
//   variant    同一道菜的做法/流派版本 -> B 类，经判断不具备独立代表性

export const MERGED_DISHES = Object.freeze({
  // 迁移库与精选菜同名重复：保留资料更完整的精选菜
  shuizhuyu: { into: 'shui-zhu-yu', name: '水煮鱼', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  baiqieji: { into: 'bai-qie-ji', name: '白切鸡', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'tangcu-liyu': { into: 'tang-cu-li-yu', name: '糖醋鲤鱼', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'congshao-haishen': { into: 'cong-shao-hai-shen', name: '葱烧海参', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'songshu-guiyu': { into: 'song-shu-gui-yu', name: '松鼠鳜鱼', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'xihu-cuyu': { into: 'xi-hu-cu-yu', name: '西湖醋鱼', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'longjing-shrimp': { into: 'long-jing-xia-ren', name: '龙井虾仁', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  fotiaoqiang: { into: 'fo-tiao-qiang', name: '佛跳墙', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  lizhirou: { into: 'li-zhi-rou', name: '荔枝肉', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'duojiao-yutou': { into: 'duo-jiao-yu-tou', name: '剁椒鱼头', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },
  'huangshan-dunge': { into: 'huang-shan-dun-ge', name: '黄山炖鸽', kind: 'duplicate', reason: '与精选菜同名同做法，保留资料完整的精选版' },

  // 不同名称、同一道菜：保留标准名，异名进入搜索别名
  chouguiyu: { into: 'chou-gui-yu', name: '徽州臭鳜鱼', kind: 'alias', reason: '“徽州臭鳜鱼”是臭鳜鱼的地域名，合并到标准菜“臭鳜鱼”' },
  'qingzheng-luyu': { into: 'qing-zheng-yu', name: '清蒸鲈鱼', kind: 'alias', reason: '清蒸鱼的标准做法之一，合并到通用标准菜“清蒸鱼”' },
  'qingdun-shizitou': { into: 'shi-zi-tou', name: '清炖狮子头', kind: 'variant', reason: '清炖只是狮子头的常规做法，不单独保留；蟹粉狮子头因有独立时令特色保留' },

  // AI 补全库中的低信息量重复项
  'ai-12b870024f': { into: 'mapo-tofu', name: '麻辣豆腐', kind: 'alias', reason: '“麻辣豆腐”是麻婆豆腐的常见家常叫法，合并到标准菜' },
  'ai-83acc6ac10': { into: 'yanshuiya', name: '广东咸水鸭', kind: 'alias', reason: '“咸水鸭”与盐水鸭主料、成菜方式高度重合，且原记录无图片/食材，合并到盐水鸭' },
  'ai-25e5ab7a4c': { into: 'qing-zheng-yu', name: '清蒸海鲈鱼', kind: 'alias', reason: '清蒸鱼的鱼类变体，合并到清蒸鱼并保留为搜索别名' },
  'ai-c01f3c24aa': { into: 'qing-zheng-yu', name: '清蒸石斑鱼', kind: 'alias', reason: '清蒸鱼的鱼类变体，合并到清蒸鱼并保留为搜索别名' },
});

/** 标准菜的可检索别名，不生成独立菜品卡片 */
export const DISH_ALIASES = Object.freeze({
  'shui-zhu-yu': ['水煮鱼片'],
  'bai-qie-ji': ['白斩鸡'],
  gongbaojiding: ['宫爆鸡丁'],
  'haili-jian': ['蚵仔煎', '蚝仔煎'],
  'chou-gui-yu': ['徽州臭鳜鱼'],
  'qing-zheng-yu': ['清蒸鲈鱼', '清蒸海鲈鱼', '清蒸石斑鱼'],
  'shi-zi-tou': ['清炖狮子头'],
  'mapo-tofu': ['麻辣豆腐'],
  yanshuiya: ['广东咸水鸭'],
  'song-shu-gui-yu': ['松鼠桂鱼'],
  'dongan-ziji': ['东安鸡'],
  'li-hongzhang-zahui': ['李鸿章大杂烩'],
});

/**
 * 口味关联修正：只去掉与该菜实际风味不符或重复的次要标签。
 * 每道菜仍保留第一项为主味型；未列出的菜保持原样。
 */
export const TASTE_OVERRIDES = Object.freeze({
  // 糖醋菜不是“酸辣”，而是“鲜甜柔和”（xiantian）
  'tang-cu-li-yu': ['xiantian'],
  'song-shu-gui-yu': ['xiantian'],
  'li-zhi-rou': ['xiantian'],
  'xi-hu-cu-yu': ['xiantian', 'qingxian'],
  'pianer-chuan': ['qingxian', 'xianxian'],
  'laohuo-liangtang': ['qingxian', 'xianxian'],
  'jiuzhuan-dachang': ['xiangla', 'xiantian'],
  'sixi-wanzi': ['jiangxiang', 'xianxian'],
  'nongjia-xiaochaorou': ['xiangla', 'xianxian'],
  'lawei-hezheng': ['xianxian', 'chunhou'],
  'haili-jian': ['xianxian', 'xiantian'],
  'huotui-dunjiayu': ['qingxian', 'chunhou'],
  suancaiyu: ['suanla', 'xiangla'],
});

/** 主味型改变时同步人格，避免详情页人格与口味标签不一致 */
export const PERSONALITY_OVERRIDES = Object.freeze({
  'xi-hu-cu-yu': 'xiantian',
});

export const mergedDishId = (id) => MERGED_DISHES[id]?.into || id;

export function isMergedDish(id) {
  return Boolean(MERGED_DISHES[id]);
}