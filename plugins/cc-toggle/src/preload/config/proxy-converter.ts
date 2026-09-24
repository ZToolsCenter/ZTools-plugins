// @ts-nocheck TODO: 逐步添加类型注解后移除
// proxy-converter.js
// 协议转换：Codex Responses API ↔ OpenAI Chat Completions / Anthropic Messages
// 用于路由接管时，让只支持 Chat/Anthropic 的供应商也能在 Codex 中使用

// ── 工具 ──
function extractContent(item) {
  if (!item || !item.content) return '';
  if (typeof item.content === 'string') return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map(function (c) {
        if (c.type === 'input_text' || c.type === 'text') return c.text || '';
        if (c.type === 'input_image' || c.type === 'image') return '[image]';
        return '';
      })
      .join('\n');
  }
  return '';
}

function extractContentFromChat(choice) {
  var msg = choice.message || choice.delta || {};
  // 保留 null/undefined 以区分"没有 content"和"content 为空字符串"
  var text = msg.content !== undefined && msg.content !== null ? msg.content : undefined;
  var reasoningContent =
    msg.reasoning_content !== undefined && msg.reasoning_content !== null
      ? msg.reasoning_content
      : undefined;
  var toolCalls = msg.tool_calls;
  return {
    text: text,
    reasoningContent: reasoningContent,
    toolCalls: toolCalls,
    finishReason: choice.finish_reason
  };
}

// 兜底：为没有得到 tool 结果的 tool_call 补一条空 tool 消息。
// 中断 / 历史压缩可能产生悬空的 function_call，严格校验的上游
// （DeepSeek 等）会直接 400："must be followed by tool messages"。
function repairToolCallMessages(messages) {
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) continue;
    var answered = {};
    var j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      answered[messages[j].tool_call_id] = true;
      j++;
    }
    var missing = m.tool_calls.filter(function (tc) {
      return !answered[tc.id];
    });
    if (missing.length) {
      var patch = missing.map(function (tc) {
        return { role: 'tool', tool_call_id: tc.id, content: '(no output)' };
      });
      messages.splice.apply(messages, [j, 0].concat(patch));
    }
  }
}

// 角色映射：Codex Responses 可能出现 developer 角色，OpenAI Chat / Anthropic 不支持
function mapRoleForChat(role) {
  if (role === 'developer') return 'system';
  if (role === 'system' || role === 'assistant' || role === 'user' || role === 'tool') return role;
  return 'user';
}

function mapRoleForAnthropic(role) {
  // Anthropic messages 仅支持 user / assistant；system 单独字段处理
  if (role === 'assistant') return 'assistant';
  return 'user';
}

// 将上游 chat / anthropic 的 usage 归一化为 Responses API 格式。
// 关键：Responses API 的 usage 必须包含 input_tokens / output_tokens，
// 否则 Codex 客户端解析 ResponseCompleted 时会报 "missing field input_tokens"。
function normalizeResponsesUsage(u) {
  if (!u || typeof u !== 'object') return { input_tokens: 0, output_tokens: 0 }
  var input = Number(u.input_tokens != null ? u.input_tokens : u.prompt_tokens) || 0
  var output = Number(u.output_tokens != null ? u.output_tokens : u.completion_tokens) || 0
  var cached =
    Number(
      u.input_tokens_details && u.input_tokens_details.cached_tokens != null
        ? u.input_tokens_details.cached_tokens
        : u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens != null
          ? u.prompt_tokens_details.cached_tokens
          : u.cache_read_input_tokens != null
            ? u.cache_read_input_tokens
            : 0
    ) || 0
  var total = Number(u.total_tokens) || input + output
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    total_tokens: total
  }
}

