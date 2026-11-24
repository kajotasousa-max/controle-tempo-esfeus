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
  { valor: 'Compra para estoque', curto: 'Estoque', estoque: true },
  { valor: 'Entrada em estoque', curto: 'Estoque', estoque: true },
  { valor: 'Consumo direto na OS', curto: 'Direto OS', estoque: false, exigeOS: true },
  { valor: 'Outros (sem efeito no estoque)', curto: 'Outros', estoque: false }
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
function switchMatSub(sub) {
  document.querySelectorAll('.mat-subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
  document.querySelectorAll('.mat-sub').forEach(d => d.classList.toggle('active', d.id === 'mat-sub-' + sub));
  if (sub === 'nf') renderNfs();
  if (sub === 'estoque') renderMateriais();
  if (sub === 'mov') { atualizarSelectMateriais(); atualizarCamposMovimentoMat(); renderMovimentacoesMateriais(); }
}

/* ======================= LISTA DE NFs ======================= */
function statusMovNf(nf) {
  const tipos = unicos((nf.itens || []).map(i => tipoNf(i.tipo).curto));
  const comMov = (nf.itens || []).filter(i => tipoNf(i.tipo).estoque || tipoNf(i.tipo).exigeOS);
  const faltando = comMov.filter(i => !movimentosMateriais.some(m => m.itemNfId === i.id));
  const badges = tipos.map(t => '<span class="nf-tag nf-tag-' + semAcento(t).replace(/\s+/g, '-') + '">' + t + '</span>').join(' ');
  if (!comMov.length) return badges + ' <span class="nf-mov-ok">sem efeito no estoque</span>';
  // A lista de movimentações pode ainda não ter chegado da planilha: só alerta quando já carregou
  if (faltando.length && movimentosMateriais.length) return badges + ' <span class="nf-mov-pend" title="Clique em Atualizar">⚠ conferir</span>';
  return badges + ' <span class="nf-mov-ok">✓ movimentado</span>';
}
function nfsFiltradas() {
  const busca = semAcento(document.getElementById('search-nf').value || '');
  const tipo = document.getElementById('filter-nf-tipo').value;
  const mes = document.getElementById('filter-nf-mes').value;
  return notasFiscais.filter(nf => {
    if (mes && String(nf.data || '').slice(0, 7) !== mes) return false;
    const t = totaisNf(nf);
    if (tipo === 'estoque' && !(nf.itens || []).some(i => tipoNf(i.tipo).estoque)) return false;
    if (tipo === 'direto' && !(nf.itens || []).some(i => tipoNf(i.tipo).exigeOS)) return false;
    if (tipo === 'outros' && (t.estoque || t.direto)) return false;
    if (busca) {
      const hay = semAcento([nf.numero, nf.fornecedor, nf.observacao, osDaNf(nf).join(' '), clientesDaNf(nf).join(' '),
        (nf.itens || []).map(i => i.descricao + ' ' + i.codigo).join(' ')].join(' '));
      if (!hay.includes(busca)) return false;
    }
    return true;
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
}
function renderNfs() {
  const tbody = document.getElementById('tbody-nfs');
  if (!tbody) return;
  atualizarAvisoBackendNf();
  const lista = nfsFiltradas();
  const soma = k => lista.reduce((t, nf) => t + totaisNf(nf)[k], 0);
  document.getElementById('nf-kpi-qtd').textContent = lista.length;
  document.getElementById('nf-kpi-valor').textContent = moedaNf(soma('total'));
  document.getElementById('nf-kpi-estoque').textContent = moedaNf(soma('estoque'));
  document.getElementById('nf-kpi-direto').textContent = moedaNf(soma('direto'));
  document.getElementById('nf-count').textContent = lista.length + ' NF' + (lista.length === 1 ? '' : 's');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">' + (notasFiscais.length ? 'Nenhuma NF neste filtro.' : 'Nenhuma NF lançada ainda. Clique em <strong>+ Nova NF</strong>.') + '</td></tr>';
    return;
  }
  const lim = (arr, n) => arr.length > n ? arr.slice(0, n).join(', ') + ' +' + (arr.length - n) : arr.join(', ');
  tbody.innerHTML = lista.map(nf => {
    const os = osDaNf(nf), cli = clientesDaNf(nf);
    return '<tr onclick="abrirNf(\'' + escMelhoria(nf.id) + '\')" title="Abrir a NF">' +
      '<td><strong>' + escMelhoria(nf.numero || '—') + '</strong></td>' +
      '<td>' + escMelhoria(fmtDate(nf.data) || '—') + '</td>' +
      '<td>' + escMelhoria(nf.fornecedor || '—') + '</td>' +
      '<td title="' + escMelhoria(os.join(', ')) + '">' + escMelhoria(lim(os, 3) || '—') + '</td>' +
      '<td title="' + escMelhoria(cli.join(', ')) + '">' + escMelhoria(lim(cli, 2) || '—') + '</td>' +
      '<td style="text-align:center;">' + (nf.itens || []).length + '</td>' +
      '<td style="text-align:right;"><strong>' + moedaNf(totaisNf(nf).total) + '</strong></td>' +
      '<td>' + statusMovNf(nf) + '</td>' +
    '</tr>';
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
  const os = (pref && pref.os) || umaOS;
  const s = servicoPorOS(os);
  return { id: idLocal('IT'), descricao: '', codigo: '', unidade: '', quantidade: '', valorUnitario: '', frete: '',
    os: os, cliente: (s && s.cliente) || ((nf.clientes || []).length === 1 ? nf.clientes[0] : ''),
    tipo: os ? 'Consumo direto na OS' : 'Compra para estoque', dataMovimentacao: nf.data || hojeLocal(), observacao: '' };
}
/** Abre uma NF nova. pref = { os, cliente } quando vem da OS. */
function novaNf(pref) {
  if (getSyncUrl() && !backendTemNf()) { atualizarAvisoBackendNf(); alert('Atualize o Apps Script para a versão 1.5.0 antes de lançar NFs.'); return; }
  pref = pref || {};
  const nf = { id: idLocal('NF'), numero: '', data: hojeLocal(), fornecedor: '', os: pref.os ? [pref.os] : [],
    clientes: pref.cliente ? [pref.cliente] : [], observacao: '', itens: [], nova: true };
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
  document.getElementById('nf-modal-title').textContent = nf.nova ? 'Nova nota fiscal' : 'NF ' + (nf.numero || '') + (nf.fornecedor ? ' · ' + nf.fornecedor : '');
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
  if (tp.exigeOS) return it.os ? 'Compra direcionada à OS ' + escMelhoria(it.os) + ' — não entra no estoque geral.' : '<span class="nf-erro">Escolha a OS deste item.</span>';
  if (!tp.estoque) return 'Registrado na NF, sem efeito no estoque.';
  const m = materialDoItem(it);
  if (!it.descricao) return '';
  if (!m) return '🆕 Material novo: será cadastrado no estoque ao salvar.';
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
    const inp = (campo, extra) => '<input ' + (extra || '') + ' value="' + escMelhoria(it[campo] === undefined ? '' : it[campo]) + '" oninput="nfItemCampo(' + i + ',\'' + campo + '\', this.value)">';
    const osOpts = '<option value="">' + (tp.exigeOS ? '— escolha —' : '—') + '</option>' +
      (it.os && !opOS.some(o => o.valor === it.os) ? '<option selected>' + escMelhoria(it.os) + '</option>' : '') +
      opOS.map(o => '<option value="' + escMelhoria(o.valor) + '"' + (o.valor === it.os ? ' selected' : '') + '>' + escMelhoria(o.valor + (o.cliente ? ' · ' + o.cliente : '')) + '</option>').join('');
    return '<tr class="nf-item nf-item-' + (tp.estoque ? 'estoque' : tp.exigeOS ? 'direto' : 'outros') + '">' +
      '<td class="nf-n">' + (i + 1) + '</td>' +
      '<td><input list="dl-materiais" value="' + escMelhoria(it.descricao) + '" placeholder="Digite o produto" oninput="nfEditando.itens[' + i + '].descricao=this.value" onchange="nfItemCampo(' + i + ',\'descricao\', this.value)"></td>' +
      '<td>' + inp('unidade', 'class="nf-un" list="dl-unidades" placeholder="un"') + '</td>' +
      '<td>' + inp('quantidade', 'type="number" min="0" step="0.001" class="nf-num"') + '</td>' +
      '<td>' + inp('valorUnitario', 'type="number" min="0" step="0.01" class="nf-num"') + '</td>' +
      '<td>' + inp('frete', 'type="number" min="0" step="0.01" class="nf-num" placeholder="opcional"') + '</td>' +
      '<td class="nf-tot" id="nf-tot-' + i + '">' + moedaNf(totalItemNf(it)) + '</td>' +
      '<td><select onchange="nfItemCampo(' + i + ',\'tipo\', this.value)">' + NF_TIPOS.map(t => '<option' + (t.valor === it.tipo ? ' selected' : '') + '>' + t.valor + '</option>').join('') + '</select></td>' +
      '<td><select onchange="nfItemCampo(' + i + ',\'os\', this.value)"' + (tp.exigeOS && !it.os ? ' class="nf-campo-erro"' : '') + '>' + osOpts + '</select></td>' +
      '<td>' + inp('cliente', 'list="dl-clientes"') + '</td>' +
      '<td><input type="date" value="' + escMelhoria(it.dataMovimentacao || '') + '" onchange="nfItemCampo(' + i + ',\'dataMovimentacao\', this.value)"></td>' +
      '<td><button type="button" class="btn-danger btn-sm" onclick="nfRemoverItem(' + i + ')" title="Remover item">✕</button></td>' +
    '</tr>' +
    '<tr class="nf-dica"><td></td><td colspan="11" id="nf-dica-' + i + '">' + dicaItemNf(it) + '</td></tr>';
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
  document.getElementById('nf-totais').innerHTML =
    '<span>' + nfEditando.itens.length + ' ite' + (nfEditando.itens.length === 1 ? 'm' : 'ns') + '</span>' +
    '<span>Mercadoria <strong>' + moedaNf(t.mercadoria) + '</strong></span>' +
    '<span>Frete <strong>' + moedaNf(t.frete) + '</strong></span>' +
    '<span class="nf-total-geral">Total da NF <strong>' + moedaNf(t.total) + '</strong></span>';
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

/* ======================= RETIRADA / AJUSTE SEM NF ======================= */
function atualizarCamposMovimentoMat() {
  const tipo = document.getElementById('mov-tipo').value;
  const materialId = document.getElementById('mov-material').value;
  const qtd = numNf(document.getElementById('mov-quantidade').value);
  const precisaOS = tipo === 'Retirada do estoque para OS' || tipo === 'Sobra';
  const osLabel = document.querySelector('#mov-os-wrap label');
  if (osLabel) osLabel.textContent = precisaOS ? 'OS *' : 'OS (opcional)';
  const info = document.getElementById('mov-saldo-info');
  const valor = document.getElementById('mov-valor');
  const m = materialPorId(materialId);
  if (!m) { info.innerHTML = ''; valor.value = ''; return; }
  const saldo = saldoMaterial(m.id), custo = custoMedioMaterial(m.id), f = fatorMovimentoMaterial(tipo);
  valor.value = custo && qtd ? moedaNf(custo * qtd) : (custo ? moedaNf(custo) + ' / ' + (m.unidade || 'un') : '');
  const depois = saldo + f * qtd;
  info.className = 'mov-saldo-info' + (depois < 0 ? ' erro' : '');
  info.innerHTML = 'Saldo atual de <strong>' + escMelhoria(m.codigo) + '</strong>: ' + numeroMaterial(saldo) + ' ' + escMelhoria(m.unidade || '') +
    (qtd ? ' → depois: <strong>' + numeroMaterial(depois) + '</strong>' + (depois < 0 ? ' — saldo insuficiente' : '') : '') +
    (f < 0 ? '<br>Origem: ' + (tipo === 'Retirada do estoque para OS' ? ORIGEM_SEM_NF : 'ajuste interno, sem NF') : '');
}
async function registrarMovimentoMaterial() {
  const materialId = document.getElementById('mov-material').value;
  const tipo = document.getElementById('mov-tipo').value;
  const quantidade = numNf(document.getElementById('mov-quantidade').value);
  const data = document.getElementById('mov-data').value || hojeLocal();
  const os = document.getElementById('mov-os').value.trim();
  const material = materialPorId(materialId);
  if (!material || !(quantidade > 0)) { alert('Selecione o material e informe uma quantidade maior que zero.'); return; }
  if ((tipo === 'Retirada do estoque para OS' || tipo === 'Sobra') && !os) { alert('Informe a OS.'); return; }
  if (os && !servicoPorOS(os) && !confirm('A OS "' + os + '" não está cadastrada no app. Registrar assim mesmo?')) return;
  const saldoAtual = saldoMaterial(materialId);
  if (fatorMovimentoMaterial(tipo) < 0 && quantidade > saldoAtual + 1e-9) {
    alert('Saldo insuficiente. Disponível: ' + numeroMaterial(saldoAtual) + ' ' + (material.unidade || '') + '.\n\nSe o material chegou e ainda não foi lançado, lance a NF primeiro.');
    return;
  }
  const custo = custoMedioMaterial(materialId);
  const mov = {
    id: nextMovimentoMaterialId++, uid: idLocal('MV'), data, timestamp: data + ' ' + new Date().toTimeString().slice(0, 8),
    tipo, materialId: Number(materialId), codigo: material.codigo, quantidade, custoUnitario: custo, valorTotal: arred2(custo * quantidade),
    os, cliente: document.getElementById('mov-cliente').value.trim(),
    origem: tipo === 'Retirada do estoque para OS' ? ORIGEM_SEM_NF : 'Ajuste interno (sem NF)',
    lote: document.getElementById('mov-lote').value.trim(), dimensao: document.getElementById('mov-dimensao').value.trim(),
    observacao: document.getElementById('mov-observacao').value.trim()
  };
  const btn = document.getElementById('btn-registrar-mov');
  if (getSyncUrl()) {
    btn.disabled = true;
    const r = await enviarMovimentoSheets(mov, material);
    btn.disabled = false;
    if (!r.ok) { alert('A movimentação não foi registrada.\n\n' + (r.erro || 'Erro desconhecido.')); return; }
  }
  movimentosMateriais.push(mov);
  saveMateriais();
  ['mov-quantidade', 'mov-os', 'mov-cliente', 'mov-lote', 'mov-dimensao', 'mov-observacao'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('mov-data').value = hojeLocal();
  atualizarCamposMovimentoMat();
  renderMateriais();
  if (window.renderMateriaisDaOSAtual) renderMateriaisDaOSAtual();
  alert('Movimentação registrada.');
}

/* ======================= HISTÓRICO ======================= */
function movimentoVisivel(m) {
  const material = materialPorId(m.materialId);
  return semAcento([m.data, m.tipo, material && material.codigo, material && material.descricao, m.os, m.cliente, origemMovimento(m),
    m.fornecedor, m.lote, m.dimensao, m.observacao].join(' '));
}
function linhaMovimento(m, apos, comMaterial) {
  const material = materialPorId(m.materialId);
  const f = fatorMovimentoMaterial(m.tipo);
  const sinal = f < 0 ? '−' : (f > 0 ? '+' : '');
  const classe = f < 0 ? 'material-low' : (f > 0 ? 'material-ok' : 'mov-neutro');
  const mat = material ? '<strong>' + escMelhoria(material.codigo) + '</strong><br><small>' + escMelhoria(material.descricao) + '</small>'
    : '<small>' + escMelhoria((m.observacao || '').split('|')[0] || 'Material removido') + '</small>';
  return '<tr>' +
    '<td>' + escMelhoria(fmtDate(m.data) || '—') + '</td>' +
    '<td>' + escMelhoria(m.tipo || '—') + '</td>' +
    (comMaterial ? '<td>' + mat + '</td>' : '') +
    '<td class="' + classe + '">' + sinal + numeroMaterial(m.quantidade) + ' ' + escMelhoria(material ? material.unidade : '') + '</td>' +
    '<td style="text-align:right;">' + (valorMovimento(m) ? moedaNf(valorMovimento(m)) : '—') + '</td>' +
    '<td>' + escMelhoria(origemMovimento(m)) + '</td>' +
    '<td>' + escMelhoria(m.os || '—') + '</td>' +
    '<td>' + escMelhoria(m.cliente || '—') + '</td>' +
    '<td>' + (material && f !== 0 ? numeroMaterial(apos[m.id]) : '—') + '</td>' +
    '<td title="' + escMelhoria(m.observacao || '') + '">' + escMelhoria([m.lote, m.dimensao, m.observacao].filter(Boolean).join(' · ') || '—') + '</td>' +
  '</tr>';
}
function renderMovimentacoesMateriais() {
  const tbody = document.getElementById('tbody-movimentos-materiais');
  if (!tbody) return;
  const busca = semAcento((document.getElementById('search-mov') || {}).value || '');
  const filtro = (document.getElementById('filter-mov-tipo') || {}).value || '';
  const apos = saldosAposMovimentos();
  const lista = movimentosMateriais.filter(m => {
    const f = fatorMovimentoMaterial(m.tipo);
    if (filtro === 'entrada' && f <= 0) return false;
    if (filtro === 'saida' && f >= 0) return false;
    if (filtro === 'direto' && m.tipo !== 'Compra direta para OS') return false;
    return !busca || movimentoVisivel(m).includes(busca);
  }).sort((a, b) => String(b.timestamp || b.data).localeCompare(String(a.timestamp || a.data)) || b.id - a.id);
  const cnt = document.getElementById('mov-count');
  if (cnt) cnt.textContent = lista.length + ' movimentaç' + (lista.length === 1 ? 'ão' : 'ões');
  tbody.innerHTML = lista.length ? lista.slice(0, 300).map(m => linhaMovimento(m, apos, true)).join('')
    : '<tr><td colspan="10" class="empty">Nenhuma movimentação encontrada.</td></tr>';
}
let historicoMaterialId = null;
function abrirHistoricoMaterial(id) {
  const material = materialPorId(id);
  if (!material) return;
  historicoMaterialId = id;
  const apos = saldosAposMovimentos();
  const movs = movimentosMateriais.filter(m => String(m.materialId) === String(id))
    .sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)) || a.id - b.id);
  const ent = movs.filter(m => fatorMovimentoMaterial(m.tipo) > 0).reduce((t, m) => t + numNf(m.quantidade), 0);
  const sai = movs.filter(m => fatorMovimentoMaterial(m.tipo) < 0).reduce((t, m) => t + numNf(m.quantidade), 0);
  const osUso = {};
  movs.filter(m => m.os && fatorMovimentoMaterial(m.tipo) <= 0).forEach(m => { osUso[m.os] = (osUso[m.os] || 0) + numNf(m.quantidade); });
  const nfs = unicos(movs.filter(m => m.nf || m.documento).map(m => m.nf || m.documento));
  const un = escMelhoria(material.unidade || '');
  document.getElementById('hist-title').textContent = 'Histórico · ' + material.codigo + ' — ' + material.descricao;
  document.getElementById('hist-body').innerHTML =
    '<div class="materials-kpis">' +
      '<div class="materials-kpi"><div class="label">Saldo atual</div><div class="value">' + numeroMaterial(saldoMaterial(id)) + ' ' + un + '</div></div>' +
      '<div class="materials-kpi"><div class="label">Entradas</div><div class="value">' + numeroMaterial(ent) + ' ' + un + '</div></div>' +
      '<div class="materials-kpi"><div class="label">Saídas</div><div class="value">' + numeroMaterial(sai) + ' ' + un + '</div></div>' +
      '<div class="materials-kpi"><div class="label">Valor médio / último</div><div class="value" style="font-size:16px;">' + moedaMaterial(custoMedioMaterial(id)) + ' / ' + moedaMaterial(ultimoValorMaterial(id)) + '</div></div>' +
    '</div>' +
    '<div class="hist-resumo"><div><strong>OS que usaram:</strong> ' + (Object.keys(osUso).map(o => escMelhoria(o) + ' (' + numeroMaterial(osUso[o]) + ' ' + un + ')').join(', ') || '—') + '</div>' +
    '<div><strong>NFs de origem:</strong> ' + (nfs.map(escMelhoria).join(', ') || '—') + '</div></div>' +
    '<div class="materials-table-wrap" style="max-height:55vh;"><table class="data"><thead><tr><th>Data</th><th>Tipo</th><th>Qtd.</th><th style="text-align:right;">Valor</th><th>Origem</th><th>OS</th><th>Cliente</th><th>Saldo após</th><th>Observação</th></tr></thead><tbody>' +
    (movs.length ? movs.map(m => linhaMovimento(m, apos, false)).join('') : '<tr><td colspan="9" class="empty">Sem movimentações.</td></tr>') +
    '</tbody></table></div>';
  document.getElementById('hist-modal').style.display = 'flex';
}
function exportarHistoricoMaterial() {
  const material = materialPorId(historicoMaterialId);
  if (!material) return;
  const apos = saldosAposMovimentos();
  const movs = movimentosMateriais.filter(m => String(m.materialId) === String(historicoMaterialId))
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
  // Material indicado na OS: mostra se já existe em estoque
  const sel = document.getElementById('f-material');
  const info = document.getElementById('f-material-saldo');
  if (info) {
    const m = sel && sel.value ? materialPorTexto(sel.value) || materialPorCodigo(String(sel.value).split(' — ')[0]) : null;
    info.innerHTML = !sel || !sel.value ? 'Puxa da aba 📦 Materiais e NF.'
      : m ? (saldoMaterial(m.id) > 0 ? '✓ Em estoque: <strong>' + numeroMaterial(saldoMaterial(m.id)) + ' ' + escMelhoria(m.unidade || '') + '</strong>' : '⚠ Sem saldo em estoque — compre por NF (consumo direto)')
      : 'Material não cadastrado no estoque.';
    info.style.color = m && saldoMaterial(m.id) > 0 ? '#15803d' : (sel && sel.value ? '#b45309' : '#888');
  }
  const movs = movimentosMateriais.filter(m => movimentoDaOS(m, s))
    .sort((a, b) => String(a.timestamp || a.data).localeCompare(String(b.timestamp || b.data)));
  const custoUso = m => fatorMovimentoMaterial(m.tipo) < 0 || TIPOS_NEUTROS_MAT.includes(m.tipo) ? valorMovimento(m) : (m.tipo === 'Sobra' ? -valorMovimento(m) : 0);
  const total = movs.reduce((t, m) => t + custoUso(m), 0);
  box.innerHTML =
    '<div class="os-materiais-head"><h4>Materiais da OS</h4><div class="spacer"></div>' +
      '<button type="button" class="btn-primary btn-sm" onclick="lancarNfParaOS()">🧾 Lançar NF para esta OS</button>' +
      '<button type="button" class="btn-warning btn-sm" onclick="retirarParaOS()">📤 Retirar do estoque</button></div>' +
    (movs.length
      ? '<table class="data os-mat-tab"><thead><tr><th>Data</th><th>Como</th><th>Material</th><th>Qtd.</th><th>Origem</th><th style="text-align:right;">Custo</th></tr></thead><tbody>' +
        movs.map(m => {
          const mat = materialPorId(m.materialId);
          return '<tr><td>' + escMelhoria(fmtDate(m.data)) + '</td><td>' + escMelhoria(m.tipo === 'Compra direta para OS' ? 'Comprado p/ a OS' : m.tipo === 'Outros (sem efeito no estoque)' ? 'Despesa / serviço' : m.tipo) + '</td>' +
            '<td>' + escMelhoria(mat ? mat.codigo + ' — ' + mat.descricao : (m.observacao || '').split('|')[0]) + '</td>' +
            '<td>' + numeroMaterial(m.quantidade) + ' ' + escMelhoria(mat ? mat.unidade : '') + '</td><td>' + escMelhoria(origemMovimento(m)) + '</td>' +
            '<td style="text-align:right;">' + (valorMovimento(m) ? moedaNf(custoUso(m)) : '—') + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="5" style="text-align:right;"><strong>Custo de material da OS</strong></td><td style="text-align:right;"><strong>' + moedaNf(total) + '</strong></td></tr></tfoot></table>'
      : '<div class="os-mat-vazio">Nenhum material lançado para esta OS. Compra específica → <em>Lançar NF</em>; material que já está no estoque → <em>Retirar do estoque</em>.</div>');
}
window.renderMateriaisDaOSAtual = function () {
  const s = servicos.find(x => x.id === currentId);
  if (s && document.getElementById('edit-panel').style.display !== 'none') renderMateriaisDaOS(s);
};
function osAbertaNoPainel() {
  const s = servicos.find(x => x.id === currentId);
  return s ? { os: osItemServico(s), cliente: s.cliente || '' } : { os: '', cliente: '' };
}
function lancarNfParaOS() {
  const { os, cliente } = osAbertaNoPainel();
  switchTab('materiais');
  switchMatSub('nf');
  novaNf({ os, cliente });
}
function retirarParaOS() {
  const { os, cliente } = osAbertaNoPainel();
  switchTab('materiais');
  switchMatSub('mov');
  document.getElementById('mov-tipo').value = 'Retirada do estoque para OS';
  document.getElementById('mov-os').value = os;
  document.getElementById('mov-cliente').value = cliente;
  document.getElementById('mov-data').value = hojeLocal();
  atualizarCamposMovimentoMat();
  document.getElementById('mov-material').focus();
}

/* ======================= INÍCIO ======================= */
(function initNf() {
  carregarNfsLocal();
  if (!document.getElementById('dl-unidades')) {
    const dl = document.createElement('datalist');
    dl.id = 'dl-unidades';
    dl.innerHTML = ['kg', 'barra', 'peça', 'metro', 'chapa', 'litro', 'unidade', 'caixa', 'serviço'].map(u => '<option value="' + u + '"></option>').join('');
    document.body.appendChild(dl);
  }
  // Ao carregar materiais/movimentações em segundo plano, a OS aberta e as listas acompanham
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nfEditorAberto()) fecharNf();
    else if (e.key === 'Escape') { const h = document.getElementById('hist-modal'); if (h) h.style.display = 'none'; }
  });
  atualizarAvisoBackendNf();
})();
