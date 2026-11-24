# Changelog

## [1.5.0] — 2026-11-24

### Novo — Nota fiscal como registro principal
- Aba **📦 Materiais e NF** com três partes: **Notas fiscais**, **Estoque e saldos** e **Retiradas e movimentações**.
- **Cadastro de NF** com número, data, fornecedor, várias OS e vários clientes, e **vários itens**. Cada item tem descrição livre (com sugestões do estoque), unidade, quantidade, valor unitário, frete opcional, total calculado, tipo de movimentação, OS, cliente e data de movimentação próprios. Total do item e total da NF calculados na hora.
- Tipos de item: **Compra para estoque** e **Entrada em estoque** (somam no saldo), **Consumo direto na OS** (compra direcionada à OS, não entra no estoque geral) e **Outros (sem efeito no estoque)** para frete, serviço e despesas. "Outros" com OS entra no custo da OS; sem OS fica só na NF.
- Clicar na NF abre os detalhes para editar cabeçalho, itens, valores, tipo, OS e clientes, incluir ou remover itens, ou excluir a NF. A edição regrava a mesma movimentação de cada item: nada é duplicado, e item removido sai do saldo.
- Material que entra no estoque por NF e ainda não existe é **cadastrado sozinho** (código `MAT-0001`, `MAT-0002`…). Não é preciso cadastrar o material antes.
- **Retirada do estoque para OS sem NF**: escolhe o material do saldo, informa a OS e a quantidade; data automática; origem **SEM NF - MATERIAL DO ESTOQUE** (sem NF fictícia).
- **Saldo nunca negativo**: retirada sem saldo é recusada, e reduzir ou excluir uma NF cujo material já saiu para OS também é recusado (no app e no Apps Script).
- **Estoque** com valor médio, último valor de aquisição e valor total em estoque. **Histórico por material** com entradas, saídas, saldo após cada movimentação, NFs de origem e OS que usaram; exportável em CSV.
- **Materiais da OS** no painel da OS: tudo o que foi comprado para ela ou retirado do estoque, com origem e custo total de material. Botões para lançar NF já vinculada à OS e para retirar do estoque. O campo Material da OS mostra se há saldo em estoque.

### Alterado
- Campo **Responsável** removido da movimentação.
- Trocar o código de um material também atualiza os itens das NFs (antes, salvar de novo uma NF antiga recriava o código velho).
- Material cujas movimentações são todas de NFs excluídas pode ser apagado de verdade.
- Lançamentos de compra antigos continuam no saldo e no histórico; a NF que estava na observação aparece como origem ("NF 1234 (lançamento anterior)").
- A aba `Movimentacoes` da planilha ganha colunas no fim (id, cliente, valores, NF, origem…) sem mexer nas existentes. Custo, fornecedor e NF deixam de se perder ao recarregar.
- Apps Script 1.5.0: abas `NotasFiscais` e `ItensNF`, ações `list-nfs`, `nf` e `excluir-nf`; a aba **Saldos** ganha valor médio e último valor. **É preciso atualizar o Apps Script** para lançar NFs; até lá o app avisa e o resto continua funcionando.

## [1.4.1] — 2026-11-24

### Correções (Materiais / Estoque)
- **Material duplicado que não saía da lista**: quando a aba `Materiais` tinha duas linhas com o mesmo código, o app mostrava as duas e só conseguia alterar a primeira. Agora o app mostra uma só, e qualquer gravação ou exclusão desse código deixa uma única linha na planilha.
- **Trocar o código de um material** atualiza a linha existente (antes criava outra linha e a antiga ficava) e leva as movimentações para o código novo.
- **Botão ✕**: material sem movimentações é apagado de verdade, também da planilha (antes era marcado como inativo e voltava na próxima atualização). Material com movimentações pede confirmação para **inativar**, explicando o porquê.

### Alterado
- A lista do estoque mostra só materiais ativos. Os inativos ficam no filtro **Inativos (arquivados)**, com o botão **Reativar**; o filtro **Todos, inclusive inativos** mostra tudo.
- Apps Script 1.4.1: nova ação `excluir-material`. O app continua funcionando com o Apps Script antigo, mas a exclusão real e a limpeza de duplicados só valem depois de atualizar o Apps Script.

## [1.4.0] — 2026-11-17

### Alterado
- Tela do operador (QR interno) sem controle de tempo: sem Iniciar, Pausar e cronômetro. O operador preenche os dados e toca em **Pronta para próxima etapa**. O registro vai para os Apontamentos, para uso interno, e não altera a OS: as etapas continuam sendo atualizadas pelo escritório.
- Removida a etiqueta completa do produto (botão "Etq" e impressão em lote).
- Botão para remover a imagem da peça.

