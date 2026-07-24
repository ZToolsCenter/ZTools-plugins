import { createDiscreteApi } from 'naive-ui'

const { message } = createDiscreteApi(['message'])

class NotifyUtil {
  static success(title = '成功', content) {
    message.success(content || title, { closable: true })
  }

  static error(title = '错误', content) {
    message.error(content || title, { closable: true, duration: 5000 })
  }

  static warning(title = '警告', content) {
    message.warning(content || title, { closable: true, duration: 3500 })
  }

  static info(title = '提示', content) {
    message.info(content || title, { closable: true })
  }
}

export default NotifyUtil
