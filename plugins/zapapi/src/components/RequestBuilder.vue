<template>
  <div class="request-builder"
    :class="{ 'request-builder--with-response': hasResponse, 'request-builder--response-collapsed': responseCollapsed }">
    <div class="request-bar">
      <UiSelect data-tour-id="request-method" variant="method" v-model="request.method" :options="methodOptions" class="request-bar__method" />
      <UiVariableInput ref="requestUrlInputRef" data-tour-id="request-url" data-shortcut-id="request-url-input"
        v-model="request.url" :placeholder="t('request.urlPlaceholder')" class="request-bar__url"
        @mouseup="handleUrlSelection"
        @keydown="(e: KeyboardEvent) => { if (e.key !== 'Enter') closeUrlMenu(); else (!isSocket ? $emit('send') : (request.socket.status === 'connected' ? $emit('disconnect') : $emit('connect'))) }" />
      <template v-if="!isSocket">
        <UiButton data-tour-id="request-send" variant="primary" size="sm" class="request-bar__send"
          :disabled="sending || !request.url" :icon-only="!sidebarCollapsed" @click="$emit('send')">
          <svg v-if="!sending" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <svg v-else class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          <span v-if="sidebarCollapsed">{{ sending ? t('request.sending') : t('request.send') }}</span>
        </UiButton>
      </template>
      <template v-else>
        <UiButton variant="primary" size="sm" class="request-bar__send"
          :disabled="!request.url || request.socket.status === 'connecting'" :icon-only="!sidebarCollapsed"
          @click="request.socket.status === 'connected' ? $emit('disconnect') : $emit('connect')">
          <template v-if="request.socket.status === 'connecting'">
            <svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            <span v-if="sidebarCollapsed">{{ t('socket.connecting') }}</span>
          </template>
          <template v-else-if="request.socket.status === 'connected'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            </svg>
            <span v-if="sidebarCollapsed">{{ t('socket.disconnect') }}</span>
          </template>
          <template v-else>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span v-if="sidebarCollapsed">{{ t('socket.connect') }}</span>
          </template>
        </UiButton>
      </template>
      <UiButton data-tour-id="request-save" variant="secondary" size="sm" class="request-bar__save" :disabled="sending"
        :icon-only="!sidebarCollapsed" @click="$emit('save')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span v-if="sidebarCollapsed">{{ t('common.save') }}</span>
      </UiButton>
      <UiButton v-if="sending" variant="warning" size="sm" class="request-bar__cancel" :icon-only="!sidebarCollapsed"
        @click="$emit('cancel')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <circle cx="12" cy="12" r="9" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
        <span v-if="sidebarCollapsed">{{ t('request.cancel') }}</span>
      </UiButton>
    </div>

    <UiTabs data-tour-id="request-config-tabs" v-model="activeTab" :tabs="currentTabs">
      <template #default="{ activeTab: tab }">
        <div v-if="tab === 'messages'" class="tab-content tab-content--no-pad socket-messages-tab">
          <div ref="socketMessagesListRef" class="socket-messages-list" @scroll="onSocketMessagesScroll">
            <div v-if="request.socket.messages.length === 0" class="socket-empty">
              {{ t('socket.emptyMessages') }}
            </div>
            <div v-for="msg in request.socket.messages" :key="msg.id" class="socket-message"
              :class="'socket-message--' + msg.type">
              <div class="socket-message__meta">
                <span class="socket-message__type">{{ socketMessageTypeLabel(msg.type) }}</span>
                <span class="socket-message__time">{{ new Date(msg.time).toLocaleTimeString() }}</span>
              </div>
              <div class="socket-message__data">{{ msg.data }}</div>
            </div>
          </div>
          <div v-if="newMessageCount > 0" class="socket-new-messages">
            <UiButton variant="secondary" size="xs" @click="jumpToLatest">
              {{ t('socket.newMessages', { count: newMessageCount }) }}
            </UiButton>
          </div>
          <div class="socket-compose">
            <UiTextarea v-model="socketMessage" :placeholder="t('socket.messagePlaceholder')" :rows="4"
              @keydown="(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { $emit('socketSend', socketMessage); socketMessage = ''; } }" />
            <div class="socket-compose-actions">
              <span class="socket-compose-hint">{{ t('socket.sendHint') }}</span>
              <UiButton variant="primary" size="sm" :disabled="!socketMessage || request.socket.status !== 'connected'"
                @click="$emit('socketSend', socketMessage); socketMessage = '';">
                {{ t('socket.send') }}
              </UiButton>
            </div>
          </div>
        </div>

        <div v-if="tab === 'params'" class="tab-content tab-content--no-pad tab-content--fill">
          <UiTableEditor :rows="request.params" :key-label="t('request.paramName')" :value-label="t('request.value')"
            :key-placeholder="t('request.paramKeyPlaceholder')" :value-placeholder="t('request.paramValuePlaceholder')"
            @update:rows="(rows) => request.params = rows" />
        </div>
        <div v-if="tab === 'headers'" class="tab-content tab-content--no-pad tab-content--fill">
          <UiTableEditor :rows="request.headers" :key-label="t('request.headerPlaceholder')"
            :value-label="t('request.value')" :key-suggestions="commonHeaderKeys"
            :value-suggestions-map="headerValueSuggestionsMap" suggestion-scope="headers"
            value-suggestion-scope="headers" :key-placeholder="t('request.headerKeyPlaceholder')"
            :value-placeholder="t('request.headerValuePlaceholder')" @update:rows="(rows) => request.headers = rows" />
        </div>
        <div v-if="tab === 'cookies'" class="tab-content tab-content--no-pad tab-content--fill">
          <div class="auth-editor">
            <div class="auth-layout">
              <div class="auth-panel-left">
                <div class="auth-field">
                  <span class="auth-field__label">{{ t('request.cookiePolicy') }}</span>
                  <UiSelect v-model="request.cookiePolicy.mode" :options="cookiePolicyOptions" />
                </div>
                <p class="auth-description">{{ cookiePolicyDescription }}</p>
              </div>
              <div class="auth-panel-right">
                <div class="auth-empty">
                  {{ t('request.cookieHint') }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="tab === 'auth'" class="tab-content tab-content--no-pad tab-content--fill">
          <div class="auth-editor">
            <div class="auth-layout">
              <div class="auth-panel-left">
                <div class="auth-field">
                  <span class="auth-field__label">{{ t('request.authType') }}</span>
                  <UiSelect v-model="request.auth.type" :options="authTypeOptions" />
                </div>
                <div class="auth-description-head">
                  <span class="auth-description-icon" aria-hidden="true">
                    <svg v-if="request.auth.type === 'bearer'" width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2">
                      <path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />
                      <path d="M9 12l2 2 4-4" />
                    </svg>
                    <svg v-else-if="request.auth.type === 'basic'" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="8" r="3" />
                      <path d="M4 20a8 8 0 0 1 16 0" />
                    </svg>
                    <svg v-else-if="request.auth.type === 'apikey'" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="8" cy="15" r="4" />
                      <path d="M12 15h9" />
                      <path d="M18 12v6" />
                    </svg>
                    <svg v-else-if="request.auth.type === 'jwt-bearer'" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M7 10h10" />
                      <path d="M7 14h7" />
                    </svg>
                    <svg v-else-if="request.auth.type === 'digest'" width="14" height="14" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 3v2" />
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="2">
                      <circle cx="12" cy="12" r="9" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                    </svg>
                  </span>
                  <span class="auth-description-title">{{ authTypeLabel }}</span>
                </div>
                <p class="auth-description">{{ authDescription }}</p>
              </div>

              <div class="auth-panel-right">
                <div v-if="request.auth.type === 'bearer'" class="auth-fields">
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.token') }}</span>
                    <UiInput v-model="request.auth.token" :placeholder="t('request.bearerToken')" />
                  </div>
                </div>
                <div v-if="request.auth.type === 'basic'" class="auth-fields">
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.username') }}</span>
                    <UiInput v-model="request.auth.username" :placeholder="t('request.username')" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.password') }}</span>
                    <UiInput v-model="request.auth.password" type="password" :placeholder="t('request.password')" />
                  </div>
                </div>
                <div v-if="request.auth.type === 'apikey'" class="auth-fields">
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.key') }}</span>
                    <UiInput v-model="request.auth.apiKey" :placeholder="t('request.apiKeyValue')" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.addTo') }}</span>
                    <UiSelect v-model="request.auth.apiKeyLocation" :options="apiKeyLocationOptions" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.headerName') }}</span>
                    <UiInput v-model="request.auth.apiKeyHeader" :placeholder="t('request.apiKeyHeaderPlaceholder')" />
                  </div>
                </div>
                <div v-if="request.auth.type === 'jwt-bearer'" class="auth-fields">
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.jwtAlgorithm') }}</span>
                    <UiSelect v-model="request.auth.jwtAlgorithm" :options="jwtAlgorithmOptions" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.jwtSecret') }}</span>
                    <UiInput v-model="request.auth.jwtSecret" type="password" :placeholder="t('request.jwtSecret')" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.jwtPayload') }}</span>
                    <UiTextarea v-model="request.auth.jwtPayload" :rows="4"
                      :placeholder="t('request.jwtPayloadPlaceholder')" />
                  </div>
                  <button type="button" class="auth-advanced-toggle" @click="jwtAdvancedOpen = !jwtAdvancedOpen">
                    <svg class="auth-advanced-toggle__icon"
                      :class="{ 'auth-advanced-toggle__icon--open': jwtAdvancedOpen }" width="12" height="12"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    {{ t('request.jwtAdvanced') }}
                  </button>
                  <div v-if="jwtAdvancedOpen" class="auth-advanced-panel">
                    <div class="auth-field">
                      <span class="auth-field__label">{{ t('request.jwtHeaderPrefix') }}</span>
                      <UiInput v-model="request.auth.jwtHeaderPrefix"
                        :placeholder="t('request.jwtHeaderPrefixPlaceholder')" />
                    </div>
                    <div class="auth-field">
                      <span class="auth-field__label">{{ t('request.jwtHeader') }}</span>
                      <UiTextarea v-model="request.auth.jwtHeader" :rows="3"
                        :placeholder="t('request.jwtHeaderPlaceholder')" />
                    </div>
                    <div class="auth-inline-controls">
                      <label class="auth-inline-check">
                        <input v-model="request.auth.jwtAutoIat" type="checkbox" />
                        <span>{{ t('request.jwtAutoIat') }}</span>
                      </label>
                    </div>
                    <div class="auth-inline-controls">
                      <label class="auth-inline-check">
                        <input v-model="request.auth.jwtAutoExp" type="checkbox" />
                        <span>{{ t('request.jwtAutoExp') }}</span>
                      </label>
                      <UiInput v-model="request.auth.jwtExpSeconds" :disabled="!request.auth.jwtAutoExp"
                        :placeholder="t('request.jwtExpSeconds')" />
                    </div>
                  </div>
                  <div class="auth-preview">
                    <span class="auth-field__label">{{ t('request.jwtPreview') }}</span>
                    <UiTextarea v-if="jwtPreviewToken" :model-value="jwtPreviewToken" :rows="3" disabled />
                    <div v-else-if="jwtPreviewError" class="auth-preview auth-preview--error">
                      {{ jwtPreviewError }}
                    </div>
                  </div>
                </div>
                <div v-if="request.auth.type === 'digest'" class="auth-fields">
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.digestUsername') }}</span>
                    <UiInput v-model="request.auth.digestUsername" :placeholder="t('request.username')" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.digestPassword') }}</span>
                    <UiInput v-model="request.auth.digestPassword" type="password"
                      :placeholder="t('request.password')" />
                  </div>
                  <div class="auth-field">
                    <span class="auth-field__label">{{ t('request.digestAlgorithm') }}</span>
                    <UiSelect v-model="request.auth.digestAlgorithm" :options="digestAlgorithmOptions" />
                  </div>
                </div>
                <div v-if="request.auth.type === 'none'" class="auth-empty">
                  {{ t('request.noAuth') }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="tab === 'body'" class="tab-content tab-content--no-pad tab-content--fill">
          <div class="body-editor">
            <div class="body-type-selector">
              <div class="body-type-pills">
                <div v-for="opt in bodyKindOptions" :key="opt.value" class="body-type-pill"
                  :class="{ active: request.body.kind === opt.value }" @click="setBodyKind(opt.value)">
                  {{ opt.label }}
                </div>
              </div>
              <div v-if="request.body.kind !== 'none'" class="body-content-type">
                <span class="body-content-type__label">{{ t('request.contentTypeShort') }}</span>
                <UiSelect :model-value="request.body.contentType" :options="bodyContentTypeOptions"
                  class="body-content-type__select"
                  @update:model-value="onBodyContentTypeChange(String($event || ''))" />
                <span v-if="contentTypeOverridden" class="body-content-type__overridden">{{
                  t('request.contentTypeOverridden') }}</span>
              </div>
            </div>
            <div v-if="request.body.kind === 'text' || request.body.kind === 'other'"
              class="body-panel body-panel--editor body-textarea">
              <UiTextarea v-model="request.body.raw"
                :placeholder="isJsonLikeContentType ? jsonPlaceholder : t('request.bodyPlaceholder')" :rows="8" />
            </div>
            <div
              v-if="request.body.kind === 'structured' && request.body.contentType === 'application/x-www-form-urlencoded'"
              class="body-panel body-panel--editor body-kv">
              <UiTableEditor :rows="request.body.formData" :key-label="t('request.fieldName')"
                :value-label="t('request.value')" :key-placeholder="t('request.fieldKeyPlaceholder')"
                :value-placeholder="t('request.fieldValuePlaceholder')"
                @update:rows="(rows) => request.body.formData = rows.map(r => ({ ...r, isFile: false }))" />
            </div>
            <div v-if="request.body.kind === 'structured' && request.body.contentType === 'multipart/form-data'"
              class="body-panel body-panel--editor body-kv formdata-editor">
              <div class="formdata-editor__head">
                <div class="formdata-editor__col formdata-editor__col--check"></div>
                <div class="formdata-editor__col formdata-editor__col--key">{{ t('request.fieldName') }}</div>
                <div class="formdata-editor__col formdata-editor__col--type">{{ t('request.type') }}</div>
                <div class="formdata-editor__col">{{ t('request.value') }}</div>
                <div class="formdata-editor__col formdata-editor__col--action"></div>
              </div>
              <div class="formdata-editor__body">
                <div v-for="(row, index) in formDataRows" :key="index" class="formdata-editor__row"
                  :class="{ 'formdata-editor__row--disabled': !row.enabled }">
                  <div class="formdata-editor__col formdata-editor__col--check">
                    <div class="formdata-check" :class="{ active: row.enabled }" @click="toggleFormDataRow(index)">
                      <svg v-if="row.enabled" width="10" height="10" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                  <div class="formdata-editor__col formdata-editor__col--key">
                    <UiInput :model-value="row.key" :placeholder="t('request.fieldKeyPlaceholder')"
                      @update:model-value="updateFormDataField(index, 'key', $event)" @focus="onFormDataFocus(index)" />
                  </div>
                  <div class="formdata-editor__col formdata-editor__col--type">
                    <UiSelect :model-value="row.isFile ? 'file' : 'text'" :options="formDataTypeOptions"
                      @update:model-value="setFormDataType(index, String($event || 'text'))" />
                  </div>
                  <div class="formdata-editor__col">
                    <template v-if="row.isFile">
                      <div class="formdata-file-input">
                        <input :ref="(el) => setFileInputRef(el as HTMLInputElement | null, index)"
                          class="formdata-file-input__native" type="file"
                          @change="onFormDataFileChange(index, $event)" />
                        <UiButton size="xs" variant="ghost" @click="triggerFileSelect(index)">
                          {{ t('request.selectFile') }}
                        </UiButton>
                        <span class="formdata-file-input__name">{{ row.value || t('request.noFileSelected') }}</span>
                        <UiButton v-if="row.value" size="xs" variant="ghost" @click="clearFormDataFileAt(index)">
                          {{ t('request.clearFile') }}
                        </UiButton>
                      </div>
                    </template>
                    <UiInput v-else :model-value="row.value" :placeholder="t('request.fieldValuePlaceholder')"
                      @update:model-value="updateFormDataField(index, 'value', $event)" />
                  </div>
                  <div class="formdata-editor__col formdata-editor__col--action">
                    <UiButton v-if="index < request.body.formData.length - 1" variant="ghost" size="xs" icon-only
                      @click="removeFormDataRow(index)">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </UiButton>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="request.body.kind === 'binary'" class="body-panel body-panel--editor body-binary">
              <input ref="binaryFileInputRef" class="body-binary__native" type="file" @change="onBinaryFileChange" />
              <button type="button" class="body-binary-dropzone"
                :class="{ 'body-binary-dropzone--active': binaryDropActive }" @click="triggerBinarySelect"
                @dragenter.prevent="onBinaryDragEnter" @dragover.prevent="onBinaryDragOver"
                @dragleave.prevent="onBinaryDragLeave" @drop.prevent="onBinaryDrop">
                <span class="body-binary-dropzone__icon" aria-hidden="true">
                  <svg v-if="request.body.binary.fileName" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="1.9">
                    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 13h6" />
                    <path d="M9 17h6" />
                  </svg>
                  <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2.1">
                    <path d="M12 16V8" />
                    <path d="M8 12h8" />
                    <path d="M20 16.5a4.5 4.5 0 0 0-1.6-8.7A5.5 5.5 0 0 0 7.3 9.1 4 4 0 0 0 8 17h12" />
                  </svg>
                </span>
                <span class="body-binary-dropzone__title">{{ request.body.binary.fileName ||
                  t('request.binaryDropTitle')
                  }}</span>
                <span class="body-binary-dropzone__hint">{{ t('request.binaryDropHint') }}</span>
              </button>
              <div class="body-binary__actions">
                <UiButton size="xs" variant="secondary" @click="triggerBinarySelect">
                  {{ request.body.binary.fileName ? t('request.replaceFile') : t('request.selectFile') }}
                </UiButton>
                <UiButton v-if="request.body.binary.fileName" size="xs" variant="ghost" @click="clearBinaryFile">
                  {{ t('request.clearFile') }}
                </UiButton>
              </div>
              <div v-if="request.body.binary.fileName" class="body-binary__details">
                <span class="body-binary-pill">
                  <span class="body-binary-pill__label">{{ t('request.fileSize') }}</span>
                  <UiBadge size="sm" variant="default">{{ binaryFileSizeLabel }}</UiBadge>
                </span>
                <span class="body-binary-pill">
                  <span class="body-binary-pill__label">{{ t('request.fileType') }}</span>
                  <UiBadge size="sm" variant="info">{{ binaryFileTypeLabel }}</UiBadge>
                </span>
              </div>
            </div>
            <div v-if="request.body.kind === 'none'" class="auth-empty body-panel body-empty">
              {{ t('request.noBody') }}
            </div>

          </div>
        </div>
      </template>
    </UiTabs>

    <div v-if="showUrlMenu" class="url-context-overlay" @mousedown="closeUrlMenu" @contextmenu.prevent="closeUrlMenu"></div>
    <div v-if="showUrlMenu" class="url-context-menu" :style="{ left: urlMenuPos.x + 'px', top: urlMenuPos.y + 'px' }" @mousedown.stop>
      <button class="url-context-item" @click="runUrlMenuAction('var')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        {{ t('request.urlMenu.setVar') }}
      </button>
      <button class="url-context-item" @click="runUrlMenuAction('newTab')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
          <rect x="8" y="8" width="10" height="10" rx="1"/>
          <line x1="13" y1="11" x2="13" y2="15"/>
          <line x1="11" y1="13" x2="15" y2="13"/>
        </svg>
        {{ t('request.urlMenu.newTab') }}
      </button>
      <button class="url-context-item" @click="runUrlMenuAction('encode')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        {{ t('request.urlMenu.encode') }}
      </button>
      <button class="url-context-item" @click="runUrlMenuAction('decode')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        </svg>
        {{ t('request.urlMenu.decode') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RequestState, ResponseState } from '../store/request'
import UiSelect from './ui/UiSelect.vue'
import UiInput from './ui/UiInput.vue'
import UiVariableInput from './ui/UiVariableInput.vue'
import UiButton from './ui/UiButton.vue'
import UiBadge from './ui/UiBadge.vue'
import UiTabs from './ui/UiTabs.vue'
import UiTableEditor from './ui/UiTableEditor.vue'
import UiTextarea from './ui/UiTextarea.vue'
import { createJwtToken } from '../utils/jwt'
import { ensureFileToken, setFormDataFile, clearFormDataFile } from '../utils/formDataFileStore'
import type { BodyKind } from '../store/request'
import { useEnvironmentStore } from '../store/environments'

const { t } = useI18n()
const envStore = useEnvironmentStore()

const props = defineProps<{
  request: RequestState
  response: ResponseState
  sending: boolean
  hasResponse: boolean
  responseCollapsed: boolean
  sidebarCollapsed: boolean
}>()

const emit = defineEmits<{
  send: []
  save: []
  cancel: []
  connect: []
  disconnect: []
  socketSend: [message: string]
  'new-tab-with-url': [url: string]
}>()

const activeTab = ref('params')
const socketMessage = ref('')
const requestUrlInputRef = ref<{ focus: () => void; inputRef?: HTMLInputElement } | null>(null)

const showUrlMenu = ref(false)
const urlMenuPos = ref({ x: 0, y: 0 })
const urlSelection = ref({ start: 0, end: 0, text: '' })

function handleUrlSelection(e: MouseEvent) {
  nextTick(() => {
    const inputEl = requestUrlInputRef.value?.inputRef
    if (!inputEl) {
      showUrlMenu.value = false
      return
    }

    const start = inputEl.selectionStart ?? 0
    const end = inputEl.selectionEnd ?? 0

    if (start !== end && end > start) {
      const text = inputEl.value.substring(start, end)
      urlSelection.value = { start, end, text }

      // Clamp position to viewport
      const menuW = 220
      const menuH = 180
      let x = e.clientX
      let y = e.clientY + 12
      if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8
      if (y + menuH > window.innerHeight) y = e.clientY - menuH - 4
      urlMenuPos.value = { x, y }
      showUrlMenu.value = true
    } else {
      showUrlMenu.value = false
    }
  })
}

function closeUrlMenu() {
  showUrlMenu.value = false
}

watch(() => props.request.url, () => {
  showUrlMenu.value = false
})

function updateUrl(newUrl: string) {
  props.request.url = newUrl
}

function runUrlMenuAction(action: 'var' | 'newTab' | 'encode' | 'decode') {
  const { start, end, text } = urlSelection.value
  const oldUrl = props.request.url || ''

  if (action === 'encode') {
    updateUrl(oldUrl.substring(0, start) + encodeURIComponent(text) + oldUrl.substring(end))
  } else if (action === 'decode') {
    try {
      updateUrl(oldUrl.substring(0, start) + decodeURIComponent(text) + oldUrl.substring(end))
    } catch {
      // invalid encoding, ignore
    }
  } else if (action === 'var') {
    const varName = text.trim()
    if (varName) {
      // Add variable to active environment (create one if none exists)
      let env = envStore.getActiveEnv()
      if (!env) {
        env = envStore.createEnvironment('Default')
      }
      // Only add if the variable doesn't already exist
      const exists = env.variables.some((v) => v.key === varName)
      if (!exists) {
        env.variables.push({ key: varName, value: text })
      }
      updateUrl(oldUrl.substring(0, start) + `{{${varName}}}` + oldUrl.substring(end))
    }
  } else if (action === 'newTab') {
    emit('new-tab-with-url', text)
  }

  closeUrlMenu()
  nextTick(() => {
    requestUrlInputRef.value?.focus()
  })
}
const JWT_ADVANCED_STORAGE_KEY = 'zapapi_jwt_advanced_open'

function loadJwtAdvancedOpen(): boolean {
  try {
    return localStorage.getItem(JWT_ADVANCED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const jwtAdvancedOpen = ref(loadJwtAdvancedOpen())
const socketMessagesListRef = ref<HTMLElement | null>(null)
const shouldStickToBottom = ref(true)
const newMessageCount = ref(0)

const isSocket = computed(() => ['WS', 'TCP', 'UDP'].includes(props.request.method))
const isWs = computed(() => props.request.method === 'WS')
const isTcpOrUdp = computed(() => ['TCP', 'UDP'].includes(props.request.method))

function handleSocketSend() {
  if (socketMessage.value && props.request.socket.status === 'connected') {
    // $emit expects string
  }
}

function focusRequestUrlInput() {
  requestUrlInputRef.value?.focus()
}

defineExpose({
  focusRequestUrlInput
})

const methodOptions = [
  {
    label: t('request.methodGroupHttp'),
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'POST', value: 'POST' },
      { label: 'PUT', value: 'PUT' },
      { label: 'DELETE', value: 'DELETE' },
      { label: 'PATCH', value: 'PATCH' },
      { label: 'HEAD', value: 'HEAD' },
      { label: 'OPTIONS', value: 'OPTIONS' }
    ]
  },
  {
    label: t('request.methodGroupSocket'),
    options: [
      { label: 'WS', value: 'WS' },
      { label: 'TCP', value: 'TCP' },
      { label: 'UDP', value: 'UDP' }
    ]
  }
]

const commonHeaderKeys = [
  'Authorization',
  'Content-Type',
  'Accept',
  'X-API-Key',
  'User-Agent',
  'Cookie',
  'Cache-Control',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Connection',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Length',
  'DNT',
  'ETag',
  'Expect',
  'Forwarded',
  'Host',
  'Idempotency-Key',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Range',
  'If-Unmodified-Since',
  'Last-Modified',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'Sec-Fetch-Dest',
  'Sec-Fetch-Mode',
  'Sec-Fetch-Site',
  'Sec-Fetch-User',
  'TE',
  'Transfer-Encoding',
  'Upgrade',
  'Via',
  'WWW-Authenticate',
  'X-Auth-Token',
  'X-Client-Id',
  'X-Correlation-Id',
  'X-Device-Id',
  'X-Forwarded-For',
  'X-Forwarded-Host',
  'X-Forwarded-Proto',
  'X-Real-IP',
  'X-Request-Id',
  'X-Requested-With'
]

const headerValueSuggestionsMap: Record<string, string[]> = {
  'content-type': [
    'application/json',
    'application/xml',
    'text/plain',
    'text/html',
    'multipart/form-data',
    'application/x-www-form-urlencoded'
  ],
  accept: [
    'application/json',
    'application/xml',
    'text/html',
    'text/plain',
    '*/*'
  ],
  'accept-encoding': [
    'gzip',
    'deflate',
    'br',
    'gzip, deflate, br'
  ],
  'accept-language': [
    'zh-CN,zh;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'zh-TW,zh;q=0.9,en;q=0.8'
  ],
  authorization: [
    'Bearer ',
    'Basic '
  ],
  connection: [
    'keep-alive',
    'close'
  ],
  'cache-control': [
    'no-cache',
    'no-store',
    'max-age=0',
    'public, max-age=3600'
  ],
  pragma: [
    'no-cache'
  ],
  'x-requested-with': [
    'XMLHttpRequest'
  ],
  'upgrade-insecure-requests': [
    '1'
  ],
  dnt: [
    '1',
    '0'
  ]
}

const authTypeOptions = computed(() => [
  { label: t('request.none'), value: 'none' },
  { label: t('request.bearer'), value: 'bearer' },
  { label: t('request.basic'), value: 'basic' },
  { label: t('request.apikey'), value: 'apikey' },
  { label: t('request.jwtBearer'), value: 'jwt-bearer' },
  { label: t('request.digest'), value: 'digest' }
])

const apiKeyLocationOptions = [
  { label: 'Header', value: 'header' },
  { label: 'Query', value: 'query' }
]

const digestAlgorithmOptions = [
  { label: 'MD5', value: 'MD5' },
  { label: 'MD5-sess', value: 'MD5-sess' },
  { label: 'SHA-256', value: 'SHA-256' },
  { label: 'SHA-256-sess', value: 'SHA-256-sess' }
]

const jwtAlgorithmOptions = [
  { label: 'HS256', value: 'HS256' },
  { label: 'HS384', value: 'HS384' },
  { label: 'HS512', value: 'HS512' }
]

const formDataTypeOptions = [
  { label: t('request.formText'), value: 'text' },
  { label: t('request.formFile'), value: 'file' }
]

const bodyKindOptions = computed<Array<{ label: string; value: BodyKind }>>(() => [
  { label: t('request.bodyKindNone'), value: 'none' },
  { label: t('request.bodyKindText'), value: 'text' },
  { label: t('request.bodyKindStructured'), value: 'structured' },
  { label: t('request.bodyKindBinary'), value: 'binary' },
  { label: t('request.bodyKindOther'), value: 'other' }
])

const textContentTypes = [
  'application/json',
  'application/ld+json',
  'application/hal+json',
  'application/vnd.api+json',
  'application/xml',
  'text/xml'
]

const structuredContentTypes = [
  'application/x-www-form-urlencoded',
  'multipart/form-data'
]

const binaryContentTypes = [
  'application/octet-stream'
]

const otherContentTypes = [
  'text/html',
  'text/plain'
]

const bodyContentTypeOptions = computed(() => {
  const contentTypes = props.request.body.kind === 'text'
    ? textContentTypes
    : props.request.body.kind === 'structured'
      ? structuredContentTypes
      : props.request.body.kind === 'binary'
        ? binaryContentTypes
        : otherContentTypes

  return contentTypes.map((value) => ({ label: value, value }))
})

const isJsonLikeContentType = computed(() => props.request.body.contentType.includes('json'))

const contentTypeOverridden = computed(() => {
  const header = props.request.headers.find((h) => h.enabled && h.key.toLowerCase() === 'content-type')
  if (!header) return false
  return header.value.trim().toLowerCase() !== props.request.body.contentType.trim().toLowerCase()
})

const binaryFileSizeLabel = computed(() => {
  const size = props.request.body.binary.fileSize
  if (!size || size < 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
})

const binaryFileTypeLabel = computed(() => props.request.body.binary.fileType || t('request.unknown'))

const jsonPlaceholder = '{\n  "key": "value"\n}'

const enabledParamsCount = computed(() => props.request.params.filter((p) => p.enabled && p.key).length)
const enabledHeadersCount = computed(() => props.request.headers.filter((h) => h.enabled && h.key).length)

const currentTabs = computed(() => {
  if (isWs.value) {
    return [
      { key: 'messages', label: t('socket.messages') },
      { key: 'params', label: t('request.params'), badge: enabledParamsCount.value }
    ]
  }

  if (isTcpOrUdp.value) {
    return [
      { key: 'messages', label: t('socket.messages') }
    ]
  }

  return [
    { key: 'params', label: t('request.params'), badge: enabledParamsCount.value },
    { key: 'headers', label: t('request.headers'), badge: enabledHeadersCount.value },
    { key: 'cookies', label: t('response.cookies') },
    { key: 'auth', label: t('request.authorization') },
    { key: 'body', label: t('request.body') }
  ]
})

const cookiePolicyOptions = computed(() => [
  { label: t('request.cookiePolicyInherit'), value: 'inherit' },
  { label: t('request.cookiePolicyEnable'), value: 'enable' },
  { label: t('request.cookiePolicyDisable'), value: 'disable' }
])

const cookiePolicyDescription = computed(() => {
  if (props.request.cookiePolicy.mode === 'enable') {
    return t('request.cookiePolicyEnableDesc')
  }
  if (props.request.cookiePolicy.mode === 'disable') {
    return t('request.cookiePolicyDisableDesc')
  }
  return t('request.cookiePolicyInheritDesc')
})

const authDescription = computed(() => {
  if (props.request.auth.type === 'bearer') return t('request.authDescBearer')
  if (props.request.auth.type === 'basic') return t('request.authDescBasic')
  if (props.request.auth.type === 'apikey') return t('request.authDescApiKey')
  if (props.request.auth.type === 'jwt-bearer') return t('request.authDescJwtBearer')
  if (props.request.auth.type === 'digest') return t('request.authDescDigest')
  return t('request.authDescNone')
})

const authTypeLabel = computed(() => {
  if (props.request.auth.type === 'bearer') return t('request.bearer')
  if (props.request.auth.type === 'basic') return t('request.basic')
  if (props.request.auth.type === 'apikey') return t('request.apikey')
  if (props.request.auth.type === 'jwt-bearer') return t('request.jwtBearer')
  if (props.request.auth.type === 'digest') return t('request.digest')
  return t('request.none')
})

const jwtPreviewToken = ref('')
const jwtPreviewError = ref('')
const formDataFileInputs = ref<Array<HTMLInputElement | null>>([])
const binaryFileInputRef = ref<HTMLInputElement | null>(null)
const binaryDropActive = ref(false)

function inferKindFromLegacyType(type: string): BodyKind {
  if (type === 'none') return 'none'
  if (type === 'json') return 'text'
  if (type === 'urlencoded' || type === 'formdata') return 'structured'
  return 'other'
}

function inferContentTypeFromState(): string {
  if (props.request.body.contentType) return props.request.body.contentType
  if (props.request.body.type === 'json') return 'application/json'
  if (props.request.body.type === 'urlencoded') return 'application/x-www-form-urlencoded'
  if (props.request.body.type === 'formdata') return 'multipart/form-data'
  if (props.request.body.kind === 'binary') return 'application/octet-stream'
  return props.request.body.kind === 'other' ? 'text/plain' : ''
}

function ensureBodyModel() {
  if (!props.request.body.binary) {
    props.request.body.binary = {}
  }

  if (!props.request.body.kind) {
    props.request.body.kind = inferKindFromLegacyType(props.request.body.type)
  }

  if (!props.request.body.contentType && props.request.body.kind !== 'none') {
    props.request.body.contentType = inferContentTypeFromState()
  }

  if (props.request.body.kind === 'none') {
    props.request.body.type = 'none'
    props.request.body.contentType = ''
  }
}

function setBodyKind(kind: BodyKind) {
  props.request.body.kind = kind
  if (kind === 'none') {
    props.request.body.contentType = ''
    props.request.body.type = 'none'
    return
  }

  if (kind === 'text') {
    props.request.body.contentType = textContentTypes.includes(props.request.body.contentType)
      ? props.request.body.contentType
      : 'application/json'
    props.request.body.type = props.request.body.contentType === 'application/json' ? 'json' : 'raw'
    return
  }

  if (kind === 'structured') {
    props.request.body.contentType = structuredContentTypes.includes(props.request.body.contentType)
      ? props.request.body.contentType
      : 'application/x-www-form-urlencoded'
    props.request.body.type = props.request.body.contentType === 'multipart/form-data' ? 'formdata' : 'urlencoded'
    return
  }

  if (kind === 'binary') {
    props.request.body.contentType = 'application/octet-stream'
    props.request.body.type = 'raw'
    return
  }

  props.request.body.contentType = otherContentTypes.includes(props.request.body.contentType)
    ? props.request.body.contentType
    : 'text/plain'
  props.request.body.type = 'raw'
}

function onBodyContentTypeChange(contentType: string) {
  props.request.body.contentType = contentType
  if (props.request.body.kind === 'structured') {
    props.request.body.type = contentType === 'multipart/form-data' ? 'formdata' : 'urlencoded'
    return
  }

  if (props.request.body.kind === 'text') {
    props.request.body.type = contentType === 'application/json' ? 'json' : 'raw'
    return
  }

  if (props.request.body.kind === 'none') {
    props.request.body.type = 'none'
    return
  }

  props.request.body.type = 'raw'
}

async function triggerBinarySelect() {
  await nextTick()
  binaryFileInputRef.value?.click()
}

function setBinaryFile(file: File) {
  const token = ensureFileToken(props.request.body.binary.fileToken)
  setFormDataFile(token, file)
  props.request.body.binary = {
    fileToken: token,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type
  }
}

function onBinaryFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  setBinaryFile(file)
}

function onBinaryDragEnter() {
  binaryDropActive.value = true
}

function onBinaryDragOver() {
  binaryDropActive.value = true
}

function onBinaryDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (!current || !related || !current.contains(related)) {
    binaryDropActive.value = false
  }
}

function onBinaryDrop(event: DragEvent) {
  binaryDropActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) {
    return
  }
  setBinaryFile(file)
}

function clearBinaryFile() {
  clearFormDataFile(props.request.body.binary.fileToken)
  props.request.body.binary = {}
  if (binaryFileInputRef.value) {
    binaryFileInputRef.value.value = ''
  }
}

watch(
  () => [props.request.body.type, props.request.body.kind, props.request.body.contentType],
  () => {
    ensureBodyModel()
  },
  { immediate: true }
)

const formDataRows = computed(() => {
  const rows = [...props.request.body.formData]
  const last = rows[rows.length - 1]
  if (!last || last.key || last.value) {
    rows.push({ key: '', value: '', enabled: false, isFile: false })
  }
  return rows
})

function setFileInputRef(el: HTMLInputElement | null, index: number) {
  formDataFileInputs.value[index] = el
}

function ensureEditableFormDataRows() {
  if (props.request.body.formData.length === 0) {
    props.request.body.formData = [{ key: '', value: '', enabled: false, isFile: false }]
  }
}

function ensureFormDataRowAt(index: number) {
  ensureEditableFormDataRows()
  if (index < props.request.body.formData.length) {
    return
  }

  const rows = [...props.request.body.formData]
  while (rows.length <= index) {
    rows.push({ key: '', value: '', enabled: false, isFile: false })
  }
  props.request.body.formData = rows
}

function onFormDataFocus(index: number) {
  ensureEditableFormDataRows()
  if (index === props.request.body.formData.length - 1) {
    const row = props.request.body.formData[index]
    if (row && (row.key || row.value)) {
      props.request.body.formData = [...props.request.body.formData, { key: '', value: '', enabled: false, isFile: false }]
    }
  }
}

function updateFormDataField(index: number, field: 'key' | 'value', value: string) {
  ensureEditableFormDataRows()
  const rows = [...props.request.body.formData]
  const row = { ...rows[index], [field]: value }
  if (!row.enabled && (row.key.trim() || row.value.trim())) {
    row.enabled = true
  }
  rows[index] = row
  props.request.body.formData = rows
}

function toggleFormDataRow(index: number) {
  if (index >= props.request.body.formData.length) return
  const rows = [...props.request.body.formData]
  rows[index] = { ...rows[index], enabled: !rows[index].enabled }
  props.request.body.formData = rows
}

function setFormDataType(index: number, type: string) {
  ensureFormDataRowAt(index)
  const rows = [...props.request.body.formData]
  const prev = rows[index]
  if (!prev) return

  if (type === 'file') {
    rows[index] = {
      ...prev,
      isFile: true,
      fileToken: ensureFileToken(prev.fileToken),
      value: prev.isFile ? prev.value : ''
    }
  } else {
    clearFormDataFile(prev.fileToken)
    rows[index] = {
      ...prev,
      isFile: false,
      fileToken: undefined,
      value: ''
    }
  }

  props.request.body.formData = rows
}

async function triggerFileSelect(index: number) {
  ensureFormDataRowAt(index)
  if (!props.request.body.formData[index]?.isFile) {
    setFormDataType(index, 'file')
  }
  await nextTick()
  formDataFileInputs.value[index]?.click()
}

function onFormDataFileChange(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  ensureFormDataRowAt(index)

  const rows = [...props.request.body.formData]
  const row = rows[index]
  const token = ensureFileToken(row.fileToken)
  setFormDataFile(token, file)
  rows[index] = {
    ...row,
    enabled: true,
    isFile: true,
    fileToken: token,
    value: file.name
  }
  props.request.body.formData = rows
}

function clearFormDataFileAt(index: number) {
  if (index >= props.request.body.formData.length) return
  const rows = [...props.request.body.formData]
  const row = rows[index]
  clearFormDataFile(row.fileToken)
  rows[index] = {
    ...row,
    value: '',
    fileToken: undefined
  }
  props.request.body.formData = rows
  const input = formDataFileInputs.value[index]
  if (input) {
    input.value = ''
  }
}

function removeFormDataRow(index: number) {
  const row = props.request.body.formData[index]
  if (!row) return
  clearFormDataFile(row.fileToken)
  const next = props.request.body.formData.filter((_, i) => i !== index)
  props.request.body.formData = next.length > 0 ? next : [{ key: '', value: '', enabled: false, isFile: false }]
}

watch(
  () => [
    props.request.auth.type,
    props.request.auth.jwtSecret,
    props.request.auth.jwtAlgorithm,
    props.request.auth.jwtHeaderPrefix,
    props.request.auth.jwtHeader,
    props.request.auth.jwtPayload,
    props.request.auth.jwtAutoIat,
    props.request.auth.jwtAutoExp,
    props.request.auth.jwtExpSeconds
  ],
  async () => {
    if (props.request.auth.type !== 'jwt-bearer') {
      jwtPreviewToken.value = ''
      jwtPreviewError.value = ''
      return
    }

    try {
      jwtPreviewToken.value = await createJwtToken({
        algorithm: props.request.auth.jwtAlgorithm,
        headerJson: props.request.auth.jwtHeader,
        payloadJson: props.request.auth.jwtPayload,
        secret: props.request.auth.jwtSecret,
        autoIat: props.request.auth.jwtAutoIat,
        autoExp: props.request.auth.jwtAutoExp,
        expSeconds: props.request.auth.jwtExpSeconds
      })
      jwtPreviewError.value = ''
    } catch (error: unknown) {
      jwtPreviewToken.value = ''
      jwtPreviewError.value = error instanceof Error ? error.message : t('request.invalidJwt')
    }
  },
  { immediate: true }
)

watch(jwtAdvancedOpen, (open) => {
  try {
    localStorage.setItem(JWT_ADVANCED_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // ignore storage failures
  }
})

function socketMessageTypeLabel(type: 'sent' | 'received' | 'system') {
  if (type === 'sent') return t('socket.typeSent')
  if (type === 'received') return t('socket.typeReceived')
  return t('socket.typeSystem')
}

function scrollSocketMessagesToBottom() {
  const el = socketMessagesListRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function isNearBottom(el: HTMLElement): boolean {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  return distance <= 24
}

function onSocketMessagesScroll() {
  const el = socketMessagesListRef.value
  if (!el) return
  shouldStickToBottom.value = isNearBottom(el)
  if (shouldStickToBottom.value) {
    newMessageCount.value = 0
  }
}

async function jumpToLatest() {
  shouldStickToBottom.value = true
  newMessageCount.value = 0
  await nextTick()
  scrollSocketMessagesToBottom()
}

watch(currentTabs, (tabs) => {
  if (!tabs.some((tab) => tab.key === activeTab.value)) {
    activeTab.value = tabs[0]?.key || 'params'
  }
}, { immediate: true })

watch(
  () => props.request.socket.messages.length,
  async (newLen, oldLen) => {
    if (activeTab.value !== 'messages') return
    if (newLen === 0) {
      newMessageCount.value = 0
      return
    }

    const delta = Math.max(0, newLen - (oldLen ?? newLen))
    if (!shouldStickToBottom.value) {
      if (delta > 0) {
        newMessageCount.value += delta
      }
      return
    }

    await nextTick()
    scrollSocketMessagesToBottom()
    newMessageCount.value = 0
  }
)

watch(
  activeTab,
  async (tab) => {
    if (tab !== 'messages') return
    await nextTick()
    shouldStickToBottom.value = true
    newMessageCount.value = 0
    scrollSocketMessagesToBottom()
  }
)

</script>

<style scoped>
.request-builder {
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  transition: height var(--transition-base), flex-basis var(--transition-base);
}

.request-builder--with-response {
  height: 260px;
  flex: 0 0 auto;
}

.request-builder--with-response.request-builder--response-collapsed {
  height: calc(100% - 42px);
  flex: 0 0 auto;
}

.request-builder :deep(.ui-tabs) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.request-builder :deep(.ui-tabs__content) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-top: var(--space-xs);
  padding-bottom: var(--space-xs);
}

.socket-messages-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.socket-messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-color);
  display: flex;
  flex-direction: column;
}

.socket-empty {
  color: var(--text-color-secondary);
  text-align: center;
  margin-top: 20px;
}

.socket-message {
  margin-bottom: 12px;
  border-radius: 4px;
  padding: 8px;
  word-break: break-all;
  font-family: monospace;
}

.socket-message--sent {
  background: rgba(40, 167, 69, 0.1);
  border-left: 3px solid #28a745;
}

.socket-message--received {
  background: rgba(0, 123, 255, 0.1);
  border-left: 3px solid #007bff;
}

.socket-message--system {
  background: rgba(108, 117, 125, 0.1);
  border-left: 3px solid #6c757d;
  font-style: italic;
  justify-content: center;
  align-self: center;
  font-size: 11px;
}

.socket-message__meta {
  font-size: 11px;
  color: var(--text-color-secondary);
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.socket-new-messages {
  display: flex;
  justify-content: center;
  padding: 8px 12px 0;
  background: var(--panel-bg);
}

.socket-compose {
  border-top: 1px solid var(--border-color);
  padding: 12px;
  background: var(--panel-bg);
}

.socket-compose-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.socket-compose-hint {
  font-size: 12px;
  color: var(--text-color-secondary);
}

.request-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  background: var(--panel-bg);
}

.request-bar__method {
  flex-shrink: 0;
}

.request-bar__url {
  flex: 1;
  min-width: 0;
}

.request-bar__send {
  margin-left: auto;
  flex-shrink: 0;
}

.request-bar__cancel {
  flex-shrink: 0;
}

.request-bar__save {
  flex-shrink: 0;
}

.tab-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.tab-content,
.tab-content--fill> :first-child,
.socket-messages-list,
.auth-panel-left,
.auth-panel-right,
.auth-fields,
.body-editor {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tab-content::-webkit-scrollbar,
.tab-content--fill> :first-child::-webkit-scrollbar,
.socket-messages-list::-webkit-scrollbar,
.auth-panel-left::-webkit-scrollbar,
.auth-panel-right::-webkit-scrollbar,
.auth-fields::-webkit-scrollbar,
.body-editor::-webkit-scrollbar {
  display: none;
}

.tab-content--no-pad {
  padding: 0 var(--space-sm);
}

.tab-content--fill {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-content--fill> :first-child {
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-sm);
  overflow-y: auto;
  overflow-x: hidden;
}

.tab-content--fill :deep(.ui-table-editor) {
  height: 100%;
}

/* Auth Editor */
.auth-editor {
  height: 100%;
  min-height: 0;
  display: flex;
}

.auth-layout {
  display: grid;
  grid-template-columns: minmax(170px, 210px) minmax(0, 1fr);
  gap: var(--space-md);
  width: 100%;
  height: 100%;
  min-height: 0;
  align-items: stretch;
}

.auth-panel-left {
  height: 100%;
  padding: var(--space-md);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  overflow-y: auto;
}

.auth-description {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.auth-description-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.auth-description-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--accent-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
}

.auth-description-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.auth-panel-right {
  display: flex;
  height: 100%;
  min-width: 0;
  overflow-y: auto;
}

.auth-fields {
  width: 100%;
}

.auth-fields,
.auth-empty {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow-y: auto;
}

.auth-inline-controls {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.auth-advanced-toggle {
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: 12px;
  padding: 6px 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.auth-advanced-toggle:hover {
  color: var(--text-primary);
}

.auth-advanced-toggle__icon {
  transition: transform var(--transition-fast);
}

.auth-advanced-toggle__icon--open {
  transform: rotate(180deg);
}

.auth-advanced-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  background: var(--bg-base);
}

.auth-inline-controls :deep(.ui-input-wrapper) {
  flex: 1;
}

.auth-inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.auth-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.auth-preview--error {
  font-size: 12px;
  color: var(--error-color);
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.auth-field__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}

.auth-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-xl);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

/* Body Editor */
.body-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.body-type-selector {
  display: flex;
  gap: var(--space-sm);
  padding: 4px;
  min-height: 40px;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  align-items: center;
  justify-content: space-between;
}

.body-type-pills {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.body-content-type {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.body-content-type__label {
  font-size: 11px;
  color: var(--text-muted);
}

.body-content-type__select {
  min-width: 180px;
  max-width: min(34vw, 340px);
}

.body-panel {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.body-panel--editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: var(--space-sm);
}

.body-content-type__overridden {
  font-size: 11px;
  color: var(--warning-color);
}

.body-type-pill {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-base);
  border-radius: var(--radius-sm);
  user-select: none;
}

.body-type-pill:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.body-type-pill.active {
  color: var(--accent-primary);
  background: var(--bg-elevated);
}

.body-textarea {
  height: 100%;
  padding: 0;
}

.body-textarea :deep(.ui-textarea-wrapper) {
  height: 100%;
}

.body-textarea :deep(.ui-textarea) {
  height: 100%;
  min-height: 180px;
}

.body-kv {
  height: 100%;
  padding: 0;
}

.body-kv :deep(.ui-table-editor) {
  height: 100%;
  border: none;
  border-radius: 0;
}

.formdata-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: none;
  border-radius: inherit;
  background: transparent;
}

.formdata-editor__head,
.formdata-editor__row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1.2fr) 120px minmax(0, 1fr) 36px;
  align-items: center;
}

