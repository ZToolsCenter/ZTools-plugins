/**
 * Teaven Identity SDK Taro 请求适配器
 */
/**
 * 创建 Taro 请求适配器
 */
export function createTaroRequestAdapter(taro) {
    return async (input) => {
        return new Promise((resolve, reject) => {
            taro.request({
                url: input.url,
                method: input.method,
                header: input.headers ?? {},
                data: input.body,
                success: (result) => {
                    let body = result.data;
                    if (typeof body === "string") {
                        try {
                            body = JSON.parse(body);
                        }
                        catch {
                            // 保持字符串
                        }
                    }
                    resolve({
                        status: result.statusCode,
                        headers: result.header ?? {},
                        body,
                    });
                },
                fail: (error) => {
                    reject(error);
                },
            });
        });
    };
}
