document.querySelectorAll('[data-uf-filter]').forEach(filter => {
  const details = filter.querySelector('details');
  const summary = filter.querySelector('[data-uf-summary]');
  const update = () => {
    const selected = [...filter.querySelectorAll('input:checked')];
    summary.replaceChildren();
    if (!selected.length) {
      summary.textContent = 'Selecione';
      return;
    }
    const chip = document.createElement('span');
    chip.className = 'uf-chip';
    chip.append(selected[0].nextElementSibling.textContent);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remover ${selected[0].value}`);
    remove.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      selected[0].checked = false;
      update();
    });
    chip.append(remove);
    summary.append(chip);
    if (selected.length > 1) summary.append(` + (${selected.length - 1})`);
  };
  filter.addEventListener('change', update);
  document.addEventListener('click', event => {
    if (!filter.contains(event.target)) details.open = false;
  });
  filter.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      details.open = false;
      details.querySelector('summary').focus();
    }
  });
  update();
});
