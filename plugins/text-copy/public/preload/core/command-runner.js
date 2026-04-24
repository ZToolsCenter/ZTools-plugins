const { completeCopy } = require('./host')
const { isNotificationEnabled } = require('./settings')

function executeCopyAction({ payload, transform, createNoticeMessage }) {
  const result = transform(payload)
  if (!result || typeof result.text !== 'string') {
    return false
  }

  const noticeMessage = isNotificationEnabled() ? createNoticeMessage(result) : ''
  completeCopy(result.text, noticeMessage)
  return true
}

module.exports = {
  executeCopyAction,
}
