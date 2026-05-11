import { useTabStore } from "@/store/useTabStore";

/**
 * Utools 事件监听器管理
 *
 * 这个类负责管理 utools 插件的监听事件，
 * 包括插件进入时的数据处理。
 */
class UtoolsListener {
  private static instance: UtoolsListener;
  private isInitialized: boolean = false;
  private editorRefs: Record<string, any> = {};

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): UtoolsListener {
    if (!UtoolsListener.instance) {
      UtoolsListener.instance = new UtoolsListener();
    }

    return UtoolsListener.instance;
  }

  /**
   * 设置编辑器引用
   */
  public setEditorRefs(editorRefs: Record<string, any>): void {
    this.editorRefs = editorRefs;
  }

  /**
   * 初始化监听器
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    if (typeof window !== "undefined" && (window as any).utools) {
      (window as any).utools.onPluginEnter((data: any) => {
        this.handlePluginEnter(data);
      });
      this.isInitialized = true;
      console.log("Utools 监听器已初始化");
    }
  }

  /**
   * 处理插件进入事件
   */
  private handlePluginEnter(data: any): void {
    try {
      console.log("Utools 插件进入事件:", data);
      if (data.type === "regex" && data.payload != "") {
        const tabStore = useTabStore.getState();
        const { addTab, activeTab, updateTabContent } = tabStore;

        setTimeout(() => {
          const curTab = activeTab();

          // 当前tab1 且 nextKey 为 2 且tab1内容为空
          if (
            curTab &&
            curTab.key === "1" &&
            tabStore.nextKey === 2 &&
            curTab.content.trim() === ""
          ) {
            // 更新现有标签页内容
            updateTabContent(curTab.key, data.payload);

            // 调用编辑器的 updateValue 方法更新编辑器内容
            const editorRef = this.editorRefs[curTab.key];

            if (editorRef && editorRef.updateValue) {
              editorRef.updateValue(data.payload);
              setTimeout(() => {
                editorRef.format();
              }, 300);
            }
            console.log("Utools 数据已更新到 tab1:", data.payload);
          } else {
            addTab(undefined, data.payload);
            console.log("Utools 已创建新标签页:", data.payload);
          }
        }, 100);
      }
    } catch (error) {
      console.error("处理 Utools 插件进入事件时发生错误:", error);
    }
  }

  /**
   * 检查是否已初始化
   */
  public isListenerInitialized(): boolean {
    return this.isInitialized;
  }
}

export default UtoolsListener;
export { UtoolsListener };
