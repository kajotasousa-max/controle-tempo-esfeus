/**
 * Backend de referência — Gestão de Serviços para Ferramentaria
 * Google Apps Script publicado como Web App.
 *
 * Implementa o contrato descrito em docs/API.md, que é o que o front-end espera.
 * Instalação: veja docs/INSTALACAO.md.
 *
 * Abas criadas automaticamente na planilha vinculada:
 *   Apontamentos · Materiais · Movimentacoes · Checklists · Responsaveis · Fornecedores
 */

const ABAS = {
  apontamentos: { nome: 'Apontamentos',  colunas: ['timestamp', 'os', 'etapa', 'cliente', 'oc', 'descricao', 'operacao', 'maquina', 'operador', 'status', 'qtd'] },
  materiais:    { nome: 'Materiais',     colunas: ['codigo', 'descricao', 'especificacao', 'unidade', 'estoqueMinimo', 'localizacao', 'ativo', 'atualizadoEm'] },
  movimentacoes:{ nome: 'Movimentacoes', colunas: ['timestamp', 'codigo', 'tipo', 'quantidade', 'os', 'loteDimensao', 'observacao', 'operador'] },
  checklists:   { nome: 'Checklists',    colunas: ['timestamp', 'os', 'cliente', 'codigoPeca', 'qtd', 'revisaoDesenho', 'inspetor', 'situacao', 'observacao', 'motivoNf', 'fotos', 'marcacoes'] },
  responsaveis: { nome: 'Responsaveis',  colunas: ['nome', 'funcao', 'ativo', 'atualizadoEm'] },
  fornecedores: { nome: 'Fornecedores',  colunas: ['nome', 'tipo', 'cnpj', 'contato', 'observacao', 'ativo', 'atualizadoEm'] }
};

/** Pasta do Drive onde as fotos dos checklists são gravadas. */
const PASTA_FOTOS = 'Gestão de Serviços - Fotos de Qualidade';
const FUSO = Session.getScriptTimeZone() || 'America/Sao_Paulo';

