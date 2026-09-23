# Runbook de publicação em produção

## Objetivo

Publicar a imagem da Evolution da Weagles com segurança e fazer a migração da
Stack do Portainer sem perder sessões, banco, volume ou as customizações LID.

Este documento não contém credenciais, tokens, senhas ou endpoints privados.

## Estado conhecido

- A produção ainda usa uma imagem histórica (`evolution-api:2.3.7-lid2` ou a
  imagem registrada atualmente na Stack).
- A Stack mostrada no Portainer referencia `evoapicloud/evolution-api:v2.3.7`.
- A imagem `2.3.7-weagles.1` contém as customizações LID, mas não deve ser
  considerada como contendo a correção de mídia feita depois dela.
- A correção de mídia foi publicada como
  `ghcr.io/weagles-consultoria/evolution-api:v2.3.7-weagles.2`.
- Digest publicado: `sha256:1bed2feb992b6c635101bd5a938f94b59d3ccb925400676e0bb2aa01e54692d3`.
- O serviço Swarm esperado é `evolution_evolution` quando a Stack se chama
  `evolution`; confirmar o nome real antes do deploy.

## Conteúdo e privacidade da imagem

O `Dockerfile` copia para a imagem apenas os arquivos necessários ao runtime:
`src`, `public`, `prisma`, `manager`, `Docker`, `dist`, dependências e arquivos
de inicialização. Os `.md`, testes, `.git` e o contexto de documentação não
são copiados para a imagem final.

O build gera source maps em `dist/*.map`; portanto, qualquer pessoa que possa
baixar a imagem pode inspecionar parte do código compilado. O registry deve ser
privado. Não colocar secrets no Dockerfile, em labels ou na imagem.

## Registry recomendado

Usar um pacote privado no GitHub Container Registry (GHCR), por exemplo:

```text
ghcr.io/weagles-consultoria/evolution-api:v2.3.7-weagles.2
```

O pacote deve permanecer privado. A VPS precisa de uma credencial de leitura
do registry, preferencialmente um token com somente `read:packages`. A
credencial deve ser cadastrada no Portainer/registry, nunca commitada na Stack.

Alternativas: Docker Hub privado ou registry privado próprio. Não usar imagem
pública e não usar `latest` em produção.

## Preparação da release

1. Confirmar branch `weagles/v2.3.7-lid` e `git status` limpo após revisar as
   alterações.
2. Executar testes de mídia, lint, typecheck, `db:generate`, build e
   `git diff --check`.
3. Confirmar que o endpoint `POST /chat/fetchLid/{instance}` e o patch
   `Docker/scripts/patch_baileys_lid_mapping.sh` continuam presentes.
4. Criar commit convencional e uma tag versionada, por exemplo
   `v2.3.7-weagles.2`.
5. Criar a tag no Git e publicá-la no fork. O workflow
   `.github/workflows/publish_weagles_ghcr.yml` constrói para `linux/amd64`
   (arquitetura da VPS de produção) e publica automaticamente no GHCR usando o
   `GITHUB_TOKEN`; não é necessário cadastrar senha ou PAT no repositório. O
   workflow também permite republicar uma tag existente manualmente.
6. Confirmar no GitHub que o pacote continua privado e registrar a tag e o
   digest final da imagem. Para esta release, ambos já estão registrados acima.

Exemplo conceitual, sem credenciais:

```bash
docker buildx build --platform linux/amd64 \
  -t ghcr.io/weagles-consultoria/evolution-api:v2.3.7-weagles.2 \
  --push .
docker buildx imagetools inspect \
  ghcr.io/weagles-consultoria/evolution-api:v2.3.7-weagles.2
```

Os workflows legados que apontam para `evoapicloud/evolution-api` não devem ser
usados para esta release da Weagles; o workflow específico acima é o fluxo
oficial desta distribuição.

## Atualização da Stack no Portainer

No editor da Stack `evolution`:

1. Trocar o `image` upstream pela imagem privada versionada da Weagles,
   preferencialmente fixada por digest.
2. Remover o `command` antigo (`node ./dist/src/main.js`). A imagem deste
   repositório já possui `ENTRYPOINT`, executa migrations e inicia `node
   dist/main`.
3. Preservar environment, networks, labels Traefik, réplica, Redis, PostgreSQL,
   S3 e o volume de instâncias.
