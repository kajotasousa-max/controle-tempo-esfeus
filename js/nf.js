/* =====================================================================
 * MATERIAIS E NOTAS FISCAIS (1.5)
 *
 * A NF é o registro principal: cada NF tem vários itens e cada item tem
 * descrição, quantidade, valores, OS, cliente e tipo de movimentação próprios.
 * O Apps Script grava a NF inteira de uma vez e gera uma movimentação por item
 * (identificada pelo id do item), por isso editar não duplica entradas/saídas.
 *
 * Material retirado do estoque não tem NF: vai como "Retirada do estoque para OS"
 * com origem "SEM NF - MATERIAL DO ESTOQUE".
 * ===================================================================== */

const NF_TIPOS = [
  { valor: 'Compra para estoque', curto: 'Estoque', rotulo: 'Estoque', estoque: true },
  { valor: 'Consumo direto na OS', curto: 'Direto OS', rotulo: 'Direto na OS', estoque: false, exigeOS: true },
  { valor: 'Outros (sem efeito no estoque)', curto: 'Outros', rotulo: 'Despesa / frete', estoque: false },
  { valor: 'Entrada em estoque', curto: 'Estoque', rotulo: 'Entrada em estoque', estoque: true, oculto: true }
];
const NFS_KEY = chave('nfs_v1');
let notasFiscais = [];
let nfEditando = null;      // cópia de trabalho da NF aberta
let nfOriginal = null;      // como estava ao abrir (para conferir saldo e alterações)
let nfSalvando = false;
let nfsSincronizando = false;

/* ---------------- utilitários ---------------- */
function tipoNf(valor) { return NF_TIPOS.find(t => t.valor === valor) || NF_TIPOS[0]; }
function idLocal(prefixo) { return prefixo + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }
function numNf(v) { const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function arred2(n) { return Math.round(n * 100) / 100; }
function moedaNf(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function chaveTexto(t) { return semAcento(t).replace(/\s+/g, ' ').trim(); }
function totalItemNf(it) { return arred2(numNf(it.quantidade) * numNf(it.valorUnitario) + numNf(it.frete)); }
function totaisNf(nf) {
  const t = { mercadoria: 0, frete: 0, total: 0, estoque: 0, direto: 0, outros: 0 };
  (nf.itens || []).forEach(it => {
    const merc = numNf(it.quantidade) * numNf(it.valorUnitario), fr = numNf(it.frete), tot = merc + fr;
    t.mercadoria += merc; t.frete += fr; t.total += tot;
    const tp = tipoNf(it.tipo);
    if (tp.estoque) t.estoque += tot; else if (tp.exigeOS) t.direto += tot; else t.outros += tot;
  });
  Object.keys(t).forEach(k => { t[k] = arred2(t[k]); });
  return t;
}
function unicos(lista) { return lista.map(x => String(x || '').trim()).filter((x, i, a) => x && a.indexOf(x) === i); }
function osDaNf(nf) { return unicos((nf.os || []).concat((nf.itens || []).map(i => i.os))); }
function clientesDaNf(nf) { return unicos((nf.clientes || []).concat((nf.itens || []).map(i => i.cliente))); }
function backendTemNf() { return localStorage.getItem(chave('backend_nfs')) === '1'; }

/** OS ativas para as listas de seleção: valor "OS/item", com cliente. */
function opcoesOS() {
  return servicos.filter(s => !s.excluido && s.os)
    .map(s => ({ valor: osItemServico(s), cliente: s.cliente || '', desc: s.desc || '', s }))
    .sort((a, b) => b.valor.localeCompare(a.valor, 'pt-BR', { numeric: true }));
}
function servicoPorOS(valor) {
  const v = String(valor || '').trim().toUpperCase();
  if (!v) return null;
  return servicos.find(s => !s.excluido && osItemServico(s).toUpperCase() === v) || null;
}
/** A movimentação é desta OS? (aceita lançamentos antigos só com o número da OS) */
function movimentoDaOS(m, s) {
  const mo = String(m.os || '').trim().toUpperCase();
  if (!mo) return false;
  if (mo === osItemServico(s).toUpperCase()) return true;
  return mo.indexOf('/') < 0 && mo === String(s.os || '').trim().toUpperCase();
}
function materialPorTexto(txt) {
  const k = chaveTexto(txt);
  if (!k) return null;
  return materiaisCadastro.find(m => chaveTexto(m.codigo) === k) ||
    materiaisCadastro.find(m => chaveTexto(m.descricao) === k) ||
    materiaisCadastro.find(m => chaveTexto(m.codigo + ' — ' + m.descricao) === k) || null;
}
function materialPorCodigo(cod) {
  const k = String(cod || '').trim().toUpperCase();
  return k ? materiaisCadastro.find(m => String(m.codigo || '').trim().toUpperCase() === k) || null : null;
}
function materialDoItem(it) { return materialPorCodigo(it.codigo) || materialPorTexto(it.descricao); }

/* ---------------- custo do estoque ---------------- */
function entradasComValor(materialId) {
  return movimentosMateriais.filter(m => String(m.materialId) === String(materialId) && fatorMovimentoMaterial(m.tipo) > 0 && numNf(m.custoUnitario) > 0 && numNf(m.quantidade) > 0);
}
/** Valor unitário médio ponderado das entradas com valor. */
function custoMedioMaterial(materialId) {
  const e = entradasComValor(materialId);
  const q = e.reduce((t, m) => t + numNf(m.quantidade), 0);
  return q > 0 ? arred2(e.reduce((t, m) => t + numNf(m.quantidade) * numNf(m.custoUnitario), 0) / q) : 0;
}
function ultimoValorMaterial(materialId) {
  const e = entradasComValor(materialId).sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)));
  return e.length ? numNf(e[e.length - 1].custoUnitario) : 0;
}
function valorMovimento(m) {
  if (numNf(m.valorTotal) > 0) return numNf(m.valorTotal);
  return arred2(numNf(m.quantidade) * numNf(m.custoUnitario));
}
function origemMovimento(m) {
  if (m.nf) return 'NF ' + m.nf;
  if (m.origem) return m.origem;
  if (m.documento) return 'NF ' + m.documento + ' (lançamento anterior)';
  if (fatorMovimentoMaterial(m.tipo) < 0 && /OS/.test(m.tipo)) return ORIGEM_SEM_NF;
  return 'Lançamento anterior';
}
/** Saldo de cada material logo depois de cada movimentação (ordem cronológica). */
function saldosAposMovimentos() {
  const ord = movimentosMateriais.slice().sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)) || a.id - b.id);
  const corrente = {}, apos = {};
  ord.forEach(m => {
    const k = String(m.materialId);
    corrente[k] = arred2((corrente[k] || 0) + numNf(m.quantidade) * fatorMovimentoMaterial(m.tipo));
    apos[m.id] = corrente[k];
  });
  return apos;
}

/* ---------------- sincronização ---------------- */
function salvarNfsLocal() { try { localStorage.setItem(NFS_KEY, JSON.stringify(notasFiscais)); } catch (e) {} }
function carregarNfsLocal() {
  try { const d = JSON.parse(localStorage.getItem(NFS_KEY) || '[]'); notasFiscais = Array.isArray(d) ? d : []; } catch (e) { notasFiscais = []; }
}
async function fetchNfsFromSheets() {
  const url = getSyncUrl();
  if (!url) return false;
  try {
    const r = await fetch(url + '?action=list-nfs', { method: 'GET', redirect: 'follow' }).then(x => x.json());
    if (!r.ok) {
      if (/Ação desconhecida/i.test(r.erro || '')) { localStorage.removeItem(chave('backend_nfs')); atualizarAvisoBackendNf(); }
      return false;
    }
    localStorage.setItem(chave('backend_nfs'), '1');
    notasFiscais = r.nfs || [];
    salvarNfsLocal();
    atualizarAvisoBackendNf();
    return true;
  } catch (e) { return false; }
}
let nfsAtualizarDeNovo = null;
/** Busca materiais, movimentações e NFs. Se já houver uma busca em andamento, espera ela e busca de novo
 *  (senão uma gravação feita no meio da busca só apareceria no próximo ciclo). */
