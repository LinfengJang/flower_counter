const $ = (selector) => document.querySelector(selector);
const classSelect = $('#create-class');
const editDialog = $('#edit-dialog');
let classes = [];
let sessions = [];
let editingSession = null;
let toastTimer;

function currentMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showMessage(element, message, isError=false) { element.textContent=message; element.classList.remove('hidden','error'); if(isError) element.classList.add('error'); }
async function loadAll() {
  const [classResponse, sessionResponse] = await Promise.all([fetch('/api/classes'), fetch('/api/sessions')]);
  const [classData, sessionData] = await Promise.all([classResponse.json(), sessionResponse.json()]);
  if (!classResponse.ok || !sessionResponse.ok) throw new Error('页面数据读取失败');
  classes = classData.classes;
  sessions = sessionData.sessions;
  const classOptions = classes.map((item) => `<option value="${item.id}" ${item.student_count ? '' : 'disabled'}>${escapeHtml(item.name)}${item.student_count ? '' : '（请先导入名单）'}</option>`).join('');
  classSelect.innerHTML = classOptions || '<option value="">尚无班级，请先到设置添加</option>';
  $('#edit-class').innerHTML = classOptions;
  $('#class-note').textContent = classes.length ? '每个班级每个月只能创建一条统计记录。' : '请先在设置页面添加班级并导入学生名单。';
  classSelect.disabled = !classes.some((item) => item.student_count);
  $('#create-session-button').disabled = !classes.some((item) => item.student_count);
  renderSessions();
}
function renderSessions() {
  $('#record-count').textContent = `${sessions.length} 条`;
  const list = $('#session-list');
  list.innerHTML = '';
  sessions.forEach((session, index) => {
    const card = document.createElement('article');
    card.className = 'session-card';
    card.style.setProperty('--row-delay', `${Math.min(index, 10) * 35}ms`);
    card.innerHTML = `<div><div class="session-title">${escapeHtml(session.class_name)} <span class="session-month">· ${escapeHtml(session.month)}</span></div><div class="session-meta">已登记 ${session.entered} / ${session.class_size} 人 <span>·</span> 已登记 ${Number(session.total).toLocaleString('zh-CN')} 朵</div></div><div class="session-actions"><a class="session-open" href="/report?session=${session.id}">查看报表</a><a class="session-entry" href="/entry?session=${session.id}">录入 / 修改</a><button class="session-edit" data-edit="${session.id}" type="button">编辑</button><button class="session-delete" data-delete="${session.id}" type="button">删除</button></div>`;
    list.appendChild(card);
  });
  $('#sessions-empty').classList.toggle('hidden', sessions.length > 0);
  list.classList.toggle('hidden', sessions.length === 0);
  list.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEdit(Number(button.dataset.edit))));
  list.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteSession(Number(button.dataset.delete))));
}
async function createSession(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const response = await fetch('/api/sessions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({class_id:Number(classSelect.value),month:$('#create-month').value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '创建失败');
    $('#create-session-form').reset();
    $('#create-month').value = currentMonth();
    await loadAll();
    showMessage($('#create-message'), `已创建 ${data.class_name} ${data.month} 统计，现在可以开始登记。`);
  } catch (error) { showMessage($('#create-message'), error.message, true); }
  finally { button.disabled = false; }
}
function openEdit(id) {
  editingSession = sessions.find((item) => item.id === id);
  if (!editingSession) return;
  $('#edit-class').value = String(editingSession.class_id);
  $('#edit-month').value = editingSession.month;
  $('#edit-error').textContent = '';
  editDialog.showModal();
}
async function saveEdit(event) {
  event.preventDefault();
  const response = await fetch(`/api/session/${editingSession.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({class_id:Number($('#edit-class').value),month:$('#edit-month').value})});
  const data = await response.json();
  if (!response.ok) { $('#edit-error').textContent = data.error || '修改失败'; return; }
  editDialog.close();
  await loadAll();
}
async function deleteSession(id) {
  const session = sessions.find((item) => item.id === id);
  if (!session || !confirm(`确定删除“${session.class_name} ${session.month}”统计吗？该统计下已录入的数量也会一并删除。`)) return;
  const response = await fetch(`/api/session/${id}`, {method:'DELETE'});
  const data = await response.json();
  if (!response.ok) return showMessage($('#create-message'), data.error || '删除失败', true);
  sessions = sessions.filter((item) => item.id !== id);
  renderSessions();
  showMessage($('#create-message'), `已删除 ${session.class_name} ${session.month} 统计。`);
}

$('#create-month').value = currentMonth();
$('#create-session-form').addEventListener('submit', createSession);
$('#edit-session-form').addEventListener('submit', saveEdit);
$('#cancel-edit').addEventListener('click', () => editDialog.close());
loadAll().catch((error) => showMessage($('#create-message'), error.message, true));
