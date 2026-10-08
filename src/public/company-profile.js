const page = document.querySelector('[data-profile-endpoint]');
if (page) {
  const dirty = new Set();
  const revisions = new WeakMap();
  const stateNames = { AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins' };
  function mark(form) {
    if (!form) return;
    dirty.add(form);
    revisions.set(form, (revisions.get(form) || 0) + 1);
    const status = form.querySelector('[data-save-status]');
    if (status) status.textContent = 'Alterações ainda não salvas.';
  }
  function addTag(container) {
    const input = container.querySelector('[data-tag-input]');
    const value = input.value.trim();
    if (!value) return;
    const list = container.querySelector('.tag-list');
    const values = [...list.querySelectorAll('[data-tag-value]')].map(tag => tag.textContent);
    if (values.includes(value)) { input.value = ''; return; }
    if (values.length >= 50) { input.setCustomValidity('Use no máximo 50 palavras por registro.'); input.reportValidity(); return; }
    input.setCustomValidity('');
    const chip = document.createElement('span');
    chip.className = 'profile-tag';
    const text = document.createElement('span');
    text.dataset.tagValue = '';
    text.textContent = value;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.removeTag = '';
    button.setAttribute('aria-label', `Remover ${value}`);
    button.textContent = '×';
    chip.append(text, button);
    list.append(chip);
    input.value = '';
    mark(container.closest('form'));
  }
  function syncRegion(form) {
    if (form.dataset.section !== 'atendimento') return;
    const national = form.querySelector('[data-field="atendimento_nacional"]').checked;
    form.querySelectorAll('[data-group="regioes"] input,[data-group="regioes"] select,[data-group="regioes"] button').forEach(control => { control.disabled = national || form.querySelector('fieldset').disabled; });
    form.querySelectorAll('[data-group="regioes"] .profile-row').forEach(row => {
      const type = row.querySelector('[data-field="tipo"]').value;
      const uf = row.querySelector('[data-field="estado"]');
      const name = row.querySelector('[data-field="nome"]');
      uf.disabled = national || type === 'regiao' || form.querySelector('fieldset').disabled;
      name.disabled = national || type === 'estado' || form.querySelector('fieldset').disabled;
      name.required = type !== 'estado' && !national;
      uf.required = type !== 'regiao' && !national;
    });
  }
  function readFields(container) {
    const data = {};
    for (const control of container.querySelectorAll('[data-field]')) {
      if (control.dataset.type === 'tags') data[control.dataset.field] = [...control.querySelectorAll('[data-tag-value]')].map(tag => tag.textContent);
      else data[control.dataset.field] = control.type === 'checkbox' ? control.checked : control.value;
    }
    return data;
  }
  page.addEventListener('input', event => {
    const control = event.target;
    if (control.matches('[data-mask="cnpj"]')) {
      control.value = control.value.replace(/\D/g,'').slice(0,14).replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2');
    }
    if (control.matches('[data-tag-input]')) control.setCustomValidity('');
    if (control.matches('[data-state-search]')) {
      const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      const search = normalize(control.value);
      const select = control.parentElement.querySelector('select');
      [...select.options].forEach(option => { option.hidden = !!option.value && !normalize(`${option.value} ${stateNames[option.value]}`).includes(search); });
      return;
    }
    mark(control.closest('form'));
  });
  page.addEventListener('change', event => { mark(event.target.closest('form')); const form = event.target.closest('form'); if (form) syncRegion(form); });
  page.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-tag-input]')) { event.preventDefault(); addTag(event.target.closest('.tag-field')); }
  });
  page.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const form = button.closest('form');
    if (button.matches('[data-add-row]')) {
      const group = button.closest('[data-group]');
      const rows = group.querySelector('[data-rows]');
      if (rows.children.length >= 100) { form.querySelector('[data-save-status]').textContent = 'Limite de 100 registros por lista.'; return; }
      rows.append(group.querySelector('template').content.cloneNode(true));
      syncRegion(form);
      rows.lastElementChild.querySelector('input,select,textarea')?.focus();
      mark(form);
    }
    if (button.matches('[data-remove-row]')) { button.closest('.profile-row').remove(); mark(form); }
    if (button.matches('[data-add-tag]')) addTag(button.closest('.tag-field'));
    if (button.matches('[data-remove-tag]')) { button.closest('.profile-tag').remove(); mark(form); }
  });
  page.querySelectorAll('form[data-section]').forEach(form => {
    syncRegion(form);
    // Apply the existing CNPJ mask on initial render without marking the form dirty.
    form.querySelectorAll('[data-mask="cnpj"]').forEach(control => {
      const digits = control.value.replace(/\D/g,'');
      if (digits.length === 14) control.value = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      form.querySelectorAll('.tag-field').forEach(addTag);
      if (!form.reportValidity()) return;
      const data = {};
      const fieldset = form.querySelector('fieldset');
      const topGrid = [...fieldset.children].find(child => child.classList.contains('grid'));
      if (topGrid) Object.assign(data,readFields(topGrid));
      form.querySelectorAll('[data-group]').forEach(group => {
        data[group.dataset.group] = [...group.querySelector('[data-rows]').children].map(row => {
          const fields = readFields(row);
          if (group.dataset.group === 'regioes') {
            if (fields.tipo === 'regiao') fields.estado = '';
            if (fields.tipo === 'estado') fields.nome = '';
          }
          return fields;
        });
      });
      if (data.atendimento_nacional) data.regioes = [];
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('[data-save-status]');
      const revision = revisions.get(form) || 0;
      submit.disabled = true;
      status.textContent = 'Salvando…';
      try {
        const response = await fetch(`${page.dataset.profileEndpoint}/${form.dataset.section}`, {
          method: 'PATCH', headers: { 'Content-Type':'application/json','X-CSRF-Token':form.elements._csrf.value }, body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
        if ((revisions.get(form) || 0) === revision) {
          dirty.delete(form);
          status.textContent = 'Perfil atualizado com sucesso.';
          if (data.atendimento_nacional) form.querySelector('[data-rows]').replaceChildren();
        } else status.textContent = 'Dados enviados salvos. Há novas alterações ainda não salvas.';
        page.querySelector('[data-completion-text]').textContent = `${result.completion.percentual}% preenchido`;
        page.querySelector('[data-completion-bar]').value = result.completion.percentual;
      } catch (error) {
        dirty.add(form);
        status.textContent = `${error.message} Seus dados permanecem nesta seção; tente salvar novamente.`;
      } finally { submit.disabled = false; }
    });
  });
  window.addEventListener('beforeunload', event => { if (dirty.size) { event.preventDefault(); event.returnValue = ''; } });
}
