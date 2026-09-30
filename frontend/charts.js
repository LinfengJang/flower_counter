(() => {
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const fmt = (value) => Number(value).toLocaleString('zh-CN', {maximumFractionDigits: 1});
  function drawTrend(svg, points) {
    if (!points.length) return false;
    const width = 760, height = 270, left = 58, right = 738, top = 20, bottom = 214;
    const plotHeight = bottom - top, plotWidth = right - left;
    const highest = Math.max(1, ...points.map((point) => point.total));
    const tick = Math.max(1, Math.ceil(highest / 4));
    const ceiling = tick * 4;
    const x = (i) => points.length === 1 ? (left + right) / 2 : left + plotWidth * i / (points.length - 1);
    const y = (value) => bottom - plotHeight * value / ceiling;
    const coords = points.map((point, i) => [x(i), y(point.total)]);
    const path = coords.map(([px, py], i) => `${i ? 'L' : 'M'} ${px} ${py}`).join(' ');
    const parts = [];
    for (let i = 0; i <= 4; i++) {
      const value = ceiling - i * tick;
      const py = top + plotHeight * i / 4;
      parts.push(`<line class="chart-grid-line" x1="${left}" y1="${py}" x2="${right}" y2="${py}"/>`);
      parts.push(`<text class="chart-axis-label" x="${left - 12}" y="${py + 4}" text-anchor="end">${fmt(value)}</text>`);
    }
    if (points.length > 1) parts.push(`<path class="trend-area" d="${path} L ${coords[coords.length - 1][0]} ${bottom} L ${coords[0][0]} ${bottom} Z"/>`);
    parts.push(`<path class="trend-line" d="${path}"/>`);
    const labelEvery = Math.max(1, Math.ceil(points.length / 9));
    coords.forEach(([px, py], i) => {
      const point = points[i];
      const detail = point.sessions == null ? `${point.entered || 0} 位已登记` : `${point.sessions} 条统计`;
      parts.push(`<circle class="trend-point" style="--chart-delay:${Math.min(i,12)*28+180}ms" cx="${px}" cy="${py}" r="4"><title>${esc(point.month)}：${fmt(point.total)} 朵，${detail}</title></circle>`);
      if (i % labelEvery === 0 || i === points.length - 1) {
        const monthLabel = `${point.month.slice(2,4)}/${Number(point.month.slice(5))}`;
        parts.push(`<text class="chart-axis-label" x="${px}" y="${bottom + 24}" text-anchor="middle">${monthLabel}</text>`);
      }
    });
    parts.push(`<text class="chart-axis-title" x="${left}" y="${height - 9}">已登记总数（朵）</text>`);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = parts.join('');
    return true;
  }
  function drawClassBars(svg, classes) {
    if (!classes.length) return false;
    const width = 760, left = 142, right = 650, top = 20, rowHeight = 39;
    const height = Math.max(180, top + classes.length * rowHeight + 48);
    const maxValue = Math.max(1, ...classes.map((item) => item.total));
    const plotWidth = right - left;
    const parts = [];
    classes.forEach((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = item.total ? Math.max(2, plotWidth * item.total / maxValue) : 0;
      parts.push(`<text class="class-bar-label" x="${left - 12}" y="${y + 16}" text-anchor="end">${esc(item.name)}</text>`);
      parts.push(`<rect class="class-bar-bg" x="${left}" y="${y}" width="${plotWidth}" height="22" rx="5"/>`);
      if (item.total) parts.push(`<rect class="class-bar" style="--chart-delay:${Math.min(index,12)*32}ms" x="${left}" y="${y}" width="${barWidth}" height="22" rx="5"><title>${esc(item.name)}：${fmt(item.total)} 朵</title></rect>`);
      parts.push(`<text class="class-bar-value" x="${right + 12}" y="${y + 16}">${fmt(item.total)} 朵</text>`);
    });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = parts.join('');
    return true;
  }
  function drawDistribution(svg, bins) {
    if (!bins.length) return false;
    const width = 760, height = 270, left = 52, right = 738, top = 20, bottom = 214;
    const plotHeight = bottom - top, plotWidth = right - left;
    const highest = Math.max(1, ...bins.map((bin) => bin.count));
    const tick = Math.max(1, Math.ceil(highest / 4));
    const ceiling = tick * 4;
    const step = plotWidth / bins.length;
    const barWidth = Math.min(54, step * .6);
    const parts = [];
    for (let i=0; i<=4; i++) {
      const value = ceiling - i*tick, py = top + plotHeight*i/4;
      parts.push(`<line class="chart-grid-line" x1="${left}" y1="${py}" x2="${right}" y2="${py}"/>`);
      parts.push(`<text class="chart-axis-label" x="${left-12}" y="${py+4}" text-anchor="end">${value}</text>`);
    }
    bins.forEach((bin,i) => {
      const barHeight = plotHeight*bin.count/ceiling;
      const x = left + step*i + (step-barWidth)/2, y = bottom-barHeight;
      parts.push(`<rect class="distribution-bar" style="--chart-delay:${Math.min(i,12)*32}ms" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"><title>${esc(bin.label)} 朵：${bin.count} 位</title></rect>`);
      if (bin.count) parts.push(`<text class="chart-value-label" x="${x+barWidth/2}" y="${Math.max(top+12,y-7)}" text-anchor="middle">${bin.count}</text>`);
      parts.push(`<text class="chart-axis-label" x="${x+barWidth/2}" y="${bottom+24}" text-anchor="middle">${esc(bin.label)}</text>`);
    });
    parts.push(`<text class="chart-axis-title" x="${left}" y="${height-9}">小红花数量（朵）</text>`);
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.innerHTML=parts.join('');
    return true;
  }
  window.FlowerCharts = {drawTrend, drawClassBars, drawDistribution, formatNumber: fmt};
})();
