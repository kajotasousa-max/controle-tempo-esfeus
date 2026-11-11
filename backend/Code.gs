/**
 * Backend de referência — Gestão de Serviços para Ferramentaria
 * Google Apps Script publicado como Web App.
 *
 * Implementa o contrato descrito em docs/API.md, que é o que o front-end espera.
 * Instalação: veja docs/INSTALACAO.md.
 *
 * Abas de dados (criadas automaticamente na planilha vinculada):
 *   Servicos · Apontamentos · Materiais · Movimentacoes · Checklists · Responsaveis · Fornecedores
 * Abas de consulta (reescritas a cada gravação, não edite):
 *   Saldos · Análise por OS
 *
 * Senhas: menu "Gestão de Serviços" da planilha (aparece ao recarregar a página).
 *   Escritório → tudo. Operador → só grava apontamentos e lê a lista de responsáveis.
 *   Sem senha definida, o app fica aberto (como nas versões anteriores).
 */

const ABAS = {
  servicos:     { nome: 'Servicos',      colunas: ['id', 'os', 'it', 'cliente', 'oc', 'des', 'desc', 'qty', 'material', 'tratamento', 'emb', 'prazo', 'status', 'nf', 'dt', 'etapas', 'imagem', 'extras', 'atualizadoEm', 'excluido'] },
  apontamentos: { nome: 'Apontamentos',  colunas: ['timestamp', 'os', 'item', 'etapa', 'cliente', 'oc', 'descricao', 'operacao', 'maquina', 'operador', 'status', 'qtd'] },
  materiais:    { nome: 'Materiais',     colunas: ['codigo', 'descricao', 'especificacao', 'unidade', 'estoqueMinimo', 'localizacao', 'ativo', 'atualizadoEm'] },
  movimentacoes:{ nome: 'Movimentacoes', colunas: ['timestamp', 'codigo', 'tipo', 'quantidade', 'os', 'loteDimensao', 'observacao', 'operador'] },
  checklists:   { nome: 'Checklists',    colunas: ['timestamp', 'os', 'item', 'cliente', 'codigoPeca', 'qtd', 'revisaoDesenho', 'inspetor', 'situacao', 'observacao', 'motivoNf', 'fotos', 'marcacoes'] },
  responsaveis: { nome: 'Responsaveis',  colunas: ['nome', 'funcao', 'ativo', 'atualizadoEm'] },
  fornecedores: { nome: 'Fornecedores',  colunas: ['nome', 'tipo', 'cnpj', 'contato', 'observacao', 'ativo', 'atualizadoEm'] }
};

/** Abas que ganharam a coluna "item" na versão 1.2 (antes a OS vinha junto: "CO 26.002/75"). */
const SEM_ITEM = {
  apontamentos: ['timestamp', 'os', 'etapa', 'cliente', 'oc', 'descricao', 'operacao', 'maquina', 'operador', 'status', 'qtd'],
  checklists:   ['timestamp', 'os', 'cliente', 'codigoPeca', 'qtd', 'revisaoDesenho', 'inspetor', 'situacao', 'observacao', 'motivoNf', 'fotos', 'marcacoes']
};

/** Separa OS e item: "CO 26.002/75" → { os: "CO 26.002", item: "75" }. Aceita os dois formatos. */
function separarOsItem_(r) {
  const o = Object.assign({}, r);
  let os = String(o.os || '').trim(), item = String(o.item || '').trim();
  if (item && os.slice(-(item.length + 1)) === '/' + item) os = os.slice(0, -(item.length + 1)).trim();
  else if (!item && os.indexOf('/') >= 0) { const i = os.lastIndexOf('/'); item = os.slice(i + 1).trim(); os = os.slice(0, i).trim(); }
  o.os = os; o.item = item;
  return o;
}
function osItem_(r) { const o = separarOsItem_(r); return o.os + (o.item ? '/' + o.item : ''); }

/** Campos da OS que viram colunas próprias na aba Servicos. O resto vai na coluna "extras". */
const CAMPOS_SERVICO = ['os', 'it', 'cliente', 'oc', 'des', 'desc', 'qty', 'material', 'tratamento', 'emb', 'prazo', 'status', 'nf', 'dt'];