// ── Responses API → Chat Completions（请求转换） ──
function responsesToChat(body, model) {
  var messages = [];
  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    body.input.forEach(function (item) {
      if (item.type === 'message' && item.role) {
        var c = extractContent(item);
        if (c) messages.push({ role: mapRoleForChat(item.role), content: c });
      } else if (item.type === 'function_call') {
        // 助手发起的工具调用 → Chat 的 assistant.tool_calls
        // 多个连续 function_call 必须合并进同一条 assistant 消息：
        // 拆成多条时前一条的 tool_calls 未紧跟对应 tool 消息，
        // DeepSeek 等严格上游会报 "must be followed by tool messages"。
        var tc = {
          id: item.call_id || item.id || '',
          type: 'function',
          function: { name: item.name || '', arguments: item.arguments || '' }
        };
        var lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.tool_calls)) {
          lastMsg.tool_calls.push(tc);
        } else {
          messages.push({ role: 'assistant', content: null, tool_calls: [tc] });
        }
      } else if (item.type === 'function_call_output') {
        // 工具执行结果 → Chat 的 tool 消息，缺失会导致多轮工具对话断裂
        var out = item.output;
        if (typeof out !== 'string') {
          try {
            out = JSON.stringify(out);
          } catch (e) {
            out = String(out);
          }
        }
        messages.push({ role: 'tool', tool_call_id: item.call_id || item.id || '', content: out });
      }
    });
  }
  repairToolCallMessages(messages);
  var chatReq = {
    model: model || body.model || 'gpt-4o',
    messages: messages,
    stream: true
  };
  if (body.tools)
    chatReq.tools = body.tools.map(function (t) {
      // Codex Responses 工具是扁平结构；Chat Completions 需要 function 包裹
      if (t.type === 'function' && t.function) return t;
      if (t.type === 'function' || t.name) {
        return {
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.parameters || t.input_schema || {}
          }
        };
      }
      return t;
    });
  if (body.tool_choice) chatReq.tool_choice = body.tool_choice;
  if (body.parallel_tool_calls !== undefined)
    chatReq.parallel_tool_calls = body.parallel_tool_calls;
  if (body.reasoning && body.reasoning.effort) chatReq.reasoning_effort = body.reasoning.effort;
  if (body.max_output_tokens) chatReq.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) chatReq.temperature = body.temperature;
  // 严格的 OpenAI 兼容上游（vLLM / 企业网关）在 tools 为空时携带 tool_choice /
  // parallel_tool_calls 会返回 400/503，转换后若无有效 tools 则一并删除。
  var hasTools = Array.isArray(chatReq.tools) && chatReq.tools.length > 0;
  if (!hasTools) {
    delete chatReq.tools;
    delete chatReq.tool_choice;
    delete chatReq.parallel_tool_calls;
  }
  // 流式下 OpenAI 兼容上游默认不在 SSE 里返回 usage，需显式声明 include_usage，
  // 否则 kimi / MiniMax 等第三方供应商的 token 用量全部漏记。
  if (chatReq.stream) chatReq.stream_options = { include_usage: true };
  return chatReq;
}

