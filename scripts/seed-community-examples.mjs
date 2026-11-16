/**
 * 食有灵 · 社区示例内容初始化
 *
 * 只向 data/community.json 追加带 exampleKey 的示例帖子，
 * 不删除、不覆盖已有帖子/用户/评论。重复执行时按 exampleKey + 固定 id 跳过，
 * 因此可以安全地在本地或线上重复运行。
 *
 * 用法：node scripts/seed-community-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISH_BY_ID } from '../src/data/dishes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMUNITY_FILE = path.join(ROOT, 'data', 'community.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'community');
const NOW = Date.now();

const AUTHORS = [
  { id: 'demo-author-01', name: '爱吃不胖' },
  { id: 'demo-author-02', name: '一人食日记' },
  { id: 'demo-author-03', name: '川味研究所' },
  { id: 'demo-author-04', name: '江南小灶' },
  { id: 'demo-author-05', name: '慢炖研究所' },
  { id: 'demo-author-06', name: '厨房小白' },
  { id: 'demo-author-07', name: '面点练习生' },
  { id: 'demo-author-08', name: '甜品收藏家' },
  { id: 'demo-author-09', name: '烘焙慢半拍' },
  { id: 'demo-author-10', name: '辣味上头' },
];

// 每条帖子的 comments 使用 [作者索引, 内容]，初始化时生成真实评论对象。
const EXAMPLES = [
  {
    id: 'example-post-01',
    exampleKey: 'food-soul-example-01',
    dishId: 'gongbaojiding',
    title: '今天的下饭神菜',
    author: 0,
    kind: '菜谱分享',
    likes: 186,
    minutesAgo: 15,
    image: 'community-gongbao-chicken.jpg',
    content:
      '鸡腿肉切丁，加一点生抽和淀粉抓匀，先滑到变色盛出。锅里留底油，干辣椒和花椒小火焙香，再下葱段、鸡丁和花生，最后沿锅边淋一勺糖醋汁。鸡肉嫩，花生还是脆的，酸甜里带一点糊辣，拌米饭太合适了。',
    comments: [
      [5, '这个糖醋汁的比例可以分享一下吗？看着太亮了。'],
      [6, '花生最后放才脆，学到了。'],
      [1, '今晚就照这个做，米饭已经泡上了。'],
    ],
  },
  {
    id: 'example-post-02',
    exampleKey: 'food-soul-example-02',
    dishId: 'hong-shao-rou',
    title: '周末给自己做顿好的',
    author: 1,
    kind: '菜谱分享',
    likes: 132,
    minutesAgo: 45,
    image: 'community-braised-pork.jpg',
    content:
      '周末慢慢炖了一锅红烧肉，五花肉先煸出油，再用冰糖炒糖色，加黄酒和生抽小火焖一个半小时。肥肉部分入口就化，瘦肉也不柴，颜色是亮亮的琥珀色。最后大火收汁，拌饭能吃两碗。',
    comments: [
      [0, '这个糖色炒得真漂亮，我每次都炒苦。'],
      [7, '一个人也要好好吃饭呀。'],
      [3, '求一个不腻的版本，我每次吃两块就顶住了。'],
      [4, '五花肉煸久一点真的会香很多。'],
    ],
  },
  {
    id: 'example-post-03',
    exampleKey: 'food-soul-example-03',
    dishId: 'mapo-tofu',
    title: '米饭杀手',
    author: 2,
    kind: '菜谱分享',
    likes: 245,
    minutesAgo: 90,
    image: 'community-mapodoufu.jpg',
    content:
      '豆腐先用淡盐水焯一下，不容易碎。豆瓣酱炒出红油，下牛肉末煸酥，加高汤和豆腐小火煨，分三次勾薄芡。出锅撒花椒面和蒜苗，麻、辣、烫、香都在，豆腐嫩得用勺子舀，今晚米饭又要遭殃。',
    comments: [
      [9, '花椒面最后撒才是灵魂。'],
      [5, '用嫩豆腐还是老豆腐呀？'],
      [2, '嫩豆腐，焯水的时候轻一点。'],
      [1, '看饿了，明天就做。'],
    ],
  },
  {
    id: 'example-post-04',
    exampleKey: 'food-soul-example-04',
    dishId: 'xi-hu-cu-yu',
    title: '在家复刻杭州名菜',
    author: 3,
    kind: '讨论',
    likes: 97,
    minutesAgo: 150,
    image: 'community-west-lake-fish.jpg',
    content:
      '第一次在家做西湖醋鱼，草鱼提前养了一天去泥味，水微沸下锅汆到刚熟。糖醋汁调得薄薄的，醋香先出来，甜味收在后面，鱼肉是一瓣一瓣的。卖相还差一点，但那股江南的酸甜鲜已经对了。',
    comments: [
      [4, '草鱼饿养这一步太关键了。'],
      [0, '糖醋汁薄一点确实更清爽。'],
      [7, '卖相已经很好了！'],
    ],
  },
  {
    id: 'example-post-05',
    exampleKey: 'food-soul-example-05',
    dishId: 'fo-tiao-qiang',
    title: '给生活一点仪式感',
    author: 4,
    kind: '讨论',
    likes: 168,
    minutesAgo: 225,
    image: 'community-buddhas-delight.jpg',
    content:
      '提前两天备料，鲍鱼、海参、花胶分别发好，和鸽蛋、香菇一起装进坛子，倒上高汤，荷叶封口小火煨了一下午。开坛那一刻香气直往外涌，汤浓得挂勺，胶质黏唇。偶尔认真做一顿，日子就有了仪式感。',
    comments: [
      [1, '这一坛也太豪华了。'],
      [5, '花胶泡发要多久呀？'],
      [4, '我泡了两天，中间换了几次水。'],
      [3, '开坛那一下一定很香。'],
    ],
  },
  {
    id: 'example-post-06',
    exampleKey: 'food-soul-example-06',
    dishId: 'fanqie-chaodan',
    title: '最简单的幸福',
    author: 5,
    kind: '菜谱分享',
    likes: 203,
    minutesAgo: 310,
    image: 'community-tomato-egg.jpg',
    content:
      '番茄炒蛋真是怎么吃都不腻。鸡蛋加一点温水打散，热油滑到刚凝固就盛出；番茄去皮切块，炒到出沙，加半勺糖和一点盐，再把鸡蛋倒回去翻匀。红黄相间，汤汁拌饭，忙了一天也能被这一盘治好。',
    comments: [
      [0, '番茄去皮真的会好吃很多。'],
      [2, '加一点糖是点睛之笔。'],
      [6, '明天早饭就它了。'],
      [8, '鸡蛋里加温水这招我记住了。'],
    ],
  },
  {
    id: 'example-post-07',
    exampleKey: 'food-soul-example-07',
    dishId: 'xiaolongbao',
    title: '自己做的小笼包终于成功了',
    author: 6,
    kind: '菜谱分享',
    likes: 154,
    minutesAgo: 410,
    image: 'community-soup-dumplings.jpg',
    content:
      '皮冻提前一天熬好，猪前腿肉打上劲，和皮冻拌成馅。面团擀得薄薄的，包的时候尽量多塞馅，收口捏紧。蒸八分钟，提起来先开窗喝汤，鲜甜的汤汁一下涌出来，皮薄但不破，这次终于像样了！',
    comments: [
      [5, '皮冻是灵魂，求配方！'],
      [3, '提起来先开窗，太专业了。'],
      [7, '看着就好吃，皮很薄。'],
    ],
  },
  {
    id: 'example-post-08',
    exampleKey: 'food-soul-example-08',
    dishId: 'yangzhi-ganlu',
    title: '夏日甜品自由',
    author: 7,
    kind: '菜谱分享',
    likes: 221,
    minutesAgo: 520,
    image: 'community-yangzhi-ganlu.jpg',
    content:
      '芒果一半打泥、一半切块，西柚剥出果粒，西米煮到中间还有一点小白芯再焖透。椰奶和芒果泥调底，铺上西米、芒果和西柚，冷藏半小时。舀一勺，芒果的甜、西柚的微苦和椰奶的香全在一起，夏天就该这样。',
    comments: [
      [0, '西柚的微苦刚好解甜。'],
      [5, '没有淡奶油可以吗？'],
      [7, '可以，椰奶多一点也很顺滑。'],
      [9, '这个颜色太夏天了。'],
    ],
  },
  {
    id: 'example-post-09',
    exampleKey: 'food-soul-example-09',
    dishId: 'danhuang-su',
    title: '第一次做中式点心',
    author: 8,
    kind: '菜谱分享',
    likes: 88,
    minutesAgo: 650,
    image: 'community-egg-yolk-pastry.jpg',
    content:
      '第一次挑战蛋黄酥，油皮和油酥分别醒好，反复擀卷两次，包进红豆沙和烤过的咸蛋黄。烤箱一开，满屋都是黄油香。切开能看到一层层的酥皮，咸蛋黄沙沙的，豆沙甜而不腻，虽然形状不完美，但自己做的真香。',
    comments: [
      [6, '第一次就做成这样很厉害了。'],
      [7, '咸蛋黄烤过之后真的更香。'],
      [5, '层次很好看，求温度！'],
    ],
  },
  {
    id: 'example-post-10',
    exampleKey: 'food-soul-example-10',
    dishId: 'shui-zhu-yu',
    title: '无辣不欢的一餐',
    author: 9,
    kind: '讨论',
    likes: 176,
    minutesAgo: 790,
    image: 'community-boiled-fish.jpg',
    content:
      '鱼片逆纹切薄，用蛋清和淀粉抓匀，先烫到七成熟。豆瓣酱和干辣椒炒出红油，加高汤煮开，铺上豆芽和鱼片，最后泼一勺热油，花椒和辣椒的香气一下炸开。鱼片滑嫩，汤底麻辣，配一碗白饭，吃到额头冒汗。',
    comments: [
      [2, '最后那勺热油是灵魂。'],
      [5, '鱼片怎么切才不会碎？'],
      [9, '逆纹切薄片，上浆后别乱翻。'],
      [1, '看着就冒汗，但好想吃。'],
    ],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readState() {
  assert(fs.existsSync(COMMUNITY_FILE), `未找到社区数据文件：${COMMUNITY_FILE}`);
  const state = JSON.parse(fs.readFileSync(COMMUNITY_FILE, 'utf8'));
  assert(state && Array.isArray(state.posts), 'data/community.json 缺少 posts 数组');
  return state;
}

function commentAuthor(index) {
  const author = AUTHORS[index];
  assert(author, `评论作者索引越界：${index}`);
  return { id: author.id, name: author.name };
}

function buildPost(example) {
  const dish = DISH_BY_ID[example.dishId];
  assert(dish, `菜品不存在：${example.dishId}（${example.title}）`);
  const imagePath = path.join(IMAGE_DIR, example.image);
  assert(fs.existsSync(imagePath), `示例图片不存在：${example.image}`);
  const contentLength = Array.from(example.content).length;
  assert(contentLength >= 50 && contentLength <= 120, `正文需为 50–120 字，当前 ${contentLength} 字：${example.title}`);

  const author = AUTHORS[example.author];
  assert(author, `帖子作者索引越界：${example.title}`);
  const createdAt = NOW - example.minutesAgo * 60_000;

  return {
    id: example.id,
    exampleKey: example.exampleKey,
    author: { id: author.id, name: author.name, isDemo: true },
    title: example.title,
    content: example.content,
    kind: example.kind,
    image: `/community/${example.image}`,
    images: [`/community/${example.image}`],
    dishId: dish.id,
    cuisineId: dish.cuisine,
    tasteId: dish.tastes?.[0] || '',
    createdAt,
    likes: example.likes,
    likedBy: [],
    reports: 0,
    isSeed: true,
    isExample: true,
    comments: example.comments.map(([authorIndex, content], i) => ({
      id: `${example.id}-comment-${i + 1}`,
      author: commentAuthor(authorIndex),
      content,
      createdAt: Math.min(NOW - 30_000, createdAt + (i + 1) * 120_000),
      isAI: false,
      parentId: null,
      aiDishId: '',
      isDemo: true,
    })),
    recipe: null,
  };
}

function main() {
  const state = readState();
  const existingKeys = new Set(state.posts.map((p) => p.exampleKey).filter(Boolean));
  const existingIds = new Set(state.posts.map((p) => p.id));
  const pending = EXAMPLES.filter(
    (example) => !existingKeys.has(example.exampleKey) && !existingIds.has(example.id)
  );

  if (!pending.length) {
    const count = EXAMPLES.filter(
      (example) => existingKeys.has(example.exampleKey) || existingIds.has(example.id)
    ).length;
    console.log(`[seed] 已存在 ${count}/10 条社区示例，无需写入。`);
    return;
  }

  const built = pending.map(buildPost).sort((a, b) => b.createdAt - a.createdAt);
  // 只前置新增记录，不改动任何已有记录及其顺序。
  state.posts = [...built, ...state.posts];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${COMMUNITY_FILE}.bak-${stamp}`;
  fs.copyFileSync(COMMUNITY_FILE, backup);
  fs.writeFileSync(COMMUNITY_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  console.log(`[seed] 已写入 ${built.length} 条示例帖子，原有 ${state.posts.length - built.length} 条记录未改动。`);
  console.log(`[seed] 数据备份：${backup}`);
  for (const post of built) {
    const dish = DISH_BY_ID[post.dishId];
    console.log(`  - ${post.title}｜${dish.name}｜${post.image}｜赞 ${post.likes}｜评论 ${post.comments.length}`);
  }
  console.log(`[seed] 当前总帖子数：${state.posts.length}`);
}

main();