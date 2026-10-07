document.querySelectorAll('[data-delete-company]').forEach(form => {
  form.addEventListener('submit', event => {
    if (!window.confirm(`Excluir a empresa “${form.dataset.companyName}”? Ela será removida da lista e seus usuários perderão o acesso. O histórico será preservado.`)) {
      event.preventDefault();
    }
  });
});
