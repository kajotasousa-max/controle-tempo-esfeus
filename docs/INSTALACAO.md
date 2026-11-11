# Instalação para um novo cliente

Tempo estimado: 30–40 minutos. Precisa de uma conta Google (do cliente, de preferência) e de uma conta GitHub.

## 1. Planilha e backend (Google Apps Script)

1. Crie uma planilha Google em branco, por exemplo **"Gestão de Serviços — NOME DO CLIENTE"**.
2. Menu **Extensões › Apps Script**.
3. Apague o conteúdo de `Código.gs` e cole todo o `backend/Code.gs`.
4. Em **Configurações do projeto** (engrenagem), marque *Mostrar arquivo de manifesto "appsscript.json"* e cole o conteúdo de `backend/appsscript.json`.
5. No editor, selecione a função **`configurar`** e clique em **Executar**. Autorize o acesso (planilha e Drive). Isso cria as abas e a pasta de fotos. Se a planilha tiver abas do backend antigo (cabeçalhos em português, como "Carimbo"), elas são renomeadas para `antigo - …` e os dados são copiados para as abas novas.
6. **Implantar › Nova implantação › Tipo: App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
7. Copie a URL que termina em `/exec`.

> Ao alterar o `Code.gs` depois, cole a versão nova, rode **`configurar`** de novo e use **Implantar › Gerenciar implantações › Editar › Nova versão** para manter a mesma URL.

## 2. Configurar o front-end

1. Copie `config.example.js` para `config.js`.
2. Preencha:
   - `empresa` — nomes que aparecem na tela e nas etiquetas.
   - `storagePrefix` — um identificador curto e fixo do cliente (ex.: `metalurgicax`). Não mude depois.
   - `syncUrlPadrao` — a URL `/exec` do passo 1.
   - `maquinas`, `operacoes`, `operadoresPadrao` — conforme a fábrica.
   - `checklist` — itens da inspeção final (pode remover/adicionar seções).
3. Troque as imagens em `assets/marca/` (mesmos nomes):

| Arquivo | Uso | Tamanho sugerido |
|---|---|---|
| `logo.jpg` | logo redondo do visualizador e do apontamento | 400×400 |
| `logo-mini.jpg` | centro do QR externo | 120×120 |
| `logo-etiqueta.png` | topo da etiqueta interna (fundo branco) | 400×150 |
| `assinatura.png` | assinatura da etiqueta completa (fundo transparente) | 165×44 |

## 3. Publicar (GitHub Pages)

1. Crie um repositório para o cliente e envie a pasta.
2. **Settings › Pages › Deploy from a branch › `main` / `(root)`**.
3. Aguarde a URL (`https://USUARIO.github.io/REPOSITORIO/`) e coloque em `urlVisualizadorPadrao` no `config.js`. Faça o commit.

> Os QR codes guardam a URL completa. Se a URL mudar depois, as etiquetas já impressas param de funcionar — defina a URL definitiva antes de imprimir.

## 4. Primeiro uso

1. Abra a URL no computador do escritório.
2. Aba **Cadastros**: cadastre operadores (função *Operador*) e inspetores (função *Inspetor*), e fornecedores.
3. Aba **Materiais**: cadastre os materiais principais.
4. Aba **Serviços**: crie uma OS de teste, adicione etapas e imprima a **etiqueta interna**.
5. No celular, escaneie o QR, escolha operação/máquina/operador e toque **Iniciar**. Confira na aba **Apontamentos** (botão 🔄 Atualizar) e na planilha.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Badge "pendente" não zera | URL do Apps Script errada ou implantação não está como "Qualquer pessoa" |
| Lista de operadores vazia no celular | Nenhum responsável com função contendo "Operador" em Cadastros |
| QR abre página em branco | `urlVisualizadorPadrao` não aponta para onde o site está publicado |
| OS de outro computador não aparecem | Backend antigo (sem a aba Servicos): cole o `Code.gs` atual, rode `configurar` e publique uma nova versão |
