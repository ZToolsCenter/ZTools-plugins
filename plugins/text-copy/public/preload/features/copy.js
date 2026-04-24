const { executeCopyAction } = require('../core/command-runner')

function createCopyFeature({ transform, createNoticeMessage }) {
  return {
    mode: 'none',
    args: {
      enter(action) {
        executeCopyAction({
          payload: action?.payload,
          transform,
          createNoticeMessage,
        })
      },
    },
  }
}

module.exports = {
  createCopyFeature,
}
