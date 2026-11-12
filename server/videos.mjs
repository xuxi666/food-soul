/**
 * 站内做菜视频搜索（服务端）
 * ------------------------------------------------------------
 * 数据来源：
 * - 哔哩哔哩：调用网页版公开搜索接口（先取匿名会话 buvid3，再搜索；命中风控刷新一次会话重试）。
 *   不登录、不破解签名、不绕过验证码；拿不到就如实报错，绝不伪造数据。
 * - 抖音 / 小红书 / 西瓜视频：不抓取，只提供官方搜索入口（sourceType = 'search-entry'）。
 *
 * 美食范围约束（2026-11）：
 * 1) 明显非美食的关键词直接拒绝，不请求外部平台；
 * 2) 模糊关键词（开机 / 设置 / 制作 / 教程…）追加烹饪语境，并要求结果确实命中原始意图；
 * 3) 每条视频在返回前都要过 classifyVideoCandidate：标题 / 简介 / 标签 / 分类 / 作者，
 *    non_food 与 unknown 一律不进入结果；
 * 4) 过滤之后才做相关度排序、去重和数量截断，分页请求走同一套逻辑。
 * 5) 菜品详情模式（/api/videos/dish）只收标题/简介/标签/分区/作者里明确出现当前菜名的视频，
 *    不用同类菜系兜底；菜名被当汽车/段子/盘点梗使用的非美食内容也会被剔除。
 *
 * 缓存：关键词 + 页码级内存缓存 10 分钟；失败短缓存 60 秒。
 */

import { createHash } from 'node:crypto';
import { findDish } from './dish-search.mjs';

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BILIBILI_ORIGIN = 'https://www.bilibili.com/';
const BILIBILI_SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/search/type';
const BILIBILI_WBI_SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
const BILIBILI_NAV_ENDPOINT = 'https://api.bilibili.com/x/web-interface/nav';
const SESSION_TTL_MS = 25 * 60 * 1000;
const SESSION_FAIL_COOLDOWN_MS = 30 * 1000;
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

/* ------------------------------ 平台元数据 ------------------------------ */

export const VIDEO_PLATFORMS = {
  bilibili: {
    id: 'bilibili',
    label: '哔哩哔哩',
    short: 'B站',
    searchUrl: (keyword) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
  },
  douyin: {
    id: 'douyin',
    label: '抖音',
    short: '抖音',
    searchUrl: (keyword) => `https://www.douyin.com/search/${encodeURIComponent(keyword)}`,
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    label: '小红书',
    short: '小红书',
    searchUrl: (keyword) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`,
  },
  xigua: {
    id: 'xigua',
    label: '西瓜视频',
    short: '西瓜',
    searchUrl: (keyword) => `https://www.ixigua.com/search/${encodeURIComponent(keyword)}/`,
  },
};

export const VIDEO_PLATFORM_IDS = ['bilibili', 'douyin', 'xiaohongshu', 'xigua'];

/* ------------------------------ 美食词表 ------------------------------ */

/** 具体菜品 / 主食 / 点心 / 饮品。只收高精度词，避免「菜」「汤」这种单字误伤。 */
const DISH_TERMS = [
  '红烧肉', '麻婆豆腐', '水煮鱼', '剁椒鱼头', '白切鸡', '宫保鸡丁', '佛跳墙', '松鼠鳜鱼',
  '东坡肉', '回锅肉', '鱼香肉丝', '糖醋排骨', '小炒肉', '口水鸡', '夫妻肺片', '毛血旺',
  '辣子鸡', '大盘鸡', '黄焖鸡', '三杯鸡', '叫花鸡', '盐焗鸡', '猪肚鸡', '椰子鸡',
  '酸菜鱼', '水煮肉片', '红烧鱼', '糖醋鱼', '清蒸鱼', '白灼虾', '盐水鸭', '烤鸭',
  '火锅', '麻辣烫', '螺蛳粉', '兰州拉面', '热干面', '炸酱面', '臊子面', '担担面',
  '葱油拌面', '羊肉泡馍', '肉夹馍', '凉皮', '肠粉', '叉烧', '烧鹅', '卤味',
  '煎饼果子', '小笼包', '生煎包', '烧麦', '饺子', '包子', '馄饨', '汤圆',
  '月饼', '粽子', '年糕', '春卷', '蛋炒饭', '扬州炒饭', '煲仔饭', '卤肉饭',
  '咖喱饭', '寿司', '拉面', '意面', '披萨', '汉堡', '炸鸡', '薯条',
  '炒饭', '盖饭', '拌饭', '饭团',
  '蛋糕', '面包', '吐司', '饼干', '曲奇', '蛋挞', '布丁', '慕斯',
  '冰淇淋', '奶茶', '咖啡', '豆浆', '米酒', '糖水', '粥', '米粉',
  '米线', '面条', '粉丝', '凉粉', '豆腐脑', '豆花', '烤串', '烧烤',
];

/** 食材 / 调味料 / 香辛料。 */
const INGREDIENT_TERMS = [
  '五花肉', '牛肉', '羊肉', '猪肉', '鸡肉', '鸭肉', '鹅肉', '鱼肉', '鱼头', '鱼片',
  '虾仁', '螃蟹', '鱿鱼', '章鱼', '扇贝', '蛤蜊', '生蚝', '排骨', '猪蹄', '牛腩',
  '肥牛', '培根', '火腿', '香肠', '鸡蛋', '鸭蛋', '鹌鹑蛋', '豆腐', '豆干', '腐竹',
  '鸡腿', '鸡翅', '鸡胸', '鸡爪', '鸭腿', '牛腱', '牛舌', '毛肚', '黄喉', '鲫鱼',
  '鲈鱼', '草鱼', '带鱼', '三文鱼', '金枪鱼', '基围虾',
  '豆皮', '木耳', '银耳', '香菇', '金针菇', '平菇', '杏鲍菇', '口蘑', '竹笋', '芦笋',
  '白菜', '青菜', '菠菜', '芹菜', '韭菜', '茄子', '番茄', '西红柿', '土豆', '红薯',
  '山药', '芋头', '莲藕', '萝卜', '胡萝卜', '黄瓜', '南瓜', '冬瓜', '丝瓜', '苦瓜',
  '辣椒', '花椒', '胡椒', '八角', '桂皮', '香叶', '孜然', '葱', '姜', '蒜',
  '香菜', '薄荷', '紫苏', '酱油', '生抽', '老抽', '蚝油', '料酒', '香醋',
  '陈醋', '蜂蜜', '面粉', '糯米粉', '淀粉', '大米', '小米', '燕麦', '红豆', '绿豆',
  '花生', '芝麻', '核桃', '腰果', '红枣', '枸杞', '牛奶', '奶油', '黄油', '芝士',
  '酸奶', '茶叶', '海带', '紫菜', '玉米', '豌豆', '蚕豆', '毛豆', '栗子', '莲子',
  '百合', '桂圆', '山楂', '柠檬', '橙子', '苹果', '香蕉', '草莓', '芒果', '菠萝',
  '西瓜', '葡萄', '桃子', '梨', '樱桃', '荔枝', '龙眼', '薄荷叶', '香茅', '咖喱粉',
];

