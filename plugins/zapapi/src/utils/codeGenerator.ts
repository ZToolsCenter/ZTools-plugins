import type { RequestState } from '../store/request'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
type SocketMethod = 'WS' | 'TCP' | 'UDP'

function isHttpMethod(method: string): method is HttpMethod {
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method)
}

function isSocketMethod(method: string): method is SocketMethod {
  return ['WS', 'TCP', 'UDP'].includes(method)
}

function escapeSingleQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function escapeDoubleQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getEnabledQueryPairs(req: RequestState): Array<{ key: string; value: string }> {
  return req.params
    .filter((p) => p.enabled && p.key)
    .map((p) => ({ key: p.key, value: p.value }))
}

function getEnabledUrlEncodedBody(req: RequestState): string {
  return req.body.formData
    .filter((f) => f.enabled && f.key)
    .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
    .join('&')
}

function getEnabledFormDataFields(req: RequestState): Array<{ key: string; value: string; isFile: boolean }> {
  return req.body.formData
    .filter((f) => f.enabled && f.key)
    .map((f) => ({ key: f.key, value: f.value, isFile: !!f.isFile }))
}

function toFilePathPlaceholder(fileName: string): string {
  const safeName = (fileName || 'file.bin').replace(/[\\/]/g, '_')
  return `/path/to/${safeName}`
}

function appendQuery(url: string, pairs: Array<{ key: string; value: string }>): string {
  if (pairs.length === 0) return url
  const query = pairs.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

function resolveBodyKind(req: RequestState): 'none' | 'text' | 'structured' | 'binary' | 'other' {
  if (req.body.kind) {
    return req.body.kind
  }
  if (req.body.type === 'none') {
    return 'none'
  }
  if (req.body.type === 'urlencoded' || req.body.type === 'formdata') {
    return 'structured'
  }
  if (req.body.type === 'json') {
    return 'text'
  }
  return 'other'
}

function resolveBodyContentType(req: RequestState): string {
  if (req.body.contentType) {
    return req.body.contentType
  }
  if (req.body.type === 'json') {
    return 'application/json'
  }
  if (req.body.type === 'urlencoded') {
    return 'application/x-www-form-urlencoded'
  }
  if (req.body.type === 'formdata') {
    return 'multipart/form-data'
  }
  return ''
}

function isBodyFormData(req: RequestState): boolean {
  return resolveBodyKind(req) === 'structured' && resolveBodyContentType(req) === 'multipart/form-data'
}

function isBodyUrlencoded(req: RequestState): boolean {
  return resolveBodyKind(req) === 'structured' && resolveBodyContentType(req) === 'application/x-www-form-urlencoded'
}

function isBodyBinary(req: RequestState): boolean {
  return resolveBodyKind(req) === 'binary' || resolveBodyContentType(req) === 'application/octet-stream'
}

function isBodyJson(req: RequestState): boolean {
  return resolveBodyContentType(req) === 'application/json'
}

function collectHeaders(req: RequestState): Record<string, string> {
  const headers: Record<string, string> = {}

  if (req.auth.type === 'bearer' && req.auth.token) {
    headers.Authorization = `Bearer ${req.auth.token}`
  } else if (req.auth.type === 'jwt-bearer') {
    headers.Authorization = 'Bearer <generated-jwt-token>'
  } else if (req.auth.type === 'digest') {
    headers.Authorization = 'Digest <calculated-response>'
  } else if (req.auth.type === 'apikey' && req.auth.apiKeyLocation === 'header' && req.auth.apiKey) {
    headers[req.auth.apiKeyHeader || 'X-API-Key'] = req.auth.apiKey
  }

  req.headers
    .filter((h) => h.enabled && h.key)
    .forEach((h) => {
      headers[h.key] = h.value
    })

  const bodyKind = resolveBodyKind(req)
  const bodyContentType = resolveBodyContentType(req)
  if (bodyKind !== 'none' && bodyContentType && bodyContentType !== 'multipart/form-data' && !headers['Content-Type']) {
    headers['Content-Type'] = bodyContentType
  }

  return headers
}

function resolveHttpUrl(req: RequestState): string {
  let url = appendQuery(req.url, getEnabledQueryPairs(req))
  if (req.auth.type === 'apikey' && req.auth.apiKeyLocation === 'query' && req.auth.apiKey) {
    const key = req.auth.apiKeyHeader || 'api_key'
    url = appendQuery(url, [{ key, value: req.auth.apiKey }])
  }
  return url
}

function resolveWsUrl(req: RequestState): string {
  return appendQuery(req.url, getEnabledQueryPairs(req))
}

function parseSocketHostPort(input: string): { host: string; port: number } {
  const url = input.trim()
  let host = 'localhost'
  let port = 80

  try {
    if (url.includes('://')) {
      const parsed = new URL(url)
      host = parsed.hostname || host
      port = parsed.port ? parseInt(parsed.port, 10) : port
      if (!Number.isNaN(port)) return { host, port }
    }
  } catch {
    // fallback below
  }

  if (url.startsWith('[')) {
    const end = url.indexOf(']')
    if (end > 0) {
      host = url.slice(1, end)
      const rawPort = url.slice(end + 1)
      if (rawPort.startsWith(':')) {
        const p = parseInt(rawPort.slice(1), 10)
        if (!Number.isNaN(p)) port = p
      }
      return { host, port }
    }
  }

  const lastColon = url.lastIndexOf(':')
  if (lastColon > 0) {
    host = url.slice(0, lastColon) || host
    const p = parseInt(url.slice(lastColon + 1), 10)
    if (!Number.isNaN(p)) port = p
  } else if (url) {
    host = url
  }

  return { host, port }
}

function jsonToSingleQuoteObject(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/"([^"]+)":/g, '$1:').replace(/"/g, "'")
}

function buildCurl(req: RequestState): string {
  const url = resolveHttpUrl(req)
  let cmd = `curl -X ${req.method} '${escapeSingleQuote(url)}'`

  if (req.auth.type === 'basic' && req.auth.username) {
    cmd += ` \\\n+  -u '${escapeSingleQuote(req.auth.username)}:${escapeSingleQuote(req.auth.password)}'`
  }

  const headers = collectHeaders(req)
  Object.entries(headers).forEach(([k, v]) => {
    cmd += ` \\\n+  -H '${escapeSingleQuote(k)}: ${escapeSingleQuote(v)}'`
  })

  if (isBodyJson(req) && req.body.raw) {
    cmd += ` \\\n+  -d '${escapeSingleQuote(req.body.raw)}'`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    cmd += ` \\\n++  --data-binary '@${escapeSingleQuote(toFilePathPlaceholder(req.body.binary.fileName))}'`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    cmd += ` \\\n+  --data-raw '${escapeSingleQuote(req.body.raw)}'`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      cmd += ` \\\n+  --data '${escapeSingleQuote(data)}'`
    }
  } else if (isBodyFormData(req)) {
    getEnabledFormDataFields(req).forEach((f) => {
      if (f.isFile) {
        cmd += ` \\\n+  -F '${escapeSingleQuote(f.key)}=@${escapeSingleQuote(toFilePathPlaceholder(f.value))}'`
      } else {
        cmd += ` \\\n+  -F '${escapeSingleQuote(f.key)}=${escapeSingleQuote(f.value)}'`
      }
    })
  }

  return cmd
}

function buildFetch(req: RequestState): string {
  const url = resolveHttpUrl(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const formLines = fields.map((field) => {
      if (field.isFile) {
        return `formData.append('${escapeSingleQuote(field.key)}', /* File */ fileInput.files[0], '${escapeSingleQuote(field.value || 'file.bin')}')`
      }
      return `formData.append('${escapeSingleQuote(field.key)}', '${escapeSingleQuote(field.value)}')`
    }).join('\n')

    return `// Select a file in your UI and assign to fileInput first
const fileInput = document.querySelector('input[type="file"]');
const formData = new FormData();
${formLines || "// formData.append('field', 'value')"}

fetch('${escapeSingleQuote(url)}', {
  method: '${req.method}',
  body: formData
})
  .then(async (response) => {
    const text = await response.text();
    console.log('status:', response.status);
    console.log('data:', text);
  })
  .catch((error) => console.error('Error:', error));`
  }

  const options: Record<string, unknown> = { method: req.method }
  const headers = collectHeaders(req)
  if (Object.keys(headers).length > 0) options.headers = headers

  if (isBodyJson(req) && req.body.raw) {
    options.body = req.body.raw
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    options.body = `/* binary file: ${toFilePathPlaceholder(req.body.binary.fileName)} */`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    options.body = req.body.raw
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) options.body = data
  }

  const optionsStr = jsonToSingleQuoteObject(options)
  return `fetch('${escapeSingleQuote(url)}', ${optionsStr})\n  .then(async (response) => {\n    const text = await response.text();\n    let data;\n    try {\n      data = JSON.parse(text);\n    } catch {\n      data = text;\n    }\n    console.log('status:', response.status);\n    console.log('data:', data);\n  })\n  .catch((error) => console.error('Error:', error));`
}

