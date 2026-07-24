/**
 * 颜色收藏管理工具
 *
 * 数据库由 databases.ts 统一初始化并注入到 useDatabaseStore。
 * 本模块通过 useDatabaseStore().getDb() 读取数据库实例。
 *
 * 支持两种颜色类型：
 *   - HexColor：纯色，存储 hex 值
 *   - LinearGradient：线性渐变，存储方向 + 色标
 */

import { defineStore } from "pinia";
import { computed, ref, watch, nextTick } from "vue";
import type { DatabaseBuilderEntry } from "./databases";
import { createDatabase } from "./database";
import { useDatabaseStore } from "./database-store";

// ── 类型定义 ──

/** 渐变色标 */
export interface GradientStop {
  /** hex 颜色值，如 "#FF0000" */
  color: string;
  /** 位置百分比 0-100，可选（不填则自动均匀分布） */
  position?: number;
}

/** 纯色 */
export interface HexColor {
  type: "hex";
  hex: string;
}

/** 线性渐变 */
export interface LinearGradient {
  type: "linear-gradient";
  /** CSS 方向，如 "to right"、"135deg" */
  direction: string;
  /** 色标列表，至少 2 个 */
  stops: GradientStop[];
}

/** 收藏条目 */
export interface ColorFavorite {
  id: string;
  color: HexColor | LinearGradient;
  tags: string[];
  createdAt: number;
}

// ── 颜色辅助函数 ──

/** 将 HexColor | LinearGradient 转为 CSS 字符串（可用于 style 绑定） */
export function colorToCSS(color: HexColor | LinearGradient): string {
  if (color.type === "hex") return color.hex;
  const stopsStr = color.stops
    .map((s) => (s.position != null ? `${s.color} ${s.position}%` : s.color))
    .join(", ");
  return `linear-gradient(${color.direction}, ${stopsStr})`;
}

/** 获取颜色的显示文本 */
export function colorToDisplay(color: HexColor | LinearGradient): string {
  if (color.type === "hex") return color.hex;
  return colorToCSS(color);
}

/** 判断两个颜色是否相同（基于 CSS 字符串比较） */
export function colorEquals(a: HexColor | LinearGradient, b: HexColor | LinearGradient): boolean {
  return colorToCSS(a) === colorToCSS(b);
}

/** 判断颜色值是否已存在于收藏列表中 */
function isDuplicate(favorites: ColorFavorite[], color: HexColor | LinearGradient): boolean {
  return favorites.some((f) => colorEquals(f.color, color));
}

// ── 数据库 ──

export const DB_NAME = "color-favorites";

/** 获取数据库实例（从 Pinia 注册中心读取） */
function useFavoriteDB() {
  return useDatabaseStore().getDB<{ data: ColorFavorite[] }>(DB_NAME);
}

export function createDB() {
  return createDatabase<{ data: ColorFavorite[] }>({
    id: DB_NAME,
    initialData: { data: [] },
    version: 1,
  }).patch(1, ({ db }) => {
    // v0 → v1：将旧的hex裸字符串颜色迁移为结构化 HexColor 对象
    const doc = db.getDoc();
    doc.data = (doc.data ?? []).map((item: any) => {
      if (typeof item.color === "string") {
        return { ...item, color: { type: "hex", hex: item.color } as HexColor };
      }
      return item;
    });
    db.saveDoc(doc);
  });
}

