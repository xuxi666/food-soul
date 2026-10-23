// 全站视觉主题：品牌 + 八大菜系 + 八种口味，共 17 套。
// 从 1.0 的 visualThemes.ts 移植；味型 id 已对齐 2.0（xianxiang→xianxian、xiannong→chunhou、xiangtian→xiantian，新增 xiangla）。
// 页面只引用 --t-* CSS 变量，不在样式里按名称拼颜色。

export const BRAND_THEME_ID = 'brand';

export const brandTheme = {
  "id": "brand",
  "kind": "brand",
  "label": "品牌 · 食有灵",
  "primary": "#E8A766",
  "secondary": "#8C4A2B",
  "accent": "#F2B87C",
  "background": "#100D0A",
  "surfaceColor": "#171310",
  "borderColor": "rgba(232, 167, 102, 0.28)",
  "shadowColor": "rgba(140, 74, 43, 0.45)",
  "text": "#F5F1EB",
  "mutedText": "rgba(245, 241, 235, 0.6)",
  "glowColor": "rgba(232, 167, 102, 0.4)",
  "orbColor": "#E8A766",
  "transitionGradient": "linear-gradient(135deg, #1A120C 0%, #6B3418 44%, #E8A766 100%)",
  "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(232, 167, 102, 0.16) 0%, rgba(232, 167, 102, 0.04) 42%, transparent 68%), linear-gradient(180deg, #110E0B 0%, #0C0C0F 100%)",
  "bubbleStyle": {
    "background": "rgba(232, 167, 102, 0.12)",
    "border": "rgba(232, 167, 102, 0.24)",
    "text": "#F5F1EB",
    "userBackground": "rgba(232, 167, 102, 0.18)",
    "userText": "#FBF3E8"
  },
  "buttonStyle": {
    "background": "linear-gradient(135deg, #C65D3B 0%, #E8A766 100%)",
    "text": "#241708"
  },
  "onPrimary": "#241708"
};

