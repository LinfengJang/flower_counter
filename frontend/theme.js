(() => {
  const storageKey = 'flowerCounterTheme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const savedTheme = localStorage.getItem(storageKey);
  const initialTheme = savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : (systemTheme.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = initialTheme;

  function applyTheme(theme, persist = false) {
    document.documentElement.dataset.theme = theme;
    if (persist) localStorage.setItem(storageKey, theme);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#191a18' : '#faf8f2';
    const button = document.querySelector('#theme-toggle');
    if (!button) return;
    const isDark = theme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', `切换到${isDark ? '浅色' : '深色'}模式`);
    button.querySelector('.theme-toggle-icon').textContent = isDark ? '☀' : '☾';
    button.querySelector('.theme-toggle-label').textContent = isDark ? '浅色模式' : '深色模式';
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.dataset.theme);
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme, true);
    });
  });

  systemTheme.addEventListener?.('change', (event) => {
    if (!localStorage.getItem(storageKey)) applyTheme(event.matches ? 'dark' : 'light');
  });
})();
