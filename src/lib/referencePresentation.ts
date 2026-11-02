import type { Anchor, Category } from "../model/v040/types";

export const REFERENCE_GROUPS = [
  { id: "china-song", label: "中国歌曲", region: "china", category: "song" },
  {
    id: "china-instrumental",
    label: "中国乐曲",
    region: "china",
    category: "instrumental",
  },
  { id: "global-song", label: "国际歌曲", region: "global", category: "song" },
  {
    id: "global-instrumental",
    label: "国际乐曲",
    region: "global",
    category: "instrumental",
  },
] as const;
export const REFERENCE_STARS = [2, 2.5, 3, 3.5, 4, 4.5, 5];
const criteria: Record<string, string> = {
  歌词: "语言、意象与叙述在歌曲中的有效性",
  作曲: "旋律、节奏、和声与歌曲组织",
  素材: "主题、动机、节奏及声音材料的创造与选择",
  结构: "材料发展、声部关系与时间组织",
  表演: "诠释、时间感、互动与音乐实现",
  制作: "编配与声音实现对作品的服务",
  愿景: "整碟艺术构想与实际音乐的统一",
  语境: "作品与传统、时代及地域文化的艺术关系",
};
const levels = [
  "有可辨艺术特点，但多数曲目的关键任务仍受明显局限",
  "部分手法有效，类似局限仍在多首曲目中持续出现",
  "多数曲目稳定完成表达任务，发展与细节仍较常规",
  "鲜明的方法在多数曲目中奏效，部分段落仍不够充分",
  "多数曲目持续优秀，细节与整体互相支撑",
  "高度成熟且独特，核心艺术成就贯穿绝大部分曲目",
  "典范性的艺术成就贯穿绝大部分曲目，经得起反例与同档比较",
];
/** Reading guidance only. Does not enter the engine, snapshots or weight data. */
export function levelStandard(category: Category, name: string, stars: number) {
  const criterion =
    category === "instrumental" && name === "制作"
      ? "音色、录音、动态与声场的实现"
      : criteria[name];
  if (stars < 2)
    return `${criterion}：${stars === 0.5 ? "关键表达尚未成立" : stars === 1 ? "存在贯穿整碟的严重不足" : "明显薄弱，有效片段有限"}。此档不设参考专辑。`;
  return `${criterion}：${levels[Math.round((stars - 2) * 2)]}。`;
}
export interface ReferenceDetail {
  genre?: string;
  coverUrl?: string;
}
export function safeCover(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
export function anchorReason(a: Anchor) {
  return a.feature.replace(/^(待检验假设|候选观察|初选理由)[：:]/, "");
}

const artistGenres: Record<string, string> = {
  庞龙: "流行",
  郑源: "流行",
  梁静茹: "流行",
  宋冬野: "民谣",
  赵雷: "民谣",
  李宗盛: "流行",
  罗大佑: "民谣摇滚",
  徐良: "流行",
  六哲: "流行",
  牛奶咖啡: "独立流行",
  李健: "民谣流行",
  朴树: "民谣摇滚",
  陶喆: "节奏布鲁斯",
  周杰伦: "流行",
  杨幂: "流行",
  曾轶可: "独立流行",
  花儿乐队: "流行朋克",
  张悬: "民谣",
  林忆莲: "流行",
  齐豫: "民谣流行",
  江蕙: "台语流行",
  李志: "民谣",
  蛋堡: "嘻哈",
  郭顶: "流行",
  窦唯: "摇滚",
  王菲: "另类流行",
  香香: "流行",
  王心凌: "流行",
  张醒婵: "独立流行",
  许嵩: "流行",
  草东没有派对: "独立摇滚",
  万能青年旅店: "艺术摇滚",
  胡夏: "流行",
  刘惜君: "流行",
  郝云: "民谣",
  LMF: "嘻哈",
  五条人: "民谣摇滚",
  许冠杰: "粤语流行",
  崔健: "摇滚",
  文雀: "后摇滚",
  惘闻: "后摇滚",
  林海: "新世纪音乐",
  沼泽: "后摇滚",
  谭盾: "电影原声",
  刘星: "当代器乐",
  王羽佳: "古典",
  郎朗: "古典",
  赵季平: "电影原声",
  "Chance the Rapper": "嘻哈",
  Metallica: "金属",
  Oasis: "英伦摇滚",
  "AC/DC": "硬摇滚",
  "Taylor Swift": "流行",
  "The Smiths": "独立摇滚",
  "Bob Dylan": "民谣摇滚",
  "Van Halen": "硬摇滚",
  Radiohead: "另类摇滚",
  "Fleetwood Mac": "流行摇滚",
  "Kate Bush": "艺术流行",
  "The Beach Boys": "流行",
  "Lou Reed & Metallica": "实验摇滚",
  "James Brown": "灵魂乐",
  "Aretha Franklin": "灵魂乐",
  "Michael Jackson": "流行",
  "Guns N’ Roses": "硬摇滚",
  Nirvana: "另类摇滚",
  Björk: "电子艺术流行",
  "Chris Cornell": "流行摇滚",
  "Lady Gaga": "舞曲流行",
  "David Bowie": "艺术摇滚",
  "Pink Floyd": "前卫摇滚",
  Adele: "流行灵魂乐",
  "The Clash": "朋克摇滚",
  "Kendrick Lamar": "嘻哈",
  "Marvin Gaye": "灵魂乐",
  "Weather Report": "融合爵士",
  Mogwai: "后摇滚",
  "Joe Satriani": "器乐摇滚",
  "Jean-Michel Jarre": "电子",
  "Miles Davis": "爵士",
  "John Coltrane": "爵士",
  "Philip Glass": "极简音乐",
  "Explosions in the Sky": "后摇滚",
  Autechre: "电子",
  "Steve Reich and Musicians": "极简音乐",
  "Trent Reznor & Atticus Ross": "电影原声",
  "Animals as Leaders": "前卫金属",
  "The Dave Brubeck Quartet": "爵士",
  "Daft Punk": "电子",
  "Tangerine Dream": "电子",
  Vangelis: "电影原声",
  "Tim Hecker": "氛围电子",
  "Jóhann Jóhannsson": "电影原声",
};
export function mainGenre(a: Anchor & { mainGenre?: string }) {
  return a.mainGenre || artistGenres[a.artist] || "风格待确认";
}