function buildAxios(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const appendLines = fields.map((field) => {
      if (field.isFile) {
        return `formData.append('${escapeSingleQuote(field.key)}', /* File/Blob */ file, '${escapeSingleQuote(field.value || 'file.bin')}');`
      }
      return `formData.append('${escapeSingleQuote(field.key)}', '${escapeSingleQuote(field.value)}');`
    }).join('\n')

    return `import axios from 'axios';

const file = /* e.g. from <input type="file"> */ null;
const formData = new FormData();
${appendLines || "// formData.append('field', 'value');"}

axios({
  method: '${req.method.toLowerCase()}',
  url: '${escapeSingleQuote(url)}',
  data: formData
})
  .then((response) => {
    console.log('status:', response.status);
    console.log('data:', response.data);
  })
  .catch((error) => {
    if (error.response) {
      console.error('status:', error.response.status);
      console.error('data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  });`
  }

  const config: Record<string, unknown> = {
    method: req.method.toLowerCase(),
    url
  }
  if (Object.keys(headers).length > 0) config.headers = headers

  if (req.auth.type === 'basic' && req.auth.username) {
    config.auth = { username: req.auth.username, password: req.auth.password }
  }

  if (isBodyJson(req) && req.body.raw) {
    config.data = req.body.raw
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    config.data = `/* binary file: ${toFilePathPlaceholder(req.body.binary.fileName)} */`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    config.data = req.body.raw
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) config.data = data
  }

  const configStr = jsonToSingleQuoteObject(config)
  return `import axios from 'axios';\n\naxios(${configStr})\n  .then((response) => {\n    console.log('status:', response.status);\n    console.log('data:', response.data);\n  })\n  .catch((error) => {\n    if (error.response) {\n      console.error('status:', error.response.status);\n      console.error('data:', error.response.data);\n    } else {\n      console.error('Error:', error.message);\n    }\n  });`
}

function buildTypeScriptFetch(req: RequestState): string {
  const url = resolveHttpUrl(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const appendLines = fields.map((field) => {
      if (field.isFile) {
        return `  formData.append('${escapeSingleQuote(field.key)}', file as File, '${escapeSingleQuote(field.value || 'file.bin')}')`
      }
      return `  formData.append('${escapeSingleQuote(field.key)}', '${escapeSingleQuote(field.value)}')`
    }).join('\n')

    return `async function callApi(file: File | null): Promise<void> {
  const formData = new FormData()
${appendLines || "  // formData.append('field', 'value')"}

  const response = await fetch('${escapeSingleQuote(url)}', {
    method: '${req.method}',
    body: formData
  })

  const text = await response.text()
  console.log('status:', response.status)
  console.log('data:', text)
}

callApi(null).catch((error: unknown) => {
  console.error('Error:', error)
})`
  }

  const headers = collectHeaders(req)
  const headersStr = JSON.stringify(headers, null, 2)
  let bodyExpr = ''
  if (isBodyJson(req) && req.body.raw) {
    bodyExpr = `'${escapeSingleQuote(req.body.raw)}'`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    bodyExpr = `/* binary file: ${toFilePathPlaceholder(req.body.binary.fileName)} */ undefined`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    bodyExpr = `'${escapeSingleQuote(req.body.raw)}'`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) bodyExpr = `'${escapeSingleQuote(data)}'`
  }

  return `type ApiResult = unknown;\n\nasync function callApi(): Promise<void> {\n  const response = await fetch('${escapeSingleQuote(url)}', {\n    method: '${req.method}',\n    headers: ${headersStr},${bodyExpr ? `\n    body: ${bodyExpr},` : ''}\n  });\n\n  const text = await response.text();\n  let data: ApiResult | string = text;\n  try {\n    data = JSON.parse(text) as ApiResult;\n  } catch {}\n\n  console.log('status:', response.status);\n  console.log('data:', data);\n}\n\ncallApi().catch((error: unknown) => {\n  console.error('Error:', error);\n});`
}

function buildGo(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const textLines = fields
      .filter((f) => !f.isFile)
      .map((f) => `\t_ = writer.WriteField("${escapeDoubleQuote(f.key)}", "${escapeDoubleQuote(f.value)}")`)
      .join('\n')
    const firstFile = fields.find((f) => f.isFile)
    const fileLine = firstFile
      ? `\t// add file field example\n\tfileWriter, _ := writer.CreateFormFile("${escapeDoubleQuote(firstFile.key)}", "${escapeDoubleQuote(firstFile.value || 'file.bin')}")\n\t_ = fileWriter // copy file bytes into fileWriter`
      : ''

    return `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"mime/multipart"
\t"net/http"
)

func main() {
\tbody := &bytes.Buffer{}
\twriter := multipart.NewWriter(body)
${textLines ? `${textLines}\n` : ''}${fileLine ? `${fileLine}\n` : ''}\t_ = writer.Close()

\treq, err := http.NewRequest("${req.method}", "${escapeDoubleQuote(url)}", body)
\tif err != nil {
\t\tpanic(err)
\t}
\treq.Header.Set("Content-Type", writer.FormDataContentType())

\tclient := &http.Client{}
\tresp, err := client.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()

\trespBody, _ := io.ReadAll(resp.Body)
\tfmt.Println("status:", resp.StatusCode)
\tfmt.Println("body:", string(respBody))
}`
  }

  let payloadLine = 'var payload io.Reader = nil'
  if (isBodyJson(req) && req.body.raw) {
    payloadLine = `payload := strings.NewReader(${JSON.stringify(req.body.raw)})`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    payloadLine = `payload := strings.NewReader("/* binary file: ${escapeDoubleQuote(toFilePathPlaceholder(req.body.binary.fileName))} */")`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    payloadLine = `payload := strings.NewReader(${JSON.stringify(req.body.raw)})`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) payloadLine = `payload := strings.NewReader(${JSON.stringify(data)})`
  }

  const applyHeaders = Object.entries(headers)
    .map(([k, v]) => `\treq.Header.Set("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}")`)
    .join('\n')

  return `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n\t"strings"\n)\n\nfunc main() {\n\t${payloadLine}\n\treq, err := http.NewRequest("${req.method}", "${escapeDoubleQuote(url)}", payload)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n${applyHeaders ? `${applyHeaders}\n` : ''}\tclient := &http.Client{}\n\tresp, err := client.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer resp.Body.Close()\n\n\tbody, err := io.ReadAll(resp.Body)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\n\tfmt.Println("status:", resp.StatusCode)\n\tfmt.Println("body:", string(body))\n}`
}

function buildJavaOkHttp(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const formParts = fields.map((f) => {
      if (f.isFile) {
        return `    .addFormDataPart("${escapeDoubleQuote(f.key)}", "${escapeDoubleQuote(f.value || 'file.bin')}", RequestBody.create(new File("${escapeDoubleQuote(toFilePathPlaceholder(f.value))}"), MediaType.parse("application/octet-stream")))`
      }
      return `    .addFormDataPart("${escapeDoubleQuote(f.key)}", "${escapeDoubleQuote(f.value)}")`
    }).join('\n')

    const headerLines = Object.entries(headers)
      .filter(([k]) => k.toLowerCase() !== 'content-type')
      .map(([k, v]) => `    .addHeader("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}")`)
      .join('\n')

    return `import java.io.File;
import java.io.IOException;
import okhttp3.*;

public class ApiCall {
  public static void main(String[] args) throws IOException {
    OkHttpClient client = new OkHttpClient();

    RequestBody body = new MultipartBody.Builder()
    .setType(MultipartBody.FORM)
${formParts || '    // .addFormDataPart("field", "value")'}
    .build();

    Request request = new Request.Builder()
    .url("${escapeDoubleQuote(url)}")
${headerLines ? `${headerLines}\n` : ''}    .method("${req.method}", body)
    .build();

    try (Response response = client.newCall(request).execute()) {
      String responseBody = response.body() != null ? response.body().string() : "";
      System.out.println("status: " + response.code());
      System.out.println("body: " + responseBody);
    }
  }
}`
  }

  let bodyBuilder = 'RequestBody body = null;'
  if (isBodyJson(req) && req.body.raw) {
    bodyBuilder = `RequestBody body = RequestBody.create(\n    ${JSON.stringify(req.body.raw)},\n    MediaType.parse("application/json")\n);`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    bodyBuilder = `RequestBody body = RequestBody.create(\n    new File("${escapeDoubleQuote(toFilePathPlaceholder(req.body.binary.fileName))}"),\n    MediaType.parse("application/octet-stream")\n);`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    bodyBuilder = `RequestBody body = RequestBody.create(\n    ${JSON.stringify(req.body.raw)},\n    null\n);`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      bodyBuilder = `RequestBody body = RequestBody.create(\n    ${JSON.stringify(data)},\n    MediaType.parse("application/x-www-form-urlencoded")\n);`
    }
  }

  const headerLines = Object.entries(headers)
    .map(([k, v]) => `    .addHeader("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}")`)
    .join('\n')

  return `import java.io.IOException;\nimport okhttp3.*;\n\npublic class ApiCall {\n  public static void main(String[] args) throws IOException {\n    OkHttpClient client = new OkHttpClient();\n\n    ${bodyBuilder}\n\n    Request request = new Request.Builder()\n    .url("${escapeDoubleQuote(url)}")\n${headerLines ? `${headerLines}\n` : ''}    .method("${req.method}", body)\n    .build();\n\n    try (Response response = client.newCall(request).execute()) {\n      String responseBody = response.body() != null ? response.body().string() : \"\";\n      System.out.println(\"status: \" + response.code());\n      System.out.println(\"body: \" + responseBody);\n    }\n  }\n}`
}

