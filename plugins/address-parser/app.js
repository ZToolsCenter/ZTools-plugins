(function () {
  "use strict";

  function isSupportedHost() {
    if (!window.ztools) return true;
    try {
      return window.addressParserBridge?.hostCompatibility?.().supported === true;
    } catch (_) {
      return false;
    }
  }

  if (!isSupportedHost()) {
    document.querySelector("main").innerHTML = '<section class="workbench"><h2>需要升级 ZTools</h2><p>当前 ZTools 版本过低或无法识别（最低支持 2.4.0）。为了获得更完整、稳定的体验，请升级后再使用收货地址智能解析。</p></section>';
    return;
  }

  const core = window.AddressParserCore;
  const csv = window.AddressCsv;
  const sourceInput = document.getElementById("source-input");
  const parseButton = document.getElementById("parse-button");
  const sampleButton = document.getElementById("sample-button");
  const clearButton = document.getElementById("clear-button");
  const exportButton = document.getElementById("export-button");
  const dragExportButton = document.getElementById("drag-export-button");
  const resultBody = document.getElementById("result-body");
  const emptyState = document.getElementById("empty-state");
  const tableWrap = document.getElementById("table-wrap");
  const toast = document.getElementById("toast");
  const totalCount = document.getElementById("total-count");
  const completeCount = document.getElementById("complete-count");
  const missingCount = document.getElementById("missing-count");
  const pagination = document.getElementById("pagination");
  const previousPage = document.getElementById("previous-page");
  const nextPage = document.getElementById("next-page");
  const pageIndicator = document.getElementById("page-indicator");
  const filterTabs = Array.from(document.querySelectorAll(".filter-tab"));
  const editableFields = ["name", "phone", "province", "city", "district", "detail"];
  const MAX_RECORDS = 1000;
  const PAGE_SIZE = 100;
  const sampleText = [
    "张三 13800138000 广东省深圳市南山区粤海街道科技园科苑路 15 号 A 栋 1201",
    "收件人：李晓明 电话：139-1234-5678 地址：北京市朝阳区望京街道阜通东大街 6 号",
    "王芳，+86 186 8888 6666，浙江省杭州市余杭区五常街道文一西路 998 号",
    "赵敏 021-61234567 上海市浦东新区张江镇祖冲之路 1239 弄 2 号楼",
    "陈先生 13500001111 四川省成都市 高新区天府大道 88 号"
  ].join("\n");

  let records = [];
  let activeFilter = "all";
  let currentPage = 1;
  let toastTimer = null;
  let lastExportPath = "";

  function getSplitMode() {
    const checked = document.querySelector('input[name="split-mode"]:checked');
    return checked ? checked.value : "line";
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("is-error", Boolean(isError));
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function () { toast.classList.remove("is-visible"); }, 2600);
  }

  function updateStats() {
    const complete = records.filter(function (record) { return record.complete; }).length;
    totalCount.textContent = String(records.length);
    completeCount.textContent = String(complete);
    missingCount.textContent = String(records.length - complete);
    exportButton.disabled = records.length === 0;
  }

  function visibleRecords() {
    if (activeFilter === "complete") return records.filter(function (record) { return record.complete; });
    if (activeFilter === "missing") return records.filter(function (record) { return !record.complete; });
    return records;
  }

  function createInput(record, field) {
    const input = document.createElement("input");
    input.className = "cell-input" + (record.missingFields.indexOf(field) >= 0 ? " is-missing" : "");
    input.value = record[field] || "";
    input.type = field === "phone" ? "tel" : "text";
    input.setAttribute("aria-label", core.FIELD_TITLES[field] + "，第 " + record.id + " 条");
    input.dataset.field = field;
    input.dataset.id = String(record.id);
    return input;
  }

  function renderRows() {
    const filtered = visibleRecords();
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    const pageStart = (currentPage - 1) * PAGE_SIZE;
    const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);
    resultBody.replaceChildren();
    emptyState.hidden = records.length > 0;
    tableWrap.hidden = records.length === 0;
    visible.forEach(function (record) {
      const row = document.createElement("tr");
      row.dataset.status = record.complete ? "complete" : "missing";
      row.dataset.id = String(record.id);

      const numberCell = document.createElement("td");
      numberCell.className = "row-number";
      numberCell.textContent = String(record.id).padStart(2, "0");
      row.appendChild(numberCell);

      editableFields.forEach(function (field) {
        const cell = document.createElement("td");
        cell.appendChild(createInput(record, field));
        row.appendChild(cell);
      });

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "status-badge " + (record.complete ? "complete" : "missing");
      badge.textContent = record.complete
        ? "字段完整"
        : "缺 " + record.missingFields.map(function (field) { return core.FIELD_TITLES[field]; }).join("、");
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      const actionCell = document.createElement("td");
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "row-delete";
      removeButton.dataset.removeId = String(record.id);
      removeButton.setAttribute("aria-label", "删除第 " + record.id + " 条");
      removeButton.textContent = "×";
      actionCell.appendChild(removeButton);
      row.appendChild(actionCell);
      resultBody.appendChild(row);
    });

    if (records.length > 0 && filtered.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 9;
      cell.className = "empty-state";
      cell.textContent = activeFilter === "complete" ? "还没有字段完整的记录。" : "没有待补充的记录。";
      row.appendChild(cell);
      resultBody.appendChild(row);
    }
    pagination.hidden = filtered.length <= PAGE_SIZE;
    previousPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= pageCount;
    pageIndicator.textContent = "第 " + currentPage + " / " + pageCount + " 页";
    updateStats();
  }

  function parseSource() {
    const text = sourceInput.value.trim();
    if (!text) {
      showToast("先粘贴至少一条收货信息。", true);
      sourceInput.focus();
      return;
    }
    const splitMode = getSplitMode();
    const sourceRecords = core.splitRecords(text, splitMode);
    if (sourceRecords.length > MAX_RECORDS) {
      showToast("单次最多解析 " + MAX_RECORDS + " 条，请拆分后重试。", true);
      return;
    }
    records = sourceRecords.map(function (record, index) { return core.parseAddress(record, index + 1); });
    activeFilter = "all";
    currentPage = 1;
    filterTabs.forEach(function (tab) {
      const selected = tab.dataset.filter === activeFilter;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    renderRows();
    const missing = records.filter(function (record) { return !record.complete; }).length;
    showToast("已解析 " + records.length + " 条，" + missing + " 条需要补充。", false);
  }

  function clearAll() {
    sourceInput.value = "";
    records = [];
    activeFilter = "all";
    currentPage = 1;
    filterTabs.forEach(function (tab) {
      const selected = tab.dataset.filter === "all";
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    renderRows();
    sourceInput.focus();
  }

  function downloadInBrowser(content, fileName) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    if (!records.length) return;
    const content = csv.recordsToCsv(records);
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const fileName = "收货地址解析结果-" + date + ".csv";
    try {
      if (window.addressParserBridge && typeof window.addressParserBridge.saveCsv === "function") {
        const result = await window.addressParserBridge.saveCsv(content, fileName);
        if (result && result.canceled) return;
        lastExportPath = result.path || "";
        if (lastExportPath && window.addressParserBridge.canStartDrag()) {
          dragExportButton.hidden = false;
          dragExportButton.draggable = true;
        }
        showToast("CSV 已导出：" + (result.path || fileName), false);
      } else {
        downloadInBrowser(content, fileName);
        showToast("CSV 已下载。", false);
      }
    } catch (error) {
      showToast("导出失败：" + (error && error.message ? error.message : "未知错误"), true);
    }
  }

  resultBody.addEventListener("change", function (event) {
    const input = event.target.closest(".cell-input");
    if (!input) return;
    const id = Number(input.dataset.id);
    const index = records.findIndex(function (record) { return record.id === id; });
    if (index < 0) return;
    records[index][input.dataset.field] = input.value.trim();
    records[index] = core.refreshRecord(records[index]);
    renderRows();
  });

  resultBody.addEventListener("click", function (event) {
    const button = event.target.closest("[data-remove-id]");
    if (!button) return;
    const id = Number(button.dataset.removeId);
    records = records.filter(function (record) { return record.id !== id; });
    renderRows();
  });

  filterTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      activeFilter = tab.dataset.filter;
      currentPage = 1;
      filterTabs.forEach(function (item) {
        const selected = item === tab;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      renderRows();
    });
  });

  previousPage.addEventListener("click", function () {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderRows();
    tableWrap.scrollTop = 0;
  });

  nextPage.addEventListener("click", function () {
    const pageCount = Math.max(1, Math.ceil(visibleRecords().length / PAGE_SIZE));
    if (currentPage >= pageCount) return;
    currentPage += 1;
    renderRows();
    tableWrap.scrollTop = 0;
  });

  parseButton.addEventListener("click", parseSource);
  sampleButton.addEventListener("click", function () { sourceInput.value = sampleText; sourceInput.focus(); });
  clearButton.addEventListener("click", clearAll);
  exportButton.addEventListener("click", exportCsv);
  dragExportButton.addEventListener("dragstart", function (event) {
    event.preventDefault();
    if (!lastExportPath) return;
    window.addressParserBridge.startDrag(lastExportPath).catch(function (error) {
      showToast(error && error.message ? error.message : String(error), true);
    });
  });
  sourceInput.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      parseSource();
    }
  });

  if (window.ztools && typeof window.ztools.onPluginEnter === "function") {
    window.ztools.onPluginEnter(function (param) {
      if (param && typeof param.payload === "string" && param.payload.trim()) {
        sourceInput.value = param.payload;
        parseSource();
      } else {
        sourceInput.focus();
      }
    });
  } else {
    sourceInput.focus();
  }
})();
