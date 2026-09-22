# Evolution da Weagles

Este fork é a distribuição da Evolution API mantida pela Weagles para os
CRMs e integrações da empresa. Ele parte da Evolution API `2.3.7`, commit-base
`cd800f29` (`cd800f2`), que era a versão usada pela instância da Dra. Karine
quando o problema de contatos foi investigado.

## Por que este fork existe

Durante a sincronização do histórico WhatsApp da Dra. Karine, o CRM recebeu
mensagens associadas a identificadores `@lid`, enquanto parte do diretório
possuía números de telefone. Sem uma ponte confiável entre telefone e LID,
alguns contatos históricos apareciam apenas como `Contato WhatsApp` e não era
possível associá-los com segurança aos contatos e cards existentes no CRM.

A manutenção de uma cópia completa da Evolution permite corrigir esse tipo de
problema no ponto em que ele acontece, manter testes e produzir imagens
reprodutíveis. O CRM continua consumindo a Evolution por API; não há cópia do
código da Evolution dentro do CRM.

## Customizações preservadas

### 1. Endpoint telefone → LID

Commit: `01a9ef0` — `feat(chat): add phone to LID lookup endpoint`

Adiciona o endpoint autenticado:

```http
POST /chat/fetchLid/{instance}
apikey: ...
Content-Type: application/json

{"numbers":["5547999999999"]}
```

O endpoint consulta o `LIDMappingStore` da sessão Baileys ativa e retorna os
pares resolvidos pelo WhatsApp. A operação é somente de leitura para o CRM e
reutiliza a sessão autenticada existente, sem exigir novo QR Code.

### 2. Correção do mapeamento em lotes mistos do Baileys

Arquivo aplicado durante o build:
`Docker/scripts/patch_baileys_lid_mapping.sh`

O Baileys podia retornar `null` quando um lote de números misturava itens já
resolvidos em cache com itens para os quais não havia um novo par retornado
pelo USync. Isso fazia o chamador perder associações que já estavam
disponíveis no cache.

O patch preserva os pares resolvidos (`successfulPairs`) quando não chega um
novo resultado, em vez de descartá-los. O script falha se a estrutura esperada
do arquivo mudar e é idempotente, para evitar builds silenciosamente
inconsistentes.

## Build e versionamento

O Dockerfile aplica o patch do Baileys depois do `npm ci` e antes da compilação.
Uma imagem baseada nesta linha deve receber uma versão própria, por exemplo:

```text
evolution-api:2.3.7-weagles.1
```

Não usar `latest` em produção. Registrar no deploy a tag e, quando possível,
o digest da imagem efetivamente executada.

## Fluxo de manutenção

- `origin`: `Weagles-Consultoria/evolution-api`, fonte usada pela Weagles.
- `upstream`: `evolution-foundation/evolution-api`, mantido para consulta e
  eventual incorporação seletiva de correções.
- Correções devem ser commits pequenos, com teste ou reprodução documentada.
- Não atualizar a base automaticamente: mudanças upstream devem ser revisadas
  por causa do acoplamento com Baileys, banco, webhooks e contratos usados pelos
  CRMs.
- O CRM da Dra. Karine deve apontar para a imagem/instância da Evolution da
  Weagles, e não para uma imagem genérica do upstream.

## Relação com o incidente da Dra. Karine

O diagnóstico operacional completo permanece no CRM, em
`docs/whatsapp-history-sync-2026-09-04.md`. Esse documento registra a
sincronização histórica, os contatos sem nome, a ponte telefone↔LID, a
classificação dos cards e a decisão de criar a customização da Evolution.
