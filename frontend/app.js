const $ = (selector) => document.querySelector(selector);
const monthInput = $('#month-picker');
const rowsEl = $('#student-rows');
const saveButton = $('#save-button');
const saveState = $('#save-state');
let students = [];
let month = '';
let dirty = false;
let monthStats = {};
let toastTimer;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function setDirty(value) {
  dirty = value;
  saveButton.disabled = !value;
  saveState.className = `save-state${value ? ' unsaved' : ''}`;
  saveState.querySelector('span').textContent = value ? '有尚未保存的修改' : '所有修改已保存';
}
async function loadMonth(nextMonth) {
  if (dirty && !window.confirm('当前修改还没有保存，切换月份会放弃这些修改。继续切换吗？')) {
    monthInput.value = month;
    return;
  }
  month = nextMonth;
  monthInput.value = month;
  $('#export-link').href = `/api/export.csv?month=${month}`;
  rowsEl.innerHTML = '<tr><td colspan="4" class="loading-cell">正在打开本月名单…</td></tr>';
  try {
    const response = await fetch(`/api/month?month=${month}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    students = data.students;
    render(data);
    setDirty(false);
  } catch (error) {
    rowsEl.innerHTML = '<tr><td colspan="4" class="loading-cell">无法连接到统计服务，请刷新页面重试。</td></tr>';
    showToast(error.message);
  }
}
function render(data) {
  monthStats = data;
  const query = $('#search-input').value.trim().toLocaleLowerCase();
  rowsEl.innerHTML = '';
  let visibleCount = 0;
  for (const [index, student] of students.entries()) {
    if (query && !student.name.toLocaleLowerCase().includes(query)) continue;
    visibleCount++;
    const tr = document.createElement('tr');
    tr.dataset.id = student.id;
    tr.innerHTML = `<td class="student-order">${String(index + 1).padStart(2, '0')}</td>
      <td class="student-name">${escapeHtml(student.name)}</td>
      <td class="count-cell"><input class="count-input" type="number" min="0" max="9999" step="1" inputmode="numeric" aria-label="${escapeHtml(student.name)}的小红花数量" value="${student.count}" data-id="${student.id}"></td>
      <td class="state-col"><span class="state-label ${student.saved ? 'done' : ''}">${student.saved ? '已登记' : '待登记'}</span></td>`;
    rowsEl.appendChild(tr);
  }
  $('#empty-state').classList.toggle('hidden', visibleCount > 0);
  for (const input of rowsEl.querySelectorAll('.count-input')) {
    input.addEventListener('input', () => {
      const value = input.value;
      const student = students.find((s) => s.id === Number(input.dataset.id));
      student.count = value === '' ? 0 : Math.max(0, Math.min(9999, Number.parseInt(value, 10) || 0));
      student.saved = false;
      input.classList.add('edited');
      input.closest('tr').querySelector('.state-label').textContent = '待保存';
      input.closest('tr').querySelector('.state-label').className = 'state-label';
      setDirty(true);
      updateSummary();
      drawRanking();
    });
    input.addEventListener('change', () => {
      if (input.value === '' || Number(input.value) < 0) input.value = '0';
      if (Number(input.value) > 9999) input.value = '9999';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      event.preventDefault();
      const visible = [...rowsEl.querySelectorAll('.count-input')];
      const step = event.key === 'ArrowUp' ? -1 : 1;
      visible[Math.max(0, Math.min(visible.length - 1, visible.indexOf(input) + step))]?.focus();
      if (event.key === 'Enter') input.blur();
    });
  }
  updateSummary(data.ranking);
  drawRanking(data.ranking);
  $('#entered-count').textContent = data.entered;
  $('#class-size').textContent = data.class_size;
  $('#progress-fill').style.width = `${data.class_size ? data.entered / data.class_size * 100 : 0}%`;
  $('#progress-label').textContent = data.entered === data.class_size ? '全班已完成' : `位同学已完成`;
}
function updateSummary() {
  $('#total-count').textContent = students.reduce((sum, s) => sum + (Number(s.count) || 0), 0).toLocaleString('zh-CN');
  const ordered = [...students].sort((a, b) => b.count - a.count || a.id - b.id);
  const leader = ordered[0];
  $('#leader-name').textContent = leader?.count ? leader.name : '等待第一朵花';
  $('#leader-count').textContent = leader?.count ? leader.count : '0';
}
function drawRanking() {
  const ranked = [...students].sort((a, b) => b.count - a.count || a.id - b.id).slice(0, 10);
  const list = $('#ranking-list');
  list.innerHTML = '';
  const hasFlowers = ranked.some((s) => s.count > 0);
  $('#ranking-empty').classList.toggle('hidden', hasFlowers);
  list.classList.toggle('hidden', !hasFlowers);
  if (!hasFlowers) return;
  let lastCount = null;
  let rank = 0;
  ranked.forEach((student, index) => {
    if (student.count !== lastCount) rank = index + 1;
    lastCount = student.count;
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `<span class="rank-medal">${rank}</span><span class="rank-name">${escapeHtml(student.name)}</span><span class="rank-count ${student.count ? '' : 'rank-zero'}">${student.count}<small>朵</small></span>`;
    list.appendChild(row);
  });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
async function saveAll() {
  if (!dirty) return;
  saveButton.disabled = true;
  saveState.className = 'save-state saving';
  saveState.querySelector('span').textContent = '正在保存…';
  try {
    const response = await fetch(`/api/month/${month}/counts`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({counts: Object.fromEntries(students.map((s) => [s.id, Number(s.count) || 0]))})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败');
    students = data.students;
    render(data);
    setDirty(false);
    showToast('本月统计已保存 ✿');
  } catch (error) {
    setDirty(true);
    showToast(error.message);
  }
}

monthInput.value = currentMonth();
monthInput.addEventListener('change', () => { if (monthInput.value) loadMonth(monthInput.value); });
$('#search-input').addEventListener('input', () => render(monthStats));
saveButton.addEventListener('click', saveAll);
$('#paste-toggle').addEventListener('click', () => {
  $('#paste-box').classList.toggle('hidden');
  if (!$('#paste-box').classList.contains('hidden')) $('#paste-input').focus();
});
$('#apply-paste').addEventListener('click', () => {
  const raw = $('#paste-input').value.trim();
  if (!raw) return showToast('先粘贴一列数字再填入');
  const values = raw.split(/[\s,，;；]+/).filter(Boolean);
  if (values.some((v) => !/^\d{1,4}$/.test(v))) return showToast('内容里有非数字，请检查后再填入');
  if (values.length > students.length) return showToast(`数量有 ${values.length} 个，名单只有 ${students.length} 人`);
  students.forEach((student, i) => {
    const value = values[i];
    if (value !== undefined) { student.count = Number(value); student.saved = false; }
  });
  render(monthStats);
  setDirty(true);
  $('#paste-box').classList.add('hidden');
  $('#paste-input').value = '';
  showToast(`已填入前 ${values.length} 位同学的数量`);
});
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
loadMonth(monthInput.value);