/** Pasta do Drive onde as fotos dos checklists e das peças são gravadas. */
const PASTA_FOTOS = 'Gestão de Serviços - Fotos de Qualidade';
const FUSO = Session.getScriptTimeZone() || 'America/Sao_Paulo';
const TIPOS_SAIDA = ['Consumo na OS', 'Perda / descarte', 'Ajuste de saída'];

/* ======================= ACESSO ======================= */

/** O que a senha de operador pode fazer. */
const PERMITIDO_OPERADOR = { get: ['versao', 'list-responsaveis'], post: ['apontamentos'] };

function propriedades_() { return PropertiesService.getScriptProperties(); }

function hashSenha_(senha) {
  const p = propriedades_();
  let sal = p.getProperty('SAL');
  if (!sal) { sal = Utilities.getUuid(); p.setProperty('SAL', sal); }
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + String(senha), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

/** 'livre' (nenhuma senha definida), 'escritorio', 'operador' ou null (senha errada/ausente). */
function nivelDe_(senha) {
  const p = propriedades_();
  const esc = p.getProperty('SENHA_ESCRITORIO'), op = p.getProperty('SENHA_OPERADOR');
  if (!esc && !op) return 'livre';
  if (!senha) return null;
  const h = hashSenha_(senha);
  if (esc && h === esc) return 'escritorio';
  if (op && h === op) return 'operador';
  return null;
}

/** Devolve a resposta de recusa, ou null se pode seguir. */
function verificarAcesso_(e, metodo, acao) {
  const nivel = nivelDe_(e && e.parameter && e.parameter.k);
  if (nivel === null) {
    Utilities.sleep(1500); // atrasa quem tenta adivinhar
    return json({ ok: false, semAcesso: true, erro: 'Senha inválida ou ausente.' });
  }
  if (nivel === 'operador' && PERMITIDO_OPERADOR[metodo].indexOf(acao) < 0) {
    return json({ ok: false, semPermissao: true, erro: 'A senha de operador só registra apontamentos.' });
  }
  return null;
}

/* ======================= ENTRADAS HTTP ======================= */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    const recusa = verificarAcesso_(e, 'get', action);
    if (recusa) return recusa;
    switch (action) {
      case 'list':               return json({ ok: true, apontamentos: lerTudo('apontamentos') });
      case 'list-servicos':      return json({ ok: true, servicos: listarServicos(), agora: agora() });
      case 'list-materiais':     return json({ ok: true, materiais: listarMateriais() });
      case 'list-movimentacoes': return json({ ok: true, movimentacoes: lerTudo('movimentacoes') });
      case 'list-checklists':    return json({ ok: true, checklists: listarChecklists() });
      case 'list-responsaveis':  return json({ ok: true, responsaveis: listarAtivos('responsaveis') });
      case 'list-fornecedores':  return json({ ok: true, fornecedores: listarAtivos('fornecedores') });
      case 'versao':             return json({ ok: true, versao: '1.2.0', servicos: true, item: true, nivel: nivelDe_(e.parameter.k) });
      default:                   return json({ ok: false, erro: 'Ação desconhecida: ' + action });
    }
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || 'null'); }
  catch (err) { return json({ ok: false, erro: 'JSON inválido.' }); }
  const recusa = verificarAcesso_(e, 'post', Array.isArray(body) ? 'apontamentos' : String(body && body.kind));
  if (recusa) return recusa;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let resposta;
  try {
    if (Array.isArray(body)) {
      resposta = Object.assign({ ok: true }, gravarApontamentos(body));
    } else if (!body || !body.kind) {
      return json({ ok: false, erro: 'Payload sem "kind".' });
    } else {
      resposta = { ok: true };
      switch (body.kind) {
        case 'servicos':     resposta.servicos = gravarServicos(body.itens || []); break;
        case 'material':     upsert('materiais', 'codigo', body, { atualizadoEm: agora() }); break;
        case 'movimentacao': anexar('movimentacoes', body); break;
        case 'checklist':    gravarChecklist(body); break;
        case 'responsavel':  upsert('responsaveis', 'nome', body, { atualizadoEm: agora() }); break;
        case 'fornecedor':   upsert('fornecedores', 'nome', body, { atualizadoEm: agora() }); break;
        default:             return json({ ok: false, erro: 'kind desconhecido: ' + body.kind });
      }
    }
    SpreadsheetApp.flush();
    atualizarPaineis_();
    return json(resposta);
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ======================= SERVIÇOS (OS) ======================= */

function listarServicos() {
  return lerTudo('servicos').map(montarServico_);
}

/** Linha da planilha → objeto OS do front. Excluídas voltam com excluido: true para os outros aparelhos apagarem. */
function montarServico_(l) {
  const s = Object.assign({}, parse(l.extras, {}));
  CAMPOS_SERVICO.forEach(c => { s[c] = l[c] === undefined || l[c] === null ? '' : String(l[c]); });
  s.id = Number(l.id) || l.id;
  s.etapas = parse(l.etapas, []);
  s.imagem = l.imagem || '';
  s.atualizadoEm = l.atualizadoEm || '';
  s.excluido = String(l.excluido).toUpperCase() === 'TRUE';
  return s;
}

/**
 * Recebe [{ acao: 'salvar'|'excluir', servico }] e devolve as OS como ficaram na planilha.
 * Imagem em data URL vai para o Drive e volta como link.
 */
function gravarServicos(itens) {
  const sh = aba_('servicos');
  const cols = ABAS.servicos.colunas;
  const n = sh.getLastRow() - 1;
  const ids = n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues().map(l => String(l[0]).trim()) : [];
  const resultado = [];
  itens.forEach(item => {
    const s = item && item.servico;
    if (!s || s.id === undefined || s.id === null || s.id === '') return;
    const id = String(s.id).trim();
    const pos = ids.indexOf(id);
    const linhaAtual = pos >= 0 ? linhaComoObjeto_(sh, pos + 2, cols) : null;
    let dados;
    if (item.acao === 'excluir') {
      dados = linhaAtual ? Object.assign({}, linhaAtual) : { id: id };
      dados.excluido = 'TRUE';
    } else {
      dados = { id: id, excluido: 'FALSE' };
      CAMPOS_SERVICO.forEach(c => { dados[c] = s[c]; });
      dados.etapas = JSON.stringify(Array.isArray(s.etapas) ? s.etapas : []);
      let imagem = s.imagem || '';
      if (String(imagem).indexOf('data:') === 0) imagem = salvarFoto(imagem, (s.os || 'sem OS') + ' peça', agora(), 0);
      dados.imagem = imagem;
      const extras = {};
      Object.keys(s).forEach(k => {
        if (CAMPOS_SERVICO.indexOf(k) >= 0 || ['id', 'etapas', 'imagem', 'atualizadoEm', 'excluido'].indexOf(k) >= 0) return;
        extras[k] = s[k];
      });
      dados.extras = Object.keys(extras).length ? JSON.stringify(extras) : '';
    }
    dados.atualizadoEm = agora();
    const linha = cols.map(c => texto(dados[c]));
    if (pos >= 0) {
      sh.getRange(pos + 2, 1, 1, cols.length).setValues([linha]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setValues([linha]);
      ids.push(id);
    }
    resultado.push(montarServico_(dados));
  });
  return resultado;
}

function linhaComoObjeto_(sh, linha, cols) {
  const v = sh.getRange(linha, 1, 1, cols.length).getDisplayValues()[0];
  return cols.reduce((o, c, i) => (o[c] = v[i], o), {});
}

/* ======================= LEITURAS ======================= */

function listarMateriais() {
  return lerTudo('materiais').map(m => Object.assign(m, { ativo: bool(m.ativo), estoqueMinimo: numero(m.estoqueMinimo) }));
}
function listarChecklists() {
  return lerTudo('checklists').map(c => Object.assign(c, { fotos: parse(c.fotos, []), marcacoes: parse(c.marcacoes, {}) }));
}
function listarAtivos(tipo) {
  return lerTudo(tipo).map(r => Object.assign(r, { ativo: bool(r.ativo) }));
}

/* ======================= REGRAS ======================= */

/** Grava a fila de apontamentos ignorando os que já existem (o app reenvia se a resposta se perder). */
function gravarApontamentos(lista) {
  const chave = a => [a.timestamp, osItem_(a), a.operador, a.status].join('||');
  const existentes = new Set(lerTudo('apontamentos').map(chave));
  const novos = [];
  lista.forEach(a => {
    if (a && !existentes.has(chave(a))) { novos.push(separarOsItem_(a)); existentes.add(chave(a)); }
  });
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
  anexar('checklists', Object.assign(separarOsItem_(c), {
    fotos: JSON.stringify(fotos.filter(Boolean)),
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

/* ======================= ABAS DE CONSULTA ======================= */

/** Reescreve "Saldos" e "Análise por OS". Falha aqui nunca derruba a gravação. */
function atualizarPaineis_() {
  try { atualizarSaldos_(); } catch (err) { console.warn('Saldos: ' + err); }
  try { atualizarAnalise_(); } catch (err) { console.warn('Análise: ' + err); }
}

function atualizarSaldos_() {
  const saldo = {};
  lerTudo('movimentacoes').forEach(m => {
    const k = String(m.codigo || '').trim().toUpperCase();
    saldo[k] = (saldo[k] || 0) + numero(m.quantidade) * (TIPOS_SAIDA.indexOf(m.tipo) >= 0 ? -1 : 1);
  });
  const linhas = listarMateriais().map(m => {
    const s = saldo[String(m.codigo || '').trim().toUpperCase()] || 0;
    const alerta = s <= 0 ? 'Zerado' : (s < m.estoqueMinimo ? 'Abaixo do mínimo' : '');
    return [m.codigo, m.descricao, m.unidade, s, m.estoqueMinimo, alerta, m.localizacao, m.ativo ? 'Sim' : 'Não'];
  });
  escreverPainel_('Saldos', ['Código', 'Descrição', 'Unidade', 'Saldo', 'Estoque mínimo', 'Alerta', 'Localização', 'Ativo'], linhas);
}

/** Mesma regra da aba "Análise por OS" do app. */
function atualizarAnalise_() {
  const prazos = {};
  listarServicos().forEach(s => { if (!s.excluido) prazos[(s.os || '') + (s.it ? '/' + s.it : '')] = s.prazo || ''; });
  const grupos = {};
  lerTudo('apontamentos').forEach(a => {
    a = separarOsItem_(a);
    const k = [osItem_(a), a.etapa, a.operacao, a.operador].join('||');
    if (!grupos[k]) grupos[k] = { os: a.os, item: a.item, etapa: a.etapa, operacao: a.operacao, maquina: a.maquina, operador: a.operador, qtd: '', ultimo: '', eventos: [] };
    grupos[k].eventos.push(a);
  });
  const agoraMs = Date.now();
  const linhas = Object.keys(grupos).map(k => {
    const g = grupos[k];
    g.eventos.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    let inicio = '', conclusao = '', tempo = 0, rodando = null;
    g.eventos.forEach(e => {
      const t = dataDe_(e.timestamp);
      if (!t) return;
      if (e.qtd) g.qtd = e.qtd;
      g.ultimo = e.timestamp;
      if (e.status === 'Iniciando') { if (!inicio) inicio = e.timestamp; rodando = t; }
      else if (e.status === 'Parado') { if (rodando) tempo += t - rodando; rodando = null; }
      else if (['Etapa concluída', 'Concluído Parcial', 'Finalizado'].indexOf(e.status) >= 0) {
        if (rodando) tempo += t - rodando;
        rodando = null;
        conclusao = e.timestamp;
      }
    });
    if (rodando) tempo += agoraMs - rodando;
    const prazo = prazos[g.os + (g.item ? '/' + g.item : '')] || '';
    const fimPrazo = prazo ? dataDe_(prazo + ' 23:59:59') : null;
    let situacao = 'Não iniciada';
    if (conclusao) situacao = fimPrazo && dataDe_(conclusao) > fimPrazo ? 'Entregue com atraso' : 'Concluída no prazo';
    else if (inicio) situacao = fimPrazo && agoraMs > fimPrazo ? 'Atrasada' : 'Em andamento';
    return [g.os, g.item, g.etapa, g.operacao, g.maquina, g.operador, br_(inicio), br_(conclusao), Math.round(tempo / 60000), g.qtd, prazo ? prazo.split('-').reverse().join('/') : '', situacao, br_(g.ultimo), inicio];
  });
  linhas.sort((a, b) => String(b[13]).localeCompare(String(a[13])));
  escreverPainel_('Análise por OS',
    ['OS', 'Item', 'Etapa', 'Operação', 'Máquina', 'Operador', 'Início', 'Conclusão', 'Tempo (min)', 'Qtd', 'Prazo', 'Situação', 'Última atividade'],
    linhas.map(l => l.slice(0, 13)));
}

function escreverPainel_(nome, cabecalho, linhas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  sh.clearContents();
  sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (linhas.length) sh.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
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
  } else if (SEM_ITEM[tipo] && !colunaItemConferida_[tipo]) {
    incluirColunaItem_(sh, tipo);
  }
  colunaItemConferida_[tipo] = true;
  return sh;
}

const colunaItemConferida_ = {};

/** Aba no formato sem "item": regrava com a coluna nova, separando "CO 26.002/75" em OS e item. */
function incluirColunaItem_(sh, tipo) {
  const cab = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0];
  if (cab[2] === 'item') return;
  const antigas = SEM_ITEM[tipo];
  if (!antigas.every((c, i) => cab[i] === c)) return; // formato desconhecido: não mexe
  const n = sh.getLastRow() - 1;
  const linhas = n > 0 ? sh.getRange(2, 1, n, antigas.length).getDisplayValues() : [];
  const novas = ABAS[tipo].colunas;
  const dados = linhas.filter(l => l.some(v => v !== ''))
    .map(l => separarOsItem_(antigas.reduce((o, c, i) => (o[c] = l[i], o), {})))
    .map(o => novas.map(c => texto(o[c])));
  sh.clearContents();
  sh.getRange('A:Z').setNumberFormat('@');
  sh.getRange(1, 1, 1, novas.length).setValues([novas]).setFontWeight('bold');
  if (dados.length) sh.getRange(2, 1, dados.length, novas.length).setValues(dados);
}

function lerTudo(tipo) {
  const sh = aba_(tipo);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const cols = ABAS[tipo].colunas;
  return sh.getRange(2, 1, n, cols.length).getDisplayValues()
    .filter(l => l.some(v => v !== ''))
    .map(l => cols.reduce((o, c, i) => (o[c] = l[i], o), {}));
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
    const chaves = sh.getRange(2, idx + 1, n, 1).getDisplayValues();
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
function numero(v) { const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
function parse(v, padrao) { try { return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
function agora() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm:ss'); }
/** 'yyyy-MM-dd HH:mm:ss' (horário de Brasília) → milissegundos. */
function dataDe_(txt) {
  const m = String(txt || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3] + ' ' + (m[4] || '00') + ':' + (m[5] || '00') + ':' + (m[6] || '00'), FUSO, 'yyyy-MM-dd HH:mm:ss').getTime();
}
function br_(ts) {
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : '';
}

/* ======================= MENU DE SENHAS ======================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Gestão de Serviços')
    .addItem('Definir senha do escritório', 'definirSenhaEscritorio')
    .addItem('Definir senha do operador', 'definirSenhaOperador')
    .addSeparator()
    .addItem('Ver situação das senhas', 'situacaoSenhas')
    .addItem('Remover todas as senhas (deixa o app aberto)', 'removerSenhas')
    .addToUi();
}

function definirSenhaEscritorio() { definirSenha_('SENHA_ESCRITORIO', 'do escritório (acesso a tudo)'); }
function definirSenhaOperador() {
  if (!propriedades_().getProperty('SENHA_ESCRITORIO')) {
    SpreadsheetApp.getUi().alert('Defina primeiro a senha do escritório. Sem ela, o app continuaria aberto para o resto.');
    return;
  }
  definirSenha_('SENHA_OPERADOR', 'do operador (só registra apontamentos)');
}

function definirSenha_(chave, descricao) {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Senha ' + descricao, 'Mínimo de 8 caracteres. Todos os aparelhos que usam esta senha vão pedir a nova na próxima abertura.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const senha = r.getResponseText().trim();
  if (senha.length < 8) { ui.alert('A senha precisa ter pelo menos 8 caracteres. Nada foi alterado.'); return; }
  const outra = chave === 'SENHA_ESCRITORIO' ? 'SENHA_OPERADOR' : 'SENHA_ESCRITORIO';
  if (propriedades_().getProperty(outra) === hashSenha_(senha)) { ui.alert('Use senhas diferentes para escritório e operador. Nada foi alterado.'); return; }
  propriedades_().setProperty(chave, hashSenha_(senha));
  ui.alert('Senha ' + descricao + ' salva. Ela não fica visível em lugar nenhum: se esquecer, defina outra.');
}

function situacaoSenhas() {
  const p = propriedades_();
  SpreadsheetApp.getUi().alert(
    'Escritório: ' + (p.getProperty('SENHA_ESCRITORIO') ? 'definida' : 'NÃO definida (app aberto)') + '\n' +
    'Operador: ' + (p.getProperty('SENHA_OPERADOR') ? 'definida' : 'não definida (celulares usam a do escritório)'));
}

function removerSenhas() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Remover as senhas?', 'Qualquer pessoa com o endereço do Apps Script volta a ler e gravar os dados.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  propriedades_().deleteProperty('SENHA_ESCRITORIO');
  propriedades_().deleteProperty('SENHA_OPERADOR');
  ui.alert('Senhas removidas.');
}

/* ======================= INSTALAÇÃO E MIGRAÇÃO ======================= */

/**
 * Rode pelo editor (selecione "configurar" › Executar) ao instalar e depois de colar uma versão nova.
 * Cria as abas, autoriza o Drive, converte abas no formato antigo e refaz as abas de consulta.
 * Pode rodar quantas vezes quiser: o que já foi convertido não é convertido de novo.
 */
function configurar() {
  const log = migrarPlanilhaAntiga();
  Object.keys(ABAS).forEach(aba_);
  pastaFotos_();
  atualizarPaineis_();
  console.log(log.length ? log.join('\n') : 'Nada para converter. Abas prontas.');
}

/** Normaliza cabeçalho: "Qtd Peças" → "qtdpecas", "Conf: Nº OS" → "confnos". */
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "22/09/2026" + "16:03:59" → "2026-09-22 16:03:59". Aceita também o formato novo. */
function isoDe_(data, hora) {
  data = String(data || '').trim(); hora = String(hora || '').trim();
  let m = data.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  let d;
  if (m) { d = m[1] + '-' + m[2] + '-' + m[3]; hora = hora || m[4] || ''; }
  else {
    m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (!m) return '';
    d = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    hora = hora || m[4] || '';
  }
  const h = hora.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return d + ' ' + (h ? ('0' + h[1]).slice(-2) + ':' + h[2] + ':' + (h[3] || '00') : '00:00:00');
}

const CHECKLIST_ANTIGO = {
  conf_os: 'confnos', conf_cliente: 'confcliente', conf_codigo: 'confcodigo', conf_qtd: 'confqtd', conf_revisao: 'confrevisao',
  dim_medidas: 'dimmedidas', dim_tolerancias: 'dimtolerancias', dim_roscas: 'dimroscasfuros',
  vis_rebarbas: 'visrebarbas', vis_trincas: 'vistrincas', vis_acabamento: 'visacabamento', vis_soldas: 'vissoldas', vis_pintura: 'vispinturatratamento',
  limp_cavacos: 'limpcavacos', limp_oleo: 'limpoleo', limp_pecalimpa: 'limppecalimpa', limp_anticorrosivo: 'limpanticorrosivo',
  doc_relatorio: 'docrelatoriodim', doc_cert_material: 'doccertmaterial', doc_cert_tratamento: 'doccerttratamento', doc_nf: 'docnfconferida',
  emb_protegida: 'embprotegida', emb_identificacao: 'embidentificacao', emb_caixa: 'embcaixapallet',
  lib_conferencia: 'libconferenciafinal', lib_aprovado: 'libaprovadaenvio', lib_foto: 'libfotoconferida'
};

/** Abas do primeiro backend da ESFEUS (cabeçalhos em português) → formato atual. */
const MIGRACOES = [
  { antiga: 'Apontamentos', tipo: 'apontamentos', conv: r => ({
      timestamp: isoDe_(r.data || r.carimbo, r.hora), os: r.os, etapa: r.etapa, cliente: r.cliente, oc: r.oc, descricao: r.descricao,
      operacao: r.operacao, maquina: r.maquina, operador: r.operador, status: r.status, qtd: r.qtdpecas || r.qtd }) },
  { antiga: 'Materiais', tipo: 'materiais', conv: r => ({
      codigo: r.codigo, descricao: r.descricao, especificacao: r.especificacao, unidade: r.unidade, estoqueMinimo: r.estoqueminimo,
      localizacao: r.localizacao, ativo: r.ativo, atualizadoEm: isoDe_(r.atualizadoem) }) },
  { antiga: 'Movimentações', tipo: 'movimentacoes', conv: r => ({
      timestamp: isoDe_(r.data || r.carimbo, r.hora), codigo: r.codigo, tipo: r.tipo, quantidade: r.quantidade, os: r.os,
      loteDimensao: r.lotedimensao, observacao: r.observacao, operador: r.operador }) },
  { antiga: 'Checklist Qualidade', tipo: 'checklists', conv: r => {
      const ts = isoDe_(r.data || r.carimbo, r.hora);
      const marcacoes = {};
      Object.keys(CHECKLIST_ANTIGO).forEach(k => { if (r[CHECKLIST_ANTIGO[k]]) marcacoes[k] = r[CHECKLIST_ANTIGO[k]]; });
      const fotos = [];
      for (let i = 1; i <= 6; i++) {
        const f = r['foto' + i];
        if (!f) continue;
        try { fotos.push(f.indexOf('data:') === 0 ? salvarFoto(f, r.os, ts, i - 1) : f); } catch (e) { console.warn('Foto ' + i + ' da OS ' + r.os + ' não pôde ser salva: ' + e); }
      }
      return { timestamp: ts, os: r.os, cliente: r.cliente, codigoPeca: r.codigopeca, qtd: r.qtd, revisaoDesenho: r.revisaodesenho,
        inspetor: r.inspetor, situacao: r.situacao, observacao: r.observacao, motivoNf: r.motivonf,
        fotos: JSON.stringify(fotos.filter(Boolean)), marcacoes: JSON.stringify(marcacoes) };
    } },
  { antiga: 'Responsáveis', tipo: 'responsaveis', conv: r => ({ nome: r.nome, funcao: r.funcao, ativo: r.ativo, atualizadoEm: isoDe_(r.atualizadoem) }) },
  { antiga: 'Fornecedores', tipo: 'fornecedores', conv: r => ({
      nome: r.nome, tipo: r.tipo, cnpj: r.cnpj, contato: r.contato, observacao: r.observacao, ativo: r.ativo, atualizadoEm: isoDe_(r.atualizadoem) }) }
];

/**
 * Renomeia cada aba antiga para "antigo - <nome>" (nada é apagado) e copia os dados
 * para a aba nova no formato atual. Abas já no formato novo são ignoradas.
 */
function migrarPlanilhaAntiga() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  MIGRACOES.forEach(mg => {
    const velha = ss.getSheetByName(mg.antiga);
    if (!velha || velha.getLastRow() < 1) return;
    const cab = velha.getRange(1, 1, 1, velha.getLastColumn()).getDisplayValues()[0];
    const novoCab = ABAS[mg.tipo].colunas;
    // Já está no formato novo (mesmo nome de aba e mesmas colunas)
    if (mg.antiga === ABAS[mg.tipo].nome && novoCab.every((c, i) => norm_(cab[i]) === norm_(c))) return;
    const chaves = cab.map(norm_);
    const n = velha.getLastRow() - 1;
    const linhas = n > 0 ? velha.getRange(2, 1, n, cab.length).getDisplayValues() : [];
    const objs = linhas
      .filter(l => l.some(v => v !== ''))
      .map(l => mg.conv(chaves.reduce((o, k, i) => (k && o[k] === undefined ? (o[k] = l[i]) : null, o), {})));
    let nomeAntigo = 'antigo - ' + mg.antiga;
    while (ss.getSheetByName(nomeAntigo)) nomeAntigo += ' (2)';
    velha.setName(nomeAntigo);
    const nova = aba_(mg.tipo);
    if (objs.length) {
      const linhasNovas = objs.map(o => SEM_ITEM[mg.tipo] ? separarOsItem_(o) : o).map(o => novoCab.map(c => texto(o[c])));
      nova.getRange(nova.getLastRow() + 1, 1, linhasNovas.length, novoCab.length).setValues(linhasNovas);
    }
    log.push(mg.antiga + ': ' + objs.length + ' linha(s) copiadas para "' + ABAS[mg.tipo].nome + '" (original em "' + nomeAntigo + '")');
  });
  return log;
}
