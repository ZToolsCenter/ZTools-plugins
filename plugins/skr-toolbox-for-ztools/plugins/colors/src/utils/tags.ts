// 为每个 tag 生成一致的纯色样式
export const getTagStyle = (tag: string): { bg: string; text: string; hover: string } => {
  // 根据 tag 名称生成一个哈希值，确保同一个 tag 始终有相同的颜色
  const hash = tag.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  // 定义多套精美的配色方案（背景色 + 文字色）
  const colorSchemes = [
    { bg: "bg-violet-100", text: "text-violet-700", hover: "hover:bg-violet-200" },
    { bg: "bg-blue-100", text: "text-blue-700", hover: "hover:bg-blue-200" },
    { bg: "bg-emerald-100", text: "text-emerald-700", hover: "hover:bg-emerald-200" },
    { bg: "bg-orange-100", text: "text-orange-700", hover: "hover:bg-orange-200" },
    { bg: "bg-rose-100", text: "text-rose-700", hover: "hover:bg-rose-200" },
    { bg: "bg-indigo-100", text: "text-indigo-700", hover: "hover:bg-indigo-200" },
    { bg: "bg-fuchsia-100", text: "text-fuchsia-700", hover: "hover:bg-fuchsia-200" },
    { bg: "bg-cyan-100", text: "text-cyan-700", hover: "hover:bg-cyan-200" },
    { bg: "bg-amber-100", text: "text-amber-700", hover: "hover:bg-amber-200" },
    { bg: "bg-lime-100", text: "text-lime-700", hover: "hover:bg-lime-200" },
    { bg: "bg-pink-100", text: "text-pink-700", hover: "hover:bg-pink-200" },
    { bg: "bg-teal-100", text: "text-teal-700", hover: "hover:bg-teal-200" },
  ];

  // 使用哈希值选择配色（取绝对值后取模）
  const index = Math.abs(hash) % colorSchemes.length;

  return colorSchemes[index]!;
};
