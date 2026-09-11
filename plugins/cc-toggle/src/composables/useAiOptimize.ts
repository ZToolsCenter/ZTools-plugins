// composables/useAiOptimize.ts
import { ref } from 'vue';

const SYSTEM_PROMPT = `你是一个专业的 AI Prompt 工程师。你的任务是优化用户提供的提示词。

优化规则：
1. 保持原始意图和核心要求不变
2. 提升表达的清晰度和精确度
3. 增加适当的结构化（如分点、分段）
4. 补充必要的约束条件或上下文
5. 去除冗余内容，使语言更精炼
6. 如果原始提示词已经足够好，只做微调

直接输出优化后的提示词内容，不要添加任何解释或前缀。`;

export function useAiOptimize() {
  const streaming = ref(false);
  const error = ref<string | null>(null);
  let abortFn: (() => void) | null = null;

  function optimize(content: string, onChunk: (text: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!content.trim()) {
        reject(new Error('内容为空'));
        return;
      }

      // 检查 ztools.ai 是否可用
      if (typeof ztools === 'undefined' || typeof ztools.ai !== 'function') {
        reject(new Error('当前环境不支持 AI 功能'));
        return;
      }

      streaming.value = true;
      error.value = null;

      let fullText = '';

      const userMsg = '```\n' + content + '\n```';

      const promiseLike = ztools.ai(
        {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg }
          ]
        },
        chunk => {
          const delta = chunk.content || '';
          if (delta) {
            fullText += delta;
            onChunk(fullText);
          }
        }
      );

      abortFn = () => {
        promiseLike.abort();
        streaming.value = false;
        reject(new Error('已中止'));
      };

      promiseLike.then(
        () => {
          streaming.value = false;
          abortFn = null;
          resolve(fullText);
        },
        (err: any) => {
          streaming.value = false;
          abortFn = null;
          const msg = err?.message || 'AI 调用失败';
          error.value = msg;
          reject(new Error(msg));
        }
      );
    });
  }

  function abort(): void {
    abortFn?.();
  }

  return { streaming, error, optimize, abort };
}
