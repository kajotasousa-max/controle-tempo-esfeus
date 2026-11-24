# Contrato da API (Apps Script Web App)

O front-end conversa com um único endpoint (`syncUrlPadrao`). Todas as respostas são JSON com `ok: true|false` e, em erro, `erro: "mensagem"`.

OS e item vêm em campos separados (`os: "CO 26.002"`, `item: "75"`). O backend também aceita o formato antigo `os: "CO 26.002/75"` e separa sozinho.

Toda chamada leva a senha no parâmetro `k` da URL (GET e POST). Sem senha válida: `{ ok: false, semAcesso: true }`. Com a senha de operador fora do permitido (`versao`, `list-responsaveis` e o POST de apontamentos): `{ ok: false, semPermissao: true }`. Se nenhuma senha foi definida, tudo é aceito.

Os POSTs usam `Content-Type: text/plain;charset=utf-8` para evitar o preflight CORS, que o Apps Script não suporta. O corpo é JSON.

## Leituras (GET)

| `?action=` | Resposta |
|---|---|
| `list` | `{ ok, apontamentos: Apontamento[] }` |
| `list-servicos` | `{ ok, servicos: Servico[], agora }` — inclui as excluídas com `excluido: true` |
| `versao` | `{ ok, versao, servicos: true }` |
| `list-materiais` | `{ ok, materiais: Material[] }` |
| `list-movimentacoes` | `{ ok, movimentacoes: Movimentacao[] }` — sem as excluídas |
| `list-nfs` | `{ ok, nfs: NotaFiscal[] }` — cada NF com seus `itens` (sem as excluídas) |
| `list-checklists` | `{ ok, checklists: Checklist[] }` |
| `list-responsaveis` | `{ ok, responsaveis: Responsavel[] }` |
| `list-fornecedores` | `{ ok, fornecedores: Fornecedor[] }` |

## Gravações (POST)

| Corpo | Efeito |
|---|---|
| `{ kind: "servicos", itens: [{ acao: "salvar"\|"excluir", servico }] }` | Cria/atualiza pelo `id` ou marca como excluída. Imagem em data URL vai para o Drive. Responde `{ ok, servicos: Servico[] }` como ficaram na planilha |
| `Apontamento[]` (array) | Acrescenta os apontamentos da fila. Duplicados (`timestamp+os+operador+status`) são ignorados. |
| `{ kind: "material", ... }` | Cria ou atualiza pelo `codigo` |
| `{ kind: "movimentacao", ... }` | Acrescenta (sem NF). Saída sem saldo é recusada. Reenviar com o mesmo `id` não duplica. Retirada para OS ganha origem `SEM NF - MATERIAL DO ESTOQUE` |
| `{ kind: "nf", nf: NotaFiscal, itens: ItemNF[] }` | Cria/atualiza a NF inteira pelo `id` e regrava uma movimentação por item (pelo id do item). Itens que saíram da NF e suas movimentações ficam marcados como excluídos. Cria o material que ainda não existe (`MAT-0001`…). `nf.os`/`nf.clientes` guardam só os vínculos diretos da NF; os de cada item ficam no item (o app mostra a soma). Item "Outros" só gera movimentação se tiver OS. Recusa se algum saldo ficar negativo, sem gravar nada. Responde `{ ok, nf, materiaisCriados }` |
| `{ kind: "excluir-nf", id }` | Marca NF, itens e movimentações como excluídos, se o saldo permitir |
| `{ kind: "checklist", ... }` | Acrescenta; fotos em data URL vão para o Drive e viram links |
| `{ kind: "responsavel", ... }` | Cria ou atualiza pelo `nome` |
| `{ kind: "fornecedor", ... }` | Cria ou atualiza pelo `nome` |

## Tipos

Datas e horas são texto no formato `yyyy-MM-dd HH:mm:ss`.

```ts
Servico      { id: number, os, it, cliente, oc, des, desc, qty, material, tratamento, emb, prazo /* yyyy-MM-dd */,
               status, nf, dt, etapas: Etapa[], imagem /* URL */, atualizadoEm, excluido: boolean, ...outros campos }
               // campos fora da lista acima são guardados na coluna "extras" (JSON)
Etapa        { id, nome, operacao, maquina, operador, status }
Apontamento  { timestamp, os, item, etapa, cliente, oc, descricao, operacao, maquina, operador,
               status: 'Iniciando'|'Parado'|'Etapa concluída'|'Concluído Parcial'|'Finalizado', qtd }
Material     { codigo, descricao, especificacao, unidade, estoqueMinimo: number, localizacao, ativo: boolean }
Movimentacao { timestamp, codigo, tipo, quantidade: number, os, loteDimensao /* "lote | dimensão" */, observacao, operador,
               id, cliente, valorUnitario, valorTotal, nf /* número */, nfId, itemNfId, origem, fornecedor }
               // entradas: Compra | Compra para estoque | Entrada em estoque | Sobra | Devolução | Ajuste de entrada
               // saídas:   Retirada do estoque para OS | Consumo na OS (antigo) | Perda / descarte | Ajuste de saída
               // sem efeito no saldo: Compra direta para OS | Outros (sem efeito no estoque)
NotaFiscal   { id, numero, data /* yyyy-MM-dd */, fornecedor, os: string[], clientes: string[], observacao, itens: ItemNF[] }
ItemNF       { id, nfId, descricao, codigo /* material do estoque */, unidade, quantidade, valorUnitario, frete, valorTotal,
               os /* "OS/item" */, cliente, tipo, dataMovimentacao, observacao }
               // tipo: Compra para estoque | Entrada em estoque | Consumo direto na OS | Outros (sem efeito no estoque)
Checklist    { timestamp, os, item, cliente, codigoPeca, qtd, revisaoDesenho, inspetor,
               situacao: 'Aprovado'|'Reprovado'|'Rascunho', observacao, motivoNf,
               fotos: string[] /* URLs (resposta) ou data URLs (envio) */,
               marcacoes: { [chaveDoItem]: 'OK'|'NOK'|'NA' } }
Responsavel  { nome, funcao, ativo: boolean }
Fornecedor   { nome, tipo, cnpj, contato, observacao, ativo: boolean }
```

## QR codes

Os dados vão no próprio link, em JSON → UTF-8 → Base64, depois do `#`:

- `#e=` — visualizador do cliente: `{ cliente, os, qty, desc, des, material, tratamento, emb, oc, it, nf, dt, status }`
- `#i=` — apontamento: `{ os, it, cliente, desc, oc, etapas: [{ nome, operacao, maquina, operador, status }] }`

Como nada passa pelo servidor, o QR continua válido mesmo sem internet. Por outro lado, o status mostrado ao cliente é o do momento da impressão.