/** 高精度烹饪技法：单独出现也能说明是烹饪内容。 */
const METHOD_STRONG_TERMS = [
  '刀工', '火候', '调味', '收汁', '勾芡', '发面', '揉面', '醒面', '烘焙', '烘烤',
  '焯水', '上浆', '挂糊', '开锅', '预热', '慢炖', '腌制', '发酵', '烟熏', '风干',
  '红烧', '清蒸', '糖醋', '蒜蓉', '干锅', '小炒', '凉拌', '酱香', '椒盐', '白灼',
];

/** 单字/泛化烹饪动作：需要同时有食材、菜品或美食分类兜底。 */
const METHOD_GENERIC_TERMS = ['炒', '炖', '煮', '蒸', '炸', '烤', '焖', '煎', '拌', '卤', '腌', '熬', '煲', '焯'];

const CULTURE_TERMS = [
  '饮食文化', '美食文化', '饮食习俗', '地方饮食', '美食历史', '传统节日', '年夜饭', '中秋',
  '端午', '春节', '元宵', '腊八', '节气', '非遗', '老字号', '美食纪录片', '街头美食',
  '夜市', '大排档', '地方特色', '特产', '八大菜系', '川菜', '粤菜', '鲁菜', '苏菜',
  '浙菜', '闽菜', '湘菜', '徽菜', '东北菜', '西北菜', '云南菜', '贵州菜', '新疆菜',
  '客家菜', '潮汕菜', '淮扬菜', '本帮菜', '京菜', '鄂菜', '赣菜', '豫菜', '陕菜',
  '桂菜', '琼菜', '港式', '台式', '日料', '韩餐', '西餐', '东南亚菜', '意大利菜', '法国菜',
];

const REVIEW_TERMS = ['美食探店', '探店', '试吃', '吃播', '美食测评', '餐厅测评', '馆子', '苍蝇馆子', '路边摊'];

/** 设备维修/拆机不是烹饪内容，即使标题里有「烤箱」「烤」也不放行。 */
const REPAIR_TERMS = ['修复', '维修', '拆机', '拆解', '电路', '故障', '修理', '更换零件', '不工作'];

const PROCESSING_TERMS = [
  '食品加工', '食品制作', '制作工艺', '加工工艺', '腊肉', '香肠', '腌菜', '泡菜', '酿酒',
  '制酱', '豆腐制作', '面粉加工', '冷链', '食品包装', '罐头', '干货', '晒干', '腌制',
];

const KITCHEN_EQUIPMENT_TERMS = [
  '炒锅', '蒸锅', '烤箱', '空气炸锅', '电饭煲', '高压锅', '砂锅', '汤锅', '平底锅',
  '不粘锅', '料理机', '破壁机', '厨师机', '打蛋器', '和面机', '压面机', '刀具', '菜刀',
  '砧板', '擀面杖', '烘焙模具', '厨房秤', '燃气灶', '电磁炉', '微波炉', '蒸烤箱',
  '发酵箱', '咖啡机', '豆浆机', '榨汁机', '电饼铛', '电蒸锅', '料理棒', '厨房电器',
];

const GENERIC_FOOD_TERMS = [
  '美食', '菜谱', '食谱', '做法', '烹饪', '厨艺', '厨房', '大厨', '厨师', '吃货',
  '好吃', '下饭', '味道', '口感', '鲜香', '香辣', '麻辣', '食材', '饮食', '料理',
  '面点', '甜品', '饮品', '小吃', '早餐', '午餐', '晚餐', '夜宵', '家常菜', '私房菜',
  '农家菜', '招牌菜', '菜品', '菜单', '食欲', '开胃', '解馋', '食补', '养生食谱', '做菜',
];

/** 明显的非美食内容。命中后若标题没有任何美食信号，直接判 non_food。 */
const NON_FOOD_TERMS = [
  '电脑', '笔记本电脑', '台式机', '主机', '装机', 'windows', 'win7', 'win10', 'win11',
  '系统安装', '重装系统', '显卡', '主板', 'cpu', '内存条', '固态硬盘', '机械硬盘',
  '显示器', '键盘', '鼠标', '路由器', '光猫', '宽带', '网线', '驱动', 'bios', '蓝屏',
  '死机', '手机', 'iphone', '苹果手机', '安卓', '刷机', '越狱', 'ps5', 'ps4',
  'playstation', 'xbox', 'switch', '任天堂', '游戏', '攻略', '通关', '存档', '电竞',
  '手游', '端游', 'steam', '软件', 'app', '编程', '代码', 'python', 'java', 'excel',
  'ppt', 'word', '办公', '修图', 'p图', '剪映', '剪辑', '特效', 'ai漫剧', '漫剧',
  '短剧', '电影', '电视剧', '综艺', '动漫', '动画', '娱乐', '明星', '音乐', '舞蹈',
  '健身', '瑜伽', '英语', '数学', '考试', '公文', '写作', '营销', '电商', '直播带货',
  '开箱', '数码', '科技', '黑科技', '汽车', '穿搭', '美妆', '护肤', '旅游', '摄影',
  '相机', '无人机', '装修', '家具', '招聘', '理财', '保险', '房产', '教育', '课程',
  '电视', '投影仪', '遥控器', '电视盒子', 'homeassistant', '智能家居', '小宠异宠', '观赏鱼',
  '热带鱼', '水族', '鱼缸', '宠物', '种植', '栽培', '种土豆', '播种', '育苗', '施肥',
  '浇水', '农技', '农业', '三农', '糖尿病', '血糖', '控糖',
];

/** B 站分区里明确不属于美食的。'日常' / '生活' 不硬判，避免误伤美食 vlog。 */
const NON_FOOD_CATEGORY_RE = /(数码|软件应用|游戏|科技|影视|娱乐|综艺|动画|鬼畜|音乐|舞蹈|健身|教育|资讯|汽车|时尚|美妆|搞笑|家居|小宠异宠|宠物|农业|三农|科学科普|健康|养生|电视)/;
const FOOD_CATEGORY_RE = /(美食|烹饪|菜谱|食谱|厨艺|烘焙|饮食|田园美食|美食制作|美食侦探|美食测评|吃播)/;

