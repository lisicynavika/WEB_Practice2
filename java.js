'use strict';

/* Рабочий ритм. Два независимых API, без ключей и без подставных данных.
   isDayOff: 0 — рабочий, 1 — выходной, 2 — сокращённый (pre=1).
   CBR-XML-Daily: курс за одну единицу = Value / Nominal. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORE = 'work-rhythm-v1';
const money = number => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(number);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateObject = value => new Date(`${value}T12:00:00`);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(dateObject(value)) && localDate(dateObject(value)) === value;
const formatDate = value => dateObject(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let noticeTimer;
function notify(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
const defaults = () => ({ projects: [], tasks: [], collapsed: {}, theme: null, timer: { startedAt: null, segments: [] }, sessions: [] });
let storageWarning = false;
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw || typeof raw !== 'object') return defaults();
    const state = defaults();
    const validItem = item => item && typeof item.id === 'string' && /^[\w-]+$/.test(item.id) && typeof item.name === 'string' && item.name.trim().length > 0;
    if (Array.isArray(raw.projects)) state.projects = raw.projects.filter(item => validItem(item) && Number.isFinite(item.amount) && item.amount >= 0 && item.amount <= 1e12 && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100 && (!item.deadline || validDate(item.deadline))).map(item => ({ ...item, client: typeof item.client === 'string' ? item.client : '', paid: Boolean(item.paid && validDate(item.paidDate)), paidDate: validDate(item.paidDate) ? item.paidDate : '' }));
    if (Array.isArray(raw.tasks)) state.tasks = raw.tasks.filter(item => validItem(item) && (!item.deadline || validDate(item.deadline))).map(item => ({ ...item, done: Boolean(item.done) }));
    if (raw.collapsed && typeof raw.collapsed === 'object') state.collapsed = raw.collapsed;
    if (['light', 'dark'].includes(raw.theme)) state.theme = raw.theme;
    const validSegment = segment => segment && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start <= segment.end && segment.start > 0;
    if (Array.isArray(raw.sessions)) state.sessions = raw.sessions.filter(validSegment);
    if (raw.timer && typeof raw.timer === 'object') {
      state.timer.segments = Array.isArray(raw.timer.segments) ? raw.timer.segments.filter(validSegment) : [];
      state.timer.startedAt = Number.isFinite(raw.timer.startedAt) && raw.timer.startedAt > 0 ? raw.timer.startedAt : null;
    }
    return state;
  } catch {
    storageWarning = true;
    return defaults();
  }
}
const state = loadState();
function saveState() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch { notify('Браузер не разрешил сохранение. Данные останутся только до закрытия страницы.'); }
}
function applyTheme() {
  const theme = state.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  $('#theme').textContent = theme === 'dark' ? '☀' : '◐';
  $('#theme').setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
}
$('#theme').addEventListener('click', () => {
  state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); saveState();
});
applyTheme();
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
systemTheme.addEventListener?.('change', () => { if (!state.theme) applyTheme(); });

$$('.collapse').forEach(button => {
  const widget = button.closest('[data-widget]');
  const key = widget.dataset.widget;
  function apply() {
    const collapsed = Boolean(state.collapsed[key]);
    $('.widget-body', widget).hidden = collapsed;
    button.textContent = collapsed ? '+' : '−';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Развернуть' : 'Свернуть'} виджет «${$('h2', widget).textContent.trim()}»`);
  }
  apply();
  button.addEventListener('click', () => { state.collapsed[key] = !state.collapsed[key]; apply(); saveState(); });
});

function emptyState(symbol, title, text, type) {
  return `<div class="empty"><span class="empty-symbol" aria-hidden="true">${symbol}</span><strong>${title}</strong><p>${text}</p>${type ? `<button class="text-button" data-new="${type}" type="button">＋ Добавить ${type === 'task' ? 'задачу' : 'проект'}</button>` : ''}</div>`;
}
function deadlineText(value, completed) {
  if (!value) return '<span class="deadline">Без дедлайна</span>';
  const today = localDate();
  const late = !completed && value < today;
  const near = !completed && value === today;
  return `<span class="deadline ${late ? 'late' : near ? 'near' : ''}">${late ? 'Просрочено · ' : near ? 'Сегодня · ' : ''}${formatDate(value)}</span>`;
}
const itemSort = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');
function renderProjects() {
  $('#project-count').textContent = state.projects.length;
  const projects = [...state.projects].sort((a,b) => Number(a.progress === 100) - Number(b.progress === 100) || itemSort(a,b));
  $('#project-list').innerHTML = projects.length ? projects.map(project => `
    <article class="project" data-id="${project.id}">
      <div class="project-top"><div><div class="project-name">${escapeHTML(project.name)}</div>${project.client ? `<div class="project-client">${escapeHTML(project.client)}</div>` : ''}</div><div class="row-actions"><button class="row-button" data-edit="project" aria-label="Редактировать проект ${escapeHTML(project.name)}" title="Редактировать" type="button">✎</button><button class="row-button danger" data-delete="project" aria-label="Удалить проект ${escapeHTML(project.name)}" title="Удалить" type="button">×</button></div></div>
      <div class="project-meta"><span class="money">${money(project.amount)}</span><span class="chip ${project.paid ? 'paid' : ''}">${project.paid ? 'Оплачен' : 'Не оплачен'}</span>${deadlineText(project.deadline, project.progress === 100)}</div>
      <div class="progress-wrap"><input type="range" min="0" max="100" step="1" value="${project.progress}" style="--p:${project.progress}%" aria-label="Прогресс проекта ${escapeHTML(project.name)}"><output>${project.progress}%</output></div>
    </article>`).join('') : emptyState('↗', 'Здесь начинаются большие дела', 'Добавь первый проект: стоимость, дедлайн и прогресс будут под рукой.', 'project');
}
let taskFilter = 'all';
function renderTasks() {
  const tasks = state.tasks.filter(task => taskFilter === 'all' || (taskFilter === 'done' ? task.done : !task.done)).sort((a,b) => Number(a.done) - Number(b.done) || itemSort(a,b));
  $('#task-list').innerHTML = tasks.length ? tasks.map(task => `<div class="task ${task.done ? 'done' : ''}" data-id="${task.id}"><input id="task-${task.id}" type="checkbox" ${task.done ? 'checked' : ''} aria-label="${escapeHTML(task.name)}"><div class="task-content"><label for="task-${task.id}">${escapeHTML(task.name)}</label>${deadlineText(task.deadline, task.done)}</div><div class="row-actions"><button class="row-button" data-edit="task" aria-label="Редактировать задачу ${escapeHTML(task.name)}" type="button" title="Редактировать">✎</button><button class="row-button danger" data-delete="task" aria-label="Удалить задачу ${escapeHTML(task.name)}" type="button" title="Удалить">×</button></div></div>`).join('') : emptyState('☑', taskFilter === 'all' ? 'Освободи голову' : 'Здесь пока пусто', taskFilter === 'all' ? 'Запиши задачи и дедлайны. Двигайся к результату маленькими шагами.' : 'В этой категории ещё нет задач.', taskFilter === 'all' ? 'task' : null);
  $$('[data-filter]').forEach(button => { button.classList.toggle('selected', button.dataset.filter === taskFilter); button.setAttribute('aria-pressed', String(button.dataset.filter === taskFilter)); });
}
function renderStats() {
  const currentMonth = localDate().slice(0,7);
  $('#stat-projects').textContent = state.projects.filter(project => project.progress < 100).length;
  $('#stat-tasks').textContent = state.tasks.filter(task => !task.done).length;
  $('#stat-income').textContent = money(state.projects.filter(project => project.paid && project.paidDate.startsWith(currentMonth)).reduce((sum, project) => sum + project.amount, 0));
  $('#stat-income-month').textContent = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}
function incomeMonths() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = localDate(date).slice(0,7);
    return { date, amount: state.projects.filter(project => project.paid && project.paidDate.startsWith(key)).reduce((sum, project) => sum + project.amount, 0) };
  });
}
function renderIncome() {
  const months = incomeMonths();
  const maximum = Math.max(1, ...months.map(month => month.amount));
  $('#income-total').textContent = money(months.reduce((sum, month) => sum + month.amount,0));
  const compact = value => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  $('#income-chart').innerHTML = months.map(month => `<div class="chart-col" title="${month.date.toLocaleDateString('ru-RU', { month:'long',year:'numeric' })}: ${money(month.amount)}"><span class="chart-value">${compact(month.amount)}</span><div class="chart-bar" style="height:${month.amount / maximum * 105}px"></div><span class="chart-month">${month.date.toLocaleDateString('ru-RU', { month:'short' })}</span></div>`).join('');
  $('#income-chart').setAttribute('aria-label', months.map(month => `${month.date.toLocaleDateString('ru-RU', {month:'long',year:'numeric'})}: ${money(month.amount)}`).join('; '));
}
function renderLocal() { renderProjects(); renderTasks(); renderStats(); renderIncome(); redrawCalendar(); }

let editorType = 'project';
let editorId = null;
function openEditor(type, id = null) {
  editorType = type; editorId = id;
  const item = (type === 'project' ? state.projects : state.tasks).find(entry => entry.id === id) || {};
  $('#editor-title').textContent = `${id ? 'Редактировать' : 'Новый' + (type === 'task' ? 'ая' : '')} ${type === 'project' ? 'проект' : 'задачу'}`;
  if (type === 'task' && !id) $('#editor-title').textContent = 'Новая задача';
  const nameField = `<label class="field">${type === 'project' ? 'Название проекта' : 'Что нужно сделать'} *<input name="name" required maxlength="120" value="${escapeHTML(item.name || '')}" placeholder="${type === 'project' ? 'Например, айдентика кофейни' : 'Например, отправить макеты'}"></label>`;
  $('#editor-fields').innerHTML = type === 'project' ? `${nameField}
    <label class="field">Клиент<input name="client" maxlength="100" value="${escapeHTML(item.client || '')}" placeholder="Имя или компания"></label>
    <div class="field-row"><label class="field">Стоимость, ₽ *<input name="amount" type="number" min="0" max="1000000000000" step="0.01" required value="${item.amount ?? ''}" placeholder="0"></label><label class="field">Дедлайн<input name="deadline" type="date" min="2000-01-01" max="2100-12-31" value="${item.deadline || ''}"></label></div>
    <label class="field">Прогресс, %<input name="progress" type="number" min="0" max="100" step="1" required value="${item.progress ?? 0}"></label>
    <label class="check-field"><input name="paid" type="checkbox" ${item.paid ? 'checked' : ''}> Проект оплачен полностью</label>
    <label class="field" id="paid-date-field" ${item.paid ? '' : 'hidden'}>Дата оплаты *<input name="paidDate" type="date" min="2000-01-01" max="${localDate()}" value="${item.paidDate || localDate()}" ${item.paid ? 'required' : ''}></label>` : `${nameField}<label class="field">Дедлайн<input name="deadline" type="date" min="2000-01-01" max="2100-12-31" value="${item.deadline || ''}"></label><label class="check-field"><input name="done" type="checkbox" ${item.done ? 'checked' : ''}> Уже выполнено</label>`;
  const paid = $('[name=paid]');
  if (paid) paid.addEventListener('change', () => { $('#paid-date-field').hidden = !paid.checked; $('[name=paidDate]').required = paid.checked; });
  $('#editor').showModal();
}
$('#editor-close').addEventListener('click', () => $('#editor').close());
$('#editor-cancel').addEventListener('click', () => $('#editor').close());
$('#editor-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  if (!name) { $('[name=name]',form).setCustomValidity('Введи название, а не пробелы.'); $('[name=name]',form).reportValidity(); return; }
  const deadline = String(data.get('deadline') || '');
  if (deadline && !validDate(deadline)) return notify('Проверь дату дедлайна.');
  const list = editorType === 'project' ? state.projects : state.tasks;
  const id = editorId || uid();
  let item = { id, name, deadline };
  if (editorType === 'project') {
    const amount = Number(data.get('amount'));
    const progress = Number(data.get('progress'));
    const paid = data.get('paid') === 'on';
    const paidDate = paid ? String(data.get('paidDate') || '') : '';
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12 || !Number.isInteger(progress) || progress < 0 || progress > 100) return notify('Проверь стоимость и прогресс проекта.');
    if (paid && (!validDate(paidDate) || paidDate > localDate())) return notify('Укажи дату полученной оплаты, не позже сегодняшней.');
    item = { ...item, client: String(data.get('client') || '').trim(), amount, progress, paid, paidDate };
  } else item.done = data.get('done') === 'on';
  const index = list.findIndex(entry => entry.id === id);
  if (index >= 0) list[index] = item; else list.push(item);
  saveState(); renderLocal(); $('#editor').close(); notify('Сохранено');
});
$('#editor-form').addEventListener('input', event => { if (event.target.name === 'name') event.target.setCustomValidity(''); });
document.addEventListener('click', event => {
  const add = event.target.closest('[data-new]');
  if (add) return openEditor(add.dataset.new);
  const edit = event.target.closest('[data-edit]');
  if (edit) return openEditor(edit.dataset.edit, edit.closest('[data-id]').dataset.id);
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const type = remove.dataset.delete;
    const list = type === 'project' ? state.projects : state.tasks;
    const id = remove.closest('[data-id]').dataset.id;
    const item = list.find(entry => entry.id === id);
    if (item && confirm(`Удалить ${type === 'project' ? 'проект' : 'задачу'} «${item.name}»?`)) {
      list.splice(list.indexOf(item),1); saveState(); renderLocal(); notify('Удалено');
    }
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) { taskFilter = filter.dataset.filter; renderTasks(); }
  if (event.target.closest('[data-retry=calendar]')) loadCalendar(true);
  if (event.target.closest('[data-retry=current]')) loadCurrentDays(true);
  if (event.target.closest('[data-retry=rates]')) loadRates();
  const day = event.target.closest('[data-date]');
  if (day) {
    const names = deadlinesFor(day.dataset.date);
    if (names.length) notify(`${formatDate(day.dataset.date)}: ${names.join('; ')}`);
  }
});
$('#project-list').addEventListener('input', event => {
  if (event.target.type !== 'range') return;
  event.target.style.setProperty('--p', `${event.target.value}%`);
  event.target.nextElementSibling.textContent = `${event.target.value}%`;
});
$('#project-list').addEventListener('change', event => {
  if (event.target.type !== 'range') return;
  const project = state.projects.find(item => item.id === event.target.closest('[data-id]').dataset.id);
  if (!project) return;
  project.progress = Number(event.target.value); saveState(); renderLocal();
});
$('#task-list').addEventListener('change', event => {
  if (event.target.type !== 'checkbox') return;
  const task = state.tasks.find(item => item.id === event.target.closest('[data-id]').dataset.id);
  if (!task) return;
  task.done = event.target.checked; saveState(); renderLocal();
});

// Сетевые запросы: простой GET без нестандартных заголовков и preflight.
async function getRemote(url, type = 'text') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials:'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return type === 'json' ? await response.json() : await response.text();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервис не ответил за 15 секунд.');
    if (error instanceof TypeError) throw new Error('Нет доступа к сервису. Проверь интернет и повтори запрос.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function loading(message) { return `<div class="network-state"><span class="spinner" aria-hidden="true"></span><span>${message}</span></div>`; }
function networkError(error, type) {
  return `<div class="network-state"><span class="empty-symbol" aria-hidden="true">↻</span><strong>Не удалось загрузить данные</strong><p>${escapeHTML(error.message)} Остальная панель продолжает работать.</p><button class="secondary" data-retry="${type}" type="button">Повторить</button></div>`;
}
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const monthKey = date => localDate(date).slice(0,7);
const monthCache = new Map();
const monthPending = new Map();
let calendarVersion = 0;
let calendarHasData = false;
async function getMonth(date, force = false) {
  const key = monthKey(date);
  if (monthPending.has(key)) return monthPending.get(key);
  if (!force && monthCache.has(key)) return monthCache.get(key);
  const promise = (async () => {
    const url = `https://isdayoff.ru/api/getdata?year=${date.getFullYear()}&month=${date.getMonth()+1}&cc=ru&pre=1`;
    const text = (await getRemote(url)).trim();
    const length = new Date(date.getFullYear(), date.getMonth()+1,0).getDate();
    if (text.length !== length || !/^[012]+$/.test(text)) throw new Error('Сервис вернул некорректный календарь или ещё не опубликовал этот месяц.');
    monthCache.set(key,text);
    return text;
  })();
  monthPending.set(key,promise);
  try { return await promise; } finally { monthPending.delete(key); }
}
function renderCurrentDays(codes) {
  const remaining = [...codes].slice(new Date().getDate()-1).filter(code => code !== '1').length;
  $('#stat-days').textContent = remaining;
  $('#stat-days-note').textContent = 'до конца месяца · включая сегодня';
}
async function loadCurrentDays(force = false) {
  $('#stat-days').textContent = '…';
  $('#stat-days-note').textContent = 'загружаем календарь…';
  try { renderCurrentDays(await getMonth(new Date(), force)); }
  catch { $('#stat-days').textContent = '—'; $('#stat-days-note').innerHTML = '<button class="stat-retry" data-retry="current" type="button">Нет данных · повторить ↻</button>'; }
}
function deadlinesFor(date) {
  return [...state.projects.filter(item => item.progress < 100 && item.deadline === date).map(item => item.name), ...state.tasks.filter(item => !item.done && item.deadline === date).map(item => item.name)];
}
function redrawCalendar() {
  if (!calendarHasData) return;
  const codes = monthCache.get(monthKey(calendarMonth));
  if (codes) renderCalendar(codes);
}
function renderCalendar(codes) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const first = (new Date(year,month,1).getDay()+6)%7;
  const days = [...codes].map((code,index) => {
    const date = `${year}-${String(month+1).padStart(2,'0')}-${String(index+1).padStart(2,'0')}`;
    const names = deadlinesFor(date);
    const description = `${formatDate(date)} — ${code === '1' ? 'выходной' : code === '2' ? 'сокращённый рабочий день' : 'рабочий день'}${names.length ? '. Дедлайны: '+names.join('; ') : ''}`;
    return `<button type="button" class="day ${code === '1' ? 'off' : code === '2' ? 'short' : ''} ${date === localDate() ? 'today' : ''} ${names.length ? 'has-deadline' : ''}" data-date="${date}" title="${escapeHTML(description)}" aria-label="${escapeHTML(description)}" ${date === localDate() ? 'aria-current="date"' : ''}>${index+1}</button>`;
  }).join('');
  const work = [...codes].filter(code => code !== '1').length;
  $('#calendar-data').innerHTML = `<div class="weekdays" aria-hidden="true">${['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-days">${'<span></span>'.repeat(first)}${days}</div><div class="calendar-legend"><span><i></i> Рабочий</span><span><i class="off-key"></i> Выходной</span><span><i class="short-key"></i> Сокращённый</span></div><div class="calendar-summary"><span><b>${work}</b> рабочих</span><span><b>${codes.length-work}</b> выходных</span><button class="text-button" id="month-today" type="button">К текущему</button></div>`;
  $('#month-today').addEventListener('click', () => { calendarMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1); loadCalendar(); });
}
async function loadCalendar(force = false) {
  const version = ++calendarVersion;
  const date = new Date(calendarMonth);
  calendarHasData = false;
  $('#calendar-month').textContent = date.toLocaleDateString('ru-RU', {month:'long',year:'numeric'});
  $('#calendar-data').innerHTML = loading('Загружаем рабочие и выходные дни…');
  try {
    const codes = await getMonth(date,force);
    if (version !== calendarVersion) return;
    calendarHasData = true; renderCalendar(codes);
    if (monthKey(date) === monthKey(new Date())) renderCurrentDays(codes);
  } catch (error) { if (version === calendarVersion) $('#calendar-data').innerHTML = networkError(error,'calendar'); }
}
for (const [selector,delta] of [['#month-prev',-1],['#month-next',1]]) $(selector).addEventListener('click', () => {
  const next = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+delta,1);
  if (next.getFullYear() < 2000 || next.getFullYear() > 2100) return;
  calendarMonth = next; loadCalendar();
});

let rates = null;
let ratesLoading = false;
let converterAmount = '';
let converterCurrency = 'USD';
function validateRates(data) {
  if (!data || !data.Valute || !Number.isFinite(Date.parse(data.Date))) throw new Error('Сервис вернул некорректную дату курса.');
  for (const key of ['USD','EUR','CNY']) {
    const rate = data.Valute[key];
    if (!rate || !Number.isFinite(rate.Value) || rate.Value <= 0 || !Number.isFinite(rate.Nominal) || rate.Nominal <= 0 || !Number.isFinite(rate.Previous)) throw new Error('Сервис вернул некорректные курсы валют.');
  }
  return data;
}
function renderRates() {
  const rows = ['USD','EUR','CNY'].map((code,index) => {
    const rate = rates.Valute[code];
    const perUnit = rate.Value / rate.Nominal;
    const delta = (rate.Value-rate.Previous) / rate.Nominal;
    const difference = `${delta > 0 ? '+' : ''}${delta.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})}`;
    return `<div class="rate-row"><div class="rate-label"><span class="currency-icon" aria-hidden="true">${['$','€','¥'][index]}</span><div><b>${code}</b><small>${escapeHTML(rate.Name)}</small></div></div><div class="rate-number">${perUnit.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})} ₽<small class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${difference} ₽ к предыдущему курсу</small></div></div>`;
  }).join('');
  const date = new Date(rates.Date);
  const outdated = Date.now()-date.getTime() > 4*86400000;
  $('#rates-data').innerHTML = `${rows}<p class="rate-date">За 1 единицу · курс на ${date.toLocaleDateString('ru-RU')}${outdated ? ' · данные сервиса давно не обновлялись' : ''}</p><div class="converter"><div class="converter-title">Стоимость заказа в рублях</div><div class="converter-fields"><input id="convert-amount" type="number" min="0" max="1000000000000" step="any" placeholder="Сумма заказа" aria-label="Сумма заказа в валюте" value="${escapeHTML(converterAmount)}"><select id="convert-currency" aria-label="Валюта заказа">${Object.entries(rates.Valute).filter(([code,rate]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(rate.Value) && rate.Value > 0 && Number.isFinite(rate.Nominal) && rate.Nominal > 0).map(([code])=>`<option value="${code}" ${code===converterCurrency?'selected':''}>${code}</option>`).join('')}</select></div><div class="converter-result"><span>Получится</span><output id="convert-result">— ₽</output></div></div>`;
  $('#convert-amount').addEventListener('input', updateConverter);
  $('#convert-currency').addEventListener('change', updateConverter);
  updateConverter();
}
function updateConverter() {
  const input = $('#convert-amount');
  if (!input || !rates) return;
  converterAmount = input.value;
  converterCurrency = $('#convert-currency').value;
  const amount = Number(converterAmount);
  const rate = rates.Valute[converterCurrency];
  $('#convert-result').textContent = !converterAmount || !input.validity.valid || !Number.isFinite(amount) || amount < 0 || !rate ? '— ₽' : money(amount * rate.Value / rate.Nominal);
}
async function loadRates() {
  if (ratesLoading) return;
  ratesLoading = true;
  $('#rates-refresh').disabled = true;
  $('#rates-data').innerHTML = loading('Получаем курсы валют…');
  try { rates = validateRates(await getRemote('https://www.cbr-xml-daily.ru/daily_json.js','json')); renderRates(); }
  catch (error) { rates = null; $('#rates-data').innerHTML = networkError(error,'rates'); }
  finally { ratesLoading = false; $('#rates-refresh').disabled = false; }
}
$('#rates-refresh').addEventListener('click',loadRates);

// Секундомер хранит реальные интервалы. Сессии корректно делятся по полуночи.
function timerSegments(now = Date.now()) {
  return [...state.timer.segments, ...(state.timer.startedAt ? [{start:state.timer.startedAt,end:now}] : [])];
}
function segmentDuration(segments) { return segments.reduce((sum,item)=>sum+Math.max(0,item.end-item.start),0); }
function renderTimer() {
  const now = Date.now();
  const elapsed = Math.floor(segmentDuration(timerSegments(now))/1000);
  const pad = value => String(value).padStart(2,'0');
  $('#timer').textContent = `${pad(Math.floor(elapsed/3600))}:${pad(Math.floor(elapsed/60)%60)}:${pad(elapsed%60)}`;
  $('#timer-toggle').textContent = state.timer.startedAt ? 'Ⅱ Пауза' : elapsed || state.timer.segments.length ? '▶ Продолжить' : '▶ Начать';
  $('#timer-finish').disabled = !state.timer.startedAt && !state.timer.segments.length;
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  const todayTime = [...state.sessions,...timerSegments(now)].reduce((sum,item)=>sum+Math.max(0, Math.min(item.end,now)-Math.max(item.start,midnight.getTime())),0);
  const minutes = Math.floor(todayTime/60000);
  $('#focus-total').textContent = minutes >= 60 ? `${Math.floor(minutes/60)} ч ${minutes%60} мин` : `${minutes} мин`;
}
$('#timer-toggle').addEventListener('click', () => {
  const now = Date.now();
  if (state.timer.startedAt) { state.timer.segments.push({start:state.timer.startedAt,end:now}); state.timer.startedAt = null; }
  else state.timer.startedAt = now;
  saveState(); renderTimer();
});
$('#timer-finish').addEventListener('click', () => {
  state.sessions.push(...timerSegments());
  state.timer = { startedAt:null,segments:[] };
  saveState(); renderTimer(); notify('Сессия завершена. Время сохранено.');
});
for (const selector of ['#help-open','#help-footer']) $(selector).addEventListener('click',()=>$('#help').showModal());
$('#help-close').addEventListener('click',()=>$('#help').close());
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
let lastDay = localDate();
function updateDay() {
  $('#today-label').textContent = new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'short'});
  const today = localDate();
  if (today !== lastDay) {
    lastDay = today; monthCache.clear(); renderLocal(); loadCurrentDays(true); loadCalendar(true); loadRates();
  }
}
updateDay(); renderLocal(); renderTimer();
// Запускаются независимо: отказ любого сервиса не прерывает другой запрос.
loadCurrentDays(); loadCalendar(); loadRates();
setInterval(() => { renderTimer(); updateDay(); },1000);
setInterval(loadRates, 60*60*1000);
if (storageWarning) notify('Не удалось прочитать сохранение. Проверь настройки хранения данных браузера.');
