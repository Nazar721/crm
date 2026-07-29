const Utils = {
  formatMoney(n) {
    const num = Number(n) || 0;
    return '₴' + num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  animateCounter(el, target, duration = 600) {
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (target - from) * ease);
      el.textContent = Utils.formatMoney(current);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  stagger(selector, delayMs = 50) {
    const els = document.querySelectorAll(selector);
    els.forEach((el, i) => {
      el.style.animationDelay = `${i * delayMs}ms`;
    });
  },
  formatDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  today() {
    return new Date().toISOString().split('T')[0];
  },
  daysBetween(start, end) {
    const s = new Date(start), e = new Date(end);
    return Math.round((e - s) / 86400000);
  },
  escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  getMonthKey(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
  getMonthLabel(key) {
    if (!key) return '';
    const [y, m] = key.split('-');
    const months = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  },
  formatDateTime(str) {
    if (!str) return '—';
    return new Date(str).toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  },
};

const Banks = {
  list: [
    { id: 'mono', label: 'Monobank', currency: 'UAH', badge: 'badge--black', chartColor: 'rgba(28, 28, 28, 0.92)', borderColor: '#666' },
    { id: 'privat', label: 'PrivatBank', currency: 'UAH', badge: 'badge--green', chartColor: 'rgba(52, 211, 153, 0.65)', borderColor: '#34d399' },
    { id: 'cash', label: 'Готівка ₴', currency: 'UAH', badge: 'badge--paper', chartColor: 'rgba(212, 196, 168, 0.75)', borderColor: '#d4c4a8' },
    { id: 'cash_usd', label: 'Готівка $', currency: 'USD', badge: 'badge--green', chartColor: 'rgba(45, 212, 191, 0.65)', borderColor: '#2dd4bf' },
    { id: 'cash_eur', label: 'Готівка €', currency: 'EUR', badge: 'badge--blue', chartColor: 'rgba(96, 165, 250, 0.62)', borderColor: '#60a5fa' },
  ],

  normalize(value) {
    const v = String(value || '').toLowerCase().trim();
    if (!v) return '';
    if (v === 'mono' || v.includes('monobank') || v.includes('моно')) return 'mono';
    if (v === 'privat' || v.includes('privatbank') || v.includes('приват')) return 'privat';
    if (v === 'cash_usd' || v.includes('готівка $') || v.includes('cash usd') || v.includes('usd')) return 'cash_usd';
    if (v === 'cash_eur' || v.includes('готівка €') || v.includes('cash eur') || v.includes('eur')) return 'cash_eur';
    if (v === 'cash' || v.includes('готів') || v.includes('gotiv')) return 'cash';
    return '';
  },

  label(id) {
    return this.list.find(b => b.id === id)?.label || id || '—';
  },

  populateSelect(selectId, selected = '', emptyLabel = 'Оберіть банк') {
    const el = document.getElementById(selectId);
    if (!el) return;
    const normalized = this.normalize(selected) || selected;
    el.innerHTML = `<option value="">${Utils.escHtml(emptyLabel)}</option>` +
      this.list.map(b => `<option value="${b.id}">${Utils.escHtml(b.label)}</option>`).join('');
    el.value = this.list.some(b => b.id === normalized) ? normalized : '';
  },
};

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || '✓'}</span><span>${Utils.escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

let _confirmCallback = null;
function showConfirm(title, text, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  _confirmCallback = cb;
  openModal('modal-confirm');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.classList.remove('open', 'closing');
    document.body.style.overflow = '';
  }, 220);
}

function statusBadge(status) {
  const map = {
    'В роботі': 'badge--blue',
    'На паузі': 'badge--orange',
    'Очікування оплати': 'badge--gold',
  };
  return `<span class="badge ${map[status] || 'badge--gray'}">${Utils.escHtml(status)}</span>`;
}

function bankBadge(bankId) {
  const id = Banks.normalize(bankId) || bankId;
  const bank = Banks.list.find(b => b.id === id);
  if (!bank) return `<span class="badge badge--gray">${Utils.escHtml(bankId || '—')}</span>`;
  return `<span class="badge ${bank.badge}">${Utils.escHtml(bank.label)}</span>`;
}

function typeBadge(type) {
  const map = {
    IT: 'badge--blue',
    Design: 'badge--pink',
    Video: 'badge--purple',
  };
  return `<span class="badge ${map[type] || 'badge--gray'}">${Utils.escHtml(type)}</span>`;
}

function sourceBadge(source) {
  const map = {
    Telegram: 'badge--blue', Instagram: 'badge--pink', YouTube: 'badge--orange',
    'Реклама': 'badge--purple', 'Сайт': 'badge--teal', 'Сарафанне радіо': 'badge--green', 'Інше': 'badge--gray',
  };
  return `<span class="badge ${map[source] || 'badge--gray'}">${Utils.escHtml(source || 'Інше')}</span>`;
}