/* ======================= ENTRADAS HTTP ======================= */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    switch (action) {
      case 'list':               return json({ ok: true, apontamentos: lerTudo('apontamentos') });
      case 'list-materiais':     return json({ ok: true, materiais: lerTudo('materiais').map(m => Object.assign(m, { ativo: bool(m.ativo), estoqueMinimo: Number(m.estoqueMinimo) || 0 })) });
      case 'list-movimentacoes': return json({ ok: true, movimentacoes: lerTudo('movimentacoes') });
      case 'list-checklists':    return json({ ok: true, checklists: lerTudo('checklists').map(c => Object.assign(c, { fotos: parse(c.fotos, []), marcacoes: parse(c.marcacoes, {}) })) });
      case 'list-responsaveis':  return json({ ok: true, responsaveis: lerTudo('responsaveis').map(r => Object.assign(r, { ativo: bool(r.ativo) })) });
      case 'list-fornecedores':  return json({ ok: true, fornecedores: lerTudo('fornecedores').map(f => Object.assign(f, { ativo: bool(f.ativo) })) });
      default:                   return json({ ok: false, erro: 'Ação desconhecida: ' + action });
    }
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || 'null');
    if (Array.isArray(body)) return json(Object.assign({ ok: true }, gravarApontamentos(body)));
    if (!body || !body.kind) return json({ ok: false, erro: 'Payload sem "kind".' });
    switch (body.kind) {
      case 'material':     upsert('materiais', 'codigo', body, { atualizadoEm: agora() }); break;
      case 'movimentacao': anexar('movimentacoes', body); break;
      case 'checklist':    gravarChecklist(body); break;
      case 'responsavel':  upsert('responsaveis', 'nome', body, { atualizadoEm: agora() }); break;
      case 'fornecedor':   upsert('fornecedores', 'nome', body, { atualizadoEm: agora() }); break;
      default:             return json({ ok: false, erro: 'kind desconhecido: ' + body.kind });
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ======================= REGRAS ======================= */

/** Grava a fila de apontamentos ignorando os que já existem (o app reenvia se a resposta se perder). */
function gravarApontamentos(lista) {
  const chave = a => [a.timestamp, a.os, a.operador, a.status].join('||');
  const existentes = new Set(lerTudo('apontamentos').map(chave));
  const novos = lista.filter(a => a && !existentes.has(chave(a)));
  if (novos.length) {
    const aba = aba_('apontamentos');
    const cols = ABAS.apontamentos.colunas;
    const linhas = novos.map(a => cols.map(c => texto(a[c])));
    aba.getRange(aba.getLastRow() + 1, 1, linhas.length, cols.length).setValues(linhas);
  }
  return { gravados: novos.length, ignorados: lista.length - novos.length };
}

/** Salva as fotos no Drive (só as novas, em data URL) e grava o checklist com os links. */
function gravarChecklist(c) {
  const fotos = (c.fotos || []).map((f, i) => String(f).indexOf('data:') === 0 ? salvarFoto(f, c.os, c.timestamp, i) : f);
  anexar('checklists', Object.assign({}, c, {
    fotos: JSON.stringify(fotos),
    marcacoes: JSON.stringify(c.marcacoes || {})
  }));
}

function salvarFoto(dataUrl, os, timestamp, i) {
  const m = String(dataUrl).match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return '';
  const nome = ('OS ' + os + ' ' + timestamp + ' (' + (i + 1) + ')').replace(/[\\/:*?"<>|]/g, '-');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], nome + '.jpg');
  const arquivo = pastaFotos_().createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + arquivo.getId() + '&sz=w1000';
}

/* ======================= PLANILHA ======================= */

function aba_(tipo) {
  const def = ABAS[tipo];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.nome);
  if (!sh) {
    sh = ss.insertSheet(def.nome);
    sh.getRange(1, 1, 1, def.colunas.length).setValues([def.colunas]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@'); // tudo como texto: datas não são convertidas
  }
  return sh;
}

function lerTudo(tipo) {
  const sh = aba_(tipo);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const cols = ABAS[tipo].colunas;
  return sh.getRange(2, 1, n, cols.length).getValues()
    .filter(l => l.some(v => v !== ''))
    .map(l => cols.reduce((o, c, i) => (o[c] = l[i] instanceof Date ? Utilities.formatDate(l[i], FUSO, 'yyyy-MM-dd HH:mm:ss') : l[i], o), {}));
}

function anexar(tipo, obj) {
  const cols = ABAS[tipo].colunas;
  aba_(tipo).appendRow(cols.map(c => texto(obj[c])));
}

/** Atualiza a linha cuja coluna-chave bate (sem diferenciar maiúsculas) ou cria uma nova. */
function upsert(tipo, colChave, obj, extras) {
  const sh = aba_(tipo);
  const cols = ABAS[tipo].colunas;
  const dados = Object.assign({}, obj, extras || {});
  const linha = cols.map(c => texto(dados[c]));
  const idx = cols.indexOf(colChave);
  const alvo = String(dados[colChave] || '').trim().toUpperCase();
  if (!alvo) throw new Error('Campo "' + colChave + '" é obrigatório.');
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const chaves = sh.getRange(2, idx + 1, n, 1).getValues();
    for (let i = 0; i < chaves.length; i++) {
      if (String(chaves[i][0]).trim().toUpperCase() === alvo) {
        sh.getRange(i + 2, 1, 1, cols.length).setValues([linha]);
        return;
      }
    }
  }
  sh.appendRow(linha);
}

function pastaFotos_() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}

/* ======================= UTILITÁRIOS ======================= */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function texto(v) { return v === undefined || v === null ? '' : (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)); }
function bool(v) { return !(v === false || String(v).toUpperCase() === 'FALSE'); }
function parse(v, padrao) { try { return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
function agora() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss'); }

/** Rode uma vez pelo editor para criar todas as abas e autorizar o acesso ao Drive. */
function configurar() {
  Object.keys(ABAS).forEach(aba_);
  pastaFotos_();
}
