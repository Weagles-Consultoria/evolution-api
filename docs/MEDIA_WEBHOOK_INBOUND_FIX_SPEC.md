# Spec: entrega de mídia recebida no webhook

## Objetivo

Corrigir a perda de imagens, áudios e demais mídias enviadas pelo celular
conectado à Evolution, garantindo que o evento `MESSAGES_UPSERT` chegue ao
webhook com a mídia acessível pelo `mediaUrl` do S3.

Esta spec é um prompt de implementação para o próximo agente. Não alterar as
customizações LID da Weagles nem fazer deploy de produção neste trabalho.

## Contexto confirmado

- Fork: `Weagles-Consultoria/evolution-api`.
- Branch: `weagles/v2.3.7-lid`.
- Base: Evolution API `2.3.7`, commit `cd800f2`.
- Baileys: `7.0.0-rc.9`.
- Produção usa upload direto para S3; `WEBHOOK_BASE64` não é o mecanismo de
  entrega esperado e não deve ser requisito da solução.
- O problema ocorre com imagens comuns enviadas pelo celular, além de imagens
  de visualização única. Validar também áudio, vídeo, documento e sticker.
- Envio de mídia pela API normalmente funciona; mídia recebida/enviada pelo
  aparelho conectado pode não chegar ao webhook.
