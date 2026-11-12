/* ============================================================
   Gestão de Serviços para Ferramentaria / Usinagem
   Lógica da aplicação. Dados do cliente ficam em config.js.
   ============================================================ */
const CONFIG = window.APP_CONFIG;
if (!CONFIG) throw new Error('config.js não carregado — copie config.example.js para config.js.');

/** Chave do localStorage com o prefixo do cliente. */
function chave(nome) { return CONFIG.storagePrefix + '_' + nome; }

/** Aplica nome da empresa, imagens e listas definidas no config.js. */
function aplicarMarca() {
  document.title = CONFIG.empresa.nomeCurto + ' — Gestão de Serviços';
  document.querySelectorAll('[data-empresa]').forEach(el => {
    const v = CONFIG.empresa[el.dataset.empresa];
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-marca-img]').forEach(el => {
    const v = CONFIG.marca[el.dataset.marcaImg];
    if (v) el.src = v;
    if (el.dataset.marcaImg === 'logo') el.alt = CONFIG.empresa.nome;
  });
  const preencher = (id, lista) => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '<option value="">— selecione —</option>' + lista.map(v => '<option>' + escMelhoria(v) + '</option>').join('');
  };
  preencher('a-operacao', CONFIG.operacoes);
  preencher('a-maquina', CONFIG.maquinas);
}

/* =============== STATE =============== */
let servicos = [];
let currentId = null;
let nextId = 1;
let currentQrTab = 'externo';
let apontamentoDados = null;

const FIELDS = ['cliente','oc','os','it','des','desc','qty','material','tratamento','emb','prazo','status','nf','dt','externo-fornecedor','externo-envio','externo-retorno'];
const MATERIAIS_KEY = chave('materiais_v1');
let materiaisCadastro = [];
let movimentosMateriais = [];
let currentMaterialId = null;
let nextMaterialId = 1;
let nextMovimentoMaterialId = 1;

