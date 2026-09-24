const fs = require('node:fs')
const path = require('node:path')
const https = require('https')
const http = require('http')

// Jenkins API 调用
function jenkinsRequest(jenkinsUrl, username, apiToken, apiPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(jenkinsUrl)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? https : http

    // 构建认证头
    const auth = Buffer.from(username + ':' + apiToken).toString('base64')

    // 构建 API 路径
    const cleanPath = apiPath.startsWith('/') ? apiPath : '/' + apiPath

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: cleanPath,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json'
      }
    }

    const req = httpModule.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            resolve(data)
          }
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      })
    })

    req.on('error', reject)
    req.end()
  })
}

// Jenkins 文本端点调用（不解析 JSON，直接返回原始字符串）
function jenkinsRequestText(jenkinsUrl, username, apiToken, apiPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(jenkinsUrl)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const auth = Buffer.from(username + ':' + apiToken).toString('base64')
    const cleanPath = apiPath.startsWith('/') ? apiPath : '/' + apiPath

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: cleanPath,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'text/plain'
      }
    }

    const req = httpModule.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error('HTTP ' + res.statusCode))
        }
      })
    })

    req.on('error', reject)
    req.end()
  })
}

// Jenkins 构建触发
function jenkinsBuild(jenkinsUrl, username, apiToken, jobName) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(jenkinsUrl)
    const isHttps = parsedUrl.protocol === 'https:'
    const httpModule = isHttps ? https : http

    const auth = Buffer.from(username + ':' + apiToken).toString('base64')
    const jobPath = getJobPath(jobName) + '/build'

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: jobPath,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth
      }
    }

    const req = httpModule.request(options, (res) => {
      if (res.statusCode === 201 || res.statusCode === 200) {
        resolve({ success: true })
      } else {
        reject(new Error('HTTP ' + res.statusCode))
      }
    })

    req.on('error', reject)
    req.end()
  })
}

const JOB_TREE = 'jobs[name,url,color,_class,lastBuild[number,url,result,timestamp]]'

function getJobPath(jobName) {
  return '/' + jobName
    .split('/')
    .filter(Boolean)
    .map(function(segment) { return 'job/' + encodeURIComponent(segment) })
    .join('/')
}

function isFolder(job) {
  return typeof job._class === 'string' && /(?:Folder|MultiBranchProject)$/.test(job._class)
}

function getFolderApiPath(folderUrl) {
  const parsedUrl = new URL(folderUrl)
  const folderPath = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname : parsedUrl.pathname + '/'
  return folderPath + 'api/json?tree=' + JOB_TREE
}

function loadJobs(jenkinsUrl, username, apiToken, apiPath, parentFullName) {
  return jenkinsRequest(jenkinsUrl, username, apiToken, apiPath)
    .then(function(data) {
      return Promise.all((data.jobs || []).map(function(job) {
        const fullName = parentFullName ? parentFullName + '/' + job.name : job.name
        const normalizedJob = Object.assign({}, job, { fullName: fullName })

        if (!isFolder(job)) return normalizedJob

        return loadJobs(
          jenkinsUrl,
          username,
          apiToken,
          getFolderApiPath(job.url),
          fullName
        ).then(function(jobs) {
          normalizedJob.jobs = jobs
          return normalizedJob
        })
      }))
    })
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // Jenkins API 调用
  jenkins: {
    // 获取所有 Jobs
    getJobs: function(jenkinsUrl, username, apiToken) {
      return loadJobs(jenkinsUrl, username, apiToken, '/api/json?tree=' + JOB_TREE, '')
        .then(function(jobs) { return { data: jobs, error: null } })
        .catch(function(err) { return { data: [], error: err.message } })
    },
    // 获取构建历史
    getBuilds: function(jenkinsUrl, username, apiToken, jobName) {
      return jenkinsRequest(jenkinsUrl, username, apiToken, getJobPath(jobName) + '/api/json?tree=builds[number,url,result,building,duration,timestamp,displayName,fullDisplayName]{0,20}')
        .then(function(data) { return { data: data.builds || [], error: null } })
        .catch(function(err) { return { data: [], error: err.message } })
    },
    // 触发构建
    triggerBuild: function(jenkinsUrl, username, apiToken, jobName) {
      return jenkinsBuild(jenkinsUrl, username, apiToken, jobName)
        .then(function() { return { error: null } })
        .catch(function(err) { return { error: err.message } })
    },
    // 获取视图列表
    getViews: function(jenkinsUrl, username, apiToken) {
      return jenkinsRequest(jenkinsUrl, username, apiToken, '/api/json?tree=views[name,url,color,description]')
        .then(function(data) { return { data: data.views || [], error: null } })
        .catch(function(err) { return { data: [], error: err.message } })
    },
    // 获取视图中的 Jobs
    getViewJobs: function(jenkinsUrl, username, apiToken, viewName) {
      return loadJobs(jenkinsUrl, username, apiToken, '/view/' + encodeURIComponent(viewName) + '/api/json?tree=' + JOB_TREE, '')
        .then(function(jobs) { return { data: jobs, error: null } })
        .catch(function(err) { return { data: [], error: err.message } })
    },
    // 测试连接
    testConnection: function(jenkinsUrl, username, apiToken) {
      return jenkinsRequest(jenkinsUrl, username, apiToken, '/api/json')
        .then(function() { return { success: true, error: null } })
        .catch(function(err) { return { success: false, error: err.message } })
    },
    // 获取构建的 console log（纯文本）
    getBuildConsole: function(jenkinsUrl, username, apiToken, jobName, buildNumber) {
      return jenkinsRequestText(
        jenkinsUrl,
        username,
        apiToken,
        getJobPath(jobName) + '/' + encodeURIComponent(String(buildNumber)) + '/consoleText'
      )
        .then(function(data) { return { data: data || '', error: null } })
        .catch(function(err) { return { data: '', error: err.message } })
    }
  },
  // 读文件
  readFile: function(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile: function(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile: function(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  }
}
