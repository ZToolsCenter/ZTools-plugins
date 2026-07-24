import { shallowRef } from "vue";
import { buildEverythingQuery } from "../core/finderLogic";
import { useFinderCategories } from "./useFinderCategories";

const queryText = shallowRef("");

export function useFinderQuery() {
  const { activeCategory } = useFinderCategories();

  function setQueryText(text: string) {
    queryText.value = text;
  }

  function buildFilteredEverythingQuery() {
    return buildEverythingQuery(queryText.value, activeCategory.value);
  }

  return {
    queryText,
    setQueryText,
    buildFilteredEverythingQuery,
  };
}