- Issue relacionada: [evolution-foundation/evolution-api#2396](https://github.com/evolution-foundation/evolution-api/issues/2396).

## Diagnóstico

O fluxo está em
`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`.

1. O handler identifica a mensagem como mídia e, com S3 habilitado, tenta
   baixar o conteúdo usando `getBase64FromMediaMessage` para obter um buffer.
2. O método percorre `MessageSubtype` e pode deixar somente
   `messageContextInfo`, retornando `null`.
3. O chamador trata `!media` com `return` dentro de `messages.upsert`, antes de
   `sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw)`.
4. Assim, uma falha/ausência no processamento opcional do S3 interrompe a
   entrega do evento. O webhook não pode depender do resultado do armazenamento.

Pontos atuais para revisar: linhas aproximadas 1387–1441 e 1444–1483. O mesmo
padrão deve ser auditado no caminho de envio pela API (`SEND_MESSAGE`).

## Requisitos da correção

- Separar claramente as etapas: normalizar mensagem, baixar mídia, fazer
  upload S3, montar `mediaUrl` e emitir webhook.
- Nunca usar `return` ou `continue` no handler para abandonar a mensagem por
  causa de falha, ausência ou configuração de upload S3.
- Quando o download funcionar, fazer upload do buffer ao S3 e incluir o
  `mediaUrl` no payload antes de emitir `MESSAGES_UPSERT`.
- Quando o download falhar ou o conteúdo estiver incompleto, ainda emitir o
  webhook da mensagem, preservando `key`, `messageType` e identificador. Logar
  a falha sem derrubar o processamento das mensagens seguintes.
- Não adicionar dependência de Base64 no webhook de produção. Base64 pode
  continuar sendo uma opção independente para instâncias que explicitamente a
  habilitem.
- Não remover nem alterar o endpoint `POST /chat/fetchLid/{instance}`.
- Não remover nem sobrescrever o patch de mapeamento telefone↔LID aplicado no
  build Docker.
- Evitar mutar destrutivamente o objeto original recebido pelo Baileys durante
  o unwrap; se necessário, trabalhar em uma cópia e preservar metadados que
  permitam novo download.
- Garantir que erro de S3 não impeça o webhook, mas manter logs suficientes
  para diagnosticar instance, message id, tipo de mídia e etapa que falhou,
  sem registrar conteúdo sensível ou Base64 completo.

## Reprodução obrigatória antes da implementação final

Usar uma instância de teste ou fixture equivalente e validar, com
`S3_ENABLED=true`, `DATABASE_SAVE_DATA_NEW_MESSAGE=true` e Base64 desativado:

- imagem normal enviada pelo celular;
- imagem de visualização única;
- áudio enviado pelo celular;
- vídeo, documento e sticker;
- lote misto com texto e mídias;
- falha simulada no upload S3;
- falha/ausência simulada no download da mídia.

Para cada caso verificar webhook, `mediaUrl`, objeto no S3, persistência e
continuidade do lote. Comparar também mídia enviada pela API.

## Testes e critérios de aceite

- Adicionar teste de regressão automatizado se houver harness disponível; caso
  contrário, adicionar fixture/reprodução documentada sem criar dependência
  externa obrigatória.
- O evento `MESSAGES_UPSERT` deve ser emitido exatamente uma vez por mensagem
  válida, mesmo quando o upload S3 falhar ou for pulado.
- Com download e S3 funcionando, o webhook deve conter `data.message.mediaUrl`
  acessível e o arquivo deve ser recuperável.
- Uma mídia do celular não pode desaparecer apenas por ser `fromMe`, usar LID,
  ser embrulhada ou conter `messageContextInfo`.
- Texto e as customizações telefone↔LID devem continuar funcionando.
- Executar lint, typecheck/build e os testes disponíveis. Confirmar `git diff`
  para garantir que somente a correção, testes e documentação relacionada
  foram alterados.

## Implementação realizada

Implementação presente nesta branch:

- `whatsapp.baileys.service.ts`: upload S3 desacoplado da emissão do webhook
  nos fluxos inbound e `SEND_MESSAGE`; `mediaUrl` é incluído antes do evento.
- `media-message.utils.ts`: unwrap não destrutivo de mídias embrulhadas e
  helper de upload opcional.
- O caminho S3 usa o buffer baixado diretamente. `getBase64FromMediaMessage`
  foi mantido apenas por compatibilidade/API e por instâncias que habilitem
  Base64; ele não é requisito do upload S3.
- Falhas de download/upload S3 e persistência posterior da mídia são tratadas
  sem impedir o webhook. As customizações LID permaneceram intactas.
- Foram adicionados testes em `tests/media-webhook-inbound-fix.test.ts` e o
  script `npm run test:media`.
## Validação executada

### Automatizada — aprovada

- `npm run test:media`: 5 testes passando.
- `npm run lint:check`, `npx tsc --noEmit`, `npm run build` e `git diff --check`:
  aprovados.
- O build Docker aplicou o patch Baileys de mapeamento telefone↔LID.

### Ambiente real local — aprovada

Foi criado um ambiente isolado com Evolution, PostgreSQL, Redis, MinIO e
receptor de webhook. A instância usou S3 direto e Base64 desativado.

- Celular conectado enviando: texto, imagem, áudio, documento e vídeo.
- Outro número enviando ao celular conectado: texto, imagem, áudio, documento
  e vídeo (`fromMe: false`).
- Também foi validado sticker nos dois sentidos, enviado pelo celular conectado
  e recebido de outro número (`fromMe: false`).
- Todos os eventos chegaram como `messages.upsert`.
- Todas as mídias chegaram com `mediaUrl`, sem Base64, foram persistidas no
  banco e retornaram HTTP 200 no MinIO.
- O mapeamento LID apareceu nos eventos e nos caminhos de armazenamento.
### Não aprovado ou ainda pendente

- Foto de visualização única: **falhou**. Não foi observado novo
  `messages.upsert`, nem registro no banco, após os envios nos dois sentidos.
  A instância estava `open`; informar clientes que esse caso não funciona por
  enquanto.
- Falha simulada do S3: **passou**. Com MinIO parado, a mídia gerou
  `messages.upsert`, foi salva no banco e o webhook seguiu sem `mediaUrl`.
- URL acessível do storage local: **passou**. Com MinIO exposto pelo gateway do host, a `mediaUrl` abriu com HTTP 200 nos fluxos inbound e outbound; o S3 público de produção ainda requer staging.
- Não houve deploy nem alteração da imagem usada em produção.
## Referências upstream

[PR #2684](https://github.com/evolution-foundation/evolution-api/pull/2684), [PR #2720](https://github.com/evolution-foundation/evolution-api/pull/2720) e [PR #2273](https://github.com/evolution-foundation/evolution-api/pull/2273).