function buildPython(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  if (isBodyFormData(req)) {
    const fields = getEnabledFormDataFields(req)
    const dataFields = fields.filter((f) => !f.isFile)
    const fileFields = fields.filter((f) => f.isFile)

    let code = 'import requests\n\n'
    code += `url = "${escapeDoubleQuote(url)}"\n`
    if (Object.keys(headers).length > 0) {
      const filtered = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'content-type'))
      if (Object.keys(filtered).length > 0) {
        code += `headers = ${JSON.stringify(filtered, null, 2).replace(/"/g, "'")}\n`
      }
    }

    if (dataFields.length > 0) {
      const dataObj = Object.fromEntries(dataFields.map((f) => [f.key, f.value]))
      code += `data = ${JSON.stringify(dataObj, null, 2).replace(/"/g, "'")}\n`
    }

    if (fileFields.length > 0) {
      const lines = fileFields.map((f) => `    '${escapeSingleQuote(f.key)}': open('${escapeSingleQuote(toFilePathPlaceholder(f.value))}', 'rb')`).join(',\n')
      code += `files = {\n${lines}\n}\n`
    }

    const args = [`'${req.method}'`, 'url']
    if (Object.keys(headers).some((k) => k.toLowerCase() !== 'content-type')) args.push('headers=headers')
    if (dataFields.length > 0) args.push('data=data')
    if (fileFields.length > 0) args.push('files=files')

    code += `\nresponse = requests.request(${args.join(', ')})\n`
    code += 'print("status:", response.status_code)\n'
    code += 'print(response.text)\n'
    if (fileFields.length > 0) {
      code += '\nfor f in files.values():\n    f.close()\n'
    }
    return code
  }

  let code = 'import requests\n\n'
  code += `url = "${escapeDoubleQuote(url)}"\n`
  if (Object.keys(headers).length > 0) {
    code += `headers = ${JSON.stringify(headers, null, 2).replace(/"/g, "'")}\n`
  }

  if (req.auth.type === 'basic' && req.auth.username) {
    code += `auth = ('${escapeSingleQuote(req.auth.username)}', '${escapeSingleQuote(req.auth.password)}')\n`
  }

  if (isBodyJson(req) && req.body.raw) {
    code += `payload = ${req.body.raw}\n`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    code += `with open('${escapeSingleQuote(toFilePathPlaceholder(req.body.binary.fileName))}', 'rb') as f:\n    payload = f.read()\n`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    code += `payload = '''${req.body.raw}'''\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) code += `payload = '${escapeSingleQuote(data)}'\n`
  }

  const args = [`'${req.method}'`, 'url']
  if (Object.keys(headers).length > 0) args.push('headers=headers')
  if (req.auth.type === 'basic' && req.auth.username) args.push('auth=auth')
  if (isBodyJson(req) && req.body.raw) args.push('json=payload')
  if (
    (isBodyBinary(req) && req.body.binary.fileName)
    || (resolveBodyKind(req) !== 'none' && !isBodyJson(req) && req.body.raw)
    || (isBodyUrlencoded(req) && getEnabledUrlEncodedBody(req))
  ) args.push('data=payload')

  code += `\nresponse = requests.request(${args.join(', ')})\n`
  code += 'print("status:", response.status_code)\n'
  code += 'print(response.text)\n'
  return code
}

function buildWget(req: RequestState): string {
  const url = resolveHttpUrl(req)
  let cmd = `wget --method=${req.method} '${escapeSingleQuote(url)}'`

  const headers = collectHeaders(req)
  Object.entries(headers).forEach(([k, v]) => {
    cmd += ` \\\n  --header='${escapeSingleQuote(k)}: ${escapeSingleQuote(v)}'`
  })

  if (isBodyJson(req) && req.body.raw) {
    cmd += ` \\\n  --post-data='${escapeSingleQuote(req.body.raw)}'`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    cmd += ` \\\n  --body-data='${escapeSingleQuote(req.body.raw)}'`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      cmd += ` \\\n  --post-data='${escapeSingleQuote(data)}'`
    }
  }

  cmd += ' \\\n  -O -'
  return cmd
}

function buildPowerShell(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  const params: string[] = []
  params.push(`Uri = '${escapeSingleQuote(url)}'`)
  params.push(`Method = '${req.method}'`)

  if (Object.keys(headers).length > 0) {
    const headersObj = Object.entries(headers)
      .map(([k, v]) => `        '${escapeSingleQuote(k)}' = '${escapeSingleQuote(v)}'`)
      .join(',\n')
    params.push(`Headers = @{\n${headersObj}\n    }`)
  }

  if (isBodyJson(req) && req.body.raw) {
    params.push(`Body = '${escapeSingleQuote(req.body.raw)}'`)
    params.push(`ContentType = 'application/json'`)
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    params.push(`InFile = '${escapeSingleQuote(toFilePathPlaceholder(req.body.binary.fileName))}'`)
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    params.push(`Body = '${escapeSingleQuote(req.body.raw)}'`)
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      params.push(`Body = '${escapeSingleQuote(data)}'`)
      params.push(`ContentType = 'application/x-www-form-urlencoded'`)
    }
  }

  return `$response = Invoke-WebRequest\n@(\n${params.join(',\n')}\n) -UseBasicParsing\n\nWrite-Host "Status: $($response.StatusCode)"\nWrite-Host $response.Content`
}

function buildPhp(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  let code = '<?php\n\n'
  code += `$url = "${escapeDoubleQuote(url)}";\n`

  if (Object.keys(headers).length > 0) {
    const headersArr = Object.entries(headers)
      .map(([k, v]) => `    "${escapeDoubleQuote(k)}: ${escapeDoubleQuote(v)}"`)
      .join(',\n')
    code += `$headers = [\n${headersArr}\n];\n`
  }

  code += '\n$ch = curl_init();\n'
  code += `curl_setopt($ch, CURLOPT_URL, $url);\n`
  code += `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${req.method}");\n`
  code += 'curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n'
  code += 'curl_setopt($ch, CURLOPT_HEADER, true);\n'

  if (Object.keys(headers).length > 0) {
    code += 'curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);\n'
  }

  if (isBodyJson(req) && req.body.raw) {
    code += `curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeSingleQuote(req.body.raw)}');\n`
    code += 'curl_setopt($ch, CURLOPT_HTTPHEADER, array_merge($headers ?? [], ["Content-Type: application/json"]));\n'
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    code += `curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeSingleQuote(req.body.raw)}');\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      code += `curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeSingleQuote(data)}');\n`
    }
  }

  code += '\n$response = curl_exec($ch);\n'
  code += '$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);\n'
  code += '$headers = substr($response, 0, $header_size);\n'
  code += '$body = substr($response, $header_size);\n'
  code += '$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n'
  code += 'curl_close($ch);\n\n'
  code += 'echo "Status: " . $status . "\\n";\n'
  code += 'echo $body . "\\n";\n'
  code += '?>'

  return code
}

