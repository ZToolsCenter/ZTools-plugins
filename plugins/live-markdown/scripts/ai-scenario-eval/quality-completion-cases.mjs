import { refinementCases } from "./quality-refinement-cases.mjs";

// Preserve the existing 44 requests and all B35 boundary instructions/expectations.
// Topic variants are development regression examples, not claimed as unseen holdouts.
export const completionVariants = [
  {
    "id": "B35-HOLD-CORRECT",
    "family": "b35-preserved-boundary",
    "instruction": "润色正文，已经正确的句子必须保持原样，不作同义词替换。",
    "source": "The release has 3 stages, and each stage needs approval.",
    "selection": null,
    "cursor": null,
    "entryAction": "polish",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "no_op",
      "semanticReview": true,
      "facts": [
        "exact original correct sentence"
      ]
    },
    "live": true,
    "livePriority": 300
  },
  {
    "id": "B35-HOLD-MIGRATION",
    "family": "b35-preserved-boundary",
    "instruction": "润色正文，纠正语法，保留数字，不添加事实。",
    "source": "The migration have 6 checkpoints, and each checkpoint need evidence.",
    "selection": null,
    "cursor": null,
    "entryAction": "polish",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "replace",
      "target": "document",
      "semanticReview": true,
      "facts": [
        "migration has",
        "checkpoint needs",
        "6 original"
      ]
    },
    "live": true,
    "livePriority": 301
  },
  {
    "id": "B35-HOLD-LINK",
    "family": "b35-preserved-boundary",
    "instruction": "润色正文，纠正明确语法错误，保留链接目标和格式。",
    "source": "These [checklists](https://internal.invalid/checks) requires approval.",
    "selection": null,
    "cursor": null,
    "entryAction": "polish",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "replace",
      "target": "document",
      "semanticReview": true,
      "facts": [
        "checklists require approval",
        "URL intact"
      ]
    },
    "live": true,
    "livePriority": 302
  },
  {
    "id": "B35-HOLD-ZH",
    "family": "b35-preserved-boundary",
    "instruction": "润色正文使其简洁，不改变日期和负责人。",
    "source": "由林安负责的排期日期是2026-11-03，请请大家进行确认。",
    "selection": null,
    "cursor": null,
    "entryAction": "polish",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "replace",
      "target": "document",
      "semanticReview": true,
      "facts": [
        "林安 original",
        "2026-11-03 original",
        "remove 请请 redundancy"
      ]
    },
    "live": true,
    "livePriority": 303
  },
  {
    "id": "B36-HO-DB-RECOVERY",
    "family": "b36-topic-variants",
    "instruction": "在文末写一份数据库恢复演练建议，按顺序用小标题 Objective、Steps、Risks 组织。每个步骤给出可执行动作和可观察的检查结果，每项风险说明可能触发条件与响应。没有提供数据库产品、备份状态或 RPO/RTO 数值，不要自行假设；写成建议，不要声称演练已经完成。",
    "source": "# Notes\n\nPRIVATE_SOURCE is unchanged.",
    "selection": null,
    "cursor": null,
    "entryAction": "command",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "insert",
      "target": "document_end",
      "unchangedOutside": true,
      "semanticReview": true,
      "patch": {
        "from": 37,
        "to": 37,
        "expectedText": ""
      },
      "artifact": {
        "type": "headings",
        "headings": [
          {
            "text": "Objective",
            "level": 2
          },
          {
            "text": "Steps",
            "level": 2
          },
          {
            "text": "Risks",
            "level": 2
          }
        ]
      },
      "facts": [
        "specific requested topic",
        "executable actions and observable checks",
        "concrete risk condition and response",
        "no invented database product, volume, deadline or completed event"
      ]
    },
    "live": true,
    "livePriority": 400
  },
  {
    "id": "B36-HO-MIGRATION-ACCEPTANCE",
    "family": "b36-topic-variants",
    "instruction": "在文末写一份数据库迁移验收草案，按顺序用小标题 目标、验收标准、步骤、风险 组织。验收标准需要可验证；每个步骤说明执行动作和检查点；每个风险说明触发条件与应对。没有提供源/目标数据库、数据规模、维护窗口或已完成的测试结果，不要虚构；不得把建议写成已经完成的迁移或验收。",
    "source": "# Notes\n\nPRIVATE_SOURCE is unchanged.",
    "selection": null,
    "cursor": null,
    "entryAction": "command",
    "skill": null,
    "preconditions": null,
    "expected": {
      "effect": "insert",
      "target": "document_end",
      "unchangedOutside": true,
      "semanticReview": true,
      "patch": {
        "from": 37,
        "to": 37,
        "expectedText": ""
      },
      "artifact": {
        "type": "headings",
        "headings": [
          {
            "text": "目标",
            "level": 2
          },
          {
            "text": "验收标准",
            "level": 2
          },
          {
            "text": "步骤",
            "level": 2
          },
          {
            "text": "风险",
            "level": 2
          }
        ]
      },
      "facts": [
        "specific requested topic",
        "executable actions and observable checks",
        "concrete risk condition and response",
        "no invented database product, volume, deadline or completed event"
      ]
    },
    "live": true,
    "livePriority": 401
  }
];
export const completionCases = [...refinementCases, ...completionVariants];
export const completionMatrixSummary = Object.freeze({baselineCaseCount: refinementCases.length, addedCaseCount: completionVariants.length, caseCount: completionCases.length, liveCaseCount: completionCases.length, liveCaseIds: completionCases.map(c=>c.id)});
