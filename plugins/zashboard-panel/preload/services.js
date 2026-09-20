'use strict';
const { Client } = require('ssh2');

var CONNECT_TIMEOUT = 12000;
var MENU_TIMEOUT = 15000;
var STEP_TIMEOUT = 30000;
var GLOBAL_TIMEOUT = 60000;

function friendlyError(err, cfg) {
  if (!err) return '未知错误';
  var msg = String(err.message || err);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/.test(msg)) {
    return '无法连接路由器（' + cfg.host + ':' + cfg.port + '），请检查 SSH 地址与端口';
  }
  if (/All configured authentication|Authentication failed|Permission denied|password/i.test(msg)) {
    return 'SSH 认证失败，请检查账号与密码';
  }
  return msg;
}

function connect(cfg) {
  return new Promise(function (resolve, reject) {
    var c = new Client();
    var timer = setTimeout(function () {
      try { c.end(); } catch (e) {}
      reject(new Error('SSH 连接超时'));
    }, CONNECT_TIMEOUT);
    c.on('ready', function () {
      clearTimeout(timer);
      resolve(c);
    });
    c.on('error', function (err) {
      clearTimeout(timer);
      reject(err);
    });
    c.connect({
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 22,
      username: cfg.user || 'root',
      password: cfg.pass || '',
      readyTimeout: 10000
    });
  });
}

// 按步骤驱动 PTY 交互
function runTui(client, steps, globalTimeout, onOutput, onStep) {
  return new Promise(function (resolve, reject) {
    var buf = '';
    var stepIdx = 0;
    var settled = false;
    var stepTimer = null;
    var shellStream = null;

    function settle(err) {
      if (settled) return;
      settled = true;
      clearTimeout(globalTimer);
      clearStepTimeout();
      try { client.end(); } catch (e) {}
      if (err) reject(err);
      else resolve(buf);
    }
    function clearStepTimeout() {
      if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    }
    function nextStep() {
      clearStepTimeout();
      if (settled) return;
      if (stepIdx >= steps.length) { settle(); return; }
      var step = steps[stepIdx];
      if (onStep) { try { onStep(stepIdx, step.label || ''); } catch (e) {} }
      if (step.send !== undefined) {
        shellStream.write(step.send + '\r');
        if (onOutput) { try { onOutput('[发送] ' + step.send + '\r\n'); } catch (e) {} }
      }
      step.marker = buf.length;
      if (step.sleep !== undefined) {
        stepTimer = setTimeout(function () { stepIdx++; nextStep(); }, step.sleep);
        return;
      }
      if (step.expect) {
        stepTimer = setTimeout(function () {
          if (step.optional) { stepIdx++; nextStep(); }
          else settle(new Error('执行「' + (step.label || '') + '」超时（未识别到预期输出）'));
        }, step.timeout || STEP_TIMEOUT);
      } else {
        stepIdx++;
        nextStep();
      }
    }

    var globalTimer = setTimeout(function () {
      settle(new Error('SSH 操作整体超时'));
    }, globalTimeout || GLOBAL_TIMEOUT);

    client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
      if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }
      shellStream = stream;
      stream.on('data', function (d) {
        var text = d.toString('utf8');
        buf += text;
        if (onOutput) {
          try { onOutput(text); } catch (e) {}
        }
        var step = steps[stepIdx];
        if (step && step.expect && step.marker !== undefined) {
          var fresh = buf.slice(step.marker);
          if (step.expect.test(fresh)) { stepIdx++; nextStep(); }
        }
      });
      stream.on('close', function () {
        if (!settled) { settle(); }
      });
      // 等待 PTY 就绪后开始交互
      setTimeout(nextStep, 400);
    });
  });
}

// 通用步骤执行器：前端步骤类型 → runTui 格式
// 前端类型：输入指令/输入数字/输入文本 → send；等待输出 → expect；等待时间 → sleep
function runSteps(cfg, steps, onOutput) {
  return connect(cfg).then(function (client) {
    if (onOutput) {
      try { onOutput('\r\n[连接成功] ' + cfg.host + ':' + (cfg.port || 22) + '\r\n'); } catch (e) {}
    }
    var tuiSteps = steps.map(function (s) {
      var type = s.type || '';
      if (type === '等待时间') {
        return { label: s.desc || '等待', sleep: parseInt(s.content, 10) || 1000 };
      } else if (type === '等待输出') {
        var re;
        try { re = new RegExp(s.content, 'i'); } catch (e) { re = new RegExp(s.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
        return { label: s.desc || '等待输出', expect: re, timeout: STEP_TIMEOUT };
      } else {
        // 输入指令/数字/文本
        return { label: s.desc || '发送 ' + s.content, send: s.content };
      }
    });
    return runTui(client, tuiSteps, GLOBAL_TIMEOUT, onOutput);
  }).then(function (out) {
    return { ok: true, output: out.slice(-2000) };
  }).catch(function (err) {
    if (onOutput) { try { onOutput('\r\n[失败] ' + friendlyError(err, cfg) + '\r\n'); } catch (e) {} }
    return { ok: false, error: friendlyError(err, cfg) };
  });
}

// 重启服务：crash → 菜单 → 1（重启成功后菜单自动退出）
function restartService(cfg, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    if (onOutput) { try { onOutput('\r\n[连接成功] ' + cfg.host + ':' + (cfg.port || 22) + '\r\n'); } catch (e) {} }
    var steps = [
      { label: '进入 ShellCrash 菜单', send: cfg.cmd || 'crash' },
      { label: '等待菜单出现', expect: /请输入|请选择|菜单/i, timeout: MENU_TIMEOUT },
      { label: '选择 1 重启服务', send: '1' },
      { label: '等待重启完成', expect: /已启动|已停止|已重启|成功|完成|请选择|请输入|返回|done|start/i, timeout: STEP_TIMEOUT }
    ];
    return runTui(client, steps, GLOBAL_TIMEOUT, onOutput, onStep);
  }).then(function (out) {
    return { ok: true, output: out.slice(-2000) };
  }).catch(function (err) {
    if (onOutput) { try { onOutput('\r\n[失败] ' + friendlyError(err, cfg) + '\r\n'); } catch (e) {} }
    return { ok: false, error: friendlyError(err, cfg) };
  });
}

