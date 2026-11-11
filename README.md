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

Tudo fica na planilha Google, que é a fonte da verdade: **OS (aba Servicos)**, apontamentos, materiais, movimentações, checklists, responsáveis e fornecedores. As abas **Saldos** e **Análise por OS** são refeitas pela planilha a cada gravação.

Qualquer computador ou celular com o link vê os mesmos dados. O app busca as novidades a cada 20 segundos enquanto a página está aberta. O navegador guarda uma cópia para funcionar sem internet: o que for feito offline fica pendente (badge no canto) e sobe quando a conexão volta.

Se duas pessoas editarem a mesma OS ao mesmo tempo, vale a última gravação.

## Segurança

O Apps Script roda com a conta do dono da planilha e responde a quem tiver a URL, que fica visível no `config.js`. Por isso o acesso é protegido por senha, definida no menu **Gestão de Serviços** da planilha:

- **Escritório**: acesso a tudo.
- **Operador**: só registra apontamentos e lê a lista de responsáveis.

A senha não fica no código: o Apps Script guarda só o hash (SHA-256 com sal). Cada aparelho digita a senha uma vez; o botão **🔒 Sair** esquece a senha e a cópia local dos dados. A etiqueta do cliente (QR externo) não passa pela planilha e continua abrindo sem senha.

## Roadmap

- [x] OS centralizadas na planilha (vários computadores no escritório)
- [ ] Login simples por perfil (escritório / operador / qualidade)
- [ ] Painel Looker Studio a partir da planilha
- [ ] Modo offline completo (service worker)

## Licença

Software proprietário — veja [LICENSE](LICENSE). A biblioteca em `vendor/qrcodejs` é MIT.