export const cuisineThemes = {
  "chuan": {
    "id": "chuan",
    "kind": "cuisine",
    "label": "川菜 · 赤焰朱红",
    "primary": "#C8402C",
    "secondary": "#5E1510",
    "accent": "#F09A5C",
    "background": "#150A08",
    "surfaceColor": "#1C100D",
    "borderColor": "rgba(232, 104, 58, 0.3)",
    "shadowColor": "rgba(94, 21, 16, 0.5)",
    "text": "#F8EEE9",
    "mutedText": "rgba(248, 238, 233, 0.62)",
    "glowColor": "rgba(232, 104, 58, 0.42)",
    "orbColor": "#E8683A",
    "transitionGradient": "linear-gradient(135deg, #4A0F0A 0%, #A0281A 46%, #E8683A 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(200, 64, 44, 0.18) 0%, rgba(200, 64, 44, 0.05) 42%, transparent 68%), linear-gradient(180deg, #150D0B 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(200, 64, 44, 0.13)",
      "border": "rgba(232, 104, 58, 0.26)",
      "text": "#F7E9E2",
      "userBackground": "rgba(232, 104, 58, 0.2)",
      "userText": "#FFF1E6"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #C8402C 0%, #E8683A 100%)",
      "text": "#FFF6EF"
    },
    "onPrimary": "#FFF6EF"
  },
  "yue": {
    "id": "yue",
    "kind": "cuisine",
    "label": "粤菜 · 翡翠青绿",
    "primary": "#2F8F66",
    "secondary": "#123B2B",
    "accent": "#7FD1A6",
    "background": "#0C120E",
    "surfaceColor": "#101B15",
    "borderColor": "rgba(79, 181, 131, 0.3)",
    "shadowColor": "rgba(18, 59, 43, 0.5)",
    "text": "#EEF6F0",
    "mutedText": "rgba(238, 246, 240, 0.6)",
    "glowColor": "rgba(79, 181, 131, 0.4)",
    "orbColor": "#4FB583",
    "transitionGradient": "linear-gradient(135deg, #0C2E20 0%, #1F6B49 46%, #4FB583 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(47, 143, 102, 0.18) 0%, rgba(47, 143, 102, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0C130F 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(47, 143, 102, 0.14)",
      "border": "rgba(79, 181, 131, 0.26)",
      "text": "#E9F5EE",
      "userBackground": "rgba(79, 181, 131, 0.2)",
      "userText": "#F0FBF5"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #246F50 0%, #4FB583 100%)",
      "text": "#F2FBF6"
    },
    "onPrimary": "#F2FBF6"
  },
  "su": {
    "id": "su",
    "kind": "cuisine",
    "label": "苏菜 · 雅致青瓷",
    "primary": "#4E9C96",
    "secondary": "#1C4B48",
    "accent": "#A9DCD6",
    "background": "#0D1212",
    "surfaceColor": "#121B1A",
    "borderColor": "rgba(143, 201, 194, 0.3)",
    "shadowColor": "rgba(28, 75, 72, 0.5)",
    "text": "#EEF4F3",
    "mutedText": "rgba(238, 244, 243, 0.6)",
    "glowColor": "rgba(143, 201, 194, 0.38)",
    "orbColor": "#8FC9C2",
    "transitionGradient": "linear-gradient(135deg, #123230 0%, #3A7F79 48%, #8FC9C2 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(78, 156, 150, 0.17) 0%, rgba(78, 156, 150, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0D1313 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(78, 156, 150, 0.14)",
      "border": "rgba(143, 201, 194, 0.26)",
      "text": "#E9F3F2",
      "userBackground": "rgba(143, 201, 194, 0.2)",
      "userText": "#F1FAF9"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #35736E 0%, #8FC9C2 100%)",
      "text": "#F4FBFA"
    },
    "onPrimary": "#F4FBFA"
  },
  "lu": {
    "id": "lu",
    "kind": "cuisine",
    "label": "鲁菜 · 琥珀金棕",
    "primary": "#C08A3E",
    "secondary": "#3B2408",
    "accent": "#EBC98F",
    "background": "#120E08",
    "surfaceColor": "#1B150C",
    "borderColor": "rgba(217, 168, 85, 0.3)",
    "shadowColor": "rgba(59, 36, 8, 0.5)",
    "text": "#F8F1E5",
    "mutedText": "rgba(248, 241, 229, 0.6)",
    "glowColor": "rgba(217, 168, 85, 0.4)",
    "orbColor": "#D9A855",
    "transitionGradient": "linear-gradient(135deg, #2E1C07 0%, #7A5218 46%, #D9A855 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(192, 138, 62, 0.17) 0%, rgba(192, 138, 62, 0.05) 42%, transparent 68%), linear-gradient(180deg, #130F0A 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(192, 138, 62, 0.14)",
      "border": "rgba(217, 168, 85, 0.26)",
      "text": "#F6EFE2",
      "userBackground": "rgba(217, 168, 85, 0.2)",
      "userText": "#FDF7EA"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #8A6428 0%, #D9A855 100%)",
      "text": "#2A1B06"
    },
    "onPrimary": "#2A1B06"
  },
  "xiang": {
    "id": "xiang",
    "kind": "cuisine",
    "label": "湘菜 · 烈焰橘红",
    "primary": "#E2551E",
    "secondary": "#7A2409",
    "accent": "#F7A05C",
    "background": "#140C07",
    "surfaceColor": "#1E110A",
    "borderColor": "rgba(245, 130, 46, 0.3)",
    "shadowColor": "rgba(122, 36, 9, 0.5)",
    "text": "#FAEDE4",
    "mutedText": "rgba(250, 237, 228, 0.62)",
    "glowColor": "rgba(245, 130, 46, 0.45)",
    "orbColor": "#F5822E",
    "transitionGradient": "linear-gradient(135deg, #3C0E02 0%, #B23A0E 44%, #F5822E 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(226, 85, 30, 0.18) 0%, rgba(226, 85, 30, 0.05) 42%, transparent 68%), linear-gradient(180deg, #140D08 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(226, 85, 30, 0.14)",
      "border": "rgba(245, 130, 46, 0.26)",
      "text": "#F9ECE1",
      "userBackground": "rgba(245, 130, 46, 0.2)",
      "userText": "#FFF3E6"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #C2431A 0%, #F5822E 100%)",
      "text": "#FFF5EC"
    },
    "onPrimary": "#FFF5EC"
  },
  "min": {
    "id": "min",
    "kind": "cuisine",
    "label": "闽菜 · 海韵蓝绿",
    "primary": "#33809B",
    "secondary": "#103A4A",
    "accent": "#7FC9D8",
    "background": "#0A1114",
    "surfaceColor": "#0E171C",
    "borderColor": "rgba(87, 174, 194, 0.3)",
    "shadowColor": "rgba(16, 58, 74, 0.5)",
    "text": "#EAF4F6",
    "mutedText": "rgba(234, 244, 246, 0.6)",
    "glowColor": "rgba(87, 174, 194, 0.4)",
    "orbColor": "#57AEC2",
    "transitionGradient": "linear-gradient(135deg, #082B38 0%, #1F6276 48%, #57AEC2 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(51, 128, 155, 0.17) 0%, rgba(51, 128, 155, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0B1215 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(51, 128, 155, 0.15)",
      "border": "rgba(87, 174, 194, 0.26)",
      "text": "#E7F2F5",
      "userBackground": "rgba(87, 174, 194, 0.2)",
      "userText": "#EFF9FB"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #245F75 0%, #57AEC2 100%)",
      "text": "#F0FAFC"
    },
    "onPrimary": "#F0FAFC"
  },
  "zhe": {
    "id": "zhe",
    "kind": "cuisine",
    "label": "浙菜 · 竹影青绿",
    "primary": "#6B9440",
    "secondary": "#2A3D12",
    "accent": "#B7D489",
    "background": "#0E1209",
    "surfaceColor": "#131A0D",
    "borderColor": "rgba(143, 176, 85, 0.3)",
    "shadowColor": "rgba(42, 61, 18, 0.5)",
    "text": "#F1F5EA",
    "mutedText": "rgba(241, 245, 234, 0.6)",
    "glowColor": "rgba(143, 176, 85, 0.38)",
    "orbColor": "#8FB055",
    "transitionGradient": "linear-gradient(135deg, #18260A 0%, #48691F 46%, #8FB055 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(107, 148, 64, 0.17) 0%, rgba(107, 148, 64, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0E130A 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(107, 148, 64, 0.15)",
      "border": "rgba(143, 176, 85, 0.26)",
      "text": "#EEF4E4",
      "userBackground": "rgba(143, 176, 85, 0.2)",
      "userText": "#F5FAEB"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #4F7028 0%, #8FB055 100%)",
      "text": "#F5FAEB"
    },
    "onPrimary": "#F5FAEB"
  },
  "hui": {
    "id": "hui",
    "kind": "cuisine",
    "label": "徽菜 · 山岚墨金",
    "primary": "#9C7B34",
    "secondary": "#20260F",
    "accent": "#D4B96C",
    "background": "#10120B",
    "surfaceColor": "#171A0F",
    "borderColor": "rgba(212, 185, 108, 0.3)",
    "shadowColor": "rgba(32, 38, 15, 0.55)",
    "text": "#F5F0E0",
    "mutedText": "rgba(245, 240, 224, 0.6)",
    "glowColor": "rgba(212, 185, 108, 0.35)",
    "orbColor": "#C9A95C",
    "transitionGradient": "linear-gradient(135deg, #161A0B 0%, #3E4A22 48%, #8C6F2E 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(156, 123, 52, 0.16) 0%, rgba(156, 123, 52, 0.05) 42%, transparent 68%), linear-gradient(180deg, #10120C 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(156, 123, 52, 0.16)",
      "border": "rgba(212, 185, 108, 0.26)",
      "text": "#F3EEDD",
      "userBackground": "rgba(212, 185, 108, 0.2)",
      "userText": "#FAF6E8"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #6E5622 0%, #C9A95C 100%)",
      "text": "#241C08"
    },
    "onPrimary": "#241C08"
  }
};