export const useFavorites = defineStore("color-favorites", () => {
  // ── 内部数据库操作 ──
  const db = useFavoriteDB();

  function loadDoc() {
    return db.getDoc();
  }

  async function saveDoc(doc: any) {
    try {
      const result = db.saveDoc(JSON.parse(JSON.stringify(doc)));
      if (result.ok) {
        doc._rev = result.rev;
        console.log("已保存收藏", doc);
      } else if (result.error) {
        console.error("保存收藏失败:", result.message);
        throw new Error("保存收藏失败:" + result.message);
      }
    } catch (error) {
      console.error("保存收藏失败:", error);
      throw new Error("保存收藏失败:" + error);
    }
  }

  // ── 状态 ──
  const doc = ref(loadDoc());
  const value = computed({
    get: () => doc.value.data,
    set: (value) => {
      doc.value.data = value;
    },
  });

  // 使用标志位防止递归更新
  let isSaving = false;

  watch(
    doc,
    async (newValue) => {
      if (isSaving) return;
      isSaving = true;
      try {
        await saveDoc(newValue);
      } finally {
        await nextTick();
        isSaving = false;
      }
    },
    { deep: true },
  );

  /** 添加收藏（纯色或渐变） */
  const addFavorite = (color: HexColor | LinearGradient, tags: string[] = []) => {
    if (isDuplicate(value.value, color)) {
      throw new Error("该颜色已在收藏中");
    }

    const newFavorite: ColorFavorite = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2),
      color,
      tags,
      createdAt: Date.now(),
    };

    value.value.unshift(newFavorite);
  };

  const removeFavorite = (id: string) => {
    value.value = value.value.filter((f) => f.id !== id);
  };

  /** 按颜色值移除收藏（纯色或渐变均可） */
  const removeColor = (color: HexColor | LinearGradient) => {
    value.value = value.value.filter((f) => !colorEquals(f.color, color));
  };

  const addTag = (id: string, tag: string) => {
    const favorite = value.value.find((f) => f.id === id);
    if (!favorite) {
      throw new Error("收藏不存在");
    }
    if (favorite.tags.includes(tag)) {
      throw new Error("该标签已存在");
    }

    favorite.tags.push(tag);
  };

  /** 按颜色值添加标签（纯色或渐变均可） */
  const addTagByColor = (color: HexColor | LinearGradient, tag: string) => {
    const favorite = value.value.find((f) => colorEquals(f.color, color));
    if (!favorite) {
      throw new Error("收藏不存在");
    }
    if (favorite.tags.includes(tag)) {
      throw new Error("该标签已存在");
    }

    favorite.tags.push(tag);
  };

  const getById = (id: string) => {
    return value.value.find((f) => f.id === id) || null;
  };

  const toggleTag = (id: string, tag: string) => {
    const favorite = getById(id);
    if (!favorite) {
      throw new Error("收藏不存在");
    }
    if (favorite.tags.includes(tag)) {
      favorite.tags = favorite.tags.filter((t) => t !== tag);
    } else {
      favorite.tags.push(tag);
    }
  };

  return {
    value,
    addFavorite,
    addColor: addFavorite,
    removeColor,
    removeFavorite,
    addTag,
    addTagByColor,
    getById,
    toggleTag,
  };
});

export const useAllTags = defineStore("all-tags", () => {
  const favorites = useFavorites();
  const value = computed((): string[] => {
    const tagSet = new Set<string>();
    favorites.value.forEach((favorite) => {
      favorite.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  });

  return {
    value,
  };
});

export const useTagFilter = defineStore("tag-filter", () => {
  const favorites = useFavorites();
  const selectedTags = ref<string[]>([]);

  const filteredFavorites = computed(() =>
    filterFavoritesByTags(favorites.value, selectedTags.value),
  );

  const add = (tag: string) => {
    if (selectedTags.value.includes(tag)) {
      throw new Error("该标签已存在");
    }
    selectedTags.value.push(tag);
  };

  const remove = (tag: string) => {
    selectedTags.value = selectedTags.value.filter((t) => t !== tag);
  };

  const clear = () => {
    selectedTags.value = [];
  };

  return {
    selectedTags,
    filteredFavorites,
    add,
    remove,
    clear,
  };
});

/**
 * 根据标签筛选收藏
 */
export function filterFavoritesByTags(
  favorites: ColorFavorite[],
  selectedTags: string[],
): ColorFavorite[] {
  if (selectedTags.length === 0) {
    return favorites;
  }

  return favorites.filter((favorite) => selectedTags.every((tag) => favorite.tags.includes(tag)));
}

export const useTagsEditing = defineStore("tags-editing", () => {
  const favorites = useFavorites();
  const favoriteId = ref<string | null>(null);
  const editingTags = computed(() => {
    return favoriteId.value ? (favorites.getById(favoriteId.value)?.tags ?? null) : [];
  });
  const isEditing = computed(() => favoriteId.value !== null);

  const startEditing = (id: string) => {
    favoriteId.value = id;
  };

  const color = computed(() => {
    return favoriteId.value ? (favorites.getById(favoriteId.value)?.color ?? null) : null;
  });

  const addTag = (tag: string) => {
    if (!favoriteId.value) {
      throw new Error("请选择要编辑的收藏");
    }
    favorites.addTag(favoriteId.value, tag);
  };

  const back = () => {
    favoriteId.value = null;
  };

  const toggleTag = (tag: string) => {
    if (!favoriteId.value) throw new Error("请选择要编辑的收藏");

    favorites.toggleTag(favoriteId.value, tag);
  };

  /**
   * 例如颜色被删除后，编辑器自动收起
   */
  watch(color, (color) => {
    if (color) {
      return;
    }

    favoriteId.value = null;
  });

  return {
    favoriteId,
    editingTags,
    isEditing,
    startEditing,
    color,
    addTag,
    back,
    toggleTag,
  };
});
export const DBBuilder: DatabaseBuilderEntry<any> = {
  name: DB_NAME,
  builder: createDB,
};