// 停止服务：crash → 菜单 → 3 → 等回菜单 → 0 退出
function stopService(cfg, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    if (onOutput) { try { onOutput('\r\n[连接成功] ' + cfg.host + ':' + (cfg.port || 22) + '\r\n'); } catch (e) {} }
    var steps = [
      { label: '进入 ShellCrash 菜单', send: cfg.cmd || 'crash' },
      { label: '等待菜单出现', expect: /请输入|请选择|菜单/i, timeout: MENU_TIMEOUT },
      { label: '选择 3 停止服务', send: '3' },
      { label: '等待停止完成并回菜单', expect: /请输入|请选择|已停止|已关闭|停止成功|服务已停止/i, timeout: STEP_TIMEOUT },
      { label: '退出菜单', send: '0' }
    ];
    return runTui(client, steps, GLOBAL_TIMEOUT, onOutput, onStep);
  }).then(function (out) {
    return { ok: true, output: out.slice(-2000) };
  }).catch(function (err) {
    if (onOutput) { try { onOutput('\r\n[失败] ' + friendlyError(err, cfg) + '\r\n'); } catch (e) {} }
    return { ok: false, error: friendlyError(err, cfg) };
  });
}

// 测试 SSH 连接（仅连接）
function testSsh(cfg) {
  return new Promise((resolve) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      try { conn.end(); } catch (e) {}
      resolve({ ok: false, error: '连接超时' });
    }, 10000);
    conn.on('ready', () => {
      clearTimeout(timer);
      try { conn.end(); } catch (e) {}
      resolve({ ok: true });
    });
    conn.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    conn.connect({
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 22,
      username: cfg.user || 'root',
      password: cfg.pass,
      readyTimeout: 8000
    });
  });
}

// 测试 SSH 连接并进入 ShellCrash，检测服务状态
function testSshAndCrash(cfg) {
  return new Promise((resolve) => {
    const conn = new Client();
    let output = '';
    let resolved = false;
    let streamRef = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try {
        if (streamRef) { streamRef.end(); }
        conn.end();
      } catch (e) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: '操作超时', sshOk: true, output });
    }, 15000);

    conn.on('ready', () => {
      conn.shell({ term: 'xterm', cols: 120, rows: 30 }, (err, stream) => {
        if (err) {
          finish({ ok: false, error: 'SSH 会话创建失败: ' + err.message, sshOk: true, output });
          return;
        }
        streamRef = stream;

        let menuTimer = null;
        stream.on('data', (data) => {
          output += data.toString();
          if (/not found|未找到命令|command not found/i.test(output)) {
            finish({ ok: true, status: 'not_installed', sshOk: true, output });
            return;
          }
          if (/请输入|请选择|输入对应数字|\d+\)/.test(output)) {
            if (menuTimer) clearTimeout(menuTimer);
            menuTimer = setTimeout(() => {
              const stopped = /没有运行|未运行|未启动|stopped|not running|未在运行/i.test(output);
              if (stopped) {
                finish({ ok: true, status: 'stopped', sshOk: true, output });
              } else {
                finish({ ok: true, status: 'running', sshOk: true, output });
              }
            }, 500);
          }
        });

        stream.on('close', () => {
          if (!resolved) {
            finish({ ok: false, error: 'SSH 会话已关闭', sshOk: true, output });
          }
        });

        stream.write((cfg.cmd || 'crash') + '\r');
      });
    });

    conn.on('error', (err) => {
      finish({ ok: false, error: 'SSH 连接失败: ' + err.message, sshOk: false, output });
    });

    conn.connect({
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 22,
      username: cfg.user || 'root',
      password: cfg.pass,
      readyTimeout: 8000
    });
  });
}

