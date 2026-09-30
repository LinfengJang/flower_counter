const $ = (selector) => document.querySelector(selector);
const fmt = window.FlowerCharts.formatNumber;
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderRanking(ranking) {
  const list = $('#report-ranking-list');
  list.innerHTML = '';
  ranking.forEach((student, index) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.style.setProperty('--row-delay', `${Math.min(index, 10) * 28}ms`);
    row.innerHTML = `<span class="rank-medal">${student.rank}</span><span class="rank-name">${escapeHtml(student.name)}</span><span class="rank-count">${fmt(student.count)}<small>朵</small></span>`;
    list.appendChild(row);
  });
  $('#report-ranking-empty').classList.toggle('hidden', ranking.length > 0);
  list.classList.toggle('hidden', ranking.length === 0);
}
function renderStudents(students) {
  const ranked = [...students].sort((a,b) => (a.saved === b.saved ? (b.count-a.count || a.number-b.number) : (a.saved ? -1 : 1)));
  $('#report-student-rows').innerHTML = ranked.map((s) => `<tr><td>${s.saved ? s.rank : '—'}</td><td>${s.number}</td><td>${escapeHtml(s.name)}</td><td>${s.saved ? fmt(s.count) : '—'}</td><td><span class="report-status ${s.saved ? 'is-saved' : ''}">${s.saved ? '已登记' : '未登记'}</span></td></tr>`).join('');
  $('#detail-count').textContent = `${students.length} 位学生`;
}
async function loadReport() {
  const sessionId = new URLSearchParams(location.search).get('session');
  if (!sessionId) {
    $('#report-error').textContent = '没有指定统计记录，请从数据管理页面打开报表。';
    $('#report-error').classList.remove('hidden');
    return;
  }
  try {
    const response = await fetch(`/api/session/${sessionId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '报表读取失败');
    $('#report-title').innerHTML = `${escapeHtml(data.class_name)} ${escapeHtml(data.month)}<span class="title-dot">.</span>`;
    $('#report-subtitle').textContent = `${data.class_name} · ${data.month} 小红花统计`;
    $('#report-entry-link').href = `/entry?session=${data.id}`;
    $('#report-export').href = `/api/session/${data.id}/export.csv`;
    $('#report-total').textContent = fmt(data.total);
    $('#report-entered').textContent = data.entered;
    $('#report-size').textContent = data.class_size;
    $('#report-progress').style.width = `${data.class_size ? data.entered/data.class_size*100 : 0}%`;
    $('#report-mean').textContent = data.analytics.mean == null ? '—' : fmt(data.analytics.mean);
    $('#report-median').textContent = data.analytics.median == null ? '—' : fmt(data.analytics.median);
    const modes = data.analytics.modes;
    $('#report-mode-caption').textContent = modes.length ? `众数：${modes.map(fmt).join('、')} 朵（各 ${data.analytics.mode_frequency} 人）` : '众数：暂无登记数据';
    const hasDistribution = window.FlowerCharts.drawDistribution($('#report-distribution'), data.analytics.distribution);
    $('#report-distribution').classList.toggle('hidden', !hasDistribution);
    $('#distribution-empty').classList.toggle('hidden', hasDistribution);
    const hasTrend = window.FlowerCharts.drawTrend($('#report-trend'), data.analytics.trend);
    $('#report-trend').classList.toggle('hidden', !hasTrend);
    $('#report-trend-empty').classList.toggle('hidden', hasTrend);
    renderRanking(data.ranking);
    renderStudents(data.students);
    $('#report-content').classList.remove('hidden');
  } catch (error) {
    $('#report-error').textContent = error.message;
    $('#report-error').classList.remove('hidden');
  }
}
loadReport();
