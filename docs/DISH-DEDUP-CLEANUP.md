# 菜品去重清理报告

生成时间：2026-11-12 18:03（Asia/Hong_Kong）

## 一、结论

本次只清理菜品数据、菜系/口味关联和数据库派生关联，不改页面布局、轮播、书本尺寸、翻页动画、书签或导航，也没有提交 Git、推送代码或部署网站。

| 项目 | 清理前 | 清理后 | 说明 |
|---|---:|---:|---|
| 图鉴静态菜品 | 97 | 83 | 16 道精选 + 迁移库；本次停用 14 条重复记录 |
| AI 补全菜品 | 43 | 39 | 停用 4 条低信息量/异名重复记录 |
| 活跃菜品合计 | 140 | 122 | 静态 + AI 补全 |

原始记录没有物理删除：迁移库原始 82 条仍在 [library-dishes.js](../src/data/library-dishes.js) 中，AI 补全 43 条仍在 [generated-dishes.json](../data/generated-dishes.json) 中；[dish-merges.js](../src/data/dish-merges.js) 负责在运行时停用并保留旧 id 的解析。这样既清掉展示重复，也保留审计、菜谱和回滚能力。

## 二、重复分类

| 类型 | 数量 | 处理 |
|---|---:|---|
| A 类：完全重复（同名、同核心做法） | 11 组 / 11 条 | 保留精选版，停用迁移库同名记录 |
| B 类：同一道菜的做法/流派变体 | 1 条删除 + 1 条保留 | 清炖狮子头并入狮子头；蟹粉狮子头因有独立时令特色保留 |
| C 类：异名/别名同菜 | 6 条 / 4 个标准菜 | 合并到标准菜，旧名写入搜索别名 |
| 搜索别名 | 15 个 | 不生成独立卡片，仅用于搜索和旧链接解析 |
| **合计停用** | **18 条** | A 11 + B 1 + C 6，均为运行时合并/停用，原始记录保留 |

### A 类完全重复

| 菜名 | 保留 id | 停用 id | 菜系 |
|---|---|---|---|
| 水煮鱼 | shui-zhu-yu | shuizhuyu | 川菜 |
| 白切鸡 | bai-qie-ji | baiqieji | 粤菜 |
| 糖醋鲤鱼 | tang-cu-li-yu | tangcu-liyu | 鲁菜 |
| 葱烧海参 | cong-shao-hai-shen | congshao-haishen | 鲁菜 |
| 松鼠鳜鱼 | song-shu-gui-yu | songshu-guiyu | 苏菜 |
| 西湖醋鱼 | xi-hu-cu-yu | xihu-cuyu | 浙菜 |
| 龙井虾仁 | long-jing-xia-ren | longjing-shrimp | 浙菜 |
| 佛跳墙 | fo-tiao-qiang | fotiaoqiang | 闽菜 |
| 荔枝肉 | li-zhi-rou | lizhirou | 闽菜 |
| 剁椒鱼头 | duo-jiao-yu-tou | duojiao-yutou | 湘菜 |
| 黄山炖鸽 | huang-shan-dun-ge | huangshan-dunge | 徽菜 |

### B/C 类合并

| 标准菜 | 被合并记录 | 处理依据 |
|---|---|---|
| 狮子头 (shi-zi-tou) | 清炖狮子头 (qingdun-shizitou) | 清炖只是狮子头的常规做法，不单独保留；蟹粉狮子头因有独立时令特色保留 |
| 臭鳜鱼 (chou-gui-yu) | 徽州臭鳜鱼 (chouguiyu) | “徽州臭鳜鱼”是臭鳜鱼的地域名，合并到标准菜“臭鳜鱼” |
| 清蒸鱼 (qing-zheng-yu) | 清蒸鲈鱼 (qingzheng-luyu) | 清蒸鱼的标准做法之一，合并到通用标准菜“清蒸鱼” |
| 清蒸鱼 (qing-zheng-yu) | 清蒸海鲈鱼 (ai-25e5ab7a4c) | 清蒸鱼的鱼类变体，合并到清蒸鱼并保留为搜索别名 |
| 清蒸鱼 (qing-zheng-yu) | 清蒸石斑鱼 (ai-c01f3c24aa) | 清蒸鱼的鱼类变体，合并到清蒸鱼并保留为搜索别名 |
| 盐水鸭 (yanshuiya) | 广东咸水鸭 (ai-83acc6ac10) | “咸水鸭”与盐水鸭主料、成菜方式高度重合，且原记录无图片/食材，合并到盐水鸭 |
| 麻婆豆腐 (mapo-tofu) | 麻辣豆腐 (ai-12b870024f) | “麻辣豆腐”是麻婆豆腐的常见家常叫法，合并到标准菜 |

跨菜系重复 1 组：**广东咸水鸭（粤）** 与 **南京盐水鸭（苏）** 指向同一道盐水鸭，保留苏菜标准菜“盐水鸭”，把“广东咸水鸭”作为别名；其余静态菜没有跨菜系重复。冷门重复做法方面，`清蒸海鲈鱼`、`清蒸石斑鱼` 作为普通鱼种变体并入“清蒸鱼”，未保留为独立卡片。

## 三、菜系数量

| 菜系 | 清理前 | 清理后 |
|---|---:|---:|
| 川菜 | 12 | 11 |
| 粤菜 | 13 | 11 |
| 鲁菜 | 12 | 10 |
| 苏菜 | 12 | 10 |
| 浙菜 | 12 | 10 |
| 闽菜 | 12 | 10 |
| 湘菜 | 12 | 11 |
| 徽菜 | 12 | 10 |
| **合计** | **97** | **83** |

## 四、口味数量