async function atualizarMateriaisENfs() {
  if (nfsSincronizando) {
    if (!nfsAtualizarDeNovo) nfsAtualizarDeNovo = new Promise(res => { const t = setInterval(() => { if (!nfsSincronizando) { clearInterval(t); nfsAtualizarDeNovo = null; res(atualizarMateriaisENfs()); } }, 150); });
    return nfsAtualizarDeNovo;
  }
  nfsSincronizando = true;
  materiaisSyncing = true;
  try { await Promise.all([fetchMateriaisFromSheets(), fetchNfsFromSheets()]); }
  finally { nfsSincronizando = false; materiaisSyncing = false; }
  atualizarSelectMateriais();
  atualizarListasNf();
  renderMateriais();
  renderNfs();
}
async function postarPlanilha(payload) {
  const url = getSyncUrl();
  if (!url) return { ok: false, erro: 'Endereço do Apps Script não configurado (config.js).' };
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    return JSON.parse(await resp.text());
  } catch (err) {
    return { ok: false, semConexao: true, erro: 'Sem conexão com a planilha. Nada foi gravado; tente de novo quando a internet voltar.' };
  }
}
function atualizarAvisoBackendNf() {
  const aviso = document.getElementById('nf-aviso-backend');
  const btn = document.getElementById('btn-nova-nf');
  if (!aviso) return;
  const falta = getSyncUrl() && !backendTemNf();
  aviso.style.display = falta ? '' : 'none';
  aviso.innerHTML = falta ? '⚠️ O Apps Script da planilha ainda é de uma versão anterior. Para lançar notas fiscais, cole o <strong>backend/Code.gs 1.5.0</strong> no Apps Script, rode <em>configurar</em> e publique uma nova versão (passo a passo em docs/INSTALACAO.md).' : '';
  if (btn) btn.disabled = !!falta;
}

/* ---------------- listas de sugestão ---------------- */
function atualizarListasNf() {
  const opt = (v, l) => '<option value="' + escMelhoria(v) + '"' + (l ? ' label="' + escMelhoria(l) + '"' : '') + '></option>';
  const dlOs = document.getElementById('dl-os');
  if (dlOs) dlOs.innerHTML = opcoesOS().map(o => opt(o.valor, [o.cliente, o.desc].filter(Boolean).join(' — '))).join('');
  const dlCli = document.getElementById('dl-clientes');
  if (dlCli) dlCli.innerHTML = unicos(servicos.map(s => s.cliente).concat(...notasFiscais.map(clientesDaNf))).sort().map(c => opt(c)).join('');
  const dlMat = document.getElementById('dl-materiais');
  if (dlMat) dlMat.innerHTML = materiaisCadastro.filter(m => m.ativo !== false).map(m =>
    opt(m.descricao, m.codigo + ' · saldo ' + numeroMaterial(saldoMaterial(m.id)) + ' ' + (m.unidade || ''))).join('');
  const dlForn = document.getElementById('dl-fornecedores');
  if (dlForn) dlForn.innerHTML = unicos((fornecedoresRemoto || []).filter(f => f.ativo !== false).map(f => f.nome).concat(notasFiscais.map(n => n.fornecedor))).sort().map(f => opt(f)).join('');
}
function preencherClienteDaOS(idOs, idCliente) {
  const s = servicoPorOS(document.getElementById(idOs).value);
  if (s && s.cliente) document.getElementById(idCliente).value = s.cliente;
}