/** 明确不属于美食的搜索词。命中即拒绝，不请求平台。 */
const EXPLICIT_NON_FOOD_QUERY_RES = [
  /电脑|笔记本|台式机|windows|win7|win10|win11|macbook|显卡|主板|cpu|内存条|固态硬盘|路由器|光猫|宽带/,
  /ps[45]|playstation|xbox|switch|任天堂|游戏攻略|通关|电竞|手游|端游|steam/,
  /手机|iphone|安卓|刷机|越狱/,
  /编程|代码|python|java|excel|ppt|word|办公软件|修图|p图|剪映|剪辑|ai漫剧|短剧|电影|电视剧|综艺|动漫|娱乐|明星|音乐|舞蹈|健身|瑜伽|英语|数学|考试|公文/,
  /装机|装系统|重装系统|网络设置|wifi设置/,
];

/** 模糊词：必须带烹饪语境检索，并要求视频确实命中原始意图。 */
const AMBIGUOUS_TERMS = [
  '开机', '设置', '制作', '教程', '安装', '维修', '测评', '评测', '推荐', '使用',
  '技巧', '方法', '教学', '入门', '零基础', '操作', '选购', '购买', '清洗', '保养',
  '连接', '激活', '下载', '注册',
];

const AMBIGUOUS_SYNONYMS = {
  开机: ['开机', '首次使用', '第一次使用', '启动', '通电', '开锅'],
  设置: ['设置', '设定', '调节', '调温', '温度'],
  安装: ['安装', '组装', '装配'],
  维修: ['维修', '修理', '故障', '不工作'],
  使用: ['使用', '用法', '怎么用', '操作'],
  清洗: ['清洗', '洗', '清洁'],
  保养: ['保养', '养护', '清洁'],
  连接: ['连接', '配对'],
  制作: ['制作', '做法', '自制', '手工'],
  教程: ['教程', '教学', '做法', '步骤'],
  教学: ['教学', '教程', '讲解'],
  技巧: ['技巧', '窍门', '方法', '秘诀'],
  方法: ['方法', '做法', '步骤'],
  推荐: ['推荐', '必吃', '好吃', '榜单'],
  测评: ['测评', '评测', '试吃', '味道'],
  选购: ['选购', '挑选', '怎么选'],
  购买: ['购买', '选购', '挑选'],
};

const EQUIPMENT_ACTION_RE = /(使用|用法|怎么用|开机|首次|第一次|预热|设置|温度|时间|清洁|保养|开锅|食谱|菜谱|烘焙|烤|蒸|煮|做)/;

/* ------------------------------ 链接校验 ------------------------------ */

const VIDEO_HOSTS = {
  bilibili: ['bilibili.com'],
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com'],
  xigua: ['ixigua.com'],
};

const COVER_HOSTS = [
  'hdslb.com',
  'bilivideo.com',
  'douyinpic.com',
  'bytedance.com',
  'byteimg.com',
  'pstatp.com',
  'xiaohongshu.com',
  'xhscdn.com',
  'ixiguavideo.com',
  'ixigua.com',
];