## [1.3.0] — 2026-11-11

### Novo
- QR impresso com 20 x 20 mm e link curto: o QR do cliente leva só um código (a ficha vem da planilha pela ação pública `etiqueta`); o QR interno leva só OS, item e etapas (a planilha completa cliente/OC/descrição no apontamento). QRs antigos continuam valendo.
- Etiqueta avulsa de QR em cartão horizontal 88 x 30 mm.

## [1.2.0] — 2026-11-11

### Novo
- **Fluxo automático da OS**: etapas com status OK e N.A. (ambos contam como concluídos); a aba Qualidade só libera a inspeção com todas as etapas de produção OK/N.A.; a etapa "Inspeção Final" é preenchida pela Qualidade (aprovado = OK, reprovado ou sem inspeção = Pendente); a OS só fica Finalizada com a inspeção aprovada; o status da OS é calculado pelo andamento das etapas.
- Etapas padrão: Terceirização de Usinagem antes de Caldeiraria; Expedição removida.
- Aba **Finalizadas** no app e na planilha (consulta, refeita a cada gravação).
- OS e item em colunas separadas na lista de Serviços, Apontamentos, Análise por OS e Qualidade, e nas abas da planilha (Apontamentos, Checklists, Análise por OS). As abas existentes são convertidas sozinhas no primeiro uso do backend 1.2.
- Quantidade de OS por status, com filtro por clique, e filtro por cliente.
- Percentual por etapa em andamento/parada, refletido no progresso da OS.
- OS novas nascem com as etapas de `etapasPadrao` (config.js).

### Correções
- Campos de URL removidos do topo (endereços só pelo config.js).
- QR com nível H falhava em alguns comprimentos de link.
- Status "Externo com terceiros" era trocado automaticamente.

## [1.1.0] — 2026-11-11

### Novo
- **Senha de acesso** ao Apps Script, definida pelo menu **Gestão de Serviços** da planilha: escritório (tudo) e operador (só apontamentos). Cada aparelho digita uma vez; botão **🔒 Sair** no topo.
- **OS centralizadas na planilha** (aba `Servicos`): qualquer computador vê e edita as mesmas OS. As OS que já estavam no navegador sobem para a planilha na primeira abertura.
- **Atualização automática a cada 20 s** com a página aberta: OS, apontamentos, análise, qualidade e materiais. Também atualiza ao voltar para a aba do navegador.
- Funciona offline: alterações de OS ficam pendentes (contadas no badge) e sobem quando a conexão volta.
- Imagem da peça é reduzida e salva no Drive; a planilha guarda o link.
- Abas **Saldos** e **Análise por OS** refeitas pelo backend a cada gravação.
- `configurar` converte as abas do backend antigo (cabeçalhos em português) para o formato atual, guardando as originais como `antigo - …`.

### Correções
- **Análise por OS** não reconhecia "Etapa concluída" (o botão usado no celular) como conclusão.
- Campos de serviço externo (fornecedor, envio, retorno) não eram salvos.
- IDs de OS únicos entre computadores.

## [1.0.0] — 2026-11-11

Primeira versão como produto, a partir do arquivo único em produção na ESFEUS.

### Estrutura
- `index.html` monolítico (366 KB) dividido em HTML, CSS, JS, configuração e imagens.
- Dados de cada cliente isolados em `config.js` (nome, razão social, logos, URLs, máquinas, operações, operadores, checklist e prefixo do armazenamento local).
- Imagens em base64 extraídas para `assets/marca/`.
- Biblioteca de QR code servida localmente (`vendor/`), sem depender de CDN.
- Backend Apps Script de referência (`backend/Code.gs`) e documentação do contrato (`docs/API.md`).

### Correções
- Abas **Qualidade** e **Cadastros** estavam fora do contêiner principal do app.
- **Análise por OS** voltou a considerar os apontamentos da planilha, e não só os do próprio navegador.
- Removidas 15 funções duplicadas (versões antigas sobrescritas pelas novas).
- Estilos ausentes de `.mat-panel`, `.mat-badge`, `.mat-empty` e `.buttons`.
- "Limpar histórico" de apontamentos também limpa o cache vindo da planilha.
- Aviso desatualizado "Fase 1: apontamentos só no navegador" substituído.

### Compatibilidade
- Prefixo `esfeus` mantido no `config.js` da ESFEUS: dados já gravados nos navegadores continuam aparecendo.
- Formato dos QR codes inalterado: etiquetas já impressas continuam funcionando.