// ── Chat Completions SSE → Responses SSE（流式转换） ──
function sseChatToResponses(raw, respId, state) {
  // state: { outputId, msgId, text, toolCalls, responseJson, reasoningAdded, reasoningText, reasoningItemId, nextOutputIndex }
  var lines = [];

  // 辅助函数：finalize reasoning item
  function finalizeReasoning() {
    if (!state.reasoningAdded || state.reasoningDone) return;
    var outputIndex = state.reasoningOutputIndex || 0;
    var itemId = state.reasoningItemId;
    var text = state.reasoningText || '';

    // reasoning_summary_text.done
    lines.push('event: response.reasoning_summary_text.done');
    lines.push(
      'data: ' +
        JSON.stringify({
          type: 'response.reasoning_summary_text.done',
          item_id: itemId,
          output_index: outputIndex,
          summary_index: 0,
          text: text
        })
    );

    // reasoning_summary_part.done
    lines.push('event: response.reasoning_summary_part.done');
    lines.push(
      'data: ' +
        JSON.stringify({
          type: 'response.reasoning_summary_part.done',
          item_id: itemId,
          output_index: outputIndex,
          summary_index: 0,
          part: { type: 'summary_text', text: text }
        })
    );

    // output_item.done (reasoning)
    lines.push('event: response.output_item.done');
    lines.push(
      'data: ' +
        JSON.stringify({
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: {
            id: itemId,
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: text }]
          }
        })
    );

    state.reasoningDone = true;
    // 添加到 output 列表
    if (!state.responseJson.output) state.responseJson.output = [];
    state.responseJson.output.push({
      id: itemId,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: text }]
    });
  }

  raw.split('\n').forEach(function (line) {
    if (line.indexOf('data: ') !== 0) return;
    var payload = line.slice(6);
    if (payload === '[DONE]') {
      // finalize reasoning
      finalizeReasoning();

      // 发送 final output_text.done + output_item.done + response.completed
      if (state.text) {
        lines.push('event: response.output_text.done');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.output_text.done',
              output_index: state.msgOutputIndex || 0,
              content_index: 0,
              text: state.text
            })
        );
        lines.push('event: response.content_part.done');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.content_part.done',
              output_index: state.msgOutputIndex || 0,
              content_index: 0,
              part: { type: 'output_text', text: state.text, annotations: [] }
            })
        );
      }
      if (state.msgId) {
        var content = [];
        if (state.text) content.push({ type: 'output_text', text: state.text, annotations: [] });
        // state.toolCalls 是以 index 为键的对象；按 index 顺序输出
        Object.keys(state.toolCalls || {})
          .sort(function (a, b) {
            return Number(a) - Number(b);
          })
          .forEach(function (k) {
            var tc = state.toolCalls[k];
            if (!tc) return;
            lines.push('event: response.function_call_arguments.done');
            lines.push(
              'data: ' +
                JSON.stringify({
                  type: 'response.function_call_arguments.done',
                  output_index: tc._outputIndex || 0,
                  item_id: tc.id,
                  arguments: tc.arguments || ''
                })
            );
            var doneEvt = {
              type: 'function_call',
              id: tc.id,
              call_id: tc.id,
              name: tc.name || '',
              arguments: tc.arguments || '',
              status: 'completed'
            };
            lines.push('event: response.output_item.done');
            lines.push(
              'data: ' +
                JSON.stringify({
                  type: 'response.output_item.done',
                  output_index: tc._outputIndex || 0,
                  item: doneEvt
                })
            );
            content.push(doneEvt);
          });
        lines.push('event: response.output_item.done');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.output_item.done',
              output_index: state.msgOutputIndex || 0,
              item: {
                type: 'message',
                id: state.msgId,
                status: 'completed',
                role: 'assistant',
                content: content
              }
            })
        );
        // response.completed
        state.responseJson.output = state.responseJson.output || [];
        state.responseJson.output.push({
          type: 'message',
          id: state.msgId,
          status: 'completed',
          role: 'assistant',
          content: content
        });
        state.responseJson.usage = normalizeResponsesUsage(state.responseJson.usage);
        lines.push('event: response.completed');
        lines.push(
          'data: ' + JSON.stringify({ type: 'response.completed', response: state.responseJson })
        );
        state.doneSent = true;
      }
      return;
    }
    try {
      var d = JSON.parse(payload);
      // usage 常在最后一个无 choices 的 chunk 中返回（include_usage=true），
      // 必须在 early-return 之前捕获，否则会被整体丢弃。
      if (d.usage) {
        state.responseJson = state.responseJson || {};
        state.responseJson.usage = normalizeResponsesUsage(d.usage);
      }
      if (!d.choices || !d.choices.length) return;
      var choice = d.choices[0];
      var info = extractContentFromChat(choice);
      var idx = choice.index || 0;

      if (!state.msgId) {
        state.msgId = 'msg_' + (d.id || 'chatcmpl') + '_' + idx;
        state.outputId = 'output_' + (d.id || 'chat') + '_' + idx;
        state.responseJson = state.responseJson || {};
        state.responseJson.id = 'resp_' + (d.id || 'chat');
        state.responseJson.object = 'response';
        state.responseJson.created_at = Math.floor(Date.now() / 1000);
        state.responseJson.status = 'completed';
        state.responseJson.model = d.model || '';
        state.responseJson.output = [];
        state.nextOutputIndex = 0;
      }

      // reasoning_content 处理（作为独立的 reasoning item）
      if (info.reasoningContent) {
        if (!state.reasoningAdded) {
          var outputIndex = state.nextOutputIndex++;
          var itemId = 'rs_' + (state.responseJson.id || 'resp');
          state.reasoningAdded = true;
          state.reasoningText = '';
          state.reasoningItemId = itemId;
          state.reasoningOutputIndex = outputIndex;

          // output_item.added (reasoning)
          lines.push('event: response.output_item.added');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_item.added',
                output_index: outputIndex,
                item: { id: itemId, type: 'reasoning', status: 'in_progress', summary: [] }
              })
          );

          // reasoning_summary_part.added
          lines.push('event: response.reasoning_summary_part.added');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.reasoning_summary_part.added',
                item_id: itemId,
                output_index: outputIndex,
                summary_index: 0,
                part: { type: 'summary_text', text: '' }
              })
          );
        }

        state.reasoningText += info.reasoningContent;
        // reasoning_summary_text.delta
        lines.push('event: response.reasoning_summary_text.delta');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.reasoning_summary_text.delta',
              item_id: state.reasoningItemId,
              output_index: state.reasoningOutputIndex,
              summary_index: 0,
              delta: info.reasoningContent
            })
        );
      }

      // content 处理（如果收到 content，先 finalize reasoning）
      if (info.text) {
        // 如果 reasoning 还没结束，先结束它
        finalizeReasoning();

        // 如果 message item 还没创建，创建它
        if (!state.textAdded) {
          state.textAdded = true;
          state.msgOutputIndex = state.nextOutputIndex++;

          // output_item.added (message)
          lines.push('event: response.output_item.added');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_item.added',
                output_index: state.msgOutputIndex,
                item: {
                  type: 'message',
                  id: state.msgId,
                  status: 'in_progress',
                  role: 'assistant',
                  content: []
                }
              })
          );

          // content_part.added
          lines.push('event: response.content_part.added');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.content_part.added',
                output_index: state.msgOutputIndex,
                content_index: 0,
                part: { type: 'output_text', text: '' }
              })
          );
        }

        // output_text.delta
        lines.push('event: response.output_text.delta');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.output_text.delta',
              output_index: state.msgOutputIndex,
              content_index: 0,
              delta: info.text
            })
        );
        state.text = (state.text || '') + info.text;
      }

      // tool_calls handling
      if (info.toolCalls && info.toolCalls.length) {
        // 先结束 reasoning
        finalizeReasoning();

        info.toolCalls.forEach(function (tc) {
          if (!state.toolCalls) state.toolCalls = {};
          // 标准 OpenAI Chat 流式仅首帧带 id/name，后续帧只有 index + 参数增量，
          // 因此必须用 index 作为累积键，否则同一调用会被拆散或丢失。
          var key = tc.index !== undefined && tc.index !== null ? tc.index : tc.id || 0;
          if (!state.toolCalls[key]) {
            state.toolCalls[key] = { id: tc.id || 'call_' + key, name: '', arguments: '' };
            state.toolCalls[key]._added = false;
          }
          var slot = state.toolCalls[key];
          if (tc.id) slot.id = tc.id;
          if (tc.function && tc.function.name) slot.name = tc.function.name;
          if (!slot._added && slot.name) {
            slot._added = true;
            slot._outputIndex = state.nextOutputIndex++;
            lines.push('event: response.output_item.added');
            lines.push(
              'data: ' +
                JSON.stringify({
                  type: 'response.output_item.added',
                  output_index: slot._outputIndex,
                  item: {
                    type: 'function_call',
                    id: slot.id,
                    call_id: slot.id,
                    name: slot.name,
                    arguments: '',
                    status: 'in_progress'
                  }
                })
            );
          }
          var delta = (tc.function && tc.function.arguments) || '';
          if (delta) {
            slot.arguments += delta;
            lines.push('event: response.function_call_arguments.delta');
            lines.push(
              'data: ' +
                JSON.stringify({
                  type: 'response.function_call_arguments.delta',
                  output_index: slot._outputIndex || 0,
                  item_id: slot.id,
                  delta: delta
                })
            );
          }
        });
      }

      if (d.usage) {
        state.responseJson.usage = d.usage;
      }
    } catch (e) {
      /* ignore parse errors */
    }
  });
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// ── Chat Completions（非流式）→ Responses ──
function chatToResponses(chatResp, model) {
  var resp = {
    id: 'resp_' + (chatResp.id || 'chat'),
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: model || chatResp.model || '',
    usage: normalizeResponsesUsage(chatResp.usage),
    output: []
  };
  if (chatResp.choices && chatResp.choices.length) {
    chatResp.choices.forEach(function (choice) {
      var msg = choice.message || {};
      var content = [];
      if (msg.content) content.push({ type: 'output_text', text: msg.content, annotations: [] });
      if (msg.tool_calls) {
        msg.tool_calls.forEach(function (tc) {
          content.push({
            type: 'function_call',
            id: tc.id,
            call_id: tc.id,
            name: (tc.function && tc.function.name) || '',
            arguments: (tc.function && tc.function.arguments) || '',
            status: 'completed'
          });
        });
      }
      resp.output.push({
        type: 'message',
        id: 'msg_' + (chatResp.id || 'chat') + '_' + choice.index,
        role: 'assistant',
        content: content,
        status: 'completed'
      });
    });
  }
  resp.output_text =
    (chatResp.choices &&
      chatResp.choices[0] &&
      chatResp.choices[0].message &&
      chatResp.choices[0].message.content) ||
    '';
  return resp;
}

