/**
 * 中国食材标准库（中文名 ↔ Epicure 可识别名）
 *
 * 说明：
 * - Epicure 只认英文/规范名，用户输入中文时必须先映射；映射不到就不画关系、不编分数。
 * - 每项给出候选名（candidates），由 scripts/verify-epicure-lexicon.mjs 逐个试，
 *   能解析的那个写入 data/epicure-lexicon.json 作为「已验证」结果。
 * - cat 用于前端分类；spicy/aroma 等标签只做展示，不参与计算。
 */

export const CATEGORIES = [
  { id: 'meat', name: '肉类' },
  { id: 'seafood', name: '水产' },
  { id: 'veg', name: '蔬菜' },
  { id: 'fungi', name: '菌菇' },
  { id: 'grain', name: '谷物' },
  { id: 'soy', name: '豆制品' },
  { id: 'dairy', name: '蛋奶' },
  { id: 'seasoning', name: '调味料' },
  { id: 'spice', name: '香辛料' },
];

/** id 用拼音，前端稳定引用；candidates 按优先级排列 */
export const LEXICON = [
  // ---------- 肉类 ----------
  { id: 'zhurou', cn: '猪肉', cat: 'meat', en: '猪肉', candidates: ['pork', 'pork_shoulder', 'pork_loin'] },
  { id: 'wuhuarou', cn: '五花肉', cat: 'meat', en: '五花肉', candidates: ['pork_belly', 'pork', 'bacon'] },
  { id: 'niurou', cn: '牛肉', cat: 'meat', en: '牛肉', candidates: ['beef', 'beef_brisket'] },
  { id: 'yangrou', cn: '羊肉', cat: 'meat', en: '羊肉', candidates: ['lamb', 'mutton'] },
  { id: 'jirou', cn: '鸡肉', cat: 'meat', en: '鸡肉', candidates: ['chicken', 'chicken_breast'] },
  { id: 'jitui', cn: '鸡腿', cat: 'meat', en: '鸡腿', candidates: ['chicken_thigh', 'chicken_leg', 'chicken'] },
  { id: 'yarou', cn: '鸭肉', cat: 'meat', en: '鸭肉', candidates: ['duck', 'duck_breast'] },
  { id: 'huotui', cn: '火腿', cat: 'meat', en: '火腿', candidates: ['ham', 'cured_ham', 'jinhua_ham'] },
  { id: 'larou', cn: '腊肉', cat: 'meat', en: '腊肉', candidates: ['cured_pork', 'bacon', 'chinese_bacon'] },
  { id: 'xiangchang', cn: '香肠', cat: 'meat', en: '香肠', candidates: ['sausage', 'chinese_sausage'] },
  { id: 'paigu', cn: '排骨', cat: 'meat', en: '排骨', candidates: ['pork_ribs', 'spare_ribs', 'ribs'] },

  // ---------- 水产 ----------
  { id: 'yu', cn: '鱼', cat: 'seafood', en: '鱼', candidates: ['fish', 'white_fish'] },
  { id: 'luyu', cn: '鲈鱼', cat: 'seafood', en: '鲈鱼', candidates: ['sea_bass', 'bass', 'perch'] },
  { id: 'caoyu', cn: '草鱼', cat: 'seafood', en: '草鱼', candidates: ['grass_carp', 'carp'] },
  { id: 'xia', cn: '虾', cat: 'seafood', en: '虾', candidates: ['shrimp', 'prawn'] },
  { id: 'xieren', cn: '蟹', cat: 'seafood', en: '蟹', candidates: ['crab', 'river_crab'] },
  { id: 'geli', cn: '蛤蜊', cat: 'seafood', en: '蛤蜊', candidates: ['clam', 'clams'] },
  { id: 'shanbei', cn: '扇贝', cat: 'seafood', en: '扇贝', candidates: ['scallop', 'scallops'] },
  { id: 'youyu', cn: '鱿鱼', cat: 'seafood', en: '鱿鱼', candidates: ['squid', 'cuttlefish'] },
  { id: 'haishen', cn: '海参', cat: 'seafood', en: '海参', candidates: ['sea_cucumber'] },
  { id: 'zicai', cn: '紫菜', cat: 'seafood', en: '紫菜', candidates: ['nori', 'seaweed', 'laver'] },
  { id: 'xiami', cn: '虾米', cat: 'seafood', en: '虾米', candidates: ['dried_shrimp', 'shrimp'] },

  // ---------- 蔬菜 ----------
  { id: 'baicai', cn: '白菜', cat: 'veg', en: '白菜', candidates: ['napa_cabbage', 'chinese_cabbage', 'cabbage'] },
  { id: 'xiaobaicai', cn: '小白菜', cat: 'veg', en: '小白菜', candidates: ['bok_choy', 'pak_choi'] },
  { id: 'luobo', cn: '萝卜', cat: 'veg', en: '萝卜', candidates: ['daikon', 'radish', 'white_radish'] },
  { id: 'huluobo', cn: '胡萝卜', cat: 'veg', en: '胡萝卜', candidates: ['carrot', 'carrots'] },
  { id: 'tudou', cn: '土豆', cat: 'veg', en: '土豆', candidates: ['potato', 'potatoes'] },
  { id: 'qiezi', cn: '茄子', cat: 'veg', en: '茄子', candidates: ['eggplant', 'aubergine'] },
  { id: 'fanqie', cn: '番茄', cat: 'veg', en: '番茄', candidates: ['tomato', 'tomatoes'] },
  { id: 'huanggua', cn: '黄瓜', cat: 'veg', en: '黄瓜', candidates: ['cucumber'] },
  { id: 'donggua', cn: '冬瓜', cat: 'veg', en: '冬瓜', candidates: ['winter_melon', 'wax_gourd'] },
  { id: 'nangua', cn: '南瓜', cat: 'veg', en: '南瓜', candidates: ['pumpkin', 'squash'] },
  { id: 'sigua', cn: '丝瓜', cat: 'veg', en: '丝瓜', candidates: ['luffa', 'sponge_gourd'] },
  { id: 'kugua', cn: '苦瓜', cat: 'veg', en: '苦瓜', candidates: ['bitter_melon', 'bitter_gourd'] },
  { id: 'lianou', cn: '莲藕', cat: 'veg', en: '莲藕', candidates: ['lotus_root'] },
  { id: 'zhusun', cn: '竹笋', cat: 'veg', en: '竹笋', candidates: ['bamboo_shoot', 'bamboo_shoots'] },
  { id: 'douya', cn: '豆芽', cat: 'veg', en: '豆芽', candidates: ['bean_sprouts', 'bean_sprout'] },
  { id: 'jiucai', cn: '韭菜', cat: 'veg', en: '韭菜', candidates: ['leek', 'chinese_chives', 'chives'] },
  { id: 'bocai', cn: '菠菜', cat: 'veg', en: '菠菜', candidates: ['spinach'] },
  { id: 'shengcai', cn: '生菜', cat: 'veg', en: '生菜', candidates: ['lettuce'] },
  { id: 'qincai', cn: '芹菜', cat: 'veg', en: '芹菜', candidates: ['celery', 'chinese_celery'] },
  { id: 'qingjiao', cn: '青椒', cat: 'veg', en: '青椒', candidates: ['green_bell_pepper', 'bell_pepper'] },
  { id: 'yangcong', cn: '洋葱', cat: 'veg', en: '洋葱', candidates: ['onion', 'yellow_onion'] },
  { id: 'wosun', cn: '莴笋', cat: 'veg', en: '莴笋', candidates: ['celtuce', 'stem_lettuce'] },

  // ---------- 菌菇 ----------
  { id: 'xianggu', cn: '香菇', cat: 'fungi', en: '香菇', candidates: ['shiitake_mushroom', 'shiitake'] },
  { id: 'muer', cn: '木耳', cat: 'fungi', en: '木耳', candidates: ['wood_ear', 'black_fungus', 'wood_ear_mushroom'] },
  { id: 'jinzhengu', cn: '金针菇', cat: 'fungi', en: '金针菇', candidates: ['enoki', 'enoki_mushroom'] },
  { id: 'pinggu', cn: '平菇', cat: 'fungi', en: '平菇', candidates: ['oyster_mushroom'] },
  { id: 'yiner', cn: '银耳', cat: 'fungi', en: '银耳', candidates: ['white_fungus', 'snow_fungus'] },

  // ---------- 谷物 ----------
  { id: 'dami', cn: '大米', cat: 'grain', en: '大米', candidates: ['rice', 'white_rice'] },
  { id: 'mianfen', cn: '面粉', cat: 'grain', en: '面粉', candidates: ['flour', 'wheat_flour'] },
  { id: 'miantiao', cn: '面条', cat: 'grain', en: '面条', candidates: ['egg_noodle', 'noodles', 'wheat_noodle'] },
  { id: 'xiaomi', cn: '小米', cat: 'grain', en: '小米', candidates: ['millet'] },
  { id: 'yumi', cn: '玉米', cat: 'grain', en: '玉米', candidates: ['corn', 'sweet_corn'] },
  { id: 'nuomi', cn: '糯米', cat: 'grain', en: '糯米', candidates: ['glutinous_rice', 'sticky_rice'] },
  { id: 'niangao', cn: '年糕', cat: 'grain', en: '年糕', candidates: ['rice_cake', 'nian_gao'] },

  // ---------- 豆制品 ----------
  { id: 'doufu', cn: '豆腐', cat: 'soy', en: '豆腐', candidates: ['tofu', 'bean_curd'] },
  { id: 'doupí', cn: '豆皮', cat: 'soy', en: '豆皮', candidates: ['tofu_skin', 'yuba'] },
  { id: 'fuzhu', cn: '腐竹', cat: 'soy', en: '腐竹', candidates: ['dried_tofu_stick', 'tofu_stick', 'yuba'] },
  { id: 'dougan', cn: '豆干', cat: 'soy', en: '豆干', candidates: ['dried_tofu', 'firm_tofu'] },
  { id: 'doujiang', cn: '豆浆', cat: 'soy', en: '豆浆', candidates: ['soy_milk', 'soymilk'] },
  { id: 'douchi', cn: '豆豉', cat: 'soy', en: '豆豉', candidates: ['fermented_black_bean', 'black_bean_paste'] },

  // ---------- 蛋奶 ----------
  { id: 'jidan', cn: '鸡蛋', cat: 'dairy', en: '鸡蛋', candidates: ['egg', 'eggs'] },
  { id: 'xiandan', cn: '咸蛋', cat: 'dairy', en: '咸蛋', candidates: ['salted_egg', 'salted_duck_egg'] },
  { id: 'pidan', cn: '皮蛋', cat: 'dairy', en: '皮蛋', candidates: ['century_egg', 'preserved_egg'] },
  { id: 'niunai', cn: '牛奶', cat: 'dairy', en: '牛奶', candidates: ['milk'] },

  // ---------- 调味料 ----------
  { id: 'jiangyou', cn: '酱油', cat: 'seasoning', en: '酱油', candidates: ['soy_sauce'] },
  { id: 'shengchou', cn: '生抽', cat: 'seasoning', en: '生抽', candidates: ['light_soy_sauce', 'soy_sauce'] },
  { id: 'laochou', cn: '老抽', cat: 'seasoning', en: '老抽', candidates: ['dark_soy_sauce', 'soy_sauce'] },
  { id: 'cu', cn: '醋', cat: 'seasoning', en: '醋', candidates: ['vinegar', 'rice_vinegar'] },
  { id: 'michu', cn: '米醋', cat: 'seasoning', en: '米醋', candidates: ['rice_vinegar', 'vinegar'] },
  { id: 'liaojiu', cn: '料酒', cat: 'seasoning', en: '料酒', candidates: ['rice_wine', 'shaoxing_wine', 'cooking_wine'] },
  { id: 'doubanjiang', cn: '豆瓣酱', cat: 'seasoning', en: '豆瓣酱', candidates: ['doubanjiang', 'chili_bean_paste'] },
  { id: 'tianmianjiang', cn: '甜面酱', cat: 'seasoning', en: '甜面酱', candidates: ['sweet_bean_sauce', 'tianmianjiang'] },
  { id: 'haoyou', cn: '蚝油', cat: 'seasoning', en: '蚝油', candidates: ['oyster_sauce'] },
  { id: 'zhimayou', cn: '芝麻油', cat: 'seasoning', en: '芝麻油', candidates: ['sesame_oil'] },
  { id: 'baitang', cn: '白糖', cat: 'seasoning', en: '白糖', candidates: ['sugar', 'white_sugar'] },
  { id: 'bingtang', cn: '冰糖', cat: 'seasoning', en: '冰糖', candidates: ['rock_sugar', 'crystal_sugar'] },
  { id: 'yan', cn: '盐', cat: 'seasoning', en: '盐', candidates: ['salt'] },
  { id: 'weijing', cn: '味精', cat: 'seasoning', en: '味精', candidates: ['msg'] },
  { id: 'dianfen', cn: '淀粉', cat: 'seasoning', en: '淀粉', candidates: ['starch', 'cornstarch'] },
  { id: 'hujiaofen', cn: '胡椒粉', cat: 'seasoning', en: '胡椒粉', candidates: ['white_pepper', 'black_pepper'] },

  // ---------- 香辛料 ----------
  { id: 'huajiao', cn: '花椒', cat: 'spice', en: '花椒', candidates: ['sichuan_peppercorn', 'sichuan_pepper'] },
  { id: 'bajiao', cn: '八角', cat: 'spice', en: '八角', candidates: ['star_anise'] },
  { id: 'guipi', cn: '桂皮', cat: 'spice', en: '桂皮', candidates: ['cinnamon', 'cassia_bark'] },
  { id: 'xiangye', cn: '香叶', cat: 'spice', en: '香叶', candidates: ['bay_leaf', 'bay_leaves'] },
  { id: 'lajiao', cn: '辣椒', cat: 'spice', en: '辣椒', candidates: ['chili', 'chili_pepper', 'red_chili'] },
  { id: 'ganlajiao', cn: '干辣椒', cat: 'spice', en: '干辣椒', candidates: ['dried_chili', 'dried_chili_pepper'] },
  { id: 'lajiaoyou', cn: '辣椒油', cat: 'spice', en: '辣椒油', candidates: ['chili_oil'] },
  { id: 'wuxiangfen', cn: '五香粉', cat: 'spice', en: '五香粉', candidates: ['five_spice', 'five_spice_powder'] },
  { id: 'cong', cn: '葱', cat: 'spice', en: '葱', candidates: ['scallion', 'spring_onion', 'green_onion'] },
  { id: 'jiang', cn: '姜', cat: 'spice', en: '姜', candidates: ['ginger'] },
  { id: 'suan', cn: '蒜', cat: 'spice', en: '蒜', candidates: ['garlic'] },
  { id: 'xiangcai', cn: '香菜', cat: 'spice', en: '香菜', candidates: ['cilantro', 'coriander'] },
  { id: 'lajiaomian', cn: '辣椒面', cat: 'spice', en: '辣椒面', candidates: ['chili_flakes', 'chili_powder'] },
  // ---------- 补充：关系网络里高频出现、且属于中国厨房的食材 ----------
  { id: 'ziran', cn: '孜然', cat: 'spice', en: '孜然', candidates: ['cumin', 'cumin_seed'] },
  { id: 'heihujiao', cn: '黑胡椒', cat: 'spice', en: '黑胡椒', candidates: ['black_pepper'] },
  { id: 'fensi', cn: '粉丝', cat: 'grain', en: '粉丝', candidates: ['glass_noodle', 'vermicelli'] },
  { id: 'xingbaogu', cn: '杏鲍菇', cat: 'fungi', en: '杏鲍菇', candidates: ['king_oyster_mushroom'] },
  { id: 'shaoxingjiu', cn: '绍兴酒', cat: 'seasoning', en: '绍兴酒', candidates: ['shaoxing_wine'] },
  { id: 'xiaomila', cn: '小米辣', cat: 'spice', en: '小米辣', candidates: ['birds_eye_chili'] },
  { id: 'suantai', cn: '蒜薹', cat: 'veg', en: '蒜薹', candidates: ['garlic_scape'] },
  { id: 'shiyongyou', cn: '食用油', cat: 'seasoning', en: '食用油', candidates: ['oil', 'cooking_oil'] },
  { id: 'haidai', cn: '海带', cat: 'veg', en: '海带', candidates: ['kelp', 'seaweed'] },
  { id: 'xiebang', cn: '蟹棒', cat: 'seafood', en: '蟹棒', candidates: ['crab_stick'] },
  { id: 'huangyou', cn: '黄油', cat: 'dairy', en: '黄油', candidates: ['butter'] },
];

/** 按中文名 / 拼音 id / 英文名查（用于用户输入归一） */
export function findEntry(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    LEXICON.find((e) => e.cn === raw) ||
    LEXICON.find((e) => e.id === lower) ||
    LEXICON.find((e) => e.candidates.some((c) => c.toLowerCase() === lower)) ||
    null
  );
}