export const tasteThemes = {
  "mala": {
    "id": "mala",
    "kind": "taste",
    "label": "麻辣 · 炽热猩红",
    "primary": "#E23A1E",
    "secondary": "#6E0F05",
    "accent": "#FF9A4A",
    "background": "#140807",
    "surfaceColor": "#1E0D0A",
    "borderColor": "rgba(255, 122, 58, 0.3)",
    "shadowColor": "rgba(110, 15, 5, 0.5)",
    "text": "#FBEAE4",
    "mutedText": "rgba(251, 234, 228, 0.62)",
    "glowColor": "rgba(255, 110, 60, 0.48)",
    "orbColor": "#FF7A3C",
    "transitionGradient": "linear-gradient(135deg, #3F0500 0%, #B01A0A 38%, #FF8A3C 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(226, 58, 30, 0.2) 0%, rgba(226, 58, 30, 0.06) 42%, transparent 68%), linear-gradient(180deg, #150907 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(226, 58, 30, 0.15)",
      "border": "rgba(255, 122, 58, 0.28)",
      "text": "#FAE7DF",
      "userBackground": "rgba(255, 110, 60, 0.22)",
      "userText": "#FFF0E6"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #C22A10 0%, #FF8A3C 100%)",
      "text": "#FFF5EE"
    },
    "onPrimary": "#FFF5EE"
  },
  "suanla": {
    "id": "suanla",
    "kind": "taste",
    "label": "酸辣 · 酸橙黄绿",
    "primary": "#9CB31C",
    "secondary": "#3A470A",
    "accent": "#E4D24E",
    "background": "#0F1108",
    "surfaceColor": "#161A0B",
    "borderColor": "rgba(214, 195, 59, 0.3)",
    "shadowColor": "rgba(58, 71, 10, 0.5)",
    "text": "#F5F6E6",
    "mutedText": "rgba(245, 246, 230, 0.6)",
    "glowColor": "rgba(214, 195, 59, 0.4)",
    "orbColor": "#D6C33B",
    "transitionGradient": "linear-gradient(135deg, #2A3403 0%, #71860F 44%, #D6C33B 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(156, 179, 28, 0.16) 0%, rgba(156, 179, 28, 0.05) 42%, transparent 68%), linear-gradient(180deg, #10120A 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(156, 179, 28, 0.15)",
      "border": "rgba(214, 195, 59, 0.26)",
      "text": "#F3F5E2",
      "userBackground": "rgba(214, 195, 59, 0.2)",
      "userText": "#FBFBE9"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #7E9312 0%, #D6C33B 100%)",
      "text": "#232A05"
    },
    "onPrimary": "#232A05"
  },
  "qingxian": {
    "id": "qingxian",
    "kind": "taste",
    "label": "清鲜 · 薄荷青",
    "primary": "#37A99A",
    "secondary": "#0F4A43",
    "accent": "#9BE3D8",
    "background": "#0B1311",
    "surfaceColor": "#0F1C19",
    "borderColor": "rgba(111, 201, 188, 0.3)",
    "shadowColor": "rgba(15, 74, 67, 0.5)",
    "text": "#E9F6F3",
    "mutedText": "rgba(233, 246, 243, 0.6)",
    "glowColor": "rgba(111, 201, 188, 0.4)",
    "orbColor": "#6FC9BC",
    "transitionGradient": "linear-gradient(135deg, #07332E 0%, #218277 46%, #6FC9BC 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(55, 169, 154, 0.17) 0%, rgba(55, 169, 154, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0B1412 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(55, 169, 154, 0.14)",
      "border": "rgba(111, 201, 188, 0.26)",
      "text": "#E6F4F1",
      "userBackground": "rgba(111, 201, 188, 0.2)",
      "userText": "#EFFBF8"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #26786F 0%, #6FC9BC 100%)",
      "text": "#F0FCF9"
    },
    "onPrimary": "#F0FCF9"
  },
  "xianxian": {
    "id": "xianxian",
    "kind": "taste",
    "label": "咸鲜 · 麦芽暖金",
    "primary": "#CDA050",
    "secondary": "#4A3814",
    "accent": "#EBD08E",
    "background": "#121008",
    "surfaceColor": "#1A160C",
    "borderColor": "rgba(226, 199, 130, 0.3)",
    "shadowColor": "rgba(74, 56, 20, 0.5)",
    "text": "#F8F1E4",
    "mutedText": "rgba(248, 241, 228, 0.6)",
    "glowColor": "rgba(235, 208, 142, 0.4)",
    "orbColor": "#E2C782",
    "transitionGradient": "linear-gradient(135deg, #33260B 0%, #8A6A2C 46%, #EBD08E 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(205, 160, 80, 0.17) 0%, rgba(205, 160, 80, 0.05) 42%, transparent 68%), linear-gradient(180deg, #13110A 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(205, 160, 80, 0.15)",
      "border": "rgba(235, 208, 142, 0.26)",
      "text": "#F6EFE0",
      "userBackground": "rgba(235, 208, 142, 0.2)",
      "userText": "#FDF8EB"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #96763A 0%, #E2C782 100%)",
      "text": "#2A2109"
    },
    "onPrimary": "#2A2109"
  },
  "jiangxiang": {
    "id": "jiangxiang",
    "kind": "taste",
    "label": "酱香 · 深琥珀棕",
    "primary": "#96562A",
    "secondary": "#401F08",
    "accent": "#DCAC66",
    "background": "#120D07",
    "surfaceColor": "#1B1309",
    "borderColor": "rgba(220, 172, 102, 0.3)",
    "shadowColor": "rgba(64, 31, 8, 0.55)",
    "text": "#F7EDE1",
    "mutedText": "rgba(247, 237, 225, 0.6)",
    "glowColor": "rgba(184, 127, 53, 0.42)",
    "orbColor": "#B87F35",
    "transitionGradient": "linear-gradient(135deg, #280F02 0%, #6B3812 44%, #B87F35 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(150, 86, 42, 0.18) 0%, rgba(150, 86, 42, 0.05) 42%, transparent 68%), linear-gradient(180deg, #130D08 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(150, 86, 42, 0.16)",
      "border": "rgba(220, 172, 102, 0.26)",
      "text": "#F5EBDD",
      "userBackground": "rgba(220, 172, 102, 0.2)",
      "userText": "#FCF5E9"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #6E3D14 0%, #C08A45 100%)",
      "text": "#2C1A06"
    },
    "onPrimary": "#2C1A06"
  },
  "chunhou": {
    "id": "chunhou",
    "kind": "taste",
    "label": "醇厚 · 海藻墨绿",
    "primary": "#3E7A55",
    "secondary": "#10281A",
    "accent": "#96C7A4",
    "background": "#0C120D",
    "surfaceColor": "#101A13",
    "borderColor": "rgba(150, 199, 164, 0.3)",
    "shadowColor": "rgba(16, 40, 26, 0.5)",
    "text": "#EDF5EE",
    "mutedText": "rgba(237, 245, 238, 0.6)",
    "glowColor": "rgba(95, 155, 116, 0.4)",
    "orbColor": "#5F9B74",
    "transitionGradient": "linear-gradient(135deg, #0A1D12 0%, #2A5638 46%, #5F9B74 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(62, 122, 85, 0.17) 0%, rgba(62, 122, 85, 0.05) 42%, transparent 68%), linear-gradient(180deg, #0C130E 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(62, 122, 85, 0.15)",
      "border": "rgba(150, 199, 164, 0.26)",
      "text": "#E9F3EC",
      "userBackground": "rgba(150, 199, 164, 0.2)",
      "userText": "#F1FAF4"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #2F5F41 0%, #79B08C 100%)",
      "text": "#F2FBF5"
    },
    "onPrimary": "#F2FBF5"
  },
  "xiantian": {
    "id": "xiantian",
    "kind": "taste",
    "label": "鲜甜 · 蜜桃粉金",
    "primary": "#E18FA8",
    "secondary": "#7A3B52",
    "accent": "#F6D3B8",
    "background": "#130D10",
    "surfaceColor": "#1D1216",
    "borderColor": "rgba(242, 195, 158, 0.3)",
    "shadowColor": "rgba(122, 59, 82, 0.45)",
    "text": "#FBF0F3",
    "mutedText": "rgba(251, 240, 243, 0.6)",
    "glowColor": "rgba(242, 195, 158, 0.42)",
    "orbColor": "#F2C39E",
    "transitionGradient": "linear-gradient(135deg, #4E2032 0%, #B05E7C 44%, #F2C39E 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(225, 143, 168, 0.17) 0%, rgba(225, 143, 168, 0.05) 42%, transparent 68%), linear-gradient(180deg, #140E11 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(225, 143, 168, 0.15)",
      "border": "rgba(246, 211, 184, 0.26)",
      "text": "#F8E9EE",
      "userBackground": "rgba(246, 211, 184, 0.2)",
      "userText": "#FEF4F6"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #B06179 0%, #F0BE9A 100%)",
      "text": "#3A1926"
    },
    "onPrimary": "#3A1926"
  },
  "xiangla": {
    "id": "xiangla",
    "kind": "taste",
    "label": "香辣 · 烈火椒香",
    "primary": "#D02F1E",
    "secondary": "#5A0E06",
    "accent": "#FF8A3D",
    "background": "#160907",
    "surfaceColor": "#200D09",
    "borderColor": "rgba(255, 120, 60, 0.3)",
    "shadowColor": "rgba(90, 14, 6, 0.5)",
    "text": "#FBE9E2",
    "mutedText": "rgba(251, 233, 226, 0.62)",
    "glowColor": "rgba(255, 100, 50, 0.46)",
    "orbColor": "#F45A2A",
    "transitionGradient": "linear-gradient(135deg, #3A0600 0%, #A81A0C 40%, #FF7A34 100%)",
    "chatBackground": "radial-gradient(120% 80% at 18% 0%, rgba(208, 47, 30, 0.2) 0%, rgba(208, 47, 30, 0.06) 42%, transparent 68%), linear-gradient(180deg, #160A07 0%, #0C0C0F 100%)",
    "bubbleStyle": {
      "background": "rgba(208, 47, 30, 0.15)",
      "border": "rgba(255, 120, 60, 0.28)",
      "text": "#FAE7DF",
      "userBackground": "rgba(255, 100, 50, 0.22)",
      "userText": "#FFF0E6"
    },
    "buttonStyle": {
      "background": "linear-gradient(135deg, #A81A0C 0%, #FF7A34 100%)",
      "text": "#FFF5EE"
    },
    "onPrimary": "#FFF5EE"
  }
};

