import { DISHES, DISH_BY_ID } from '../src/data/dishes.js';
import { TASTE_BY_ID, CUISINE_BY_ID } from '../src/data/cuisines.js';
import { PERSONALITY_BY_ID } from '../src/data/personalities.js';

/* ------------------------------------------------------------------ *
 * 静态欢迎语与旧演示回复；AI 未接入时只使用欢迎语，不伪造 AI 回答。
 * 所有输出都带 mode:"demo" 标记，前端会明确显示"演示模式"，
 * 不冒充真实模型返回。
 * ------------------------------------------------------------------ */

const VOICE = {
  mala: {
    lead: {
      taste: '麻！辣！烫！',
      texture: '口感？我给你说——',
      recipe: '想在家整？行，听好。',
      pairing: '配菜这事儿，',
      similar: '同类？多得很。',
      aroma: '香？那是油泼出来的。',
      other: '来咯，',
    },
    tail: {
      taste: '巴适得很，就这味儿。',
      texture: '记住这个"嫩"字，别的都是虚的。',
      recipe: '锅要够热，手要够快，别怂。',
      pairing: '别整太多花样，主角只有一个。',
      similar: '一个比一个上头，慢慢试。',
      aroma: '闻着冲，吃着更冲。',
      other: '还有啥想问的，直接说。',
    },
    lens: '麻辣的骨架是热油和花椒——香气全靠最后那一勺油泼下去。',
  },
  xiangla: {
    lead: {
      taste: '香辣。注意顺序。',
      texture: '口感这东西，得分开说。',
      recipe: '做法不难，难在你手慢。',
      pairing: '配菜要挑清淡的，',
      similar: '辣的还多着呢。',
      aroma: '香味先到，辣味后到。',
      other: '说重点。',
    },
    tail: {
      taste: '辣是结果，香才是本事。',
      texture: '别炒过头，过了就柴。',
      recipe: '锅烧到冒烟再下油，记住。',
      pairing: '一桌子都辣，舌头就废了。',
      similar: '挑一个，别贪。',
      aroma: '火不够，香就出不来。',
      other: '还有问题就接着问。',
    },
    lens: '辣椒得先用油逼香，一上来就加水，那叫煮，不叫炒。',
  },
  suanla: {
    lead: {
      taste: '酸先来，辣后到。',
      texture: '这个口感，',
      recipe: '想自己做？可以，',
      pairing: '搭配嘛，',
      similar: '想换换口味？',
      aroma: '香在炝锅那一下。',
      other: '嘿，',
    },
    tail: {
      taste: '一口下去，胃口就开了。',
      texture: '不会腻，放心。',
      recipe: '醋沿锅边淋，别直接倒中间。',
      pairing: '解腻这件事，交给我。',
      similar: '都是开胃那一挂的。',
      aroma: '酸香一上来，口水就有了。',
      other: '想到什么随时问我。',
    },
    lens: '酸负责叫醒胃口，辣负责让你多吃两口，顺序不能反。',
  },
  qingxian: {
    lead: {
      taste: '鲜。',
      texture: '说到口感，',
      recipe: '在家做的话，',
      pairing: '搭配上，我建议',
      similar: '口味相近的，',
      aroma: '香得很轻。',
      other: '你好，',
    },
    tail: {
      taste: '不是调料堆出来的鲜，是食材自己的味道。',
      texture: '火候到了，口感自然就对。',
      recipe: '时间比调味重要，别频繁开盖。',
      pairing: '一桌菜里有一道重口就够了。',
      similar: '都偏清淡，适合慢慢吃。',
      aroma: '你要凑近才闻得到。',
      other: '不急，慢慢聊。',
    },
    lens: '鲜是食材自己发出来的声音，调味只需要不打扰它。',
  },
  xianxian: {
    lead: {
      taste: '咸鲜打底，醇厚收尾。',
      texture: '口感分两层，',
      recipe: '做法我讲清楚，',
      pairing: '配菜讲究对照，',
      similar: '同属咸鲜的，',
      aroma: '香从底味来。',
      other: '我是这道菜，',
    },
    tail: {
      taste: '味道要站得住，靠的是底味。',
      texture: '记住，咸不等于鲜。',
      recipe: '火候和时间，一个都不能省。',
      pairing: '厚味要有留白。',
      similar: '都是能压得住桌子的菜。',
      aroma: '急不得，急了只有生味。',
      other: '有想问的尽管说。',
    },
    lens: '高汤是底气，底味不稳，上面盖什么都会塌。',
  },
  xiantian: {
    lead: {
      taste: '先甜，后鲜，',
      texture: '吃起来的感觉是，',
      recipe: '想复刻的话，',
      pairing: '我比较适合配',
      similar: '口味接近的有，',
      aroma: '香在糖化开的那一下。',
      other: '你好呀，',
    },
    tail: {
      taste: '最后一点点酸把味道提起来，刚刚好。',
      texture: '不会腻，也不会寡。',
      recipe: '糖到浅琥珀色就停，再深就苦了。',
      pairing: '旁边有清淡的陪着最好。',
      similar: '都是甜口里比较克制的。',
      aroma: '再深一点就苦了。',
      other: '慢慢聊，不着急。',
    },
    lens: '甜要收得住，酸只负责提亮，不能抢戏。',
  },
  jiangxiang: {
    lead: {
      taste: '酱香在前，咸鲜在后。',
      texture: '口感这件事，',
      recipe: '步骤不能省，',
      pairing: '配什么吃，',
      similar: '酱香一路的还有，',
      aroma: '酱香是炒出来的。',
      other: '你好，',
    },
    tail: {
      taste: '三层味道，一层都不能少。',
      texture: '火候差一点，口感差很多。',
      recipe: '先炒酱，再下料，最后收汁。',
      pairing: '酱香需要有东西接着。',
      similar: '都适合配主食。',
      aroma: '生酱味藏不住。',
      other: '想细问哪一步都行。',
    },
    lens: '酱要炒透，生酱味是藏不住的；颜色是味道的影子。',
  },
  chunhou: {
    lead: {
      taste: '厚。',
      texture: '这个口感，得慢慢说。',
      recipe: '这道菜，急不得。',
      pairing: '搭配上，',
      similar: '同样厚重的，',
      aroma: '香是熬出来的。',
      other: '我是这道菜，',
    },
    tail: {
      taste: '第一口不一定惊艳，第二口开始往下沉。',
      texture: '时间会给它该有的样子。',
      recipe: '小火，盖着，别老掀盖。',
      pairing: '配一口清汤，舌头才不累。',
      similar: '都需要时间。',
      aroma: '中途掀盖，香气就跑了一半。',
      other: '你慢慢问。',
    },
    lens: '时间是这道菜最贵的调料，味道是一层层沉下去的。',
  },
};

