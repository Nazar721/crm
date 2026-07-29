/* =============================================
   projects.js — Проєкти (raw data only)
   ============================================= */

const Projects = {
  currentTab: 'active',
  _liveTimers: {},

  populateSpecialistSelect() {
    const devs = Storage.getSpecialists();
    const select = document.getElementById('project-specialist');
    select.innerHTML = '<option value="">— без фахівця —</option>' +
      devs.map(d => `<option value="${d.id}">${Utils.escHtml(d.name)} (${Utils.escHtml(d.specialization)})</option>`).join('');
  },

  populatePartnerSelect(selectedId = '') {
    Partners.populateSelect('project-partner', selectedId);
  },

  updateCalcPreview() {
    const budget = Number(document.getElementById('project-budget').value) || 0;
    const prepayment = Number(document.getElementById('project-prepayment').value) || 0;
    const paidToSpecialist = Number(document.getElementById('project-paid-specialist').value) || 0;
    const myPercent = Number(document.getElementById('project-my-percent').value) || 0;
    const profitTaken = Number(document.getElementById('project-profit-taken').value) || 0;
    const partnerCommission = Number(document.getElementById('project-partner-commission').value) || 0;

    const calc = Calc.project({ budget, prepayment, paidToSpecialist, myPercent, profitTaken, partnerCommission });
    document.getElementById('project-specialist-cost').value = calc.specialistCost || '';
    document.getElementById('project-remaining').value = Utils.formatMoney(calc.remainingPayment);
    document.getElementById('project-profit').value = Utils.formatMoney(calc.projectProfit);
    document.getElementById('project-profit-left').value = Utils.formatMoney(calc.profitLeft);
    document.getElementById('project-specialist-debt').value = Utils.formatMoney(calc.specialistDebt);
  },

  deadlineInfo(project) {
    // Не показувати дедлайн для проєктів в статусі "Очікування оплати"
    if (project.status === 'Очікування оплати') {
      return { text: '—', color: 'var(--text-secondary)' };
    }

    const deadlineDays = Number(project.deadlineDays) || 0;
    const startDate = Calc.projectStartDate(project);
    if (!deadlineDays || !startDate) {
      return { text: '—', color: 'var(--text-secondary)' };
    }

    const passedDays = Utils.daysBetween(startDate, Utils.today());
    const leftDays = deadlineDays - passedDays;
    if (leftDays === 0) {
      return { text: '0 дн.', color: 'var(--danger)' };
    }
    if (leftDays < 0) {
      return { text: `${Math.abs(leftDays)} дн. простр.`, color: 'var(--danger)' };
    }
    return { text: `${leftDays} дн.`, color: 'var(--accent-green)' };
  },

  openCreate() {
    document.getElementById('project-id').value = '';
    document.getElementById('project-from-completed').value = '';
    document.getElementById('modal-project-title').textContent = 'Новий проєкт';
    document.getElementById('project-name').value = '';
    document.getElementById('project-type').value = '';
    document.getElementById('project-status').value = 'Очікування оплати';
    document.getElementById('project-start-date').value = Utils.today();
    document.getElementById('project-deadline-days').value = '';
    document.getElementById('project-end-date').value = '';
    document.getElementById('project-client-name').value = '';
    document.getElementById('project-client-telegram').value = '';
    document.getElementById('project-client-source').value = 'Інше';
    document.getElementById('project-budget').value = '';
    document.getElementById('project-bank').value = '';
    document.getElementById('project-prepayment').value = '';
    document.getElementById('project-specialist-cost').value = '';
    document.getElementById('project-paid-specialist').value = '';
    document.getElementById('project-my-percent').value = '';
    document.getElementById('project-profit-taken').value = '';
    document.getElementById('project-profit-left').value = '';
    document.getElementById('project-partner-commission').value = '';
    document.getElementById('project-description').value = '';
    this.populateSpecialistSelect();
    this.populatePartnerSelect();
    document.getElementById('project-specialist').value = '';
    document.getElementById('project-partner').value = '';
    this.updateCalcPreview();
    openModal('modal-project');
  },

  openEdit(id, fromCompleted = false) {
    const list = fromCompleted ? Storage.getCompleted() : Storage.getProjects();
    const p = list.find(x => x.id === id);
    if (!p) return;

    const clients = Storage.getClients();
    const client = clients.find(c => c.id === p.clientId);

    document.getElementById('project-id').value = p.id;
    document.getElementById('project-from-completed').value = fromCompleted ? '1' : '';
    document.getElementById('modal-project-title').textContent = fromCompleted ? 'Перегляд проєкту' : 'Редагувати проєкт';
    document.getElementById('project-name').value = p.name;
    document.getElementById('project-type').value = p.type;
    document.getElementById('project-status').value = p.status;
    document.getElementById('project-start-date').value = Calc.projectStartDate(p);
    document.getElementById('project-deadline-days').value = p.deadlineDays || '';
    document.getElementById('project-end-date').value = p.endDate || '';
    document.getElementById('project-client-name').value = client ? client.name : p.clientName || '';
    document.getElementById('project-client-telegram').value = p.clientTelegram || client?.telegram || '';
    document.getElementById('project-client-source').value = p.clientSource || client?.source || 'Інше';
    document.getElementById('project-budget').value = p.budget || '';
    document.getElementById('project-bank').value = p.bank || '';
    document.getElementById('project-prepayment').value = p.prepayment || '';
    document.getElementById('project-specialist-cost').value = p.specialistCost || '';
    document.getElementById('project-paid-specialist').value = p.paidToSpecialist || '';
    document.getElementById('project-my-percent').value = p.myPercent ?? '';
    document.getElementById('project-profit-taken').value = p.profitTaken || '';
    document.getElementById('project-partner-commission').value = p.partnerCommission || '';
    document.getElementById('project-description').value = p.description || '';

    this.populateSpecialistSelect();
    this.populatePartnerSelect(p.partnerId || '');
    document.getElementById('project-specialist').value = p.developerId || '';
    document.getElementById('project-partner').value = p.partnerId || '';
    this.updateCalcPreview();
    openModal('modal-project');
  },

  buildRawFromForm() {
    const clientName = document.getElementById('project-client-name').value.trim();
    const client = Clients.findOrCreate(
      clientName,
      document.getElementById('project-client-telegram').value.trim(),
      document.getElementById('project-client-source').value
    );

    const budget = Number(document.getElementById('project-budget').value) || 0;
    const myPercent = Number(document.getElementById('project-my-percent').value) || 0;
    const calc = Calc.project({
      budget,
      myPercent,
      prepayment: Number(document.getElementById('project-prepayment').value) || 0,
      paidToSpecialist: Number(document.getElementById('project-paid-specialist').value) || 0,
    });

    return {
      name: document.getElementById('project-name').value.trim(),
      type: document.getElementById('project-type').value,
      status: document.getElementById('project-status').value,
      startDate: document.getElementById('project-start-date').value,
      deadlineDays: Number(document.getElementById('project-deadline-days').value) || 0,
      endDate: document.getElementById('project-end-date').value || '',
      clientId: client.id,
      clientName,
      clientTelegram: document.getElementById('project-client-telegram').value.trim(),
      clientSource: document.getElementById('project-client-source').value,
      budget,
      bank: document.getElementById('project-bank').value.trim(),
      prepayment: Number(document.getElementById('project-prepayment').value) || 0,
      specialistCost: calc.specialistCost,
      paidToSpecialist: Number(document.getElementById('project-paid-specialist').value) || 0,
      myPercent,
      profitTaken: Number(document.getElementById('project-profit-taken').value) || 0,
      developerId: document.getElementById('project-specialist').value,
      partnerId: document.getElementById('project-partner').value,
      partnerCommission: Number(document.getElementById('project-partner-commission').value) || 0,
      description: document.getElementById('project-description').value.trim(),
    };
  },

  transactionDate(raw, source) {
    const projectPaymentDate = Calc.projectPaymentDate(raw);
    if (source === 'project_prepayment') {
      return projectPaymentDate || Utils.today();
    }
    if (source === 'project_profit_taken') {
      return raw.endDate || raw.finishDate || projectPaymentDate || Utils.today();
    }
    return Utils.today();
  },

  save() {
    const id = document.getElementById('project-id').value;
    const fromCompleted = !!id && document.getElementById('project-from-completed').value === '1';
    const raw = this.buildRawFromForm();

    if (!raw.name) { showToast('Введіть назву проєкту', 'error'); return; }
    if (!raw.type) { showToast('Оберіть тип проєкту', 'error'); return; }
    if (!raw.startDate) { showToast('Вкажіть дату старту', 'error'); return; }
    if (!raw.clientName) { showToast('Введіть ім\'я клієнта', 'error'); return; }
const calc = Calc.project(raw);
      if (raw.profitTaken > calc.myIncome) { showToast('Забрана сума більша за ваш чистий дохід після комісії партнера', 'error'); return; }

    if (fromCompleted) {
      const completed = Storage.getCompleted();
      const idx = completed.findIndex(p => p.id === id);
      if (idx >= 0) {
        const prev = completed[idx];
        completed[idx] = { ...completed[idx], ...raw };
        Storage.saveCompleted(completed);
        showToast('Проєкт оновлено');

        const prevCalc = Calc.project(prev);
        const rawCalc = Calc.project(raw);
        const profitDelta = Number(raw.profitTaken) - Number(prev.profitTaken || 0);
        const prepayDelta = Number(rawCalc.receivedProfit) - Number(prevCalc.receivedProfit);
        const tx = Storage.getTransactions();

        if (profitDelta !== 0) {
          tx.push({
            id: Storage.generateId(),
            hidden: true,
            type: profitDelta > 0 ? 'income' : 'expense',
            amount: Math.abs(profitDelta),
            bank: raw.bank || prev.bank || '',
            category: 'Проєкт',
            description: `Забрав із проєкту: ${raw.name || prev.name || ''}`,
            date: Utils.today(),
            status: 'done',
            source: 'project_profit_taken',
            projectId: id,
          });
        }
        if (prepayDelta !== 0) {
          tx.push({
            id: Storage.generateId(),
            hidden: true,
            type: prepayDelta > 0 ? 'income' : 'expense',
            amount: Math.abs(prepayDelta),
            bank: raw.bank || prev.bank || '',
            category: 'Передоплата',
            description: `Передоплата від клієнта: ${raw.clientName || prev.clientName || ''}`,
            date: Utils.today(),
            status: 'done',
            source: 'project_prepayment',
            projectId: id,
          });
        }
        if (profitDelta !== 0 || prepayDelta !== 0) Storage.saveTransactions(tx);
      }
    } else if (id) {
      const active = Storage.getProjects();
      const idx = active.findIndex(p => p.id === id);
      if (idx >= 0) {
        const prev = active[idx];
        active[idx] = { ...active[idx], ...raw };
        Storage.saveProjects(active);
        showToast('Проєкт оновлено');

        const prevCalc = Calc.project(prev);
        const rawCalc = Calc.project(raw);
        const profitDelta = Number(raw.profitTaken) - Number(prev.profitTaken || 0);
        const prepayDelta = Number(rawCalc.receivedProfit) - Number(prevCalc.receivedProfit);
        const tx = Storage.getTransactions();

        if (profitDelta !== 0) {
          tx.push({
            id: Storage.generateId(),
            hidden: true,
            type: profitDelta > 0 ? 'income' : 'expense',
            amount: Math.abs(profitDelta),
            bank: raw.bank || prev.bank || '',
            category: 'Проєкт',
            description: `Забрав із проєкту: ${raw.name || prev.name || ''}`,
            date: Utils.today(),
            status: 'done',
            source: 'project_profit_taken',
            projectId: id,
          });
        }
        if (prepayDelta !== 0) {
          tx.push({
            id: Storage.generateId(),
            hidden: true,
            type: prepayDelta > 0 ? 'income' : 'expense',
            amount: Math.abs(prepayDelta),
            bank: raw.bank || prev.bank || '',
            category: 'Передоплата',
            description: `Передоплата від клієнта: ${raw.clientName || prev.clientName || ''}`,
            date: Utils.today(),
            status: 'done',
            source: 'project_prepayment',
            projectId: id,
          });
        }
        if (profitDelta !== 0 || prepayDelta !== 0) Storage.saveTransactions(tx);
      }
    } else {
      const active = Storage.getProjects();
      const projectId = Storage.generateId();
      active.push({ id: projectId, createdAt: new Date().toISOString(), ...raw });
      Storage.saveProjects(active);

      const rawCalc = Calc.project(raw);
      const tx = Storage.getTransactions();
      if (rawCalc.receivedProfit > 0) {
        tx.push({
          id: Storage.generateId(),
          hidden: true,
          type: 'income',
          amount: rawCalc.receivedProfit,
          bank: raw.bank || '',
          category: 'Передоплата',
          description: `Передоплата від клієнта: ${raw.clientName}`,
          date: this.transactionDate(raw, 'project_prepayment'),
          status: 'done',
          source: 'project_prepayment',
          projectId,
        });
      }
      if (raw.profitTaken > 0) {
        tx.push({
          id: Storage.generateId(),
          hidden: true,
          type: 'income',
          amount: raw.profitTaken,
          bank: raw.bank || '',
          category: 'Проєкт',
          description: `Забрав із проєкту: ${raw.name}`,
          date: this.transactionDate(raw, 'project_profit_taken'),
          status: 'done',
          source: 'project_profit_taken',
          projectId,
        });
      }
      if (rawCalc.receivedProfit > 0 || raw.profitTaken > 0) Storage.saveTransactions(tx);
      showToast('Проєкт створено');
    }

    closeModal('modal-project');
    refreshAll();
  },

  complete(id) {
    showConfirm('Завершити проєкт?', 'Проєкт буде перенесено до завершених. Оновляться клієнти, фахівці, партнери та dashboard.', () => {
      const active = Storage.getProjects();
      const idx = active.findIndex(p => p.id === id);
      if (idx < 0) return;

      const p = active[idx];
      const finishDate = p.endDate || Utils.today();
      const startDate = Calc.projectStartDate(p);
      const days = Utils.daysBetween(startDate, finishDate);

      const completed = Storage.getCompleted();
      completed.push({
        ...p,
        endDate: finishDate,
        finishDate,
        days,
        completedAt: Date.now(),
      });
      Storage.saveCompleted(completed);

      active.splice(idx, 1);
      Storage.saveProjects(active);

      refreshAll();
      showToast('Проєкт завершено!', 'success');
    });
  },

  deleteActive(id) {
    showConfirm('Видалити проєкт?', 'Проєкт буде видалений безповоротно.', () => {
      Storage.saveProjects(Storage.getProjects().filter(p => p.id !== id));
      refreshAll();
      showToast('Проєкт видалено');
    });
  },

  deleteCompleted(id) {
    showConfirm('Видалити завершений проєкт?', 'Проєкт буде видалений безповоротно.', () => {
      Storage.saveCompleted(Storage.getCompleted().filter(p => p.id !== id));
      refreshAll();
      showToast('Проєкт видалено');
    });
  },

  renderAll() {
    this.renderActive();
    this.renderCompleted();
    document.getElementById('tab-count-active').textContent = Storage.getProjects().length;
    document.getElementById('tab-count-completed').textContent = Storage.getCompleted().length;
  },

  getFilters() {
    return {
      search: document.getElementById('projects-search').value.toLowerCase(),
      type: document.getElementById('projects-filter-type').value,
    };
  },

  filterProjects(list) {
    const { search, type } = this.getFilters();
    const clients = Storage.getClients();
    return list.filter(p => {
      const client = clients.find(c => c.id === p.clientId);
      const clientName = client ? client.name : p.clientName || '';
      const matchSearch = p.name.toLowerCase().includes(search) || clientName.toLowerCase().includes(search);
      const matchType = !type || p.type === type;
      return matchSearch && matchType;
    });
  },

  renderActive() {
    const tbody = document.getElementById('tbody-active-projects');
    const filtered = this.filterProjects(Storage.getProjects());
    const clients = Storage.getClients();
    const specialists = Storage.getSpecialists();
    const typeOrder = { IT: 1, Video: 2, Design: 3 };
    filtered.sort((a, b) => (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99));

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="16"><div class="empty-state"><span>Немає активних проєктів</span><small>Натисніть «Новий проєкт», щоб додати</small></div></td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((p, i) => {
      const client = clients.find(c => c.id === p.clientId);
      const clientName = client ? client.name : p.clientName || '—';
      const specialist = specialists.find(s => s.id === p.developerId);
      const specialistName = specialist ? specialist.name : '—';
      const calc = Calc.project(p);
      const deadline = this.deadlineInfo(p);
      return `
        <tr class="anim-row" style="animation-delay:${i * 30}ms">
          <td><strong>${Utils.escHtml(p.name)}</strong></td>
          <td>${typeBadge(p.type)}</td>
          <td>${Utils.escHtml(clientName)}</td>
          <td>${Utils.formatDate(Calc.projectStartDate(p))}</td>
          <td style="color:${deadline.color}">${Utils.escHtml(deadline.text)}</td>
          <td>${Utils.formatMoney(calc.budget)}</td>
          <td>${p.bank ? bankBadge(p.bank) : '<span style="color:var(--text-secondary)">—</span>'}</td>
          <td style="color:var(--accent-orange)">${Utils.formatMoney(calc.clientDebt)}</td>
          <td>${Utils.escHtml(specialistName)}</td>
          <td style="color:var(--accent-orange)">${Utils.formatMoney(calc.specialistDebt)}</td>
          <td style="color:var(--accent-green)">${Utils.formatMoney(calc.projectProfit)}</td>
          <td style="color:var(--accent-orange)">${Utils.formatMoney(calc.partnerCommission)}</td>
          <td style="color:var(--accent-blue)">${Utils.formatMoney(calc.profitTaken)}</td>
          <td style="color:var(--accent-orange)">${Utils.formatMoney(calc.profitLeft)}</td>
          <td>${statusBadge(p.status)}</td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon btn-icon--green" title="Завершити" onclick="Projects.complete('${p.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <button class="btn-icon" title="Редагувати" onclick="Projects.openEdit('${p.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button class="btn-icon btn-icon--danger" title="Видалити" onclick="Projects.deleteActive('${p.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  renderCompleted() {
    const tbody = document.getElementById('tbody-completed-projects');
    let filtered = this.filterProjects(Storage.getCompleted());
    filtered.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    const clients = Storage.getClients();
    const specialists = Storage.getSpecialists();

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="10"><div class="empty-state"><span>Немає завершених проєктів</span></div></td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((p, i) => {
      const client = clients.find(c => c.id === p.clientId);
      const clientName = client ? client.name : p.clientName || '—';
      const clientTelegram = p.clientTelegram || client?.telegram || '';
      const specialist = specialists.find(s => s.id === p.developerId);
      const specialistName = specialist ? specialist.name : '—';
      const calc = Calc.project(p);
      return `
        <tr class="anim-row" style="animation-delay:${i * 30}ms">
          <td><strong>${Utils.escHtml(p.name)}</strong></td>
          <td>${typeBadge(p.type)}</td>
          <td>
            <div>${Utils.escHtml(clientName)}</div>
            ${clientTelegram ? `<div style="margin-top:2px;color:var(--text-secondary);font-size:0.85em">${Utils.escHtml(clientTelegram)}</div>` : ''}
          </td>
          <td>${Utils.formatDate(Calc.projectStartDate(p))}</td>
          <td>${Utils.formatDate(Calc.projectEndDate(p))}</td>
          <td>${p.days ?? '—'} дн.</td>
          <td>${Utils.formatMoney(calc.budget)}</td>
          <td>${Utils.formatMoney(calc.partnerCommission)}</td>
          <td>
            <div>${Utils.escHtml(specialistName)}</div>
            <div style="margin-top:2px;color:var(--text-secondary)">${Utils.formatMoney(calc.specialistCost)}</div>
          </td>
          <td style="color:var(--accent-green)">${Utils.formatMoney(calc.myIncome)}</td>
          <td>
            <div class="actions-cell">
              <button class="btn-icon" title="Редагувати" onclick="Projects.openEdit('${p.id}', true)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button class="btn-icon btn-icon--danger" title="Видалити" onclick="Projects.deleteCompleted('${p.id}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2"/><path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },
};

['project-budget', 'project-prepayment', 'project-paid-specialist', 'project-my-percent', 'project-profit-taken', 'project-partner-commission'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => Projects.updateCalcPreview());
});

document.getElementById('btn-add-project').addEventListener('click', () => Projects.openCreate());
document.getElementById('btn-save-project').addEventListener('click', () => Projects.save());
document.getElementById('projects-search').addEventListener('input', () => Projects.renderAll());
document.getElementById('projects-filter-type').addEventListener('change', () => Projects.renderAll());

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// Live-sync: when editing an existing project, apply prepayment/profitTaken deltas immediately
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function syncLive(field) {
  const id = document.getElementById('project-id').value;
  if (!id) return; // only sync for existing projects
  const fromCompleted = document.getElementById('project-from-completed').value === '1';
  const list = fromCompleted ? Storage.getCompleted() : Storage.getProjects();
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return;

  const prev = list[idx];
  const raw = Projects.buildRawFromForm();
  const prevCalc = Calc.project(prev);
  const rawCalc = Calc.project(raw);

  const profitDelta = Number(raw.profitTaken) - Number(prev.profitTaken || 0);
  const prepayDelta = Number(rawCalc.receivedProfit) - Number(prevCalc.receivedProfit);

  // update project values in-place so UI reflects immediately
  list[idx] = { ...prev, ...raw };
  if (fromCompleted) Storage.saveCompleted(list); else Storage.saveProjects(list);

  if (profitDelta !== 0 || prepayDelta !== 0) {
    const tx = Storage.getTransactions();

    if (profitDelta !== 0) {
      tx.push({
        id: Storage.generateId(),
        hidden: true,
        type: profitDelta > 0 ? 'income' : 'expense',
        amount: Math.abs(profitDelta),
        bank: raw.bank || prev.bank || '',
        category: 'Проєкт',
        description: `Забрав із проєкту: ${raw.name || prev.name || ''}`,
        date: Projects.transactionDate(raw, 'project_profit_taken'),
        status: 'done',
        source: 'project_profit_taken',
        projectId: id,
      });
    }
    if (prepayDelta !== 0) {
      tx.push({
        id: Storage.generateId(),
        hidden: true,
        type: prepayDelta > 0 ? 'income' : 'expense',
        amount: Math.abs(prepayDelta),
        bank: raw.bank || prev.bank || '',
        category: 'Передоплата',
        description: `Передоплата від клієнта: ${raw.clientName || prev.clientName || ''}`,
        date: Projects.transactionDate(raw, 'project_prepayment'),
        status: 'done',
        source: 'project_prepayment',
        projectId: id,
      });
    }

    Storage.saveTransactions(tx);
  }

  refreshAll();
}

document.getElementById('project-prepayment')?.addEventListener('input', debounce(() => syncLive('prepayment'), 500));
document.getElementById('project-profit-taken')?.addEventListener('input', debounce(() => syncLive('profitTaken'), 500));