// 读取 ShellCrash 功能设置的所有菜单输出
function readCrashSettings(cfg, onOutput) {
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var menus = {};
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('读取设置超时'));
      }, 60000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || menus);
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var queue = [];
        var currentStep = null;
        var stepTimer = null;

        function runStep(step) {
          currentStep = step;
          var stepMarker = buf.length;
          if (step.send !== undefined) {
            stream.write(step.send + '\r');
            if (onOutput) { try { onOutput('[发送] ' + step.send + '\r\n'); } catch (e) {} }
          }
          if (step.sleep !== undefined) {
            stepTimer = setTimeout(function () {
              if (step.capture) { menus[step.capture] = buf.slice(stepMarker); }
              nextInQueue();
            }, step.sleep);
            return;
          }
          if (step.expect) {
            stepTimer = setTimeout(function () {
              if (step.optional) {
                if (step.capture) { menus[step.capture] = buf.slice(stepMarker); }
                nextInQueue();
              } else {
                settle(new Error('步骤「' + (step.label || '') + '」超时'));
              }
            }, step.timeout || 10000);
            step.check = function () {
              var fresh = buf.slice(stepMarker);
              if (step.expect.test(fresh)) {
                clearTimeout(stepTimer);
                if (step.capture) { menus[step.capture] = buf.slice(stepMarker); }
                nextInQueue();
              }
            };
          } else {
            if (step.capture) { menus[step.capture] = buf.slice(stepMarker); }
            nextInQueue();
          }
        }

        function nextInQueue() {
          if (queue.length === 0) { settle(null, menus); return; }
          runStep(queue.shift());
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (currentStep && currentStep.check) { currentStep.check(); }
        });

        stream.on('close', function () {
          if (!settled) { settle(null, menus); }
        });

        // 构建读取步骤队列
        var menuRe = /请输入对应数字>/;
        queue = [
          { send: 'crash', expect: menuRe, label: '进入crash', timeout: 8000 },
          { send: '2', expect: menuRe, capture: 'main', label: '功能设置主菜单', timeout: 8000 },
          { send: '1', expect: menuRe, capture: 'route', label: '路由模式', timeout: 8000 },
          { send: '0', expect: menuRe, label: '返回主菜单', timeout: 5000 },
          { send: '2', expect: menuRe, capture: 'dns', label: 'DNS设置', timeout: 8000 },
          { send: '0', expect: menuRe, label: '返回主菜单', timeout: 5000 },
          { send: '3', expect: menuRe, capture: 'filter', label: '流量过滤', timeout: 8000 },
          { send: '0', expect: menuRe, label: '返回主菜单', timeout: 5000 },
          { send: '7', expect: menuRe, capture: 'ipv6', label: 'IPv6设置', timeout: 8000 },
          { send: '0', expect: menuRe, label: '返回主菜单', timeout: 5000 },
          { send: 'b', expect: menuRe, capture: 'lang', label: '多语言', timeout: 8000 },
          { send: '0', expect: menuRe, label: '返回主菜单', timeout: 5000 },
          { send: '0', expect: /请输入对应数字|$/, optional: true, label: '退出crash', timeout: 3000, sleep: 500 }
        ];

        setTimeout(nextInQueue, 500);
      });
    });
  });
}

// 保存 ShellCrash 开关设置（跳过证书验证、启用域名嗅探等），支持一次修改多个
function saveCrashToggle(cfg, menuNums, onOutput, onStep) {
  // 兼容单个数字
  if (!Array.isArray(menuNums)) menuNums = [menuNums];
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('保存设置超时'));
      }, 120000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var currentIdx = 0;
        var stageNames = ['', '连接SSH', '进入crash', '进入功能设置', '选择设置项', '确认修改', '返回上级菜单', '立即重启', '退出功能设置', '退出crash'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function hasRestartPromptIn(fresh) {
          return /立即重启|暂不重启|检测到配置变更|是否立即重启/.test(fresh);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              // 匹配到后再等待一段时间，确保输出完整
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('2');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 3) {
            // 选择设置项
            if (currentIdx >= menuNums.length) {
              // 所有设置项都改完了，进入退出流程（next()会stage++，所以设为5）
              stage = 5;
              next();
              return;
            }
            send(String(menuNums[currentIdx]));
            waitFor(/是否确认|请输入对应数字>/, 8000, next);
          } else if (stage === 4) {
            // 发送 1 确认，ShellCrash 会直接执行并返回功能设置菜单
            send('1');
            // 等待成功提示 + 功能设置菜单出现（确认后自动返回功能菜单，不需要再发0）
            waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|功能设置菜单|路由模式设置/, 8000, 600, function () {
              setTimeout(function () {
                currentIdx++;
                stage = 2; // next()会stage++，变成3，回到选择设置项
                next();
              }, 300);
            });
          } else if (stage === 5) {
            // 这个 stage 不再需要，保留为空（兼容旧逻辑）
            stage = 2;
            next();
          } else if (stage === 6) {
            // 所有设置改完，退出功能设置主菜单
            send('0');
            waitForWithDelay(/请输入对应数字>|是否立即重启|检测到配置变更/, 8000, 400, function (fresh) {
              if (hasRestartPromptIn(fresh)) {
                send('1');
                waitFor(/正在重启|启动服务|Mihomo|启动|重启/, 10000, function () {
                  waitFor(/请输入对应数字>/, 30000, function () {
                    stage = 8; // next()会stage++，变成9
                    next();
                  });
                });
              } else {
                stage = 8; // next()会stage++，变成9
                next();
              }
            });
          } else if (stage === 9) {
            // 退出 crash
            send('0');
            setTimeout(function () { settle(); }, 1000);
          }
        }

        setTimeout(next, 500);
      });
    });
  });
}