function pick(arr, seed) {
  if (typeof arr === 'string') return arr;
  return arr[Math.abs(seed) % arr.length];
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

export function classifyIntent(q) {
  const s = (q || '').toLowerCase();
  if (/味道|什么味|口味|辣不辣|麻不麻|甜不甜|酸不酸/.test(s)) return 'taste';
  if (/为什么.*香|香气|闻起来|闻着|香味/.test(s)) return 'aroma';
  if (/口感|质地|嫩|脆|软|嚼/.test(s)) return 'texture';
  if (/做|做法|菜谱|步骤|怎么烧|怎么炒|教|在家/.test(s)) return 'recipe';
  if (/搭配|配什么|配菜|一起|佐/.test(s)) return 'pairing';
  if (/推荐|相似|类似|还有|别的|同类/.test(s)) return 'similar';
  return 'other';
}

function tasteNames(dish) {
  return dish.tastes.map((t) => TASTE_BY_ID[t]?.name).filter(Boolean).join('、');
}

function similarDishes(dish, limit = 3) {
  return DISHES.filter((d) => d.id !== dish.id && d.tastes.some((t) => dish.tastes.includes(t)))
    .slice(0, limit)
    .map((d) => d.name)
    .join('、');
}

function bodyFor(intent, dish, persona, question) {
  const voice = VOICE[persona.id];
  switch (intent) {
    case 'taste':
      return `${dish.name}的招牌是「${dish.signature}」，${dish.texture}。${voice.lens}`;
    case 'aroma':
      return `香主要靠${dish.techniques[0]}，${dish.knowledge[0]} 撑住香气的是${dish.ingredients.slice(0, 3).join('、')}。`;
    case 'texture':
      return `${dish.texture}。代表食材是${dish.ingredients.slice(0, 3).join('、')}，靠的是${dish.techniques[0]}。`;
    case 'recipe':
      return `关键在${dish.techniques.join('、')}。${dish.knowledge[0]} ${dish.knowledge[1] || ''}`;
    case 'pairing':
      return `${dish.oneLiner}它口味偏${tasteNames(dish)}，适合配一碗白饭或一道清口的菜；同席别再来一道同味型的，会打架。`;
    case 'similar':
      return `同味型的有${similarDishes(dish)}。想吃更重的就往前一步，想清淡就往后一步。`;
    default:
      return `${dish.knowledge[0]} ${dish.oneLiner}`;
  }
}

export function demoReply({ dish, persona, question, history = [] }) {
  const intent = classifyIntent(question);
  const voice = VOICE[persona.id] || VOICE.qingxian;
  const lead = pick(voice.lead[intent] || voice.lead.other, hash(question + intent));
  const tail = pick(voice.tail[intent] || voice.tail.other, hash(question + 'x' + intent));
  const body = bodyFor(intent, dish, persona, question);
  const turnPrefix = history.length > 2 ? '' : '';

  let text = `${turnPrefix}${lead}${body}${tail}`;

  // 追问"你是什么味道"两次以上时补一句菜品专属知识，避免重复
  if (intent === 'taste' && history.filter((m) => m.role === 'user').length > 1) {
    text += ` 再补一句：${dish.knowledge[2] || dish.knowledge[0]}`;
  }
  return text;
}

/** 小精灵的演示回答：通用助手语气，不带任何菜品人格 */
export function demoMascotReply(question) {
  const q = question || '';
  if (/你好|嗨|hi|hello|在吗/i.test(q)) {
    return '你好呀！我是食有灵的小精灵。今天想吃点什么？辣的、清淡的，还是想找人聊聊某道菜？';
  }
  if (/辣|重口|下饭/.test(q)) {
    return '想吃辣的话，麻婆豆腐和水煮鱼最稳，剁椒鱼头也很够劲。点开任意一道菜，就能和它本人聊。';
  }
  if (/清淡|鲜|不辣|养生/.test(q)) {
    return '清淡一点可以看粤菜和浙菜：白切鸡、清蒸鱼、龙井虾仁都不重口，吃的就是食材本味。';
  }
  if (/菜系|八大/.test(q)) {
    return '中国有八大菜系：川、粤、鲁、苏、浙、闽、湘、徽。首页的展示板可以按菜系或口味切换着看。';
  }
  if (/推荐|吃什么|选择/.test(q)) {
    return '告诉我预算、几个人、有没有忌口，我就能帮你挑。或者直接去「今天吃什么」，那里更细。';
  }
  if (/菜谱|做法|怎么做/.test(q)) {
    return '想看做法，点「生成菜谱」，填人数和难度，就会出来一份带火候提示的结构化菜谱。';
  }
  return '这个问题我记下了。你可以问我某道菜的味道、适合配什么，或者让我按口味帮你挑一道。';
}

export function demoGreeting(dish, persona) {
  return persona.greeting.replace('{name}', dish.name).replace('{taste}', TASTE_BY_ID[dish.tastes[0]]?.name || '');
}

/* ---------------- 菜系 / 口味 AI 的演示回复 ---------------- */

/**
 * 分类 AI 欢迎语：人格说话方式来自味型人格，身份来自菜系 / 口味本身。
 * contextDish 只是"当前话题"，不改变身份。
 */
export function demoCategoryGreeting({ kind, meta, persona, dishes = [], contextDish = null }) {
  const isTaste = kind === 'taste';
  const voice = VOICE[persona?.id] || VOICE.qingxian;
  const lead = pick(voice.lead.other, hash(meta.id + 'hello' + kind));
  const body = isTaste
    ? `我是${meta.name}口味 AI。${meta.desc || ''}`
    : `我是${meta.name} AI。${meta.region || ''}的底子，${meta.tagline || ''}`;
  const names = dishes.slice(0, 3).map((d) => d.name).join('、');
  const list = names ? ` 代表菜有${names}。` : '';
  const focus = contextDish ? ` 你现在盯着的是${contextDish.name}，想从它聊起也行。` : '';
  return `${lead}${body}${list}${focus}`;
}

/** 分类 AI 的演示回答：围绕菜系 / 味型的味觉体系、代表菜、食材与技法 */
export function demoCategoryReply({ kind, meta, persona, question, contextDish = null, dishes = [] }) {
  const isTaste = kind === 'taste';
  const voice = VOICE[persona?.id] || VOICE.qingxian;
  const intent = classifyIntent(question);
  const lead = pick(voice.lead[intent] || voice.lead.other, hash(question + meta.id + intent));
  const tail = pick(voice.tail[intent] || voice.tail.other, hash(question + 'c' + meta.id + intent));

  const names = dishes.slice(0, 3).map((d) => d.name).join('、') || '站内代表菜';
  const first = dishes[0] || null;
  const cuisines = [...new Set(dishes.map((d) => d.cuisine))].map((c) => CUISINE_BY_ID[c]?.name).filter(Boolean);
  const ingredients = [...new Set(dishes.flatMap((d) => d.ingredients || []))].slice(0, 6).join('、');

  const body = (() => {
    switch (intent) {
      case 'taste':
      case 'aroma':
      case 'texture':
        return isTaste
          ? `${meta.name}不是一个味道，是一组层次：${meta.desc || ''} 这一路讲究先闻、再尝、后回味。`
          : `${meta.name}的底色是「${meta.tagline || meta.name}」。${meta.desc || ''} 落到盘子里的样子，就是${names}。`;
      case 'recipe':
        return first
          ? `想动手就从${first.name}开始：${first.oneLiner || ''} 关键是${(first.techniques || []).slice(0, 2).join('、') || '火候'}，慢一点更稳。`
          : `这一${isTaste ? '味型' : '菜系'}的入门菜不难，从家常做法练起最稳。`;
      case 'pairing':
        return isTaste
          ? `${meta.name}适合跟${cuisines.slice(0, 3).join('、') || '同路数的菜系'}搭，主食要淡，别压住它的劲。`
          : `${meta.name}上桌讲究冷热、浓淡交替，配一碗白饭就够了，别再加戏。`;
      case 'similar':
        return `同路的还有：${names}。从一道吃到另一道，就能摸出这一${isTaste ? '味' : '系'}的骨架。`;
      default:
        return isTaste
          ? `我这边是${meta.name}，代表菜有${names}。你想聊味道、食材，还是怎么搭？`
          : `我这边管${meta.name}：${meta.region || ''}的底子，代表菜${names}。想问哪道菜、哪个技法都行。`;
    }
  })();

  const focus = contextDish
    ? ` 就拿${contextDish.name}说：${contextDish.oneLiner || contextDish.signature || ''}`
    : '';
  const extra = ingredients && (intent === 'recipe' || intent === 'taste') ? ` 常用食材：${ingredients}。` : '';

  return `${lead}${body}${focus}${extra}${tail}`;
}

/* ---------------- 演示菜谱 ---------------- */

const UNIT_BY_NAME = [
  [/盐|糖|醋|酱油|豆瓣|淀粉|蚝油|酱|椒面|花椒|豆豉/, 'g'],
  [/油|酒|高汤|水/, 'ml'],
  [/姜|葱|蒜|辣椒|香菜/, 'g'],
];

const AMOUNT_RULES = [
  [/盐/, 3, 'g'],
  [/花椒|椒面/, 6, 'g'],
  [/糖/, 15, 'g'],
  [/豆瓣/, 25, 'g'],
  [/豆豉|酱/, 20, 'g'],
  [/淀粉/, 15, 'g'],
  [/酱油|生抽|老抽|醋|料酒|绍酒|酒/, 15, 'ml'],
  [/油/, 30, 'ml'],
  [/姜|葱|蒜|辣椒|香菜/, 15, 'g'],
  [/高汤|水/, 200, 'ml'],
];

function ingredientAmount(name, index) {
  if (/鱼|鸡|鸭|鸽/.test(name)) return { amount: 1, unit: '条/只' };
  if (/海参|鲍鱼/.test(name)) return { amount: 4, unit: '只' };
  if (/蛋/.test(name)) return { amount: 2, unit: '个' };
  if (/豆腐/.test(name)) return { amount: 400, unit: 'g' };
  if (/肉|里脊|牛肉|五花/.test(name)) return { amount: 300, unit: 'g' };
  const rule = AMOUNT_RULES.find(([re]) => re.test(name));
  if (rule) return { amount: rule[1], unit: rule[2] };
  const unit = UNIT_BY_NAME.find(([re]) => re.test(name))?.[1] || 'g';
  return { amount: unit === 'ml' ? 30 : index === 0 ? 300 : 40, unit };
}

export function demoRecipe(input, dish) {
  const servings = Number(input.servings) || 2;
  const source = dish || {
    name: input.dishName,
    ingredients: ['主料', '葱', '姜', '蒜', '盐', '食用油'],
    techniques: ['预处理', '热锅下料', '调味收汁'],
    knowledge: [],
    tastes: ['qingxian'],
    prep: 15,
    cook: 20,
    difficulty: 'easy',
  };

  const ingredients = source.ingredients.slice(0, 6).map((name, i) => ({
    ...ingredientAmount(name, i),
    name,
    optional: i > 3,
  }));
  const seasonings = ['盐', '生抽', '料酒', '白糖', '食用油'].map((name) => ({
    name,
    amount: name === '食用油' ? 30 : name === '盐' ? 3 : 10,
    unit: name === '食用油' ? 'ml' : 'g',
    optional: name === '白糖',
  }));

  const steps = [
    {
      step: 1,
      title: '备料',
      description: `把${ingredients
        .slice(0, 3)
        .map((i) => i.name)
        .join('、')}处理干净，切成合适大小；调味料提前量好放在手边。`,
      duration_minutes: 10,
      heat_level: 'low',
      tips: '所有食材切好再开火，下锅时手忙脚乱最容易失败。',
    },
    {
      step: 2,
      title: '预处理',
      description: `按${source.techniques[0] || '常规方式'}处理主料，去腥定型，为后面的火候打底。`,
      duration_minutes: 8,
      heat_level: 'medium',
      tips: '这一步决定口感基础，不要省略。',
    },
    {
      step: 3,
      title: '起锅',
      description: `锅烧热后下油，油温六成热下${ingredients[1]?.name || '配料'}爆香，再下主料翻炒。`,
      duration_minutes: 5,
      heat_level: 'high',
      tips: '锅一定要先烧热再下油，否则容易粘锅。',
    },
    {
      step: 4,
      title: '调味',
      description: `依次加入${seasonings
        .slice(1, 4)
        .map((s) => s.name)
        .join('、')}，按${servings}人份调整咸淡，翻匀让味道裹住食材。`,
      duration_minutes: 4,
      heat_level: 'medium',
      tips: '盐分两次放，先少后补，比一次放多更安全。',
    },
    {
      step: 5,
      title: '收汁出锅',
      description: '转中大火收汁，汤汁变亮、能挂在食材上即可关火装盘。',
      duration_minutes: 3,
      heat_level: 'high',
      tips: '收汁时不要走开，最后 30 秒最容易糊。',
    },
  ];

  return {
    dish_name: input.dishName || source.name,
    servings,
    prep_time_minutes: source.prep || 15,
    cook_time_minutes: source.cook || 20,
    difficulty: ['easy', 'medium', 'hard'].includes(input.difficulty)
      ? input.difficulty
      : source.difficulty || 'easy',
    ingredients,
    seasonings,
    steps,
    taste_profile: source.tastes.map((t) => TASTE_BY_ID[t]?.name).filter(Boolean),
    substitutions: ['没有高汤可以用清水加一小勺鸡精替代', '不吃辣可以把辣椒换成彩椒，香气会淡一些'],
    common_mistakes: [
      source.knowledge?.[0] || '火候不足，食材出水导致味道寡淡',
      '调味一次放太多盐，后期无法补救',
    ],
    safety_notes: ['热油下锅时注意溅油，食材尽量沥干水分', '处理生肉与熟食的砧板要分开'],
  };
}

/* ---------------- 演示推荐 ---------------- */

const REASON_BY_PERSONA = {
  mala: (d) => `${d.name}麻辣够劲，${d.signature}，${d.knowledge[0] ? d.knowledge[0].replace(/。$/, '') + '。' : ''}今天想吃点刺激的就它了。`,
  xiangla: (d) => `${d.name}香在前辣在后，${d.techniques[0]}出来的锅气很足，配碗白饭就能解决一顿。`,
  suanla: (d) => `${d.name}酸辣开胃，${d.oneLiner.replace('。', '')}，没胃口的时候最合适。`,
  qingxian: (d) => `${d.name}走的是本味路线，${d.texture.slice(0, 14)}，食材新鲜就成功了一大半。`,
  xianxian: (d) => `${d.name}咸鲜打底，${d.signature}，味道站得住，适合正经吃一顿饭。`,
  xiantian: (d) => `${d.name}甜酸平衡，${d.oneLiner.replace('。', '')}，大人小孩都能接受。`,
  jiangxiang: (d) => `${d.name}酱香浓郁，${d.techniques[0]}是关键，配主食最合适。`,
  chunhou: (d) => `${d.name}醇厚耐吃，${d.signature}，有时间慢慢做的话很值得。`,
};

export function demoRecommend(input, candidates) {
  const picks = candidates.slice(0, 3).map((d) => {
    const personaId = d.tastes[0];
    const fn = REASON_BY_PERSONA[personaId] || REASON_BY_PERSONA.qingxian;
    return { id: d.id, reason: fn(d) };
  });
  return { picks };
}

export { DISH_BY_ID, CUISINE_BY_ID, PERSONALITY_BY_ID };
