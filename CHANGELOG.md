# Changelog

## [1.2.0] — 2026-11-11

### Novo
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
