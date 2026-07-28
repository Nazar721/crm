/* =============================================
   finance.js — Транзакції / Cashflow
   ============================================= */

const Finance = {
  render() {
    this.renderConverter();
    this.renderSummary();
    Charts.renderMonthlyIncome('chart-finance-income', 'financeIncome', Storage.getTransactions(), true);
    Charts.renderBankBalances('chart-finance-banks', 'financeBanks');
    this.renderTable();
  },

  renderConverter() {
    const settings = Storage.getFinanceSettings();
    const usd = document.getElementById('finance-usd-rate');
    const eur = document.getElementById('finance-eur-rate');
    if (usd && !usd.value) usd.value = settings.usdRate;
    if (eur && !eur.value) eur.value = settings.eurRate;
    Banks.populateSelect('conversion-from', document.getElementById('conversion-from')?.value || 'mono', 'Звідки');
    Banks.populateSelect('conversion-to', document.getElementById('conversion-to')?.value || 'cash', 'Куди');
  },

  renderSummary() {
    const transactions = Storage.getTransactions();
    const balance = Calc.financeBalance(transactions);
    document.getElementById('finance-balance').textContent = Utils.formatMoney(balance);
  },

  getFiltered() {
    const transactions = Storage.getTransactions();
    const search = document.getElementById('finance-search').value.toLowerCase();
    const typeFilter = document.getElementById('finance-filter-type').value;

    return transactions
      .filter(t => {
        if (t.hidden) return false;
        const bankLabel = Banks.label(Banks.normalize(t.bank) || t.bank).toLowerCase();
        const matchSearch = (t.description || '').toLowerCase().includes(search) ||
          (t.category || '').toLowerCase().includes(search) ||
          bankLabel.includes(search);
        const matchType = !typeFilter || t.type === typeFilter;
        return matchSearch && matchType;
      })
      .sort((a, b) => new Date(b.date || b.plannedDate) - new Date(a.date || a.plannedDate));
  },

  weekMarker(dateStr) {
    const date = new Date(dateStr || Utils.today());
    const day = (date.getDay() + 6) % 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - day);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekIndex = Math.floor(monday.getTime() / 604800000);

    return {
      className: weekIndex % 2 === 0 ? 'week-a' : 'week-b',
      title: `${Utils.formatDate(monday.toISOString().slice(0, 10))} - ${Utils.formatDate(sunday.toISOString().slice(0, 10))}`,
    };
  },

  renderTable() {
    const tbody = document.getElementById('tbody-finance');
    const filtered = this.getFiltered();

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="empty-state"><span>Немає транзакцій</span><small>Додайте дохід або витрату</small></div></td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((t, i) => {
      if (t.type === 'transfer') return this.renderTransferRow(t, i);
      const amountColor = t.type === 'income' ? 'var(--accent-green)' : 'var(--accent-orange)';
      const sign = t.type === 'income' ? '+' : '−';
      const week = this.weekMarker(t.date || t.plannedDate);
      return `
        <tr class="${week.className}">
          <td>${financeTypeBadge(t.type)}</td>
          <td style="color:${amountColor};font-weight:600">${sign}${this.formatBankAmount(t.amount, t.bank)}</td>
          <td>${bankBadge(t.bank)}</td>
          <td>${Utils.escHtml(t.category || '—')}</td>
          <td>${Utils.escHtml(t.description || '—')}</td>
          <td><span class="week-date"><span class="week-dot" title="${Utils.escHtml(week.title)}"></span>${Utils.formatDate(t.date || t.plannedDate)}</span></td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon btn-icon--edit" title="Редагувати" onclick="Finance.openEdit('${t.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button class="btn-icon btn-icon--danger" title="Видалити" onclick="Finance.delete('${t.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  renderTransferRow(t) {
    const week = this.weekMarker(t.date || t.plannedDate);
    return `
      <tr class="${week.className}">
        <td><span class="badge badge--blue">Конвертація</span></td>
        <td style="color:var(--accent-blue);font-weight:600">${this.formatBankAmount(t.amount, t.bank)} → ${this.formatBankAmount(t.targetAmount ?? t.amount, t.toBank)}</td>
        <td>${bankBadge(t.bank)} → ${bankBadge(t.toBank)}</td>
        <td>Конвертація</td>
        <td>${Utils.escHtml(t.description || '—')}</td>
        <td><span class="week-date"><span class="week-dot" title="${Utils.escHtml(week.title)}"></span>${Utils.formatDate(t.date || t.plannedDate)}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon btn-icon--danger" title="Видалити" onclick="Finance.delete('${t.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  },

  formatBankAmount(amount, bankId) {
    const currency = Calc.bankCurrency(bankId);
    const value = Number(amount) || 0;
    if (currency === 'USD') return '$' + value.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    if (currency === 'EUR') return '€' + value.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    return Utils.formatMoney(value);
  },

  openCreate(type = 'income') {
    document.getElementById('transaction-id').value = '';
    document.getElementById('transaction-type').value = type;
    document.getElementById('transaction-amount').value = '';
    Banks.populateSelect('transaction-bank');
    document.getElementById('transaction-category').value = '';
    document.getElementById('transaction-description').value = '';
    document.getElementById('transaction-date').value = Utils.today();
    document.getElementById('transaction-income-status').value = 'earned';
    this._toggleIncomeStatus(type);
    openModal('modal-finance');
  },

  openEdit(id) {
    const t = Storage.getTransactions().find(x => x.id === id);
    if (!t) return;
    document.getElementById('transaction-id').value = t.id;
    document.getElementById('transaction-type').value = t.type;
    document.getElementById('transaction-amount').value = t.amount || '';
    Banks.populateSelect('transaction-bank', t.bank || '');
    document.getElementById('transaction-category').value = t.category || '';
    document.getElementById('transaction-description').value = t.description || '';
    document.getElementById('transaction-date').value = t.date || t.plannedDate || '';
    document.getElementById('transaction-income-status').value = t.incomeStatus || 'earned';
    this._toggleIncomeStatus(t.type);
    document.getElementById('modal-finance-title').textContent = 'Редагувати транзакцію';
    openModal('modal-finance');
  },

  save() {
    const id = document.getElementById('transaction-id').value;
    const type = document.getElementById('transaction-type').value;
    const amount = Number(document.getElementById('transaction-amount').value) || 0;
    const bank = document.getElementById('transaction-bank').value;
    const category = document.getElementById('transaction-category').value.trim();
    const description = document.getElementById('transaction-description').value.trim();
    const date = document.getElementById('transaction-date').value;
    const incomeStatus = type === 'income' ? document.getElementById('transaction-income-status').value : undefined;

    if (!amount) { showToast('Введіть суму', 'error'); return; }
    if (!bank) { showToast('Оберіть банк', 'error'); return; }

    const transactions = Storage.getTransactions();
    const raw = { type, amount, bank, category, description, date, status: 'done' };
    if (incomeStatus) raw.incomeStatus = incomeStatus;

    if (id) {
      const idx = transactions.findIndex(t => t.id === id);
      if (idx >= 0) {
        transactions[idx] = { ...transactions[idx], ...raw };
        showToast('Транзакцію оновлено');
      }
    } else {
      transactions.push({ id: Storage.generateId(), ...raw });
      showToast('Транзакцію додано');
    }

    Storage.saveTransactions(transactions);
    closeModal('modal-finance');
    this.render();
    Dashboard.render();
  },

  saveRates() {
    Storage.saveFinanceSettings({
      usdRate: document.getElementById('finance-usd-rate')?.value,
      eurRate: document.getElementById('finance-eur-rate')?.value,
    });
  },

  _toggleIncomeStatus(type) {
    const group = document.getElementById('income-status-group');
    if (group) group.style.display = type === 'income' ? '' : 'none';
  },

  convertAmount(amount, fromBank, toBank) {
    const fromCurrency = Calc.bankCurrency(fromBank);
    const toCurrency = Calc.bankCurrency(toBank);
    if (fromCurrency === toCurrency) return Number(amount) || 0;

    const source = Number(amount) || 0;
    const uah = source * Calc.rateForCurrency(fromCurrency);
    return uah / Calc.rateForCurrency(toCurrency);
  },

  saveConversion() {
    this.saveRates();
    const fromBank = document.getElementById('conversion-from').value;
    const toBank = document.getElementById('conversion-to').value;
    const amount = Number(document.getElementById('conversion-amount').value) || 0;

    if (!fromBank || !toBank) { showToast('Оберіть рахунки для конвертації', 'error'); return; }
    if (fromBank === toBank) { showToast('Оберіть різні рахунки', 'error'); return; }
    if (!amount) { showToast('Введіть суму конвертації', 'error'); return; }

    const targetAmount = this.convertAmount(amount, fromBank, toBank);
    const transactions = Storage.getTransactions();
    transactions.push({
      id: Storage.generateId(),
      type: 'transfer',
      bank: fromBank,
      toBank,
      amount,
      targetAmount,
      rate: Calc.rateForCurrency(Calc.bankCurrency(fromBank)) || Calc.rateForCurrency(Calc.bankCurrency(toBank)),
      category: 'Конвертація',
      description: `${Banks.label(fromBank)} → ${Banks.label(toBank)}`,
      date: Utils.today(),
      status: 'done',
    });

    Storage.saveTransactions(transactions);
    document.getElementById('conversion-amount').value = '';
    this.render();
    Dashboard.render();
    showToast('Конвертацію збережено');
  },

  delete(id) {
    showConfirm('Видалити транзакцію?', 'Транзакція буде видалена безповоротно.', () => {
      Storage.saveTransactions(Storage.getTransactions().filter(t => t.id !== id));
      this.render();
      Dashboard.render();
      showToast('Транзакцію видалено');
    });
  },
};

document.getElementById('btn-add-income').addEventListener('click', () => Finance.openCreate('income'));
document.getElementById('btn-add-expense').addEventListener('click', () => Finance.openCreate('expense'));
document.getElementById('btn-save-finance').addEventListener('click', () => Finance.save());
document.getElementById('btn-save-conversion')?.addEventListener('click', () => Finance.saveConversion());
document.getElementById('transaction-type').addEventListener('change', (e) => Finance._toggleIncomeStatus(e.target.value));
['finance-usd-rate', 'finance-eur-rate'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    Finance.saveRates();
    Finance.render();
    Dashboard.render();
  });
});
document.getElementById('finance-search').addEventListener('input', () => Finance.renderTable());
document.getElementById('finance-filter-type').addEventListener('change', () => Finance.renderTable());