// 通用保存：支持开关和子菜单选择混合，一次连接一次重启
// changes: [{type:'toggle', num:4, name:'跳过证书验证'}, {type:'submenu', menuNum:1, optionNum:3, name:'路由模式-Tproxy'}]
function saveCrashMixed(cfg, changes, onOutput, onStep) {
  if (!Array.isArray(changes)) changes = [changes];
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('保存设置超时'));
      }, 180000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var currentIdx = 0;
        var stageNames = ['', '连接SSH', '进入crash', '进入功能设置', '执行改动', '退出功能设置', '立即重启', '退出crash'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function hasRestartPromptIn(fresh) {
          return /立即重启|暂不重启|检测到配置变更|是否立即重启/.test(fresh);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function doNextChange() {
          if (currentIdx >= changes.length) {
            // 所有改动完成，退出功能设置（next()会stage++，所以设为3）
            stage = 3;
            next();
            return;
          }
          var change = changes[currentIdx];
          if (onOutput) { try { onOutput('\n=== 保存：' + change.name + ' ===\n'); } catch (e) {} }
          if (onStep) { try { onStep(4, '修改 ' + change.name + ' (' + (currentIdx + 1) + '/' + changes.length + ')'); } catch (e) {} }
          if (change.type === 'toggle') {
            // 开关类：发送 num → 1确认 → 等功能菜单
            send(String(change.num));
            waitFor(/是否确认|请输入对应数字>/, 8000, function () {
              send('1');
              waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|功能设置菜单|路由模式设置/, 8000, 600, function () {
                setTimeout(function () {
                  currentIdx++;
                  doNextChange();
                }, 300);
              });
            });
          } else if (change.type === 'submenu') {
            // 子菜单选择类：发送 menuNum → 等子菜单 → 发送 optionNum → 等成功 → 0返回
            send(String(change.menuNum));
            waitFor(/请输入对应数字>|是否确认/, 8000, function () {
              send(String(change.optionNum));
              // 等待成功提示或确认提示
              waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|设为|已设为|切换|请输入对应数字|是否确认|是否禁用|1\/0/, 8000, 500, function (fresh) {
                // 如果出现确认提示（如Tproxy的QoS冲突），发送1确认
                if (/是否确认|是否禁用|1\/0/.test(fresh)) {
                  send('1');
                  waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|设为|已设为|请输入对应数字/, 8000, 500, function () {
                    sendReturnAndNext();
                  });
                } else {
                  sendReturnAndNext();
                }
              });
            });
          } else if (change.type === 'submenuToggle') {
            // 子菜单中的开关：发送 menuNum → 等子菜单 → 发送 optionNum → 判断是否有确认提示 → 0返回
            send(String(change.menuNum));
            waitFor(/请输入对应数字>/, 8000, function () {
              send(String(change.optionNum));
              // 等待确认提示或子菜单返回（延迟匹配，确保完整输出）
              waitForWithDelay(/是否确认|是否继续|是否启用|是否禁用|操作成功|已启用|已禁用|已开启|已关闭|请输入对应数字>/, 8000, 500, function (fresh) {
                if (/是否确认|是否继续|是否启用|是否禁用/.test(fresh)) {
                  // 有确认提示，发送1确认
                  send('1');
                  waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|请输入对应数字>/, 8000, 500, function () {
                    sendReturnAndNext();
                  });
                } else {
                  // 没有确认提示，直接返回功能菜单
                  sendReturnAndNext();
                }
              });
            });
          } else if (change.type === 'deepToggle') {
            // 深层开关（如流量过滤）：menuNum → optionNum → 1确认停止服务 → 1切换开关 → 0返回 → 0返回
            send(String(change.menuNum));
            waitFor(/请输入对应数字>/, 8000, function () {
              send(String(change.optionNum));
              waitForWithDelay(/是否继续|是否确认|请输入对应数字>/, 8000, 500, function (fresh) {
                if (/是否继续|是否确认/.test(fresh)) {
                  // 确认停止服务
                  send('1');
                  waitFor(/请输入对应数字>/, 8000, function () {
                    // 进入深层子菜单后，发送1切换开关
                    send('1');
                    waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|请输入对应数字>/, 8000, 500, function () {
                      // 发送0返回流量过滤子菜单
                      send('0');
                      waitFor(/请输入对应数字>/, 8000, function () {
                        // 再发送0返回功能设置菜单
                        sendReturnAndNext();
                      });
                    });
                  });
                } else {
                  // 没有确认提示（如过滤局域网设备直接进入设备管理），发送0返回，跳过此改动
                  send('0');
                  waitFor(/请输入对应数字>/, 8000, function () {
                    sendReturnAndNext();
                  });
                }
              });
            });
          } else {
            currentIdx++;
            doNextChange();
          }
        }

        function sendReturnAndNext() {
          // 发送0返回功能菜单
          send('0');
          waitForWithDelay(/功能设置菜单|路由模式设置|DNS设置|跳过证书验证|检测到配置变更|是否立即重启/, 8000, 500, function (fresh) {
            if (hasRestartPromptIn(fresh)) {
              // 修改一项后就出现重启提示，选择暂不重启，重新进入功能设置
              send('0');
              waitFor(/请输入对应数字>/, 8000, function () {
                send('2');
                waitFor(/请输入对应数字>/, 8000, function () {
                  setTimeout(function () {
                    currentIdx++;
                    doNextChange();
                  }, 300);
                });
              });
            } else {
              setTimeout(function () {
                currentIdx++;
                doNextChange();
              }, 300);
            }
          });
        }

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('2');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 3) {
            // 开始执行改动
            doNextChange();
          } else if (stage === 4) {
            // 所有设置改完，退出功能设置主菜单
            send('0');
            // 等待 crash 主菜单或重启提示
            waitForWithDelay(/欢迎使用ShellCrash|启动\/重启服务|是否立即重启|检测到配置变更|请输入对应数字>/, 8000, 500, function (fresh) {
              if (onOutput) { try { onOutput('[调试] 退出功能设置后捕获: ' + fresh.substring(fresh.length - 200) + '\r\n'); } catch (e) {} }
              if (hasRestartPromptIn(fresh)) {
                // 有重启提示，选择立即重启
                send('1');
                waitFor(/正在重启|启动服务|Mihomo|启动|重启/, 10000, function () {
                  waitFor(/请输入对应数字>/, 30000, function () {
                    stage = 6; // next()会stage++，变成7
                    next();
                  });
                });
              } else {
                // 没有重启提示，直接退出 crash
                stage = 6; // next()会stage++，变成7
                next();
              }
            });
          } else if (stage === 7) {
            // 退出 crash
            send('0');
            setTimeout(function () { settle(); }, 1000);
          }
        }

        setTimeout(next, 500);
      });
    });
  });
}

