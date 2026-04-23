const { createPlainCopyPayload, createCompactCopyPayload, createLinkCopyPayload } = require('./core/text')
const { createCopyFeature } = require('./features/copy')
const { createSettingsFeature } = require('./features/settings')

const featureDefinitions = [
  {
    code: 'copyText',
    createFeature() {
      return createCopyFeature({
        transform: createPlainCopyPayload,
        createNoticeMessage: () => '已复制',
      })
    },
  },
  {
    code: 'removeTrim',
    createFeature() {
      return createCopyFeature({
        transform: createCompactCopyPayload,
        createNoticeMessage: () => '已复制',
      })
    },
  },
  {
    code: 'copyTextSetting',
    createFeature: createSettingsFeature,
  },
  {
    code: 'copyUrl',
    createFeature() {
      return createCopyFeature({
        transform: createLinkCopyPayload,
        createNoticeMessage: ({ count }) => `已复制,一共${count}条链接`,
      })
    },
  },
]

window.exports = featureDefinitions.reduce((exportsMap, definition) => {
  exportsMap[definition.code] = definition.createFeature()
  return exportsMap
}, {})