function buildRuby(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  let code = 'require "net/http"\n'
  code += 'require "uri"\n\n'
  code += `uri = URI("${escapeDoubleQuote(url)}")\n`
  code += `http = Net::HTTP.new(uri.host, uri.port)\n`

  const methodObj = req.method.toUpperCase()
  code += `request = Net::HTTP::${methodObj}.new(uri)\n`

  if (Object.keys(headers).length > 0) {
    Object.entries(headers).forEach(([k, v]) => {
      code += `request["${escapeDoubleQuote(k)}"] = "${escapeDoubleQuote(v)}"\n`
    })
  }

  if (isBodyJson(req) && req.body.raw) {
    code += `request.body = '${escapeSingleQuote(req.body.raw)}'\n`
    code += 'request["Content-Type"] = "application/json"\n'
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    code += `request.body = '${escapeSingleQuote(req.body.raw)}'\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      code += `request.body = '${escapeSingleQuote(data)}'\n`
    }
  }

  code += '\nresponse = http.request(request)\n'
  code += 'puts "Status: #{response.code}"\n'
  code += 'puts response.body'

  return code
}

function buildC(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  const urlObj = new URL(url)
  const host = urlObj.hostname
  const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')
  const path = urlObj.pathname + urlObj.search || '/'

  let code = `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\n`

  let bodyPart = ''
  if (isBodyJson(req) && req.body.raw) {
    bodyPart = req.body.raw
    code += `#define BODY "${escapeSingleQuote(bodyPart)}"\n`
    code += `#define CONTENT_TYPE "application/json"\n`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    bodyPart = req.body.raw
    code += `#define BODY "${escapeSingleQuote(bodyPart)}"\n`
    code += `#define CONTENT_TYPE "text/plain"\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      bodyPart = data
      code += `#define BODY "${escapeSingleQuote(bodyPart)}"\n`
      code += `#define CONTENT_TYPE "application/x-www-form-urlencoded"\n`
    }
  }

  code += `int main() {\n`
  code += `    int sock;\n`
  code += `    struct sockaddr_in server;\n`
  code += `    struct hostent *he;\n`
  code += `    char request[4096];\n`
  code += `    char response[8192];\n\n`

  code += `    he = gethostbyname("${escapeDoubleQuote(host)}");\n`
  code += `    if (he == NULL) {\n`
  code += `        fprintf(stderr, "Cannot resolve host\\n");\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    sock = socket(AF_INET, SOCK_STREAM, 0);\n`
  code += `    if (sock < 0) {\n`
  code += `        perror("socket");\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    server.sin_family = AF_INET;\n`
  code += `    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n`
  code += `    server.sin_port = htons(${port});\n\n`

  code += `    if (connect(sock, (struct sockaddr *)&server, sizeof(server)) < 0) {\n`
  code += `        perror("connect");\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    snprintf(request, sizeof(request),\n`
  code += `        "${req.method.toUpperCase()} ${escapeDoubleQuote(path)} HTTP/1.1\\r\\n"\n`
  code += `        "Host: ${escapeDoubleQuote(host)}\\r\\n"` + '\n'

  if (Object.keys(headers).length > 0) {
    Object.entries(headers).forEach(([k, v]) => {
      code += `        "${escapeDoubleQuote(k)}: ${escapeDoubleQuote(v)}\\r\\n"` + '\n'
    })
  }

  code += `#ifdef BODY\n`
  code += `        "Content-Type: " CONTENT_TYPE "\\r\\n"\n`
  code += `        "Content-Length: %zu\\r\\n"\n`
  code += `#endif\n`
  code += `        "Connection: close\\r\\n\\r\\n"\n`
  code += `#ifdef BODY\n`
  code += `        BODY,\n`
  code += `        strlen(BODY)\n`
  code += `#endif\n`
  code += `    );\n\n`

  code += `    send(sock, request, strlen(request), 0);\n\n`

  code += `    int n = recv(sock, response, sizeof(response) - 1, 0);\n`
  code += `    if (n > 0) {\n`
  code += `        response[n] = '\\0';\n`
  code += `        printf("%s\\n", response);\n`
  code += `    }\n\n`

  code += `    close(sock);\n`
  code += `    return 0;\n`
  code += `}\n`

  return code
}

