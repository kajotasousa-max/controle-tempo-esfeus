# Gestão de Serviços para Ferramentaria

Sistema web para ferramentarias e usinagens de pequeno porte controlarem as ordens de serviço do pedido à expedição: cadastro de OS com etapas, etiquetas com QR code, apontamento de tempo no chão de fábrica pelo celular, estoque de materiais, checklist de qualidade com fotos e análise de tempo por OS.

Roda em qualquer navegador, sem instalação e sem servidor próprio: o front-end é estático (GitHub Pages ou qualquer hospedagem) e os dados são centralizados numa planilha Google via Apps Script.

## Módulos

| Aba | O que faz |
|---|---|
| 📋 **Serviços** | Cadastro de OS (cliente, OC, desenho, material, prazo, NF), etapas do processo, status automático por prazo (Em processo › Alerta ≤ 7 dias › Atrasado), impressão de etiquetas |
| 📦 **Materiais** | Cadastro de materiais, movimentações (compra, consumo na OS, sobra, perda, ajustes), saldo calculado, alerta de estoque mínimo, exportação CSV |
| ⏱️ **Apontamentos** | Histórico de eventos de produção (iniciar, pausar, concluir etapa) vindos dos celulares |
| 📊 **Análise por OS** | Tempo efetivo por OS/etapa/operador e situação frente ao prazo |
| ✅ **Qualidade** | Checklist de inspeção final configurável, até 6 fotos por OS, aprovação libera a OS |
| ⚙️ **Cadastros** | Responsáveis (operadores, inspetores…) e fornecedores |

### Três modos de uso na mesma página

- **Escritório** — `index.html`: todas as abas acima.
- **Chão de fábrica** — QR **interno** (`#i=…`): o operador escaneia, escolhe operação/máquina/nome e toca *Iniciar / Pausar / Pronta para próxima etapa*. Cronômetro na tela; funciona offline e reenvia quando voltar a conexão.
- **Cliente** — QR **externo** (`#e=…`): etiqueta digital com os dados do produto e o status da OS.

### Etiquetas impressas

- **Interna** (chão de fábrica): logo + OS em destaque + QR de apontamento — 2 por linha em A4.
- **Completa**: tabela com todos os dados, QR do cliente e assinatura — 1 por página.
- **QR avulso** externo ou interno.

## Estrutura

```
index.html              página única (escritório, apontamento e visualizador)
config.js               ← dados do cliente: nome, logos, URLs, máquinas, checklist
config.example.js       modelo comentado para novos clientes
css/styles.css
js/app.js               lógica da aplicação
assets/marca/           logo, logo do QR, logo da etiqueta, assinatura
vendor/qrcodejs/        gerador de QR (MIT), local para funcionar sem CDN
backend/Code.gs         Apps Script de referência (Google Sheets + Drive)
docs/                   instalação e contrato da API
```

## Implantar para um novo cliente

Resumo (passo a passo em [docs/INSTALACAO.md](docs/INSTALACAO.md)):

1. Copie `config.example.js` para `config.js` e preencha nome, máquinas, operações e checklist.
2. Troque as imagens em `assets/marca/` mantendo os nomes.
3. Crie uma planilha Google, cole `backend/Code.gs`, publique como Web App e coloque a URL em `syncUrlPadrao`.
4. Publique a pasta no GitHub Pages e coloque a URL em `urlVisualizadorPadrao` (é para onde os QR codes apontam).

## Rodar localmente

Qualquer servidor estático serve:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Onde ficam os dados

- **Serviços (OS)** e **materiais**: no navegador do escritório (`localStorage`), com materiais e movimentações também enviados à planilha.
- **Apontamentos, checklists, responsáveis e fornecedores**: na planilha Google (fonte da verdade). Os apontamentos ficam numa fila local até a planilha confirmar o recebimento.

> As OS ficam no navegador onde foram cadastradas. Use sempre o mesmo computador no escritório e não limpe os dados do navegador. Centralizar as OS na planilha é o próximo item do roadmap.

## Roadmap

- [ ] OS centralizadas na planilha (vários computadores no escritório)
- [ ] Login simples por perfil (escritório / operador / qualidade)
- [ ] Painel Looker Studio a partir da planilha
- [ ] Modo offline completo (service worker)

## Licença

Software proprietário — veja [LICENSE](LICENSE). A biblioteca em `vendor/qrcodejs` é MIT.
