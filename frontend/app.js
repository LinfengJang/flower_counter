const $ = (selector) => document.querySelector(selector);
const fmt = window.FlowerCharts.formatNumber;
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function renderRecent(sessions) {
  const list = $('#recent-session-list');
  list.innerHTML = '';
  sessions.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = 'recent-session-row';
    row.style.setProperty('--row-delay', `${Math.min(index, 10) * 28}ms`);
    row.innerHTML = `<div class="recent-session-top"><strong>${escapeHtml(item.class_name)}</strong><span>${escapeHtml(item.month)}</span></div><div class="recent-session-meta">已登记 ${item.entered} / ${item.class_size} 人 <span>·</span> ${fmt(item.total)} 朵</div><div class="recent-session-actions"><a href="/report?session=${item.id}">查看报表 <span>→</span></a><a href="/entry?session=${item.id}">录入 / 修改</a></div>`;
    list.appendChild(row);
  });
  $('#recent-empty').classList.toggle('hidden', sessions.length > 0);
}
function renderOverview(data) {
  const classFilter = $('#filter-class').value;
  const monthFilter = $('#filter-month').value;
  const records = data.session_summaries.filter((item) => (!classFilter || String(item.class_id) === classFilter) && (!monthFilter || item.month === monthFilter));
  const activeClasses = new Set(records.map((item) => String(item.class_id)));
  const classes = data.classes.filter((item) => (!classFilter && !monthFilter) ? true : activeClasses.has(String(item.id)))
    .map((item) => ({...item, total: records.filter((record) => record.class_id === item.id).reduce((sum, record) => sum + Number(record.total), 0)}));
  const total = records.reduce((sum, item) => sum + Number(item.total), 0);
  const entered = records.reduce((sum, item) => sum + Number(item.entered), 0);
  const expected = records.reduce((sum, item) => sum + Number(item.class_size), 0);
  const byMonth = new Map();
  for (const item of records) {
    const point = byMonth.get(item.month) || {month: item.month, total: 0, sessions: 0, entered: 0};
    point.total += Number(item.total); point.sessions += 1; point.entered += Number(item.entered);
    byMonth.set(item.month, point);
  }
  const trend = [...byMonth.values()].sort((a,b) => a.month.localeCompare(b.month));
  $('#class-count').textContent = (!classFilter && !monthFilter) ? data.class_count : activeClasses.size;
  $('#session-count').textContent = records.length;
  $('#total-count').textContent = fmt(total);
  $('#entered-count').textContent = entered.toLocaleString('zh-CN');
  $('#expected-count').textContent = expected.toLocaleString('zh-CN');
  $('#progress-fill').style.width = `${expected ? Math.min(100, entered / expected * 100) : 0}%`;
  const selectedClass = data.classes.find((item) => String(item.id) === classFilter);
  const scope = `${selectedClass ? selectedClass.name : '所有班级'} · ${monthFilter || '所有月份'}`;
  $('.eyebrow').innerHTML = `<span>✳</span> ${escapeHtml(scope)}`;
  $('#overview-subtitle').textContent = `${selectedClass ? selectedClass.name : '跨班级'}、${monthFilter || '跨月份'}查看已登记的小红花数据。`;
  $('.overview-chart-panel:first-child .overview-chart-caption').textContent = monthFilter ? `${monthFilter} · ${selectedClass ? selectedClass.name : '各班'}登记汇总` : '汇总所选范围内每月的统计记录';
  $('.class-chart-panel .overview-chart-caption').textContent = monthFilter ? `${monthFilter} · 各班登记数量对比` : '汇总所选班级所有月份的登记数量';
  const trendVisible = window.FlowerCharts.drawTrend($('#overview-trend-chart'), trend);
  $('#overview-trend-chart').classList.toggle('hidden', !trendVisible);
  $('#overview-trend-empty').classList.toggle('hidden', trendVisible);
  const classesWithStats = classes.filter((item) => item.total > 0);
  const classVisible = window.FlowerCharts.drawClassBars($('#class-chart'), classesWithStats);
  $('#class-chart').classList.toggle('hidden', !classVisible);
  $('#class-chart-empty').classList.toggle('hidden', classVisible);
  renderRecent(records.slice(0, 8));
  $('#no-records-notice').classList.toggle('hidden', records.length > 0 || (!classFilter && !monthFilter && data.session_count === 0));
  $('#no-records-notice strong').textContent = '当前范围没有统计记录';
  $('#no-records-copy').textContent = (classFilter || monthFilter) ? '可以更换班级或月份筛选条件，查看其他统计记录。' : '先到设置中准备班级名单，再创建班级和月份统计。';
}
async function loadOverview() {
  try {
    const response = await fetch('/api/overview');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '总览数据读取失败');
    if (!Array.isArray(data.session_summaries)) {
      const sessionsResponse = await fetch('/api/sessions');
      const sessionsData = await sessionsResponse.json();
      data.session_summaries = sessionsResponse.ok && Array.isArray(sessionsData.sessions)
        ? sessionsData.sessions : (data.recent_sessions || []);
    }
    const classSelect = $('#filter-class');
    const monthSelect = $('#filter-month');
    classSelect.innerHTML = '<option value="">所有班级</option>' + data.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const months = [...new Set(data.session_summaries.map((item) => item.month))].sort((a,b) => b.localeCompare(a));
    monthSelect.innerHTML = '<option value="">所有月份</option>' + months.map((month) => `<option value="${month}">${month}</option>`).join('');
    classSelect.addEventListener('change', () => renderOverview(data));
    monthSelect.addEventListener('change', () => renderOverview(data));
    renderOverview(data);
  } catch (error) {
    $('#no-records-notice').classList.remove('hidden');
    $('#no-records-notice strong').textContent = error.message;
  }
}
loadOverview();