function buildCpp(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  const urlObj = new URL(url)
  const host = urlObj.hostname
  const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')
  const path = urlObj.pathname + urlObj.search || '/'

  let code = `#include <iostream>\n#include <string>\n#include <cstring>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\n`

  let bodyPart = ''
  if (isBodyJson(req) && req.body.raw) {
    bodyPart = req.body.raw
    code += `const std::string BODY = "${escapeSingleQuote(bodyPart)}";\n`
    code += `const std::string CONTENT_TYPE = "application/json";\n`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    bodyPart = req.body.raw
    code += `const std::string BODY = "${escapeSingleQuote(bodyPart)}";\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      bodyPart = data
      code += `const std::string BODY = "${escapeSingleQuote(bodyPart)}";\n`
    }
  }

  code += `\nint main() {\n`
  code += `    int sock = socket(AF_INET, SOCK_STREAM, 0);\n`
  code += `    if (sock < 0) {\n`
  code += `        perror("socket");\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    struct hostent *he = gethostbyname("${escapeDoubleQuote(host)}");\n`
  code += `    if (!he) {\n`
  code += `        std::cerr << "Cannot resolve host" << std::endl;\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    struct sockaddr_in server;\n`
  code += `    memset(&server, 0, sizeof(server));\n`
  code += `    server.sin_family = AF_INET;\n`
  code += `    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n`
  code += `    server.sin_port = htons(${port});\n\n`

  code += `    if (connect(sock, (struct sockaddr *)&server, sizeof(server)) < 0) {\n`
  code += `        perror("connect");\n`
  code += `        return 1;\n`
  code += `    }\n\n`

  code += `    std::string request;\n`
  code += `    request += "${req.method.toUpperCase()} ${escapeDoubleQuote(path)} HTTP/1.1\\r\\n";\n`
  code += `    request += "Host: ${escapeDoubleQuote(host)}\\r\\n";\n`

  if (Object.keys(headers).length > 0) {
    Object.entries(headers).forEach(([k, v]) => {
      code += `    request += "${escapeDoubleQuote(k)}: ${escapeDoubleQuote(v)}\\r\\n";\n`
    })
  }

  code += `#ifdef BODY\n`
  code += `    request += "Content-Type: " + CONTENT_TYPE + "\\r\\n";\n`
  code += `    request += "Content-Length: " + std::to_string(BODY.size()) + "\\r\\n";\n`
  code += `#endif\n`
  code += `    request += "Connection: close\\r\\n\\r\\n";\n\n`

  code += `#ifdef BODY\n`
  code += `    request += BODY;\n`
  code += `#endif\n`

  code += `    send(sock, request.c_str(), request.size(), 0);\n\n`

  code += `    char buffer[8192];\n`
  code += `    std::string response;\n`
  code += `    ssize_t n;\n`
  code += `    while ((n = recv(sock, buffer, sizeof(buffer) - 1, 0)) > 0) {\n`
  code += `        buffer[n] = '\\0';\n`
  code += `        response += buffer;\n`
  code += `    }\n\n`

  code += `    std::cout << response << std::endl;\n`
  code += `    close(sock);\n`
  code += `    return 0;\n`
  code += `}\n`

  return code
}

function buildCSharp(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  if (isBodyFormData(req)) {
    return `// C# HttpClient does not support multipart/form-data directly without additional code.\n// Consider using the RestSharp library or manually build the multipart content.\n\nusing System;\nusing System.Net.Http;\n\nclass Program\n{\n    static async Task Main()\n    {\n        using var client = new HttpClient();\n        var request = new HttpRequestMessage(HttpMethod.${req.method}, "${escapeDoubleQuote(url)}");\n\n        // Add headers\n${Object.entries(headers).map(([k, v]) => `        request.Headers.Add("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}");`).join('\n')}
\n        Console.WriteLine("Request prepared. Add multipart content manually.");\n    }\n}\n`
  }

  let code = `using System;\nusing System.Net.Http;\nusing System.Threading.Tasks;\n\nclass Program\n{\n    static async Task Main()\n    {\n        using var client = new HttpClient();\n\n        var request = new HttpRequestMessage(HttpMethod.${req.method}, "${escapeDoubleQuote(url)}");\n\n`

  if (Object.keys(headers).length > 0) {
    code += `        // Add headers\n`
    Object.entries(headers).forEach(([k, v]) => {
      code += `        request.Headers.Add("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}");\n`
    })
    code += '\n'
  }

  if (isBodyJson(req) && req.body.raw) {
    code += `        request.Content = new StringContent(\n            "${escapeDoubleQuote(req.body.raw).replace(/"/g, '\\"')}",\n            System.Text.Encoding.UTF8,\n            "application/json"\n        );\n`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    code += `        // Binary file: ${toFilePathPlaceholder(req.body.binary.fileName)}\n`
    code += `        // var content = new ByteArrayContent(File.ReadAllBytes("${escapeDoubleQuote(toFilePathPlaceholder(req.body.binary.fileName))}"));\n`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    code += `        request.Content = new StringContent(\n            "${escapeDoubleQuote(req.body.raw).replace(/"/g, '\\"')}",\n            System.Text.Encoding.UTF8\n        );\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      code += `        request.Content = new StringContent(\n            "${escapeDoubleQuote(data)}",\n            System.Text.Encoding.UTF8,\n            "application/x-www-form-urlencoded"\n        );\n`
    }
  }

  code += `\n        var response = await client.SendAsync(request);\n`
  code += `        var body = await response.Content.ReadAsStringAsync();\n`
  code += `        Console.WriteLine($"Status: {(int)response.StatusCode}");\n`
  code += `        Console.WriteLine(body);\n`
  code += `    }\n`
  code += `}`

  return code
}

function buildKotlin(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  let code = `import java.net.URI\nimport java.net.http.HttpClient\nimport java.net.http.HttpRequest\nimport java.net.http.HttpResponse\n\nfun main() {\n    val client = HttpClient.newBuilder()\n        .build()\n\n`

  code += `    val requestBuilder = HttpRequest.newBuilder()\n        .uri(URI("${escapeDoubleQuote(url)}"))\n        .method("${req.method}", HttpRequest.BodyPublishers.noBody())\n`

  if (Object.keys(headers).length > 0) {
    Object.entries(headers).forEach(([k, v]) => {
      code += `        .header("${escapeDoubleQuote(k)}", "${escapeDoubleQuote(v)}")\n`
    })
  }

  if (isBodyJson(req) && req.body.raw) {
    code += `        .header("Content-Type", "application/json")\n`
    code += `        .POST(HttpRequest.BodyPublishers.ofString("${escapeSingleQuote(req.body.raw)}"))\n`
  } else if (isBodyBinary(req) && req.body.binary.fileName) {
    code += `        // Binary file: ${toFilePathPlaceholder(req.body.binary.fileName)}\n`
    code += `        // val fileBytes = File("${escapeDoubleQuote(toFilePathPlaceholder(req.body.binary.fileName))}").readBytes()\n`
    code += `        // .POST(HttpRequest.BodyPublishers.ofByteArray(fileBytes))\n`
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    code += `        .POST(HttpRequest.BodyPublishers.ofString("${escapeSingleQuote(req.body.raw)}"))\n`
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) {
      code += `        .header("Content-Type", "application/x-www-form-urlencoded")\n`
      code += `        .POST(HttpRequest.BodyPublishers.ofString("${escapeSingleQuote(data)}"))\n`
    }
  } else {
    code += `        .GET()\n`
  }

  code += `\n    val response = client.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString())\n`
  code += `    println("Status: ${'$'}{response.statusCode()}")\n`
  code += `    println(response.body())\n`
  code += `}`

  return code
}

function buildRust(req: RequestState): string {
  const url = resolveHttpUrl(req)
  const headers = collectHeaders(req)

  let code = `use std::io::Read;\nuse std::net::TcpStream;\nuse std::io::Write;\n\nfn main() {\n`

  const urlObj = new URL(url)
  const host = urlObj.hostname
  const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80')
  const path = urlObj.pathname + urlObj.search || '/'

  code += `    let url = "${escapeDoubleQuote(url)}";\n`
  code += `    let host = "${escapeDoubleQuote(host)}";\n`
  code += `    let port = ${port};\n`
  code += `    let path = "${escapeDoubleQuote(path)}";\n\n`

  code += `    let mut stream = TcpStream::connect(format!("{}:{}", host, port)).expect("Failed to connect");\n`
  code += `    stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).ok();\n\n`

  let bodyPart = ''
  if (isBodyJson(req) && req.body.raw) {
    bodyPart = req.body.raw
  } else if (resolveBodyKind(req) !== 'none' && req.body.raw) {
    bodyPart = req.body.raw
  } else if (isBodyUrlencoded(req)) {
    const data = getEnabledUrlEncodedBody(req)
    if (data) bodyPart = data
  }

  code += `    let mut request = format!(\n`
  code += `        "${req.method.toUpperCase()} {} HTTP/1.1\\r\\n"\n`
  code += `        "Host: {}\\r\\n"` + '\n'

  if (Object.keys(headers).length > 0) {
    Object.entries(headers).forEach(([k, v]) => {
      code += `        "${escapeDoubleQuote(k)}: ${escapeDoubleQuote(v)}\\r\\n"` + '\n'
    })
  }

  if (bodyPart) {
    code += `        "Content-Type: application/json\\r\\n"\n`
    code += `        "Content-Length: {}\\r\\n"\n`
    code += `        "Connection: close\\r\\n\\r\\n{}",\n`
    code += `        path, host, body_part.len(), body_part\n`
  } else {
    code += `        "Connection: close\\r\\n\\r\\n",\n`
    code += `        path, host\n`
  }
  code += `    );\n\n`

  code += `    stream.write(request.as_bytes()).expect("Failed to write");\n\n`

  code += `    let mut buffer = [0u8; 8192];\n`
  code += `    let mut response = String::new();\n`
  code += `    loop {\n`
  code += `        match stream.read(&mut buffer) {\n`
  code += `            Ok(0) => break,\n`
  code += `            Ok(n) => response.push_str(std::str::from_utf8(&buffer[..n]).unwrap_or("")),\n`
  code += `            Err(_) => break,\n`
  code += `        }\n`
  code += `    }\n\n`

  code += `    println!("{}", response);\n`
  code += `}\n\n`
  code += `// Note: For HTTPS, consider using the 'reqwest' crate.\n`
  code += `// Add to Cargo.toml: reqwest = { version = "0.11", features = ["blocking"] }`

  return code
}

function buildWsJavaScript(req: RequestState): string {
  const url = resolveWsUrl(req)
  return `const ws = new WebSocket('${escapeSingleQuote(url)}');\n\nws.onopen = () => {\n  console.log('connected');\n  ws.send('hello from client');\n};\n\nws.onmessage = (event) => {\n  console.log('received:', event.data);\n};\n\nws.onerror = (error) => {\n  console.error('WebSocket error:', error);\n};\n\nws.onclose = () => {\n  console.log('disconnected');\n};\n\n// close when needed\n// ws.close();`
}

function buildWsTypeScript(req: RequestState): string {
  const url = resolveWsUrl(req)
  return `const ws = new WebSocket('${escapeSingleQuote(url)}');\n\nws.addEventListener('open', () => {\n  console.log('connected');\n  ws.send('hello from client');\n});\n\nws.addEventListener('message', (event: MessageEvent<string>) => {\n  console.log('received:', event.data);\n});\n\nws.addEventListener('error', (event: Event) => {\n  console.error('WebSocket error:', event);\n});\n\nws.addEventListener('close', () => {\n  console.log('disconnected');\n});\n\n// ws.close();`
}

function buildWsPython(req: RequestState): string {
  const url = resolveWsUrl(req)
  return `# pip install websocket-client\nimport websocket\n\ndef on_open(ws):\n    print('connected')\n    ws.send('hello from client')\n\ndef on_message(ws, message):\n    print('received:', message)\n\ndef on_error(ws, error):\n    print('error:', error)\n\ndef on_close(ws, close_status_code, close_msg):\n    print('disconnected')\n\nws = websocket.WebSocketApp(\n    '${escapeSingleQuote(url)}',\n    on_open=on_open,\n    on_message=on_message,\n    on_error=on_error,\n    on_close=on_close,\n)\nws.run_forever()`
}

function buildWsGo(req: RequestState): string {
  const url = resolveWsUrl(req)
  return `// go get github.com/gorilla/websocket\npackage main\n\nimport (\n\t"log"\n\n\t"github.com/gorilla/websocket"\n)\n\nfunc main() {\n\tconn, _, err := websocket.DefaultDialer.Dial("${escapeDoubleQuote(url)}", nil)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer conn.Close()\n\n\terr = conn.WriteMessage(websocket.TextMessage, []byte("hello from client"))\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\n\tfor {\n\t\t_, message, err := conn.ReadMessage()\n\t\tif err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}\n\t\tlog.Printf("received: %s", string(message))\n\t}\n}`
}

function buildWsJava(req: RequestState): string {
  const url = resolveWsUrl(req)
  return `import okhttp3.*;\n\npublic class WsClient {\n  public static void main(String[] args) {\n    OkHttpClient client = new OkHttpClient();\n\n    Request request = new Request.Builder()\n      .url("${escapeDoubleQuote(url)}")\n      .build();\n\n    WebSocket ws = client.newWebSocket(request, new WebSocketListener() {\n      @Override\n      public void onOpen(WebSocket webSocket, Response response) {\n        System.out.println("connected");\n        webSocket.send("hello from client");\n      }\n\n      @Override\n      public void onMessage(WebSocket webSocket, String text) {\n        System.out.println("received: " + text);\n      }\n\n      @Override\n      public void onFailure(WebSocket webSocket, Throwable t, Response response) {\n        t.printStackTrace();\n      }\n\n      @Override\n      public void onClosed(WebSocket webSocket, int code, String reason) {\n        System.out.println("disconnected");\n      }\n    });\n\n    Runtime.getRuntime().addShutdownHook(new Thread(() -> ws.close(1000, "bye")));\n  }\n}`
}

function buildTcpJavaScript(req: RequestState): string {
  const { host, port } = parseSocketHostPort(req.url)
  return `const net = require('net');\n\nconst client = net.createConnection({ host: '${escapeSingleQuote(host)}', port: ${port} }, () => {\n  console.log('connected');\n  client.write('hello from client');\n});\n\nclient.on('data', (data) => {\n  console.log('received:', data.toString());\n});\n\nclient.on('error', (err) => {\n  console.error('error:', err.message);\n});\n\nclient.on('close', () => {\n  console.log('disconnected');\n});\n\n// client.end();`
}

function buildUdpJavaScript(req: RequestState): string {
  const { host, port } = parseSocketHostPort(req.url)
  return `const dgram = require('dgram');\n\nconst client = dgram.createSocket('udp4');\n\nclient.on('message', (msg, rinfo) => {\n  console.log('received:', msg.toString(), 'from', rinfo.address + ':' + rinfo.port);\n});\n\nclient.on('error', (err) => {\n  console.error('error:', err.message);\n  client.close();\n});\n\nconst payload = Buffer.from('hello from client');\nclient.send(payload, ${port}, '${escapeSingleQuote(host)}', (err) => {\n  if (err) {\n    console.error('send error:', err.message);\n  } else {\n    console.log('sent');\n  }\n});\n\n// close when needed\n// setTimeout(() => client.close(), 1000);`
}

function buildSocketTypeScript(req: RequestState): string {
  if (req.method === 'WS') {
    return buildWsTypeScript(req)
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `import net from 'node:net';\n\nconst client = net.createConnection({ host: '${escapeSingleQuote(host)}', port: ${port} }, () => {\n  console.log('connected');\n  client.write('hello from client');\n});\n\nclient.on('data', (data: Buffer) => {\n  console.log('received:', data.toString());\n});\n\nclient.on('error', (err: Error) => {\n  console.error('error:', err.message);\n});\n\nclient.on('close', () => {\n  console.log('disconnected');\n});`
  }

  return `import dgram from 'node:dgram';\n\nconst client = dgram.createSocket('udp4');\n\nclient.on('message', (msg: Buffer, rinfo) => {\n  console.log('received:', msg.toString(), 'from', rinfo.address + ':' + rinfo.port);\n});\n\nclient.on('error', (err: Error) => {\n  console.error('error:', err.message);\n  client.close();\n});\n\nconst payload = Buffer.from('hello from client');\nclient.send(payload, ${port}, '${escapeSingleQuote(host)}', (err?: Error) => {\n  if (err) {\n    console.error('send error:', err.message);\n  } else {\n    console.log('sent');\n  }\n});`
}

function buildSocketPython(req: RequestState): string {
  if (req.method === 'WS') {
    return buildWsPython(req)
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `import socket\n\nhost = '${escapeSingleQuote(host)}'\nport = ${port}\n\nwith socket.create_connection((host, port)) as sock:\n    print('connected')\n    sock.sendall(b'hello from client')\n    data = sock.recv(4096)\n    print('received:', data.decode('utf-8', errors='replace'))`
  }

  return `import socket\n\nhost = '${escapeSingleQuote(host)}'\nport = ${port}\n\nsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)\ntry:\n    sock.sendto(b'hello from client', (host, port))\n    print('sent')\n\n    # if server replies\n    sock.settimeout(3)\n    data, addr = sock.recvfrom(4096)\n    print('received:', data.decode('utf-8', errors='replace'), 'from', addr)\nexcept socket.timeout:\n    print('no response (timeout)')\nfinally:\n    sock.close()`
}

function buildSocketGo(req: RequestState): string {
  if (req.method === 'WS') {
    return buildWsGo(req)
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"net"\n\t"os"\n)\n\nfunc main() {\n\tconn, err := net.Dial("tcp", "${escapeDoubleQuote(host)}:${port}")\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer conn.Close()\n\n\tfmt.Fprintln(conn, "hello from client")\n\n\treader := bufio.NewReader(conn)\n\tline, err := reader.ReadString('\\n')\n\tif err != nil {\n\t\tfmt.Println("received (raw):", err)\n\t\tos.Exit(0)\n\t}\n\tfmt.Println("received:", line)\n}`
  }

  return `package main\n\nimport (\n\t"fmt"\n\t"net"\n\t"time"\n)\n\nfunc main() {\n\tconn, err := net.Dial("udp", "${escapeDoubleQuote(host)}:${port}")\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer conn.Close()\n\n\t_, err = conn.Write([]byte("hello from client"))\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tfmt.Println("sent")\n\n\t_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))\n\tbuf := make([]byte, 4096)\n\tn, err := conn.Read(buf)\n\tif err != nil {\n\t\tfmt.Println("no response:", err)\n\t\treturn\n\t}\n\tfmt.Println("received:", string(buf[:n]))\n}`
}

function buildSocketJava(req: RequestState): string {
  if (req.method === 'WS') {
    return buildWsJava(req)
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `import java.io.*;\nimport java.net.Socket;\n\npublic class TcpClient {\n  public static void main(String[] args) throws Exception {\n    try (Socket socket = new Socket("${escapeDoubleQuote(host)}", ${port})) {\n      System.out.println("connected");\n\n      OutputStream out = socket.getOutputStream();\n      out.write("hello from client".getBytes());\n      out.flush();\n\n      InputStream in = socket.getInputStream();\n      byte[] buffer = new byte[4096];\n      int n = in.read(buffer);\n      if (n > 0) {\n        System.out.println("received: " + new String(buffer, 0, n));\n      }\n    }\n  }\n}`
  }

  return `import java.net.*;\n\npublic class UdpClient {\n  public static void main(String[] args) throws Exception {\n    try (DatagramSocket socket = new DatagramSocket()) {\n      byte[] payload = "hello from client".getBytes();\n      InetAddress address = InetAddress.getByName("${escapeDoubleQuote(host)}");\n\n      DatagramPacket packet = new DatagramPacket(payload, payload.length, address, ${port});\n      socket.send(packet);\n      System.out.println("sent");\n\n      socket.setSoTimeout(3000);\n      byte[] buf = new byte[4096];\n      DatagramPacket response = new DatagramPacket(buf, buf.length);\n      try {\n        socket.receive(response);\n        System.out.println("received: " + new String(response.getData(), 0, response.getLength()));\n      } catch (SocketTimeoutException e) {\n        System.out.println("no response (timeout)");\n      }\n    }\n  }\n}`
}

function buildSocketPowerShell(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `# PowerShell WebSocket requires .NET HttpClient with ClientWebSocket\n$uri = [System.Uri]"${escapeSingleQuote(url)}"\n$ws = [System.Net.WebSockets.ClientWebSocket]::new()\n$ct = [Threading.CancellationToken]::None\n$ws.ConnectAsync($uri, $ct).Wait()\n\n$msg = [System.Text.Encoding]::UTF8.GetBytes("hello from client")\n$ws.SendAsync([ArraySegment[byte]]$msg, 'Text', $true, $ct).Wait()\n\n$buf = [byte[]]::new(4096)\n$res = $ws.ReceiveAsync([ArraySegment[byte]]$buf, $ct)\n$res.Wait()\n$text = [System.Text.Encoding]::UTF8.GetString($buf, 0, $res.Result.Count)\nWrite-Host "received: $text"\n\n$ws.CloseAsync('NormalClosure', "", $ct).Wait()`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `# PowerShell TCP using .NET TcpClient\n$host = "${escapeSingleQuote(host)}"\n$port = ${port}\n$client = [System.Net.Sockets.TcpClient]::new()\n$client.Connect($host, $port)\n$stream = $client.GetStream()\n$writer = [System.IO.StreamWriter]::new($stream)\n$reader = [System.IO.StreamReader]::new($stream)\n\n$writer.WriteLine("hello from client")\n$writer.Flush()\n\n$response = $reader.ReadLine()\nWrite-Host "received: $response"\n\n$client.Close()`
  }

  return `# PowerShell UDP using .NET UdpClient\n$host = "${escapeSingleQuote(host)}"\n$port = ${port}\n$client = [System.Net.Sockets.UdpClient]::new()\n$msg = [System.Text.Encoding]::UTF8.GetBytes("hello from client")\n$client.Send($msg, $msg.Length, $host, $port) | Out-Null\nWrite-Host "sent"\n\n$client.Client.ReceiveTimeout = 3000\ntry {\n    $result = $client.Receive([ref][System.Net.IPEndpoint]::Any)\n    $text = [System.Text.Encoding]::UTF8.GetString($result)\n    Write-Host "received: $text"\n} catch {\n    Write-Host "no response (timeout)"\n}\n$client.Close()`
}

