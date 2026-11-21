export interface EmojiEntry {
  shortcode: string;
  emoji: string;
  keywords: string[];
}

export const EMOJI_DICTIONARY: EmojiEntry[] = [
  { shortcode: "smile", emoji: "😄", keywords: ["happy", "joy", "laugh"] },
  { shortcode: "grin", emoji: "😁", keywords: ["smile", "happy"] },
  { shortcode: "joy", emoji: "😂", keywords: ["tears", "laugh"] },
  { shortcode: "wink", emoji: "😉", keywords: ["flirt", "smile"] },
  { shortcode: "blush", emoji: "😊", keywords: ["warm", "smile"] },
  { shortcode: "thinking", emoji: "🤔", keywords: ["hmm", "idea", "ponder"] },
  { shortcode: "sunglasses", emoji: "😎", keywords: ["cool", "chill"] },
  { shortcode: "partying", emoji: "🥳", keywords: ["celebrate", "party"] },
  { shortcode: "rocket", emoji: "🚀", keywords: ["launch", "ship", "fast"] },
  { shortcode: "sparkles", emoji: "✨", keywords: ["magic", "new", "shine"] },
  { shortcode: "tada", emoji: "🎉", keywords: ["party", "congrats", "celebrate"] },
  { shortcode: "fire", emoji: "🔥", keywords: ["hot", "lit", "trend"] },
  { shortcode: "zap", emoji: "⚡", keywords: ["lightning", "fast", "power"] },
  { shortcode: "bulb", emoji: "💡", keywords: ["idea", "tip", "light"] },
  { shortcode: "warning", emoji: "⚠️", keywords: ["alert", "caution", "danger"] },
  { shortcode: "check", emoji: "✅", keywords: ["done", "success", "yes"] },
  { shortcode: "white_check_mark", emoji: "✅", keywords: ["done", "pass"] },
  { shortcode: "x", emoji: "❌", keywords: ["error", "fail", "no", "close"] },
  { shortcode: "question", emoji: "❓", keywords: ["help", "ask", "doubt"] },
  { shortcode: "exclamation", emoji: "❗", keywords: ["important", "bang"] },
  { shortcode: "heart", emoji: "❤️", keywords: ["love", "like"] },
  { shortcode: "star", emoji: "⭐", keywords: ["favorite", "rating"] },
  { shortcode: "star2", emoji: "🌟", keywords: ["glow", "shine"] },
  { shortcode: "thumbsup", emoji: "👍", keywords: ["like", "approve", "+1"] },
  { shortcode: "+1", emoji: "👍", keywords: ["thumbsup", "approve"] },
  { shortcode: "thumbsdown", emoji: "👎", keywords: ["dislike", "-1"] },
  { shortcode: "clap", emoji: "👏", keywords: ["applause", "praise"] },
  { shortcode: "pray", emoji: "🙏", keywords: ["thanks", "please"] },
  { shortcode: "wave", emoji: "👋", keywords: ["hello", "hi", "bye"] },
  { shortcode: "eyes", emoji: "👀", keywords: ["look", "watch", "review"] },
  { shortcode: "memo", emoji: "📝", keywords: ["note", "write", "doc"] },
  { shortcode: "book", emoji: "📖", keywords: ["read", "manual", "docs"] },
  { shortcode: "books", emoji: "📚", keywords: ["library", "study"] },
  { shortcode: "bookmark", emoji: "🔖", keywords: ["tag", "save"] },
  { shortcode: "pushpin", emoji: "📌", keywords: ["pin", "top"] },
  { shortcode: "link", emoji: "🔗", keywords: ["url", "href"] },
  { shortcode: "paperclip", emoji: "📎", keywords: ["attachment", "file"] },
  { shortcode: "folder", emoji: "📁", keywords: ["directory", "files"] },
  { shortcode: "page_facing_up", emoji: "📄", keywords: ["file", "document"] },
  { shortcode: "calendar", emoji: "📅", keywords: ["date", "schedule"] },
  { shortcode: "clock", emoji: "🕒", keywords: ["time", "wait"] },
  { shortcode: "hourglass", emoji: "⏳", keywords: ["timer", "pending"] },
  { shortcode: "Bell", emoji: "🔔", keywords: ["notify", "reminder"] },
  { shortcode: "bell", emoji: "🔔", keywords: ["notification", "alarm"] },
  { shortcode: "lock", emoji: "🔒", keywords: ["security", "private"] },
  { shortcode: "unlock", emoji: "🔓", keywords: ["open", "public"] },
  { shortcode: "key", emoji: "🔑", keywords: ["auth", "token", "secret"] },
  { shortcode: "mag", emoji: "🔍", keywords: ["search", "find", "zoom"] },
  { shortcode: "gear", emoji: "⚙️", keywords: ["settings", "config"] },
  { shortcode: "wrench", emoji: "🔧", keywords: ["tool", "fix"] },
  { shortcode: "hammer", emoji: "🔨", keywords: ["build", "construct"] },
  { shortcode: "bug", emoji: "🐛", keywords: ["issue", "debug", "fix"] },
  { shortcode: "package", emoji: "📦", keywords: ["box", "bundle", "npm"] },
  { shortcode: "computer", emoji: "💻", keywords: ["laptop", "code", "mac"] },
  { shortcode: "keyboard", emoji: "⌨️", keywords: ["type", "input"] },
  { shortcode: "chart_with_upwards_trend", emoji: "📈", keywords: ["growth", "stats"] },
  { shortcode: "bar_chart", emoji: "📊", keywords: ["analytics", "metrics"] },
  { shortcode: "art", emoji: "🎨", keywords: ["design", "theme", "palette"] },
  { shortcode: "trophy", emoji: "🏆", keywords: ["win", "award", "champion"] },
  { shortcode: "medal", emoji: "🏅", keywords: ["gold", "prize"] },
  { shortcode: "target", emoji: "🎯", keywords: ["goal", "focus", "bullseye"] },
  { shortcode: "coffee", emoji: "☕", keywords: ["break", "cafe", "tea"] },
  { shortcode: "apple", emoji: "🍎", keywords: ["fruit", "mac"] },
  { shortcode: "Sunny", emoji: "☀️", keywords: ["weather", "bright"] },
  { shortcode: "sunny", emoji: "☀️", keywords: ["sun", "light"] },
  { shortcode: "cloud", emoji: "☁️", keywords: ["sky", "server"] },
  { shortcode: "rainbow", emoji: "🌈", keywords: ["color", "hope"] },
  { shortcode: "globe_with_meridians", emoji: "🌐", keywords: ["web", "world", "i18n"] },
  { shortcode: "construction", emoji: "🚧", keywords: ["wip", "work"] },
  { shortcode: "recycle", emoji: "♻️", keywords: ["refactor", "clean"] },
  { shortcode: "Info", emoji: "ℹ️", keywords: ["information", "note"] },
  { shortcode: "info", emoji: "ℹ️", keywords: ["information", "help"] }
];

const EMOJI_MAP = new Map<string, string>(
  EMOJI_DICTIONARY.map((entry) => [entry.shortcode.toLowerCase(), entry.emoji])
);

export function resolveEmojiShortcode(shortcode: string): string | null {
  const key = String(shortcode || "")
    .replace(/^:|:$/g, "")
    .trim()
    .toLowerCase();
  return EMOJI_MAP.get(key) || null;
}

export function searchEmojiShortcodes(query: string, limit = 8): EmojiEntry[] {
  const q = String(query || "")
    .replace(/^:/, "")
    .trim()
    .toLowerCase();
  if (!q) {
    return EMOJI_DICTIONARY.slice(0, limit);
  }
  const startsWithMatches: EmojiEntry[] = [];
  const keywordMatches: EmojiEntry[] = [];

  for (const item of EMOJI_DICTIONARY) {
    const code = item.shortcode.toLowerCase();
    if (code.startsWith(q)) {
      startsWithMatches.push(item);
    } else if (
      code.includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q))
    ) {
      keywordMatches.push(item);
    }
  }

  return [...startsWithMatches, ...keywordMatches].slice(0, limit);
}
