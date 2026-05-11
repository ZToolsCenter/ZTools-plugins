import { ref } from 'vue';

const pageActions = ref(null);

export function usePageActions() {
  const setActions = (actions) => {
    pageActions.value = actions;
  };

  const clearActions = () => {
    pageActions.value = null;
  };

  return {
    pageActions,
    setActions,
    clearActions,
  };
}
