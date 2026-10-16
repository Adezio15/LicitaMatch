for (const form of document.querySelectorAll('[data-cnpj-form], form[data-section="empresa"]')) {
  const button = form.querySelector('[data-cnpj-lookup]');
  if (!button) continue;
  const field = name => form.querySelector(`[name="${name}"], [data-field="${name}"]`);
  const input = field('cnpj');
  const status = form.querySelector('[data-cnpj-status]');
  const normalize = value => value.trim().toUpperCase().replace(/[.\/-]/g, '');
  let generation = 0;
  form.addEventListener('input', () => { generation++; });
  async function lookup() {
    const cnpj = normalize(input.value);
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) { status.textContent = 'Informe um CNPJ completo, numérico ou alfanumérico.'; return; }
    const revision = generation;
    button.disabled = true;
    status.textContent = 'Consultando BrasilAPI…';
    try {
      const response = await fetch('/api/empresas/consulta-cnpj', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': form.elements._csrf.value },
        body: JSON.stringify({ cnpj }), signal: AbortSignal.timeout(12000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar o CNPJ.');
      if (generation !== revision || normalize(input.value) !== cnpj) { status.textContent = 'O formulário mudou durante a consulta. Consulte novamente para aplicar os dados.'; return; }
      const existing = form.dataset.section === 'empresa';
      if (existing && !window.confirm('Aplicar os dados da BrasilAPI ao formulário e ao CNAE principal? Revise as alterações e salve cada seção para confirmar.')) { status.textContent = 'Dados atuais preservados.'; return; }
      let skipped = false;
      for (const [name, value] of Object.entries(data)) {
        if (name === 'cnpj' || !value) continue;
        const control = field(name);
        if (!control) continue;
        if (!existing && control.value.trim()) { skipped = true; continue; }
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (existing && data.cnae_principal && data.cnae_descricao) {
        const group = document.querySelector('[data-group="atividades"]');
        const activityForm = group.closest('form');
        const rows = group.querySelector('[data-rows]');
        let row = [...rows.children].find(row => row.querySelector('[data-field="tipo"]').value === 'principal');
        const sameCode = [...rows.children].find(candidate => candidate !== row && candidate.querySelector('[data-field="cnae"]').value.replace(/\D/g, '') === data.cnae_principal);
        if (sameCode) {
          status.textContent = 'Identificação preenchida. O CNAE já consta nas atividades; revise seu tipo na seção Atividades.';
          return;
        }
        if (!row && rows.children.length < 100) {
          rows.append(group.querySelector('template').content.cloneNode(true));
          row = rows.lastElementChild;
        }
        if (!row) {
          status.textContent = 'Identificação preenchida. Limite de atividades atingido; revise o CNAE manualmente.';
          return;
        }
        if (row) {
          for (const [name,value] of Object.entries({ tipo: 'principal', cnae: data.cnae_principal, descricao: data.cnae_descricao })) row.querySelector(`[data-field="${name}"]`).value = value;
          row.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
        }
        activityForm.querySelector('[data-save-status]').textContent = 'CNAE consultado. Revise e salve a seção Atividades.';
      }
      status.textContent = `Dados preenchidos. Revise e edite antes de ${existing ? 'salvar as seções Empresa e Atividades' : 'criar a conta'}.${skipped ? ' Campos já preenchidos foram preservados.' : ''}`;
    } catch (error) {
      status.textContent = `${error.name === 'TimeoutError' ? 'Tempo de consulta esgotado.' : error.message} Você pode continuar preenchendo manualmente.`;
    } finally { button.disabled = false; }
  }
  button.addEventListener('click', lookup);
}
