// Both channels use the same bounded summary, compatible with the WhatsApp template.
const summary = (value,fallback,max) => {
  const text = String(value || fallback).replace(/\s+/g,' ').trim() || fallback;
  return text.length > max ? text.slice(0,max-1) + '…' : text;
};
export function alertContent({customer,item = {},score,interestName} = {}) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score<0 || score>100) throw new Error('Pontuação do alerta deve estar entre 0 e 100.');
  return {
    customer:summary(customer,'Cliente',80),interestName:summary(interestName,'Oportunidade',100),score,
    item:{objeto:summary(item.objeto,'Não informado',400),modalidade:summary(item.modalidade,'N/D',60),unidadeGestora:summary(item.unidadeGestora,'Não informado',100)}
  };
}