4. Manter `S3_ENABLED=true` e as credenciais/endpoints S3 existentes. Não
   habilitar Base64 como requisito do webhook.
5. Fazer o deploy/update da Stack pelo Portainer, com atualização `stop-first`,
   uma réplica e rollback automático.

Depois do deploy, um novo redeploy da Stack deve continuar apontando para a
imagem Weagles. Aplicar `docker service update` manualmente sem alterar a Stack
cria drift e pode ser revertido por um futuro redeploy no Portainer.

### Passo a passo do GHCR no Portainer

Executar esta configuração uma única vez por ambiente. Nunca registrar o token
no Git, na Stack, no Dockerfile ou neste documento.

1. No GitHub, abrir `Settings → Developer settings → Personal access tokens →
   Tokens classic`.
2. Criar um token com somente `read:packages`. Se a organização exigir SSO,
   autorizar o token para a organização Weagles. Copiar o token uma única vez e
   guardá-lo no gerenciador de segredos.
3. No Portainer, abrir `Registries → Add registry → Custom registry` e informar:

   ```text
   Name: GHCR Weagles
   Registry URL: ghcr.io
   Username: usuário do GitHub que criou o token
   Password: token classic com read:packages
   ```

4. Usar `Test connection` e salvar o registry somente se o teste passar.
5. Abrir `Stacks → evolution → Editor` e alterar o `image` para a tag da
   release ou, preferencialmente, para o digest:

   ```yaml
   image: ghcr.io/weagles-consultoria/evolution-api@sha256:1bed2feb992b6c635101bd5a938f94b59d3ccb925400676e0bb2aa01e54692d3
   ```

6. Na implantação da Stack, selecionar o registry `GHCR Weagles` quando o
   Portainer solicitar as credenciais do registry privado.
7. Conferir antes do update que variáveis, volumes, networks, labels, Redis,
   PostgreSQL, S3 e sessões não foram alterados. Remover o `command` antigo se
   ainda existir.
8. Atualizar a Stack pelo Portainer com uma réplica, `stop-first` e rollback
   automático. Não fazer apenas `docker service update`.
9. Após o update, confirmar no serviço `evolution_evolution` a imagem e o
   digest executados antes de iniciar o smoke test.

Se o Portainer não conseguir baixar a imagem, não tornar o pacote público:
validar o usuário, o token, a permissão `read:packages`, o SSO e o registry
selecionado na Stack.

## Backup e rollback

Antes do update:

- exportar a configuração atual do serviço (`docker service inspect`);
- confirmar backup do PostgreSQL e do volume externo de instâncias;
- anotar imagem, tag, digest, replicas e status atual;
- não remover nem recriar o volume `evolution_v2_data`.

Se o smoke test falhar, usar o rollback da própria atualização/Portainer ou:

```bash
docker service rollback evolution_evolution
```

Confirmar que o serviço voltou à imagem anterior e que as instâncias não
perderam a sessão. Não gerar novo QR nem apagar dados como tentativa de
rollback.

## Migrations e startup

O `ENTRYPOINT` executa `Docker/scripts/deploy_database.sh`, que roda
`npm run db:deploy`, gera o Prisma Client e inicia a aplicação. Ainda assim,
revisar migrations antes do deploy e acompanhar os logs até `Migration
succeeded` e o servidor pronto.

## Smoke test pós-deploy

- `GET /` responde versão esperada.
- Todas as instâncias existentes ficam `open`/conectadas.
- Webhook de texto chega.
- Imagem e áudio enviados e recebidos chegam com `mediaUrl`, sem Base64.
- A URL do S3 real abre a partir do CRM/consumidor do webhook.
- Documento, vídeo e sticker continuam funcionando.
- `POST /chat/fetchLid/{instance}` continua autenticado e funcional.
- Logs não mostram falha de migration, S3 ou reconexão persistente.
- Confirmar no Portainer a imagem e o digest efetivamente executados.

Visualização única está documentada como falha conhecida e não deve ser
comunicada aos clientes como suportada neste release.

## Acesso necessário

Para executar a migração são necessários, por canal seguro e fora deste
documento: acesso administrativo ao repositório/registry, permissão de leitura
do registry na VPS, acesso ao Portainer/VPS, janela de mudança, backup validado
e contato responsável pelo smoke test do CRM.