function buildSocketPhp(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `# PHP WebSocket requires extension (e.g. ratchet) or custom implementation\n// For basic usage, consider using the 'ws' tool: npm install -g ws\n// Then: wscat -c '${escapeSingleQuote(url)}'\n\necho "PHP does not have built-in WebSocket client.\\n";\necho "Install a WebSocket library or use CLI tools.\\n";`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `<?php\n\n$host = "${escapeSingleQuote(host)}";\n$port = ${port};\n\n$socket = @fsockopen($host, $port, $errno, $errstr, 5);\nif (!$socket) {\n    echo "Failed to connect: $errstr ($errno)\\n";\n    exit(1);\n}\n\necho "Connected\\n";\nfwrite($socket, "hello from client\\n");\n\n$response = fgets($socket, 1024);\necho "Received: " . $response;\n\nfclose($socket);\n?>\n`
  }

  return `<?php\n\n$host = "${escapeSingleQuote(host)}";\n$port = ${port};\n\n$socket = @socket_create(AF_INET, SOCK_DGRAM, 0);\nif (!$socket) {\n    echo "Failed to create socket\\n";\n    exit(1);\n}\n\n$message = "hello from client";\nsocket_sendto($socket, $message, strlen($message), 0, $host, $port);\necho "Sent\\n";\n\nsocket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, array("sec" => 3, "usec" => 0));\n$buf = "";\n$from = "";\n$port = 0;\n\nif (@socket_recvfrom($socket, $buf, 4096, 0, $from, $port) !== false) {\n    echo "Received: " . $buf . " from " . $from . "\\n";\n} else {\n    echo "No response (timeout)\\n";\n}\n\nsocket_close($socket);\n?>\n`
}

