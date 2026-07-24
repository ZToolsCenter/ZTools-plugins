import { ref } from 'vue'
import { usePromptStore } from './prompt'

/** 路由状态 */
const currentView = ref<'space' | 'wizard' | 'compose' | 'manage' | 'quick-save' | 'settings'>('space')
const wizardPrefillTitle = ref('')
const wizardProjectId = ref('')
const quickSaveContent = ref('')
const quickSaveSource = ref<string>('manual')
const quickSaveProjectId = ref('')
const manageEditId = ref('') // 管理视图中要编辑的提示词 ID

export function useRouter() {
  function navigateTo(view: 'space' | 'wizard' | 'compose' | 'manage' | 'quick-save' | 'settings') {
    const prompt = usePromptStore()
    prompt.resetSelection()
    currentView.value = view
  }

  function navigateToManage(editId = '') {
    manageEditId.value = editId
    currentView.value = 'manage'
  }

  function enterWizard(prefillTitle = '', projectId = '') {
    wizardPrefillTitle.value = prefillTitle
    wizardProjectId.value = projectId
    currentView.value = 'wizard'
  }

  function consumeWizardPrefill() {
    const val = wizardPrefillTitle.value
    wizardPrefillTitle.value = ''
    return val
  }

  function consumeWizardProjectId() {
    const val = wizardProjectId.value
    wizardProjectId.value = ''
    return val
  }

  function enterQuickSave(content: string, source: string, projectId = '') {
    quickSaveContent.value = content
    quickSaveSource.value = source
    quickSaveProjectId.value = projectId
    currentView.value = 'quick-save'
  }

  function consumeManageEditId() {
    const val = manageEditId.value
    manageEditId.value = ''
    return val
  }

  return {
    currentView,
    wizardPrefillTitle,
    wizardProjectId,
    quickSaveContent,
    quickSaveSource,
    quickSaveProjectId,
    manageEditId,
    navigateTo,
    navigateToManage,
    enterWizard,
    consumeWizardPrefill,
    consumeWizardProjectId,
    enterQuickSave,
    consumeManageEditId,
  }
}