/* ---------------- sub-abas ---------------- */
/* ======================= TELA ÚNICA: ESTOQUE + NOTAS ======================= */
let mostrarInativos = false;
let todasNfs = false;
function switchMatSub() { /* compatibilidade: a aba não tem mais sub-abas */ }
function alternarMenuMateriais(ev) {
  ev.stopPropagation();
  const m = document.getElementById('mx-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', () => { const m = document.getElementById('mx-menu'); if (m) m.style.display = 'none'; });
function alternarInativos() {
  mostrarInativos = !mostrarInativos;
  document.getElementById('mx-inativos').textContent = mostrarInativos ? '👁 Esconder inativos' : '👁 Mostrar inativos';
  renderMateriais();
}
function alternarTodasNfs() { todasNfs = !todasNfs; renderNfs(); }
function buscaMateriais() { return semAcento((document.getElementById('search-material') || {}).value || ''); }

/** A lista de seleção de materiais agora só existe na janela de retirada. */
function atualizarSelectMateriais() {
  const modal = document.getElementById('ret-modal');
  if (!modal || modal.style.display === 'none') return;
  const sel = document.getElementById('mov-material'), v = sel.value;
  preencherMateriaisRetirada();
  if (v) sel.value = v;
}
/** Estoque: material, tipo e saldo. Clique em "Ver" para histórico, ajuste e edição. */
function renderMateriais() {
  const box = document.getElementById('lista-estoque');
  if (!box) return;
  const busca = buscaMateriais();
  const lista = materiaisCadastro.filter(m => {
    if (!mostrarInativos && m.ativo === false) return false;
    return !busca || semAcento([m.codigo, m.descricao, m.especificacao, m.tipo, m.localizacao].join(' ')).includes(busca);
  }).sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR', { numeric: true }));
  document.getElementById('material-count').textContent = lista.length ? '(' + lista.length + ')' : '';
  if (!lista.length) {
    box.innerHTML = '<div class="mx-vazio">' + (materiaisCadastro.length ? 'Nenhum material encontrado.' : 'O estoque começa a aparecer aqui quando você lança a primeira NF.') + '</div>';
    renderNfs();
    return;
  }
  box.innerHTML = lista.map(m => {
    const saldo = saldoMaterial(m.id), minimo = Number(m.minimo || 0);
    const comprar = m.ativo !== false && (saldo <= 0 || (minimo > 0 && saldo <= minimo));
    return '<div class="mx-linha' + (m.ativo === false ? ' mx-inativo' : '') + '" onclick="abrirMaterial(' + Number(m.id) + ')">' +
      '<div class="mx-nome">' + escMelhoria(m.descricao || m.codigo) + '<small>' + escMelhoria(m.codigo) + (m.ativo === false ? ' · inativo' : '') + '</small></div>' +
      '<div>' + (m.tipo ? '<span class="tipo-mat-tag">' + escMelhoria(m.tipo) + '</span>' : '') + '</div>' +
      '<div class="mx-saldo ' + (comprar ? 'material-low' : 'material-ok') + '">' + numeroMaterial(saldo) + ' ' + escMelhoria(m.unidade || '') + (comprar ? ' · comprar' : '') + '</div>' +
      '<div class="mx-botoes"><button class="btn-secondary btn-sm" onclick="event.stopPropagation(); abrirMaterial(' + Number(m.id) + ')">Ver</button>' +
      (m.ativo === false
        ? '<button class="btn-success btn-sm" title="Reativar" onclick="event.stopPropagation(); excluirDaLista(' + Number(m.id) + ')">↺</button>'
        : '<button class="btn-danger btn-sm" title="Excluir (ou inativar, se tiver movimentações)" onclick="event.stopPropagation(); excluirDaLista(' + Number(m.id) + ')">🗑</button>') +
      '</div></div>';
  }).join('');
  renderNfs();
}

function statusMovNf(nf) {
  return unicos((nf.itens || []).map(i => tipoNf(i.tipo).curto)).map(t => '<span class="nf-tag nf-tag-' + semAcento(t).replace(/\s+/g, '-') + '">' + t + '</span>').join(' ');
}
function nfsFiltradas() {
  const busca = buscaMateriais();
  return notasFiscais.filter(nf => !busca || semAcento([nf.numero, nf.fornecedor, nf.observacao, osDaNf(nf).join(' '), clientesDaNf(nf).join(' '),
      (nf.itens || []).map(i => i.descricao + ' ' + i.codigo).join(' ')].join(' ')).includes(busca))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
}
/** Notas fiscais: as 5 mais recentes (ou todas / as que batem com a busca). */
function renderNfs() {
  const box = document.getElementById('lista-nfs');
  if (!box) return;
  atualizarAvisoBackendNf();
  const todas = nfsFiltradas();
  const mostrar = todasNfs || buscaMateriais() ? todas : todas.slice(0, 5);
  const link = document.getElementById('nf-ver-todas');
  if (link) link.textContent = buscaMateriais() || todas.length <= 5 ? '' : (todasNfs ? 'mostrar menos' : 'ver todas (' + todas.length + ')');
  if (!mostrar.length) { box.innerHTML = '<div class="mx-vazio">' + (notasFiscais.length ? 'Nenhuma NF encontrada.' : 'Nenhuma NF lançada ainda.') + '</div>'; return; }
  box.innerHTML = mostrar.map(nf => {
    const os = osDaNf(nf);
    return '<div class="mx-linha mx-linha-nf" onclick="abrirNf(\'' + escMelhoria(nf.id) + '\')">' +
      '<div class="mx-nome">NF ' + escMelhoria(nf.numero || '—') + (nf.fornecedor ? ' · ' + escMelhoria(nf.fornecedor) : '') +
        '<small>' + (nf.itens || []).length + ' ite' + ((nf.itens || []).length === 1 ? 'm' : 'ns') + (os.length ? ' · ' + escMelhoria(os.slice(0, 3).join(', ') + (os.length > 3 ? '…' : '')) : '') + '</small></div>' +
      '<div>' + statusMovNf(nf) + '</div>' +
      '<div class="mx-nf-valor">' + escMelhoria(fmtDate(nf.data) || '') + '<strong>' + moedaNf(totaisNf(nf).total) + '</strong></div>' +
    '</div>';
  }).join('');
}
function exportarNfs() {
  if (!notasFiscais.length) { alert('Ainda não há NFs lançadas.'); return; }
  const linhas = [];
  nfsFiltradas().forEach(nf => (nf.itens || []).forEach(it => linhas.push([nf.numero, nf.data, nf.fornecedor, it.descricao, it.codigo, it.unidade,
    it.quantidade, it.valorUnitario, it.frete, totalItemNf(it), it.tipo, it.os, it.cliente, it.dataMovimentacao, it.observacao])));
  baixarCsvMateriais('itens-nfs', ['nf', 'data_nf', 'fornecedor', 'descricao', 'codigo_material', 'unidade', 'quantidade', 'valor_unitario', 'frete', 'valor_total',
    'tipo_movimentacao', 'os', 'cliente', 'data_movimentacao', 'observacao'], linhas);
}

/* ======================= EDITOR DA NF ======================= */
function nfEditorAberto() { const m = document.getElementById('nf-modal'); return !!(m && m.style.display !== 'none'); }
function novoItemNf(nf, pref) {
  const umaOS = (nf.os || []).length === 1 ? nf.os[0] : '';
  const os = (pref && pref.os) || nf._osPadrao || umaOS;
  const s = servicoPorOS(os);
  return { id: idLocal('IT'), descricao: '', codigo: '', unidade: '', quantidade: '', valorUnitario: '', frete: '',
    os: os, cliente: (s && s.cliente) || ((nf.clientes || []).length === 1 ? nf.clientes[0] : ''),
    tipo: os ? 'Consumo direto na OS' : 'Compra para estoque', dataMovimentacao: nf.data || hojeLocal(), observacao: '' };
}
/** Abre uma NF nova. pref = { os, cliente } quando vem da OS. */
function novaNf(pref) {
  if (getSyncUrl() && !backendTemNf()) { atualizarAvisoBackendNf(); alert('Atualize o Apps Script para a versão 1.5.0 antes de lançar NFs.'); return; }
  pref = pref || {};
  // Vindo da OS: a OS vai nos itens (não no cabeçalho), e todo item novo já nasce com ela
  const nf = { id: idLocal('NF'), numero: '', data: hojeLocal(), fornecedor: '', os: [], clientes: [], observacao: '', itens: [], nova: true, _osPadrao: pref.os || '' };
  nf.itens.push(novoItemNf(nf, pref));
  nfOriginal = null;
  nfEditando = nf;
  mostrarEditorNf();
  setTimeout(() => document.getElementById('nf-numero').focus(), 50);
}
function abrirNf(id) {
  const nf = notasFiscais.find(n => n.id === id);
  if (!nf) return;
  nfOriginal = JSON.parse(JSON.stringify(nf));
  nfEditando = JSON.parse(JSON.stringify(nf));
  mostrarEditorNf();
}
function mostrarEditorNf() {
  atualizarListasNf();
  const nf = nfEditando;
  document.getElementById('nf-modal-title').textContent = nf.nova ? 'Lançar nota fiscal' : 'NF ' + (nf.numero || '') + (nf.fornecedor ? ' · ' + nf.fornecedor : '');
  nfItensAbertos = new Set(nf.itens.filter(it => numNf(it.frete) > 0 || tipoNf(it.tipo).oculto).map(it => it.id));
  const temMais = (nf.os || []).length || (nf.clientes || []).length || nf.observacao;
  document.getElementById('nf-mais').style.display = temMais ? '' : 'none';
  document.getElementById('nf-mais-link').style.display = temMais ? 'none' : '';
  document.getElementById('nf-numero').value = nf.numero || '';
  document.getElementById('nf-data').value = nf.data || '';
  document.getElementById('nf-fornecedor').value = nf.fornecedor || '';
  document.getElementById('nf-observacao').value = nf.observacao || '';
  document.getElementById('btn-excluir-nf').style.display = nf.nova ? 'none' : '';
  renderChipsNf();
  renderItensNf();
  document.getElementById('nf-modal').style.display = 'flex';
  document.body.classList.add('modal-aberto');
}
let nfItensAbertos = new Set();
function alternarMaisNf() {
  document.getElementById('nf-mais').style.display = '';
  document.getElementById('nf-mais-link').style.display = 'none';
}
function alternarDetalheItem(i) {
  const id = nfEditando.itens[i].id;
  if (nfItensAbertos.has(id)) nfItensAbertos.delete(id); else nfItensAbertos.add(id);
  renderItensNf();
}
function nfAlterada() {
  if (!nfEditando) return false;
  const limpa = n => JSON.stringify(Object.assign({}, n, { nova: undefined }));
  if (!nfOriginal) return nfEditando.numero || nfEditando.fornecedor || nfEditando.itens.some(i => i.descricao || i.quantidade);
  return limpa(nfOriginal) !== limpa(nfEditando);
}
function fecharNf(forcar) {
  if (nfSalvando && !forcar) { alert('Aguarde: a NF está sendo gravada na planilha.'); return; }
  if (!forcar && nfAlterada() && !confirm('Fechar sem salvar? As alterações desta NF serão perdidas.')) return;
  document.getElementById('nf-modal').style.display = 'none';
  document.body.classList.remove('modal-aberto');
  nfEditando = null; nfOriginal = null;
}
function nfCampo(campo, valor) {
  if (!nfEditando) return;
  if (campo === 'data') {
    // Itens que acompanhavam a data da NF continuam acompanhando
    const antiga = nfEditando.data;
    nfEditando.itens.forEach(it => { if (!it.dataMovimentacao || it.dataMovimentacao === antiga) it.dataMovimentacao = valor; });
    nfEditando.data = valor;
    renderItensNf();
    return;
  }
  nfEditando[campo] = valor;
}

/* chips de OS e clientes do cabeçalho */
function renderChipsNf() {
  const chip = (lista, v, i) => '<span class="chip">' + escMelhoria(v) + ' <button type="button" onclick="nfRemoverChip(\'' + lista + '\',' + i + ')" title="Remover">×</button></span>';
  document.getElementById('nf-os-chips').innerHTML = (nfEditando.os || []).map((v, i) => chip('os', v, i)).join('') || '<span class="chip-vazio">nenhuma (as OS dos itens entram sozinhas)</span>';
  document.getElementById('nf-cli-chips').innerHTML = (nfEditando.clientes || []).map((v, i) => chip('clientes', v, i)).join('') || '<span class="chip-vazio">nenhum (os clientes dos itens entram sozinhos)</span>';
}
function nfAddChip(lista) {
  const inp = document.getElementById(lista === 'os' ? 'nf-os-add' : 'nf-cli-add');
  const v = inp.value.trim();
  if (!v) return;
  if (lista === 'os' && !servicoPorOS(v) && !confirm('A OS "' + v + '" não está cadastrada no app. Vincular assim mesmo?')) return;
  nfEditando[lista] = unicos((nfEditando[lista] || []).concat([v]));
  if (lista === 'os') {
    const s = servicoPorOS(v);
    if (s && s.cliente) nfEditando.clientes = unicos((nfEditando.clientes || []).concat([s.cliente]));
  }
  inp.value = '';
  renderChipsNf();
}
function nfRemoverChip(lista, i) {
  nfEditando[lista].splice(i, 1);
  renderChipsNf();
}

/* itens */
function nfAddItem() {
  nfEditando.itens.push(novoItemNf(nfEditando));
  renderItensNf();
  const linhas = document.querySelectorAll('#nf-itens-body tr.nf-item');
  const ult = linhas[linhas.length - 1];
  if (ult) { const inp = ult.querySelector('input'); if (inp) inp.focus(); }
}
function nfRemoverItem(i) {
  const it = nfEditando.itens[i];
  if ((it.descricao || it.quantidade) && !confirm('Remover o item "' + (it.descricao || 'sem descrição') + '"?' +
    (nfOriginal && tipoNf(it.tipo).estoque ? '\n\nA entrada dele no estoque será desfeita ao salvar.' : ''))) return;
  nfEditando.itens.splice(i, 1);
  if (!nfEditando.itens.length) nfEditando.itens.push(novoItemNf(nfEditando));
  renderItensNf();
}
/** Altera um campo do item. Campos de texto/número só atualizam os totais (não redesenham a linha, para não perder o foco). */
function nfItemCampo(i, campo, valor) {
  const it = nfEditando.itens[i];
  if (!it) return;
  it[campo] = valor;
  if (campo === 'os') {
    const s = servicoPorOS(valor);
    if (s && s.cliente) it.cliente = s.cliente;
    if (valor && tipoNf(it.tipo).estoque === false && !tipoNf(it.tipo).exigeOS) { /* mantém "Outros" */ }
    renderItensNf();
    return;
  }
  if (campo === 'descricao') {
    const m = materialPorTexto(valor);
    it.codigo = m ? m.codigo : '';
    if (m && !it.unidade) it.unidade = m.unidade || '';
    if (m && !numNf(it.valorUnitario)) { const u = ultimoValorMaterial(m.id); if (u) it.valorUnitario = u; }
    renderItensNf();
    return;
  }
  if (campo === 'tipo') { renderItensNf(); return; }
  atualizarLinhaNf(i);
  renderTotaisNf();
}
/** Quanto cada material do estoque muda com esta edição (novo − original), por id do material. */
function deltaEstoqueNf() {
  const delta = {};
  const somar = (nf, sinal) => (nf ? nf.itens : []).forEach(it => {
    if (!tipoNf(it.tipo).estoque) return;
    const m = materialDoItem(it);
    if (m) delta[m.id] = (delta[m.id] || 0) + sinal * numNf(it.quantidade);
  });
  somar(nfEditando, 1);
  somar(nfOriginal, -1);
  return delta;
}
function dicaItemNf(it) {
  const tp = tipoNf(it.tipo);
  if (tp.exigeOS) return it.os ? '' : '<span class="nf-erro">Escolha a OS deste item.</span>';
  if (!tp.estoque) return '';
  const m = materialDoItem(it);
  if (!it.descricao) return '';
  if (!m) return '🆕 Material novo no estoque';
  const saldo = saldoMaterial(m.id);
  const d = deltaEstoqueNf()[m.id] || 0;
  const depois = saldo + d;
  return 'Estoque ' + escMelhoria(m.codigo) + ': saldo ' + numeroMaterial(saldo) + ' ' + escMelhoria(m.unidade || '') +
    (d ? ' → <strong class="' + (depois < 0 ? 'nf-erro' : '') + '">' + numeroMaterial(depois) + '</strong> ao salvar' : '');
}
function renderItensNf() {
  const opOS = opcoesOS();
  const body = document.getElementById('nf-itens-body');
  body.innerHTML = nfEditando.itens.map((it, i) => {
    const tp = tipoNf(it.tipo);
    const aberto = nfItensAbertos.has(it.id);
    const inp = (campo, extra) => '<input ' + (extra || '') + ' value="' + escMelhoria(it[campo] === undefined ? '' : it[campo]) + '" oninput="nfItemCampo(' + i + ',\'' + campo + '\', this.value)">';
    const osOpts = '<option value="">' + (tp.exigeOS ? '— escolha —' : '—') + '</option>' +
      (it.os && !opOS.some(o => o.valor === it.os) ? '<option selected>' + escMelhoria(it.os) + '</option>' : '') +
      opOS.map(o => '<option value="' + escMelhoria(o.valor) + '"' + (o.valor === it.os ? ' selected' : '') + '>' + escMelhoria(o.valor + (o.cliente ? ' · ' + o.cliente : '')) + '</option>').join('');
    const tipos = NF_TIPOS.filter(t => !t.oculto || t.valor === it.tipo);
    return '<tr class="nf-item nf-item-' + (tp.estoque ? 'estoque' : tp.exigeOS ? 'direto' : 'outros') + '">' +
      '<td class="nf-n">' + (i + 1) + '</td>' +
      '<td><input list="dl-materiais" value="' + escMelhoria(it.descricao) + '" placeholder="Digite o produto" oninput="nfEditando.itens[' + i + '].descricao=this.value" onchange="nfItemCampo(' + i + ',\'descricao\', this.value)"></td>' +
      '<td>' + inp('quantidade', 'type="number" min="0" step="0.001" class="nf-num"') + '</td>' +
      '<td>' + inp('valorUnitario', 'type="number" min="0" step="0.01" class="nf-num"') + '</td>' +
      '<td><select onchange="nfItemCampo(' + i + ',\'tipo\', this.value)">' + tipos.map(t => '<option value="' + t.valor + '"' + (t.valor === it.tipo ? ' selected' : '') + '>' + t.rotulo + '</option>').join('') + '</select></td>' +
      '<td><select onchange="nfItemCampo(' + i + ',\'os\', this.value)"' + (tp.exigeOS && !it.os ? ' class="nf-campo-erro"' : '') + '>' + osOpts + '</select></td>' +
      '<td class="nf-tot" id="nf-tot-' + i + '">' + moedaNf(totalItemNf(it)) + '</td>' +
      '<td><button type="button" class="nf-mais-btn' + (aberto ? ' ativo' : '') + '" onclick="alternarDetalheItem(' + i + ')" title="Unidade, frete, cliente e data">⋯</button></td>' +
      '<td><button type="button" class="nf-x" onclick="nfRemoverItem(' + i + ')" title="Remover item">✕</button></td>' +
    '</tr>' +
    (aberto ? '<tr class="nf-detalhe"><td></td><td colspan="8"><div class="nf-detalhe-grid">' +
      '<label>Unidade ' + inp('unidade', 'list="dl-unidades" placeholder="un"') + '</label>' +
      '<label>Frete ' + inp('frete', 'type="number" min="0" step="0.01" placeholder="0,00"') + '</label>' +
      '<label>Cliente ' + inp('cliente', 'list="dl-clientes"') + '</label>' +
      '<label>Data da movimentação <input type="date" value="' + escMelhoria(it.dataMovimentacao || '') + '" onchange="nfItemCampo(' + i + ',\'dataMovimentacao\', this.value)"></label>' +
    '</div></td></tr>' : '') +
    '<tr class="nf-dica"><td></td><td colspan="8" id="nf-dica-' + i + '">' + dicaItemNf(it) + '</td></tr>';
  }).join('');
  renderTotaisNf();
}
function atualizarLinhaNf(i) {
  const it = nfEditando.itens[i];
  const tot = document.getElementById('nf-tot-' + i);
  if (tot) tot.textContent = moedaNf(totalItemNf(it));
  nfEditando.itens.forEach((x, j) => { const d = document.getElementById('nf-dica-' + j); if (d) d.innerHTML = dicaItemNf(x); });
}
function renderTotaisNf() {
  const t = totaisNf(nfEditando);
  document.getElementById('nf-totais').innerHTML = (t.frete ? '<span>frete ' + moedaNf(t.frete) + '</span>' : '') +
    '<span class="nf-total-geral">Total <strong>' + moedaNf(t.total) + '</strong></span>';
}
/** Confere tudo antes de enviar. Devolve a mensagem de erro ou ''. */
function validarNf(nf) {
  if (!String(nf.numero || '').trim()) return 'Informe o número da NF.';
  if (!nf.data) return 'Informe a data da NF.';
  const itens = nf.itens.filter(it => it.descricao || numNf(it.quantidade) || numNf(it.valorUnitario));
  if (!itens.length) return 'Inclua pelo menos um item.';
  for (let i = 0; i < nf.itens.length; i++) {
    const it = nf.itens[i], n = 'Item ' + (i + 1) + ': ';
    if (!itens.includes(it)) continue;
    if (!String(it.descricao || '').trim()) return n + 'informe a descrição.';
    if (!(numNf(it.quantidade) > 0)) return n + 'a quantidade precisa ser maior que zero.';
    if (numNf(it.valorUnitario) < 0 || numNf(it.frete) < 0) return n + 'valores não podem ser negativos.';
    if (tipoNf(it.tipo).exigeOS && !String(it.os || '').trim()) return n + 'consumo direto precisa de uma OS.';
  }
  const delta = deltaEstoqueNf();
  const neg = Object.keys(delta).map(id => materialPorId(id)).filter(m => m && saldoMaterial(m.id) + delta[m.id] < -1e-9);
  if (neg.length) return 'Saldo insuficiente: ' + neg.map(m => m.codigo + ' ficaria com ' + numeroMaterial(saldoMaterial(m.id) + delta[m.id])).join('; ') +
    '.\n\nParte desse material já saiu do estoque para alguma OS. Ajuste as retiradas antes de reduzir ou remover a entrada.';
  return '';
}
async function salvarNf() {
  if (nfSalvando || !nfEditando) return;
  document.activeElement && document.activeElement.blur && document.activeElement.blur(); // aplica o campo que estava sendo digitado
  const nf = nfEditando;
  const erro = validarNf(nf);
  if (erro) { alert(erro); return; }
  const repetida = notasFiscais.find(n => n.id !== nf.id && String(n.numero).trim() === String(nf.numero).trim() &&
    chaveTexto(n.fornecedor) === chaveTexto(nf.fornecedor));
  if (repetida && !confirm('Já existe a NF ' + repetida.numero + (repetida.fornecedor ? ' de ' + repetida.fornecedor : '') + ' (' + fmtDate(repetida.data) + ').\n\nSalvar outra com o mesmo número?')) return;
  const itens = nf.itens.filter(it => it.descricao || numNf(it.quantidade) || numNf(it.valorUnitario)).map(it => ({
    id: it.id, descricao: String(it.descricao).trim(), codigo: (materialDoItem(it) || {}).codigo || '', unidade: String(it.unidade || '').trim(),
    quantidade: numNf(it.quantidade), valorUnitario: numNf(it.valorUnitario), frete: numNf(it.frete), os: String(it.os || '').trim(),
    cliente: String(it.cliente || '').trim(), tipo: it.tipo, dataMovimentacao: it.dataMovimentacao || nf.data, observacao: it.observacao || ''
  }));
  const payload = { kind: 'nf', nf: { id: nf.id, numero: String(nf.numero).trim(), data: nf.data, fornecedor: String(nf.fornecedor || '').trim(),
    os: nf.os || [], clientes: nf.clientes || [], observacao: nf.observacao || '' }, itens };
  const btn = document.getElementById('btn-salvar-nf');
  nfSalvando = true; btn.disabled = true; btn.textContent = 'Salvando…';
  const r = await postarPlanilha(payload);
  nfSalvando = false; btn.disabled = false; btn.textContent = '💾 Salvar NF';
  if (!r.ok) {
    if (/kind desconhecido/i.test(r.erro || '')) { localStorage.removeItem(chave('backend_nfs')); atualizarAvisoBackendNf(); }
    alert('A NF não foi salva.\n\n' + (r.erro || 'Erro desconhecido.'));
    return;
  }
  const i = notasFiscais.findIndex(n => n.id === r.nf.id);
  if (i >= 0) notasFiscais[i] = r.nf; else notasFiscais.push(r.nf);
  salvarNfsLocal();
  fecharNf(true);
  await atualizarMateriaisENfs();
  if (window.renderMateriaisDaOSAtual) renderMateriaisDaOSAtual();
  alert('NF ' + r.nf.numero + ' salva.' + (r.materiaisCriados && r.materiaisCriados.length ? '\nMateriais cadastrados no estoque: ' + r.materiaisCriados.join(', ') + '.' : ''));
}
async function excluirNf() {
  if (!nfOriginal || nfSalvando) return;
  const comEstoque = nfOriginal.itens.some(i => tipoNf(i.tipo).estoque);
  if (!confirm('Excluir a NF ' + nfOriginal.numero + '?\n\n' + (comEstoque ? 'As entradas dela no estoque serão desfeitas. ' : '') +
    'Os itens e movimentações ficam guardados na planilha como excluídos (para auditoria), mas saem do saldo e do histórico.')) return;
  const id = nfOriginal.id;
  nfSalvando = true;
  const r = await postarPlanilha({ kind: 'excluir-nf', id });
  nfSalvando = false;
  if (!r.ok) { alert('A NF não foi excluída.\n\n' + (r.erro || 'Erro desconhecido.')); return; }
  notasFiscais = notasFiscais.filter(n => n.id !== id);
  salvarNfsLocal();
  fecharNf(true);
  await atualizarMateriaisENfs();
  if (window.renderMateriaisDaOSAtual) renderMateriaisDaOSAtual();
}

/* ======================= MOVIMENTAÇÃO AVULSA (sem NF) ======================= */
/** Grava retirada, sobra ou ajuste na planilha e só então no navegador (o saldo é conferido lá). */
async function gravarMovimentoAvulso(dados) {
  const material = materialPorId(dados.materialId);
  const custo = custoMedioMaterial(material.id);
  const data = hojeLocal();
  const mov = Object.assign({
    id: nextMovimentoMaterialId++, uid: idLocal('MV'), data, timestamp: data + ' ' + new Date().toTimeString().slice(0, 8),
    materialId: Number(material.id), codigo: material.codigo, custoUnitario: custo, valorTotal: arred2(custo * dados.quantidade),
    os: '', cliente: '', lote: '', dimensao: '', observacao: '',
    origem: dados.tipo === 'Retirada do estoque para OS' ? ORIGEM_SEM_NF : 'Ajuste interno (sem NF)'
  }, dados);
  if (getSyncUrl()) {
    const r = await enviarMovimentoSheets(mov, material);
    if (!r.ok) return r;
  }
  movimentosMateriais.push(mov);
  saveMateriais();
  return { ok: true, mov };
}
function renderMovimentacoesMateriais() { /* a lista geral saiu da tela: histórico fica em cada material */ }

/* ---------- Retirar / devolver sobra (pela OS) ---------- */
let retiradaOS = null;
function retirarParaOS() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) return;
  retiradaOS = { os: osItemServico(s), cliente: s.cliente || '', material: s.material || '' };
  document.getElementById('ret-title').textContent = 'Material para a OS ' + retiradaOS.os;
  document.querySelector('input[name=ret-tipo][value="Retirada do estoque para OS"]').checked = true;
  document.getElementById('mov-quantidade').value = '';
  document.getElementById('mov-observacao').value = '';
  preencherMateriaisRetirada();
  document.getElementById('ret-modal').style.display = 'flex';
  atualizarInfoRetirada();
  setTimeout(() => document.getElementById('mov-material').focus(), 50);
}
function fecharRetirada() { document.getElementById('ret-modal').style.display = 'none'; retiradaOS = null; }
function tipoRetirada() { return (document.querySelector('input[name=ret-tipo]:checked') || {}).value || 'Retirada do estoque para OS'; }
/** Materiais com saldo primeiro; os do mesmo tipo de material da OS no topo. */
function preencherMateriaisRetirada() {
  const sel = document.getElementById('mov-material');
  const tipoOS = retiradaOS && retiradaOS.material;
  const ativos = materiaisCadastro.filter(m => m.ativo !== false);
  const rot = m => escMelhoria(m.descricao || m.codigo) + ' — saldo ' + numeroMaterial(saldoMaterial(m.id)) + ' ' + escMelhoria(m.unidade || '');
  const ord = l => l.sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
  const doTipo = ord(ativos.filter(m => tipoOS && m.tipo === tipoOS && saldoMaterial(m.id) > 0));
  const comSaldo = ord(ativos.filter(m => saldoMaterial(m.id) > 0 && !doTipo.includes(m)));
  const sem = ord(ativos.filter(m => saldoMaterial(m.id) <= 0));
  const grupo = (titulo, l) => l.length ? '<optgroup label="' + titulo + '">' + l.map(m => '<option value="' + Number(m.id) + '">' + rot(m) + '</option>').join('') + '</optgroup>' : '';
  sel.innerHTML = '<option value="">— escolha o material —</option>' + grupo(escMelhoria(tipoOS || '') + ' (tipo da OS)', doTipo) +
    grupo('Com saldo', comSaldo) + grupo('Sem saldo', sem);
  if (doTipo.length === 1) sel.value = doTipo[0].id;
}
function atualizarInfoRetirada() {
  const info = document.getElementById('mov-saldo-info');
  const m = materialPorId(document.getElementById('mov-material').value);
  const qtd = numNf(document.getElementById('mov-quantidade').value);
  if (!m) { info.innerHTML = ''; return; }
  const f = fatorMovimentoMaterial(tipoRetirada());
  const saldo = saldoMaterial(m.id), depois = saldo + f * qtd;
  info.className = 'mov-saldo-info' + (depois < 0 ? ' erro' : '');
  info.innerHTML = 'Saldo: <strong>' + numeroMaterial(saldo) + ' ' + escMelhoria(m.unidade || '') + '</strong>' +
    (qtd ? ' → depois: <strong>' + numeroMaterial(depois) + ' ' + escMelhoria(m.unidade || '') + '</strong>' + (depois < 0 ? ' — não há saldo suficiente' : '') : '');
}
async function registrarRetirada() {
  if (!retiradaOS) return;
  const materialId = document.getElementById('mov-material').value;
  const quantidade = numNf(document.getElementById('mov-quantidade').value);
  const tipo = tipoRetirada();
  const m = materialPorId(materialId);
  if (!m || !(quantidade > 0)) { alert('Escolha o material e a quantidade.'); return; }
  if (fatorMovimentoMaterial(tipo) < 0 && quantidade > saldoMaterial(m.id) + 1e-9) {
    alert('Não há saldo suficiente: ' + numeroMaterial(saldoMaterial(m.id)) + ' ' + (m.unidade || '') + '.\n\nSe o material foi comprado para esta OS, use "Lançar NF".');
    return;
  }
  const btn = document.getElementById('btn-registrar-mov');
  btn.disabled = true;
  const r = await gravarMovimentoAvulso({ tipo, materialId: m.id, quantidade, os: retiradaOS.os, cliente: retiradaOS.cliente,
    observacao: document.getElementById('mov-observacao').value.trim() });
  btn.disabled = false;
  if (!r.ok) { alert('Não foi registrado.\n\n' + (r.erro || 'Erro desconhecido.')); return; }
  fecharRetirada();
  renderMateriais();
  if (window.renderMateriaisDaOSAtual) renderMateriaisDaOSAtual();
}

