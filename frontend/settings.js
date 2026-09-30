const $ = (selector) => document.querySelector(selector);
let classes = [];

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showMessage(element, message, isError=false) { element.textContent=message; element.classList.remove('hidden','error'); if(isError) element.classList.add('error'); }
async function loadClasses(selectedId=null) {
  const response = await fetch('/api/classes');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '班级列表读取失败');
  classes = data.classes;
  $('#class-list').innerHTML = classes.map((item) => `<div class="class-chip"><strong>${escapeHtml(item.name)}</strong><span>${item.student_count} 名学生</span></div>`).join('');
  const options = classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${item.student_count} 人</option>`).join('');
  $('#import-class').innerHTML = options || '<option value="">请先添加班级</option>';
  $('#import-class').disabled = !classes.length;
  $('#import-button').disabled = !classes.length;
  if (selectedId && classes.some((item) => item.id === selectedId)) $('#import-class').value = String(selectedId);
}
async function createClass(event) {
  event.preventDefault();
  const nameInput = $('#class-name');
  const button = event.submitter;
  button.disabled = true;
  try {
    const response = await fetch('/api/classes', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:nameInput.value})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '班级添加失败');
    nameInput.value = '';
    await loadClasses(data.id);
    showMessage($('#class-message'), `已添加 ${data.name}，接下来可以为它导入学生名单。`);
  } catch (error) { showMessage($('#class-message'), error.message, true); }
  finally { button.disabled = false; }
}
async function importRoster(event) {
  event.preventDefault();
  const file = $('#roster-file').files[0];
  const classId = $('#import-class').value;
  if (!file || !classId) return showMessage($('#import-message'), '请选择班级和名单文件。', true);
  const button = $('#import-button');
  button.disabled = true;
  button.textContent = '正在导入…';
  try {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`/api/classes/${classId}/students/import`, {method:'POST',body:form});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '导入失败');
    await loadClasses(Number(classId));
    $('#roster-file').value = '';
    showMessage($('#import-message'), `成功导入 ${data.imported} 名学生到 ${classes.find((item) => item.id === Number(classId))?.name || '所选班级'}。`);
  } catch (error) { showMessage($('#import-message'), error.message, true); }
  finally { button.disabled = false; button.innerHTML = '导入名单 <span>↑</span>'; }
}

$('#create-class-form').addEventListener('submit', createClass);
$('#import-form').addEventListener('submit', importRoster);
loadClasses().catch((error) => showMessage($('#class-message'), error.message, true));