/* =============== STORAGE =============== */
function saveServicos() {
  localStorage.setItem(chave('servicos'), JSON.stringify({ servicos, nextId }));
  if (typeof agendarEnvioServicos === 'function') agendarEnvioServicos();
}
/** ID único entre computadores (as OS agora são compartilhadas pela planilha). */
function novoIdServico() { return Date.now() * 1000 + Math.floor(Math.random() * 1000); }
function saveMateriais() {
  localStorage.setItem(MATERIAIS_KEY, JSON.stringify({
    materiais: materiaisCadastro,
    movimentos: movimentosMateriais,
    nextMaterialId,
    nextMovimentoMaterialId
  }));
}
function loadMateriais() {
  try {
    const raw = localStorage.getItem(MATERIAIS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    materiaisCadastro = Array.isArray(data.materiais) ? data.materiais : [];
    movimentosMateriais = Array.isArray(data.movimentos) ? data.movimentos : [];
    nextMaterialId = data.nextMaterialId || (materiaisCadastro.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1);
    nextMovimentoMaterialId = data.nextMovimentoMaterialId || (movimentosMateriais.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1);
  } catch (e) {
    materiaisCadastro = [];
    movimentosMateriais = [];
    nextMaterialId = 1;
    nextMovimentoMaterialId = 1;
  }
}
function hojeLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function materialPorId(id) {
  return materiaisCadastro.find(m => String(m.id) === String(id));
}
function fatorMovimentoMaterial(tipo) {
  return ['Consumo na OS', 'Perda / descarte', 'Ajuste de saída'].includes(tipo) ? -1 : 1;
}
function saldoMaterial(materialId) {
  return movimentosMateriais
    .filter(m => String(m.materialId) === String(materialId))
    .reduce((sum, m) => sum + (Number(m.quantidade) || 0) * fatorMovimentoMaterial(m.tipo), 0);
}
function numeroMaterial(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
function moedaMaterial(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
}
function limparFormMaterial() {
  currentMaterialId = null;
  ['m-codigo','m-descricao','m-especificacao','m-minimo','m-localizacao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('m-unidade').value = '';
  document.getElementById('m-ativo').value = 'true';
  document.getElementById('material-form-title').textContent = 'Cadastro do material';
}
function preencherFormMaterial(material) {
  if (!material) return;
  currentMaterialId = material.id;
  document.getElementById('m-codigo').value = material.codigo || '';
  document.getElementById('m-descricao').value = material.descricao || '';
  document.getElementById('m-especificacao').value = material.especificacao || '';
  document.getElementById('m-unidade').value = material.unidade || '';
  document.getElementById('m-minimo').value = material.minimo || '';
  document.getElementById('m-localizacao').value = material.localizacao || '';
  document.getElementById('m-ativo').value = String(material.ativo !== false);
  document.getElementById('material-form-title').textContent = 'Editando: ' + (material.codigo || material.descricao || 'material');
  document.getElementById('m-codigo').focus();
}
function novoMaterial() {
  limparFormMaterial();
  document.getElementById('m-codigo').focus();
}
function salvarMaterial() {
  const codigo = document.getElementById('m-codigo').value.trim();
  const descricao = document.getElementById('m-descricao').value.trim();
  const unidade = document.getElementById('m-unidade').value.trim();
  if (!codigo || !descricao || !unidade) {
    alert('Preencha código, descrição e unidade do material.');
    return;
  }
  const repetido = materiaisCadastro.find(m => String(m.codigo).toLowerCase() === codigo.toLowerCase() && m.id !== currentMaterialId);
  if (repetido) {
    alert('Já existe um material com este código.');
    return;
  }
  const dados = {
    codigo,
    descricao,
    especificacao: document.getElementById('m-especificacao').value.trim(),
    unidade,
    minimo: Math.max(0, Number(document.getElementById('m-minimo').value) || 0),
    localizacao: document.getElementById('m-localizacao').value.trim(),
    ativo: document.getElementById('m-ativo').value !== 'false'
  };
  if (currentMaterialId === null) {
    materiaisCadastro.push(Object.assign({ id: nextMaterialId++ }, dados));
  } else {
    const material = materialPorId(currentMaterialId);
    if (material) Object.assign(material, dados);
  }
  saveMateriais();
  atualizarSelectMateriais();
  atualizarSelectMaterialServico();
  atualizarCamposExternoServico();
  popularSelectFornecedores(document.getElementById('f-externo-fornecedor'), ['serviço externo', 'material e serviço']);
  renderMateriais();

  // Sincroniza com Google Sheets (async, não bloqueia UI)
  const materialSalvo = currentMaterialId === null
    ? materiaisCadastro[materiaisCadastro.length - 1]
    : materialPorId(currentMaterialId);
  if (materialSalvo && getSyncUrl()) {
    enviarMaterialSheets(materialSalvo).then(resp => {
      if (resp.ok) console.log('✓ Material sincronizado com Sheets');
      else alert('Material salvo localmente. Falha no Sheets: ' + (resp.erro || 'erro'));
    });
  }
  alert('Material salvo.');
}
function excluirMaterial(id) {
  const material = materialPorId(id);
  if (!material) return;
  if (movimentosMateriais.some(m => String(m.materialId) === String(id))) {
    alert('Este material já tem movimentações. Marque-o como Inativo para preservar o histórico.');
    preencherFormMaterial(material);
    return;
  }
  if (!confirm('Excluir o material ' + (material.codigo || material.descricao) + '?')) return;
  materiaisCadastro = materiaisCadastro.filter(m => m.id !== id);
  if (currentMaterialId === id) limparFormMaterial();
  saveMateriais();
  atualizarSelectMateriais();
  renderMateriais();

  // No Sheets, marca como inativo (não deleta pra preservar histórico)
  if (getSyncUrl()) {
    const materialInativo = Object.assign({}, material, { ativo: false });
    enviarMaterialSheets(materialInativo).then(resp => {
      if (!resp.ok) console.warn('Falha ao inativar no Sheets:', resp.erro);
    });
  }
}
function atualizarSelectMaterialServico() {
  const sel = document.getElementById('f-material');
  if (!sel) return;
  const valAtual = sel.value;
  const ativos = materiaisCadastro.filter(m => m.ativo !== false)
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  const options = ['<option value="">— selecione um material —</option>'];
  const rotulos = new Set();
  ativos.forEach(m => {
    const rotulo = (m.codigo || '') + (m.descricao ? ' — ' + m.descricao : '');
    rotulos.add(rotulo);
    options.push('<option value="' + rotulo.replace(/"/g, '&quot;') + '">' + rotulo + '</option>');
  });
  // Se o valor atual do serviço não bate com nenhum cadastrado, preserva como opção "custom"
  // (evita apagar dados antigos de OSs criadas antes deste dropdown)
  if (valAtual && !rotulos.has(valAtual)) {
    options.splice(1, 0, '<option value="' + valAtual.replace(/"/g, '&quot;') + '">' + valAtual + ' (não cadastrado)</option>');
  }
  sel.innerHTML = options.join('');
  sel.value = valAtual;
}

function atualizarSelectMateriais() {
  const select = document.getElementById('mov-material');
  if (!select) return;
  const atual = select.value;
  const ativos = materiaisCadastro.filter(m => m.ativo !== false).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'));
  select.innerHTML = '<option value="">— selecione o material —</option>' + ativos.map(m =>
    '<option value="' + Number(m.id) + '">' + escMelhoria(m.codigo) + ' · ' + escMelhoria(m.descricao) + '</option>'
  ).join('');
  if (ativos.some(m => String(m.id) === String(atual))) select.value = atual;
}
function movimentoMaterialVisivel(m) {
  const material = materialPorId(m.materialId);
  return [m.data, m.tipo, material && material.codigo, material && material.descricao, m.os, m.lote, m.dimensao, m.responsavel, m.observacao]
    .join(' ').toLowerCase();
}
function renderMateriais() {
  atualizarSelectMateriais();
  const search = (document.getElementById('search-material').value || '').toLowerCase();
  const filtro = document.getElementById('filter-material-status').value;
  const ativos = materiaisCadastro.filter(m => m.ativo !== false);
  const baixo = ativos.filter(m => saldoMaterial(m.id) <= Number(m.minimo || 0));
  document.getElementById('mat-kpi-total').textContent = ativos.length;
  document.getElementById('mat-kpi-com-saldo').textContent = ativos.filter(m => saldoMaterial(m.id) > 0).length;
  document.getElementById('mat-kpi-baixo').textContent = baixo.filter(m => Number(m.minimo || 0) > 0).length;
  document.getElementById('mat-kpi-mov').textContent = movimentosMateriais.length;
  const lista = materiaisCadastro.filter(m => {
    const saldo = saldoMaterial(m.id);
    const minimo = Number(m.minimo || 0);
    if (filtro === 'estoque' && saldo <= 0) return false;
    if (filtro === 'baixo' && !(m.ativo !== false && minimo > 0 && saldo <= minimo)) return false;
    if (filtro === 'sem' && saldo > 0) return false;
    if (filtro === 'inativo' && m.ativo !== false) return false;
    if (search) {
      const hay = [m.codigo, m.descricao, m.especificacao, m.unidade, m.localizacao].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'));
  document.getElementById('material-count').textContent = lista.length + ' material' + (lista.length === 1 ? '' : 'is');
  const tbody = document.getElementById('tbody-materiais');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Nenhum material encontrado. Cadastre o primeiro acima.</td></tr>';
  } else {
    tbody.innerHTML = lista.map(m => {
      const saldo = saldoMaterial(m.id);
      const minimo = Number(m.minimo || 0);
      const baixoClass = m.ativo !== false && minimo > 0 && saldo <= minimo ? 'material-low' : 'material-ok';
      return '<tr>' +
        '<td><strong>' + escMelhoria(m.codigo || '—') + '</strong></td>' +
        '<td>' + escMelhoria(m.descricao || '—') + '</td>' +
        '<td>' + escMelhoria(m.especificacao || '—') + '</td>' +
        '<td>' + escMelhoria(m.unidade || '—') + '</td>' +
        '<td class="' + baixoClass + '">' + numeroMaterial(saldo) + '</td>' +
        '<td>' + numeroMaterial(minimo) + '</td>' +
        '<td>' + escMelhoria(m.localizacao || '—') + '</td>' +
        '<td class="' + (m.ativo === false ? 'material-inactive' : '') + '">' + (m.ativo === false ? 'Inativo' : (minimo > 0 && saldo <= minimo ? 'Comprar' : 'OK')) + '</td>' +
        '<td class="actions"><button class="btn-primary btn-sm" onclick="preencherFormMaterial(materialPorId(' + Number(m.id) + '))">Editar</button> <button class="btn-danger btn-sm" onclick="excluirMaterial(' + Number(m.id) + ')">✕</button></td>' +
      '</tr>';
    }).join('');
  }
  renderMovimentacoesMateriais();
}
function renderMovimentacoesMateriais() {
  const tbody = document.getElementById('tbody-movimentos-materiais');
  if (!tbody) return;
  const search = (document.getElementById('search-material').value || '').toLowerCase();
  const lista = movimentosMateriais
    .filter(m => !search || movimentoMaterialVisivel(m).includes(search))
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || Number(b.id) - Number(a.id))
    .slice(0, 50);
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Nenhuma movimentação registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(m => {
    const material = materialPorId(m.materialId);
    const sinal = fatorMovimentoMaterial(m.tipo) < 0 ? '−' : '+';
    return '<tr>' +
      '<td>' + escMelhoria(fmtDate(m.data) || '—') + '</td>' +
      '<td>' + escMelhoria(m.tipo || '—') + '</td>' +
      '<td><strong>' + escMelhoria(material ? material.codigo : 'Material removido') + '</strong><br><small>' + escMelhoria(material ? material.descricao : '') + '</small></td>' +
      '<td class="' + (sinal === '−' ? 'material-low' : 'material-ok') + '">' + sinal + numeroMaterial(m.quantidade) + ' ' + escMelhoria(material ? material.unidade : '') + '</td>' +
      '<td>' + escMelhoria(m.os || '—') + '</td>' +
      '<td>' + escMelhoria(m.lote || '—') + '</td>' +
      '<td>' + escMelhoria(m.dimensao || '—') + '</td>' +
      '<td>' + escMelhoria(m.responsavel || '—') + '</td>' +
      '<td title="' + escMelhoria(m.observacao || '') + '">' + escMelhoria(m.observacao || '—') + '</td>' +
    '</tr>';
  }).join('');
}
function registrarMovimentoMaterial() {
  const materialId = document.getElementById('mov-material').value;
  const tipo = document.getElementById('mov-tipo').value;
  const quantidade = Number(document.getElementById('mov-quantidade').value);
  const data = document.getElementById('mov-data').value || hojeLocal();
  const os = document.getElementById('mov-os').value.trim();
  if (!materialId || !tipo || !Number.isFinite(quantidade) || quantidade <= 0) {
    alert('Selecione o material e informe uma quantidade maior que zero.');
    return;
  }
  if ((tipo === 'Consumo na OS' || tipo === 'Sobra') && !os) {
    alert('Informe a OS relacionada para registrar consumo ou sobra.');
    return;
  }
  const saldoAtual = saldoMaterial(materialId);
  if (fatorMovimentoMaterial(tipo) < 0 && quantidade > saldoAtual) {
    const material = materialPorId(materialId);
    alert('Saldo insuficiente para este consumo. Disponível: ' + numeroMaterial(saldoAtual) + ' ' + (material ? material.unidade : '') + '.');
    return;
  }
  movimentosMateriais.push({
    id: nextMovimentoMaterialId++,
    data,
    tipo,
    materialId: Number(materialId),
    quantidade,
    custoUnitario: Number(document.getElementById('mov-custo').value) || 0,
    os,
    fornecedor: document.getElementById('mov-fornecedor').value.trim(),
    documento: document.getElementById('mov-documento').value.trim(),
    lote: document.getElementById('mov-lote').value.trim(),
    dimensao: document.getElementById('mov-dimensao').value.trim(),
    responsavel: document.getElementById('mov-responsavel').value.trim(),
    observacao: document.getElementById('mov-observacao').value.trim()
  });
  saveMateriais();
  ['mov-quantidade','mov-custo','mov-os','mov-fornecedor','mov-documento','mov-lote','mov-dimensao','mov-responsavel','mov-observacao'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('mov-data').value = hojeLocal();
  renderMateriais();

  // Sincroniza com Google Sheets
  const movSalvo = movimentosMateriais[movimentosMateriais.length - 1];
  const materialDoMov = materialPorId(movSalvo.materialId);
  if (movSalvo && materialDoMov && getSyncUrl()) {
    enviarMovimentoSheets(movSalvo, materialDoMov).then(resp => {
      if (resp.ok) console.log('✓ Movimentação sincronizada com Sheets');
      else alert('Movimentação salva localmente. Falha no Sheets: ' + (resp.erro || 'erro'));
    });
  }
  alert('Movimentação registrada.');
}
function csvMaterial(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}
function baixarCsvMateriais(nome, colunas, linhas) {
  const csv = '\uFEFF' + colunas.join(';') + '\n' + linhas.map(l => l.map(csvMaterial).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = nome + '-' + hojeLocal() + '.csv'; link.click();
  URL.revokeObjectURL(url);
}
function exportarEstoqueMateriais() {
  if (!materiaisCadastro.length) { alert('Cadastre pelo menos um material antes de exportar.'); return; }
  baixarCsvMateriais('estoque-materiais',
    ['codigo','descricao','especificacao','unidade','saldo','estoque_minimo','localizacao','status'],
    materiaisCadastro.map(m => {
      const saldo = saldoMaterial(m.id), minimo = Number(m.minimo || 0);
      return [m.codigo, m.descricao, m.especificacao, m.unidade, saldo, minimo, m.localizacao, m.ativo === false ? 'Inativo' : (minimo > 0 && saldo <= minimo ? 'Comprar' : 'OK')];
    }));
}
function exportarMovimentosMateriais() {
  if (!movimentosMateriais.length) { alert('Ainda não há movimentações para exportar.'); return; }
  baixarCsvMateriais('movimentacoes-materiais',
    ['data','tipo','codigo','descricao','unidade','quantidade','efeito_no_saldo','custo_unitario','os','fornecedor','documento','lote','dimensao','responsavel','observacao'],
    movimentosMateriais.map(m => {
      const material = materialPorId(m.materialId);
      return [m.data, m.tipo, material && material.codigo, material && material.descricao, material && material.unidade, m.quantidade, fatorMovimentoMaterial(m.tipo) * Number(m.quantidade || 0), m.custoUnitario, m.os, m.fornecedor, m.documento, m.lote, m.dimensao, m.responsavel, m.observacao];
    }));
}

/** Separa OS e item: "CO 26.002/75" → { os: "CO 26.002", item: "75" }. Aceita registros antigos e novos. */
function separarOsItem(r) {
  const o = Object.assign({}, r);
  let os = String(o.os || '').trim(), item = String(o.item || '').trim();
  if (item && os.slice(-(item.length + 1)) === '/' + item) os = os.slice(0, -(item.length + 1)).trim();
  else if (!item && os.indexOf('/') >= 0) { const i = os.lastIndexOf('/'); item = os.slice(i + 1).trim(); os = os.slice(0, i).trim(); }
  o.os = os; o.item = item;
  return o;
}
/** Chave única OS + item ("CO 26.002/75"). */
function osItem(r) { return (r.os || '') + (r.item ? '/' + r.item : ''); }
function osItemServico(s) { return (s.os || '') + (s.it ? '/' + s.it : ''); }

function loadApontamentos() {
  const raw = localStorage.getItem(chave('apontamentos'));
  return raw ? JSON.parse(raw).map(separarOsItem) : [];
}
function saveApontamento(a) {
  const list = loadApontamentos();
  list.push(a);
  localStorage.setItem(chave('apontamentos'), JSON.stringify(list));
  enfileirar(a);
}

/* =============== ENCODING =============== */
function b64enc(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
function b64dec(str) { return JSON.parse(decodeURIComponent(escape(atob(str)))); }

function fmtDate(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return iso;
}



/* =============== TABS =============== */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
  if (tab === 'finalizadas') renderFinalizadas();
  if (tab === 'materiais') {
    const data = document.getElementById('mov-data');
    if (data && !data.value) data.value = hojeLocal();
    renderMateriais();
    // Sincroniza materiais do Sheets antes de renderizar
    if (getSyncUrl() && !materiaisSyncing) {
      materiaisSyncing = true;
      fetchMateriaisFromSheets().finally(() => {
        materiaisSyncing = false;
        atualizarSelectMateriais();
        renderMateriais();
      });
    }
  }
  if (tab === 'qualidade') {
    checklistsRemoto = null;
    renderQualidade();
  }
  if (tab === 'cadastros') {
    responsaveisRemoto = null; fornecedoresRemoto = null;
    renderCadastros();
  }
  if (tab === 'apontamentos' || tab === 'analise') {
    // força re-fetch pra pegar apontamentos novos que outros dispositivos gravaram
    apontamentosRemoto = null;
    if (tab === 'apontamentos') renderApontamentos();
    if (tab === 'analise') renderAnalise();
  }
}

/* =============== SERVIÇOS =============== */

function deleteServico(id, ev) {
  if (ev) ev.stopPropagation();
  if (!confirm('Remover este serviço? Ele some também da planilha e dos outros computadores.')) return;
  servicos = servicos.filter(s => s.id !== id);
  if (currentId === id) { currentId = null; closeEditPanel(); }
  saveServicos();
  renderServicos();
}

function selectServico(id) { currentId = id; renderServicos(); openEditPanel(); }


function clearAllServicos() {
  if (!confirm('Apagar TODOS os serviços cadastrados? Eles somem também da planilha e dos outros computadores.')) return;
  servicos = []; currentId = null; nextId = 1;
  saveServicos();
  closeEditPanel();
  renderServicos();
}



let selecionadas = new Set(); // ids de serviços selecionados via checkbox

function toggleRow(id, checked) {
  if (checked) selecionadas.add(id); else selecionadas.delete(id);
  // atualiza estado do "selecionar todos"
  const all = document.getElementById('chk-all');
  const total = filterServicos().length;
  if (all) all.checked = selecionadas.size === total && total > 0;
}

function toggleSelectAll(checked) {
  const list = filterServicos();
  selecionadas.clear();
  if (checked) list.forEach(s => selecionadas.add(Number(s.id)));
  // re-marca visualmente
  document.querySelectorAll('.chk-row').forEach(cb => {
    cb.checked = selecionadas.has(Number(cb.dataset.id));
  });
}

function getSelecionadas() {
  // retorna a lista dos serviços selecionados, mantendo a ordem da tabela filtrada
  const list = filterServicos();
  return list.filter(s => selecionadas.has(Number(s.id)));
}

// (renderServicos definido mais abaixo, com suporte a etapas + checkbox de seleção)


function closeEditPanel() {
  document.getElementById('edit-panel').style.display = 'none';
  currentId = null;
  renderServicos();
}

function updateEditTitle() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) return;
  const osFull = (s.os || '(sem OS)') + (s.it ? '/' + s.it : '');
  document.getElementById('edit-title').textContent = 'Editando: ' + osFull + ' · ' + (s.cliente || '(sem cliente)');
}

function switchQrTab(tab) {
  currentQrTab = tab;
  document.querySelectorAll('.side-actions .qr-tab').forEach(b => b.classList.toggle('active', b.dataset.t === tab));
  document.getElementById('qr-view').className = 'qr-view ' + tab;
  renderQr();
}

// SVG de engrenagem (interno) e base64 do logo mini (externo)
const LOGO_MINI_SRC = CONFIG.marca.logoMini;
const GEAR_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

function buildQrWithOverlay(url, size, tipo) {
  const wrap = document.createElement('div');
  wrap.className = 'qr-wrap ' + tipo;
  const codeDiv = document.createElement('div');
  wrap.appendChild(codeDiv);
  // High correction level pra tolerar overlay no centro (~30% resistência)
  // Nível H (30% de correção) para o logo no centro. A biblioteca erra o tamanho do QR em algumas
  // faixas de comprimento; nesse caso o link ganha "!" no fim (ignorados na leitura) até caber.
  let texto = url, ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    try { codeDiv.innerHTML = ''; new QRCode(codeDiv, { text: texto, width: size, height: size, correctLevel: QRCode.CorrectLevel.H }); ok = true; }
    catch (e) { texto += '!'; }
  }
  if (!ok) { codeDiv.innerHTML = ''; new QRCode(codeDiv, { text: url, width: size, height: size, correctLevel: QRCode.CorrectLevel.Q }); }
  const overlay = document.createElement('div');
  overlay.className = 'qr-overlay';
  overlay.innerHTML = tipo === 'interno'
    ? GEAR_SVG
    : '<img src="' + LOGO_MINI_SRC + '" alt="">';
  wrap.appendChild(overlay);
  return wrap;
}

function renderQr() {
  const s = servicos.find(x => x.id === currentId);
  const qrContainer = document.getElementById('qrcode');
  if (!qrContainer) return;
  qrContainer.innerHTML = '';
  if (!s) return;
  const url = currentQrTab === 'interno' ? buildApontamentoUrl(s) : buildViewerUrl(s);
  qrContainer.appendChild(buildQrWithOverlay(url, 160, currentQrTab));
}

/* =============== PRINT =============== */

// Extrai logo e assinatura embutidos na página pra reusar na etiqueta completa
function getLogoSrc() { return document.querySelector('#viewer-app .v-logo').src; }
function getSigSrc() { return document.querySelector('#viewer-app .v-sig-img').src; }

function generateEtiquetaCompleta(s) {
  const wrap = document.createElement('div');
  wrap.className = 'etq-full-wrap';

  const etq = document.createElement('div');
  etq.className = 'etq-full';

  const logoSrc = getLogoSrc();
  const sigSrc = getSigSrc();
  const osFull = (s.os || '') + (s.it ? '/' + s.it : '');

  etq.innerHTML =
    '<table>' +
      '<tr>' +
        '<td class="logo-cell" style="width:35%;"><img src="' + logoSrc + '" alt="' + escMelhoria(CONFIG.empresa.nomeCurto) + '"></td>' +
        '<td class="title" colspan="3">ETIQUETA DO PRODUTO</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td>CLIENTE</td><td>OS</td><td colspan="2">QUANTIDADE</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="data">' + (s.cliente || '') + '</td>' +
        '<td class="data">' + osFull + '</td>' +
        '<td class="data" colspan="2">' + (s.qty || '') + '</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td>DESCRIÇÃO</td><td colspan="3">Nº DO DESENHO</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="data">' + (s.desc || '') + '</td>' +
        '<td class="data" colspan="3">' + (s.des || '') + '</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td>MATERIAL</td><td colspan="3">TRATAMENTO TÉRMICO</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="data">' + (s.material || '') + '</td>' +
        '<td class="data" colspan="3">' + (s.tratamento || '') + '</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td colspan="4">TIPO DE EMBALAGEM</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="data" colspan="4">' + (s.emb || '') + '</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td>ORDEM DE COMPRA</td><td>ITEM</td><td>NOTA FISCAL</td><td>DATA</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="data">' + (s.oc || '') + '</td>' +
        '<td class="data">' + (s.it || '') + '</td>' +
        '<td class="data">' + (s.nf || '') + '</td>' +
        '<td class="data">' + (fmtDate(s.dt) || '') + '</td>' +
      '</tr>' +
      '<tr class="h">' +
        '<td>QR CODE (cliente)</td><td colspan="3">ASSINATURA</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="qr-cell" id="etq-qr-' + s.id + '"></td>' +
        '<td class="sig-cell" colspan="3">' +
          '<img src="' + sigSrc + '" alt="Assinatura">' +
          '<div class="sig-name">' + escMelhoria(CONFIG.empresa.razaoSocial) + '</div>' +
        '</td>' +
      '</tr>' +
    '</table>';

  wrap.appendChild(etq);

  // Gera o QR dentro da célula (com overlay do logo — QR externo)
  setTimeout(() => {
    const qrCell = wrap.querySelector('#etq-qr-' + s.id);
    if (qrCell) {
      qrCell.appendChild(buildQrWithOverlay(buildViewerUrl(s), 200, 'externo'));
    }
  }, 10);

  return wrap;
}

// Constante do logo com fundo branco (usado na etiqueta interna impressa)
const LOGO_BRANCO_SRC = CONFIG.marca.logoEtiquetaInterna;

function generateEtiquetaInterna(s) {
  const wrap = document.createElement('div');
  wrap.className = 'etq-interna';

  const osFull = (s.os || '(sem OS)') + (s.it ? '/' + s.it : '');

  // Cabeçalho: logo + OS destacada
  const logo = document.createElement('img');
  logo.src = LOGO_BRANCO_SRC;
  logo.alt = CONFIG.empresa.nome;
  logo.className = 'etq-logo';
  wrap.appendChild(logo);

  const osBox = document.createElement('div');
  osBox.className = 'etq-os';
  osBox.textContent = osFull;
  wrap.appendChild(osBox);

  // QR interno (com overlay de engrenagem)
  const qrWrap = document.createElement('div');
  qrWrap.className = 'etq-qr';
  const url = buildApontamentoUrl(s);
  qrWrap.appendChild(buildQrWithOverlay(url, 300, 'interno'));
  wrap.appendChild(qrWrap);

  // Rodapé: cliente/oc + qtd/prazo
  const footer = document.createElement('div');
  footer.className = 'etq-footer';
  const cliente = s.cliente || '';
  const oc = s.oc || '';
  const qty = s.qty || '';
  const prazo = fmtDate(s.prazo) || '';

  const row1parts = [];
  if (cliente) row1parts.push(cliente);
  if (oc) row1parts.push('OC: ' + oc);

  const row2parts = [];
  if (qty) row2parts.push('Qtd: ' + qty);
  if (prazo) row2parts.push('Prazo: ' + prazo);

  footer.innerHTML =
    '<div class="row1">' + row1parts.join('<span class="sep">|</span>') + '</div>' +
    (row2parts.length ? '<div class="row2">' + row2parts.join('<span class="sep">|</span>') + '</div>' : '');

  wrap.appendChild(footer);
  return wrap;
}

function printEtiquetaCompleta() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) { alert('Selecione um serviço primeiro.'); return; }
  const area = document.getElementById('print-area');
  area.className = 'etq-full-mode';
  area.innerHTML = '';
  area.appendChild(generateEtiquetaCompleta(s));
  setTimeout(() => window.print(), 200);
}

/** Etiqueta avulsa de QR: cartão horizontal (QR 20 mm à esquerda, dados à direita). */
function generatePrintQR(s, tipo) {
  const wrapper = document.createElement('div');
  wrapper.className = 'print-qr ' + tipo;
  const qrDiv = document.createElement('div');
  qrDiv.className = 'pq-qr';
  const url = tipo === 'interno' ? buildApontamentoUrl(s) : buildViewerUrl(s);
  qrDiv.appendChild(buildQrWithOverlay(url, 400, tipo));
  wrapper.appendChild(qrDiv);
  const linha2 = [s.oc ? 'OC ' + s.oc : '', s.qty ? 'Qtd ' + s.qty : ''].filter(Boolean).join('  ·  ');
  const info = document.createElement('div');
  info.className = 'pq-info';
  info.innerHTML =
    '<div class="pq-top"><span class="print-tag ' + tipo + '">' + (tipo === 'interno' ? 'Chão de fábrica' : 'Cliente') + '</span>' +
      '<span class="pq-cli">' + escMelhoria(s.cliente || '') + '</span></div>' +
    '<div class="pq-os">' + escMelhoria(s.os || '(sem OS)') + (s.it ? '<span class="pq-it"> / ' + escMelhoria(s.it) + '</span>' : '') + '</div>' +
    (linha2 ? '<div class="pq-oc">' + escMelhoria(linha2) + '</div>' : '') +
    (s.desc ? '<div class="pq-desc">' + escMelhoria(s.desc) + '</div>' : '') +
    '<div class="pq-rodape">' + escMelhoria(tipo === 'interno' ? 'Aponte o celular para registrar a produção' : 'Aponte a câmera do celular para ver a ficha da peça') + '</div>';
  wrapper.appendChild(info);
  return wrapper;
}

function printSelecionadas(tipo) {
  let lista = getSelecionadas();
  if (!lista.length) {
    lista = filterServicos();
    if (!lista.length) { alert('Nenhum serviço na tabela.'); return; }
    if (!confirm('Nada selecionado. Imprimir TODAS as ' + lista.length + ' OSs filtradas?')) return;
  }
  const area = document.getElementById('print-area');
  const avulso = tipo !== 'completa' && tipo !== 'interno';
  area.className = tipo === 'completa' ? 'etq-full-mode' : (avulso ? 'qr-avulso' : (lista.length === 1 ? 'single' : ''));
  area.innerHTML = '';
  lista.forEach(s => {
    if (tipo === 'completa') area.appendChild(generateEtiquetaCompleta(s));
    else if (tipo === 'interno') area.appendChild(generateEtiquetaInterna(s));
    else area.appendChild(generatePrintQR(s, tipo));
  });
  setTimeout(() => window.print(), 300);
}

function printCurrent(tipo) {
  const s = servicos.find(x => x.id === currentId);
  if (!s) { alert('Selecione um serviço primeiro.'); return; }
  const area = document.getElementById('print-area');
  area.className = 'qr-avulso';
  area.innerHTML = '';
  area.appendChild(generatePrintQR(s, tipo));
  setTimeout(() => window.print(), 150);
}

function printAll(tipo) {
  const list = filterServicos();
  if (!list.length) { alert('Nenhum serviço na visualização atual.'); return; }
  const area = document.getElementById('print-area');
  area.className = 'qr-avulso';
  area.innerHTML = '';
  list.forEach(s => area.appendChild(generatePrintQR(s, tipo)));
  setTimeout(() => window.print(), 150);
}

function copyLink() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) { alert('Selecione um serviço primeiro.'); return; }
  const url = currentQrTab === 'interno' ? buildApontamentoUrl(s) : buildViewerUrl(s);
  navigator.clipboard.writeText(url)
    .then(() => alert('Link copiado:\n' + url))
    .catch(() => prompt('Copie o link:', url));
}

/** Endereço que vai nos QR codes: o do config.js (ou o desta página, se vazio). */
function urlBaseQr() {
  return (CONFIG.urlVisualizadorPadrao || window.location.href.split('#')[0]).trim();
}



function limparApontamentos() {
  if (!confirm('Apagar TODOS os apontamentos deste dispositivo?')) return;
  localStorage.removeItem(chave('apontamentos'));
  apontamentosRemoto = null;
  renderApontamentos();
}


/* =============== VIEWER EXTERNO =============== */
function activateViewerMode(data) {
  document.body.classList.add('viewer-mode');
  if (data && data.codigo) { carregarEtiquetaPorCodigo(data.codigo); return; }
  preencherViewer(data);
}

/** QR curto: busca a ficha na planilha (leitura pública, só os dados da etiqueta). */
async function carregarEtiquetaPorCodigo(codigo) {
  preencherViewer({ cliente: 'Carregando…' });
  try {
    const r = await fetch(getSyncUrl() + '?action=etiqueta&t=' + encodeURIComponent(codigo), { method: 'GET', redirect: 'follow' }).then(x => x.json());
    if (!r.ok) throw new Error(r.erro || 'erro');
    preencherViewer(r.etiqueta);
  } catch (e) {
    preencherViewer({ cliente: 'Não foi possível carregar a etiqueta', desc: 'Verifique a internet e leia o QR de novo.' });
  }
}

function preencherViewer(data) {
  ['cliente','os','status','qty','desc','des','material','tratamento','emb','oc','it','nf','dt'].forEach(f => {
    const el = document.getElementById('vv-' + f);
    if (el) {
      const v = data[f];
      if (v) { el.textContent = v; el.classList.remove('empty-val'); }
      else { el.textContent = '—'; el.classList.add('empty-val'); }
    }
  });
  document.title = 'Etiqueta ' + (data.os || '') + ' — ' + CONFIG.empresa.nomeCurto;
}


/* =============== MELHORIAS: STATUS, ETAPAS E APONTAMENTO RÁPIDO =============== */
const MELHORIAS_OPERACOES = CONFIG.operacoes;
const MELHORIAS_MAQUINAS = CONFIG.maquinas;
const MELHORIAS_OPERADORES = CONFIG.operadoresPadrao;
const MELHORIAS_ETAPA_STATUS = ['Pendente','Em andamento','Parada','OK','N.A.'];

/* =============== FLUXO DA OS: etapas → Qualidade → Finalizado =============== */
/* OK e N.A. contam como etapa concluída. A "Inspeção Final" é preenchida pela aba Qualidade:
   aprovado = OK; reprovado ou sem inspeção = Pendente. A OS só vai para a Qualidade com todas as
   outras etapas OK/N.A., e só fica Finalizada com a inspeção aprovada. */
function semAcento(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function ehInspecaoFinal(e) { return semAcento(e && e.nome).includes('inspecao final'); }
function etapaConcluida(e) { return e.status === 'OK' || e.status === 'N.A.'; }
function etapasDe(s) { return Array.isArray(s.etapas) ? s.etapas : []; }
function etapaInspecaoFinal(s) { return etapasDe(s).find(ehInspecaoFinal) || null; }
/** Etapas de produção (todas menos a Inspeção Final) que ainda não estão OK/N.A. */
function etapasPendentesProducao(s) { return etapasDe(s).filter(e => !ehInspecaoFinal(e) && !etapaConcluida(e)); }
function liberadaParaQualidade(s) { return etapasPendentesProducao(s).length === 0; }
function qualidadeAprovada(s) {
  const fin = etapaInspecaoFinal(s);
  return fin ? fin.status === 'OK' : s.status === 'Finalizado';
}
let melhoriaTimer = null;

function escMelhoria(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Etapas de uma OS nova, conforme CONFIG.etapasPadrao. */
function etapasPadraoOS() {
  const nomes = Array.isArray(CONFIG.etapasPadrao) ? CONFIG.etapasPadrao : [];
  if (!nomes.length) return [novaEtapaMelhoria()];
  return nomes.map((nome, i) => Object.assign(novaEtapaMelhoria(), { id: Date.now() + i + Math.random(), nome }));
}

function novaEtapaMelhoria() {
  return { id: Date.now() + Math.random(), nome: '', operacao: '', maquina: '', operador: '', status: 'Pendente' };
}

function normalizarServicoMelhoria(s) {
  const n = Object.assign({}, s || {});
  n.id = n.id || nextId++;
  FIELDS.forEach(f => { if (n[f] == null) n[f] = ''; });
  n.status = n.status || 'Aguardando';
  n.etapas = Array.isArray(n.etapas) ? n.etapas.map(e => {
    const et = Object.assign(novaEtapaMelhoria(), e);
    if (et.status === 'Concluída') et.status = 'OK'; // nome antigo
    return et;
  }) : [];
  n.imagem = n.imagem || '';
  return n;
}

/* Recarrega também os serviços do formato antigo, preservando os dados já existentes. */
function loadServicos() {
  let raw = localStorage.getItem(chave('servicos'));
  if (raw) {
    try {
      const d = JSON.parse(raw);
      servicos = (d.servicos || []).map(normalizarServicoMelhoria);
      nextId = Math.max(d.nextId || 1, ...servicos.map(s => Number(s.id) + 1), 1);
      return;
    } catch (e) {}
  }
  raw = localStorage.getItem(chave('labels'));
  if (raw) {
    try {
      const d = JSON.parse(raw);
      servicos = (d.labels || []).map(l => normalizarServicoMelhoria({
        id: l.id, cliente: l.cli || '', oc: l.oc || '', os: l.os || '', it: l.it || '',
        des: l.des || '', desc: l.desc || '', qty: l.qty || '', emb: l.emb || '',
        nf: l.nf || '', dt: l.dt || '', status: 'Em processo'
      }));
      nextId = Math.max(d.nextId || 1, ...servicos.map(s => Number(s.id) + 1), 1);
      saveServicos();
    } catch (e) {}
  }
}

function diasParaPrazoMelhoria(prazo) {
  if (!prazo) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(prazo + 'T00:00:00');
  return Math.ceil((limite - hoje) / 86400000);
}

/** Status da OS calculado pelo fluxo: ninguém precisa atualizar à mão. */
function statusInteligente(s) {
  const base = s.status || 'Aguardando';
  const etapas = etapasDe(s);
  if (etapas.length ? qualidadeAprovada(s) : base === 'Finalizado') return 'Finalizado';
  if (base === 'Expedição') return base;
  const dias = diasParaPrazoMelhoria(s.prazo);
  if (dias !== null && dias < 0) return 'Atrasado';
  const terceiros = etapas.some(e => semAcento(e.nome).includes('terceiriz') && (e.status === 'Em andamento' || e.status === 'Parada'));
  if (terceiros || base === 'Externo com terceiros') return 'Externo com terceiros';
  const iniciou = etapas.some(e => e.status === 'Em andamento' || e.status === 'Parada' || e.status === 'OK');
  if (!iniciou && base === 'Aguardando') return 'Aguardando';
  return dias !== null && dias <= 7 ? 'Alerta' : 'Em processo';
}

function dataEventoMelhoria(timestamp) {
  const d = new Date(String(timestamp || '').replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function chaveAtividadeMelhoria() {
  if (!apontamentoDados) return '';
  const osFull = (apontamentoDados.os || '') + (apontamentoDados.it ? '/' + apontamentoDados.it : '');
  const etapa = (document.getElementById('a-etapa') || {}).value || '';
  const operacao = (document.getElementById('a-operacao') || {}).value || '';
  const maquina = (document.getElementById('a-maquina') || {}).value || '';
  const operador = (document.getElementById('a-operador') || {}).value || '';
  return [osFull, etapa, operacao, maquina, operador].join('||');
}

function estadoAtividadeMelhoria() {
  const chave = chaveAtividadeMelhoria();
  if (!chave || chave.split('||').slice(2).some(v => !v)) {
    return { totalMs: 0, running: false, start: null, lastStatus: '', eventos: [] };
  }
  const eventos = loadApontamentos().filter(a =>
    [osItem(a), a.etapa || '', a.operacao || '', a.maquina || '', a.operador || ''].join('||') === chave
  ).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  let totalMs = 0, inicio = null, lastStatus = '';
  eventos.forEach(e => {
    const t = dataEventoMelhoria(e.timestamp);
    if (!t) return;
    lastStatus = e.status || lastStatus;
    if (e.status === 'Iniciando') {
      if (!inicio) inicio = t;
    } else if (e.status === 'Parado' || e.status === 'Concluído Parcial' || e.status === 'Etapa concluída' || e.status === 'Finalizado') {
      if (inicio) totalMs += Math.max(0, t - inicio);
      inicio = null;
    }
  });
  if (inicio) totalMs += Math.max(0, Date.now() - inicio.getTime());
  return { totalMs, running: !!inicio, start: inicio, lastStatus, eventos };
}

function duracaoMelhoria(ms) {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSegundos / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSegundos % 3600) / 60)).padStart(2, '0');
  const s = String(totalSegundos % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function pintarPainelAtividade() {
  const statusEl = document.getElementById('a-activity-status');
  const clockEl = document.getElementById('a-activity-clock');
  if (!statusEl || !clockEl) return;
  const estado = estadoAtividadeMelhoria();
  const campos = chaveAtividadeMelhoria().split('||');
  if (campos.length < 5 || campos.slice(2).some(v => !v)) {
    statusEl.textContent = 'Selecione operação, máquina e operador';
    clockEl.textContent = '00:00:00';
    return;
  }
  const statusTexto = {
    'Parado': 'Pausada — toque em Iniciar / retomar',
    'Concluído Parcial': 'Pronta para a próxima etapa', 'Etapa concluída': 'Pronta para a próxima etapa',
    'Finalizado': 'Operação finalizada'
  };
  statusEl.textContent = estado.running ? 'Em andamento — cronômetro ativo' : (statusTexto[estado.lastStatus] || 'Aguardando início');
  clockEl.textContent = duracaoMelhoria(estado.totalMs);
}

function atualizarPainelAtividade() {
  if (melhoriaTimer) { clearInterval(melhoriaTimer); melhoriaTimer = null; }
  pintarPainelAtividade();
  if (estadoAtividadeMelhoria().running) melhoriaTimer = setInterval(pintarPainelAtividade, 1000);
}

function statusClass(st) {
  return {
    'Aguardando': 'status-aguardando',
    'Em processo': 'status-em-processo',
    'Atrasado': 'status-atrasado',
    'Finalizado': 'status-finalizado',
    'Alerta': 'status-alerta',
    'Expedição': 'status-expedicao',
    'Externo com terceiros': 'status-externo'
  }[st] || '';
}

/** % de uma etapa: concluída = 100; em andamento/parada = o informado; pendente = 0. */
function percentualEtapa(e) {
  if (etapaConcluida(e)) return 100;
  if (e.status === 'Em andamento' || e.status === 'Parada') return Math.min(99, Math.max(0, Number(e.percentual) || 0));
  return 0;
}

function selectPercentualEtapa(e, i) {
  const editavel = e.status === 'Em andamento' || e.status === 'Parada';
  const atual = percentualEtapa(e);
  if (!editavel) return '<select disabled title="Disponível com a etapa em andamento ou parada"><option>' + (e.status === 'OK' ? '100%' : e.status === 'N.A.' ? 'N.A.' : '—') + '</option></select>';
  let opts = '';
  for (let p = 0; p <= 90; p += 10) opts += '<option value="' + p + '"' + (p === Math.floor(atual / 10) * 10 ? ' selected' : '') + '>' + p + '%</option>';
  return '<select title="Quanto desta etapa já foi feito" onchange="updateEtapa(' + i + ',\'percentual\',Number(this.value))">' + opts + '</select>';
}

function resumoEtapasMelhoria(s) {
  const etapas = Array.isArray(s.etapas) ? s.etapas : [];
  const concluidas = etapas.filter(etapaConcluida).length;
  const soma = etapas.reduce((t, e) => t + percentualEtapa(e), 0);
  const percentual = etapas.length ? Math.round(soma / etapas.length) : 0;
  return { total: etapas.length, concluidas, percentual };
}

function optionsMelhoria(lista, selecionado, placeholder) {
  return '<option value="">' + escMelhoria(placeholder || '— selecione —') + '</option>' +
    lista.map(v => '<option' + (v === selecionado ? ' selected' : '') + '>' + escMelhoria(v) + '</option>').join('');
}

/** Avanço da OS no topo das etapas: % (OK e N.A. contam 100%), barra e contagem. */
function renderAvancoEtapas(s) {
  const el = document.getElementById('etapas-avanco');
  if (!el) return;
  const etapas = etapasDe(s);
  if (!etapas.length) { el.innerHTML = ''; return; }
  const r = resumoEtapasMelhoria(s);
  const pend = etapasPendentesProducao(s).length;
  const cor = qualidadeAprovada(s) ? '#00B050' : (r.percentual >= 70 ? '#006699' : r.percentual >= 30 ? '#f59e0b' : '#94a3b8');
  const situacao = qualidadeAprovada(s) ? '✔ Finalizada (inspeção aprovada)'
    : pend ? pend + ' etapa' + (pend === 1 ? '' : 's') + ' de produção pendente' + (pend === 1 ? '' : 's')
    : 'Produção concluída · aguardando inspeção final';
  el.innerHTML =
    '<div class="ea-topo"><span class="ea-rotulo">Avanço</span><span class="ea-pct" style="color:' + cor + '">' + r.percentual + '%</span>' +
    '<span class="ea-info">' + r.concluidas + '/' + r.total + ' etapas OK ou N.A. · ' + situacao + '</span></div>' +
    '<div class="ea-barra"><div class="ea-fill" style="width:' + r.percentual + '%;background:' + cor + '"></div></div>';
}

function renderEtapasEditor() {
  const box = document.getElementById('etapas-editor');
  const s = servicos.find(x => x.id === currentId);
  if (!box || !s) return;
  renderAvancoEtapas(s);
  const etapas = s.etapas || [];
  if (!etapas.length) {
    box.innerHTML = '<div class="stage-empty">Nenhuma etapa criada. Adicione as operações necessárias para esta OS.</div>';
    return;
  }
  box.innerHTML = etapas.map((e, i) =>
    '<div class="stage-row">' +
      '<input value="' + escMelhoria(e.nome) + '" placeholder="Ex.: preparar peça" onchange="updateEtapa(' + i + ',\'nome\',this.value)">' +
      '<select onchange="updateEtapa(' + i + ',\'operacao\',this.value)">' + optionsMelhoria(MELHORIAS_OPERACOES, e.operacao) + '</select>' +
      '<select onchange="updateEtapa(' + i + ',\'maquina\',this.value)">' + optionsMelhoria(MELHORIAS_MAQUINAS, e.maquina) + '</select>' +
      '<select onchange="updateEtapa(' + i + ',\'operador\',this.value)">' + optionsMelhoria(MELHORIAS_OPERADORES, e.operador, '— responsável —') + '</select>' +
      (ehInspecaoFinal(e)
        ? celulaInspecaoFinal(s, e)
        : '<select onchange="updateEtapa(' + i + ',\'status\',this.value)">' + optionsMelhoria(MELHORIAS_ETAPA_STATUS, e.status) + '</select>' + selectPercentualEtapa(e, i)) +
      '<button type="button" class="stage-remove" onclick="removeEtapa(' + i + ')" title="Remover etapa">✕</button>' +
    '</div>'
  ).join('');
}

/** Inspeção Final na OS: não se escolhe o status aqui, ela é feita na Qualidade. */
function celulaInspecaoFinal(s, e) {
  if (e.status === 'OK') return '<span class="insp-final ok" title="Aprovada na aba Qualidade">✔ Aprovada</span>';
  if (liberadaParaQualidade(s)) return '<button type="button" class="insp-final btn-inspecionar" onclick="inspecionarOSAtual()" title="Abre o checklist desta OS na aba Qualidade">📋 Inspecionar</button>';
  const pend = etapasPendentesProducao(s);
  return '<span class="insp-final bloq" title="Faltam: ' + escMelhoria(pend.map(x => x.nome || 'etapa').join(', ')) + '">🔒 Falta' + (pend.length === 1 ? '' : 'm') + ' ' + pend.length + ' etapa' + (pend.length === 1 ? '' : 's') + '</span>';
}

function inspecionarOSAtual() {
  const id = currentId;
  if (id === null) return;
  switchTab('qualidade');
  abrirChecklist(id);
}

function addEtapa() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) return;
  if (!Array.isArray(s.etapas)) s.etapas = [];
  s.etapas.push(novaEtapaMelhoria());
  saveServicos();
  renderEtapasEditor();
  renderServicos();
}

function updateEtapa(index, campo, valor) {
  const s = servicos.find(x => x.id === currentId);
  if (!s || !s.etapas[index]) return;
  if (campo === 'status' && ehInspecaoFinal(s.etapas[index])) return; // só a Qualidade muda
  const reabre = campo === 'status' && qualidadeAprovada(s) && etapaConcluida(s.etapas[index]) && !etapaConcluida({ status: valor });
  if (reabre && !confirm('Esta OS já está FINALIZADA (inspeção aprovada).\n\nMudar "' + (s.etapas[index].nome || 'etapa') + '" para ' + valor + ' reabre a OS: ela sai das Finalizadas e precisará de nova inspeção na Qualidade depois que todas as etapas estiverem OK/N.A.\n\nContinuar?')) {
    renderEtapasEditor();
    return;
  }
  s.etapas[index][campo] = valor;
  if (campo === 'status' && valor === 'Pendente') s.etapas[index].percentual = 0;
  if (reabre) reabrirOS(s);
  saveServicos();
  renderEtapasEditor();
  renderServicos();
}

function removeEtapa(index) {
  const s = servicos.find(x => x.id === currentId);
  if (!s || !s.etapas[index]) return;
  s.etapas.splice(index, 1);
  saveServicos();
  renderEtapasEditor();
  renderServicos();
}

function renderImagemMelhoria(s) {
  const preview = document.getElementById('f-imagem-preview');
  if (!preview) return;
  if (s && s.imagem) {
    preview.src = s.imagem;
    preview.style.display = 'block';
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
}

function handleImagem(event) {
  const s = servicos.find(x => x.id === currentId);
  const file = event.target.files && event.target.files[0];
  if (!s || !file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert('Escolha uma imagem de até 5 MB para manter o arquivo leve.');
    event.target.value = '';
    return;
  }
  /* Reduz antes de guardar: a imagem vai para o Drive pela planilha. */
  comprimirImagem(file, 1200, 0.75).then(dataUrl => {
    s.imagem = dataUrl;
    saveServicos();
    renderImagemMelhoria(s);
  }).catch(() => alert('Não foi possível ler esta imagem.'));
}

function addServico() {
  const s = { id: novoIdServico() };
  FIELDS.forEach(f => s[f] = '');
  s.status = 'Aguardando';
  s.etapas = etapasPadraoOS();
  s.imagem = '';
  servicos.push(s);
  currentId = s.id;
  saveServicos();
  renderServicos();
  openEditPanel();
  document.getElementById('f-cliente').focus();
}

function updateServico() {
  if (currentId === null) return;
  const s = servicos.find(x => x.id === currentId);
  if (!s) return;
  const statusSel = document.getElementById('f-status');
  if (statusSel && statusSel.value === 'Finalizado' && etapasDe(s).length && !qualidadeAprovada(s)) {
    alert('A OS só fica Finalizada com a inspeção aprovada na aba Qualidade.' +
      (liberadaParaQualidade(s) ? '' : ' Antes disso, todas as etapas precisam estar OK ou N.A.'));
    statusSel.value = s.status === 'Finalizado' ? 'Em processo' : (s.status || 'Aguardando');
  }
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) s[f] = el.value;
  });
  saveServicos();
  renderServicos();
  renderQr();
  updateEditTitle();
}

const ORDEM_STATUS = ['Aguardando', 'Em processo', 'Alerta', 'Atrasado', 'Externo com terceiros', 'Expedição', 'Finalizado'];

/** Busca + cliente (sem o filtro de status): base das contagens por status. */
function servicosSemFiltroStatus() {
  const search = (document.getElementById('search-servico').value || '').toLowerCase();
  const cliente = (document.getElementById('filter-cliente') || {}).value || '';
  return servicos.filter(s => {
    if (cliente && (s.cliente || '').trim() !== cliente) return false;
    if (search) {
      const etapas = (s.etapas || []).map(e => [e.nome, e.operacao, e.maquina, e.operador].join(' ')).join(' ');
      const hay = [s.cliente, s.oc, s.os, s.it, s.des, s.desc, statusInteligente(s), etapas].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function filterServicos() {
  const status = document.getElementById('filter-status').value;
  // Finalizadas ficam na aba própria; aparecem aqui só se o filtro pedir
  return servicosSemFiltroStatus().filter(s => status ? statusInteligente(s) === status : statusInteligente(s) !== 'Finalizado');
}

function filtrarPorStatus(status) {
  if (status === 'Finalizado') { switchTab('finalizadas'); return; }
  const sel = document.getElementById('filter-status');
  sel.value = sel.value === status ? '' : status;
  renderServicos();
}

/** Cartões com a quantidade de OS por status (respeitam busca e cliente). */
function renderResumoStatus() {
  const box = document.getElementById('status-resumo');
  if (!box) return;
  const base = servicosSemFiltroStatus();
  const cont = {};
  base.forEach(s => { const st = statusInteligente(s); cont[st] = (cont[st] || 0) + 1; });
  const ativo = document.getElementById('filter-status').value;
  const cartao = (rotulo, valor, n, cls) =>
    '<button type="button" class="resumo-card ' + cls + (ativo === valor ? ' ativo' : '') + (n ? '' : ' vazio') + '" onclick="filtrarPorStatus(\'' + valor + '\')">' +
      '<span class="resumo-n">' + n + '</span><span class="resumo-rotulo">' + escMelhoria(rotulo) + '</span></button>';
  box.innerHTML = cartao('Todas', '', base.length, 'resumo-total') +
    ORDEM_STATUS.map(st => cartao(st, st, cont[st] || 0, statusClass(st))).join('');
}

/* =============== ABA FINALIZADAS =============== */
function diasPrazoXEntrega(s) {
  if (!s.prazo || !s.dt) return '';
  return Math.round((new Date(s.prazo + 'T00:00:00') - new Date(s.dt + 'T00:00:00')) / 86400000);
}

let filtroPrazoFin = '';
function classePrazoFin(s) {
  const d = diasPrazoXEntrega(s);
  return d === '' ? 'sem' : (d < 0 ? 'atraso' : 'prazo');
}
function filtrarPrazoFin(c) { filtroPrazoFin = filtroPrazoFin === c ? '' : c; renderFinalizadas(); }

function finalizadasSemFiltroPrazo() {
  const busca = semAcento((document.getElementById('search-fin') || {}).value || '');
  const cliente = (document.getElementById('filter-cliente-fin') || {}).value || '';
  return servicos.filter(s => statusInteligente(s) === 'Finalizado')
    .filter(s => !cliente || (s.cliente || '').trim() === cliente)
    .filter(s => !busca || semAcento([s.cliente, s.oc, s.os, s.it, s.des, s.desc, s.nf, s.obs].join(' ')).includes(busca));
}

function listaFinalizadas() {
  return finalizadasSemFiltroPrazo()
    .filter(s => !filtroPrazoFin || classePrazoFin(s) === filtroPrazoFin)
    .sort((a, b) => (b.dt || b.prazo || '').localeCompare(a.dt || a.prazo || ''));
}

function renderFinalizadas() {
  const sel = document.getElementById('filter-cliente-fin');
  if (sel) {
    const atual = sel.value;
    const clientes = Array.from(new Set(servicos.filter(s => statusInteligente(s) === 'Finalizado').map(s => (s.cliente || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sel.innerHTML = '<option value="">Todos os clientes</option>' + clientes.map(c => '<option' + (c === atual ? ' selected' : '') + '>' + escMelhoria(c) + '</option>').join('');
  }
  // Cartões: total, no prazo, com atraso, sem data de entrega
  const base = finalizadasSemFiltroPrazo();
  const cont = { prazo: 0, atraso: 0, sem: 0 };
  base.forEach(s => cont[classePrazoFin(s)]++);
  const cartao = (rot, chave, n, cls) => '<button type="button" class="resumo-card ' + cls + (filtroPrazoFin === chave ? ' ativo' : '') + (n ? '' : ' vazio') + '" onclick="filtrarPrazoFin(\'' + chave + '\')"><span class="resumo-n">' + n + '</span><span class="resumo-rotulo">' + rot + '</span></button>';
  document.getElementById('fin-resumo').innerHTML =
    cartao('Finalizadas', '', base.length, 'resumo-total') +
    cartao('No prazo', 'prazo', cont.prazo, 'fin-card-prazo') +
    cartao('Com atraso', 'atraso', cont.atraso, 'fin-card-atraso') +
    cartao('Sem data de entrega', 'sem', cont.sem, 'fin-card-sem');

  const list = listaFinalizadas();
  document.getElementById('fin-count').textContent = list.length + ' OS';
  const tbody = document.getElementById('tbody-finalizadas');
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Nenhuma OS finalizada.</td></tr>'; return; }
  tbody.innerHTML = list.map(s => {
    const d = diasPrazoXEntrega(s);
    const pill = d === '' ? '<span class="fin-pill sem">sem data</span>'
      : d < 0 ? '<span class="fin-pill atraso">' + (-d) + ' dia' + (d === -1 ? '' : 's') + ' de atraso</span>'
      : d === 0 ? '<span class="fin-pill prazo">no dia</span>'
      : '<span class="fin-pill prazo">' + d + ' dia' + (d === 1 ? '' : 's') + ' antes</span>';
    const obs = s.obs ? '<div class="fin-obs">📝 ' + escMelhoria(s.obs) + '</div>' : '';
    return '<tr onclick="abrirFinalizada(' + Number(s.id) + ')">' +
      '<td class="nw"><strong>' + escMelhoria(s.cliente || '—') + '</strong></td>' +
      '<td class="nw">' + escMelhoria(s.os || '—') + '</td><td class="nw">' + escMelhoria(s.it || '—') + '</td>' +
      '<td class="fin-oc">' + escMelhoria(s.oc || '—') + '</td>' +
      '<td class="fin-des" title="' + escMelhoria(s.des || '') + '">' + escMelhoria(s.des || '—') + '</td>' +
      '<td class="fin-desc">' + escMelhoria(s.desc || '—') + obs + '</td>' +
      '<td class="num">' + escMelhoria(s.qty || '—') + '</td>' +
      '<td class="nw">' + escMelhoria(fmtDate(s.prazo) || '—') + '</td><td class="nw">' + escMelhoria(fmtDate(s.dt) || '—') + '</td>' +
      '<td class="nw">' + escMelhoria(s.nf || '—') + '</td><td class="nw">' + pill + '</td></tr>';
  }).join('');
}

function abrirFinalizada(id) {
  switchTab('servicos');
  selectServico(id);
}

function exportarFinalizadas() {
  const list = listaFinalizadas();
  if (!list.length) { alert('Nenhuma OS finalizada.'); return; }
  const cols = ['cliente','oc','os','it','des','desc','qty','material','tratamento','prazo','dt','nf','prazoXEntrega','obs'];
  const rows = list.map(s => cols.map(c => '"' + String(c === 'prazoXEntrega' ? diasPrazoXEntrega(s) : (s[c] || '')).replace(/"/g, '""') + '"').join(';'));
  const blob = new Blob(['\uFEFF' + cols.join(';') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'os-finalizadas-' + new Date().toISOString().slice(0, 10) + '.csv'; link.click(); URL.revokeObjectURL(url);
}

function atualizarFiltroClientes() {
  const sel = document.getElementById('filter-cliente');
  if (!sel) return;
  const atual = sel.value;
  const clientes = Array.from(new Set(servicos.map(s => (s.cliente || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const html = '<option value="">Todos os clientes</option>' + clientes.map(c => '<option' + (c === atual ? ' selected' : '') + '>' + escMelhoria(c) + '</option>').join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
  if (atual && !clientes.includes(atual)) sel.value = '';
}

function renderServicos() {
  atualizarFiltroClientes();
  renderResumoStatus();
  const list = filterServicos();
  const tbody = document.getElementById('tbody-servicos');
  document.getElementById('servico-count').textContent = list.length + ' serviço' + (list.length === 1 ? '' : 's');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">Nenhum serviço encontrado. Clique em "+ Novo serviço".</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => {
    const smartStatus = statusInteligente(s);
    const resumo = resumoEtapasMelhoria(s);
    return '<tr class="' + (s.id === currentId ? 'selected' : '') + '" onclick="selectServico(' + Number(s.id) + ')">' +
      '<td style="text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" class="chk-row" data-id="' + Number(s.id) + '" ' + (selecionadas.has(Number(s.id)) ? 'checked' : '') + ' onchange="toggleRow(' + Number(s.id) + ', this.checked)"></td>' +
      '<td><strong>' + escMelhoria(s.cliente || '—') + '</strong></td>' +
      '<td>' + escMelhoria(s.oc || '—') + '</td>' +
      '<td>' + escMelhoria(s.os || '—') + '</td>' +
      '<td>' + escMelhoria(s.it || '—') + '</td>' +
      '<td>' + escMelhoria(s.des || '—') + '</td>' +
      '<td>' + escMelhoria(s.desc || '—') + '</td>' +
      '<td>' + escMelhoria(s.qty || '—') + '</td>' +
      '<td>' + escMelhoria(fmtDate(s.prazo) || '—') + '</td>' +
      '<td class="stage-progress">' + (resumo.total ? '<div class="stage-progress-text">' + resumo.concluidas + '/' + resumo.total + ' concluídas · ' + resumo.percentual + '%</div><div class="progress-track"><div class="progress-fill" style="width:' + resumo.percentual + '%"></div></div>' : '—') + '</td>' +
      '<td><span class="status-badge ' + statusClass(smartStatus) + '">' + escMelhoria(smartStatus) + '</span></td>' +
      '<td class="actions">' +
        '<button class="btn-success btn-sm" onclick="event.stopPropagation(); selectServico(' + Number(s.id) + '); printEtiquetaCompleta()" title="Etiqueta completa (dados + QR)">🖨 Etq</button>' +
        '<button class="btn-primary btn-sm" onclick="event.stopPropagation(); selectServico(' + Number(s.id) + '); printCurrent(\'externo\')" title="Só QR externo (cliente)">🖨 Ext</button>' +
        '<button class="btn-warning btn-sm" onclick="event.stopPropagation(); selectServico(' + Number(s.id) + '); printCurrent(\'interno\')" title="Só QR interno (apontamento)">🖨 Int</button>' +
        '<button class="btn-danger btn-sm" onclick="deleteServico(' + Number(s.id) + ', event)">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function openEditPanel() {
  const s = servicos.find(x => x.id === currentId);
  if (!s) return;
  atualizarSelectMaterialServico();
  atualizarCamposExternoServico();
  popularSelectFornecedores(document.getElementById('f-externo-fornecedor'), ['serviço externo', 'material e serviço']);
  document.getElementById('edit-panel').style.display = 'block';
  FIELDS.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (el) el.value = s[f] || '';
  });
  renderEtapasEditor();
  renderImagemMelhoria(s);
  updateEditTitle();
  renderQr();
}

/* =============== QR COMPACTO =============== */
/*
 * O QR é impresso com 20 x 20 mm, então o link precisa ser curto: sem JSON/base64,
 * campos separados por "!" e etapas padrão viram números (índice em CONFIG.etapasPadrao).
 * Formato: #i=~os!it!cliente!oc!desc!etapas   e   #e=~cliente!os!it!oc!qty!desc!des!material!tratamento!emb!nf!dt!status
 * QRs antigos (base64) continuam funcionando.
 */
const QR_STATUS = ['Aguardando', 'Em processo', 'Alerta', 'Atrasado', 'Externo com terceiros', 'Expedição', 'Finalizado'];
function qrEnc(v) { return encodeURIComponent(String(v == null ? '' : v)).replace(/[!*.'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function qrDec(v) { try { return decodeURIComponent(v || ''); } catch (e) { return v || ''; } }
function qrCorta(t, n) { return String(t || '').trim().slice(0, n).trim(); }

function qrEtapas(etapas) {
  const padrao = Array.isArray(CONFIG.etapasPadrao) ? CONFIG.etapasPadrao : [];
  const lista = (etapas || []).map(e => {
    const i = padrao.indexOf(e.nome);
    const nome = i >= 0 ? String(i) : qrEnc(e.nome || e.operacao || '');
    const extra = [e.operacao, e.maquina, e.operador].some(Boolean) ? '.' + [e.operacao, e.maquina, e.operador].map(qrEnc).join('.') : '';
    return nome + extra;
  });
  // Lista igual à padrão inteira: só "P"
  if (lista.length === padrao.length && lista.every((x, i) => x === String(i))) return 'P';
  return lista.join('*');
}
function qrEtapasDec(txt) {
  const padrao = Array.isArray(CONFIG.etapasPadrao) ? CONFIG.etapasPadrao : [];
  if (txt === 'P') return padrao.map(nome => ({ nome }));
  if (!txt) return [];
  return txt.split('*').map(p => {
    const [n, op, maq, oper] = p.split('.');
    const nome = /^\d+$/.test(n) && padrao[Number(n)] !== undefined ? padrao[Number(n)] : qrDec(n);
    return { nome, operacao: qrDec(op), maquina: qrDec(maq), operador: qrDec(oper) };
  });
}

/* QR interno: só OS, item e etapas (cliente/OC/descrição a planilha completa ao gravar). */
function buildApontamentoUrl(d) {
  return urlBaseQr() + '#i=~' + [d.os, d.it, '', '', ''].map(qrEnc).join('!') + '!' + qrEtapas(d.etapas);
}

/* QR do cliente: com o backend 1.3, só um código curto; a ficha é lida da planilha ao abrir. */
const BACKEND_ETIQUETA_KEY = chave('backend_etiqueta');
function backendTemEtiqueta() { return localStorage.getItem(BACKEND_ETIQUETA_KEY) === '1'; }
async function conferirRecursosBackend() {
  if (!getSyncUrl()) return;
  try {
    const r = await fetch(getSyncUrl() + '?action=recursos', { method: 'GET', redirect: 'follow' }).then(x => x.json());
    if (r && r.ok && r.etiqueta) localStorage.setItem(BACKEND_ETIQUETA_KEY, '1'); else localStorage.removeItem(BACKEND_ETIQUETA_KEY);
  } catch (e) { /* sem internet: mantém o que sabia */ }
}
function tokenQr(s) {
  if (!s.qr) {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
    s.qr = Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    const real = servicos.find(x => x.id === s.id);
    if (real && real !== s) real.qr = s.qr;
    saveServicos();
  }
  return s.qr;
}

function buildViewerUrl(d) {
  if (backendTemEtiqueta() && d.id != null) return urlBaseQr() + '#e=.' + tokenQr(d);
  const st = QR_STATUS.indexOf(statusInteligente(d));
  return urlBaseQr() + '#e=~' + [d.cliente, d.os, d.it, d.oc, d.qty, qrCorta(d.desc, 45), qrCorta(d.des, 25), d.material, d.tratamento, d.emb, d.nf, fmtDate(d.dt)]
    .map(qrEnc).join('!') + '!' + (st >= 0 ? st : qrEnc(statusInteligente(d)));
}

/** Lê o conteúdo do QR (formato compacto "~..." ou o antigo em base64). */
function lerQr(tipo, txt) {
  if (tipo === 'e' && txt.charAt(0) === '.') return { codigo: txt.slice(1).replace(/[^a-z0-9]/g, '') };
  if (txt.charAt(0) !== '~') return b64dec(txt);
  const p = txt.slice(1).split('!');
  if (tipo === 'i') {
    return { os: qrDec(p[0]), it: qrDec(p[1]), cliente: qrDec(p[2]), oc: qrDec(p[3]), desc: qrDec(p[4]), etapas: qrEtapasDec(p[5] || '') };
  }
  const st = p[12] || '';
  return {
    cliente: qrDec(p[0]), os: qrDec(p[1]), it: qrDec(p[2]), oc: qrDec(p[3]), qty: qrDec(p[4]), desc: qrDec(p[5]), des: qrDec(p[6]),
    material: qrDec(p[7]), tratamento: qrDec(p[8]), emb: qrDec(p[9]), nf: qrDec(p[10]), dt: qrDec(p[11]),
    status: /^\d+$/.test(st) ? (QR_STATUS[Number(st)] || '') : qrDec(st)
  };
}

async function ensureApontamentosCarregados() {
  if (apontamentosRemoto === null && getSyncUrl()) {
    await fetchApontamentosRemoto();
  }
}

async function renderApontamentos() {
  await ensureApontamentosCarregados();
  const list = apontamentosConsolidados();
  const search = (document.getElementById('search-aponta').value || '').toLowerCase();
  const status = document.getElementById('filter-status-a').value;
  const filtered = list.filter(a => {
    if (status && a.status !== status) return false;
    return !search || [a.os, a.item, a.etapa, a.cliente, a.oc, a.operacao, a.maquina, a.operador, a.status].join(' ').toLowerCase().includes(search);
  }).sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  document.getElementById('aponta-count').textContent = filtered.length + ' apontamento' + (filtered.length === 1 ? '' : 's');
  const tbody = document.getElementById('tbody-apontamentos');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty">Nenhum apontamento neste dispositivo.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(a =>
    '<tr><td>' + escMelhoria(a.timestamp || '') + '</td>' +
    '<td><strong>' + escMelhoria(a.os || '') + '</strong></td>' +
    '<td>' + escMelhoria(a.item || '—') + '</td>' +
    '<td>' + escMelhoria(a.etapa || '—') + '</td>' +
    '<td>' + escMelhoria(a.cliente || '') + '</td><td>' + escMelhoria(a.oc || '') + '</td>' +
    '<td>' + escMelhoria(a.operacao || '') + '</td><td>' + escMelhoria(a.maquina || '') + '</td>' +
    '<td>' + escMelhoria(a.operador || '') + '</td><td>' + escMelhoria(a.status || '') + '</td><td>' + escMelhoria(a.qtd || '') + '</td></tr>'
  ).join('');
}

function exportarApontamentos() {
  const list = apontamentosConsolidados();
  if (!list.length) { alert('Nenhum apontamento registrado neste dispositivo.'); return; }
  const cols = ['timestamp','os','item','etapa','cliente','oc','descricao','operacao','maquina','operador','status','qtd'];
  const rows = list.map(a => cols.map(c => '"' + String(a[c] || '').replace(/"/g,'""') + '"').join(';'));
  const csv = '\uFEFF' + cols.join(';') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'apontamentos-' + CONFIG.storagePrefix + '-' + new Date().toISOString().slice(0,10) + '.csv'; link.click(); URL.revokeObjectURL(url);
}

function computeAnalise() {
  const grupos = {};
  apontamentosConsolidados().forEach(a => {
    const key = [osItem(a), a.etapa || '', a.operacao || '', a.operador || ''].join('||');
    if (!grupos[key]) grupos[key] = { os: a.os, item: a.item, etapa: a.etapa, operacao: a.operacao, maquina: a.maquina, operador: a.operador, eventos: [] };
    grupos[key].eventos.push(a);
  });
  const hoje = new Date(), analise = [];
  Object.values(grupos).forEach(g => {
    g.eventos.sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    let inicio = null, conclusao = null, tempoMs = 0, rodando = null;
    g.eventos.forEach(e => {
      const t = new Date(String(e.timestamp || '').replace(' ', 'T'));
      if (isNaN(t)) return;
      if (e.status === 'Iniciando') { if (!inicio) inicio = e.timestamp; rodando = t; }
      else if (e.status === 'Parado') { if (rodando) tempoMs += t - rodando; rodando = null; }
      else if (e.status === 'Etapa concluída' || e.status === 'Concluído Parcial' || e.status === 'Finalizado') {
        if (rodando) tempoMs += t - rodando;
        rodando = null;
        /* "Concluído Parcial" significa que esta operação está pronta para a próxima etapa. */
        conclusao = e.timestamp;
      }
    });
    if (rodando) tempoMs += hoje - rodando;
    const servico = servicos.find(s => osItemServico(s) === osItem(g));
    const prazo = servico ? servico.prazo : '';
    let situacao = 'Não iniciada', sitClass = 'sit-nao-iniciada';
    if (conclusao) {
      if (prazo && new Date(conclusao.replace(' ', 'T')) > new Date(prazo + 'T23:59:59')) { situacao = 'Entregue com atraso'; sitClass = 'sit-atraso'; }
      else { situacao = 'Concluída no prazo'; sitClass = 'sit-concluida'; }
    } else if (inicio) {
      if (prazo && hoje > new Date(prazo + 'T23:59:59')) { situacao = 'Atrasada'; sitClass = 'sit-atrasada'; }
      else { situacao = 'Em andamento'; sitClass = 'sit-andamento'; }
    }
    analise.push({ os:g.os, item:g.item, etapa:g.etapa, operacao:g.operacao, maquina:g.maquina, operador:g.operador, inicio, conclusao, tempo_min:Math.round(tempoMs/60000), prazo, situacao, sitClass });
  });
  return analise.sort((a,b) => (b.inicio || '').localeCompare(a.inicio || ''));
}

async function renderAnalise() {
  await ensureApontamentosCarregados();
  const analise = computeAnalise(), search = (document.getElementById('search-analise').value || '').toLowerCase(), situacao = document.getElementById('filter-situacao').value;
  const filtered = analise.filter(a => (!situacao || a.situacao === situacao) && (!search || [a.os,a.item,a.etapa,a.operacao,a.operador,a.maquina].join(' ').toLowerCase().includes(search)));
  const tbody = document.getElementById('tbody-analise');
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Nenhuma OS analisada. Registre apontamentos primeiro.</td></tr>'; return; }
  tbody.innerHTML = filtered.map(a => '<tr><td><strong>' + escMelhoria(a.os || '') + '</strong></td><td>' + escMelhoria(a.item || '—') + '</td><td>' + escMelhoria(a.etapa || '—') + '</td><td>' + escMelhoria(a.operacao || '') + '</td><td>' + escMelhoria(a.maquina || '') + '</td><td>' + escMelhoria(a.operador || '') + '</td><td>' + escMelhoria(a.inicio ? a.inicio.substring(0,16) : '—') + '</td><td>' + escMelhoria(a.conclusao ? a.conclusao.substring(0,16) : '—') + '</td><td>' + a.tempo_min + '</td><td>' + escMelhoria(fmtDate(a.prazo) || '—') + '</td><td><span class="situation-badge ' + a.sitClass + '">' + escMelhoria(a.situacao) + '</span></td></tr>').join('');
}

function exportarAnalise() {
  const analise = computeAnalise();
  if (!analise.length) { alert('Sem dados para exportar.'); return; }
  const cols = ['os','item','etapa','operacao','maquina','operador','inicio','conclusao','tempo_min','prazo','situacao'];
  const rows = analise.map(a => cols.map(c => '"' + String(a[c] || '').replace(/"/g,'""') + '"').join(';'));
  const blob = new Blob(['\uFEFF' + cols.join(';') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'analise-por-os-' + new Date().toISOString().slice(0,10) + '.csv'; link.click(); URL.revokeObjectURL(url);
}

function activateApontaMode(data) {
  document.body.classList.add('aponta-mode');
  apontamentoDados = data;
  const osFull = (data.os || '(sem OS)') + (data.it ? '/' + data.it : '');
  document.getElementById('a-os').textContent = osFull;
  const info = [];
  if (data.desc) info.push(data.desc);
  if (data.cliente) info.push(data.cliente);
  if (data.oc) info.push('OC ' + data.oc);
  document.getElementById('a-os-info').textContent = info.join(' · ');
  const etapaSelect = document.getElementById('a-etapa');
  const etapas = Array.isArray(data.etapas) ? data.etapas : [];
  etapaSelect.innerHTML = '<option value="">— sem etapa definida —</option>' + etapas.map(e => '<option value="' + escMelhoria(e.nome || e.operacao) + '">' + escMelhoria(e.nome || e.operacao || 'Etapa') + '</option>').join('');
  atualizarPainelAtividade();
  document.title = 'Apontamento ' + osFull + ' — ' + CONFIG.empresa.nomeCurto;
}

function registrarApontamento(statusOverride) {
  const etapa = document.getElementById('a-etapa').value;
  const operacao = document.getElementById('a-operacao').value;
  const maquina = document.getElementById('a-maquina').value;
  const operador = document.getElementById('a-operador').value;
  const qtd = document.getElementById('a-qtd').value;
  const status = statusOverride || ((document.getElementById('a-status') || {}).value || '');
  if (!operacao || !maquina || !operador || !status) { alert('Preencha operação, máquina e operador antes de iniciar.'); return; }
  const antes = estadoAtividadeMelhoria();
  const feedback = document.getElementById('a-activity-feedback');
  if (status === 'Iniciando' && antes.running) {
    if (feedback) feedback.textContent = 'Esta operação já está em andamento.';
    return;
  }
  if (status === 'Parado' && !antes.running) {
    if (feedback) feedback.textContent = 'Não há uma atividade em andamento para pausar.';
    return;
  }
  if (status === 'Etapa concluída' && !antes.eventos.length) {
    if (feedback) feedback.textContent = 'Inicie a operação antes de encerrá-la.';
    return;
  }
  if (status === 'Iniciando' && (antes.lastStatus === 'Concluído Parcial' || antes.lastStatus === 'Etapa concluída' || antes.lastStatus === 'Finalizado')) {
    if (feedback) feedback.textContent = 'Esta operação já foi encerrada. Use a próxima etapa.';
    return;
  }
  const now = new Date(), pad = n => String(n).padStart(2, '0');
  const timestamp = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  const osFull = (apontamentoDados.os || '') + (apontamentoDados.it ? '/' + apontamentoDados.it : '');
  const apontamento = { timestamp, os: osFull, item: apontamentoDados.it || '', etapa, cliente: apontamentoDados.cliente || '', oc: apontamentoDados.oc || '', descricao: apontamentoDados.desc || '', operacao, maquina, operador, status, qtd: qtd || '' };
  saveApontamento(apontamento);
  atualizarPainelAtividade();
  const nomes = {
    'Iniciando': 'Início/retomada registrada',
    'Parado': 'Pausa registrada',
    'Concluído Parcial': 'Operação encerrada — pronta para a próxima etapa', 'Etapa concluída': 'Etapa encerrada — pronta para a próxima'
  };
  if (feedback) feedback.textContent = (nomes[status] || 'Evento registrado') + ' às ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + '.';
}

function registrarRapido(status) {
  registrarApontamento(status);
}


/* =============== SYNC COM GOOGLE SHEETS =============== */
// URL padrão do Apps Script Web App. Todos os dispositivos usam essa
// por padrão. Se quiser trocar sem republicar o HTML, salve outra
// URL no campo do topo (fica salva no localStorage daquele dispositivo).
const DEFAULT_SYNC_URL = CONFIG.syncUrlPadrao || '';

const SYNC_QUEUE_KEY = chave('sync_queue');
const SYNC_URL_KEY = chave('sync_url');
let syncTimer = null;
let syncingNow = false;

/** Endereço do Apps Script: sempre o do config.js (o campo por computador foi removido). */
function getSyncUrl() {
  return DEFAULT_SYNC_URL.split('?')[0].split('#')[0];
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]'); }
  catch(e) { return []; }
}

function saveQueue(q) {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
}

function enfileirar(apontamento) {
  const q = loadQueue();
  q.push(apontamento);
  saveQueue(q);
  updateSyncBadge();
  setTimeout(syncAgora, 100);
}

async function syncAgora() {
  if (syncingNow) return;
  const url = getSyncUrl();
  if (!url) { updateSyncBadge(); return; }
  const queue = loadQueue();
  if (!queue.length) { updateSyncBadge(); return; }

  syncingNow = true;
  updateSyncBadge('sending');

  try {
    // text/plain evita preflight CORS (limitação do Apps Script)
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(queue),
      redirect: 'follow'
    });
    const txt = await resp.text();
    let data;
    try { data = JSON.parse(txt); } catch(e) { data = { ok: false, erro: 'Resposta inválida' }; }

    if (data.ok) {
      saveQueue([]);
      updateSyncBadge('ok');
    } else {
      updateSyncBadge('error', data.erro || 'erro desconhecido');
    }
  } catch (err) {
    updateSyncBadge('error', err.message || 'sem conexão');
  } finally {
    syncingNow = false;
  }
}

function updateSyncBadge(forceState, msg) {
  const badge = document.getElementById('sync-badge');
  const txtEl = document.getElementById('sync-text');
  if (!badge || !txtEl) return;
  const url = getSyncUrl();
  const queue = loadQueue().concat(typeof servicosPendentes === 'function' ? servicosPendentes() : []);
  badge.classList.remove('off', 'ok', 'pending', 'error');
  if (!url) { badge.classList.add('off'); return; }
  if (forceState === 'sending') { badge.classList.add('pending'); txtEl.textContent = 'Enviando ' + queue.length + '…'; return; }
  if (forceState === 'error') { badge.classList.add('error'); txtEl.textContent = queue.length + ' pendente(s) — ' + (msg || 'erro'); return; }
  if (queue.length === 0) { badge.classList.add('ok'); txtEl.textContent = 'Sincronizado'; }
  else { badge.classList.add('pending'); txtEl.textContent = queue.length + ' pendente(s)'; }
}

function iniciarSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (loadQueue().length > 0 && getSyncUrl()) syncAgora();
  }, 30000);
}

window.addEventListener('online', () => { syncAgora(); if (typeof sincronizarServicos === 'function') sincronizarServicos(); });

/* =============== SYNC MATERIAIS + MOVIMENTAÇÕES (Sheets) =============== */
let materiaisSyncing = false;

async function fetchMateriaisFromSheets() {
  const url = getSyncUrl();
  if (!url) return null;
  try {
    const [respMat, respMov] = await Promise.all([
      fetch(url + '?action=list-materiais', { method: 'GET', redirect: 'follow' }),
      fetch(url + '?action=list-movimentacoes', { method: 'GET', redirect: 'follow' })
    ]);
    const dataMat = JSON.parse(await respMat.text());
    const dataMov = JSON.parse(await respMov.text());
    if (!dataMat.ok || !dataMov.ok) throw new Error(dataMat.erro || dataMov.erro || 'resposta inválida');

    // Reconstrói arrays locais a partir do Sheets. Código é a PK — gera IDs numéricos estáveis por código.
    const codigoParaId = {};
    let maxId = 0;
    // Preserva IDs locais existentes pra não quebrar referências abertas em memória
    materiaisCadastro.forEach(m => {
      if (m.codigo) codigoParaId[String(m.codigo).toUpperCase()] = m.id;
      if (Number(m.id) > maxId) maxId = Number(m.id);
    });

    materiaisCadastro = (dataMat.materiais || []).map(m => {
      const cod = String(m.codigo || '').toUpperCase();
      let id = codigoParaId[cod];
      if (!id) { id = ++maxId; codigoParaId[cod] = id; }
      return {
        id: id,
        codigo: m.codigo || '',
        descricao: m.descricao || '',
        especificacao: m.especificacao || '',
        unidade: m.unidade || '',
        minimo: Number(m.estoqueMinimo) || 0,
        localizacao: m.localizacao || '',
        ativo: m.ativo !== false
      };
    });
    nextMaterialId = maxId + 1;

    // Movimentações: usa código do material pra achar o id local
    let maxMovId = 0;
    movimentosMateriais.forEach(m => { if (Number(m.id) > maxMovId) maxMovId = Number(m.id); });

    movimentosMateriais = (dataMov.movimentacoes || []).map((mv, i) => {
      const cod = String(mv.codigo || '').toUpperCase();
      const materialId = codigoParaId[cod] || 0;
      const ts = (mv.timestamp || '').split(' ')[0]; // só a data
      return {
        id: ++maxMovId,
        data: ts,
        tipo: normalizarTipoDoSheets(mv.tipo),
        materialId: materialId,
        quantidade: Number(mv.quantidade) || 0,
        custoUnitario: 0,
        os: mv.os || '',
        fornecedor: '',
        documento: '',
        lote: (mv.loteDimensao || '').split('|')[0].trim(),
        dimensao: (mv.loteDimensao || '').split('|')[1] ? (mv.loteDimensao || '').split('|')[1].trim() : (mv.loteDimensao || ''),
        responsavel: mv.operador || '',
        observacao: mv.observacao || ''
      };
    });
    nextMovimentoMaterialId = maxMovId + 1;

    saveMateriais();
    // Se o painel de edição de OS estiver aberto, atualiza o dropdown de material
    atualizarSelectMaterialServico();
  atualizarCamposExternoServico();
  popularSelectFornecedores(document.getElementById('f-externo-fornecedor'), ['serviço externo', 'material e serviço']);
    return true;
  } catch (err) {
    console.error('Erro fetch materiais:', err);
    return false;
  }
}

// Alguns tipos usam grafia levemente diferente entre o front e o Apps Script.
// Enviamos EXATAMENTE como o Replit já grava no front; o Apps Script v5.1
// aceita esses mesmos nomes.
function normalizarTipoParaSheets(tipoLocal) { return tipoLocal; }
function normalizarTipoDoSheets(tipoSheets) { return tipoSheets; }

async function enviarMaterialSheets(material) {
  const url = getSyncUrl();
  if (!url) return { ok: false, erro: 'URL Apps Script não configurada' };
  const payload = {
    kind: 'material',
    codigo: material.codigo,
    descricao: material.descricao,
    especificacao: material.especificacao,
    unidade: material.unidade,
    estoqueMinimo: material.minimo,
    localizacao: material.localizacao,
    ativo: material.ativo !== false
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    return JSON.parse(await resp.text());
  } catch (err) { return { ok: false, erro: err.message }; }
}

async function enviarMovimentoSheets(mov, material) {
  const url = getSyncUrl();
  if (!url) return { ok: false, erro: 'URL Apps Script não configurada' };
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = (mov.data || (now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate()))) + ' ' +
             pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
  const loteDim = [mov.lote, mov.dimensao].filter(Boolean).join(' | ');
  const payload = {
    kind: 'movimentacao',
    timestamp: ts,
    codigo: material ? material.codigo : '',
    tipo: normalizarTipoParaSheets(mov.tipo),
    quantidade: mov.quantidade,
    os: mov.os || '',
    loteDimensao: loteDim,
    observacao: mov.observacao || (mov.fornecedor ? 'Fornecedor: ' + mov.fornecedor : '') + (mov.documento ? ' | NF/Doc: ' + mov.documento : ''),
    operador: mov.responsavel || ''
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    return JSON.parse(await resp.text());
  } catch (err) { return { ok: false, erro: err.message }; }
}



// Cache remoto de apontamentos vindos do Sheets. Atualizado quando
// abre uma das abas Apontamentos/Análise (ou botão Atualizar).
let apontamentosRemoto = null; // array | null (não carregado ainda)
let apontamentosLoading = false;

async function fetchApontamentosRemoto() {
  const url = getSyncUrl();
  if (!url) return null;
  if (apontamentosLoading) return apontamentosRemoto;
  apontamentosLoading = true;
  try {
    const resp = await fetch(url + '?action=list', { method: 'GET', redirect: 'follow' });
    const txt = await resp.text();
    const data = JSON.parse(txt);
    if (data.ok && Array.isArray(data.apontamentos)) {
      apontamentosRemoto = data.apontamentos.map(separarOsItem);
      return apontamentosRemoto;
    }
  } catch (err) {
    console.error('Erro fetch remoto:', err);
  } finally {
    apontamentosLoading = false;
  }
  return apontamentosRemoto;
}

/**
 * Retorna a lista consolidada de apontamentos: os do Sheets (fonte da verdade)
 * mais os pendentes ainda na fila local (sem duplicar).
 */
function apontamentosConsolidados() {
  const remoto = apontamentosRemoto || [];
  const fila = loadQueue();
  const filaLocal = loadApontamentos(); // histórico local (celular)

  // Chave de deduplicação: timestamp + os + operador + status
  const key = a => [a.timestamp, osItem(a), a.operador, a.status].join('||');
  const seen = new Set(remoto.map(key));

  const extras = [];
  filaLocal.forEach(a => {
    const k = key(a);
    if (!seen.has(k)) { extras.push(a); seen.add(k); }
  });

  return remoto.concat(extras);
}



/* =============== QUALIDADE (Checklist + Fotos) =============== */
let checklistsRemoto = null;
let qualiOSAtual = null;      // OS sendo inspecionada
let qualiFotos = [];          // array de dataURLs (base64 já comprimidas)
let qualiMarcacoes = {};      // {item_key: 'OK'|'NOK'|'NA'}

// Estrutura do checklist — cada item pode ser S/N (sim/não) ou S/N/NA (tem "não se aplica")
const CHECKLIST_ITEMS = CONFIG.checklist;

async function fetchChecklistsRemoto() {
  const url = getSyncUrl();
  if (!url) return null;
  try {
    const resp = await fetch(url + '?action=list-checklists', { method: 'GET', redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) { checklistsRemoto = (data.checklists || []).map(separarOsItem); conciliarInspecoes(); return checklistsRemoto; }
  } catch (err) { console.error('Erro fetch checklists:', err); }
  return null;
}

function situacaoOS(s) {
  const todas = (checklistsRemoto || []).filter(c => osItem(c) === osItemServico(s));
  const cls = todas.filter(c => inspecaoValida(s, c));
  if (!cls.length) return todas.length && s.reabertaEm
    ? { badge: 'pendente', texto: 'Reaberta', ultimo: null }
    : { badge: 'pendente', texto: 'Pendente', ultimo: null };
  // Pega o mais recente
  cls.sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const ult = cls[0];
  return {
    badge: (ult.situacao || 'pendente').toLowerCase(),
    texto: ult.situacao || 'Pendente',
    ultimo: ult
  };
}

async function renderQualidade() {
  if (checklistsRemoto === null && getSyncUrl()) await fetchChecklistsRemoto();

  const busca = (document.getElementById('search-quali').value || '').toLowerCase();
  const filtro = document.getElementById('filter-quali').value;

  const list = servicos.map(s => ({ s, sit: situacaoOS(s), lib: liberadaParaQualidade(s) })).filter(o => {
    if (filtro === 'liberada' && !(o.lib && !qualidadeAprovada(o.s))) return false;
    if (filtro === 'bloqueada' && o.lib) return false;
    if (filtro && filtro !== 'liberada' && filtro !== 'bloqueada' && o.sit.badge !== filtro) return false;
    if (busca) {
      const hay = ((o.s.os||'') + ' ' + (o.s.it||'') + ' ' + (o.s.cliente||'') + ' ' + (o.s.desc||'') + ' ' + (o.sit.ultimo?.inspetor||'')).toLowerCase();
      if (!hay.includes(busca)) return false;
    }
    return true;
  });

  document.getElementById('quali-count').textContent = list.length + ' OS' + (list.length === 1 ? '' : 's');
  const tbody = document.getElementById('tbody-qualidade');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="mat-empty">Nenhuma OS pra inspecionar.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(o => {
    const s = o.s, sit = o.sit;
    const resumo = resumoEtapasMelhoria(s);
    const pend = etapasPendentesProducao(s);
    const producao = o.lib
      ? '<span class="ql-liberada">✔ Liberada</span>'
      : '<span class="ql-bloqueada" title="Pendentes: ' + escMelhoria(pend.map(e => e.nome || 'etapa').join(', ')) + '">🔒 ' + pend.length + ' etapa' + (pend.length === 1 ? '' : 's') + ' pendente' + (pend.length === 1 ? '' : 's') + '</span>';
    const qOk = qualidadeAprovada(s);
    return '<tr' + (o.lib ? ' onclick="abrirChecklist(' + Number(s.id) + ')"' : ' class="ql-linha-bloqueada"') + '>' +
      '<td><strong>' + escMelhoria(s.os || '—') + '</strong></td>' +
      '<td>' + escMelhoria(s.it || '—') + '</td>' +
      '<td>' + escMelhoria(s.cliente || '—') + '</td>' +
      '<td>' + escMelhoria(s.desc || '—') + '</td>' +
      '<td>' + escMelhoria(s.qty || '—') + '</td>' +
      '<td>' + producao + '<div class="ql-prod-pct">' + resumo.percentual + '%</div></td>' +
      '<td><span class="ql-qualidade ' + (qOk ? 'ok' : 'pend') + '">' + (qOk ? 'OK' : 'PENDENTE') + '</span></td>' +
      '<td><span class="ql-situacao-badge ' + sit.badge + '">' + sit.texto + '</span></td>' +
      '<td>' + escMelhoria(sit.ultimo?.inspetor || '—') + '</td>' +
      '<td>' + (sit.ultimo ? (sit.ultimo.timestamp || '').substring(0,10).split('-').reverse().join('/') : '—') + '</td>' +
      '<td class="actions">' + (o.lib
        ? '<button class="btn-primary btn-sm" onclick="event.stopPropagation(); abrirChecklist(' + Number(s.id) + ')">📋 Inspecionar</button>'
        : '<button class="btn-secondary btn-sm" disabled title="Conclua (OK) ou marque N.A. em todas as etapas antes">🔒 Bloqueada</button>') + '</td>' +
    '</tr>';
  }).join('');
}

function abrirChecklist(servicoId) {
  const s = servicos.find(x => x.id === servicoId);
  if (!s) return;
  if (!liberadaParaQualidade(s)) {
    const pend = etapasPendentesProducao(s);
    alert('Esta OS ainda não pode ir para a Qualidade.\n\nEtapas pendentes (precisam estar OK ou N.A.):\n• ' + pend.map(e => e.nome || 'etapa sem nome').join('\n• '));
    return;
  }
  qualiOSAtual = s;
  qualiFotos = [];
  qualiMarcacoes = {};

  // Se já tem checklist salvo, carrega os valores pra edição
  const sit = situacaoOS(s);
  if (sit.ultimo) {
    qualiMarcacoes = Object.assign({}, sit.ultimo.marcacoes || {});
    qualiFotos = (sit.ultimo.fotos || []).slice();
    document.getElementById('ql-inspetor').value = sit.ultimo.inspetor || '';
    document.getElementById('ql-observacao').value = sit.ultimo.observacao || '';
  } else {
    document.getElementById('ql-inspetor').value = '';
    document.getElementById('ql-observacao').value = '';
  }

  const osFull = (s.os || '') + (s.it ? '/' + s.it : '');
  document.getElementById('quali-title').textContent = 'Checklist — OS ' + osFull + ' · ' + (s.cliente || '');

  renderChecklistBody(s);
  renderFotos();
  document.getElementById('quali-panel').style.display = 'block';
  document.getElementById('ql-feedback').textContent = '';
  document.getElementById('quali-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeQualiPanel() {
  document.getElementById('quali-panel').style.display = 'none';
  qualiOSAtual = null;
  qualiFotos = [];
  qualiMarcacoes = {};
}

function renderChecklistBody(s) {
  const box = document.getElementById('quali-checklist-content');
  box.innerHTML = CHECKLIST_ITEMS.map(sec => {
    return '<div class="ql-section" style="border-left-color:' + sec.color + ';">' +
      '<h4 style="color:' + sec.color + ';">' + sec.section + '</h4>' +
      sec.items.map(item => {
        const preview = item.preview ? item.preview(s) : '';
        const valor = qualiMarcacoes[item.key] || '';
        return '<div class="ql-item">' +
          '<div class="ql-label"><strong>' + item.label + '</strong>' +
            (preview ? '<span class="ql-value-preview">→ ' + preview + '</span>' : '') +
          '</div>' +
          '<div class="ql-radios">' +
            '<label class="ql-ok"><input type="radio" name="ql-' + item.key + '" value="OK" ' + (valor === 'OK' ? 'checked' : '') + ' onchange="marcarItem(\''+item.key+'\',\'OK\')"><span>✓ OK</span></label>' +
            '<label class="ql-nok"><input type="radio" name="ql-' + item.key + '" value="NOK" ' + (valor === 'NOK' ? 'checked' : '') + ' onchange="marcarItem(\''+item.key+'\',\'NOK\')"><span>✕ NOK</span></label>' +
            (item.na ? '<label class="ql-na"><input type="radio" name="ql-' + item.key + '" value="NA" ' + (valor === 'NA' ? 'checked' : '') + ' onchange="marcarItem(\''+item.key+'\',\'NA\')"><span>N/A</span></label>' : '') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
}

function marcarItem(key, val) {
  qualiMarcacoes[key] = val;
}

async function adicionarFotos(files) {
  if (!files || !files.length) return;
  const disponivel = 6 - qualiFotos.length;
  if (disponivel <= 0) { alert('Máximo 6 fotos por checklist.'); return; }
  const arr = Array.from(files).slice(0, disponivel);
  for (const f of arr) {
    try {
      const dataUrl = await comprimirImagem(f, 800, 0.6);
      qualiFotos.push(dataUrl);
    } catch (err) {
      console.error('Erro compressão:', err);
    }
  }
  renderFotos();
}

function comprimirImagem(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * (maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = w * (maxDim / h); h = maxDim; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function removerFoto(i) {
  qualiFotos.splice(i, 1);
  renderFotos();
}

function renderFotos() {
  const box = document.getElementById('quali-fotos');
  if (!qualiFotos.length) { box.innerHTML = '<div style="color:#999; font-size:12px; padding:8px;">Nenhuma foto ainda.</div>'; return; }
  box.innerHTML = qualiFotos.map((src, i) =>
    '<div class="ql-foto-item">' +
      '<img src="' + src + '" alt="foto ' + (i+1) + '">' +
      '<button onclick="removerFoto(' + i + ')" title="Remover">×</button>' +
    '</div>'
  ).join('');
}

async function salvarChecklist(situacao) {
  if (!qualiOSAtual) return;
  const inspetor = document.getElementById('ql-inspetor').value;
  if (!inspetor && situacao !== 'Rascunho') {
    alert('Selecione o inspetor responsável.');
    return;
  }

  const s = qualiOSAtual;
  if (situacao === 'Aprovado' && !liberadaParaQualidade(s)) {
    alert('Não dá para aprovar: ainda há etapas de produção pendentes.');
    return;
  }
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const timestamp = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+' '+pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());

  const payload = {
    kind: 'checklist',
    timestamp: timestamp,
    os: osItemServico(s),
    item: s.it || '',
    cliente: s.cliente || '',
    codigoPeca: s.des || '',
    qtd: s.qty || '',
    revisaoDesenho: '',
    inspetor: inspetor,
    situacao: situacao,
    observacao: document.getElementById('ql-observacao').value || '',
    motivoNf: '',
    fotos: qualiFotos,
    marcacoes: qualiMarcacoes
  };

  const url = getSyncUrl();
  if (!url) { alert('URL Apps Script não configurada.'); return; }

  const feedback = document.getElementById('ql-feedback');
  feedback.textContent = '⏳ salvando...';
  feedback.style.color = '#666';

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const data = JSON.parse(await resp.text());
    if (data.ok) {
      feedback.textContent = '✓ salvo';
      feedback.style.color = '#16a34a';
      checklistsRemoto = null;
      await fetchChecklistsRemoto();
      renderQualidade();
      aplicarResultadoInspecao(s, situacao);
      setTimeout(() => closeQualiPanel(), 1200);
    } else {
      feedback.textContent = '✗ ' + (data.erro || 'erro');
      feedback.style.color = '#dc2626';
    }
  } catch (err) {
    feedback.textContent = '✗ ' + err.message;
    feedback.style.color = '#dc2626';
  }
}

/**
 * Resultado da inspeção → etapa "Inspeção Final" e status da OS, automaticamente.
 * Aprovado: Inspeção Final = OK e OS Finalizada. Reprovado: Inspeção Final = Pendente e a OS volta para produção.
 * Rascunho não muda nada.
 */
function agoraTimestamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/**
 * Reabre uma OS finalizada: Inspeção Final volta a Pendente, sai de Finalizado e a aprovação
 * anterior deixa de valer (reabertaEm). Só uma inspeção nova, depois disso, finaliza de novo.
 */
function reabrirOS(s) {
  const fin = etapaInspecaoFinal(s);
  if (fin) { fin.status = 'Pendente'; fin.percentual = 0; }
  if (s.status === 'Finalizado') s.status = 'Em processo';
  s.reabertaEm = agoraTimestamp();
}

/** Inspeção que ainda vale para a OS (feita depois da última reabertura). */
function inspecaoValida(s, c) { return !s.reabertaEm || (c.timestamp || '') > s.reabertaEm; }

/** Ajusta a OS ao resultado da inspeção. Devolve true se mudou algo (sem salvar). */
function ajustarOSAoResultado(s, situacao) {
  if (situacao !== 'Aprovado' && situacao !== 'Reprovado') return false;
  let fin = etapaInspecaoFinal(s);
  if (situacao === 'Aprovado') {
    if (!liberadaParaQualidade(s)) return false;
    if (fin && fin.status === 'OK' && s.status === 'Finalizado') return false;
    if (!fin) { fin = Object.assign(novaEtapaMelhoria(), { nome: 'Inspeção Final' }); s.etapas = etapasDe(s).concat([fin]); }
    fin.status = 'OK'; fin.percentual = 100; s.status = 'Finalizado';
    return true;
  }
  if ((!fin || fin.status !== 'OK') && s.status !== 'Finalizado') return false;
  if (fin) { fin.status = 'Pendente'; fin.percentual = 0; }
  if (s.status === 'Finalizado') s.status = 'Em processo';
  return true;
}

/**
 * A última inspeção de cada OS manda na Inspeção Final, mesmo se foi feita em outro aparelho
 * ou antes desta regra existir. Roda sempre que as inspeções são carregadas.
 */
function conciliarInspecoes() {
  const ultima = {};
  (checklistsRemoto || []).forEach(c => {
    if (c.situacao !== 'Aprovado' && c.situacao !== 'Reprovado') return;
    const k = osItem(c);
    if (!ultima[k] || (c.timestamp || '') > (ultima[k].timestamp || '')) ultima[k] = c;
  });
  let mudou = false;
  servicos.forEach(s => {
    // Aprovada com etapa pendente (ex.: alguém voltou uma etapa): reabre
    const fin = etapaInspecaoFinal(s);
    if (fin && fin.status === 'OK' && !liberadaParaQualidade(s)) { reabrirOS(s); mudou = true; return; }
    const c = ultima[osItemServico(s)];
    if (c && inspecaoValida(s, c) && ajustarOSAoResultado(s, c.situacao)) mudou = true;
  });
  if (mudou) {
    saveServicos();
    renderServicos();
    if (abaAtiva() === 'finalizadas') renderFinalizadas();
    if (currentId !== null && !editandoPainelServico()) openEditPanel();
  }
}

function aplicarResultadoInspecao(s, situacao) {
  if (situacao !== 'Aprovado' && situacao !== 'Reprovado') return;
  let fin = etapaInspecaoFinal(s);
  if (!fin) { fin = Object.assign(novaEtapaMelhoria(), { nome: 'Inspeção Final' }); s.etapas = etapasDe(s).concat([fin]); }
  if (situacao === 'Aprovado') {
    fin.status = 'OK'; fin.percentual = 100;
    s.status = 'Finalizado';
  } else {
    fin.status = 'Pendente'; fin.percentual = 0;
    if (s.status === 'Finalizado') s.status = 'Em processo';
  }
  saveServicos();
  renderServicos();
  if (currentId === s.id) openEditPanel();
}

/* =============== CADASTROS: Responsáveis + Fornecedores =============== */
let responsaveisRemoto = null;  // cache do Sheets
let fornecedoresRemoto = null;

async function fetchResponsaveis() {
  const url = getSyncUrl();
  if (!url) return null;
  try {
    const resp = await fetch(url + '?action=list-responsaveis', { method: 'GET', redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) { responsaveisRemoto = data.responsaveis || []; return responsaveisRemoto; }
  } catch (err) { console.error('Erro fetch responsaveis:', err); }
  return null;
}
async function fetchFornecedores() {
  const url = getSyncUrl();
  if (!url) return null;
  try {
    const resp = await fetch(url + '?action=list-fornecedores', { method: 'GET', redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) { fornecedoresRemoto = data.fornecedores || []; return fornecedoresRemoto; }
  } catch (err) { console.error('Erro fetch fornecedores:', err); }
  return null;
}

async function ensureCadastros() {
  const jobs = [];
  if (responsaveisRemoto === null && getSyncUrl()) jobs.push(fetchResponsaveis());
  if (fornecedoresRemoto === null && getSyncUrl()) jobs.push(fetchFornecedores());
  if (jobs.length) await Promise.all(jobs);
}

/* ---------- Popular selects em toda a ferramenta ---------- */
function popularSelectResponsaveis(sel, funcoes) {
  if (!sel) return;
  const val = sel.value;
  const list = (responsaveisRemoto || []).filter(r => r.ativo !== false && (!funcoes || funcoes.length === 0 || funcoes.some(f => (r.funcao || '').toLowerCase().includes(f.toLowerCase()))));
  list.sort((a,b) => a.nome.localeCompare(b.nome));
  const opts = ['<option value="">— selecione —</option>'].concat(list.map(r => '<option>' + r.nome + '</option>'));
  // Preserva valor antigo se ainda existir
  if (val && !list.some(r => r.nome === val)) opts.splice(1, 0, '<option>' + val + ' (removido)</option>');
  sel.innerHTML = opts.join('');
  sel.value = val;
}

function popularSelectFornecedores(sel, tipos) {
  if (!sel) return;
  const val = sel.value;
  const list = (fornecedoresRemoto || []).filter(f => f.ativo !== false && (!tipos || tipos.length === 0 || tipos.some(t => (f.tipo || '').toLowerCase().includes(t.toLowerCase()))));
  list.sort((a,b) => a.nome.localeCompare(b.nome));
  const opts = ['<option value="">— selecione —</option>'].concat(list.map(f => '<option>' + f.nome + '</option>'));
  if (val && !list.some(f => f.nome === val)) opts.splice(1, 0, '<option>' + val + ' (removido)</option>');
  sel.innerHTML = opts.join('');
  sel.value = val;
}

function atualizarTodosSelectsResponsaveis() {
  // Operadores no apontamento (só função Operador)
  document.querySelectorAll('#a-operador').forEach(s => popularSelectResponsaveis(s, ['operador']));
  // Inspetor no checklist (Inspetor ou Operador/Inspetor)
  document.querySelectorAll('#ql-inspetor').forEach(s => popularSelectResponsaveis(s, ['inspetor']));
  // Responsável em movimentação (todos)
  document.querySelectorAll('#mov-responsavel').forEach(s => popularSelectResponsaveis(s, []));
  // Etapas do serviço — se existirem
  document.querySelectorAll('select.etapa-responsavel, select[id^="etapa-resp-"]').forEach(s => popularSelectResponsaveis(s, []));
}

function atualizarTodosSelectsFornecedores() {
  // Fornecedor de compra
  document.querySelectorAll('#mov-fornecedor').forEach(s => popularSelectFornecedores(s, ['material']));
  // Fornecedor externo no serviço
  document.querySelectorAll('#f-externo-fornecedor').forEach(s => popularSelectFornecedores(s, ['serviço externo', 'material e serviço']));
}

/* ---------- CRUD Responsáveis ---------- */
function limparFormResponsavel() {
  document.getElementById('fr-nome').value = '';
  document.getElementById('fr-funcao').value = 'Operador';
  document.getElementById('fr-ativo').value = 'true';
  document.getElementById('fr-feedback').textContent = '';
}

async function salvarResponsavel() {
  const nome = document.getElementById('fr-nome').value.trim();
  if (!nome) { alert('Nome é obrigatório.'); return; }
  const payload = {
    kind: 'responsavel',
    nome: nome,
    funcao: document.getElementById('fr-funcao').value,
    ativo: document.getElementById('fr-ativo').value !== 'false'
  };
  const url = getSyncUrl();
  if (!url) { alert('URL do Apps Script não configurada.'); return; }
  const fb = document.getElementById('fr-feedback');
  fb.textContent = '⏳ salvando...'; fb.style.color = '#666';
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) {
      fb.textContent = '✓ salvo'; fb.style.color = '#16a34a';
      responsaveisRemoto = null;
      await fetchResponsaveis();
      renderResponsaveis();
      atualizarTodosSelectsResponsaveis();
      limparFormResponsavel();
    } else { fb.textContent = '✗ ' + (data.erro || 'erro'); fb.style.color = '#dc2626'; }
  } catch (err) { fb.textContent = '✗ ' + err.message; fb.style.color = '#dc2626'; }
}

function editarResponsavel(nome) {
  const r = (responsaveisRemoto || []).find(x => x.nome === nome);
  if (!r) return;
  document.getElementById('fr-nome').value = r.nome;
  document.getElementById('fr-funcao').value = r.funcao;
  document.getElementById('fr-ativo').value = r.ativo === false ? 'false' : 'true';
}

async function inativarResponsavel(nome) {
  if (!confirm('Inativar "' + nome + '"? Ele deixa de aparecer nos selects, mas o histórico é preservado.')) return;
  const url = getSyncUrl();
  const payload = { kind: 'responsavel', nome: nome, funcao: 'Operador', ativo: false };
  const r = (responsaveisRemoto || []).find(x => x.nome === nome);
  if (r) payload.funcao = r.funcao;
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) { responsaveisRemoto = null; await fetchResponsaveis(); renderResponsaveis(); atualizarTodosSelectsResponsaveis(); }
  } catch (err) { alert('Erro: ' + err.message); }
}

function renderResponsaveis() {
  const tbody = document.getElementById('tbody-responsaveis');
  if (!tbody) return;
  const list = (responsaveisRemoto || []).slice().sort((a,b) => a.nome.localeCompare(b.nome));
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="mat-empty">Nenhum responsável cadastrado.</td></tr>'; return; }
  tbody.innerHTML = list.map(r =>
    '<tr>' +
      '<td><strong>' + r.nome + '</strong></td>' +
      '<td>' + r.funcao + '</td>' +
      '<td>' + (r.ativo === false ? '<span class="mat-badge inativo">Inativo</span>' : '<span class="mat-badge ok">Ativo</span>') + '</td>' +
      '<td class="actions">' +
        '<button class="btn-primary btn-sm" onclick="editarResponsavel(\'' + r.nome.replace(/'/g,"\\'") + '\')">✎ Editar</button> ' +
        (r.ativo !== false ? '<button class="btn-danger btn-sm" onclick="inativarResponsavel(\'' + r.nome.replace(/'/g,"\\'") + '\')">Inativar</button>' : '') +
      '</td>' +
    '</tr>').join('');
}

/* ---------- CRUD Fornecedores ---------- */
function limparFormFornecedor() {
  ['ff-nome','ff-cnpj','ff-contato','ff-observacao'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ff-tipo').value = 'Material';
  document.getElementById('ff-ativo').value = 'true';
  document.getElementById('ff-feedback').textContent = '';
}

async function salvarFornecedor() {
  const nome = document.getElementById('ff-nome').value.trim();
  if (!nome) { alert('Nome é obrigatório.'); return; }
  const payload = {
    kind: 'fornecedor',
    nome: nome,
    tipo: document.getElementById('ff-tipo').value,
    cnpj: document.getElementById('ff-cnpj').value.trim(),
    contato: document.getElementById('ff-contato').value.trim(),
    observacao: document.getElementById('ff-observacao').value.trim(),
    ativo: document.getElementById('ff-ativo').value !== 'false'
  };
  const url = getSyncUrl();
  if (!url) { alert('URL do Apps Script não configurada.'); return; }
  const fb = document.getElementById('ff-feedback');
  fb.textContent = '⏳ salvando...'; fb.style.color = '#666';
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) {
      fb.textContent = '✓ salvo'; fb.style.color = '#16a34a';
      fornecedoresRemoto = null;
      await fetchFornecedores();
      renderFornecedores();
      atualizarTodosSelectsFornecedores();
      limparFormFornecedor();
    } else { fb.textContent = '✗ ' + (data.erro || 'erro'); fb.style.color = '#dc2626'; }
  } catch (err) { fb.textContent = '✗ ' + err.message; fb.style.color = '#dc2626'; }
}

function editarFornecedor(nome) {
  const f = (fornecedoresRemoto || []).find(x => x.nome === nome);
  if (!f) return;
  document.getElementById('ff-nome').value = f.nome;
  document.getElementById('ff-tipo').value = f.tipo;
  document.getElementById('ff-cnpj').value = f.cnpj;
  document.getElementById('ff-contato').value = f.contato;
  document.getElementById('ff-observacao').value = f.observacao;
  document.getElementById('ff-ativo').value = f.ativo === false ? 'false' : 'true';
}

async function inativarFornecedor(nome) {
  if (!confirm('Inativar "' + nome + '"?')) return;
  const url = getSyncUrl();
  const f = (fornecedoresRemoto || []).find(x => x.nome === nome);
  const payload = Object.assign({ kind: 'fornecedor' }, f || { nome: nome }, { ativo: false });
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.ok) { fornecedoresRemoto = null; await fetchFornecedores(); renderFornecedores(); atualizarTodosSelectsFornecedores(); }
  } catch (err) { alert('Erro: ' + err.message); }
}

function renderFornecedores() {
  const tbody = document.getElementById('tbody-fornecedores');
  if (!tbody) return;
  const list = (fornecedoresRemoto || []).slice().sort((a,b) => a.nome.localeCompare(b.nome));
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" class="mat-empty">Nenhum fornecedor cadastrado.</td></tr>'; return; }
  tbody.innerHTML = list.map(f =>
    '<tr>' +
      '<td><strong>' + f.nome + '</strong></td>' +
      '<td>' + f.tipo + '</td>' +
      '<td>' + (f.contato || '—') + '</td>' +
      '<td>' + (f.cnpj || '—') + '</td>' +
      '<td>' + (f.ativo === false ? '<span class="mat-badge inativo">Inativo</span>' : '<span class="mat-badge ok">Ativo</span>') + '</td>' +
      '<td class="actions">' +
        '<button class="btn-primary btn-sm" onclick="editarFornecedor(\'' + f.nome.replace(/'/g,"\\'") + '\')">✎ Editar</button> ' +
        (f.ativo !== false ? '<button class="btn-danger btn-sm" onclick="inativarFornecedor(\'' + f.nome.replace(/'/g,"\\'") + '\')">Inativar</button>' : '') +
      '</td>' +
    '</tr>').join('');
}

async function renderCadastros() {
  await ensureCadastros();
  renderResponsaveis();
  renderFornecedores();
  atualizarTodosSelectsResponsaveis();
  atualizarTodosSelectsFornecedores();
}

/* ---------- Status Externo: mostrar/ocultar campos condicionais ---------- */
function atualizarCamposExternoServico() {
  const status = document.getElementById('f-status');
  if (!status) return;
  const isExterno = status.value === 'Externo com terceiros';
  ['f-externo-fornecedor-wrap','f-externo-envio-wrap','f-externo-retorno-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isExterno ? '' : 'none';
  });
}

/* ---------- Movimento material: campos condicionais ---------- */
function atualizarCamposMovimentoMat() {
  const tipo = document.getElementById('mov-tipo').value;
  const forn = document.getElementById('mov-fornecedor-wrap');
  if (forn) forn.style.opacity = (tipo === 'Compra') ? '1' : '.4';
}

/* =============== OS NA PLANILHA + TEMPO REAL =============== */
/*
 * As OS ficam na aba "Servicos" da planilha e todos os computadores leem de lá.
 * O navegador guarda uma cópia para funcionar sem internet.
 *
 * servicosBase[id] = como a OS estava na última vez que bateu com a planilha.
 * Se a cópia local é diferente da base, a OS tem alteração pendente de envio
 * e a versão local vence; senão, a versão da planilha vence.
 */
const SERVICOS_BASE_KEY = chave('servicos_base');
const INTERVALO_TEMPO_REAL = 20000;
let servicosBase = {};
let servicosPlanilhaOk = false;   // backend tem a aba Servicos
let servicosSincronizando = false;
let envioServicosTimer = null;
let tempoRealTimer = null;

try { servicosBase = JSON.parse(localStorage.getItem(SERVICOS_BASE_KEY) || '{}') || {}; } catch (e) { servicosBase = {}; }
function salvarServicosBase() { localStorage.setItem(SERVICOS_BASE_KEY, JSON.stringify(servicosBase)); }

/** JSON com chaves em ordem fixa, para comparar versões. */
function jsonEstavel(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonEstavel).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jsonEstavel(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function retratoServico(s) {
  const c = Object.assign({}, s);
  delete c.atualizadoEm; delete c.excluido;
  return jsonEstavel(c);
}

/** Lista de pendências: [{ acao, servico }] */
function servicosPendentes() {
  if (!servicosPlanilhaOk) return [];
  const itens = [];
  servicos.forEach(s => {
    if (servicosBase[String(s.id)] !== retratoServico(s)) itens.push({ acao: 'salvar', servico: s });
  });
  const ids = new Set(servicos.map(s => String(s.id)));
  Object.keys(servicosBase).forEach(id => {
    if (!ids.has(id)) itens.push({ acao: 'excluir', servico: { id: Number(id) || id } });
  });
  return itens;
}

function agendarEnvioServicos() {
  if (!servicosPlanilhaOk) return;
  clearTimeout(envioServicosTimer);
  envioServicosTimer = setTimeout(enviarServicos, 1500);
  updateSyncBadge();
}

async function enviarServicos() {
  const url = getSyncUrl();
  if (!url || !servicosPlanilhaOk || servicosSincronizando) return;
  const itens = servicosPendentes();
  if (!itens.length) { updateSyncBadge(); return; }
  servicosSincronizando = true;
  const enviados = {}, imagensEnviadas = {};
  itens.forEach(i => { enviados[String(i.servico.id)] = retratoServico(i.servico); imagensEnviadas[String(i.servico.id)] = i.servico.imagem; });
  let sucesso = false;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind: 'servicos', itens }),
      redirect: 'follow'
    });
    const data = JSON.parse(await resp.text());
    if (!data.ok) throw new Error(data.erro || 'erro');
    let mudou = false;
    (data.servicos || []).forEach(r => {
      const id = String(r.id);
      if (r.excluido) { delete servicosBase[id]; return; }
      const confirmado = normalizarServicoMelhoria(Object.assign({}, r, { atualizadoEm: undefined, excluido: undefined }));
      delete confirmado.atualizadoEm; delete confirmado.excluido;
      const local = servicos.find(s => String(s.id) === id);
      if (local && retratoServico(local) === enviados[id]) {
        // Nada mudou durante o envio: adota a versão da planilha (ex.: imagem virou link do Drive)
        if (local.imagem !== confirmado.imagem) { local.imagem = confirmado.imagem; mudou = true; }
        servicosBase[id] = retratoServico(local);
      } else if (local && local.imagem === imagensEnviadas[id] && local.imagem !== confirmado.imagem) {
        local.imagem = confirmado.imagem; // mudou outro campo durante o envio, mas a imagem já subiu
        mudou = true;
      }
    });
    salvarServicosBase();
    localStorage.setItem(chave('servicos'), JSON.stringify({ servicos, nextId }));
    if (mudou && currentId !== null) renderImagemMelhoria(servicos.find(x => x.id === currentId));
    sucesso = true;
    updateSyncBadge();
  } catch (err) {
    updateSyncBadge('error', err.message || 'sem conexão');
  } finally {
    servicosSincronizando = false;
  }
  // Algo mudou enquanto enviava? manda de novo (em caso de erro, o ciclo de 20 s tenta outra vez).
  if (sucesso && servicosPendentes().length) agendarEnvioServicos();
}

/** Busca as OS da planilha e junta com as do navegador. Retorna true se algo mudou na tela. */
async function receberServicos() {
  const url = getSyncUrl();
  if (!url || servicosSincronizando) return false;
  let data;
  try {
    const resp = await fetch(url + '?action=list-servicos', { method: 'GET', redirect: 'follow' });
    data = JSON.parse(await resp.text());
  } catch (err) { return false; }
  if (!data.ok || !Array.isArray(data.servicos)) { servicosPlanilhaOk = false; return false; }
  servicosPlanilhaOk = true;
  if (servicosSincronizando) return false; // um envio começou enquanto buscava: deixa para a próxima

  const antes = jsonEstavel(servicos);
  const pendentes = new Set(servicosPendentes().map(i => String(i.servico.id)));
  const vistos = new Set();
  data.servicos.forEach(r => {
    const id = String(r.id);
    vistos.add(id);
    let local = servicos.find(s => String(s.id) === id);
    const remoto = normalizarServicoMelhoria(r);
    delete remoto.atualizadoEm; delete remoto.excluido;
    // OS criada neste navegador antes da planilha existir, com o mesmo número de outra: ganha um ID novo
    if (local && !(id in servicosBase)) {
      if (retratoServico(local) === retratoServico(remoto)) { servicosBase[id] = retratoServico(remoto); return; }
      if (!r.excluido) { local.id = novoIdServico(); if (currentId === Number(id)) currentId = local.id; local = null; }
    }
    if (pendentes.has(id) && (local || id in servicosBase)) return; // alteração local ainda não enviada vence
    if (r.excluido) {
      if (local) servicos = servicos.filter(s => s !== local);
      delete servicosBase[id];
      return;
    }
    if (local) servicos[servicos.indexOf(local)] = remoto; else servicos.push(remoto);
    servicosBase[id] = retratoServico(remoto);
  });
  // OS apagada direto na planilha (linha removida): some daqui também
  Object.keys(servicosBase).forEach(id => {
    if (vistos.has(id) || pendentes.has(id)) return;
    servicos = servicos.filter(s => String(s.id) !== id);
    delete servicosBase[id];
  });
  salvarServicosBase();
  nextId = Math.max(nextId, 1);
  localStorage.setItem(chave('servicos'), JSON.stringify({ servicos, nextId }));
  return jsonEstavel(servicos) !== antes;
}

/** Recebe e depois envia o que estiver pendente. */
async function sincronizarServicos() {
  const mudou = await receberServicos();
  if (mudou) atualizarTelaServicos();
  conciliarInspecoes();
  if (servicosPlanilhaOk) await enviarServicos();
  updateSyncBadge();
}

function editandoPainelServico() {
  const painel = document.getElementById('edit-panel');
  return painel && painel.style.display !== 'none' && painel.contains(document.activeElement);
}

function atualizarTelaServicos() {
  renderServicos();
  if (abaAtiva() === 'finalizadas') renderFinalizadas();
  if (currentId === null) return;
  if (!servicos.some(s => s.id === currentId)) { currentId = null; closeEditPanel(); return; }
  if (!editandoPainelServico()) openEditPanel();
}

function abaAtiva() {
  const t = document.querySelector('.tab.active');
  return t ? t.dataset.tab : '';
}

/** A cada 20 s (com a página visível): OS da planilha + a aba aberta. */
let cicloTempoReal = 0;
async function atualizarTempoReal() {
  if (document.hidden || !getSyncUrl()) return;
  await sincronizarServicos();
  // Inspeções feitas em outros aparelhos: confere a cada ~1 min
  if (++cicloTempoReal % 3 === 0 && abaAtiva() !== 'qualidade') await fetchChecklistsRemoto();
  const tab = abaAtiva();
  if (tab === 'apontamentos' || tab === 'analise') {
    await fetchApontamentosRemoto();
    if (abaAtiva() === 'apontamentos') renderApontamentos(); else if (abaAtiva() === 'analise') renderAnalise();
  } else if (tab === 'qualidade') {
    const painel = document.getElementById('quali-panel');
    if (!painel || painel.style.display === 'none' || !painel.offsetParent) {
      await fetchChecklistsRemoto();
      renderQualidade();
    }
  } else if (tab === 'materiais' && !materiaisSyncing) {
    materiaisSyncing = true;
    try { await fetchMateriaisFromSheets(); } finally { materiaisSyncing = false; }
    atualizarSelectMateriais();
    renderMateriais();
  }
}

function iniciarTempoReal() {
  if (!getSyncUrl()) return;
  sincronizarServicos().then(() => fetchChecklistsRemoto());
  if (tempoRealTimer) clearInterval(tempoRealTimer);
  tempoRealTimer = setInterval(atualizarTempoReal, INTERVALO_TEMPO_REAL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarTempoReal(); });
}

/* =============== SENHA DE ACESSO =============== */
/*
 * O Apps Script só responde a pedidos com a senha (parâmetro k).
 * A senha é digitada uma vez por aparelho e fica guardada neste navegador.
 * O fetch abaixo acrescenta a senha a toda chamada para o Apps Script.
 */
const SENHA_KEY = chave('senha');
function senhaSalva() { return localStorage.getItem(SENHA_KEY) || ''; }
function comSenha(url) {
  const k = senhaSalva();
  return k ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(k) : url;
}
const fetchOriginal = window.fetch.bind(window);
window.fetch = function(input, init) {
  const sync = getSyncUrl();
  if (typeof input === 'string' && sync && input.indexOf(sync) === 0) {
    return fetchOriginal(comSenha(input), init).then(resp => {
      resp.clone().text().then(t => { if (t.indexOf('"semAcesso":true') >= 0) pedirSenha(senhaSalva() ? 'A senha mudou. Digite a senha atual.' : ''); }).catch(() => {});
      return resp;
    });
  }
  return fetchOriginal(input, init);
};

let pedindoSenha = false;
function pedirSenha(msg) {
  if (pedindoSenha || window.location.hash.startsWith('#e=')) return; // etiqueta do cliente não usa a planilha
  pedindoSenha = true;
  const el = document.getElementById('tela-senha');
  document.getElementById('senha-msg').textContent = msg || '';
  el.style.display = 'flex';
  setTimeout(() => document.getElementById('senha-input').focus(), 50);
}

async function entrarComSenha(ev) {
  if (ev) ev.preventDefault();
  const input = document.getElementById('senha-input');
  const msg = document.getElementById('senha-msg');
  const senha = input.value.trim();
  if (!senha) return;
  msg.textContent = 'Conferindo…';
  try {
    const resp = await fetchOriginal(getSyncUrl() + '?action=versao&k=' + encodeURIComponent(senha), { method: 'GET', redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (!data.ok) {
      msg.textContent = data.semAcesso ? 'Senha incorreta.' : 'Erro da planilha: ' + (data.erro || 'resposta inesperada') + ' (' + getSyncUrl().slice(-20) + ')';
      input.select();
      return;
    }
    localStorage.setItem(SENHA_KEY, senha);
    location.reload();
  } catch (err) {
    msg.textContent = 'Sem conexão com a planilha. Tente de novo.';
  }
}

function sairDoApp() {
  const pendentes = servicosPendentes().length + loadQueue().length;
  if (pendentes) { alert('Há ' + pendentes + ' alteração(ões) ainda não enviada(s) para a planilha. Aguarde o indicador ficar "Sincronizado" antes de sair.'); return; }
  if (!confirm('Sair deste aparelho? A cópia dos dados guardada neste navegador é apagada e, para usar de novo, será preciso digitar a senha.')) return;
  [SENHA_KEY, chave('servicos'), SERVICOS_BASE_KEY, MATERIAIS_KEY, chave('apontamentos')].forEach(k => localStorage.removeItem(k));
  location.reload();
}

/** Na abertura: se o Apps Script exige senha e este aparelho não tem uma válida, pede. */
async function conferirSenhaNaAbertura() {
  const url = getSyncUrl();
  if (!url) return;
  try {
    const resp = await fetch(url + '?action=versao', { method: 'GET', redirect: 'follow' });
    const data = JSON.parse(await resp.text());
    if (data.semAcesso) pedirSenha(senhaSalva() ? 'A senha mudou. Digite a senha atual.' : '');
    const sair = document.getElementById('btn-sair');
    if (sair) sair.style.display = data.ok && data.nivel && data.nivel !== 'livre' ? '' : 'none';
  } catch (err) { /* sem internet: segue com o que tem */ }
}

/* =============== INIT =============== */
(function init() {
  aplicarMarca();
  // Endereços salvos por computador nas versões antigas não valem mais
  localStorage.removeItem(SYNC_URL_KEY);
  localStorage.removeItem(chave('base_url'));
  // Carrega cadastros do Sheets ao abrir, pra popular selects logo
  if (window.setTimeout) setTimeout(() => {
    if (typeof ensureCadastros === 'function') {
      ensureCadastros().then(() => {
        atualizarTodosSelectsResponsaveis();
        atualizarTodosSelectsFornecedores();
      });
    }
  }, 500);

  updateSyncBadge();
  iniciarSyncTimer();
  if (getSyncUrl() && loadQueue().length > 0) setTimeout(syncAgora, 500);

  const hash = window.location.hash;
  if (!hash.startsWith('#e=')) { conferirSenhaNaAbertura(); conferirRecursosBackend(); }
  if (hash.startsWith('#e=')) {
    try { activateViewerMode(lerQr('e', hash.substring(3))); return; }
    catch(e) { alert('QR inválido.'); }
  }
  if (hash.startsWith('#i=')) {
    try { activateApontaMode(lerQr('i', hash.substring(3))); return; }
    catch(e) { alert('QR de apontamento inválido.'); }
  }

  loadMateriais();
  loadServicos();
  renderServicos();
  iniciarTempoReal();
})();
