"use strict";

function requestScreenCapture(ztools) {
  if (typeof ztools?.screenCapture !== "function") {
    return Promise.reject(Object.assign(new Error("请升级到 ZTools 3.2.0 以使用截图导入。"), { code: "SCREEN_CAPTURE_UNAVAILABLE" }));
  }
  return new Promise((resolve, reject) => {
    try {
      // ZTools 3.2 uses the second argument to enter the editable capture flow.
      // Older hosts ignore the extra JavaScript argument.
      const request = ztools.screenCapture((image, bounds) => resolve({ image, bounds }), false);
      if (request && typeof request.then === "function") Promise.resolve(request).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { requestScreenCapture };
