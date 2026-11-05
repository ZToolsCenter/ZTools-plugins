import { useI18n } from "../../app/i18n";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { pluginHost } from "../../lib/host";
import "../../app/ztools-layout.css";
import {
  ArrowDownToLine,
  BookOpen,
  FolderPlus,
  History,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  ListChecks,
} from "lucide-react";
import { useCall, shortHash } from "../../lib/ipc/client";
import type {
  Skill,
  SkillDocument,
  Revision,
  RunOperation,
  RevisionDiff,
} from "../../lib/ipc/types";
import { Markdown } from "../../components/Markdown";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { ContextMenu, useContextMenu } from "../../components/ContextMenu";
import {
  SelectionToolbar,
  useSelection,
} from "../../components/SelectionToolbar";
export function LibraryView({
  skills,
  busy,
  run,
  importLocal,
  install,
  checkUpdate,
  updated,
  remove,
  installSkills,
}: {
  skills: Skill[];
  busy: boolean;
  run: RunOperation;
  importLocal: () => void;
  install: (revision: Revision) => void;
  checkUpdate: (skill: Skill) => void;
  updated: (skill: Skill) => void;
  remove: (skills: Skill[]) => void;
  installSkills: (skills: Skill[]) => void;
}) {
  const { t, locale } = useI18n();
  const call = useCall();
  const inlineDetails = !!pluginHost();
  const layout = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [doc, setDoc] = useState<SkillDocument | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [diff, setDiff] = useState<RevisionDiff | null>(null);
  const [raw, setRaw] = useState(false);
  const [renaming, setRenaming] = useState<Skill | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const menu = useContextMenu<Skill>();
  const selection = useSelection();
  const chosen = skills.filter((skill) => selection.ids.includes(skill.id));
  function rename(skill: Skill) {
    setNameDraft(skill.displayName || "");
    setRenaming(skill);
  }
  const currentSkill = skills.find((s) => s.id === doc?.skill.id) || doc?.skill;
  const filtered = skills.filter((s) =>
    [s.name, s.displayName || "", s.description, s.source.url || ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  async function open(skill: Skill, revisionId = skill.latestRevisionId) {
    const data = await run(t("读取技能与版本"), async () => {
      const document = await call<SkillDocument>("get_document", {
        revisionId,
      });
      const versions = await call<Revision[]>("get_revisions", {
        skillId: skill.id,
      });
      return [document, versions] as const;
    });
    if (data) {
      setDoc(data[0]);
      setRevisions(data[1]);
    }
  }
  async function compare() {
    if (!doc) return;
    const latest = skills.find((s) => s.id === doc.skill.id)?.latestRevisionId;
    const other = revisions.find((r) => r.id !== doc.revision.id);
    const beforeId = latest !== doc.revision.id ? doc.revision.id : other?.id;
    if (!beforeId || !latest) return;
    const result = await run(t("比较版本内容"), () =>
      call<RevisionDiff>("get_revision_diff", { beforeId, afterId: latest }),
    );
    if (result) setDiff(result);
  }
  async function saveName(displayName: string) {
    if (!renaming) return;
    const result = await run(t("保存显示名称"), () =>
      call<Skill>("set_skill_display_name", {
        skillId: renaming.id,
        displayName,
      }),
    );
    if (result) {
      updated(result);
      setRenaming(null);
    }
  }
  useLayoutEffect(() => {
    if (inlineDetails) {
      layout.current
        ?.querySelector<HTMLElement>('.skill-card[aria-expanded="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [inlineDetails, doc?.skill.id]);
  const detail = doc && (
    <aside className="detail-panel">
      <div className="detail-heading">
        <h2>{currentSkill?.displayName || doc.skill.name}</h2>
        <button className="text-button" onClick={() => setDoc(null)}>
          {t("收起")}
        </button>
      </div>
      <div className="button-row">
        <span className="path">
          {t("原始名称：")}
          {doc.skill.name}
        </span>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (currentSkill) rename(currentSkill);
          }}
        >
          <Pencil size={14} />
          {t("编辑显示名称")}
        </button>
      </div>
      <p className="muted">{doc.skill.description}</p>
      <div className="detail-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => install(doc.revision)}
        >
          <ArrowDownToLine size={15} />
          {t("添加到项目")}
        </button>
        {doc.skill.source.kind === "github" && (
          <button disabled={busy} onClick={() => checkUpdate(doc.skill)}>
            <RefreshCw size={15} />
            {t("检查更新")}
          </button>
        )}
      </div>
      <label className="field">
        {t("阅读版本")}
        <select
          disabled={busy}
          value={doc.revision.id}
          onChange={(e) => void open(doc.skill, e.target.value)}
        >
          {revisions.map((r) => (
            <option key={r.id} value={r.id}>
              {shortHash(r.source.commit || r.hash)} ·{" "}
              {new Date(Number(r.createdAt) * 1000).toLocaleDateString(locale)}
            </option>
          ))}
        </select>
      </label>
      <div className="meta-line">
        <span>{t("{count} 个文件", { count: doc.revision.fileCount })}</span>
        <code>{shortHash(doc.revision.hash)}</code>
        {revisions.length > 1 && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void compare()}
          >
            <History size={14} />
            {t("对比最新版本")}
          </button>
        )}
      </div>
      <p className="path">
        {t("路径：")}
        {doc.revision.source.url || doc.revision.source.localPath}
      </p>
      {doc.warnings
        .filter(
          (warning) =>
            warning !==
            "包含 scripts；Askills 不执行脚本，安装后 Agent 可能按指令调用它们",
        )
        .map((w) => (
          <p className="notice" key={w}>
            {t(w)}
          </p>
        ))}
      <div className="reader-tabs">
        <button className={!raw ? "active" : ""} onClick={() => setRaw(false)}>
          {t("阅读")}
        </button>
        <button className={raw ? "active" : ""} onClick={() => setRaw(true)}>
          {t("原始 Markdown")}
        </button>
      </div>
      {raw ? (
        <pre className="raw-document">{doc.markdown}</pre>
      ) : (
        <Markdown text={doc.markdown} />
      )}
    </aside>
  );
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">YOUR SKILL LIBRARY</p>
          <h1>
            {t("技能库")}
            <span className="count">{skills.length}</span>
          </h1>
          <p className="subtitle">
            {t("集中保存，按项目使用。每个版本都可以追溯。")}
          </p>
        </div>
        <button className="primary" disabled={busy} onClick={importLocal}>
          <FolderPlus size={17} />
          {t("导入本地技能")}
        </button>
      </header>
      <div className="search-row">
        <label className="search">
          <Search size={17} />
          <input
            aria-label={t("搜索技能")}
            placeholder={t("搜索名称、描述或来源…")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              selection.select([]);
            }}
          />
        </label>
        <span className="muted">
          {t("{count} 个技能", { count: filtered.length })}
        </span>
      </div>
      {selection.active && (
        <SelectionToolbar
          count={chosen.length}
          busy={busy}
          selectAll={() => selection.select(filtered.map((s) => s.id))}
          clear={() => selection.select([])}
          exit={selection.exit}
        >
          <button
            disabled={busy || !chosen.length}
            onClick={() => installSkills(chosen)}
          >
            <FolderPlus size={16} />
            {t("添加到项目")}
          </button>
          <button
            className="danger-quiet"
            disabled={busy || !chosen.length}
            onClick={() => remove(chosen)}
          >
            <Trash2 size={16} />
            {t("删除所选")}
          </button>
        </SelectionToolbar>
      )}
      <div
        ref={layout}
        className={`library-layout${doc ? " with-detail" : ""}${inlineDetails ? " ztools-inline-layout" : ""}`}
      >
        <section
          className={`skill-list${inlineDetails ? " ztools-inline-list" : ""}`}
          aria-label={t("技能列表")}
        >
          {filtered.map((skill) => (
            <Fragment key={skill.id}>
              <div className="selectable-item" {...menu.bind(skill, busy)}>
                {selection.active && (
                  <input
                    type="checkbox"
                    disabled={busy}
                    aria-label={t("选择 {name}", {
                      name: skill.displayName || skill.name,
                    })}
                    checked={selection.ids.includes(skill.id)}
                    onChange={() => selection.toggle(skill.id)}
                  />
                )}
                <button
                  disabled={busy}
                  className={
                    (
                      selection.active
                        ? selection.ids.includes(skill.id)
                        : doc?.skill.id === skill.id
                    )
                      ? "skill-card selected"
                      : "skill-card"
                  }
                  aria-expanded={
                    inlineDetails ? doc?.skill.id === skill.id : undefined
                  }
                  aria-pressed={
                    selection.active
                      ? selection.ids.includes(skill.id)
                      : undefined
                  }
                  onClick={() =>
                    selection.active
                      ? selection.toggle(skill.id)
                      : inlineDetails && doc?.skill.id === skill.id
                        ? setDoc(null)
                        : void open(skill)
                  }
                >
                  <span className="skill-symbol">
                    <BookOpen size={20} />
                  </span>
                  <span className="skill-card-content">
                    <strong>{skill.displayName || skill.name}</strong>
                    {skill.displayName && (
                      <small className="path">{skill.name}</small>
                    )}
                    <span className="skill-description">
                      {skill.description}
                    </span>
                    <span className="skill-meta">
                      <span>
                        {skill.source.kind === "github"
                          ? "GitHub"
                          : t("本地导入")}
                      </span>
                      <span>{skill.license || t("许可未声明")}</span>
                      <span>
                        {t("{count} 个版本", { count: skill.revisionCount })}
                      </span>
                    </span>
                  </span>
                </button>
              </div>
              {inlineDetails && doc?.skill.id === skill.id && detail}
            </Fragment>
          ))}
          {!filtered.length && (
            <EmptyState
              icon={<BookOpen size={28} />}
              title={
                query ? t("没有匹配的技能") : t("你的技能库，从一个文件夹开始")
              }
            >
              {query
                ? t("试试其他名称或描述。")
                : t("选择包含 SKILL.md 的文件夹，或前往来源页从 GitHub 导入。")}
            </EmptyState>
          )}
        </section>
        {!inlineDetails && detail}
      </div>
      {menu.anchor && !busy && (
        <ContextMenu
          anchor={menu.anchor}
          label={t("技能操作")}
          close={menu.close}
          actions={[
            {
              label: t("重命名"),
              icon: <Pencil size={16} />,
              action: () => rename(menu.anchor!.item),
            },
            {
              label: t("添加到项目"),
              icon: <FolderPlus size={16} />,
              action: () => installSkills([menu.anchor!.item]),
            },
            {
              label: t("多选"),
              icon: <ListChecks size={16} />,
              action: () => selection.enter(menu.anchor!.item.id),
            },
            {
              label: t("删除"),
              icon: <Trash2 size={16} />,
              danger: true,
              action: () => remove([menu.anchor!.item]),
            },
          ]}
        />
      )}
      {renaming && (
        <Modal
          title={t("编辑技能显示名称")}
          busy={busy}
          close={() => setRenaming(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName(nameDraft);
            }}
          >
            <div className="modal-body">
              <label className="field">
                {t("显示名称")}
                <input
                  autoFocus
                  maxLength={80}
                  disabled={busy}
                  value={nameDraft}
                  placeholder={renaming.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
              <p className="footnote">
                {t(
                  "仅改变 Askills 中的显示，原始名称、SKILL.md 和项目安装路径保持不变。留空可恢复原名。",
                )}
              </p>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveName("")}
              >
                {t("恢复原名")}
              </button>
              <button className="primary" disabled={busy} type="submit">
                {t("保存名称")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {diff && (
        <Modal
          title={t("版本差异 · 较早版本 → 最新版本")}
          wide
          close={() => setDiff(null)}
        >
          <div className="diff-summary">
            <span>{t("新增 {count}", { count: diff.added.length })}</span>
            <span>{t("删除 {count}", { count: diff.removed.length })}</span>
            <span>{t("修改 {count}", { count: diff.changed.length })}</span>
          </div>
          <div className="file-diff">
            {diff.added.map((p) => (
              <div key={p}>+ {p}</div>
            ))}
            {diff.removed.map((p) => (
              <div key={p}>− {p}</div>
            ))}
            {diff.changed.map((p) => (
              <div key={p}>~ {p}</div>
            ))}
          </div>
          <div className="diff-columns">
            <section>
              <h3>{t("原版本 SKILL.md")}</h3>
              <pre>{diff.before}</pre>
            </section>
            <section>
              <h3>{t("新版本 SKILL.md")}</h3>
              <pre>{diff.after}</pre>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
