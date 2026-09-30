const $ = (selector) => document.querySelector(selector);
const monthInput = $('#entry-month');
const numberInput = $('#student-number');
const countInput = $('#flower-count');
let roster = [];
let selectedStudent = null;
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
async function loadRoster() {
  selectedStudent = null;
  $('#student-confirmation').classList.add('hidden');
  $('#lookup-error').classList.add('hidden');
  try {
    const response = await fetch(`/api/month?month=${monthInput.value}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '名单读取失败');
    roster = data.students;
  } catch (error) {
    $('#lookup-error').textContent = error.message;
    $('#lookup-error').classList.remove('hidden');
  }
}
function lookupStudent() {
  const number = Number.parseInt(numberInput.value, 10);
  selectedStudent = roster.find((student) => student.number === number) || null;
  const error = $('#lookup-error');
  if (!selectedStudent) {
    $('#student-confirmation').classList.add('hidden');
    error.textContent = numberInput.value ? '没有找到这个学号，请按名单序号检查。' : '请先输入学号。';
    error.classList.remove('hidden');
    numberInput.focus();
    numberInput.select();
    return;
  }
  error.classList.add('hidden');
  $('#student-name').textContent = selectedStudent.name;
  $('#identity-number').textContent = `学号 ${selectedStudent.number}`;
  $('#existing-count').textContent = selectedStudent.saved ? `本月当前记录：${selectedStudent.count} 朵，保存后将更新为新数量。` : '这位同学本月还没有登记过。';
  countInput.value = selectedStudent.saved ? selectedStudent.count : '';
  $('#student-confirmation').classList.remove('hidden');
  countInput.focus();
}
async function saveCount() {
  if (!selectedStudent) return;
  const raw = countInput.value;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) > 9999) {
    showToast('请输入 0 到 9999 的整数');
    countInput.focus();
    return;
  }
  const button = $('#confirm-save');
  button.disabled = true;
  button.innerHTML = '<span>…</span> 正在保存';
  try {
    const response = await fetch(`/api/month/${monthInput.value}/student/${selectedStudent.id}/count`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({count: Number(raw)})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败，请重试');
    const saved = data.students.find((student) => student.id === selectedStudent.id);
    showToast(`已保存：${saved.name}，${saved.count} 朵 ✿`);
    numberInput.value = '';
    countInput.value = '';
    $('#student-confirmation').classList.add('hidden');
    $('#lookup-error').classList.add('hidden');
    selectedStudent = null;
    numberInput.focus();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✓</span> 确认并保存';
  }
}

monthInput.value = currentMonth();
monthInput.addEventListener('change', loadRoster);
$('#lookup-button').addEventListener('click', lookupStudent);
numberInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') lookupStudent(); });
countInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveCount(); });
$('#confirm-save').addEventListener('click', saveCount);
loadRoster();
window.addEventListener('load', () => numberInput.focus());