function financeTypeBadge(type) {
  return type === 'income'
    ? '<span class="badge badge--green">Дохід</span>'
    : '<span class="badge badge--orange">Витрата</span>';
}

function financeStatusBadge(status) {
  return status === 'done'
    ? '<span class="badge badge--green">Виконано</span>'
    : '<span class="badge badge--purple">Заплановано</span>';
}

function debtTypeBadge(type) {
  return type === 'owed_to_me'
    ? '<span class="badge badge--green">Борг мені</span>'
    : '<span class="badge badge--orange">Мій борг</span>';
}

const pages = {
  dashboard: 'page-dashboard',
  projects: 'page-projects',
  clients: 'page-clients',
  specialists: 'page-specialists',
  partners: 'page-partners',
  leadgen: 'page-leadgen',
  finance: 'page-finance',
  debts: 'page-debts',
  savings: 'page-savings',
  settings: 'page-settings',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(pages[page]);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  if (page === 'dashboard') Dashboard.render();
  if (page === 'projects') Projects.renderAll();
  if (page === 'clients') Clients.render();
  if (page === 'specialists') Specialists.render();
  if (page === 'partners') Partners.render();
  if (page === 'leadgen') LeadGen.render();
  if (page === 'finance') Finance.render();
  if (page === 'debts') Debts.render();
  if (page === 'savings') Savings.render();
  if (page === 'settings') Settings.render();

  closeSidebar();
}

function updateBadges() {
  document.getElementById('nav-badge-projects').textContent = Storage.getProjects().length;
  document.getElementById('nav-badge-clients').textContent = Storage.getClients().length;
  document.getElementById('nav-badge-specialists').textContent = Storage.getSpecialists().length;
  document.getElementById('nav-badge-partners').textContent = Storage.getPartners().length;
  document.getElementById('nav-badge-leads').textContent = Storage.getLeads().length;
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function refreshAll() {
  updateBadges();
  Dashboard.render();
  if (document.getElementById('page-projects').classList.contains('active')) Projects.renderAll();
  if (document.getElementById('page-clients').classList.contains('active')) Clients.render();
  if (document.getElementById('page-specialists').classList.contains('active')) Specialists.render();
  if (document.getElementById('page-partners').classList.contains('active')) Partners.render();
  if (document.getElementById('page-leadgen').classList.contains('active')) LeadGen.render();
  if (document.getElementById('page-finance').classList.contains('active')) Finance.render();
  if (document.getElementById('page-debts').classList.contains('active')) Debts.render();
  if (document.getElementById('page-savings').classList.contains('active')) Savings.render();
  if (document.getElementById('page-settings').classList.contains('active')) Settings.render();
}

function downloadJsonPayload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function backupFilename(prefix = 'webcrm-backup') {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}.json`;
}

function exportBackup() {
  const payload = Storage.exportData();
  downloadJsonPayload(payload, backupFilename('webcrm-export'));
  showToast('Файл експорту завантажено');
}

function downloadManualBackup() {
  Storage.markManualBackup();
  downloadJsonPayload(Storage.exportData(), backupFilename('crm-backup'));
  Settings.render();
  showToast('Резервну копію завантажено');
}

function importBackupFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch {
      showToast('Не вдалося прочитати JSON файл', 'error');
      return;
    }

    showConfirm(
      'Імпортувати backup?',
      'Поточні дані CRM будуть замінені даними з файлу. Перед імпортом краще зробити експорт поточного стану.',
      () => {
        try {
          Storage.importData(payload);
          refreshAll();
          showToast('Дані імпортовано');
        } catch (err) {
          showToast(err.message || 'Не вдалося імпортувати файл', 'error');
        }
      }
    );
  };
  reader.readAsText(file);
}

document.getElementById('btn-confirm-action').addEventListener('click', () => {
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
  closeModal('modal-confirm');
});

document.getElementById('btn-export-data')?.addEventListener('click', exportBackup);
document.getElementById('btn-import-data')?.addEventListener('click', () => {
  const input = document.getElementById('backup-file-input');
  input.value = '';
  input.click();
});
document.getElementById('backup-file-input')?.addEventListener('change', (e) => {
  importBackupFile(e.target.files?.[0]);
});
document.getElementById('btn-download-manual-backup')?.addEventListener('click', downloadManualBackup);
document.getElementById('btn-backup-now')?.addEventListener('click', downloadManualBackup);
document.getElementById('btn-restore-manual-backup')?.addEventListener('click', () => {
  const input = document.getElementById('manual-backup-input');
  input.value = '';
  input.click();
});
document.getElementById('manual-backup-input')?.addEventListener('change', (e) => {
  importBackupFile(e.target.files?.[0]);
});
document.getElementById('btn-backup-later')?.addEventListener('click', () => {
  Storage.snoozeBackupReminder();
  Settings.render();
  showToast('Нагадаю пізніше', 'info');
});

document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

document.getElementById('burger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
});
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