.formdata-editor__head {
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.formdata-editor__body {
  overflow-y: auto;
}

.formdata-editor__row {
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.formdata-editor__row:last-child {
  border-bottom: none;
}

.formdata-editor__row:hover {
  background: var(--bg-elevated);
}

.formdata-editor__row--disabled {
  opacity: 0.7;
  background: transparent;
}

.formdata-editor__col {
  padding: 0;
  min-width: 0;
  border-right: 1px solid var(--border-color);
  display: flex;
  align-items: center;
}

.formdata-editor__col:last-child {
  border-right: none;
}

.formdata-editor__head .formdata-editor__col {
  padding: 6px 12px;
}

.formdata-editor__col--check,
.formdata-editor__col--action {
  width: 36px;
  min-width: 36px;
  padding: 6px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.formdata-editor__col--key,
.formdata-editor__col--type,
.formdata-editor__row .formdata-editor__col:not(.formdata-editor__col--check):not(.formdata-editor__col--action) {
  padding: 0;
}

.formdata-editor__row .formdata-editor__col :deep(.ui-input-wrapper),
.formdata-editor__row .formdata-editor__col :deep(.ui-select__trigger) {
  border: none;
  border-radius: 0;
  background: transparent;
}

.formdata-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
}

.formdata-check.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: var(--bg-surface);
}

.formdata-file-input {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.formdata-file-input__native {
  display: none;
}

.formdata-file-input__name {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body-binary {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  flex: 1;
  height: 100%;
  padding: var(--space-sm);
  min-height: 0;
  justify-content: flex-start;
}

.body-binary__native {
  display: none;
}

.body-binary-dropzone {
  width: 100%;
  flex: 1;
  min-height: 0;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
  text-align: center;
  padding: var(--space-md);
}

.body-binary-dropzone:hover {
  border-color: var(--border-color-hover);
  background: var(--bg-elevated);
}

.body-binary-dropzone--active {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-surface));
}

.body-binary-dropzone__icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: var(--bg-overlay);
}

.body-binary-dropzone__icon svg {
  display: block;
}

.body-binary-dropzone__title {
  font-size: 12px;
  color: var(--text-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body-binary-dropzone__hint {
  font-size: 11px;
  color: var(--text-muted);
}

.body-binary__actions {
  display: flex;
  gap: 8px;
}

.body-binary__details {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.body-binary-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.body-binary-pill__label {
  font-size: 11px;
  color: var(--text-muted);
}

.body-empty {
  flex: 1;
  min-height: 0;
  padding: var(--space-md);
}

.spinner {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.url-context-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  /* transparent overlay that closes menu on click without blocking propagation */
}

.url-context-menu {
  position: fixed;
  z-index: 10001;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.url-context-item {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.url-context-item:hover {
  background: var(--bg-elevated);
}

.url-context-item svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}
</style>