// 兜底：为没有得到 tool_result 的 tool_use 补一条 user.tool_result 消息。
// Anthropic 要求每个 tool_use 都有对应 tool_result，且消息角色必须交替。
function repairAnthropicToolUse(messages) {
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    var uses = m.content.filter(function (b) {
      return b && b.type === 'tool_use';
    });
    if (!uses.length) continue;
    var answered = {};
    var j = i + 1;
    while (
      j < messages.length &&
      messages[j].role === 'user' &&
      Array.isArray(messages[j].content) &&
      messages[j].content.every(function (b) {
        return b && b.type === 'tool_result';
      })
    ) {
      messages[j].content.forEach(function (b) {
        answered[b.tool_use_id] = true;
      });
      j++;
    }
    var missing = uses.filter(function (b) {
      return !answered[b.id];
    });
    if (missing.length) {
      messages.splice(j, 0, {
        role: 'user',
        content: missing.map(function (b) {
          return { type: 'tool_result', tool_use_id: b.id, content: '(no output)' };
        })
      });
    }
  }
}

// ── Responses API → Anthropic Messages（请求转换） ──
function responsesToAnthropic(body, model) {
  var system = body.instructions || '';
  var messages = [];
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    body.input.forEach(function (item) {
      if (item.type === 'message' && item.role) {
        var c = extractContent(item);
        if (!c) return;
        if (item.role === 'system' || item.role === 'developer') {
          system = system ? system + '\n\n' + c : c;
        } else {
          messages.push({ role: mapRoleForAnthropic(item.role), content: c });
        }
      } else if (item.type === 'function_call') {
        // 助手工具调用 → Anthropic assistant.tool_use 块
        // 连续 function_call 合并进同一条 assistant 消息（Anthropic 要求角色交替）
        var input = {};
        try {
          input = item.arguments ? JSON.parse(item.arguments) : {};
        } catch (e) {
          input = {};
        }
        var block = {
          type: 'tool_use',
          id: item.call_id || item.id || '',
          name: item.name || '',
          input: input
        };
        var lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(block);
        } else {
          messages.push({ role: 'assistant', content: [block] });
        }
      } else if (item.type === 'function_call_output') {
        // 工具结果 → Anthropic user.tool_result 块
        var out = item.output;
        if (typeof out !== 'string') {
          try {
            out = JSON.stringify(out);
          } catch (e) {
            out = String(out);
          }
        }
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: item.call_id || item.id || '', content: out }
          ]
        });
      }
    });
  }
  repairAnthropicToolUse(messages);
  var anthReq = {
    model: model || body.model || 'claude-sonnet-4-20250514',
    messages: messages,
    max_tokens: Number(body.max_output_tokens) || 8192,
    stream: true
  };
  if (system) anthReq.system = system;
  if (body.tools)
    anthReq.tools = body.tools.map(function (t) {
      // Responses tool format → Anthropic tool format
      return {
        name: t.name || (t.function && t.function.name) || '',
        description: t.description || (t.function && t.function.description) || '',
        input_schema: t.input_schema || t.parameters || (t.function && t.function.parameters) || {}
      };
    });
  if (body.temperature !== undefined) anthReq.temperature = body.temperature;
  return anthReq;
}