function hostMatches(hostname, domains) {
  const host = String(hostname || '').toLowerCase();
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function normalizeProtocolUrl(raw) {
  const text = String(raw || '').trim();
  return text.startsWith('//') ? `https:${text}` : text;
}

function sanitizeUrl(raw, domains) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(normalizeProtocolUrl(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!hostMatches(url.hostname, domains)) return null;
  url.protocol = 'https:';
  return url.toString();
}

export function sanitizeVideoUrl(raw, platform) {
  return sanitizeUrl(raw, VIDEO_HOSTS[platform] || []);
}

export function sanitizeCoverUrl(raw) {
  return sanitizeUrl(raw, COVER_HOSTS);
}

/* ------------------------------ 清洗工具 ------------------------------ */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#x0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 「3:36」「1:02:03」→ 秒；无法解析返回 0 */
export function parseBilibiliDuration(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const parts = raw.trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return 0;
}

/** 秒 → 「3:36」（小于 1 秒返回空串） */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const pad = (value) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/* ------------------------------ 美食相关性 ------------------------------ */

function textOf(value) {
  return stripHtml(String(value || '')).toLowerCase();
}

function joinedText(item) {
  return [
    textOf(item.title),
    textOf(item.description),
    ...(Array.isArray(item.tags) ? item.tags.map(textOf) : []),
    textOf(item.category),
    textOf(item.author),
  ].join(' ');
}

function collect(text, terms) {
  return terms.filter((term) => text.includes(term.toLowerCase()));
}

function unique(list) {
  return [...new Set(list)];
}

function isFoodCategory(category) {
  return FOOD_CATEGORY_RE.test(textOf(category));
}

function isNonFoodCategory(category) {
  return NON_FOOD_CATEGORY_RE.test(textOf(category));
}

/** 用户搜索词的美食类型：决定追加什么语境，而不是机械地加「美食」。 */
export function classifyVideoQuery(raw) {
  const q = stripHtml(String(raw || '')).trim();
  if (!q) return { kind: 'general', query: '', terms: [] };
  const text = q.toLowerCase();

  if (EXPLICIT_NON_FOOD_QUERY_RES.some((re) => re.test(text))) {
    return { kind: 'non_food', query: q, terms: [] };
  }

  const equipment = collect(text, KITCHEN_EQUIPMENT_TERMS);
  if (equipment.length) return { kind: 'equipment', query: q, terms: equipment };

  const culture = collect(text, CULTURE_TERMS);
  if (culture.length) return { kind: 'culture', query: q, terms: culture };

  const review = collect(text, REVIEW_TERMS);
  if (review.length) return { kind: 'review', query: q, terms: review };

  const processing = collect(text, PROCESSING_TERMS);
  if (processing.length) return { kind: 'processing', query: q, terms: processing };

  const dish = collect(text, DISH_TERMS);
  if (dish.length) return { kind: 'dish', query: q, terms: dish };

  const ingredient = collect(text, INGREDIENT_TERMS);
  if (ingredient.length) return { kind: 'ingredient', query: q, terms: ingredient };

  const method = collect(text, [...METHOD_STRONG_TERMS, ...METHOD_GENERIC_TERMS]);
  if (method.length) return { kind: 'method', query: q, terms: method };

  const generic = collect(text, GENERIC_FOOD_TERMS);
  if (generic.length) return { kind: 'general', query: q, terms: generic };

  const ambiguous = AMBIGUOUS_TERMS.find((word) => text === word || text.startsWith(word));
  if (ambiguous) return { kind: 'ambiguous', query: q, terms: [ambiguous], ambiguous };

  return { kind: 'general', query: q, terms: [] };
}

/**
 * 判断一条视频是否属于美食内容。
 * 返回分类只作内部过滤/排序用，不向前端展示技术细节。
 * @returns {{category:string, confidence:number, reasons:string[]}}
 */
export function classifyVideoCandidate(item) {
  const title = textOf(item?.title);
  const meta = textOf([item?.description, ...(Array.isArray(item?.tags) ? item.tags : []), item?.category, item?.author].join(' '));
  const all = `${title} ${meta}`;

  const dish = collect(title, DISH_TERMS);
  const ingredient = collect(title, INGREDIENT_TERMS);
  const methodStrong = collect(title, METHOD_STRONG_TERMS);
  const methodGeneric = collect(title, METHOD_GENERIC_TERMS);
  const method = unique([...methodStrong, ...methodGeneric]);
  const generic = collect(title, GENERIC_FOOD_TERMS);
  const culture = collect(title, CULTURE_TERMS);
  const review = collect(title, REVIEW_TERMS);
  const processing = collect(title, PROCESSING_TERMS);
  const equipment = collect(title, KITCHEN_EQUIPMENT_TERMS);
  const metaFood = collect(meta, [...GENERIC_FOOD_TERMS, ...CULTURE_TERMS]);

  const nonFood = collect(all, NON_FOOD_TERMS);
  const repair = collect(title, REPAIR_TERMS);
  const categoryFood = isFoodCategory(item?.category);
  const categoryNonFood = isNonFoodCategory(item?.category);

  // 分区是游戏/电竞时，标题里出现「烤炉」「烹饪」也只是游戏机制，不是美食内容
  if (/(游戏|电竞)/.test(textOf(item?.category))) {
    return { category: 'non_food', confidence: 0.97, reasons: ['game_category', textOf(item?.category)] };
  }

  const titleFoodSignals = unique([
    ...dish, ...ingredient, ...methodStrong, ...generic, ...culture, ...review, ...processing, ...equipment,
  ]);
  const equipmentUse = equipment.length > 0 && EQUIPMENT_ACTION_RE.test(title);

  // 1) 标题/标签出现明确非美食词，且标题没有任何美食信号 → 直接排除
  if (nonFood.length && titleFoodSignals.length === 0) {
    return { category: 'non_food', confidence: 0.98, reasons: ['non_food_terms', ...nonFood.slice(0, 3)] };
  }

  // 2) 设备维修/拆机与「做菜」无关，不因为标题里出现烤箱、锅具就放行
  if (repair.length) {
    return { category: 'non_food', confidence: 0.95, reasons: ['repair_content', ...repair.slice(0, 2)] };
  }

  // 2) 非美食分区 + 没有烹饪动作/设备用途 → 排除（避免数码、游戏、宠物、农业内容漏网）
  if (categoryNonFood && !categoryFood && !method.length && !equipmentUse) {
    return { category: 'non_food', confidence: 0.9, reasons: ['non_food_category', textOf(item?.category)] };
  }

  // 3) 非美食信号压过美食信号 → 排除。例如「电脑上的美食壁纸」
  if (nonFood.length && !method.length && !categoryFood && !equipmentUse && titleFoodSignals.length <= nonFood.length) {
    return { category: 'non_food', confidence: 0.85, reasons: ['conflicting_non_food', ...nonFood.slice(0, 3)] };
  }

  // 4) 设备内容必须说明用途/操作，纯开箱、纯评测不算烹饪设备内容
  if (equipment.length && equipmentUse && !dish.length && !ingredient.length && !methodStrong.length) {
    return { category: 'kitchen_equipment', confidence: 0.8, reasons: ['equipment', ...equipment.slice(0, 2)] };
  }

  // 5) 按主题归类。顺序即优先级，避免「烤箱做蛋糕」被归成设备。
  if (processing.length) return { category: 'food_processing', confidence: 0.85, reasons: ['processing', ...processing.slice(0, 2)] };
  if (review.length) return { category: 'food_review', confidence: 0.85, reasons: ['review', ...review.slice(0, 2)] };
  if (culture.length) return { category: 'food_culture', confidence: 0.82, reasons: ['culture', ...culture.slice(0, 2)] };
  if (dish.length || generic.length) return { category: 'dish_recipe', confidence: 0.9, reasons: ['dish', ...dish.slice(0, 2)] };
  if (ingredient.length) return { category: 'ingredient', confidence: 0.86, reasons: ['ingredient', ...ingredient.slice(0, 2)] };
  if (methodStrong.length) return { category: 'cooking_method', confidence: 0.82, reasons: ['method', ...methodStrong.slice(0, 2)] };
  if (method.length && (categoryFood || metaFood.length)) return { category: 'cooking_method', confidence: 0.7, reasons: ['method_with_food_context', ...method.slice(0, 2)] };
  if (categoryFood) return { category: 'dish_recipe', confidence: 0.62, reasons: ['food_category', textOf(item?.category)] };
  if (metaFood.length && method.length) return { category: 'cooking_method', confidence: 0.55, reasons: ['meta_food', ...metaFood.slice(0, 2)] };

  return { category: 'unknown', confidence: 0.3, reasons: ['insufficient_food_signals'] };
}

/** 标题去重用的归一化键：去掉标点、空格、表情，只保留文字和数字。 */
function titleKey(title) {
  return textOf(title).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 50);
}

function queryMatchScore(item, query) {
  const q = textOf(query);
  if (!q) return 0;
  const title = textOf(item.title);
  const desc = textOf(item.description);
  const tags = textOf((item.tags || []).join(' '));
  let score = 0;
  if (title === q) score += 20;
  else if (title.startsWith(q)) score += 12;
  else if (title.includes(q)) score += 8;
  if (desc.includes(q)) score += 3;
  if (tags.includes(q)) score += 4;
  return score;
}

function isAmbiguousMatch(item, info) {
  if (info.kind !== 'ambiguous') return true;
  const text = joinedText(item);
  const synonyms = AMBIGUOUS_SYNONYMS[info.ambiguous] || [info.ambiguous];
  return synonyms.some((word) => text.includes(word.toLowerCase()));
}

