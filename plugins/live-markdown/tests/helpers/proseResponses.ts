export interface ProseInput {
  protocol: string;
  batchId: string;
  slots: Array<{ id: string; text: string }>;
}

/** A fake provider at the public request boundary; expectations stay in each test. */
export function proseResponse(prompt: string, transform: (text: string) => string = text => text): string {
  const marker = "【待编辑文本槽】\n";
  const index = prompt.indexOf(marker);
  if (index < 0) throw new Error("Expected a prose-slot request");
  const input: ProseInput = JSON.parse(prompt.slice(index + marker.length));
  return JSON.stringify({
    protocol: input.protocol, batchId: input.batchId,
    edits: input.slots.map(({ id, text }) => {
      const result = transform(text);
      return result === text ? { id, status: "unchanged" } : { id, status: "replace", text: result };
    })
  });
}

