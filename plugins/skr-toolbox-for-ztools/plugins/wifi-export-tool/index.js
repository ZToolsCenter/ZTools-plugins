let allWifiData = [];
let filteredData = [];
let currentFilter = 'all';
let isInitialized = false;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const countDisplay = document.getElementById('countDisplay');
const refreshBtn = document.getElementById('refreshBtn');
const wifiGrid = document.getElementById('wifiGrid');
const filterBtns = document.querySelectorAll('.filter-btn');

const modal = document.getElementById('wifiModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const closeModalFooterBtn = document.getElementById('closeModalFooterBtn');
const modalSsid = document.getElementById('modalSsid');
const modalInputSsid = document.getElementById('modalInputSsid');
const modalInputSecurity = document.getElementById('modalInputSecurity');
const modalInputPassword = document.getElementById('modalInputPassword');
const togglePasswordBtn = document.getElementById('togglePasswordBtn');
const copyPasswordBtn = document.getElementById('copyPasswordBtn');

function init() {
    if (isInitialized) return;
    bindEvents();
    loadData();
    isInitialized = true;
}

async function loadData() {
    renderLoading();
    try {
        // 增加 100ms 延迟，确保 preload 注入完成（在某些极致环境下可能有竞态）
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('检查 window 属性:', Object.keys(window).filter(k => k.includes('wifi') || k.includes('ztools') || k.includes('service')));
        
        const api = window.wifiApi || globalThis.wifiApi;
        
        if (api && typeof api.getWifiList === 'function') {
            allWifiData = await api.getWifiList();
        } else {
            const detail = !api ? 'wifiApi 缺失' : 'getWifiList 不是函数';
            console.error('Preload API 探测失败:', detail);
            renderEmpty(`系统环境连接失败 (${detail})`);
            return;
        }

        if (allWifiData.length === 0) {
            renderEmpty("未找到已保存的 WiFi 记录，请确认是否有权限或系统是否支持。");
            return;
        }

        applyFilters();
    } catch (error) {
        console.error('Failed to load Wi-Fi lists:', error);
        renderEmpty("加载失败，请重试！\n" + (error.message || error));
    }
}

function bindEvents() {
    // Refresh button
    refreshBtn.addEventListener('click', () => loadData());

    // Search input
    searchInput.addEventListener('input', () => {
        applyFilters();
    });

    // Filter tabs
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.getAttribute('data-filter');
            applyFilters();
        });
    });

    // Modal close
    closeModalBtn.addEventListener('click', closeModal);
    closeModalFooterBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Toggle password visibility
    togglePasswordBtn.addEventListener('click', () => {
        if (!modalInputPassword.value || modalInputPassword.value === '正在获取密码...' || modalInputPassword.value === '无') {
            return;
        }
        if (modalInputPassword.type === 'password') {
            modalInputPassword.type = 'text';
            togglePasswordBtn.textContent = '隐藏密码';
        } else {
            modalInputPassword.type = 'password';
            togglePasswordBtn.textContent = '显示密码';
        }
    });

    // Copy password
    copyPasswordBtn.addEventListener('click', async () => {
        let passwordVal = modalInputPassword.value;
        if (!passwordVal && modalInputSecurity.value === '开放网络') {
            showToast('这是开放网络，没有密码');
            return;
        }

        try {
            // ZTools 提供 window.ztools.copyText (根据 API 规范)
            if (window.ztools && typeof window.ztools.copyText === 'function') {
                window.ztools.copyText(passwordVal);
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(passwordVal);
            } else {
                throw new Error('Clipboard API not available');
            }
            showToast('密码已复制');
        } catch (e) {
            // 兜底方案
            const tempInput = document.createElement('input');
            tempInput.value = passwordVal;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
            showToast('密码已复制(兜底)');
        }
    });
}

function applyFilters() {
    const keyword = searchInput.value.toLowerCase().trim();

    filteredData = allWifiData.filter(item => {
        const matchKeyword = item.ssid.toLowerCase().includes(keyword) ||
            (item.password && item.password.toLowerCase().includes(keyword));

        let matchTag = true;
        if (currentFilter === 'hasPassword') {
            matchTag = item.password === undefined || !!item.password;
        } else if (currentFilter === 'noPassword' || currentFilter === 'open') {
            matchTag = !item.password || (item.securityType && (item.securityType === '开放网络' || item.securityType.includes('Open')));
        }

        return matchKeyword && matchTag;
    });

    renderCards();
}