/* ======================= MATERIAL (janela Ver) ======================= */
let materialAbertoId = null;
function abrirMaterial(id) {
  materialAbertoId = id;
  const novo = id === null;
  const m = novo ? null : materialPorId(id);
  if (!novo && !m) return;
  document.getElementById('hist-title').textContent = novo ? 'Cadastrar material' : (m.descricao || m.codigo);
  document.getElementById('mat-acoes').style.display = novo ? 'none' : '';
  document.getElementById('mat-parte-ajuste').style.display = 'none';
  document.getElementById('mat-parte-editar').style.display = novo ? '' : 'none';
  if (novo) { limparFormMaterial(); currentMaterialId = null; } else preencherCamposMaterial(m);
  document.getElementById('mat-excluir').style.display = novo ? 'none' : '';
  document.getElementById('mat-excluir').textContent = m && m.ativo === false ? 'Reativar material' : 'Excluir / inativar';
  const btnEx = document.getElementById('mat-btn-excluir');
  if (btnEx && m) {
    btnEx.textContent = m.ativo === false ? '↺ Reativar' : '🗑 Excluir';
    btnEx.className = (m.ativo === false ? 'btn-success' : 'btn-danger') + ' btn-sm';
  }
  renderHistoricoMaterial();
  document.getElementById('hist-modal').style.display = 'flex';
  if (novo) setTimeout(() => document.getElementById('m-descricao').focus(), 50);
}
function abrirHistoricoMaterial(id) { abrirMaterial(id); }
function fecharMaterial() { document.getElementById('hist-modal').style.display = 'none'; materialAbertoId = null; }
function preencherCamposMaterial(m) {
  currentMaterialId = m.id;
  document.getElementById('m-codigo').value = m.codigo || '';
  document.getElementById('m-descricao').value = m.descricao || '';
  document.getElementById('m-especificacao').value = m.especificacao || '';
  document.getElementById('m-unidade').value = m.unidade || '';
  document.getElementById('m-minimo').value = m.minimo || '';
  document.getElementById('m-localizacao').value = m.localizacao || '';
  document.getElementById('m-ativo').value = String(m.ativo !== false);
  atualizarSelectTipoMaterialForm(m.tipo || '');
}
function mostrarParteMaterial(parte) {
  ['ajuste', 'editar'].forEach(p => {
    const el = document.getElementById('mat-parte-' + p);
    el.style.display = p === parte && el.style.display === 'none' ? '' : 'none';
  });
  if (parte === 'ajuste') { document.getElementById('aj-qtd').value = ''; document.getElementById('aj-obs').value = ''; atualizarInfoAjuste(); document.getElementById('aj-qtd').focus(); }
}
function atualizarInfoAjuste() {
  const m = materialPorId(materialAbertoId);
  const info = document.getElementById('aj-info');
  if (!m) { info.innerHTML = ''; return; }
  const qtd = numNf(document.getElementById('aj-qtd').value);
  const saldo = saldoMaterial(m.id), depois = saldo + fatorMovimentoMaterial(document.getElementById('aj-tipo').value) * qtd;
  info.className = 'mov-saldo-info' + (depois < 0 ? ' erro' : '');
  info.innerHTML = 'Saldo: <strong>' + numeroMaterial(saldo) + ' ' + escMelhoria(m.unidade || '') + '</strong>' + (qtd ? ' → depois: <strong>' + numeroMaterial(depois) + '</strong>' : '');
}
async function salvarAjusteMaterial() {
  const m = materialPorId(materialAbertoId);
  const tipo = document.getElementById('aj-tipo').value;
  const quantidade = numNf(document.getElementById('aj-qtd').value);
  if (!m || !(quantidade > 0)) { alert('Informe a quantidade.'); return; }
  if (fatorMovimentoMaterial(tipo) < 0 && quantidade > saldoMaterial(m.id) + 1e-9) { alert('O saldo é só ' + numeroMaterial(saldoMaterial(m.id)) + ' ' + (m.unidade || '') + '.'); return; }
  const btn = document.getElementById('btn-ajuste');
  btn.disabled = true;
  const r = await gravarMovimentoAvulso({ tipo, materialId: m.id, quantidade, observacao: document.getElementById('aj-obs').value.trim() });
  btn.disabled = false;
  if (!r.ok) { alert('Não foi registrado.\n\n' + (r.erro || 'Erro desconhecido.')); return; }
  document.getElementById('mat-parte-ajuste').style.display = 'none';
  renderMateriais();
  renderHistoricoMaterial();
}
function salvarMaterialAberto() {
  if (!salvarMaterial()) return;   // valida, grava no navegador e envia para a planilha
  fecharMaterial();
  renderMateriais();
}
/** Botão 🗑 / ↺ da própria lista do estoque. */
function excluirDaLista(id) {
  const m = materialPorId(id);
  if (!m) return;
  if (m.ativo === false) reativarMaterial(id); else excluirMaterial(id);
  renderMateriais();
}
function excluirMaterialAberto() {
  const m = materialPorId(materialAbertoId);
  if (!m) return;
  if (m.ativo === false) reativarMaterial(m.id);
  else if (excluirMaterial(m.id) === false) return;   // cancelou
  fecharMaterial();
  renderMateriais();
}

