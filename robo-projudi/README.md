# Robô do Projudi

Lê a tabela de movimentos do Projudi (login + senha + Google Authenticator,
sem certificado digital) e envia para o site na nuvem, para aparecer
automaticamente na coluna Movimentação, em qualquer computador.

## Antes de usar — ajuste o robô ao seu tribunal

`robo.js` tem seletores (`#login`, `#senha`, `table.tabelaMovimentos`...) que
são um **ponto de partida**, não garantidos — a tela real do seu Projudi pode
usar nomes diferentes. Antes de rodar de verdade:

1. Abra o Projudi no Chrome, aperte F12 → aba Elements.
2. Clique com o botão direito no campo de login → Inspecionar → confira o
   atributo `id` ou `name` real, e ajuste `robo.js`.
3. Faça o mesmo para o campo de senha, botão de entrar, campo do código do
   Authenticator e a tabela de movimentos (a imagem que você mandou tem as
   colunas Seq./Data/Evento — confirme o nome da tabela/classes no HTML real).
4. Teste primeiro com `headless: false` (em vez de `'new'`) para *ver* o robô
   navegando e confirmar que ele encontra os campos certos.

## Rodar sem depender do computador ligado (GitHub Actions — recomendado)

Em vez do Agendador de Tarefas do Windows, o robô pode rodar automaticamente
na nuvem do GitHub, de graça (2.000 min/mês no plano gratuito, de sobra para
isso), sem precisar de nenhum computador ligado:

1. Suba esta pasta (`robo-projudi/`) e o arquivo `.github/workflows/robo-projudi.yml`
   para o repositório no GitHub (o mesmo do site).
2. No repositório → **Settings → Secrets and variables → Actions → New repository
   secret**, cadastre cada uma destas chaves (mesmos valores do `.env` local):
   `PROJUDI_URL`, `PROJUDI_USUARIO`, `PROJUDI_SENHA`, `PROJUDI_TOTP_SEGREDO`,
   `CODIGO_ESCRITORIO`, `ROBO_SEGREDO`, `SITE_URL`.
3. Pronto — ele já roda automaticamente no horário definido no workflow
   (hoje: de hora em hora, 8h-19h, dias úteis — ~800 min/mês, dentro do limite
   gratuito). Para testar na hora, vá em **Actions → Robô do Projudi → Run
   workflow**.
4. Para mudar a frequência, edite a linha `cron:` no arquivo do workflow —
   cada execução extra consome minutos do limite mensal.

## Rodar no seu próprio computador (alternativa)

Se preferir manter no computador do escritório em vez do GitHub Actions:

## Instalação (uma vez, no computador do escritório)

```
cd robo-projudi
npm install puppeteer otplib node-fetch@2
```

## Configuração

Crie um arquivo `.env` nesta pasta (não suba isso para o GitHub — é sensível):

```
PROJUDI_URL=https://projudi.tjpr.jus.br/projudi/
PROJUDI_USUARIO=seu-login
PROJUDI_SENHA=sua-senha
PROJUDI_TOTP_SEGREDO=a-chave-do-authenticator
CODIGO_ESCRITORIO=o-codigo-que-aparece-na-aba-integracao-do-site
ROBO_SEGREDO=escolha-uma-senha-só-para-o-robô
SITE_URL=https://processos-joao.vercel.app
```

E na Vercel (Settings → Environment Variables do projeto), adicione a mesma
`ROBO_PROJUDI_SEGREDO` com o valor de `ROBO_SEGREDO` acima.

Edite `processos.json` com os números dos processos que o robô deve checar.

## Rodar manualmente (teste)

```
node -r dotenv/config robo.js
```//  (instale dotenv também: npm install dotenv)

## Rodar automaticamente (Windows, Agendador de Tarefas)

Só necessário se você optou por rodar no computador do escritório em vez do
GitHub Actions (seção acima).

1. Abra o "Agendador de Tarefas" → Criar Tarefa.
2. Gatilho: repetir a cada X horas, só durante o expediente se preferir.
3. Ação: iniciar um programa → aponte para `node.exe`, argumentos
   `caminho\robo.js`, "iniciar em" a pasta `robo-projudi`.
4. Na aba Configurações, marque "Executar mesmo que o usuário não esteja
   conectado" se quiser rodar com a tela bloqueada.
5. O robô só roda enquanto o computador estiver ligado — se ele desligar fora
   do expediente, o robô simplesmente não roda até religar.

## O que acontece depois de enviar

Os movimentos ficam pendentes na nuvem. Na próxima vez que qualquer
computador abrir o site (ou sincronizar manualmente), ele processa essa fila:
cria o prazo automaticamente quando a movimentação bate com uma palavra-chave
(configurável na aba Integração) e tem um número de dias claro no texto —
senão, entra em Publicações como "a triar", com o selo "Provável prazo"
quando aplicável.

## Riscos e manutenção

- Se o Projudi mudar o layout da tela de login ou da tabela de movimentos, o
  robô para de encontrar os elementos e precisa de ajuste nos seletores.
- Se o Projudi introduzir captcha, o robô para de funcionar — não há como
  automatizar captcha de forma confiável/permitida.
- A chave do Authenticator (`PROJUDI_TOTP_SEGREDO`) equivale à sua senha do
  2FA — trate com o mesmo cuidado (nunca em texto público, nunca no Git).
