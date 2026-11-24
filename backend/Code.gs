/**
 * Backend de referência — Gestão de Serviços para Ferramentaria
 * Google Apps Script publicado como Web App.
 *
 * Implementa o contrato descrito em docs/API.md, que é o que o front-end espera.
 * Instalação: veja docs/INSTALACAO.md.
 *
 * Abas de dados (criadas automaticamente na planilha vinculada):
 *   Servicos · Apontamentos · Materiais · Movimentacoes · NotasFiscais · ItensNF · Checklists · Responsaveis · Fornecedores · TiposMaterial
 * Abas de consulta (reescritas a cada gravação, não edite):
 *   Saldos · Análise por OS · Finalizadas · Acompanhamento (todas as OS, com avanço e progresso)
 *   · Cliente <NOME> (uma por cliente em PAINEL_CLIENTES)
 *
 * Senhas: menu "Gestão de Serviços" da planilha (aparece ao recarregar a página).
 *   Escritório → tudo. Operador → só grava apontamentos e lê a lista de responsáveis.
 *   Sem senha definida, o app fica aberto (como nas versões anteriores).
 */

const ABAS = {
  servicos:     { nome: 'Servicos',      colunas: ['id', 'os', 'it', 'cliente', 'oc', 'des', 'desc', 'qty', 'material', 'tratamento', 'emb', 'prazo', 'status', 'nf', 'dt', 'etapas', 'imagem', 'extras', 'atualizadoEm', 'excluido'] },
  apontamentos: { nome: 'Apontamentos',  colunas: ['timestamp', 'os', 'item', 'etapa', 'cliente', 'oc', 'descricao', 'operacao', 'maquina', 'operador', 'status', 'qtd'] },
  materiais:    { nome: 'Materiais',     colunas: ['codigo', 'descricao', 'especificacao', 'unidade', 'estoqueMinimo', 'localizacao', 'ativo', 'atualizadoEm', 'tipo'] },
  tiposMaterial:{ nome: 'TiposMaterial', colunas: ['nome', 'observacao', 'ativo', 'atualizadoEm'] },
  // As 8 primeiras colunas são as originais; as demais (1.5) são acrescentadas no fim das abas existentes.
  movimentacoes:{ nome: 'Movimentacoes', colunas: ['timestamp', 'codigo', 'tipo', 'quantidade', 'os', 'loteDimensao', 'observacao', 'operador',
                  'id', 'cliente', 'valorUnitario', 'valorTotal', 'nf', 'nfId', 'itemNfId', 'origem', 'fornecedor', 'excluido', 'atualizadoEm'] },
  notas:        { nome: 'NotasFiscais',  colunas: ['id', 'numero', 'data', 'fornecedor', 'os', 'clientes', 'observacao', 'criadoEm', 'atualizadoEm', 'excluido'] },
  itensNf:      { nome: 'ItensNF',       colunas: ['id', 'nfId', 'descricao', 'codigo', 'unidade', 'quantidade', 'valorUnitario', 'frete', 'valorTotal',
                  'os', 'cliente', 'tipo', 'dataMovimentacao', 'observacao', 'atualizadoEm', 'excluido'] },
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

/**
 * Clientes que recebem uma aba de acompanhamento ("Cliente COMAU"), refeita a cada gravação.
 * A planilha que o cliente vê puxa essa aba com IMPORTRANGE (veja docs/PAINEL_CLIENTE.md).
 */
const PAINEL_CLIENTES = ['COMAU'];

/** Pasta do Drive onde as fotos dos checklists e das peças são gravadas. */
const PASTA_FOTOS = 'Gestão de Serviços - Fotos de Qualidade';
const FUSO = Session.getScriptTimeZone() || 'America/Sao_Paulo';
const TIPOS_SAIDA = ['Consumo na OS', 'Retirada do estoque para OS', 'Perda / descarte', 'Ajuste de saída'];
/** Registram a compra/uso mas não mexem no saldo (material comprado direto para a OS, despesas). */
const TIPOS_NEUTROS = ['Compra direta para OS', 'Outros (sem efeito no estoque)'];
function fator_(tipo) { return TIPOS_NEUTROS.indexOf(tipo) >= 0 ? 0 : (TIPOS_SAIDA.indexOf(tipo) >= 0 ? -1 : 1); }
const VERSAO = '1.5.1';

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
/** Leituras públicas: o que já vai impresso na etiqueta do cliente, pelo código do QR. */
/**
 * Liberado sem senha: etiqueta do cliente e o QR do chão de fábrica
 * (o operador lê o QR e registra o apontamento sem digitar senha).
 */
const PUBLICO = { get: ['etiqueta', 'recursos', 'list-responsaveis'], post: ['apontamentos'] };

function verificarAcesso_(e, metodo, acao) {
  if (PUBLICO[metodo].indexOf(acao) >= 0) return null;
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
      case 'list-movimentacoes': return json({ ok: true, movimentacoes: listarMovimentacoes_() });
      case 'list-nfs':           return json({ ok: true, nfs: listarNfs_() });
      case 'list-checklists':    return json({ ok: true, checklists: listarChecklists() });
      case 'list-responsaveis':  return json({ ok: true, responsaveis: listarAtivos('responsaveis') });
      case 'list-fornecedores':  return json({ ok: true, fornecedores: listarAtivos('fornecedores') });
      case 'list-tipos-material': return json({ ok: true, tipos: listarAtivos('tiposMaterial') });
      case 'versao':             return json({ ok: true, versao: VERSAO, servicos: true, item: true, etiqueta: true, nfs: true, nivel: nivelDe_(e.parameter.k) });
      case 'recursos':           return json({ ok: true, versao: VERSAO, etiqueta: true, nfs: true, tiposMaterial: true });
      case 'etiqueta':           return json(etiquetaPorCodigo_(e.parameter.t));
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
        case 'material':     resposta.material = gravarMaterial_(body); break;
        case 'excluir-material': Object.assign(resposta, excluirMaterial_(body)); break;
        case 'movimentacao': resposta.movimentacao = gravarMovimentacao_(body); break;
        case 'nf':           Object.assign(resposta, gravarNf_(body)); break;
        case 'excluir-nf':   Object.assign(resposta, excluirNf_(body)); break;
        case 'checklist':    gravarChecklist(body); break;
        case 'responsavel':  upsert('responsaveis', 'nome', body, { atualizadoEm: agora() }); break;
        case 'fornecedor':   upsert('fornecedores', 'nome', body, { atualizadoEm: agora() }); break;
        case 'tipo-material': upsert('tiposMaterial', 'nome', body, { atualizadoEm: agora() }); break;
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

/* ======================= ETIQUETA DO CLIENTE ======================= */

/**
 * QR do cliente com link curto (só um código): devolve os dados da etiqueta daquela OS.
 * Público de propósito: são os mesmos dados impressos na etiqueta. O código é aleatório (campo "qr").
 */
function etiquetaPorCodigo_(codigo) {
  const t = String(codigo || '').trim();
  if (!/^[a-z0-9]{6,16}$/.test(t)) return { ok: false, erro: 'Código inválido.' };
  const s = listarServicos().find(x => !x.excluido && String(x.qr || '') === t);
  if (!s) return { ok: false, erro: 'Etiqueta não encontrada.' };
  const br = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  let status = s.status || 'Em processo';
  if (status !== 'Finalizado' && s.prazo && s.prazo < hoje) status = 'Atrasado';
  return { ok: true, etiqueta: {
    cliente: s.cliente, os: s.os, it: s.it, oc: s.oc, qty: s.qty, desc: s.desc, des: s.des, material: s.material,
    tratamento: s.tratamento, emb: s.emb, nf: s.nf, dt: br(s.dt), status: status } };
}

/** Completa cliente/OC/descrição do apontamento pela OS (o QR interno só leva OS e item). */
function completarApontamentos_(lista) {
  if (!lista.some(a => !a.cliente || !a.descricao)) return lista;
  const porOS = {};
  listarServicos().forEach(s => { if (!s.excluido) porOS[(s.os || '') + '/' + (s.it || '')] = s; });
  return lista.map(a => {
    const s = porOS[(a.os || '') + '/' + (a.item || '')];
    if (!s) return a;
    return Object.assign({}, a, { cliente: a.cliente || s.cliente, oc: a.oc || s.oc, descricao: a.descricao || s.desc });
  });
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
    novos.splice(0, novos.length, ...completarApontamentos_(novos));
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
  try { atualizarFinalizadas_(); } catch (err) { console.warn('Finalizadas: ' + err); }
  try { atualizarPaineisClientes_(); } catch (err) { console.warn('Painel cliente: ' + err); }
}

/* ---------- Status da OS (mesma regra do app) ---------- */
function semAcento_(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function statusOS_(s, hoje) {
  const etapas = Array.isArray(s.etapas) ? s.etapas : [];
  const fin = etapas.find(e => semAcento_(e.nome).indexOf('inspecao final') >= 0);
  const aprovada = fin ? fin.status === 'OK' : s.status === 'Finalizado';
  if (etapas.length ? aprovada : s.status === 'Finalizado') return 'Finalizado';
  if (s.status === 'Expedição') return 'Expedição';
  const dias = s.prazo ? Math.round((Date.UTC(+s.prazo.slice(0, 4), s.prazo.slice(5, 7) - 1, +s.prazo.slice(8, 10)) - Date.UTC(+hoje.slice(0, 4), hoje.slice(5, 7) - 1, +hoje.slice(8, 10))) / 86400000) : null;
  if (dias !== null && dias < 0) return 'Atrasado';
  const ativa = e => e.status === 'Em andamento' || e.status === 'Parada';
  if (etapas.some(e => semAcento_(e.nome).indexOf('terceiriz') >= 0 && ativa(e)) || s.status === 'Externo com terceiros') return 'Externo com terceiros';
  const iniciou = etapas.some(e => ativa(e) || e.status === 'OK');
  if (!iniciou && (s.status || 'Aguardando') === 'Aguardando') return 'Aguardando';
  return dias !== null && dias <= 7 ? 'Alerta' : 'Em processo';
}
function pctEtapa_(e) {
  if (e.status === 'OK' || e.status === 'N.A.' || e.status === 'Concluída') return 100;
  if (e.status === 'Em andamento' || e.status === 'Parada') return Math.min(99, Math.max(0, Number(e.percentual) || 0));
  return 0;
}

/* ---------- Datas e ordenação dos painéis ---------- */
/** Aceita '2026-11-16', '16/11/2026' ou Date e devolve 'yyyy-MM-dd' (ou ''). */
function isoData_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  const t = String(v || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}
/** Data de verdade para a célula (a planilha formata como dd/mm/aaaa). */
function celulaData_(v) {
  const iso = isoData_(v);
  return iso ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : '';
}
/** "001-51" antes de "001-212"; "CO 26.004" antes de "CO 26.005". */
function compararNatural_(a, b) {
  const pa = String(a || '').match(/\d+|\D+/g) || [], pb = String(b || '').match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    const c = nx && ny ? Number(x) - Number(y) : x.localeCompare(y, 'pt-BR');
    if (c) return c;
  }
  return 0;
}
/** Situação mais urgente primeiro: é a que aparece na linha da OS. */
const GRAVIDADE_STATUS = ['Atrasado', 'Alerta', 'Externo com terceiros', 'Em processo', 'Expedição', 'Aguardando', 'Finalizado'];

/**
 * Aba "Acompanhamento" (todas as OS) e abas "Cliente <NOME>".
 * Na aba do cliente as peças ficam agrupadas por OS: uma linha-título por OS (OS preenchida, Item vazio)
 * com o resumo, e logo abaixo os itens em ordem. A planilha do cliente puxa essa aba com IMPORTRANGE
 * e pinta as linhas com a formatação aplicada por formatarPlanilhasClientes().
 */
function atualizarPaineisClientes_() {
  const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd');
  const todas = listarServicos().filter(s => !s.excluido).map(s => {
    s.prazo = isoData_(s.prazo) || s.prazo;
    s._st = statusOS_(s, hoje);
    return s;
  });
  const etapasDe = lista => {
    const nomes = [];
    lista.forEach(s => (s.etapas || []).forEach(e => { if (e.nome && nomes.indexOf(e.nome) < 0) nomes.push(e.nome); }));
    return nomes;
  };
  const avancoDe = s => {
    const etapas = s.etapas || [];
    return etapas.length ? etapas.reduce((t, e) => t + pctEtapa_(e), 0) / etapas.length / 100 : (s._st === 'Finalizado' ? 1 : 0);
  };
  const barra = v => { const n = Math.round(v * 10); return '█'.repeat(n) + '░'.repeat(10 - n); };
  const celulaEtapa = e => {
    if (!e) return '—';
    if (e.status === 'Em andamento' || e.status === 'Parada') return e.status + ' ' + pctEtapa_(e) + '%';
    return e.status === 'Concluída' ? 'OK' : (e.status || 'Pendente');
  };
  const linhaItem = (s, nomesEtapas) => {
    const porNome = {}; (s.etapas || []).forEach(e => { porNome[e.nome] = e; });
    const av = avancoDe(s);
    return [s.os, s.it || '—', s.oc, s.desc || s.des || '', s.qty, celulaData_(s.prazo), s._st]
      .concat(nomesEtapas.map(n => celulaEtapa(porNome[n])))
      .concat([av, barra(av), celulaData_(s.dt), s.nf]);
  };
  const ordemItens = (a, b) => compararNatural_(a.os, b.os) || compararNatural_(a.it, b.it);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ----- Acompanhamento: uma linha por item, por cliente → OS → item -----
  const nomesTodas = etapasDe(todas);
  const geral = todas.slice().sort((a, b) => String(a.cliente || '').localeCompare(String(b.cliente || ''), 'pt-BR') || ordemItens(a, b));
  const cabGeral = ['Cliente', 'OS', 'Item', 'Pedido / Projeto', 'Descrição da Peça', 'Qtd', 'Prazo', 'Status Geral']
    .concat(nomesTodas.map((n, i) => (i + 1) + '. ' + n)).concat(['Avanço (%)', 'Progresso', 'Entrega', 'NF']);
  const linhasGeral = geral.map(s => [s.cliente].concat(linhaItem(s, nomesTodas)));
  escreverPainel_('Acompanhamento', cabGeral, linhasGeral);
  formatarColunasPainel_(ss.getSheetByName('Acompanhamento'), 1, cabGeral, linhasGeral.length);

  // ----- Uma aba por cliente, agrupada por OS -----
  PAINEL_CLIENTES.forEach(cliente => {
    // O cliente não vê o "Alerta" (prazo em até 7 dias): para ele o item segue "Em processo"
    const lista = todas.filter(s => String(s.cliente || '').trim().toUpperCase() === cliente.toUpperCase())
      .map(s => Object.assign({}, s, { _st: s._st === 'Alerta' ? 'Em processo' : s._st }));
    const nomesEtapas = etapasDe(lista); // só as etapas que as OS deste cliente têm
    const grupos = {};
    lista.forEach(s => { (grupos[s.os] = grupos[s.os] || []).push(s); });
    const ordemOS = Object.keys(grupos).sort((a, b) => {
      const fa = grupos[a].every(s => s._st === 'Finalizado'), fb = grupos[b].every(s => s._st === 'Finalizado');
      return (fa - fb) || compararNatural_(a, b); // OS inteiramente finalizadas vão para o fim
    });
    const linhas = [];
    ordemOS.forEach(os => {
      const itens = grupos[os].sort(ordemItens);
      const n = itens.length;
      const pior = itens.map(s => s._st).sort((a, b) => {
        const ia = GRAVIDADE_STATUS.indexOf(a), ib = GRAVIDADE_STATUS.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })[0];
      const prazos = itens.map(s => s.prazo).filter(Boolean).sort();
      const pedidos = itens.map(s => s.oc).filter((v, i, arr) => v && arr.indexOf(v) === i);
      const avMedio = itens.reduce((t, s) => t + avancoDe(s), 0) / n;
      const resumoEtapas = nomesEtapas.map(nome => {
        const comEtapa = itens.filter(s => (s.etapas || []).some(e => e.nome === nome));
        if (!comEtapa.length) return '—';
        const prontos = comEtapa.filter(s => (s.etapas || []).some(e => e.nome === nome && pctEtapa_(e) === 100)).length;
        return prontos + '/' + comEtapa.length + ' OK';
      });
      linhas.push([os, '', pedidos.join(' · '), n + (n === 1 ? ' item' : ' itens'), '', celulaData_(prazos[0]), pior]
        .concat(resumoEtapas).concat([avMedio, barra(avMedio), '', '']));
      itens.forEach(s => linhas.push(linhaItem(s, nomesEtapas)));
    });
    const cab = ['OS', 'Item', 'Pedido / Projeto', 'Descrição da Peça', 'Qtd', 'Prazo', 'Status Geral']
      .concat(nomesEtapas.map((n, i) => (i + 1) + '. ' + n)).concat(['Avanço (%)', 'Progresso', 'Entrega', 'NF']);
    // O cliente não vê a coluna "Status Geral"
    const semStatus = l => l.filter((v, i) => i !== 6);
    const nomeAba = 'Cliente ' + cliente;
    escreverPainel_(nomeAba, semStatus(cab), linhas.map(semStatus));
    formatarColunasPainel_(ss.getSheetByName(nomeAba), 1, semStatus(cab), linhas.length);
  });
}

/** Formato numérico das colunas de avanço e datas (o cabeçalho diz qual coluna é qual). */
function formatarColunasPainel_(sh, linhaCab, cab, qtd) {
  if (!sh) return;
  const linhas = Math.max(qtd, 1);
  cab.forEach((c, i) => {
    const r = sh.getRange(linhaCab + 1, i + 1, linhas, 1);
    if (c === 'Avanço (%)') r.setNumberFormat('0%');
    else if (c === 'Prazo' || c === 'Entrega') r.setNumberFormat('dd/mm/yyyy');
  });
}

/* ---------- Planilha que o cliente vê ---------- */

/**
 * Planilhas dos clientes (ID da planilha do Google). Cada uma puxa a aba "Cliente <NOME>" com IMPORTRANGE
 * na linha 4. Depois de mudar algo aqui, rode formatarPlanilhasClientes() uma vez pelo menu.
 */
const PLANILHAS_CLIENTES = { COMAU: '1QF3AYDIVGhCCTN_ZbJaaeN1PVFggWMaLPRpWJsfEhsI' };

/**
 * Menu › "Formatar planilha do cliente". Rode uma vez (e de novo se as etapas mudarem):
 * fórmula IMPORTRANGE, indicadores do topo, cores por situação, linha-título de cada OS e larguras.
 * Na primeira vez o Google pede autorização para abrir a planilha do cliente.
 */
function formatarPlanilhasClientes() {
  atualizarPaineisClientes_();
  const idFerramenta = SpreadsheetApp.getActiveSpreadsheet().getId();
  const feitos = [];
  Object.keys(PLANILHAS_CLIENTES).forEach(cliente => {
    const origem = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cliente ' + cliente);
    if (!origem) return;
    const cab = origem.getRange(1, 1, 1, origem.getLastColumn()).getValues()[0];
    const sh = SpreadsheetApp.openById(PLANILHAS_CLIENTES[cliente]).getSheets()[0];
    formatarPlanilhaCliente_(sh, cab, idFerramenta, 'Cliente ' + cliente);
    feitos.push(cliente);
  });
  try { SpreadsheetApp.getUi().alert('Planilha formatada: ' + (feitos.join(', ') || 'nenhuma')); } catch (e) { console.log(feitos); }
}

function formatarPlanilhaCliente_(sh, cab, idFerramenta, aba) {
  const L0 = 4;                       // linha do cabeçalho
  const nCol = cab.length;
  const letra = c => { let s = ''; for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
  const ult = letra(nCol);
  const col = nome => cab.indexOf(nome) + 1;
  const cAv = col('Avanço (%)');
  const primeiraEtapa = col('Prazo') + 1, ultimaEtapa = cAv - 1;
  const maxLin = Math.max(sh.getMaxRows(), 1000);
  if (sh.getMaxRows() < maxLin) sh.insertRowsAfter(sh.getMaxRows(), maxLin - sh.getMaxRows());
  if (sh.getMaxColumns() < nCol) sh.insertColumnsAfter(sh.getMaxColumns(), nCol - sh.getMaxColumns());

  // Dados: limpa a área e põe o IMPORTRANGE
  sh.getRange(L0, 1, maxLin - L0 + 1, sh.getMaxColumns()).clearContent().clearFormat();
  sh.getRange(L0, 1).setFormula('=IMPORTRANGE("' + idFerramenta + '";"' + aba + '!A1:' + ult + '")');

  // Indicadores do topo (só linhas de item: Item preenchido)
  const A = letra(cAv);
  sh.getRange('B2').setFormula('=COUNTIF(B' + (L0 + 1) + ':B;"<>")');
  sh.getRange('E2').setFormula('=COUNTIFS(B' + (L0 + 1) + ':B;"<>";' + A + (L0 + 1) + ':' + A + ';"<1")');
  sh.getRange('H2').setFormula('=COUNTIFS(B' + (L0 + 1) + ':B;"<>";' + A + (L0 + 1) + ':' + A + ';">=1")');
  sh.getRange('K2').setFormula('=IFERROR(AVERAGEIFS(' + A + (L0 + 1) + ':' + A + ';B' + (L0 + 1) + ':B;"<>");0)').setNumberFormat('0.0%');
  sh.getRange('H3').setValue('Itens finalizados');
  sh.getRange('E3').setValue('Itens ainda em fabricação');

  // Cabeçalho
  sh.getRange(L0, 1, 1, nCol).setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true).setFontSize(9);
  sh.setRowHeight(L0, 42);
  sh.setFrozenRows(L0);
  sh.setFrozenColumns(1); // B:D tem células mescladas nos indicadores

  // Corpo
  const corpo = sh.getRange(L0 + 1, 1, maxLin - L0, nCol);
  corpo.setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(false)
    .setBorder(null, null, true, null, true, false, '#e6e9ef', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(L0 + 1, col('Descrição da Peça'), maxLin - L0, 1).setHorizontalAlignment('left');
  sh.getRange(L0 + 1, col('Pedido / Projeto'), maxLin - L0, 1).setHorizontalAlignment('left');
  sh.getRange(L0 + 1, cAv, maxLin - L0, 1).setNumberFormat('0%').setFontWeight('bold');
  ['Prazo', 'Entrega'].forEach(n => { if (col(n)) sh.getRange(L0 + 1, col(n), maxLin - L0, 1).setNumberFormat('dd/mm/yyyy'); });
  sh.getRange(L0 + 1, col('Progresso'), maxLin - L0, 1).setFontFamily('Consolas').setFontColor('#2e7d32').setHorizontalAlignment('left');

  // Larguras
  const larg = { 'OS': 88, 'Item': 70, 'Pedido / Projeto': 120, 'Descrição da Peça': 260, 'Qtd': 70, 'Prazo': 82,
    'Avanço (%)': 72, 'Progresso': 110, 'Entrega': 82, 'NF': 70 };
  cab.forEach((c, i) => sh.setColumnWidth(i + 1, larg[c] || 92));

  // Cores (formatação condicional: vale para o que o IMPORTRANGE trouxer)
  const F = SpreadsheetApp.newConditionalFormatRule;
  const linha = L0 + 1;
  const tudo = sh.getRange(linha, 1, maxLin - L0, nCol);
  const etapas = ultimaEtapa >= primeiraEtapa ? sh.getRange(linha, primeiraEtapa, maxLin - L0, ultimaEtapa - primeiraEtapa + 1) : null;
  const regras = [
    // Linha-título da OS (OS preenchida e Item vazio) — vem primeiro para valer sobre as outras cores
    F().whenFormulaSatisfied('=AND($A' + linha + '<>"";$B' + linha + '="")').setBackground('#dbe4f3').setFontColor('#1f3864').setBold(true).setRanges([tudo]).build(),
  ];
  const cor = (rng, regra, fundo, fonte) => rng && regras.push(regra.setBackground(fundo).setFontColor(fonte).setRanges([rng]).build());
  // Etapas
  cor(etapas, F().whenTextEqualTo('OK'), '#c8e6c9', '#1b5e20');
  cor(etapas, F().whenTextStartsWith('Em andamento'), '#fff3c4', '#7a5b00');
  cor(etapas, F().whenTextStartsWith('Parada'), '#ffcdd2', '#b71c1c');
  cor(etapas, F().whenTextEqualTo('N.A.'), '#f1f3f4', '#9aa0a6');
  cor(etapas, F().whenTextEqualTo('Pendente'), '#ffffff', '#b0b4ba');
  cor(etapas, F().whenTextEqualTo('—'), '#ffffff', '#d0d3d8');
  sh.setConditionalFormatRules(regras);
}

/** OS finalizadas (inspeção aprovada no app ou entregues antes dele), da entrega mais recente para a mais antiga. */
function atualizarFinalizadas_() {
  const dia = t => { const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : null; };
  const br = t => { const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  const lista = listarServicos().filter(s => !s.excluido && s.status === 'Finalizado')
    .sort((a, b) => String(b.dt || b.prazo).localeCompare(String(a.dt || a.prazo)));
  const linhas = lista.map(s => {
    const p = dia(s.prazo), e = dia(s.dt);
    return [s.cliente, s.oc, s.os, s.it, s.des, s.desc, s.qty, s.material, s.tratamento, br(s.prazo), br(s.dt), s.nf,
      p !== null && e !== null ? Math.round((p - e) / 86400000) : '', s.obs || ''];
  });
  escreverPainel_('Finalizadas',
    ['Cliente', 'Pedido (OC)', 'OS', 'Item', 'Desenho', 'Descrição', 'Qtd', 'Material', 'Tratamento', 'Prazo', 'Entrega', 'NF', 'Prazo x Entrega (dias)', 'Obs.'],
    linhas);
}

function atualizarSaldos_() {
  const movs = listarMovimentacoes_();
  const saldo = saldos_(movs);
  const custo = {};   // valor médio ponderado e último valor de aquisição (entradas com valor)
  movs.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).forEach(m => {
    const k = chaveCodigo_(m.codigo), vu = numero(m.valorUnitario), q = numero(m.quantidade);
    if (!k || fator_(m.tipo) <= 0 || vu <= 0 || q <= 0) return;
    const c = custo[k] || (custo[k] = { q: 0, v: 0, ultimo: 0 });
    c.q += q; c.v += q * vu; c.ultimo = vu;
  });
  const linhas = listarMateriais().map(m => {
    const k = chaveCodigo_(m.codigo), s = saldo[k] || 0, c = custo[k];
    const alerta = s <= 0 ? 'Zerado' : (s < m.estoqueMinimo ? 'Abaixo do mínimo' : '');
    return [m.codigo, m.descricao, m.tipo || '', m.unidade, s, m.estoqueMinimo, alerta,
      c ? Math.round(c.v / c.q * 100) / 100 : '', c ? c.ultimo : '', m.localizacao, m.ativo ? 'Sim' : 'Não'];
  });
  escreverPainel_('Saldos', ['Código', 'Descrição', 'Tipo de material', 'Unidade', 'Saldo', 'Estoque mínimo', 'Alerta', 'Valor médio (R$)', 'Último valor (R$)', 'Localização', 'Ativo'], linhas);
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
  } else if (!colunaItemConferida_[tipo]) {
    if (SEM_ITEM[tipo]) incluirColunaItem_(sh, tipo);
    acrescentarColunasNovas_(sh, tipo);
  }
  colunaItemConferida_[tipo] = true;
  return sh;
}

const colunaItemConferida_ = {};

/**
 * Aba antiga com menos colunas que a versão atual (ex.: Movimentacoes antes da 1.5):
 * acrescenta os cabeçalhos que faltam no fim, sem mexer nos dados. Só age se as
 * colunas existentes forem exatamente o começo da lista atual.
 */
function acrescentarColunasNovas_(sh, tipo) {
  const cols = ABAS[tipo].colunas;
  const ult = Math.max(1, sh.getLastColumn());
  const cab = sh.getRange(1, 1, 1, ult).getDisplayValues()[0];
  while (cab.length && cab[cab.length - 1] === '') cab.pop();
  if (cab.length >= cols.length || !cab.every((c, i) => c === cols[i])) return;
  const faltam = cols.slice(cab.length);
  sh.getRange(1, cab.length + 1, 1, faltam.length).setValues([faltam]).setFontWeight('bold');
  sh.getRange(1, cab.length + 1, sh.getMaxRows(), faltam.length).setNumberFormat('@');
}

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

/* ======================= MATERIAIS ======================= */

/** Linhas (base 2) da aba cujo valor na coluna-chave bate com algum dos códigos (sem diferenciar maiúsculas). */
function linhasPorChave_(tipo, colChave, codigos) {
  const sh = aba_(tipo);
  const idx = ABAS[tipo].colunas.indexOf(colChave);
  const alvos = codigos.map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
  const n = sh.getLastRow() - 1;
  if (n < 1 || !alvos.length) return [];
  return sh.getRange(2, idx + 1, n, 1).getDisplayValues()
    .map((l, i) => alvos.indexOf(String(l[0]).trim().toUpperCase()) >= 0 ? i + 2 : 0)
    .filter(Boolean);
}

/** Apaga linhas de baixo para cima (para os índices não mudarem no meio). */
function apagarLinhas_(tipo, linhas) {
  const sh = aba_(tipo);
  linhas.slice().sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

/**
 * Grava o material numa única linha. Se o código mudou (codigoAnterior), atualiza a
 * linha antiga em vez de criar outra e leva as movimentações para o código novo.
 * Linhas repetidas do mesmo código são removidas, ficando só uma.
 */
function gravarMaterial_(body) {
  const codigo = String(body.codigo || '').trim();
  if (!codigo) throw new Error('Campo "codigo" é obrigatório.');
  const anterior = String(body.codigoAnterior || '').trim();
  const renomeou = anterior && anterior.toUpperCase() !== codigo.toUpperCase();
  if (renomeou && linhasPorChave_('materiais', 'codigo', [codigo]).length && linhasPorChave_('materiais', 'codigo', [anterior]).length) {
    throw new Error('Já existe outro material com o código ' + codigo + '.');
  }
  const cols = ABAS.materiais.colunas;
  const dados = Object.assign({}, body, { codigo: codigo, atualizadoEm: agora() });
  const linha = cols.map(c => texto(dados[c]));
  const linhas = linhasPorChave_('materiais', 'codigo', renomeou ? [anterior, codigo] : [codigo]);
  const sh = aba_('materiais');
  if (!linhas.length) { sh.appendRow(linha); return { codigo: codigo }; }
  sh.getRange(linhas[0], 1, 1, cols.length).setValues([linha]);
  apagarLinhas_('materiais', linhas.slice(1));
  if (renomeou) renomearCodigoMovimentos_(anterior, codigo);
  return { codigo: codigo, duplicadasRemovidas: linhas.length - 1 };
}

function renomearCodigoMovimentos_(de, para) {
  ['movimentacoes', 'itensNf'].forEach(tipo => {
    const linhas = linhasPorChave_(tipo, 'codigo', [de]);
    if (!linhas.length) return;
    const sh = aba_(tipo);
    const col = ABAS[tipo].colunas.indexOf('codigo') + 1;
    linhas.forEach(r => sh.getRange(r, col).setValue(para));
  });
}

/**
 * Sem movimentações: apaga o material da planilha (todas as linhas do código).
 * Com movimentações: não apaga (o saldo e o histórico dependem dele); deixa uma
 * linha só, marcada como inativa.
 */
function excluirMaterial_(body) {
  const codigo = String(body.codigo || '').trim();
  if (!codigo) throw new Error('Campo "codigo" é obrigatório.');
  const linhas = linhasPorChave_('materiais', 'codigo', [codigo]);
  if (!linhas.length) return { removido: true };
  const k = chaveCodigo_(codigo);
  if (!listarMovimentacoes_().some(m => chaveCodigo_(m.codigo) === k)) {
    apagarLinhas_('materiais', linhas);
    return { removido: true };
  }
  const sh = aba_('materiais');
  const cols = ABAS.materiais.colunas;
  sh.getRange(linhas[0], cols.indexOf('ativo') + 1).setValue('FALSE');
  sh.getRange(linhas[0], cols.indexOf('atualizadoEm') + 1).setValue(agora());
  apagarLinhas_('materiais', linhas.slice(1));
  return { inativado: true };
}

function pastaFotos_() {
  const it = DriveApp.getFoldersByName(PASTA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PASTA_FOTOS);
}


/* ======================= NOTAS FISCAIS E MOVIMENTAÇÕES (1.5) ======================= */
/*
 * A NF é o registro principal: cada NF tem vários itens e cada item tem OS, cliente e tipo próprios.
 * Os itens que mexem no estoque (ou que registram compra direta para a OS) geram UMA movimentação
 * cada, identificada pelo id do item (itemNfId). Editar a NF regrava essa mesma linha; remover o item
 * marca a movimentação como excluída. Assim o saldo nunca duplica.
 * Material retirado do estoque não tem NF: a movimentação leva origem "SEM NF - MATERIAL DO ESTOQUE".
 */

/** Tipo do item da NF → tipo da movimentação gerada (null = não gera) e se exige material de estoque. */
const TIPOS_ITEM_NF = {
  'Compra para estoque':            { mov: 'Compra para estoque', estoque: true },
  'Entrada em estoque':             { mov: 'Entrada em estoque', estoque: true },
  'Consumo direto na OS':           { mov: 'Compra direta para OS', estoque: false, exigeOS: true },
  'Outros (sem efeito no estoque)': { mov: 'Outros (sem efeito no estoque)', estoque: false }
};
const ORIGEM_SEM_NF = 'SEM NF - MATERIAL DO ESTOQUE';

function chaveCodigo_(c) { return String(c || '').trim().toUpperCase(); }
function chaveTexto_(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); }
function excluido_(r) { return String(r.excluido).toUpperCase() === 'TRUE'; }
function arred2_(n) { return Math.round(n * 100) / 100; }
function novoId_(prefixo) { return prefixo + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }

/** Movimentações válidas (as excluídas ficam na planilha só para auditoria). */
function listarMovimentacoes_() {
  return lerTudo('movimentacoes').filter(m => !excluido_(m)).map(m => Object.assign(m, {
    quantidade: numero(m.quantidade), valorUnitario: numero(m.valorUnitario), valorTotal: numero(m.valorTotal)
  }));
}

function saldos_(movs) {
  const saldo = {};
  movs.forEach(m => {
    const k = chaveCodigo_(m.codigo);
    if (k) saldo[k] = (saldo[k] || 0) + numero(m.quantidade) * fator_(m.tipo);
  });
  return saldo;
}

/** Lê a aba devolvendo cada linha com o número dela na planilha (_linha). */
function lerComLinhas_(tipo) {
  const sh = aba_(tipo);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const cols = ABAS[tipo].colunas;
  return sh.getRange(2, 1, n, cols.length).getDisplayValues()
    .map((l, i) => { const o = cols.reduce((acc, c, j) => (acc[c] = l[j], acc), {}); o._linha = i + 2; return o; })
    .filter(o => ABAS[tipo].colunas.some(c => o[c] !== ''));
}

/** Grava objetos: os que têm _linha sobrescrevem a linha; os outros vão para o fim, de uma vez. */
function gravarObjetos_(tipo, objetos) {
  const sh = aba_(tipo);
  const cols = ABAS[tipo].colunas;
  const novos = [];
  objetos.forEach(o => {
    const linha = cols.map(c => texto(o[c]));
    if (o._linha) sh.getRange(o._linha, 1, 1, cols.length).setValues([linha]); else novos.push(linha);
  });
  if (novos.length) sh.getRange(sh.getLastRow() + 1, 1, novos.length, cols.length).setValues(novos);
}

function listarNfs_() {
  const itens = {};
  lerTudo('itensNf').forEach(it => {
    if (excluido_(it)) return;
    (itens[it.nfId] = itens[it.nfId] || []).push(montarItemNf_(it));
  });
  return lerTudo('notas').filter(n => !excluido_(n)).map(n => montarNf_(n, itens[n.id] || []));
}

function montarNf_(n, itens) {
  return { id: n.id, numero: n.numero, data: n.data, fornecedor: n.fornecedor, os: parse(n.os, []), clientes: parse(n.clientes, []),
    observacao: n.observacao, criadoEm: n.criadoEm, atualizadoEm: n.atualizadoEm, itens: itens };
}
function montarItemNf_(it) {
  return { id: it.id, nfId: it.nfId, descricao: it.descricao, codigo: it.codigo, unidade: it.unidade, quantidade: numero(it.quantidade),
    valorUnitario: numero(it.valorUnitario), frete: numero(it.frete), valorTotal: numero(it.valorTotal), os: it.os, cliente: it.cliente,
    tipo: it.tipo, dataMovimentacao: it.dataMovimentacao, observacao: it.observacao };
}

/** Próximo código automático de material: MAT-0001, MAT-0002… */
function proximoCodigoMaterial_(usados) {
  let max = 0;
  Object.keys(usados).forEach(c => { const m = c.match(/^MAT-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return 'MAT-' + String(max + 1).padStart(4, '0');
}

/**
 * Acha o material do item (pelo código ou pela descrição). Itens que entram no estoque e não
 * têm material cadastrado criam o cadastro sozinhos: o usuário não precisa cadastrar antes.
 */
function resolverMateriais_(itens, movsDoItem) {
  const sh = aba_('materiais');
  const cols = ABAS.materiais.colunas;
  const lista = lerComLinhas_('materiais');
  const porCodigo = {}, porDescricao = {};
  lista.forEach(m => { porCodigo[chaveCodigo_(m.codigo)] = m; if (!porDescricao[chaveTexto_(m.descricao)]) porDescricao[chaveTexto_(m.descricao)] = m; });
  const criados = [], reativar = [];
  itens.forEach(it => {
    const regra = TIPOS_ITEM_NF[it.tipo];
    let m = it.codigo ? porCodigo[chaveCodigo_(it.codigo)] : null;
    // Código que não existe mais (material renomeado com a NF aberta): fica com o material já gravado para o item
    if (!m && movsDoItem && movsDoItem[it.id]) m = porCodigo[chaveCodigo_(movsDoItem[it.id])] || null;
    if (!m) m = porDescricao[chaveTexto_(it.descricao)] || null;
    if (!m && regra.estoque) {
      m = { codigo: proximoCodigoMaterial_(porCodigo),
            descricao: it.descricao, especificacao: '', unidade: it.unidade || 'unidade', estoqueMinimo: '0', localizacao: '', ativo: 'TRUE', atualizadoEm: agora() };
      porCodigo[chaveCodigo_(m.codigo)] = m; porDescricao[chaveTexto_(m.descricao)] = m;
      criados.push(m);
    } else if (m && regra.estoque && !bool(m.ativo) && reativar.indexOf(m) < 0) {
      m.ativo = 'TRUE'; m.atualizadoEm = agora(); reativar.push(m);
    }
    it.codigo = m ? m.codigo : '';
    if (m && !it.unidade) it.unidade = m.unidade;
  });
  // Só grava depois que a NF passar na conferência de saldo
  return {
    codigos: criados.map(m => m.codigo),
    gravar: () => {
      if (criados.length) sh.getRange(sh.getLastRow() + 1, 1, criados.length, cols.length).setValues(criados.map(m => cols.map(c => texto(m[c]))));
      if (reativar.length) gravarObjetos_('materiais', reativar);
    }
  };
}

/** Confere que nenhum material fica com saldo negativo depois de trocar as movimentações. */
function conferirSaldos_(todas, sairao, entrarao) {
  const ids = {};
  sairao.forEach(m => { ids[m.id || ('L' + m._linha)] = true; });
  const restantes = todas.filter(m => !ids[m.id || ('L' + m._linha)]);
  const antes = saldos_(todas), depois = saldos_(restantes.concat(entrarao));
  const afetados = {};
  sairao.concat(entrarao).forEach(m => { if (chaveCodigo_(m.codigo)) afetados[chaveCodigo_(m.codigo)] = true; });
  const problemas = Object.keys(afetados).filter(k => (depois[k] || 0) < -1e-9 && (depois[k] || 0) < (antes[k] || 0) - 1e-9);
  if (problemas.length) {
    throw new Error('Saldo insuficiente: ' + problemas.map(k => k + ' ficaria com ' + arred2_(depois[k] || 0)).join('; ') +
      '. Parte desse material já saiu do estoque para alguma OS. Ajuste as retiradas antes de reduzir ou remover a entrada.');
  }
}

/**
 * Salva a NF inteira (cabeçalho + itens) e regrava as movimentações dela.
 * body: { nf: { id, numero, data, fornecedor, os[], clientes[], observacao }, itens: [ { id, descricao, codigo, unidade,
 *         quantidade, valorUnitario, frete, os, cliente, tipo, dataMovimentacao, observacao } ] }
 * Reenviar o mesmo corpo não duplica nada (tudo é gravado pelo id).
 */
function gravarNf_(body) {
  const nf = body.nf || {};
  const numeroNf = String(nf.numero || '').trim();
  const dataNf = String(nf.data || '').trim();
  if (!numeroNf) throw new Error('Informe o número da NF.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNf)) throw new Error('Informe a data da NF.');
  const itensIn = Array.isArray(body.itens) ? body.itens : [];
  if (!itensIn.length) throw new Error('A NF precisa de pelo menos um item.');
  const id = String(nf.id || '').trim() || novoId_('NF');
  const fornecedor = String(nf.fornecedor || '').trim();

  const itens = itensIn.map((it, i) => {
    const n = 'Item ' + (i + 1) + ': ';
    const regra = TIPOS_ITEM_NF[it.tipo];
    if (!regra) throw new Error(n + 'tipo de movimentação inválido (' + it.tipo + ').');
    const descricao = String(it.descricao || '').trim();
    const q = numero(it.quantidade), vu = numero(it.valorUnitario), fr = numero(it.frete);
    if (!descricao) throw new Error(n + 'informe a descrição.');
    if (!(q > 0)) throw new Error(n + 'a quantidade precisa ser maior que zero.');
    if (vu < 0 || fr < 0) throw new Error(n + 'valores não podem ser negativos.');
    if (regra.exigeOS && !String(it.os || '').trim()) throw new Error(n + 'consumo direto precisa de uma OS.');
    const dm = /^\d{4}-\d{2}-\d{2}$/.test(String(it.dataMovimentacao || '')) ? it.dataMovimentacao : dataNf;
    return { id: String(it.id || '').trim() || novoId_('IT'), nfId: id, descricao: descricao, codigo: String(it.codigo || '').trim(),
      unidade: String(it.unidade || '').trim(), quantidade: q, valorUnitario: vu, frete: fr, valorTotal: arred2_(q * vu + fr),
      os: String(it.os || '').trim(), cliente: String(it.cliente || '').trim(), tipo: it.tipo, dataMovimentacao: dm,
      observacao: String(it.observacao || '').trim(), atualizadoEm: agora(), excluido: 'FALSE' };
  });
  const repetidos = itens.map(i => i.id).filter((x, i, a) => a.indexOf(x) !== i);
  if (repetidos.length) throw new Error('Itens com o mesmo id: ' + repetidos.join(', '));

  // Movimentações: confere o saldo ANTES de gravar qualquer coisa
  const todas = lerComLinhas_('movimentacoes').filter(m => !excluido_(m));
  const daNf = todas.filter(m => m.nfId === id);
  const materiais = resolverMateriais_(itens, daNf.reduce((o, m) => (o[m.itemNfId] = m.codigo, o), {}));
  // "Outros" (frete, serviço, despesa) só vira movimentação quando é custo de uma OS
  const novas = itens.filter(it => TIPOS_ITEM_NF[it.tipo].mov && (TIPOS_ITEM_NF[it.tipo].estoque || it.os || TIPOS_ITEM_NF[it.tipo].exigeOS)).map(it => {
    const atual = daNf.find(m => m.itemNfId === it.id);
    const hora = atual && /^\d{4}-\d{2}-\d{2} /.test(atual.timestamp) ? atual.timestamp.slice(11) : agora().slice(11);
    return { _linha: atual ? atual._linha : 0, id: atual && atual.id ? atual.id : 'MV-' + it.id,
      timestamp: it.dataMovimentacao + ' ' + hora, codigo: it.codigo, tipo: TIPOS_ITEM_NF[it.tipo].mov, quantidade: it.quantidade,
      os: it.os, loteDimensao: '', observacao: it.descricao + (it.observacao ? ' | ' + it.observacao : ''), operador: '',
      cliente: it.cliente, valorUnitario: it.valorUnitario, valorTotal: it.valorTotal, nf: numeroNf, nfId: id, itemNfId: it.id,
      origem: 'NF ' + numeroNf, fornecedor: fornecedor, excluido: 'FALSE', atualizadoEm: agora() };
  });
  conferirSaldos_(todas, daNf, novas);
  materiais.gravar();

  // Cabeçalho: guarda só as OS/clientes vinculados diretamente à NF. Os dos itens ficam nos itens
  // (o app mostra a soma dos dois); assim, remover um item não deixa a OS dele presa na NF.
  const unir = lista => lista.map(x => String(x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i);
  const linhasNf = lerComLinhas_('notas');
  const atualNf = linhasNf.find(n => n.id === id);
  const cab = { _linha: atualNf ? atualNf._linha : 0, id: id, numero: numeroNf, data: dataNf, fornecedor: fornecedor,
    os: JSON.stringify(unir(Array.isArray(nf.os) ? nf.os : [])),
    clientes: JSON.stringify(unir(Array.isArray(nf.clientes) ? nf.clientes : [])),
    observacao: String(nf.observacao || '').trim(), criadoEm: atualNf && atualNf.criadoEm ? atualNf.criadoEm : agora(),
    atualizadoEm: agora(), excluido: 'FALSE' };
  gravarObjetos_('notas', [cab]);

  // Itens: atualiza/cria os enviados e marca como excluídos os que saíram da NF
  const linhasItens = lerComLinhas_('itensNf').filter(i => i.nfId === id);
  const ids = itens.map(i => i.id);
  const itensGravar = itens.map(it => { const a = linhasItens.find(l => l.id === it.id); return Object.assign({ _linha: a ? a._linha : 0 }, it); });
  linhasItens.filter(l => ids.indexOf(l.id) < 0 && !excluido_(l)).forEach(l => itensGravar.push(Object.assign(l, { excluido: 'TRUE', atualizadoEm: agora() })));
  gravarObjetos_('itensNf', itensGravar);

  // Movimentações: regrava as do item; as que não têm mais item (ou mudaram de tipo) são excluídas
  const usadas = novas.map(m => m._linha).filter(Boolean);
  const removidas = daNf.filter(m => usadas.indexOf(m._linha) < 0).map(m => Object.assign(m, { excluido: 'TRUE', atualizadoEm: agora() }));
  gravarObjetos_('movimentacoes', novas.concat(removidas));

  return { nf: montarNf_(cab, itens.map(montarItemNf_)), materiaisCriados: materiais.codigos };
}

/** Exclui a NF: itens e movimentações ficam marcados como excluídos (o estoque volta), se o saldo permitir. */
function excluirNf_(body) {
  const id = String(body.id || '').trim();
  if (!id) throw new Error('Campo "id" é obrigatório.');
  const nf = lerComLinhas_('notas').find(n => n.id === id && !excluido_(n));
  if (!nf) return { removido: true };
  const todas = lerComLinhas_('movimentacoes').filter(m => !excluido_(m));
  const daNf = todas.filter(m => m.nfId === id);
  conferirSaldos_(todas, daNf, []);
  const quando = agora();
  gravarObjetos_('notas', [Object.assign(nf, { excluido: 'TRUE', atualizadoEm: quando })]);
  gravarObjetos_('itensNf', lerComLinhas_('itensNf').filter(i => i.nfId === id && !excluido_(i)).map(i => Object.assign(i, { excluido: 'TRUE', atualizadoEm: quando })));
  gravarObjetos_('movimentacoes', daNf.map(m => Object.assign(m, { excluido: 'TRUE', atualizadoEm: quando })));
  return { removido: true };
}

/**
 * Movimentação avulsa (sem NF): retirada do estoque para OS, sobra, perda, ajuste.
 * Saídas são recusadas se não houver saldo. Reenviar com o mesmo id não duplica.
 */
function gravarMovimentacao_(body) {
  const m = Object.assign({}, body);
  delete m.kind;
  m.quantidade = numero(m.quantidade);
  if (!(m.quantidade > 0)) throw new Error('A quantidade precisa ser maior que zero.');
  if (!String(m.codigo || '').trim()) throw new Error('Informe o material.');
  m.id = String(m.id || '').trim() || novoId_('MV');
  const todas = lerComLinhas_('movimentacoes').filter(x => !excluido_(x));
  if (todas.some(x => x.id === m.id)) return { id: m.id, repetida: true };
  if (fator_(m.tipo) < 0 && body.validarSaldo !== false) {
    const saldo = saldos_(todas)[chaveCodigo_(m.codigo)] || 0;
    if (m.quantidade > saldo + 1e-9) throw new Error('Saldo insuficiente de ' + m.codigo + ': disponível ' + arred2_(saldo) + ', pedido ' + m.quantidade + '.');
  }
  if (!m.origem) m.origem = m.tipo === 'Retirada do estoque para OS' || m.tipo === 'Consumo na OS' ? ORIGEM_SEM_NF : 'Lançamento manual';
  m.valorTotal = m.valorTotal || arred2_(m.quantidade * numero(m.valorUnitario));
  m.excluido = 'FALSE';
  m.atualizadoEm = agora();
  gravarObjetos_('movimentacoes', [m]);
  return { id: m.id };
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
    .addSeparator()
    .addItem('Formatar planilha do cliente (Comau)', 'formatarPlanilhasClientes')
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
