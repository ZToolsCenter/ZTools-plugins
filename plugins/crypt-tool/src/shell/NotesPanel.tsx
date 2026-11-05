import type { AlgorithmMeta, CategoryId } from '../registry/types'
import { categoryLabel } from '../registry'
import { Icon } from '../shared'
import type { FieldNote } from '../shared'

interface Guide {
  title: string
  body: string
}

const CATEGORY_GUIDES: Record<CategoryId, Guide> = {
  encoding: {
    title: '编码不是加密',
    body: 'Base64、Hex、URL 只是换一种表示方式，任何拿到字符串的人都能还原。不要用它保护密码或密钥。'
  },
  hash: {
    title: '摘要不可逆',
    body: '哈希用于比对与校验，不能“解密”。MD5、SHA-1 已不适合安全场景，优先使用 SHA-256 及以上。'
  },
  symmetric: {
    title: '密钥与 IV 都要留住',
    body: '同一密钥（以及 CBC 的 IV）才能还原明文。IV 不必保密，但不要在同一条密钥下复用；GCM 还会校验完整性。'
  },
  asymmetric: {
    title: '公钥可以公开',
    body: '加密用公钥，解密用私钥；签名用私钥，验签用公钥。私钥只留在本机，RSA 建议 2048 位以上。'
  },
  hmac: {
    title: '确认消息没被改动',
    body: 'HMAC 用共享密钥生成认证码。接收方用同一密钥重新计算并比对；不能从认证码反推出密钥或消息。'
  },
  kdf: {
    title: '派生密钥要慢一点',
    body: '口令派生故意消耗时间与内存，用来拖慢猜测。盐要随机保存；参数越高越安全，也越慢。'
  },
  tools: {
    title: '先确认输出格式',
    body: '这类工具不改动安全性，只处理格式、随机数与检查。需要随机值时，应使用系统级密码学随机源。'
  }
}

interface Props {
  meta: AlgorithmMeta
  activeNote: FieldNote | null
  onClose: () => void
}

export default function NotesPanel({ meta, activeNote, onClose }: Props) {
  const guide = CATEGORY_GUIDES[meta.category]
  const fieldText = activeNote
    ? activeNote.help || (activeNote.hint ? `建议值或格式：${activeNote.hint}` : '用于输入此算法需要的参数。')
    : ''

  return (
    <aside className="ct-notes" aria-label="算法边注">
      <div className="ct-notes-head">
        <div className="ct-notes-title">
          <Icon name="note" />
          <span>边注</span>
        </div>
        <button type="button" className="ct-icon-btn" onClick={onClose} aria-label="关闭边注">
          <Icon name="x" />
        </button>
      </div>

      <div className="ct-note-block ct-note-block--field" aria-live="polite">
        <div className="ct-note-kicker">当前字段</div>
        {activeNote ? (
          <>
            <h3 className="ct-note-heading">
              {activeNote.label}
              {activeNote.hint ? <span className="ct-note-hint">{activeNote.hint}</span> : null}
            </h3>
            <p className="ct-note-text">{fieldText}</p>
          </>
        ) : (
          <p className="ct-note-text ct-note-text--idle">聚焦左侧的字段，边注会解释它的作用。</p>
        )}
      </div>

      <div className="ct-note-block">
        <div className="ct-note-kicker">算法简注</div>
        <p className="ct-note-text">{meta.teach.summary}</p>
      </div>

      <div className="ct-note-block">
        <div className="ct-note-kicker">{categoryLabel(meta.category)} / 要点</div>
        <h3 className="ct-note-heading">{guide.title}</h3>
        <p className="ct-note-text">{guide.body}</p>
      </div>

      <div className="ct-notes-foot">
        <Icon name="note" size={12} />
        <span>边注随字段焦点更新</span>
      </div>
    </aside>
  )
}
