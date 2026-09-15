// ZTools ccToggle - test-connection.ts
// 测试连接工具模块

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  apiFormat?: string;
  wireApi?: string;
  availableModels?: string[];
}

interface ModelsResult {
  success: boolean;
  models?: string[];
  error?: string;
}

export class ConnectionTester {
  static testConnection(baseUrl: string, apiKey: string, appType: string): Promise<TestResult> {
    return new Promise(function (resolve) {
      if (!baseUrl) {
        resolve({ success: false, error: '请输入 Base URL' });
        return;
      }
      const url = baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
      }

      if (appType === 'claude') {
        ConnectionTester.testAnthropicApi(url, apiKey, resolve);
      } else if (appType === 'gemini') {
        ConnectionTester.testGeminiApi(url, apiKey, resolve);
      } else {
        ConnectionTester.testOpenAiApi(url, headers, resolve);
      }
    });
  }

  static fetchAvailableModels(
    baseUrl: string,
    apiKey: string,
    appType: string
  ): Promise<ModelsResult> {
    return new Promise(function (resolve) {
      if (!baseUrl) {
        resolve({ success: false, error: '请输入 Base URL' });
        return;
      }
      const url = baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
      }

      if (appType === 'gemini') {
        const testUrl = url + '/v1beta/models?key=' + (apiKey || '');
        fetch(testUrl, { method: 'GET' })
          .then(function (response) {
            if (response.ok) {
              return response.json().then(function (data) {
                const models = data.models || [];
                const modelIds = models
                  .map(function (m) {
                    return m.name || '';
                  })
                  .filter(Boolean);
                resolve({ success: true, models: modelIds });
              });
            }
            resolve({ success: false, error: '获取模型失败：' + response.status });
          })
          .catch(function () {
            resolve({ success: false, error: '无法连接到 API' });
          });
      } else if (appType === 'claude') {
        resolve({
          success: true,
          models: [
            'claude-3-5-haiku-20241022',
            'claude-3-haiku-20240307',
            'claude-3-sonnet-20240229'
          ]
        });
      } else {
        const modelsUrl = url + '/models';
        fetch(modelsUrl, { method: 'GET', headers: headers })
          .then(function (response) {
            if (response.ok) {
              return response.json().then(function (data) {
                const models = data.data || data.models || [];
                const modelIds = models
                  .map(function (m) {
                    return m.id || m.model || '';
                  })
                  .filter(Boolean);
                resolve({ success: true, models: modelIds });
              });
            }
            resolve({ success: false, error: '获取模型失败：' + response.status });
          })
          .catch(function () {
            resolve({ success: false, error: '无法连接到 API' });
          });
      }
    });
  }

  private static testAnthropicApi(
    url: string,
    apiKey: string,
    callback: (result: TestResult) => void
  ): void {
    const paths = ['/v1/messages', '/messages', ''];
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey || '',
      'anthropic-version': '2023-06-01'
    };
    const models = [
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-3-sonnet-20240229'
    ];

    tryPath(0);

    function tryPath(pathIndex: number): void {
      if (pathIndex >= paths.length) {
        callback({ success: false, error: '无法连接到 Anthropic API，请检查 URL 和 API Key' });
        return;
      }
      const testUrl = url + paths[pathIndex];
      tryModel(0, testUrl, pathIndex);
    }

    function tryModel(modelIndex: number, testUrl: string, pathIndex: number): void {
      if (modelIndex >= models.length) {
        tryPath(pathIndex + 1);
        return;
      }
      const testBody = JSON.stringify({
        model: models[modelIndex],
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      fetch(testUrl, { method: 'POST', headers: headers, body: testBody })
        .then(function (response) {
          if (response.ok) {
            callback({
              success: true,
              apiFormat: 'anthropic',
              wireApi: 'responses',
              message: 'Anthropic API 连接成功'
            });
          } else if (response.status === 400) {
            tryModel(modelIndex + 1, testUrl, pathIndex);
          } else if (response.status === 404) {
            tryPath(pathIndex + 1);
          } else {
            callback({ success: false, error: '连接失败：' + response.status });
          }
        })
        .catch(function () {
          callback({ success: false, error: '无法连接到 Anthropic API' });
        });
    }
  }

  private static testGeminiApi(
    url: string,
    apiKey: string,
    callback: (result: TestResult) => void
  ): void {
    const testUrl = url + '/v1beta/models?key=' + (apiKey || '');
    fetch(testUrl, { method: 'GET' })
      .then(function (response) {
        if (response.ok) {
          return response.json().then(function (data) {
            const models = data.models || [];
            const modelIds = models
              .map(function (m) {
                return m.name || '';
              })
              .filter(Boolean);
            callback({
              success: true,
              message: 'Google Gemini API 连接成功',
              availableModels: modelIds
            });
          });
        } else {
          callback({ success: false, error: '连接失败：' + response.status });
        }
      })
      .catch(function () {
        callback({ success: false, error: '无法连接到 Google Gemini API' });
      });
  }

  private static testOpenAiApi(
    url: string,
    headers: Record<string, string>,
    callback: (result: TestResult) => void
  ): void {
    const modelsUrl = url + '/models';
    fetch(modelsUrl, { method: 'GET', headers: headers })
      .then(function (response) {
        if (response.ok) {
          return response.json().then(function (data) {
            const models = data.data || data.models || [];
            const modelIds = models
              .map(function (m) {
                return m.id || m.model || '';
              })
              .filter(Boolean);
            callback({
              success: true,
              apiFormat: 'openai_chat',
              wireApi: 'chat',
              message: '检测成功：OpenAI 兼容 API'
            });
          });
        }
        ConnectionTester.testResponsesEndpoint(url, headers, callback);
      })
      .catch(function () {
        ConnectionTester.testResponsesEndpoint(url, headers, callback);
      });
  }

  private static testResponsesEndpoint(
    url: string,
    headers: Record<string, string>,
    callback: (result: TestResult) => void
  ): void {
    const modelsUrl = url + '/models';
    fetch(modelsUrl, { method: 'GET', headers: headers })
      .then(function (response) {
        if (response.ok) {
          return response.json().then(function (data) {
            const models = data.data || data.models || [];
            const modelIds = models
              .map(function (m) {
                return m.id || m.model || '';
              })
              .filter(Boolean);
            callback({
              success: true,
              apiFormat: 'openai_responses',
              wireApi: 'responses',
              availableModels: modelIds,
              message: '检测成功：Responses 格式'
            });
          });
        }
        callback({ success: false, error: '无法连接到 API，请检查 URL 和 API Key' });
      })
      .catch(function () {
        callback({ success: false, error: '无法连接到 API，请检查 URL 和网络连接' });
      });
  }
}