| 口味 | 清理前 | 清理后 |
|---|---:|---:|
| 麻辣鲜香（mala） | 8 | 7 |
| 香辣浓烈（xiangla） | 20 | 17 |
| 酸辣开胃（suanla） | 10 | 5 |
| 清鲜本味（qingxian） | 29 | 23 |
| 咸鲜醇厚（xianxian） | 55 | 42 |
| 鲜甜柔和（xiantian） | 28 | 23 |
| 酱香浓郁（jiangxiang） | 13 | 12 |
| 醇厚浓香（chunhou） | 23 | 16 |

多口味菜品仍可合法跨口味展示，但不再为相似口味保留无关的第三标签；本次修正 13 道菜的口味关联。

### 口味关联修正

| 菜品 | 修正前 | 修正后 | 说明 |
|---|---|---|---|
| 糖醋鲤鱼 (tang-cu-li-yu) | xiantian / suanla | xiantian | 去掉不符合菜品的次要标签 |
| 松鼠鳜鱼 (song-shu-gui-yu) | xiantian / suanla | xiantian | 去掉不符合菜品的次要标签 |
| 荔枝肉 (li-zhi-rou) | xiantian / suanla | xiantian | 去掉不符合菜品的次要标签 |
| 西湖醋鱼 (xi-hu-cu-yu) | suanla / qingxian | xiantian / qingxian | 去掉不符合菜品的次要标签，人格 suanla → xiantian |
| 片儿川 (pianer-chuan) | qingxian / xianxian / suanla | qingxian / xianxian | 去掉不符合菜品的次要标签 |
| 老火靓汤 (laohuo-liangtang) | qingxian / xianxian / xiantian | qingxian / xianxian | 去掉不符合菜品的次要标签 |
| 九转大肠 (jiuzhuan-dachang) | xiangla / xianxian / xiantian | xiangla / xiantian | 去掉不符合菜品的次要标签 |
| 四喜丸子 (sixi-wanzi) | jiangxiang / xianxian / xiantian | jiangxiang / xianxian | 去掉不符合菜品的次要标签 |
| 农家小炒肉 (nongjia-xiaochaorou) | xiangla / xianxian / chunhou | xiangla / xianxian | 去掉不符合菜品的次要标签 |
| 腊味合蒸 (lawei-hezheng) | xianxian / chunhou / xiangla | xianxian / chunhou | 去掉不符合菜品的次要标签 |
| 海蛎煎 (haili-jian) | xianxian / xiantian / chunhou | xianxian / xiantian | 去掉不符合菜品的次要标签 |
| 火腿炖甲鱼 (huotui-dunjiayu) | qingxian / xianxian / chunhou | qingxian / chunhou | 去掉不符合菜品的次要标签 |
| 酸菜鱼 (suancaiyu) | suanla / xiangla / xianxian | suanla / xiangla | 去掉不符合菜品的次要标签 |

## 五、保留与争议菜品

- **蟹粉狮子头**：保留。它不是普通狮子头的重复卡片，蟹粉、蟹黄和时令宴席属性构成独立特色。
- **松鼠鳜鱼 / 糖醋鲤鱼 / 荔枝肉 / 西湖醋鱼**：均保留。它们是不同菜系、不同主料/刀工/成菜形态的独立菜，不因“酸甜”相近而合并。
- **臭鳜鱼**：保留标准菜“臭鳜鱼”，把“徽州臭鳜鱼”作为别名；不再单独成卡。
- **清蒸鱼**：保留通用标准菜“清蒸鱼”，把“清蒸鲈鱼、清蒸海鲈鱼、清蒸石斑鱼”作为别名；避免同一种蒸法按鱼种重复成卡。
- **香煎海鲈鱼、潮州鱼丸煲**：本轮保留。前者是煎制做法，后者是煲类呈现，未达到必须合并的程度；如后续确认无独立展示价值，可在同一登记表中继续合并。

## 六、图片与关联完整性

- 83 道静态菜全部有图片文件，缺失 0 个；按图片内容哈希检查，重复图片 0 组。
- 社区 104 条帖子中，失效菜品引用 0 条；评论/收藏数据未删除。
- 数据库没有独立菜品表，菜品主数据在静态 JS/JSON；数据库中的派生关联已合并：pairing_evidence 594 → 589，flavor_evidence 692 不变。
- 原 pairing 旧引用 38 条、原 flavor 旧引用 103 条；合并后残留均为 0。5 条重复食材关联折叠时已把 occurrence_count 求和，没有丢失证据计数；86 条风味来源引用做了去重规范化。
- 数据库完整性检查：ok；未知 pairing 菜品 id：0；失效 flavor 引用：0。

## 七、备份与回滚

备份目录：data/backups/dish-dedup-20261112-180500

包含清理前的 `dishes.js`、`library-dishes.js`、`generated-dishes.json`、`community.json`、`comments.json`、`recommendation-dishes.json`、`foodsoul.db`，以及 `manifest.json` 校验清单。回滚时先停止本地服务，恢复上述文件，再恢复数据库；原始重复记录仍在源文件中，所以不会因本次操作丢失。

## 八、验证

- `node --check` 通过：dish-merges.js、dishes.js、library-dishes.js、server/dish-search.mjs、server/recipe-lookup.mjs、src/views/dishes.js。
- `vite build` 通过；仅有项目原有的 CSS 压缩告警和动态 import 提示，与本次菜品数据清理无关。
- `/api/health` 返回 `dishes:83, generated:39`；旧 id 查询和“白斩鸡 / 麻辣豆腐 / 清蒸石斑鱼”等别名查询均可解析到标准菜。
- 未提交 Git、未推送、未部署。