// ── Anthropic Messages SSE → Responses SSE（流式转换） ──
function sseAnthropicToResponses(raw, respId, state) {
  var lines = [];
  raw.split('\n').forEach(function (line) {
    if (line.indexOf('event: ') === 0) return; // skip event type, use data only
    if (line.indexOf('data: ') !== 0) return;
    try {
      var d = JSON.parse(line.slice(6));
      if (d.type === 'message_start') {
        state.msgId = (d.message && d.message.id) || 'msg_anth';
        state.responseJson = state.responseJson || {};
        state.responseJson.id = 'resp_anth_' + ((d.message && d.message.id) || '');
        state.responseJson.object = 'response';
        state.responseJson.created = Math.floor(Date.now() / 1000);
        state.responseJson.model = (d.message && d.message.model) || '';
        state.responseJson.output = [];
        state.text = '';
        state.toolCalls = {};
        state.nextOutputIndex = 0;
        state.msgOutputIndex = state.nextOutputIndex++;
        lines.push('event: response.output_item.added');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.output_item.added',
              output_index: state.msgOutputIndex,
              item: {
                type: 'message',
                id: state.msgId,
                status: 'in_progress',
                role: 'assistant',
                content: []
              }
            })
        );
        lines.push('event: response.content_part.added');
        lines.push(
          'data: ' +
            JSON.stringify({
              type: 'response.content_part.added',
              output_index: state.msgOutputIndex,
              content_index: 0,
              part: { type: 'output_text', text: '' }
            })
        );
      } else if (d.type === 'content_block_start') {
        if (d.content_block && d.content_block.type === 'tool_use') {
          var tc = d.content_block;
          // 用 Anthropic 的内容块序号 d.index 作累积键；后续 input_json_delta 只带 in
          state.toolCalls[d.index] = {
            id: tc.id,
            name: tc.name,
            arguments: '',
            _outputIndex: state.nextOutputIndex++
          };
          lines.push('event: response.output_item.added');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_item.added',
                output_index: state.toolCalls[d.index]._outputIndex,
                item: {
                  type: 'function_call',
                  id: tc.id,
                  call_id: tc.id,
                  name: tc.name,
                  arguments: '',
                  status: 'in_progress'
                }
              })
          );
        }
      } else if (d.type === 'content_block_delta') {
        if (d.delta && d.delta.type === 'text_delta') {
          lines.push('event: response.output_text.delta');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_text.delta',
                output_index: state.msgOutputIndex,
                content_index: 0,
                delta: d.delta.text
              })
          );
          state.text = (state.text || '') + d.delta.text;
        } else if (d.delta && d.delta.type === 'input_json_delta') {
          var slot = d.index !== undefined && state.toolCalls[d.index];
          if (slot) {
            var pj = d.delta.partial_json || '';
            slot.arguments += pj;
            if (pj) {
              lines.push('event: response.function_call_arguments.delta');
              lines.push(
                'data: ' +
                  JSON.stringify({
                    type: 'response.function_call_arguments.delta',
                    output_index: slot._outputIndex || 0,
                    item_id: slot.id,
                    delta: pj
                  })
              );
            }
          }
        }
      } else if (d.type === 'message_delta') {
        if (d.usage) state.responseJson.usage = normalizeResponsesUsage(d.usage);
      } else if (d.type === 'message_stop') {
        if (state.text) {
          lines.push('event: response.output_text.done');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_text.done',
                output_index: state.msgOutputIndex || 0,
                content_index: 0,
                text: state.text
              })
          );
          lines.push('event: response.content_part.done');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.content_part.done',
                output_index: state.msgOutputIndex || 0,
                content_index: 0,
                part: { type: 'output_text', text: state.text, annotations: [] }
              })
          );
        }
        if (state.msgId) {
          var content = [];
          if (state.text) content.push({ type: 'output_text', text: state.text, annotations: [] });
          Object.keys(state.toolCalls || {}).forEach(function (id) {
            var tc = state.toolCalls[id];
            var doneEvt = {
              type: 'function_call',
              id: tc.id,
              call_id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              status: 'completed'
            };
            lines.push('event: response.output_item.done');
            lines.push(
              'data: ' +
                JSON.stringify({
                  type: 'response.output_item.done',
                  output_index: tc._outputIndex || 0,
                  item: doneEvt
                })
            );
            content.push(doneEvt);
          });
          lines.push('event: response.output_item.done');
          lines.push(
            'data: ' +
              JSON.stringify({
                type: 'response.output_item.done',
                output_index: state.msgOutputIndex || 0,
                item: {
                  type: 'message',
                  id: state.msgId,
                  status: 'completed',
                  role: 'assistant',
                  content: content
                }
              })
          );
          state.responseJson.output.push({
            type: 'message',
            id: state.msgId,
            status: 'completed',
            role: 'assistant',
            content: content
          });
          state.responseJson.usage = normalizeResponsesUsage(state.responseJson.usage);
          lines.push('event: response.completed');
          lines.push(
            'data: ' + JSON.stringify({ type: 'response.completed', response: state.responseJson })
          );
        }
      }
    } catch (e) {
      /* ignore */
    }
  });
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// ── Anthropic Messages（非流式）→ Responses ──
function anthropicToResponses(anthResp, model) {
  var resp = {
    id: 'resp_anth_' + (anthResp.id || ''),
    object: 'response',
    created: Math.floor(Date.now() / 1000),
    model: model || anthResp.model || '',
    usage: normalizeResponsesUsage(anthResp.usage),
    output: []
  };
  if (anthResp.content) {
    var content = [];
    anthResp.content.forEach(function (block) {
      if (block.type === 'text')
        content.push({ type: 'output_text', text: block.text, annotations: [] });
      if (block.type === 'tool_use')
        content.push({
          type: 'function_call',
          id: block.id,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
          status: 'completed'
        });
    });
    resp.output.push({
      type: 'message',
      id: 'msg_anth_' + (anthResp.id || ''),
      role: 'assistant',
      content: content,
      status: 'completed'
    });
  }
  return resp;
}