/* ---------- histórico (dentro da janela do material) ---------- */
function linhaMovimento(m, apos) {
  const material = materialPorId(m.materialId);
  const f = fatorMovimentoMaterial(m.tipo);
  const sinal = f < 0 ? '−' : (f > 0 ? '+' : '');
  const classe = f < 0 ? 'material-low' : (f > 0 ? 'material-ok' : 'mov-neutro');
  return '<tr>' +
    '<td>' + escMelhoria(fmtDate(m.data) || '—') + '</td>' +
    '<td>' + escMelhoria(m.tipo || '—') + (m.os ? '<br><small>' + escMelhoria(m.os) + '</small>' : '') + '</td>' +
    '<td class="' + classe + '">' + sinal + numeroMaterial(m.quantidade) + '</td>' +
    '<td>' + escMelhoria(origemMovimento(m)) + '</td>' +
    '<td>' + (material && f !== 0 ? numeroMaterial(apos[m.id]) : '—') + '</td>' +
  '</tr>';
}
function renderHistoricoMaterial() {
  const id = materialAbertoId;
  const body = document.getElementById('hist-body');
  const resumo = document.getElementById('mat-resumo');
  if (id === null) { body.innerHTML = ''; resumo.innerHTML = ''; return; }
  const m = materialPorId(id);
  const apos = saldosAposMovimentos();
  const movs = movimentosMateriais.filter(x => String(x.materialId) === String(id))
    .sort((a, b) => String(b.timestamp || b.data).localeCompare(String(a.timestamp || a.data)) || b.id - a.id);
  const un = escMelhoria(m.unidade || '');
  resumo.innerHTML = '<div class="mx-resumo">' +
    '<div><span>Saldo</span><strong>' + numeroMaterial(saldoMaterial(id)) + ' ' + un + '</strong></div>' +
    '<div><span>Valor médio</span><strong>' + moedaMaterial(custoMedioMaterial(id)) + '</strong></div>' +
    '<div><span>Código</span><strong>' + escMelhoria(m.codigo) + '</strong></div>' +
    (m.tipo ? '<div><span>Tipo</span><strong>' + escMelhoria(m.tipo) + '</strong></div>' : '') + '</div>';
  body.innerHTML = '<h4 class="mx-subtitulo">Movimentações</h4><div class="materials-table-wrap" style="max-height:45vh;"><table class="data"><thead><tr><th>Data</th><th>O quê</th><th>Qtd.</th><th>Origem</th><th>Saldo após</th></tr></thead><tbody>' +
    (movs.length ? movs.map(x => linhaMovimento(x, apos)).join('') : '<tr><td colspan="5" class="empty">Sem movimentações.</td></tr>') + '</tbody></table></div>';
}
function exportarHistoricoMaterial() {
  const material = materialPorId(materialAbertoId);
  if (!material) return;
  const apos = saldosAposMovimentos();
  const movs = movimentosMateriais.filter(m => String(m.materialId) === String(materialAbertoId))
    .sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)) || a.id - b.id);
  baixarCsvMateriais('historico-' + material.codigo, ['data', 'tipo', 'quantidade', 'efeito_no_saldo', 'valor', 'origem', 'os', 'cliente', 'saldo_apos', 'observacao'],
    movs.map(m => [m.data, m.tipo, m.quantidade, fatorMovimentoMaterial(m.tipo) * numNf(m.quantidade), valorMovimento(m), origemMovimento(m), m.os, m.cliente, apos[m.id], m.observacao]));
}
function exportarMovimentosMateriais() {
  if (!movimentosMateriais.length) { alert('Ainda não há movimentações para exportar.'); return; }
  const apos = saldosAposMovimentos();
  baixarCsvMateriais('movimentacoes-materiais',
    ['data', 'tipo', 'codigo', 'descricao', 'unidade', 'quantidade', 'efeito_no_saldo', 'valor_unitario', 'valor_total', 'origem', 'os', 'cliente', 'fornecedor', 'saldo_apos', 'lote', 'dimensao', 'observacao'],
    movimentosMateriais.map(m => {
      const material = materialPorId(m.materialId);
      return [m.data, m.tipo, material && material.codigo, material && material.descricao, material && material.unidade, m.quantidade,
        fatorMovimentoMaterial(m.tipo) * numNf(m.quantidade), m.custoUnitario, valorMovimento(m), origemMovimento(m), m.os, m.cliente, m.fornecedor,
        material ? apos[m.id] : '', m.lote, m.dimensao, m.observacao];
    }));
}

