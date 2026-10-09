import PDFDocument from 'pdfkit';
import { REPORT_TIMEZONE, statusLabels } from './reportService.js';
import { safeOfficialUrl } from './sources/officialLink.js';

const displayDate = value => value ? new Date(value).toLocaleString('pt-BR',{timeZone:REPORT_TIMEZONE}) : 'Não informada';
// Standard PDF fonts support Portuguese; normalize unsupported control characters.
const text = value => String(value ?? 'Não informado').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');

export async function createReportPdf(report, companyName, interestName = '') {
  const doc = new PDFDocument({ size:'A4',margin:42,bufferPages:true,info:{Title:report.title,Author:'LicitaMatch'} });
  const chunks = [];
  const complete = new Promise((resolve,reject) => {
    doc.on('data',chunk=>chunks.push(chunk));
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);
  });
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#112a39').text('LicitaMatch');
  doc.fontSize(16).text(report.title).moveDown(0.4);
  doc.font('Helvetica').fontSize(10).text(text(companyName));
  const f=report.filters;
  doc.text(`Período: ${f.inicio} a ${f.fim} | Match: ${f.match_min}% a ${f.match_max}%`);
  doc.text(`Interesse: ${text(interestName || 'Todos')} | Órgão: ${text(f.orgao || 'Todos')} | Estado: ${f.estado || 'Todos'}`);
  doc.text(`Gerado em ${displayDate(new Date())} | ${report.total} registro(s)`).moveDown();
  doc.fontSize(9).text(report.tipo === 'alertas' ? 'Período baseado na data de envio. Inclui somente envios confirmados.'
    : 'Período baseado na data de identificação do match. Nos indicadores de alertas, considera a data de envio. Situação e percentual refletem o estado atual.');
  doc.moveDown();
  if (!report.rows.length) doc.text('Nenhum resultado para os filtros selecionados.');
  for (const row of report.rows) {
    if (doc.y > doc.page.height - 180) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#112a39');
    if (report.tipo === 'matches') {
      doc.text(`Faixa ${row.faixa}`).font('Helvetica').fontSize(10)
        .text(`${row.total} matches | Média: ${row.score_medio}%`);
    } else if (report.tipo === 'mensal') {
      doc.text(row.mes).font('Helvetica').fontSize(10)
        .text(`Oportunidades: ${row.oportunidades} | Matches: ${row.matches} | Média: ${row.score_medio}%`)
        .text(`Matches aceitos: ${row.aceitos} | E-mails enviados: ${row.emails} | WhatsApp enviados: ${row.whatsapp}`);
    } else {
      doc.text(text(row.titulo)).font('Helvetica').fontSize(10)
        .text(`Órgão: ${text(row.orgao)}`)
        .text(`Cidade/UF: ${text(row.cidade || 'Cidade não informada')} / ${row.uf || 'UF não informada'}`)
        .text(`Interesse: ${text(row.interesse_titulo)} | Match: ${row.score}% | Situação: ${statusLabels[row.status] || row.status}`)
        .text(`Encontrada em: ${displayDate(row.encontrada_em)} | Data da licitação: ${displayDate(row.data_abertura)}`);
      if (report.tipo === 'alertas') doc.text(`Canal: ${row.canal === 'email' ? 'E-mail' : 'WhatsApp'} | Enviado em: ${displayDate(row.enviado_em)}`);
      const url=safeOfficialUrl(row.url_fonte);
      if (url) doc.fillColor('#087f78').text(`Consultar fonte oficial: ${url}`,{link:url,underline:true});
      else doc.text('Link oficial não disponível');
    }
    doc.fillColor('#112a39').moveDown();
  }
  const {count}=doc.bufferedPageRange();
  for(let page=0;page<count;page++) {
    doc.switchToPage(page);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`${page+1} / ${count}`,42,doc.page.height-30,{lineBreak:false});
  }
  doc.end();
  return complete;
}
