import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core/blocks";
import { createHeadingBlockSpec } from "@blocknote/core";
import { calloutBlock } from "@/components/editor/blocks/callout/calloutBlock";
import { customFileBlock } from "../blocks/file/customFileBlock";
import { customImageBlock } from "../blocks/image/customImageBlock";
import { customVideoBlock } from "../blocks/video/videoBlock";
import { codeBlockSpec } from "@/components/editor/blocks/code/codeBlockSpec";
import { gooseEditorStyleSpecs } from "@/components/editor/inline-code/InlineCodeComponent";

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    heading: createHeadingBlockSpec({
      levels: [1, 2, 3],
      // 必须开启:否则 heading propSchema 不含 isToggleable 字段、render 不挂折叠箭头,
      // 导致斜杠菜单「折叠标题」与行首 `> ` 输入规则全部失效(转换被静默丢弃)。
      allowToggleHeadings: true,
    }),
    callout: calloutBlock,
    image: customImageBlock,
    video: customVideoBlock,
    file: customFileBlock,
    codeBlock: codeBlockSpec,
  },
  styleSpecs: gooseEditorStyleSpecs,
});