/* ======================= MATERIAIS NA OS ======================= */
function renderMateriaisDaOS(s) {
  const box = document.getElementById('os-materiais');
  if (!box || !s) return;
  const sel = document.getElementById('f-material');
  const info = document.getElementById('f-material-saldo');
  if (info) {
    const tipoSel = sel && sel.value && tiposMaterialAtivos().includes(sel.value) ? saldoPorTipo(sel.value) : null;
    const m = tipoSel ? null : (sel && sel.value ? materialPorTexto(sel.value) || materialPorCodigo(String(sel.value).split(' — ')[0]) : null);
    if (tipoSel) {
      info.innerHTML = tipoSel.comSaldo.length
        ? '✓ Em estoque: ' + tipoSel.comSaldo.map(x => escMelhoria(x.descricao || x.codigo) + ' (' + numeroMaterial(saldoMaterial(x.id)) + ' ' + escMelhoria(x.unidade || '') + ')').join(' · ')
        : '⚠ Sem ' + escMelhoria(sel.value) + ' no estoque';
      info.style.color = tipoSel.comSaldo.length ? '#15803d' : '#b45309';
    } else {
      info.innerHTML = !sel || !sel.value ? '' : m ? (saldoMaterial(m.id) > 0 ? '✓ Em estoque: ' + numeroMaterial(saldoMaterial(m.id)) + ' ' + escMelhoria(m.unidade || '') : '⚠ Sem saldo no estoque') : '';
      info.style.color = m && saldoMaterial(m.id) > 0 ? '#15803d' : '#b45309';
    }
  }
  const movs = movimentosMateriais.filter(m => movimentoDaOS(m, s))
    .sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)));
  const custoUso = m => fatorMovimentoMaterial(m.tipo) < 0 || TIPOS_NEUTROS_MAT.includes(m.tipo) ? valorMovimento(m) : (m.tipo === 'Sobra' ? -valorMovimento(m) : 0);
  const total = movs.reduce((t, m) => t + custoUso(m), 0);
  const como = m => m.tipo === 'Compra direta para OS' ? 'Comprado' : m.tipo === 'Outros (sem efeito no estoque)' ? 'Despesa' : m.tipo === 'Sobra' ? 'Sobra devolvida' : fatorMovimentoMaterial(m.tipo) < 0 ? 'Do estoque' : m.tipo;
  box.innerHTML =
    '<div class="os-materiais-head"><h4>Materiais da OS</h4><div class="spacer"></div>' +
      '<button type="button" class="btn-warning btn-sm" onclick="retirarParaOS()">📤 Retirar do estoque</button>' +
      '<button type="button" class="btn-primary btn-sm" onclick="lancarNfParaOS()">🧾 Lançar NF</button></div>' +
    (movs.length
      ? '<table class="data os-mat-tab"><tbody>' +
        movs.map(m => {
          const mat = materialPorId(m.materialId);
          return '<tr><td>' + escMelhoria(fmtDate(m.data)) + '</td><td>' + escMelhoria(como(m)) + '</td>' +
            '<td>' + escMelhoria(mat ? mat.descricao || mat.codigo : (m.observacao || '').split('|')[0]) + '</td>' +
            '<td>' + (m.tipo === 'Sobra' ? '−' : '') + numeroMaterial(m.quantidade) + ' ' + escMelhoria(mat ? mat.unidade : '') + '</td>' +
            '<td style="text-align:right;">' + (valorMovimento(m) ? moedaNf(custoUso(m)) : '—') + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="4" style="text-align:right;"><strong>Custo de material</strong></td><td style="text-align:right;"><strong>' + moedaNf(total) + '</strong></td></tr></tfoot></table>'
      : '<div class="os-mat-vazio">Nada lançado ainda.</div>');
}
window.renderMateriaisDaOSAtual = function () {
  const s = servicos.find(x => x.id === currentId);
  if (s && document.getElementById('edit-panel').style.display !== 'none') renderMateriaisDaOS(s);
};
function osAbertaNoPainel() {
  const s = servicos.find(x => x.id === currentId);
  return s ? { os: osItemServico(s), cliente: s.cliente || '' } : { os: '', cliente: '' };
}
/** Abre a NF por cima da própria OS (sem trocar de aba). */
function lancarNfParaOS() { novaNf(osAbertaNoPainel()); }

/* ======================= TIPOS DE MATERIAL (Cadastros) ======================= */
/* Ex.: A-36, SAE 1045, SAE 1010 / 1016. Usados no campo Material da OS e no cadastro do estoque. */
let tiposMaterialRemoto = null;
let backendSemTipos = false;
function tiposMaterialAtivos() {
  return (tiposMaterialRemoto || []).filter(t => t.ativo !== false && t.nome)
    .map(t => String(t.nome).trim()).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}
async function fetchTiposMaterial() {
  const url = getSyncUrl();
  if (!url) return null;
  try {
    const r = await fetch(url + '?action=list-tipos-material', { method: 'GET', redirect: 'follow' }).then(x => x.json());
    if (r.ok) { backendSemTipos = false; tiposMaterialRemoto = r.tipos || []; localStorage.setItem(chave('tipos_material'), JSON.stringify(tiposMaterialRemoto)); return tiposMaterialRemoto; }
    if (/Ação desconhecida/i.test(r.erro || '')) backendSemTipos = true;
  } catch (e) {}
  return null;
}
function atualizarSelectTipoMaterialForm(valor) {
  const sel = document.getElementById('m-tipo');
  if (!sel) return;
  const v = valor !== undefined ? String(valor || '') : sel.value;
  const tipos = tiposMaterialAtivos();
  sel.innerHTML = '<option value="">— sem tipo —</option>' +
    (v && !tipos.includes(v) ? '<option value="' + escMelhoria(v) + '">' + escMelhoria(v) + ' (inativo)</option>' : '') +
    tipos.map(t => '<option value="' + escMelhoria(t) + '">' + escMelhoria(t) + '</option>').join('');
  sel.value = v;
}
function atualizarSelectsTipoMaterial() {
  atualizarSelectTipoMaterialForm();
  const f = document.getElementById('filter-material-tipo');
  if (f) {
    const v = f.value;
    f.innerHTML = '<option value="">Todos os tipos</option>' + tiposMaterialAtivos().map(t => '<option value="' + escMelhoria(t) + '">' + escMelhoria(t) + '</option>').join('') + '<option value="__sem">Sem tipo</option>';
    f.value = v;
  }
  const s = servicos.find(x => x.id === currentId);
  if (s && document.getElementById('edit-panel').style.display !== 'none') atualizarSelectMaterialServico(s.material || '');
}
function limparFormTipoMaterial() {
  document.getElementById('ftm-nome').value = '';
  document.getElementById('ftm-observacao').value = '';
  document.getElementById('ftm-ativo').value = 'true';
  document.getElementById('ftm-feedback').textContent = '';
}
function avisoTipo(txt, cor) { const fb = document.getElementById('ftm-feedback'); fb.textContent = txt; fb.style.color = cor; }
function depoisDeMudarTipos() { localStorage.setItem(chave('tipos_material'), JSON.stringify(tiposMaterialRemoto || [])); renderTiposMaterial(); atualizarSelectsTipoMaterial(); }

/** Cadastro novo: aparece na lista na hora; a planilha é gravada em segundo plano. */
async function salvarTipoMaterial() {
  const nome = document.getElementById('ftm-nome').value.trim().replace(/\s+/g, ' ');
  if (!nome) { alert('Informe o tipo de material (ex.: SAE 1045).'); return; }
  const lista = tiposMaterialRemoto || (tiposMaterialRemoto = []);
  const igual = lista.find(t => chaveTexto(t.nome) === chaveTexto(nome));
  if (igual) { alert('"' + igual.nome + '" já está cadastrado. Para mudar, use Editar na lista.'); return; }
  const novo = { nome, observacao: document.getElementById('ftm-observacao').value.trim(), ativo: document.getElementById('ftm-ativo').value !== 'false' };
  lista.push(novo);
  depoisDeMudarTipos();
  limparFormTipoMaterial();
  avisoTipo('✓ salvo', '#16a34a');
  document.getElementById('ftm-nome').focus();
  const r = await postarPlanilha(Object.assign({ kind: 'tipo-material' }, novo));
  if (!r.ok) {
    if (/kind desconhecido/i.test(r.erro || '')) backendSemTipos = true;
    tiposMaterialRemoto = lista.filter(t => t !== novo);
    depoisDeMudarTipos();
    avisoTipo('✗ "' + nome + '" não foi salvo: ' + (backendSemTipos ? 'atualize o Apps Script' : (r.erro || 'erro')), '#dc2626');
  }
}

/* edição na própria linha da tabela */
let tipoEditando = null;
function editarTipoMaterial(i) {
  tipoEditando = i;
  renderTiposMaterial();
  const inp = document.getElementById('ftm-ed-nome');
  if (inp) { inp.focus(); inp.select(); }
}
function cancelarEdicaoTipo() { tipoEditando = null; renderTiposMaterial(); }
async function salvarEdicaoTipo(i) {
  const t = (tiposMaterialRemoto || [])[i];
  if (!t) return;
  const antigo = t.nome;
  const nome = document.getElementById('ftm-ed-nome').value.trim().replace(/\s+/g, ' ');
  const observacao = document.getElementById('ftm-ed-obs').value.trim();
  if (!nome) { alert('O nome não pode ficar vazio.'); return; }
  const outro = tiposMaterialRemoto.find((x, j) => j !== i && chaveTexto(x.nome) === chaveTexto(nome));
  if (outro) { alert('Já existe o tipo "' + outro.nome + '".'); return; }
  const renomeou = nome !== antigo;
  const osAfetadas = renomeou ? servicos.filter(s => !s.excluido && String(s.material || '').trim() === antigo) : [];
  const matsAfetados = renomeou ? materiaisCadastro.filter(m => m.tipo === antigo) : [];
  if (renomeou && (osAfetadas.length || matsAfetados.length) &&
      !confirm('Trocar "' + antigo + '" por "' + nome + '"?\n\n' +
        (osAfetadas.length ? osAfetadas.length + ' OS ' : '') + (osAfetadas.length && matsAfetados.length ? 'e ' : '') +
        (matsAfetados.length ? matsAfetados.length + ' material(is) do estoque ' : '') + 'passam a usar o nome novo.')) return;
  // aplica na tela na hora
  Object.assign(t, { nome, observacao });
  tipoEditando = null;
  osAfetadas.forEach(s => { s.material = nome; });
  matsAfetados.forEach(m => { m.tipo = nome; });
  if (osAfetadas.length) { saveServicos(); renderServicos(); }
  if (matsAfetados.length) saveMateriais();
  depoisDeMudarTipos();
  avisoTipo('✓ alterado', '#16a34a');
  // grava na planilha
  const r = await postarPlanilha({ kind: 'tipo-material', nome, nomeAnterior: antigo, observacao, ativo: t.ativo !== false });
  if (!r.ok) { avisoTipo('✗ não foi salvo na planilha: ' + (r.erro || 'erro'), '#dc2626'); await fetchTiposMaterial(); depoisDeMudarTipos(); return; }
  if (renomeou && !r.renomeado) {
    // Apps Script anterior à 1.5.2: criou o nome novo; inativa o antigo e acerta os materiais por aqui
    await postarPlanilha({ kind: 'tipo-material', nome: antigo, observacao, ativo: false });
    for (const m of matsAfetados) await enviarMaterialSheets(m);
    await fetchTiposMaterial(); depoisDeMudarTipos();
  }
}
async function alternarTipoMaterial(i) {
  const t = (tiposMaterialRemoto || [])[i];
  if (!t) return;
  const ativar = t.ativo === false;
  if (!ativar && !confirm('Inativar "' + t.nome + '"? Ele sai das listas, mas as OS e materiais que já usam continuam com ele.')) return;
  t.ativo = ativar;
  depoisDeMudarTipos();
  const r = await postarPlanilha({ kind: 'tipo-material', nome: t.nome, observacao: t.observacao || '', ativo: ativar });
  if (!r.ok) { t.ativo = !ativar; depoisDeMudarTipos(); alert('Não foi possível alterar: ' + (r.erro || 'erro')); }
}
function renderTiposMaterial() {
  const tbody = document.getElementById('tbody-tipos-material');
  if (!tbody) return;
  const aviso = document.getElementById('ftm-aviso');
  if (aviso) aviso.style.display = backendSemTipos ? '' : 'none';
  const lista = (tiposMaterialRemoto || []).map((t, i) => Object.assign({ i }, t))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }));
  if (!lista.length) { tbody.innerHTML = '<tr><td colspan="5" class="mat-empty">Nenhum tipo cadastrado. Ex.: A-36, SAE 1045, SAE 1010 / 1016.</td></tr>'; return; }
  const usoOS = nome => servicos.filter(s => !s.excluido && String(s.material || '').trim() === nome).length;
  const usoMat = nome => materiaisCadastro.filter(m => m.tipo === nome).length;
  tbody.innerHTML = lista.map(t => {
    if (t.i === tipoEditando) {
      const tecla = 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();salvarEdicaoTipo(' + t.i + ');} if(event.key===\'Escape\'){cancelarEdicaoTipo();}"';
      return '<tr class="tipo-editando">' +
        '<td><input id="ftm-ed-nome" value="' + escMelhoria(t.nome) + '" ' + tecla + '></td>' +
        '<td><input id="ftm-ed-obs" value="' + escMelhoria(t.observacao || '') + '" placeholder="opcional" ' + tecla + '></td>' +
        '<td>' + usoOS(t.nome) + ' OS · ' + usoMat(t.nome) + ' no estoque</td><td></td>' +
        '<td class="actions"><button class="btn-success btn-sm" onclick="salvarEdicaoTipo(' + t.i + ')">💾 Salvar</button> ' +
          '<button class="btn-secondary btn-sm" onclick="cancelarEdicaoTipo()">Cancelar</button></td>' +
      '</tr>';
    }
    return '<tr>' +
      '<td><strong>' + escMelhoria(t.nome) + '</strong></td>' +
      '<td>' + escMelhoria(t.observacao || '—') + '</td>' +
      '<td>' + usoOS(t.nome) + ' OS · ' + usoMat(t.nome) + ' no estoque</td>' +
      '<td>' + (t.ativo === false ? '<span class="mat-badge inativo">Inativo</span>' : '<span class="mat-badge ok">Ativo</span>') + '</td>' +
      '<td class="actions"><button class="btn-primary btn-sm" onclick="editarTipoMaterial(' + t.i + ')">✎ Editar</button> ' +
        '<button class="' + (t.ativo === false ? 'btn-success' : 'btn-danger') + ' btn-sm" onclick="alternarTipoMaterial(' + t.i + ')">' + (t.ativo === false ? 'Reativar' : 'Inativar') + '</button></td>' +
    '</tr>';
  }).join('');
}
/** Saldo em estoque de todos os materiais de um tipo. */
function saldoPorTipo(nome) {
  const mats = materiaisCadastro.filter(m => m.ativo !== false && m.tipo === nome);
  return { mats, saldo: mats.reduce((t, m) => t + Math.max(0, saldoMaterial(m.id)), 0), comSaldo: mats.filter(m => saldoMaterial(m.id) > 0) };
}

/* ======================= INÍCIO ======================= */
(function initNf() {
  carregarNfsLocal();
  try { const t = JSON.parse(localStorage.getItem(chave('tipos_material')) || 'null'); if (Array.isArray(t)) tiposMaterialRemoto = t; } catch (e) {}
  atualizarSelectsTipoMaterial();
  if (!document.getElementById('dl-unidades')) {
    const dl = document.createElement('datalist');
    dl.id = 'dl-unidades';
    dl.innerHTML = ['kg', 'barra', 'peça', 'metro', 'chapa', 'litro', 'unidade', 'caixa', 'serviço'].map(u => '<option value="' + u + '"></option>').join('');
    document.body.appendChild(dl);
  }
  // Ao carregar materiais/movimentações em segundo plano, a OS aberta e as listas acompanham
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (nfEditorAberto()) fecharNf();
    else if (document.getElementById('ret-modal').style.display !== 'none') fecharRetirada();
    else if (document.getElementById('hist-modal').style.display !== 'none') fecharMaterial();
  });
  atualizarAvisoBackendNf();
})();
