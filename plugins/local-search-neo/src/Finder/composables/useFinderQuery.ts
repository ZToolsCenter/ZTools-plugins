import { ref } from "vue";
import { buildEverythingQuery } from "../core/finderLogic";
import { useFinderCategories } from "./useFinderCategories";

const queryText = ref("");
const prefixFilter = ref("");

export function useFinderQuery() {
  const { activeCategory } = useFinderCategories();

  function setQueryText(text: string) {
    queryText.value = text;
  }

  function buildFilteredEverythingQuery() {
    return buildEverythingQuery(queryText.value, activeCategory.value, prefixFilter.value);
  }

  return {
    prefixFilter,
    queryText,
    setQueryText,
    buildFilteredEverythingQuery,
  };
}
