/* =============================================
   clients.js — Clients (auto-created from projects)
   ============================================= */

const Clients = {
  findOrCreate(name, telegram, source) {
    const clients = Storage.getClients();
    let client = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!client) {
      client = {
        id: Storage.generateId(),
        name,
        telegram: telegram || '',
        source: source || 'Інше',
      };
      clients.push(client);
      Storage.saveClients(clients);
    }
    return client;
  },

  render() {
    const clients = Storage.getClients();
    const tbody = document.getElementById('tbody-clients');
    const searchVal = document.getElementById('clients-search').value.toLowerCase();
    const sourceFilter = document.getElementById('clients-filter-source').value;

    const filtered = clients.filter(c => {
      const matchSearch = c.name.toLowerCase().includes(searchVal) ||
        (c.telegram || '').toLowerCase().includes(searchVal);
      const matchSource = !sourceFilter || c.source === sourceFilter;
      return matchSearch && matchSource;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><div class="empty-state"><span>Немає клієнтів</span><small>Клієнти додаються автоматично при створенні проєкту</small></div></td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((c, i) => {
      const stats = Calc.clientStats(c.id);
      return `
        <tr class="anim-row" style="animation-delay:${i * 30}ms">
          <td><strong>${Utils.escHtml(c.name)}</strong>${c.isRegular ? ' <span class="badge badge--green" style="font-size:0.7em;margin-left:4px">Постійний</span>' : ''}</td>
          <td>${c.telegram ? `<a href="https://t.me/${c.telegram.replace('@', '')}" target="_blank" class="link">${Utils.escHtml(c.telegram)}</a>` : '—'}</td>
          <td>${sourceBadge(c.source)}</td>
          <td>${stats.count}</td>
          <td>${Utils.formatMoney(stats.totalBudget)}</td>
          <td style="color:var(--accent-green)">${Utils.formatMoney(stats.totalProfit)}</td>
          <td>${Utils.formatMoney(stats.totalPrepayment)}</td>
          <td style="color:${stats.clientDebt > 0 ? 'var(--accent-orange)' : 'var(--text-secondary)'}">${Utils.formatMoney(stats.clientDebt)}</td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon btn-icon--edit" title="Редагувати" onclick="Clients.openEdit('${c.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button class="btn-icon btn-icon--danger" title="Видалити" onclick="Clients.delete('${c.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  openEdit(id) {
    const c = Storage.getClients().find(x => x.id === id);
    if (!c) return;
    document.getElementById('client-id').value = c.id;
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-telegram').value = c.telegram || '';
    document.getElementById('client-source').value = c.source || 'Інше';
    document.getElementById('client-is-regular').checked = !!c.isRegular;
    openModal('modal-client');
  },

  save() {
    const id = document.getElementById('client-id').value;
    const name = document.getElementById('client-name').value.trim();
    if (!name) { showToast('Введіть ім\'я клієнта', 'error'); return; }

    const clients = Storage.getClients();
    const idx = clients.findIndex(c => c.id === id);
    if (idx < 0) return;

    clients[idx].name = name;
    clients[idx].telegram = document.getElementById('client-telegram').value.trim();
    clients[idx].source = document.getElementById('client-source').value;
    clients[idx].isRegular = document.getElementById('client-is-regular').checked;
    Storage.saveClients(clients);
    closeModal('modal-client');
    this.render();
    showToast('Клієнта оновлено');
  },

  delete(id) {
    showConfirm('Видалити клієнта?', 'Клієнт буде видалений. Проєкти залишаться.', () => {
      Storage.saveClients(Storage.getClients().filter(c => c.id !== id));
      this.render();
      updateBadges();
      showToast('Клієнта видалено');
    });
  },
};

document.getElementById('btn-save-client').addEventListener('click', () => Clients.save());
document.getElementById('clients-search').addEventListener('input', () => Clients.render());
document.getElementById('clients-filter-source').addEventListener('change', () => Clients.render());