function buildSocketRuby(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `# Ruby WebSocket requires 'websocket' gem\n# Install: gem install websocket\n# Or add to Gemfile: gem 'websocket'\n\nrequire 'websocket'\n\nws = WebSocket::Client::Simple.connect('${escapeSingleQuote(url)}')\n\nws.on_open do\n  puts 'connected'\n  ws.send 'hello from client'\nend\n\nws.on_message do |msg|\n  puts 'received: ' + msg.data\nend\n\nws.on_error do |e|\n  puts 'error: ' + e.message\nend\n\nws.on_close do\n  puts 'disconnected'\nend\n\nsleep`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `require 'socket'\n\nhost = '${escapeSingleQuote(host)}'\nport = ${port}\n\nbegin\n  sock = TCPSocket.new(host, port)\n  puts 'connected'\n  sock.write("hello from client\\n")\n  \n  response = sock.gets\n  puts "received: #{response}"\n  \n  sock.close\nrescue => e\n  puts "Error: #{e.message}"\nend`
  }

  return `require 'socket'\n\nhost = '${escapeSingleQuote(host)}'\nport = ${port}\n\nbegin\n  sock = UDPSocket.new\n  sock.send("hello from client", 0, host, port)\n  puts 'sent'\n  \n  sock.setsockopt(Socket::SO_RCVTIMEO, 3000)\n  begin\n    msg, _ = sock.recvfrom(4096)\n    puts "received: #{msg}"\n  rescue TimeoutError\n    puts 'no response (timeout)'\n  end\n  \n  sock.close\nrescue => e\n  puts "Error: #{e.message}"\nend`
}

function buildSocketC(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `// C WebSocket: basic handshake via sockets, requires OpenSSL for wss://\n// For production, consider libwebsockets or websocket-client\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\nint main() {\n    // Note: C has no built-in WebSocket support.\n    // Use a library like libwebsockets, or implement handshake manually.\n    // For simple testing, consider using 'websocat' tool instead.\n    printf("WebSocket requires library support. Install libwebsockets.\\n");\n    return 0;\n}\n`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\nint main() {\n    int sock;\n    struct sockaddr_in server;\n    struct hostent *he;\n    char buffer[4096];\n\n    he = gethostbyname("${escapeDoubleQuote(host)}");\n    if (!he) { fprintf(stderr, "Cannot resolve host\\n"); return 1; }\n\n    sock = socket(AF_INET, SOCK_STREAM, 0);\n    if (sock < 0) { perror("socket"); return 1; }\n\n    server.sin_family = AF_INET;\n    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n    server.sin_port = htons(${port});\n\n    if (connect(sock, (struct sockaddr *)&server, sizeof(server)) < 0) {\n        perror("connect"); return 1;\n    }\n\n    printf("connected\\n");\n    send(sock, "hello from client\\n", 18, 0);\n\n    int n = recv(sock, buffer, sizeof(buffer) - 1, 0);\n    if (n > 0) { buffer[n] = '\\0'; printf("received: %s", buffer); }\n\n    close(sock);\n    return 0;\n}`
  }

  return `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\nint main() {\n    int sock;\n    struct sockaddr_in server;\n    struct hostent *he;\n    char buffer[4096];\n    socklen_t len = sizeof(server);\n\n    he = gethostbyname("${escapeDoubleQuote(host)}");\n    if (!he) { fprintf(stderr, "Cannot resolve host\\n"); return 1; }\n\n    sock = socket(AF_INET, SOCK_DGRAM, 0);\n    if (sock < 0) { perror("socket"); return 1; }\n\n    server.sin_family = AF_INET;\n    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n    server.sin_port = htons(${port});\n\n    const char *msg = "hello from client";\n    sendto(sock, msg, strlen(msg), 0, (struct sockaddr *)&server, sizeof(server));\n    printf("sent\\n");\n\n    struct timeval tv = {3, 0};\n    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));\n\n    int n = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (struct sockaddr *)&server, &len);\n    if (n > 0) { buffer[n] = '\\0'; printf("received: %s", buffer); }\n    else printf("no response (timeout)\\n");\n\n    close(sock);\n    return 0;\n}`
}

function buildSocketCpp(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `// C++ WebSocket: requires Boost.Beast or libwebsocket\n// Basic implementation using Boost.Beast:\n// #include <boost/beast/websocket.hpp>\n// For production, use a WebSocket library.\n// For simple testing, use 'websocat' tool instead.\n\n#include <iostream>\n\nint main() {\n    std::cout << "C++ WebSocket requires library support (e.g. Boost.Beast).\\n";\n    std::cout << "For simple testing: websocat ws://${escapeSingleQuote(url)}\\n";\n    return 0;\n}\n`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `#include <iostream>\n#include <string>\n#include <cstring>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\nint main() {\n    int sock = socket(AF_INET, SOCK_STREAM, 0);\n    if (sock < 0) { perror("socket"); return 1; }\n\n    struct hostent *he = gethostbyname("${escapeDoubleQuote(host)}");\n    if (!he) { std::cerr << "Cannot resolve host" << std::endl; return 1; }\n\n    struct sockaddr_in server;\n    memset(&server, 0, sizeof(server));\n    server.sin_family = AF_INET;\n    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n    server.sin_port = htons(${port});\n\n    if (connect(sock, (struct sockaddr *)&server, sizeof(server)) < 0) {\n        perror("connect"); return 1;\n    }\n\n    std::cout << "connected" << std::endl;\n    std::string msg = "hello from client\\n";\n    send(sock, msg.c_str(), msg.size(), 0);\n\n    char buffer[4096];\n    ssize_t n = recv(sock, buffer, sizeof(buffer) - 1, 0);\n    if (n > 0) { buffer[n] = '\\0'; std::cout << "received: " << buffer; }\n\n    close(sock);\n    return 0;\n}`
  }

  return `#include <iostream>\n#include <string>\n#include <cstring>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <netdb.h>\n#include <unistd.h>\n\nint main() {\n    int sock = socket(AF_INET, SOCK_DGRAM, 0);\n    if (sock < 0) { perror("socket"); return 1; }\n\n    struct hostent *he = gethostbyname("${escapeDoubleQuote(host)}");\n    if (!he) { std::cerr << "Cannot resolve host" << std::endl; return 1; }\n\n    struct sockaddr_in server;\n    memset(&server, 0, sizeof(server));\n    server.sin_family = AF_INET;\n    memcpy(&server.sin_addr, he->h_addr, he->h_length);\n    server.sin_port = htons(${port});\n\n    std::string msg = "hello from client";\n    sendto(sock, msg.c_str(), msg.size(), 0, (struct sockaddr *)&server, sizeof(server));\n    std::cout << "sent" << std::endl;\n\n    struct timeval tv = {3, 0};\n    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));\n\n    char buffer[4096];\n    socklen_t len = sizeof(server);\n    ssize_t n = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (struct sockaddr *)&server, &len);\n    if (n > 0) { buffer[n] = '\\0'; std::cout << "received: " << buffer; }\n    else std::cout << "no response (timeout)" << std::endl;\n\n    close(sock);\n    return 0;\n}`
}

function buildSocketCSharp(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `using System;\nusing System.Net;\nusing System.Net.WebSockets;\nusing System.Text;\nusing System.Threading;\nusing System.Threading.Tasks;\n\nclass Program\n{\n    static async Task Main()\n    {\n        using var client = new HttpClient();\n        // Note: System.Net.WebSockets.ClientWebSocket requires HttpListener or custom handshake\n        Console.WriteLine("C# WebSocket requires ClientWebSocket with custom connection.");\n        Console.WriteLine("For simple testing: dotnet add package System.Net.WebSockets.ClientWebSocket");\n        \n        var uri = new Uri("${escapeDoubleQuote(url)}");\n        using var ws = new ClientWebSocket();\n        \n        await ws.ConnectAsync(uri, CancellationToken.None);\n        \n        var msg = Encoding.UTF8.GetBytes("hello from client");\n        await ws.SendAsync(new ArraySegment<byte>(msg), WebSocketMessageType.Text, true, CancellationToken.None);\n        \n        var buffer = new byte[4096];\n        var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);\n        var text = Encoding.UTF8.GetString(buffer, 0, result.Count);\n        Console.WriteLine($"received: {text}");\n        \n        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);\n    }\n}`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `using System;\nusing System.Net.Sockets;\n\nclass Program\n{\n    static void Main()\n    {\n        try\n        {\n            using var client = new TcpClient("${escapeDoubleQuote(host)}", ${port});\n            using var stream = client.GetStream();\n            using var reader = new StreamReader(stream);\n            using var writer = new StreamWriter(stream);\n\n            Console.WriteLine("connected");\n            writer.WriteLine("hello from client");\n            writer.Flush();\n\n            var response = reader.ReadLine();\n            Console.WriteLine($"received: {response}");\n        }\n        catch (Exception ex)\n        {\n            Console.WriteLine($"Error: {ex.Message}");\n        }\n    }\n}`
  }

  return `using System;\nusing System.Net;\nusing System.Net.Sockets;\n\nclass Program\n{\n    static void Main()\n    {\n        try\n        {\n            using var client = new UdpClient();\n            var host = IPAddress.Parse("${escapeDoubleQuote(host)}");\n            var endpoint = new IPEndPoint(host, ${port});\n\n            var msg = Encoding.UTF8.GetBytes("hello from client");\n            client.Send(msg, msg.Length, endpoint);\n            Console.WriteLine("sent");\n\n            client.Client.ReceiveTimeout = 3000;\n            try\n            {\n                var result = client.Receive(ref endpoint);\n                var text = Encoding.UTF8.GetString(result);\n                Console.WriteLine($"received: {text} from {endpoint}");\n            }\n            catch (SocketException)\n            {\n                Console.WriteLine("no response (timeout)");\n            }\n        }\n        catch (Exception ex)\n        {\n            Console.WriteLine($"Error: {ex.Message}");\n        }\n    }\n}`
}

