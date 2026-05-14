// local-publisher.js — tab riêng: bật / tắt Publisher Walrus chạy trên máy (127.0.0.1).

import {
  getLocalPublisherBaseUrl,
  setLocalPublisherBaseUrl,
  clearLocalPublisherBaseUrl,
} from './walrus.js';

const inputEl = document.getElementById('local-publisher-url');
const statusEl = document.getElementById('local-publisher-status');
const saveBtn = document.getElementById('local-publisher-save');
const clearBtn = document.getElementById('local-publisher-clear');
const testBtn = document.getElementById('local-publisher-test');

function showStatus(msg, type = 'info') {
  if (!statusEl) return;
  if (!msg) {
    statusEl.textContent = '';
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.dataset.statusType = type;
}

function loadCurrent() {
  const cur = getLocalPublisherBaseUrl();
  if (inputEl) inputEl.value = cur || 'http://127.0.0.1:31416';
}

saveBtn?.addEventListener('click', () => {
  const raw = inputEl?.value?.trim() ?? '';
  try {
    setLocalPublisherBaseUrl(raw);
    if (!raw) {
      showStatus('Đã tắt: trình duyệt chỉ dùng publisher mainnet mặc định.', 'info');
    } else {
      showStatus(`Đã lưu Publisher local: ${getLocalPublisherBaseUrl()}. Tải lại Builder / Form để áp dụng (hoặc F5).`, 'info');
    }
    window.dispatchEvent(new CustomEvent('walforms:local-publisher-changed'));
  } catch (e) {
    showStatus(e.message || String(e), 'error');
  }
});

clearBtn?.addEventListener('click', () => {
  clearLocalPublisherBaseUrl();
  loadCurrent();
  showStatus('Đã xóa cấu hình Publisher local.', 'info');
  window.dispatchEvent(new CustomEvent('walforms:local-publisher-changed'));
});

testBtn?.addEventListener('click', async () => {
  const raw = inputEl?.value?.trim() ?? '';
  if (!raw) {
    showStatus('Nhập URL publisher trước khi kiểm tra.', 'error');
    return;
  }
  let base;
  try {
    base = raw.replace(/\/+$/, '');
    new URL(base);
  } catch {
    showStatus('URL không hợp lệ.', 'error');
    return;
  }
  showStatus('Đang gọi /v1/api …', 'info');
  try {
    const res = await fetch(`${base}/v1/api`, { method: 'GET', cache: 'no-store' });
    if (res.ok) {
      showStatus(`OK — HTTP ${res.status}. Publisher phản hồi (có thể lưu cấu hình).`, 'info');
    } else {
      showStatus(`Phản hồi HTTP ${res.status}. Kiểm tra walrus publisher đã chạy chưa.`, 'error');
    }
  } catch (e) {
    showStatus(
      `Không kết nối được: ${e.message}. CORS / mixed content: xem cảnh báo dưới; thử mở WalForms qua http://localhost cùng máy.`,
      'error',
    );
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadCurrent();
  const cur = getLocalPublisherBaseUrl();
  if (cur) {
    showStatus(`Đang bật Publisher local: ${cur}`, 'info');
  } else {
    showStatus('', 'info');
  }
});
