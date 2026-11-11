/* ============================================================
   CONFIGURAÇÃO DO CLIENTE — ESFEUS Ferramentaria (implantação atual)
   Modelo comentado para novos clientes: config.example.js
   ============================================================ */
window.APP_CONFIG = {
  empresa: {
    nome: 'ESFEUS Ferramentaria',
    nomeCurto: 'ESFEUS',
    nomeTopo: 'ESFEUS FERRAMENTARIA',
    razaoSocial: 'Esfeus Indústria e Comércio LTDA',
    rodapeEtiqueta: 'Etiqueta digital ESFEUS Ferramentaria · compromisso com precisão'
  },

  /* Imagens em assets/marca/ (troque os arquivos mantendo os nomes, ou aponte outros caminhos) */
  marca: {
    logo: 'assets/marca/logo.jpg',                       // logo redondo (etiqueta do cliente e apontamento)
    logoMini: 'assets/marca/logo-mini.jpg',              // centro do QR externo
    logoEtiquetaInterna: 'assets/marca/logo-etiqueta.png', // topo da etiqueta de chão de fábrica
    assinatura: 'assets/marca/assinatura.png'            // assinatura na etiqueta completa
  },

  /* Prefixo das chaves no localStorage. NÃO mude depois que o cliente começar a usar,
     senão os dados gravados no navegador deixam de aparecer. */
  storagePrefix: 'esfeus',

  /* URL pública onde o index.html está publicado (GitHub Pages, por exemplo).
     Os QR codes apontam para cá. Vazio = usa o endereço da própria página. */
  urlVisualizadorPadrao: 'https://kajotasousa-max.github.io/controle-tempo-esfeus/',

  /* URL do Web App do Google Apps Script (backend/Code.gs). Vazio = funciona só local. */
  syncUrlPadrao: 'https://script.google.com/macros/s/AKfycbwkg4X6qWDF04pEqGfr0SyT3WfrNyoN_dr8oWUc89erGexKEHDPysmujXGS4IxxPRLx/exec',

  /* Listas usadas no apontamento e nas etapas da OS */
  operacoes: ['Torneamento', 'Fresamento', 'Furação', 'Retífica', 'Acabamento', 'Processo externo', 'Inspeção Final'],
  maquinas: ['Torno Pequeno', 'Torno Clever', 'Romi', 'Wotan', 'Dyna', 'Sinitron', 'Mandrilhadora Wotan', 'Furadeira Radial', 'Fresadora Zocca', 'Retifica', 'Prensa', 'Qualidade Final'],
  /* Usada como lista de responsáveis das etapas. Os operadores do apontamento vêm da aba Cadastros. */
  operadoresPadrao: ['Adriano', 'Diogo', 'André', 'Antonio', 'Gabriel', 'Breno', 'Pablo', 'Matheus', 'Raimundo', 'Januario', 'Geraldo'],

  /* Checklist de qualidade. na: true = permite "Não se aplica".
     preview (opcional) mostra o valor da OS ao lado do item. */
  checklist: [
    { section: '1. Conferência da ordem de serviço', color: '#006699', items: [
      { key: 'conf_os', label: 'Número da Ordem de Serviço', preview: s => (s.os || '') + (s.it ? '/' + s.it : ''), na: false },
      { key: 'conf_cliente', label: 'Nome do cliente', preview: s => s.cliente || '', na: false },
      { key: 'conf_codigo', label: 'Código da peça (Nº do desenho)', preview: s => s.des || '', na: false },
      { key: 'conf_qtd', label: 'Quantidade produzida', preview: s => s.qty || '', na: false },
      { key: 'conf_revisao', label: 'Revisão de desenho conferida', na: false }
    ]},
    { section: '2. Inspeção Dimensional', color: '#0891b2', items: [
      { key: 'dim_medidas', label: 'Todas as medidas conferidas', na: false },
      { key: 'dim_tolerancias', label: 'Tolerâncias atendidas', na: false },
      { key: 'dim_roscas', label: 'Roscas, furos e rasgos conferidos', na: false }
    ]},
    { section: '3. Inspeção Visual', color: '#7c3aed', items: [
      { key: 'vis_rebarbas', label: 'Sem rebarbas', na: false },
      { key: 'vis_trincas', label: 'Sem trincas', na: false },
      { key: 'vis_acabamento', label: 'Acabamento conforme solicitado', na: false },
      { key: 'vis_soldas', label: 'Soldas aprovadas', na: true },
      { key: 'vis_pintura', label: 'Pintura / tratamento superficial conforme', na: true }
    ]},
    { section: '4. Limpeza da peça', color: '#059669', items: [
      { key: 'limp_cavacos', label: 'Cavacos removidos', na: false },
      { key: 'limp_oleo', label: 'Óleo excessivo removido', na: false },
      { key: 'limp_pecalimpa', label: 'Peça limpa e seca', na: false },
      { key: 'limp_anticorrosivo', label: 'Proteção anticorrosiva aplicada', na: true }
    ]},
    { section: '5. Documentação', color: '#dc2626', items: [
      { key: 'doc_relatorio', label: 'Relatório dimensional', na: true },
      { key: 'doc_cert_material', label: 'Certificados de material anexados', na: true },
      { key: 'doc_cert_tratamento', label: 'Certificados de tratamento térmico/superficial', na: true },
      { key: 'doc_nf', label: 'Nota fiscal conferida', na: false }
    ]},
    { section: '6. Embalagem', color: '#ea580c', items: [
      { key: 'emb_protegida', label: 'Peça protegida contra impactos', na: false },
      { key: 'emb_identificacao', label: 'Identificação da peça e quantidade conferida', na: false },
      { key: 'emb_caixa', label: 'Caixa ou pallet adequado', na: false }
    ]},
    { section: '7. Liberação Final', color: '#16a34a', items: [
      { key: 'lib_conferencia', label: 'Conferência final realizada', na: false },
      { key: 'lib_aprovado', label: 'Peça aprovada para envio', na: false },
      { key: 'lib_foto', label: 'Foto da peça conferida', na: false }
    ]}
  ]
};