/** 通过过滤的视频按「与搜索词的相关程度」排序；分数相同保持平台顺序。 */
export function scoreVideoResult(item, base, classification = null) {
  let score = queryMatchScore(item, base);
  const title = textOf(item.title);
  if (/(做法|教程|菜谱|食谱|配方|步骤|技巧|秘诀)/.test(title)) score += 2;
  if (/(家常|家庭版|在家|新手|零基础|简单|快手)/.test(title)) score += 1;
  const category = classification?.category;
  if (category === 'dish_recipe' || category === 'ingredient' || category === 'cooking_method') score += 1;
  if (item.duration && item.duration >= 60 && item.duration <= 1200) score += 1;
  return score;
}

/* ------------------------------ B 站检索 ------------------------------ */

const BV_RE = /^BV[0-9A-Za-z]{8,12}$/;

export function normalizeBilibiliItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== 'video') return null;
  const bvid = typeof raw.bvid === 'string' ? raw.bvid.trim() : '';
  if (!BV_RE.test(bvid)) return null;
  const title = stripHtml(raw.title);
  if (!title) return null;
  const url = sanitizeVideoUrl(`https://www.bilibili.com/video/${bvid}`, 'bilibili');
  if (!url) return null;

  const result = {
    id: `bilibili-${bvid}`,
    title: title.slice(0, 120),
    platform: 'bilibili',
    url,
    sourceType: 'video',
  };
  const cover = sanitizeCoverUrl(raw.pic);
  if (cover) result.coverUrl = cover;
  const author = stripHtml(raw.author).slice(0, 40);
  if (author) result.author = author;
  const duration = parseBilibiliDuration(raw.duration);
  if (duration > 0) result.duration = duration;
  const description = stripHtml(raw.description).slice(0, 120);
  if (description && description !== result.title) result.description = description;
  const category = stripHtml(raw.typename).slice(0, 24);
  if (category) result.category = category;
  const tags = stripHtml(raw.tag)
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tags.length) result.tags = tags;
  const pubdate = Number(raw.pubdate);
  if (Number.isFinite(pubdate) && pubdate > 0) {
    const date = new Date(pubdate * 1000);
    if (Number.isFinite(date.getTime())) result.publishedAt = date.toISOString();
  }
  return result;
}

let session = null;
let sessionInFlight = null;
/** 旧接口返回 412 后，10 分钟内优先走 WBI，避免每次搜索都先撞一次风控。 */
let wbiPreferredUntil = 0;

async function ensureBilibiliCookie(force = false) {
  const now = Date.now();
  if (!force && session) {
    if ('cookie' in session && now - session.ts < SESSION_TTL_MS) return session.cookie;
    if ('failure' in session && now - session.ts < SESSION_FAIL_COOLDOWN_MS) throw new Error(session.failure);
  }
  if (!force && sessionInFlight) return sessionInFlight;

  const task = (async () => {
    try {
      const response = await fetch(BILIBILI_ORIGIN, {
        headers: { 'User-Agent': WEB_UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const headerShim = response.headers;
      const rawCookies = typeof headerShim.getSetCookie === 'function' ? headerShim.getSetCookie() : [];
      const cookie = rawCookies.map((item) => item.split(';')[0]).join('; ');
      if (!/(?:^|;\s*)buvid3=/.test(cookie)) throw new Error('未获得匿名会话（buvid3）');
      session = { cookie, ts: Date.now() };
      return cookie;
    } catch (error) {
      const message = `无法建立平台匿名会话（${String(error?.message ?? error).slice(0, 60)}）`;
      session = { failure: message, ts: Date.now() };
      throw new Error(message);
    }
  })();

  sessionInFlight = task;
  try {
    return await task;
  } finally {
    if (sessionInFlight === task) sessionInFlight = null;
  }
}

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + ttlMs, value });
}

export function clearVideoSearchCache() {
  cache.clear();
  session = null;
  wbiPreferredUntil = 0;
  wbiKeys = null;
}

function buildBilibiliSearchUrl(keyword, page = 1) {
  const url = new URL(BILIBILI_SEARCH_ENDPOINT);
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', '20');
  url.searchParams.set('order', 'totalrank');
  return url.toString();
}

/**
 * B 站旧版搜索接口在部分网络/高频访问下会返回 412。
 * 官方网页实际使用的 WBI 签名接口更稳定；两套接口返回结构一致，只作为同一平台的兜底。
 */
const WBI_MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let wbiKeys = null;