function buildSocketKotlin(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `// Kotlin WebSocket requires OkHttp (included in build)
import okhttp3.*
import java.util.concurrent.TimeUnit

fun main() {
    val client = OkHttpClient.Builder()
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val request = Request.Builder()
        .url("${escapeDoubleQuote(url)}")
        .build()

    val ws = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            println("connected")
            webSocket.send("hello from client")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            println("received: " + text)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            println("error: " + t.message)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            println("disconnected")
        }
    })

    Thread.sleep(5000)
    ws.close(1000, "bye")
}`
  }

  const { host: kotlinHost, port: kotlinPort } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `import java.net.Socket

fun main() {
    val host = "${escapeDoubleQuote(kotlinHost)}"
    val port = ${kotlinPort}

    try {
        Socket(host, port).use { socket ->
            println("connected")
            val output = socket.getOutputStream()
            output.write("hello from client\\n".toByteArray())
            output.flush()

            val input = socket.getInputStream()
            val buffer = ByteArray(4096)
            val n = input.read(buffer)
            if (n > 0) {
                println("received: " + String(buffer, 0, n))
            }
        }
    } catch (e: Exception) {
        println("Error: " + e.message)
    }
}`
  }

  return `import java.net.DatagramSocket
import java.net.InetAddress

fun main() {
    val host = "${escapeDoubleQuote(kotlinHost)}"
    val port = ${kotlinPort}

    try {
        DatagramSocket().use { socket ->
            val message = "hello from client".toByteArray()
            val address = InetAddress.getByName(host)
            val packet = DatagramPacket(message, message.size, address, port)
            socket.send(packet)
            println("sent")

            socket.soTimeout = 3000
            val buffer = ByteArray(4096)
            val response = DatagramPacket(buffer, buffer.size)
            try {
                socket.receive(response)
                println("received: " + String(response.data, 0, response.length))
            } catch (e: Exception) {
                println("no response (timeout)")
            }
        }
    } catch (e: Exception) {
        println("Error: " + e.message)
    }
}`
}

function buildSocketRust(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `// Rust WebSocket requirestokio-tungstenite or websocket crate\n// Add to Cargo.toml:\n// tokio = { version = "1", features = ["full"] }\n// tokio-tungstenite = "0.21"\n// futures-util = "0.3"\n\nuse std::time::Duration;\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    let url = "${escapeSingleQuote(url)}";\n    let (ws, _) = tokio_tungstenite::connect_async(url).await?;\n    \n    println!("connected");\n    \n    ws.send(tokio_tungstenite::tungstenite::Message::Text("hello from client".to_string())).await?;\n    \n    if let Some(msg) = ws.next().await {\n        match msg {\n            Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {\n                println!("received: {}", text);\n            }\n            _ => {}\n        }\n    }\n    \n    Ok(())\n}\n\n// For std (non-async), use 'websocket' crate instead.\n// Or use websocat CLI tool: cargo install websocat`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `use std::io::{Read, Write};\nuse std::net::TcpStream;\n\nfn main() {\n    let addr = format!("${escapeDoubleQuote(host)}:${port}");\n    match TcpStream::connect(&addr) {\n        Ok(mut stream) => {\n            println!("connected");\n            stream.write(b"hello from client\\n").unwrap();\n            stream.flush().unwrap();\n\n            let mut buffer = [0u8; 4096];\n            match stream.read(&mut buffer) {\n                Ok(n) => {\n                    let response = std::str::from_utf8(&buffer[..n]).unwrap_or("");\n                    println!("received: {}", response);\n                }\n                Err(e) => println!("Error reading: {}", e),\n            }\n        }\n        Err(e) => println!("Failed to connect: {}", e),\n    }\n}`
  }

  return `use std::net::UdpSocket;\nuse std::time::Duration;\n\nfn main() {\n    let host = "${escapeDoubleQuote(host)}";\n    let port = ${port};\n    let addr = format!("{}:{}", host, port);\n\n    match UdpSocket::bind("0.0.0.0:0") {\n        Ok(socket) => {\n            socket.set_read_timeout(Some(Duration::from_secs(3))).ok();\n\n            socket.send_to(b"hello from client", &addr).unwrap();\n            println!("sent");\n\n            let mut buf = [0u8; 4096];\n            match socket.recv_from(&mut buf) {\n                Ok((n, _)) => {\n                    let response = std::str::from_utf8(&buf[..n]).unwrap_or("");\n                    println!("received: {}", response);\n                }\n                Err(e) => println!("no response (timeout): {}", e),\n            }\n        }\n        Err(e) => println!("Error: {}", e),\n    }\n}`
}

function buildSocketCurlLike(req: RequestState): string {
  if (req.method === 'WS') {
    const url = resolveWsUrl(req)
    return `# Install: https://github.com/vi/websocat\nwebsocat '${escapeSingleQuote(url)}'\n# Then type messages and press Enter to send.`
  }

  const { host, port } = parseSocketHostPort(req.url)
  if (req.method === 'TCP') {
    return `# netcat (TCP)\nprintf 'hello from client' | nc ${escapeSingleQuote(host)} ${port}`
  }

  return `# netcat (UDP)\nprintf 'hello from client' | nc -u ${escapeSingleQuote(host)} ${port}`
}

function buildSocketByLanguage(req: RequestState, language: CodeLanguage): string {
  switch (language) {
    case 'curl':
      return buildSocketCurlLike(req)
    case 'wget':
      return buildSocketCurlLike(req)
    case 'powershell':
      return buildSocketPowerShell(req)
    case 'php':
      return buildSocketPhp(req)
    case 'ruby':
      return buildSocketRuby(req)
    case 'c':
      return buildSocketC(req)
    case 'cpp':
      return buildSocketCpp(req)
    case 'csharp':
      return buildSocketCSharp(req)
    case 'kotlin':
      return buildSocketKotlin(req)
    case 'rust':
      return buildSocketRust(req)
    case 'javascript':
    case 'javascriptAxios':
      if (req.method === 'WS') return buildWsJavaScript(req)
      if (req.method === 'TCP') return buildTcpJavaScript(req)
      return buildUdpJavaScript(req)
    case 'typescriptFetch':
      return buildSocketTypeScript(req)
    case 'python':
      return buildSocketPython(req)
    case 'go':
      return buildSocketGo(req)
    case 'javaOkHttp':
      return buildSocketJava(req)
    default:
      return ''
  }
}

export type CodeLanguage =
  | 'curl'
  | 'wget'
  | 'powershell'
  | 'php'
  | 'ruby'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'kotlin'
  | 'rust'
  | 'javascript'
  | 'javascriptAxios'
  | 'typescriptFetch'
  | 'python'
  | 'go'
  | 'javaOkHttp'

export function generateCode(req: RequestState, language: CodeLanguage): string {
  if (isSocketMethod(req.method)) {
    return buildSocketByLanguage(req, language)
  }

  if (!isHttpMethod(req.method)) {
    return `// Unsupported request method: ${req.method}`
  }

  switch (language) {
    case 'curl':
      return buildCurl(req)
    case 'wget':
      return buildWget(req)
    case 'powershell':
      return buildPowerShell(req)
    case 'php':
      return buildPhp(req)
    case 'ruby':
      return buildRuby(req)
    case 'c':
      return buildC(req)
    case 'cpp':
      return buildCpp(req)
    case 'csharp':
      return buildCSharp(req)
    case 'kotlin':
      return buildKotlin(req)
    case 'rust':
      return buildRust(req)
    case 'javascript':
      return buildFetch(req)
    case 'javascriptAxios':
      return buildAxios(req)
    case 'typescriptFetch':
      return buildTypeScriptFetch(req)
    case 'python':
      return buildPython(req)
    case 'go':
      return buildGo(req)
    case 'javaOkHttp':
      return buildJavaOkHttp(req)
    default:
      return ''
  }
}