// 保存 ShellCrash 子菜单选择（路由模式、DNS模式等），支持一次修改多个
function saveCrashSubmenuSelect(cfg, items, onOutput, onStep) {
  // items: [{menuNum, optionNum, name}]
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('保存设置超时'));
      }, 120000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var currentIdx = 0;
        var stageNames = ['', '连接SSH', '进入crash', '进入功能设置', '进入子菜单', '选择选项', '返回功能菜单', '退出功能设置', '立即重启', '退出crash'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function hasRestartPromptIn(fresh) {
          return /立即重启|暂不重启|检测到配置变更|是否立即重启/.test(fresh);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('2');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 3) {
            // 进入子菜单
            if (currentIdx >= items.length) {
              // 所有设置项都改完了，进入退出流程
              stage = 6;
              next();
              return;
            }
            var item = items[currentIdx];
            send(String(item.menuNum));
            waitFor(/请输入对应数字>|是否确认/, 8000, next);
          } else if (stage === 4) {
            // 选择选项
            var item2 = items[currentIdx];
            send(String(item2.optionNum));
            // 等待成功提示或子菜单重新出现（选择后可能直接返回或需要确认）
            waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|设为|切换|模式|请输入对应数字|是否确认/, 8000, 500, function (fresh) {
              // 如果出现确认提示（如Tproxy的QoS冲突），发送1确认
              if (/是否确认|是否禁用|1\/0/.test(fresh)) {
                send('1');
                waitForWithDelay(/操作成功|已启用|已禁用|已开启|已关闭|设为|请输入对应数字/, 8000, 500, function () {
                  stage = 4; // next()会stage++，变成5
                  next();
                });
              } else {
                stage = 4; // next()会stage++，变成5
                next();
              }
            });
          } else if (stage === 5) {
            // 返回功能菜单
            send('0');
            waitForWithDelay(/功能设置菜单|路由模式设置|DNS设置|跳过证书验证|检测到配置变更|是否立即重启/, 8000, 500, function (fresh) {
              if (hasRestartPromptIn(fresh)) {
                // 修改一项后就出现重启提示，选择暂不重启，重新进入功能设置
                send('0');
                waitFor(/请输入对应数字>/, 8000, function () {
                  send('2');
                  waitFor(/请输入对应数字>/, 8000, function () {
                    setTimeout(function () {
                      currentIdx++;
                      stage = 2; // next()会stage++，变成3
                      next();
                    }, 300);
                  });
                });
              } else {
                setTimeout(function () {
                  currentIdx++;
                  stage = 2; // next()会stage++，变成3
                  next();
                }, 300);
              }
            });
          } else if (stage === 6) {
            // 所有设置改完，退出功能设置主菜单
            send('0');
            waitForWithDelay(/请输入对应数字>|是否立即重启|检测到配置变更/, 8000, 400, function (fresh) {
              if (hasRestartPromptIn(fresh)) {
                send('1');
                waitFor(/正在重启|启动服务|Mihomo|启动|重启/, 10000, function () {
                  waitFor(/请输入对应数字>/, 30000, function () {
                    stage = 8; // next()会stage++，变成9
                    next();
                  });
                });
              } else {
                stage = 8; // next()会stage++，变成9
                next();
              }
            });
          } else if (stage === 9) {
            // 退出 crash
            send('0');
            setTimeout(function () { settle(); }, 1000);
          }
        }

        setTimeout(next, 500);
      });
    });
  });
}

