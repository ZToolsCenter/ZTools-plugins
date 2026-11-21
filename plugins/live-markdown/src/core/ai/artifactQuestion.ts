const ARTIFACT_QUESTION = /^(?:(?:请问|告诉我|说明一下|explain\s+)?\s*)?(?:如何|怎么(?:样)?|怎样|how\s+(?:do|can|should|to)\b|what\s+(?:is|does)\b)[^\r\n]*$/iu;
const ASKED_USAGE = /(?:使用方法|怎么(?:用|写|做)|如何(?:用|写|做)|(?:的)?(?:定义|含义|用法|方法|技巧|标准|作用|是什么)|how\s+(?:to\s+use|do\s+you\s+use)|what\s+(?:is|does)|(?:methods?|tips?)\s+(?:for|to))/iu;

/** Discussing how to create an artifact does not itself request that artifact. */
export function isArtifactUsageQuestion(masked: string): boolean {
  return ARTIFACT_QUESTION.test(masked.trim()) || ASKED_USAGE.test(masked);
}
