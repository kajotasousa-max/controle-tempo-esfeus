# Planilha de acompanhamento para o cliente

O backend mantém, na planilha principal, uma aba **Cliente <NOME>** para cada cliente listado em
`PAINEL_CLIENTES` (no `Code.gs`). Ela é refeita a cada gravação feita pelo app.

A planilha que o cliente vê (separada, compartilhada só como **leitor**) puxa essa aba com `IMPORTRANGE`:

1. Na planilha do cliente, apague os dados antigos a partir da linha 4.
2. Em **A4**: `=IMPORTRANGE("ID_DA_PLANILHA_PRINCIPAL"; "Cliente COMAU!A1:U")` e clique em **Permitir acesso**.
3. Indicadores da linha 2:
   - B2 (total): `=COUNTA(A5:A)`
   - E2 (em andamento): `=COUNTIFS(A5:A;"<>";G5:G;"<>Finalizado")`
   - H2 (concluídos): `=COUNTIF(G5:G;"Finalizado")`
   - K2 (progresso global): `=IFERROR(AVERAGE(R5:R);0)` com formato de porcentagem

Colunas: A OS · B Item · C Pedido/Projeto · D Descrição · E Qtd · F Prazo · G Status Geral ·
H–Q etapas · R Avanço (%) · S Progresso · T Entrega · U NF.

> Mantenha o cliente como **leitor**. Quem edita a planilha do cliente pode usar o mesmo
> `IMPORTRANGE` para ler outras abas da planilha principal.
