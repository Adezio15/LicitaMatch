const dialog = document.querySelector('#plans-dialog');
document.querySelectorAll('[data-open-plans]').forEach(button => button.addEventListener('click',()=>dialog.showModal()));
document.querySelector('[data-close-plans]')?.addEventListener('click',()=>dialog.close());
const timer = document.querySelector('[data-trial-end]');
if(timer) {
  const update = () => {
    const minutes = Math.max(0,Math.ceil((Date.parse(timer.dataset.trialEnd)-Date.now())/60000));
    timer.textContent = minutes ? `Tempo restante: ${Math.floor(minutes/60)}h ${minutes%60}min` : 'Seu período de teste Premium de 24 horas terminou.';
    if(!minutes) location.reload();
  };
  update(); setInterval(update,30000);
}
