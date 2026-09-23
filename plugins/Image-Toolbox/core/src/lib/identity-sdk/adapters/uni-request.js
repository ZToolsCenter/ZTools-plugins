/**
 * Teaven Identity SDK uni-app 请求适配器
 */
/**
 * 创建 uni-app 请求适配器
 */
export function createUniRequestAdapter(uni) {
    return async (input) => {
        return new Promise((resolve, reject) => {
            uni.request({
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
