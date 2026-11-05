/**
 * 分类图标资源（PNG）
 *
 * 素材：共享图标库 `_shared/clipboard-icons/glyphs/color`（2026-10-09 重切 v2）。
 * 现在**全线只用透明底彩色字形**，不再用带底板的 `cards/` 版本 —— 卡片版底板不透光，
 * 深色主题下会变成一块刺眼的亮白方块（实拍确认：8 个图标像 8 个发光按钮，比正文还抢眼）。
 *
 * v2 素材的三个特点，决定了下面这套用法：
 *
 * 1. **统一 128×128 画布、字形居中、光学尺寸一致**
 *    → 宽高比都是 1:1，塞进正方形容器不会被拉变形（不像上一版紧裁素材那样
 *      必须靠 object-fit: contain 救，水滴才不会变椭圆）。
 *    → 但字形只占画布的 63%~81%（实测量得，留白用于对齐视觉重心），也就是
 *      **同样的容器尺寸下字形看着比旧紧裁版小一圈**，图标位要相应放大（见 CAT_ICONS）。
 * 2. **自带 32/48/64 预缩版**（LANCZOS 预缩，比浏览器从 128 直接缩更锐利）
 *    → 小图标位（20px）用 `64/` 版，覆盖到 DPR 2.5；
 *    → 大图标位（≥40px）用 128 原图，DPR 2 下也不虚。
 * 3. **颜色写死在图里** → 选中态不能靠"图标变色"，由整行背景高亮承担。
 *
 * 为什么用图片而不是像最早那样内联 SVG path：
 * 这些字形是**彩色渐变**（如「全部」是 #6366F1→#A855F7），
 * 用 SVG 画要给每个图形挂 <linearGradient>，光色标定义就比整个图标集还长。
 *
 * ⚠️ Node 单测里 import 这些 .png，会被 design/ts-hooks.mjs 的 load 钩子
 * 换成路径字符串，因此测试可以断言"某个分类指向的是哪张素材"。
 */
import g64All from '../assets/icons/glyphs/64/all.png'
import g64Text from '../assets/icons/glyphs/64/text.png'
import g64Link from '../assets/icons/glyphs/64/link.png'
import g64Code from '../assets/icons/glyphs/64/code.png'
import g64Color from '../assets/icons/glyphs/64/color.png'
import g64Image from '../assets/icons/glyphs/64/image.png'
import g64File from '../assets/icons/glyphs/64/file.png'
import g64Fav from '../assets/icons/glyphs/64/fav.png'
import gAll from '../assets/icons/glyphs/all.png'
import gText from '../assets/icons/glyphs/text.png'
import gLink from '../assets/icons/glyphs/link.png'
import gCode from '../assets/icons/glyphs/code.png'
import gColor from '../assets/icons/glyphs/color.png'
import gImage from '../assets/icons/glyphs/image.png'
import gFile from '../assets/icons/glyphs/file.png'
import gFav from '../assets/icons/glyphs/fav.png'

/**
 * 常规图标位（显示 20px；64px 素材，DPR 2 下也够用）。
 * 素材文件名 → 分类 key：`fav`（收藏）对应内部的 `star`。
 */
export const CAT_ICONS = {
  all: g64All,
  text: g64Text,
  link: g64Link,
  code: g64Code,
  color: g64Color,
  image: g64Image,
  file: g64File,
  /** 素材文件名是 fav.png（收藏） */
  star: g64Fav
} as const

/** 大图标位（显示 ≥40px，如空状态、图片加载失败占位）：用 128px 原图 */
export const CAT_ICONS_LG = {
  all: gAll,
  text: gText,
  link: gLink,
  code: gCode,
  color: gColor,
  image: gImage,
  file: gFile,
  star: gFav
} as const