// 重置/备份/还原脚本设置
// action: 'backup' | 'restore' | 'reset'
function runBackupRestore(cfg, action, onOutput, onStep) {
  var actionMap = { backup: '1', restore: '2', reset: '3' };
  var actionNames = { backup: '备份脚本设置', restore: '还原脚本设置', reset: '重置脚本设置' };
  var optionNum = actionMap[action];
  if (!optionNum) return Promise.reject(new Error('未知操作类型: ' + action));

  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('操作超时'));
      }, 120000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var stageNames = ['', '连接SSH', '进入crash', '进入功能设置', '进入重置/备份/还原', '执行操作', '退出'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('2');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 3) {
            send('a');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 4) {
            // 执行操作
            send(optionNum);
            if (action === 'reset') {
              // 重置需要确认
              waitForWithDelay(/是否确认|是否继续|请输入对应数字>/, 8000, 500, function (fresh) {
                if (/是否确认|是否继续/.test(fresh)) {
                  send('1');
                }
                waitForWithDelay(/操作成功|已完成|成功|请输入对应数字>/, 15000, 800, function () {
                  stage = 5;
                  next();
                });
              });
            } else if (action === 'backup') {
              // 备份完成后自动返回功能设置菜单，不需要发送0返回
              waitForWithDelay(/操作成功|已完成|成功|备份完成|请输入对应数字>/, 20000, 1000, function () {
                // 直接进入退出功能设置阶段
                stage = 5;
                next();
              });
            } else {
              // 还原完成后自动退出crash，不需要发送任何指令
              waitForWithDelay(/操作成功|已完成|成功|还原完成|root@|~#|请输入对应数字>/, 30000, 1000, function () {
                // 还原完成，直接结束
                setTimeout(function () { settle(); }, 1000);
              });
            }
          } else if (stage === 5) {
            // 备份：从功能设置菜单退出到主菜单
            send('0');
            waitFor(/请输入对应数字>/, 8000, function () {
              stage = 6;
              next();
            });
          } else if (stage === 6) {
            // 退出 crash
            send('0');
            setTimeout(function () { settle(); }, 1000);
          }
        }

        if (onOutput) { try { onOutput('\n=== ' + actionNames[action] + ' ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

// 读取配置提供者列表
function readCrashProviders(cfg, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('读取超时'));
      }, 60000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { providers: [] });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var menuOutput = '';
        var stageNames = ['', '连接SSH', '进入crash', '进入配置管理', '解析列表', '退出'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('6');
            waitFor(/请输入对应字母或数字>/, 8000, function (fresh) {
              menuOutput = fresh;
              stage = 2;
              next();
            });
          } else if (stage === 3) {
            // 解析提供者列表
            var providers = [];
            var lines = menuOutput.split('\n');
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].replace(/\x1b\[[0-9;]*m/g, '').trim();
              var m = line.match(/^(\d+)\)\s+(.+?)\s+(https?:\/\/\S+)/);
              if (m) {
                providers.push({ index: parseInt(m[1]), name: m[2].trim(), url: m[3].trim() });
              }
            }
            // 退出
            send('0');
            waitFor(/请输入对应数字>/, 8000, function () {
              send('0');
              setTimeout(function () { settle(null, { providers: providers }); }, 800);
            });
          }
        }

        if (onOutput) { try { onOutput('\n=== 读取配置列表 ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

// 保存配置提供者（新增或编辑），并在线获取配置
// provider: { index?: number, name: string, url: string }
function saveCrashProvider(cfg, provider, onOutput, onStep) {
  var isEdit = !!provider.index;
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('操作超时'));
      }, 120000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var stageNames = ['', '连接SSH', '进入crash', '进入配置管理', isEdit ? '进入编辑' : '进入添加', '设置名称', '设置链接', '保存', '获取配置', '下载配置中...', '启动服务'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('6');
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 3) {
            if (isEdit) {
              send(String(provider.index));
            } else {
              send('a');
            }
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 4) {
            // 设置名称
            send('1');
            waitFor(/请输入|输入名称|名称>/, 8000, function () {
              send(provider.name);
              waitFor(/请输入对应字母或数字>/, 8000, function () {
                stage = 4;
                next();
              });
            });
          } else if (stage === 5) {
            // 设置链接
            send('2');
            waitFor(/请输入|输入链接|路径|链接>/, 8000, function () {
              send(provider.url);
              waitFor(/请输入对应字母或数字>/, 8000, function () {
                stage = 5;
                next();
              });
            });
          } else if (stage === 6) {
            // 在线获取配置 (e) - 设置完名称和链接后直接 e，不需要 a 保存
            send('e');
            waitForWithDelay(/我确认|是否启动|获取失败|配置文件获取失败|请输入对应数字|请输入对应字母或数字/, 10000, 500, function (fresh) {
              if (/获取失败|配置文件获取失败/.test(fresh)) {
                settle(new Error('配置文件获取失败，请重试或修改订阅链接。'));
                return;
              }
              if (/我确认/.test(fresh)) {
                // 确认不兼容提示
                send('1');
                if (onStep) { try { onStep(9, '下载配置中，请稍候...'); } catch (e) {} }
                waitForWithDelay(/是否启动|获取失败|配置文件获取失败|请输入对应数字|获取成功|更新成功|成功|完成/, 60000, 1000, function (fresh2) {
                  if (/获取失败|配置文件获取失败/.test(fresh2)) {
                    settle(new Error('配置文件获取失败，请重试或修改订阅链接。'));
                    return;
                  }
                  if (/是否启动/.test(fresh2)) {
                    // 启动服务
                    send('1');
                    waitForWithDelay(/服务已启动|root@|~#|请输入对应数字/, 30000, 1000, function () {
                      setTimeout(function () { settle(); }, 1000);
                    });
                  } else {
                    setTimeout(function () { settle(); }, 2000);
                  }
                });
              } else if (/是否启动/.test(fresh)) {
                send('1');
                waitForWithDelay(/服务已启动|root@|~#|请输入对应数字/, 30000, 1000, function () {
                  setTimeout(function () { settle(); }, 1000);
                });
              } else {
                setTimeout(function () { settle(); }, 2000);
              }
            });
          }
        }

        if (onOutput) { try { onOutput('\n=== ' + (isEdit ? '编辑' : '添加') + '提供者：' + provider.name + ' ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

// 删除配置提供者
function deleteCrashProvider(cfg, index, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('操作超时'));
      }, 60000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var stageNames = ['', '连接SSH', '进入crash', '进入配置管理', '进入编辑', '删除', '确认', '退出'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('6');
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 3) {
            send(String(index));
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 4) {
            // 删除
            send('d');
            waitForWithDelay(/是否确认|是否删除|确认|请输入对应字母或数字>/, 8000, 500, function (fresh) {
              if (/是否确认|是否删除/.test(fresh)) {
                send('1');
                waitForWithDelay(/删除成功|已删除|成功|请输入对应字母或数字>/, 8000, 500, function () {
                  stage = 4;
                  next();
                });
              } else {
                stage = 4;
                next();
              }
            });
          } else if (stage === 5) {
            // 退出
            send('0');
            waitFor(/请输入对应字母或数字|请输入对应数字>/, 8000, function () {
              send('0');
              setTimeout(function () { settle(); }, 1000);
            });
          }
        }

        if (onOutput) { try { onOutput('\n=== 删除提供者 ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

// 更新配置提供者（编辑名称或链接）
// provider: { index: number, name?: string, url?: string }
function updateCrashProvider(cfg, provider, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('操作超时'));
      }, 90000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var stageNames = ['', '连接SSH', '进入crash', '进入配置管理', '进入编辑', '修改内容', '保存', '退出'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        // 执行修改：先名称后链接，结束前确保编辑页已出现
        function doModify(callback) {
          if (provider.name !== undefined) {
            send('1');
            waitFor(/请输入|输入名称|名称>/, 8000, function () {
              send(provider.name);
              waitForWithDelay(/操作成功|输入错误/, 8000, 500, function (fresh) {
                if (/输入错误/.test(fresh)) {
                  settle(new Error('输入错误，请重新输入'));
                  return;
                }
                // 名称修改成功，等待编辑页出现
                waitFor(/请输入对应字母或数字>/, 8000, function () {
                  if (provider.url !== undefined) {
                    // 继续修改链接
                    send('2');
                    waitFor(/请输入|输入链接|路径|链接>/, 8000, function () {
                      send(provider.url);
                      waitForWithDelay(/操作成功|输入错误/, 8000, 500, function (fresh2) {
                        if (/输入错误/.test(fresh2)) {
                          settle(new Error('输入错误，请重新输入'));
                          return;
                        }
                        // 等待编辑页出现
                        waitFor(/请输入对应字母或数字>/, 8000, function () {
                          callback();
                        });
                      });
                    });
                  } else {
                    callback();
                  }
                });
              });
            });
          } else if (provider.url !== undefined) {
            send('2');
            waitFor(/请输入|输入链接|路径|链接>/, 8000, function () {
              send(provider.url);
              waitForWithDelay(/操作成功|输入错误/, 8000, 500, function (fresh) {
                if (/输入错误/.test(fresh)) {
                  settle(new Error('输入错误，请重新输入'));
                  return;
                }
                // 等待编辑页出现
                waitFor(/请输入对应字母或数字>/, 8000, function () {
                  callback();
                });
              });
            });
          } else {
            callback();
          }
        }

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('6');
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 3) {
            send(String(provider.index));
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 4) {
            // 修改名称和/或链接
            doModify(function () {
              stage = 4;
              next();
            });
          } else if (stage === 5) {
            // 编辑页已出现，直接输入 a 保存
            send('a');
            waitForWithDelay(/操作成功|保存成功|已保存/, 8000, 500, function () {
              stage = 5;
              next();
            });
          } else if (stage === 6) {
            // 退出：提供者编辑页 → 配置管理列表页 → 退出
            send('0');
            waitFor(/请输入对应字母或数字>/, 8000, function () {
              send('0');
              waitFor(/请输入对应数字|root@|~#/, 8000, function () {
                setTimeout(function () { settle(); }, 1000);
              });
            });
          }
        }

        if (onOutput) { try { onOutput('\n=== 编辑订阅 ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

// 使用此配置（在线获取配置并启动服务）
function useCrashProvider(cfg, index, onOutput, onStep) {
  return connect(cfg).then(function (client) {
    return new Promise(function (resolve, reject) {
      var buf = '';
      var settled = false;
      var globalTimer = setTimeout(function () {
        settle(new Error('操作超时'));
      }, 120000);

      function settle(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(globalTimer);
        try { client.end(); } catch (e) {}
        if (err) reject(err);
        else resolve(result || { ok: true });
      }

      client.shell({ term: 'xterm', cols: 120, rows: 30 }, function (err, stream) {
        if (err) { settle(new Error('无法打开终端会话: ' + err.message)); return; }

        var stage = 0;
        var stepTimer = null;
        var checkFn = null;
        var stageNames = ['', '连接SSH', '进入crash', '进入配置管理', '进入提供者', '获取配置', '下载配置中...', '启动服务'];

        function send(cmd) {
          stream.write(cmd + '\r');
          if (onOutput) { try { onOutput('[发送] ' + cmd + '\r\n'); } catch (e) {} }
        }

        function waitFor(pattern, timeout, callback) {
          var marker = buf.length;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh)) {
              clearTimeout(stepTimer);
              checkFn = null;
              callback(fresh);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        function waitForWithDelay(pattern, timeout, delay, callback) {
          var marker = buf.length;
          var delayed = false;
          checkFn = function () {
            var fresh = buf.slice(marker);
            if (pattern.test(fresh) && !delayed) {
              delayed = true;
              setTimeout(function () {
                if (checkFn) {
                  clearTimeout(stepTimer);
                  checkFn = null;
                  callback(buf.slice(marker));
                }
              }, delay || 300);
            }
          };
          stepTimer = setTimeout(function () {
            settle(new Error('等待超时'));
          }, timeout || 10000);
        }

        stream.on('data', function (d) {
          var text = d.toString('utf8');
          buf += text;
          if (onOutput) { try { onOutput(text); } catch (e) {} }
          if (checkFn) checkFn();
        });

        stream.on('close', function () {
          if (!settled) settle();
        });

        function next() {
          stage++;
          if (onStep) { try { onStep(stage, stageNames[stage] || ''); } catch (e) {} }

          if (stage === 1) {
            send('crash');
            waitFor(/请输入对应数字>/, 8000, next);
          } else if (stage === 2) {
            send('6');
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 3) {
            send(String(index));
            waitFor(/请输入对应字母或数字>/, 8000, next);
          } else if (stage === 4) {
            // 在线获取配置 (e)
            send('e');
            waitForWithDelay(/我确认|是否启动|获取失败|配置文件获取失败|请输入对应数字|请输入对应字母或数字/, 10000, 500, function (fresh) {
              if (/获取失败|配置文件获取失败/.test(fresh)) {
                settle(new Error('配置文件获取失败，请重试或修改订阅链接。'));
                return;
              }
              if (/我确认/.test(fresh)) {
                send('1');
                if (onStep) { try { onStep(5, '下载配置中，请稍候...'); } catch (e) {} }
                waitForWithDelay(/是否启动|获取失败|配置文件获取失败|请输入对应数字|获取成功|更新成功|成功|完成/, 60000, 1000, function (fresh2) {
                  if (/获取失败|配置文件获取失败/.test(fresh2)) {
                    settle(new Error('配置文件获取失败，请重试或修改订阅链接。'));
                    return;
                  }
                  if (/是否启动/.test(fresh2)) {
                    send('1');
                    waitForWithDelay(/服务已启动|root@|~#|请输入对应数字/, 30000, 1000, function () {
                      setTimeout(function () { settle(); }, 1000);
                    });
                  } else {
                    setTimeout(function () { settle(); }, 2000);
                  }
                });
              } else if (/是否启动/.test(fresh)) {
                send('1');
                waitForWithDelay(/服务已启动|root@|~#|请输入对应数字/, 30000, 1000, function () {
                  setTimeout(function () { settle(); }, 1000);
                });
              } else {
                setTimeout(function () { settle(); }, 2000);
              }
            });
          }
        }

        if (onOutput) { try { onOutput('\n=== 使用此配置 ===\n'); } catch (e) {} }
        setTimeout(next, 500);
      });
    });
  });
}

window.services = {
  testSsh,
  testSshAndCrash,
  runSteps,
  restartService,
  stopService,
  readCrashSettings,
  saveCrashToggle,
  saveCrashSubmenuSelect,
  saveCrashMixed,
  runBackupRestore,
  readCrashProviders,
  saveCrashProvider,
  deleteCrashProvider,
  updateCrashProvider,
  useCrashProvider
};
