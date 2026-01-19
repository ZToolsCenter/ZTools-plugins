import type { SongType } from "@/types/main";
import { fuzzySearch } from "@/utils/helper";
import { debounce } from "lodash-es";

/**
 * 列表搜索逻辑
 */
export const useListSearch = (listData: Ref<SongType[]>) => {
  const searchValue = ref<string>("");
  const searchData = ref<SongType[]>([]);

  /**
   * 清除搜索
   */
  const clearSearch = () => {
    searchValue.value = "";
    searchData.value = [];
  };

  /**
   * 执行搜索
   */
  const performSearch = debounce((val: string) => {
    val = val.trim();
    if (!val || val === "") {
      searchData.value = [];
      return;
    }
    const result = fuzzySearch(val, listData.value);
    searchData.value = result;
  }, 300);

  /**
   * 获取显示的数据
   */
  const displayData = computed(() => {
    return searchValue.value ? searchData.value : listData.value;
  });

  return {
    searchValue,
    searchData,
    displayData,
    clearSearch,
    performSearch,
  };
};
