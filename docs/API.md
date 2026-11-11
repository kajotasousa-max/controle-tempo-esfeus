# Contrato da API (Apps Script Web App)

O front-end conversa com um único endpoint (`syncUrlPadrao`). Todas as respostas são JSON com `ok: true|false` e, em erro, `erro: "mensagem"`.

Os POSTs usam `Content-Type: text/plain;charset=utf-8` para evitar o preflight CORS, que o Apps Script não suporta. O corpo é JSON.

## Leituras (GET)

| `?action=` | Resposta |
|---|---|
| `list` | `{ ok, apontamentos: Apontamento[] }` |
| `list-materiais` | `{ ok, materiais: Material[] }` |
| `list-movimentacoes` | `{ ok, movimentacoes: Movimentacao[] }` |
| `list-checklists` | `{ ok, checklists: Checklist[] }` |
| `list-responsaveis` | `{ ok, responsaveis: Responsavel[] }` |
| `list-fornecedores` | `{ ok, fornecedores: Fornecedor[] }` |

## Gravações (POST)

| Corpo | Efeito |
|---|---|
| `Apontamento[]` (array) | Acrescenta os apontamentos da fila. Duplicados (`timestamp+os+operador+status`) são ignorados. |
| `{ kind: "material", ... }` | Cria ou atualiza pelo `codigo` |
| `{ kind: "movimentacao", ... }` | Acrescenta |
| `{ kind: "checklist", ... }` | Acrescenta; fotos em data URL vão para o Drive e viram links |
| `{ kind: "responsavel", ... }` | Cria ou atualiza pelo `nome` |
| `{ kind: "fornecedor", ... }` | Cria ou atualiza pelo `nome` |

## Tipos

Datas e horas são texto no formato `yyyy-MM-dd HH:mm:ss`.

```ts
Apontamento  { timestamp, os, etapa, cliente, oc, descricao, operacao, maquina, operador,
               status: 'Iniciando'|'Parado'|'Etapa concluída'|'Concluído Parcial'|'Finalizado', qtd }
Material     { codigo, descricao, especificacao, unidade, estoqueMinimo: number, localizacao, ativo: boolean }
Movimentacao { timestamp, codigo, tipo, quantidade: number, os, loteDimensao /* "lote | dimensão" */, observacao, operador }
               // tipo: Compra | Consumo na OS | Sobra | Devolução | Perda / descarte | Ajuste de entrada | Ajuste de saída
Checklist    { timestamp, os, cliente, codigoPeca, qtd, revisaoDesenho, inspetor,
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
