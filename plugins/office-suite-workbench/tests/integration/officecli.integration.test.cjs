'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createOfficeCliRunner } = require('../../preload/officecli-runner.cjs')
const { registerOfficeDocumentTool } = require('../../preload/services.cjs')

const runner = createOfficeCliRunner()

async function requireRuntime(t) {
  const status = await runner.getStatus()
  if (!status.ok || !status.data.installed) {
    t.skip('OfficeCLI is not installed on this machine')
    return false
  }
  return true
}

async function expectRun(command) {
  const result = await runner.run(command, { timeoutMs: 120_000 })
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error))
  return result.data
}

test('creates and validates Word, Excel and PowerPoint golden smoke files', async (t) => {
  if (!(await requireRuntime(t))) return

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-office-suite-'))
  const docx = path.join(directory, 'Word 金样.docx')
  const xlsx = path.join(directory, 'Excel 金样.xlsx')
  const pptx = path.join(directory, 'PowerPoint 金样.pptx')

  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  await expectRun(['create', docx])
  await expectRun(['add', docx, '/body', '--type', 'paragraph', '--prop', 'text=ZTools Office Suite'])
  const wordText = await expectRun(['view', docx, 'text'])
  assert.match(wordText.stdout, /ZTools Office Suite/u)
  await expectRun(['validate', docx, '--json'])

  await expectRun(['create', xlsx])
  await expectRun(['set', xlsx, '/Sheet1/A1', '--prop', 'value=21'])
  await expectRun(['set', xlsx, '/Sheet1/B1', '--prop', 'formula=A1*2'])
  const excelCell = await expectRun(['get', xlsx, '/Sheet1/B1', '--json'])
  assert.match(excelCell.stdout, /A1\*2/u)
  await expectRun(['query', xlsx, 'cell:has(formula)', '--json'])
  await expectRun(['get', xlsx, '/sheet[1]', '--depth', '2', '--json'])
  await expectRun(['validate', xlsx, '--json'])

  await expectRun(['create', pptx])
  await expectRun(['add', pptx, '/', '--type', 'slide', '--prop', 'title=ZTools Office Suite'])
  const deckOutline = await expectRun(['view', pptx, 'outline'])
  assert.match(deckOutline.stdout, /ZTools Office Suite/u)
  await expectRun(['get', pptx, '/', '--depth', '1', '--json'])
  await expectRun(['query', pptx, 'picture:no-alt', '--json'])
  await expectRun(['validate', pptx, '--json'])
})

test('completes the OfficeCLI native MCP initialize and tools/list handshake', async (t) => {
  if (!(await requireRuntime(t))) return
  const result = await runner.probeMcp({ timeoutMs: 15_000 })
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error))
  assert.equal(result.data.serverInfo.name, 'officecli')
  assert.deepEqual(result.data.toolNames, ['officecli'])
})

test('executes the ZTools office_document handler through the real guarded runner', async (t) => {
  if (!(await requireRuntime(t))) return
  let registeredName = null
  let registeredHandler = null
  const target = {
    ztools: {
      registerTool(name, handler) {
        registeredName = name
        registeredHandler = handler
      }
    }
  }

  assert.equal(registerOfficeDocumentTool(target, runner), true)
  assert.equal(registeredName, 'office_document')
  const response = await registeredHandler({ command: ['help', 'docx', 'paragraph'] })
  assert.equal(response.ok, true)
  assert.match(response.stdout, /paragraph/iu)
  await assert.rejects(
    registeredHandler({ command: ['get', 'relative.docx', '/'] }),
    (error) => error.code === 'MCP_ABSOLUTE_PATH_REQUIRED'
  )
})
