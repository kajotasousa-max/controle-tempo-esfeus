# Changelog

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
