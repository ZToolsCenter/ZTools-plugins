import type { EnglishAgreementWorkerRequest, EnglishAgreementWorkerResponse } from "./englishAgreementWorkerProtocol";
import { analyzeEnglishAgreementWithWink } from "./englishAgreementWink";

interface EnglishAgreementWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<EnglishAgreementWorkerRequest>) => void): void;
  postMessage(message: EnglishAgreementWorkerResponse): void;
}

const workerScope = self as unknown as EnglishAgreementWorkerScope;

workerScope.addEventListener("message", (event: MessageEvent<EnglishAgreementWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "analyze" || !Number.isSafeInteger(request.id)) return;
  try {
    const response: EnglishAgreementWorkerResponse = {
      type: "result",
      id: request.id,
      analysis: analyzeEnglishAgreementWithWink(request.input)
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: EnglishAgreementWorkerResponse = {
      type: "failure",
      id: request.id,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: "English agreement analysis failed." }
    };
    workerScope.postMessage(response);
  }
});
