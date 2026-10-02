export function showToast(message, type = 'info', action) {
  let container = document.getElementById('toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toasts';
    container.className = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.setAttribute('role', 'alert');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const iconSpan = document.createElement('span');
  iconSpan.textContent = icons[type] || '';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = String(message);
  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  if (action && action.label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      toast.remove();
      action.run();
    });
    toast.appendChild(btn);
  }
  toast.addEventListener('click', (e) => {
    if (e.target === toast || e.target === msgSpan) toast.remove();
  });
  container.appendChild(toast);
  const duration = type === 'error' ? 6000 : 4500;
  setTimeout(() => toast.remove(), duration);
}