// ── 路由转换入口 ──
function convertRequest(member, body, path) {
  var apiFormat = member.apiFormat || '';
  if (apiFormat === 'openai_chat') {
    return { body: JSON.stringify(responsesToChat(body, member.model)), path: '/chat/completions' };
  }
  if (apiFormat === 'anthropic') {
    return { body: JSON.stringify(responsesToAnthropic(body, member.model)), path: '/v1/messages' };
  }
  // openai_responses / 空 = 透传
  return { body: JSON.stringify(body), path: path };
}

function convertResponse(member, bodyStr, isStream) {
  var apiFormat = member.apiFormat || '';
  if (!apiFormat) return bodyStr;
  try {
    var body = JSON.parse(bodyStr);
    // 上游错误体（鉴权失败、模型名错误、参数非法等）原样透传，避免被转成空 output 吞掉
    if (body && body.error) return bodyStr;
    if (apiFormat === 'openai_chat') {
      if (!body || !Array.isArray(body.choices) || !body.choices.length) return bodyStr;
      return JSON.stringify(chatToResponses(body, member.model));
    }
    if (apiFormat === 'anthropic') {
      if (!body || !Array.isArray(body.content) || !body.content.length) return bodyStr;
      return JSON.stringify(anthropicToResponses(body, member.model));
    }
  } catch (e) {
    /* pass through */
  }
  return bodyStr;
}

function convertSse(member, chunk, state) {
  var apiFormat = member.apiFormat || '';
  if (!apiFormat) return chunk;
  if (apiFormat === 'openai_chat') return sseChatToResponses(chunk, '', state);
  if (apiFormat === 'anthropic') return sseAnthropicToResponses(chunk, '', state);
  return chunk;
}

module.exports = {
  convertRequest: convertRequest,
  convertResponse: convertResponse,
  convertSse: convertSse
};