/** 全站主题总表：品牌 + 八大菜系 + 八种口味，id 全局唯一 */
export const visualThemeMap = { brand: brandTheme, ...cuisineThemes, ...tasteThemes };

const themeIdSet = new Set(Object.keys(visualThemeMap));

export function isThemeId(value) {
  return typeof value === 'string' && themeIdSet.has(value);
}

/** 按稳定 id 取主题；未知 id 回退品牌主题，页面永远不会因为没有主题而崩 */
export function getVisualTheme(id) {
  if (id && themeIdSet.has(id)) return visualThemeMap[id];
  return brandTheme;
}

/** 菜系/味型 → 主题 id（菜系节点优先菜系主题，口味节点用口味主题） */
export function themeIdFor({ kind, id }) {
  if (kind === 'cuisine' && cuisineThemes[id]) return id;
  if (kind === 'taste' && tasteThemes[id]) return id;
  return BRAND_THEME_ID;
}

/* ---------------- 浅色版主题推导 ----------------
 * 主题表里存的是 1.0 时期的深色配色（背景偏黑、文字偏白）。
 * 现在全站是奶油米白底，所以 --t-* 不再直接取表里的深色值，
 * 而是按每套主题自己的主色/强调色，推导出同色系的浅色版本：
 * 背景=主色极淡叠加米白，表面=白，文字=焦糖深棕，按钮=主色实心白字。
 * 这样八菜系 / 八口味依然各有一个“味道色”，但不再把页面压成黑底。
 */