async function getWbiKeys(cookie) {
  if (wbiKeys && Date.now() - wbiKeys.ts < 60 * 60 * 1000) return wbiKeys;
  const response = await fetch(BILIBILI_NAV_ENDPOINT, {
    headers: { 'User-Agent': WEB_UA, Referer: BILIBILI_ORIGIN, Accept: 'application/json', Cookie: cookie },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`WBI 会话 HTTP ${response.status}`);
  const json = await response.json();
  const imgUrl = json?.data?.wbi_img?.img_url;
  const subUrl = json?.data?.wbi_img?.sub_url;
  if (typeof imgUrl !== 'string' || typeof subUrl !== 'string') throw new Error('WBI 密钥不可用');
  const img = imgUrl.split('/').pop().split('.')[0];
  const sub = subUrl.split('/').pop().split('.')[0];
  if (!img || !sub) throw new Error('WBI 密钥为空');
  wbiKeys = { img, sub, ts: Date.now() };
  return wbiKeys;
}

function buildWbiSearchUrl(keyword, page, keys) {
  const raw = `${keys.img}${keys.sub}`;
  const mixin = WBI_MIXIN_TAB.map((index) => raw[index] || '').join('').slice(0, 32);
  const params = {
    search_type: 'video',
    keyword,
    page: String(page),
    page_size: '20',
    order: 'totalrank',
    wts: String(Math.floor(Date.now() / 1000)),
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key].replace(/[!'()*]/g, ''))}`)
    .join('&');
  const rid = createHash('md5').update(query + mixin).digest('hex');
  return `${BILIBILI_WBI_SEARCH_ENDPOINT}?${query}&w_rid=${rid}`;
}

async function fetchBilibiliSearch(keyword, page = 1) {
  const cacheKey = `bilibili|${page}|${keyword}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const finish = (outcome) => {
    cacheSet(cacheKey, outcome, outcome.status === 'error' ? ERROR_CACHE_TTL_MS : CACHE_TTL_MS);
    return outcome;
  };

  const request = async (url, cookie) => {
    const response = await fetch(url, {
      headers: {
        'User-Agent': WEB_UA,
        Referer: BILIBILI_ORIGIN,
        Accept: 'application/json',
        Cookie: cookie,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('返回内容不是 JSON（可能被网关拦截）');
    }
  };

  const fetchRegular = (cookie) => request(buildBilibiliSearchUrl(keyword, page), cookie);
  const fetchWbi = async (cookie) => {
    const keys = await getWbiKeys(cookie);
    return request(buildWbiSearchUrl(keyword, page, keys), cookie);
  };

  try {
    let cookie = await ensureBilibiliCookie();
    let json = null;

    // 旧接口优先；遇到 412/网关拦截时切到官方网页使用的 WBI 接口。
    // 一旦确认旧接口被风控，短时间内直接走 WBI，减少无谓请求。
    if (Date.now() >= wbiPreferredUntil) {
      try {
        json = await fetchRegular(cookie);
      } catch {
        json = null;
      }
      if (!json || json.code === -412 || json.code === -799 || json.code !== 0) {
        wbiPreferredUntil = Date.now() + 10 * 60 * 1000;
        json = null;
      }
    }
    if (!json) {
      json = await fetchWbi(cookie);
    }
    if (json?.code === -412 || json?.code === -799) {
      cookie = await ensureBilibiliCookie(true);
      json = await fetchWbi(cookie);
    }
    if (json?.code === -412 || json?.code === -799) {
      return finish({ status: 'error', items: [], reason: `平台风控限制（code ${json.code}）` });
    }
    if (json?.code !== 0) {
      return finish({ status: 'error', items: [], reason: `平台返回异常（code ${json?.code}）` });
    }
    const list = Array.isArray(json?.data?.result) ? json.data.result : [];
    const items = list.map(normalizeBilibiliItem).filter(Boolean);
    return finish(items.length ? { status: 'ok', items } : { status: 'empty', items: [] });
  } catch (error) {
    return finish({
      status: 'error',
      items: [],
      reason: `请求失败（${String(error?.message ?? error).slice(0, 60)}）`,
    });
  }
}

/* ------------------------------ 主流程 ------------------------------ */

const ENTRY_ONLY_REASON = '该平台未开放通用视频搜索接口，仅提供官方搜索页入口（不抓取、不绕过风控）';

/** 生成 3 条确定性搜索关键词（不经过模型，避免幻觉），按搜索意图选择语境。 */
export function buildVideoKeywords(base) {
  const clean = stripHtml(String(base || '')).trim();
  if (!clean) return [];
  const info = classifyVideoQuery(clean);
  if (info.kind === 'non_food') return [];

  const tails = {
    dish: ['做法', '家常做法', '菜谱'],
    ingredient: ['做法', '怎么吃', '挑选'],
    method: ['技巧', '教程', '烹饪'],
    culture: ['纪录片', '文化', '美食'],
    review: ['探店', '推荐', '测评'],
    processing: ['制作', '工艺', '教程'],
    equipment: ['使用', '食谱', '教程'],
    ambiguous: info.ambiguous === '开机' || ['设置', '安装', '维修', '使用', '清洗', '保养', '连接', '操作'].includes(info.ambiguous)
      ? ['烤箱', '厨房电器', '烹饪']
      : ['美食', '菜谱', '烹饪'],
    general: ['做法', '教程', '美食'],
  }[info.kind] || ['做法', '教程'];

  return [...new Set(tails.map((tail) => `${clean} ${tail}`))].slice(0, 3);
}

export function buildSearchEntries(base, platforms = VIDEO_PLATFORM_IDS) {
  const clean = stripHtml(String(base || '')).trim();
  const info = classifyVideoQuery(clean);
  if (!clean || info.kind === 'non_food') return [];
  const word = buildVideoKeywords(clean)[0] || clean;
  return platforms.map((platform) => ({
    id: `${platform}-entry`,
    title: `在${VIDEO_PLATFORMS[platform].label}搜索更多`,
    platform,
    url: VIDEO_PLATFORMS[platform].searchUrl(word),
    sourceType: 'search-entry',
  }));
}

function sortAndSlice(items, q, limit) {
  const merged = new Map();
  for (const entry of items) {
    const prev = merged.get(entry.item.id);
    if (!prev || entry.score > prev.score) merged.set(entry.item.id, entry);
  }

  const byTitle = new Map();
  for (const entry of merged.values()) {
    const key = titleKey(entry.item.title);
    const prev = byTitle.get(key);
    if (!prev || entry.score > prev.score) byTitle.set(key, entry);
  }

  return [...byTitle.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/**
 * 执行一次完整的视频检索。
 * @param {{q?: string, limit?: number, page?: number}} input q 必填（菜品或美食关键词）
 * @returns {Promise<object>} 结果 + 过滤统计（统计只用于服务端诊断，前端不展示细节）
 */
export async function searchVideos(input = {}) {
  const startedAt = Date.now();
  const q = stripHtml(String(input.q || input.dish || input.query || '')).trim().slice(0, 40);
  if (!q) {
    throw Object.assign(new Error('缺少搜索内容（q 必填）'), { status: 400 });
  }
  const limit = Math.min(12, Math.max(1, Math.round(Number(input.limit) || 8)));
  const page = Math.min(5, Math.max(1, Math.round(Number(input.page) || 1)));
  const info = classifyVideoQuery(q);

  if (info.kind === 'non_food') {
    return {
      status: 'done',
      reason: 'off_topic_query',
      queryKind: 'non_food',
      note: `「${q}」不属于美食视频范围。已限定为美食相关视频，请尝试搜索菜品、食材、菜谱或烹饪技巧。`,
      query: q,
      keywords: [],
      results: [],
      entries: [],
      providers: VIDEO_PLATFORM_IDS.map((platform) => ({
        platform,
        status: 'skipped',
        count: 0,
        reason: platform === 'bilibili' ? '非美食关键词，未请求平台' : ENTRY_ONLY_REASON,
      })),
      filtered: { nonFood: 0, unknown: 0, irrelevant: 0 },
      page,
      took: Date.now() - startedAt,
      searchedAt: Date.now(),
    };
  }

  const keywords = buildVideoKeywords(q);
  const outcomes = await Promise.all(keywords.map((keyword) => fetchBilibiliSearch(keyword, page)));

  const candidates = [];
  const stats = { nonFood: 0, unknown: 0, irrelevant: 0 };
  let index = 0;
  for (const outcome of outcomes) {
    for (const item of outcome.items) {
      const classification = classifyVideoCandidate(item);
      if (classification.category === 'non_food') {
        stats.nonFood += 1;
        index += 1;
        continue;
      }
      if (classification.category === 'unknown') {
        stats.unknown += 1;
        index += 1;
        continue;
      }

      // 模糊词必须命中原始意图（含同义词），避免「开机」被随机美食视频填满
      if (!isAmbiguousMatch(item, info)) {
        stats.irrelevant += 1;
        index += 1;
        continue;
      }

      // 具体菜名/食材必须真的出现在视频元数据里，不用无关美食凑数
      const requiresQueryMatch = info.kind === 'dish' || info.kind === 'ingredient' || info.kind === 'general';
      if (requiresQueryMatch && queryMatchScore(item, q) === 0) {
        stats.irrelevant += 1;
        index += 1;
        continue;
      }

      candidates.push({
        item,
        index,
        score: scoreVideoResult(item, q, classification),
        category: classification.category,
      });
      index += 1;
    }
  }

  const results = sortAndSlice(candidates, q, limit);
  const errorOutcome = outcomes.find((outcome) => outcome.status === 'error');
  const anyOk = outcomes.some((outcome) => outcome.status === 'ok' || outcome.status === 'empty');
  let reason = 'ok';
  let note = '';
  if (results.length) {
    note = `已限定为美食相关视频：在哔哩哔哩实时检索到 ${results.length} 条。`;
  } else if (errorOutcome && !anyOk) {
    reason = 'provider_error';
    note = `暂时无法取得具体视频（${errorOutcome.reason || '平台接口暂不可用'}）。可以稍后重试，或使用下面的平台搜索入口。`;
  } else if (stats.nonFood + stats.unknown + stats.irrelevant > 0) {
    reason = 'no_food_results';
    note = `「${q}」暂时没有找到合适的美食视频。已限定为美食相关视频，请尝试更换菜品、食材或烹饪关键词。`;
  } else {
    reason = 'no_results';
    note = `「${q}」暂时没有找到相关视频，试试更换关键词。`;
  }

  const bilibiliStatus = results.length
    ? 'ok'
    : errorOutcome && !anyOk
      ? 'error'
      : 'empty';
  const providers = VIDEO_PLATFORM_IDS.map((platform) =>
    platform === 'bilibili'
      ? {
        platform,
        status: bilibiliStatus,
        count: results.length,
        ...(bilibiliStatus === 'error' ? { reason: errorOutcome?.reason } : {}),
      }
      : { platform, status: 'skipped', count: 0, reason: ENTRY_ONLY_REASON }
  );

  return {
    status: 'done',
    reason,
    queryKind: info.kind,
    note,
    query: q,
    keywords,
    results,
    entries: buildSearchEntries(q),
    providers,
    filtered: stats,
    page,
    took: Date.now() - startedAt,
    searchedAt: Date.now(),
  };
}

/* --------------------- 菜品详情：强相关视频 --------------------- */

const DISH_PREFIX_RE = /^(?:正宗|家常|经典|传统|农家|私房|老北京|老上海|四川|川味|重庆|湖南|湘西|湘味|广东|粤式|港式|鲁菜|淮扬|毛氏|徽州)+/;

function listParam(value, max = 8) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,，、|]/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const text = stripHtml(String(item || '')).trim().slice(0, 30);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function compactForMatch(value) {
  return stripHtml(String(value || ''))
    .toLowerCase()
    .replace(/[\s·・_\-—–|/\\（）()【】[\]「」『』'"“”‘’]+/g, '');
}

/** 菜品上下文：优先用服务端菜谱数据，前端传来的字段只作为兜底。 */
function buildDishContext(input = {}) {
  const dishId = String(input.dishId || '').trim().slice(0, 48);
  const resolved = dishId ? findDish(dishId) : null;
  const name = String(resolved?.name || input.dishName || '')
    .replace(/[「」【】《》"'“”]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 30);
  if (!name) return null;

  const aliases = listParam([...(resolved?.aliases || []), ...listParam(input.aliases, 6)]);
  const names = [];
  const pushName = (value) => {
    const text = String(value || '').replace(/\s+/g, '').trim();
    if (text.length >= 2 && !names.includes(text)) names.push(text);
  };
  pushName(name);
  for (const alias of aliases) pushName(alias);
  // 「毛氏红烧肉」「徽州红烧肉」这类地域/门派前缀，核心菜名仍是红烧肉；
  // 只去掉有限前缀，不把「东坡肉」误伤成「肉」。
  const core = name.replace(DISH_PREFIX_RE, '').trim();
  if (core.length >= 3 && core !== name) pushName(core);

  return {
    id: resolved?.id || dishId || null,
    name,
    nameEn: String(resolved?.nameEn || input.englishName || '').trim().slice(0, 60),
    aliases,
    names,
    cuisineType: String(resolved?.cuisine || input.cuisineType || '').trim().slice(0, 20),
    flavorType: listParam([...(resolved?.tastes || []), ...listParam(input.flavorType, 6)], 6),
    mainIngredients: listParam([...(resolved?.ingredients || []), ...listParam(input.mainIngredients, 8)], 8),
    cookingMethods: listParam([...(resolved?.techniques || []), ...listParam(input.cookingMethods, 8)], 8),
  };
}

function buildDishKeywords(ctx) {
  const core = ctx.names[1] || ctx.name;
  return [...new Set([
    `${ctx.name} 做法`,
    `${core} 家常做法`,
    `${core} 烹饪技巧`,
  ])];
}

function dishMatchName(item, names) {
  const hay = compactForMatch([
    item.title,
    item.description,
    item.category,
    item.author,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ].join(' '));
  if (!hay) return '';
  for (const name of names) {
    const needle = compactForMatch(name);
    if (needle.length < 2) continue;
    const idx = hay.indexOf(needle);
    if (idx < 0) continue;
    // 「豆腐…比麻婆豆腐还好吃」不是在教这道菜，只是拿它当参照物。
    const before = hay.slice(Math.max(0, idx - 14), idx);
    const after = hay.slice(idx + needle.length, idx + needle.length + 14);
    if (/比[^，。；;！!？?]{0,12}$/.test(before) && /(还好吃|好吃|更香|还香|下饭|更胜|强)/.test(after)) {
      return '';
    }
    return name;
  }
  return '';
}

/**
 * 当前菜名可能被「汽车 / 段子 / 盘点 / 搞笑」类日常视频当标题梗使用。
 * 菜名只能证明它提到了这道菜，不能证明它是一支做菜视频：
 * 非美食分区、标题设备词、或强非美食话题且没有任何烹饪信号，都不收。
 */
function dishFoodContext(item) {
  const title = textOf(item?.title);
  const meta = textOf([
    item?.description,
    ...(Array.isArray(item?.tags) ? item.tags : []),
    item?.category,
    item?.author,
  ].join(' '));
  const all = `${title} ${meta}`;
  const categoryFood = isFoodCategory(item?.category);
  if (isNonFoodCategory(item?.category)) return 'non_food_category';
  if (collect(title, NON_FOOD_TERMS).length) return 'non_food_title';
  const topic = all.match(/(汽车|试驾|车评|交通|数码|手机|电脑|游戏|显卡|路由器|影视|娱乐|搞笑|段子|吐槽|盘点|高能|鬼畜|舞蹈)/);
  if (!topic) return '';
  if (categoryFood) return '';
  const cooking = collect(all, [...GENERIC_FOOD_TERMS, ...METHOD_STRONG_TERMS, ...METHOD_GENERIC_TERMS]);
  if (cooking.length) return '';
  return `off_topic_${topic[1]}`;
}

function dishRelevanceLabel(item) {
  const t = [item?.title, item?.description, ...(Array.isArray(item?.tags) ? item.tags : [])]
    .filter(Boolean)
    .join(' ');
  if (/文化|历史|典故|故事|纪录片|渊源/.test(t)) return '饮食文化';
  if (/家常|家庭版|在家做|简单易学/.test(t)) return '家常做法';
  if (/教程|做法|制作|烹饪|配方|步骤/.test(t)) return '做法教程';
  if (/技巧|火候|蒸制|处理|刀工|调味|不腥|不柴/.test(t)) return '关键技巧';
  return '相关视频';
}

function scoreDishItem(item, ctx, matchedName) {
  const title = compactForMatch(item.title);
  const primary = compactForMatch(ctx.name);
  let score = 0;
  if (title === primary) score += 60;
  else if (title.startsWith(primary)) score += 36;
  else if (title.includes(primary)) score += 24;
  if (matchedName !== ctx.name) score += 8;
  if (/教程|做法|制作|烹饪|配方|步骤/.test(item.title || '')) score += 8;
  if (/家常|家庭版|在家做/.test(item.title || '')) score += 5;
  if (/技巧|火候|蒸制|处理|刀工|调味/.test(item.title || '')) score += 4;
  if (item.category) score += 1;
  if (Number(item.duration) >= 60) score += 1;
  return score;
}

/**
 * 菜品详情专用搜索：只返回标题/简介/标签/分区/作者中明确出现当前菜名（或已确认别名）的视频。
 * 不复用「同类菜系」结果，不用食材/口味泛化，不把川湘菜整体当成剁椒鱼头。
 */
export async function searchDishVideos(input = {}) {
  const startedAt = Date.now();
  const ctx = buildDishContext(input);
  if (!ctx) {
    throw Object.assign(new Error('缺少菜品信息（dishId 或 dishName 必填）'), { status: 400 });
  }

  const limit = Math.min(12, Math.max(1, Math.round(Number(input.limit) || 9)));
  const page = Math.min(5, Math.max(1, Math.round(Number(input.page) || 1)));
  const excludeIds = new Set(listParam(input.exclude, 60));
  const keywords = buildDishKeywords(ctx);
  const outcomes = await Promise.all(keywords.map((keyword) => fetchBilibiliSearch(keyword, page)));
  const stats = { nonFood: 0, unknown: 0, irrelevant: 0, context: 0, excluded: 0 };
  const candidates = [];
  let index = 0;

  for (const outcome of outcomes) {
    for (const rawItem of outcome.items) {
      const classification = classifyVideoCandidate(rawItem);
      if (classification.category === 'non_food') {
        stats.nonFood += 1;
        index += 1;
        continue;
      }
      if (classification.category === 'unknown') {
        stats.unknown += 1;
        index += 1;
        continue;
      }
      if (dishFoodContext(rawItem)) {
        stats.context += 1;
        index += 1;
        continue;
      }
      const matchedName = dishMatchName(rawItem, ctx.names);
      if (!matchedName) {
        stats.irrelevant += 1;
        index += 1;
        continue;
      }
      if (excludeIds.has(rawItem.id) || excludeIds.has(rawItem.url)) {
        stats.excluded += 1;
        index += 1;
        continue;
      }
      const item = { ...rawItem, relevance: dishRelevanceLabel(rawItem) };
      candidates.push({
        item,
        index,
        score: scoreDishItem(item, ctx, matchedName),
        category: classification.category,
      });
      index += 1;
    }
  }

  const merged = new Map();
  for (const candidate of candidates) {
    const prev = merged.get(candidate.item.id);
    if (!prev || candidate.score > prev.score) merged.set(candidate.item.id, candidate);
  }
  const byTitle = new Map();
  for (const candidate of merged.values()) {
    const key = titleKey(candidate.item.title);
    const prev = byTitle.get(key);
    if (!prev || candidate.score > prev.score) byTitle.set(key, candidate);
  }
  const results = [...byTitle.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);

  const errorOutcome = outcomes.find((outcome) => outcome.status === 'error');
  const anyOk = outcomes.some((outcome) => outcome.status === 'ok' || outcome.status === 'empty');
  let reason = 'ok';
  let note = '';
  if (results.length) {
    note = `从哔哩哔哩实时检索到 ${results.length} 条与「${ctx.name}」直接相关的视频。`;
  } else if (errorOutcome && !anyOk) {
    reason = 'provider_error';
    note = `暂时无法取得「${ctx.name}」的视频（${errorOutcome.reason || '平台接口暂不可用'}）。请稍后重试。`;
  } else if (stats.nonFood + stats.unknown + stats.irrelevant > 0) {
    reason = 'no_dish_results';
    note = `暂时没有找到与「${ctx.name}」直接相关的视频。没有用同类菜系或无关视频填充。`;
  } else {
    reason = 'no_results';
    note = `暂时没有找到与「${ctx.name}」相关的视频。`;
  }

  const bilibiliStatus = results.length
    ? 'ok'
    : errorOutcome && !anyOk
      ? 'error'
      : 'empty';
  const providers = VIDEO_PLATFORM_IDS.map((platform) =>
    platform === 'bilibili'
      ? {
        platform,
        status: bilibiliStatus,
        count: results.length,
        ...(bilibiliStatus === 'error' ? { reason: errorOutcome?.reason } : {}),
      }
      : { platform, status: 'skipped', count: 0, reason: ENTRY_ONLY_REASON }
  );

  return {
    status: 'done',
    mode: 'dish',
    reason,
    note,
    dish: {
      id: ctx.id,
      name: ctx.name,
      nameEn: ctx.nameEn,
      aliases: ctx.aliases,
      cuisineType: ctx.cuisineType,
      flavorType: ctx.flavorType,
      mainIngredients: ctx.mainIngredients,
      cookingMethods: ctx.cookingMethods,
    },
    keywords,
    results,
    entries: [],
    providers,
    filtered: stats,
    page,
    hasMore: page < 5 && results.length > 0,
    took: Date.now() - startedAt,
    searchedAt: Date.now(),
  };
}