function renderCards() {
    countDisplay.textContent = `${filteredData.length}个 / 共${allWifiData.length}个`;

    if (filteredData.length === 0) {
        if (allWifiData.length === 0) {
            renderEmpty("当前设备没有保存任何 WiFi 记录");
        } else {
            renderEmpty("抱歉，没有找到匹配的无线网络");
        }
        return;
    }

    const svgIconLock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    const svgIconGlobe = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

    wifiGrid.innerHTML = '';
    filteredData.forEach(item => {
        const isOpen = item.password === '' || (item.securityType && (item.securityType.includes('开放') || item.securityType.includes('Open')));
        const isUnknown = item.password === undefined;

        const card = document.createElement('div');
        card.className = 'wifi-card';
        card.innerHTML = `
      <div class="card-header">
        <div class="card-icon ${isOpen && !isUnknown ? 'open' : ''}">
          ${isOpen && !isUnknown ? svgIconGlobe : svgIconLock}
        </div>
        <div class="card-info">
          <div class="card-title" title="${item.ssid}">${item.ssid}</div>
          <div class="card-type">${item.securityType}</div>
        </div>
      </div>
      <div class="card-status">
        <div class="status-dot ${isUnknown || !isOpen ? 'pwd' : 'open'}"></div>
        <span style="color: var(--text-muted)">${isUnknown ? '点击查看密码' : (isOpen ? '无需密码' : '已保存密码')}</span>
      </div>
    `;

        card.addEventListener('click', () => openModal(item));
        wifiGrid.appendChild(card);
    });
}

async function openModal(item) {
    modalSsid.textContent = item.ssid;
    modalInputSsid.value = item.ssid;
    modalInputSecurity.value = item.securityType;
    modalInputPassword.value = item.password || '';

    modalInputPassword.type = 'password';
    togglePasswordBtn.textContent = '显示密码';

    if (item.password === undefined) {
        modalInputPassword.type = 'text';
        modalInputPassword.value = '正在获取密码...';
        togglePasswordBtn.style.display = 'none';
        modal.classList.add('active');
        
        try {
            const api = window.wifiApi || globalThis.wifiApi;
            if (api && typeof api.getWifiPassword === 'function') {
                const pwd = await api.getWifiPassword(item.ssid);
                item.password = pwd || '';
                
                if (!item.password) {
                    modalInputPassword.value = '无';
                } else {
                    modalInputPassword.type = 'password';
                    modalInputPassword.value = item.password;
                    togglePasswordBtn.style.display = 'block';
                    item.securityType = 'WPA/WPA2';
                    modalInputSecurity.value = item.securityType;
                }
                renderCards();
            } else {
                modalInputPassword.value = '获取失败: 缺少 API';
                item.password = '';
                renderCards();
            }
        } catch (error) {
            modalInputPassword.value = '获取失败';
            item.password = '';
            renderCards();
        }
    } else {
        if (!item.password) {
            togglePasswordBtn.style.display = 'none';
            modalInputPassword.type = 'text';
            modalInputPassword.value = '无';
        } else {
            togglePasswordBtn.style.display = 'block';
            modalInputPassword.type = 'password';
            modalInputPassword.value = item.password;
        }
        modal.classList.add('active');
    }
}

function closeModal() {
    modal.classList.remove('active');
}

function renderLoading() {
    wifiGrid.innerHTML = `
    <div class="loading-wrapper">
      <div class="loading-spinner"></div>
      <div>正在从系统读取WiFi凭证信息...</div>
    </div>
  `;
}

function renderEmpty(text) {
    wifiGrid.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      <div>${text}</div>
    </div>
  `;
}

function showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    void toast.offsetWidth;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 2000);
}

// ZTools Plugin Events
if (window.ztools) {
    window.ztools.onPluginEnter(({ code, type, payload }) => {
        console.log('Plugin entered:', code, type, payload);
        // ZTools 基础 API 中可能不包含 setExpandHeight，
        // 插件高度通常由 plugin.json 或自动高度控制。
        if (typeof window.ztools.setExpandHeight === 'function') {
            window.ztools.setExpandHeight(600);
        }
        init();
    });
} else {
    // 浏览器预览环境下
    document.addEventListener('DOMContentLoaded', init);
}