const LIGHT_TEXT = '#51372A';
const LIGHT_MUTED = '#806B5B';
const LIGHT_BG = [255, 248, 237];
const LIGHT_BG_2 = [255, 241, 222];

function hexToRgb(hex) {
  const v = String(hex || '').replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [217, 164, 65];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 把颜色按比例混到米白里，得到不透明的浅色（用于背景/气泡） */
function tint(hex, alpha, base = LIGHT_BG) {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c, t) => Math.round(c * alpha + t * (1 - alpha));
  return `rgb(${mix(r, base[0])}, ${mix(g, base[1])}, ${mix(b, base[2])})`;
}

/** 把高亮的强调色压深，作为浅底上的文字色（保证 4.5:1 左右） */
function ink(hex) {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c, t, w) => Math.round(c * (1 - w) + t * w);
  return `rgb(${mix(r, 81, 0.62)}, ${mix(g, 55, 0.62)}, ${mix(b, 42, 0.62)})`;
}

/** 把主题映射成 CSS 自定义属性（--t-*），挂在页面根节点上 */
export function themeVars(theme) {
  const primary = theme.primary || '#D94B32';
  const accent = theme.accent || '#F39A38';
  return {
    '--t-primary': primary,
    '--t-secondary': theme.secondary,
    '--t-accent': accent,
    /* 强调色作文字时的加深版本 */
    '--t-accent-ink': ink(accent),
    '--t-bg': tint(accent, 0.06),
    '--t-surface': '#FFFFFF',
    '--t-border': rgba(primary, 0.22),
    '--t-shadow': 'rgba(93, 61, 37, 0.12)',
    '--t-text': LIGHT_TEXT,
    '--t-muted': LIGHT_MUTED,
    '--t-glow': rgba(accent, 0.3),
    '--t-orb': primary,
    '--t-chat-bg': `radial-gradient(120% 80% at 18% 0%, ${rgba(accent, 0.18)} 0%, ${rgba(accent, 0.04)} 42%, transparent 68%), linear-gradient(180deg, rgb(${LIGHT_BG.join(', ')}) 0%, rgb(${LIGHT_BG_2.join(', ')}) 100%)`,
    '--t-bubble-bg': tint(primary, 0.07),
    '--t-bubble-border': rgba(primary, 0.18),
    '--t-bubble-text': LIGHT_TEXT,
    '--t-user-bg': tint(primary, 0.14),
    '--t-user-text': '#3F2A1F',
    '--t-btn-bg': primary,
    '--t-btn-text': '#FFFFFF',
    '--t-btn-solid': primary,
    '--t-on-primary': '#FFFFFF',
  };
}

/** 把主题变量应用到某个元素（返回清理函数） */
export function applyTheme(el, themeId) {
  const theme = getVisualTheme(themeId);
  const vars = themeVars(theme);
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = el.style.getPropertyValue(k);
    el.style.setProperty(k, v);
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v) el.style.setProperty(k, v);
      else el.style.removeProperty(k);
    }
  };
}
