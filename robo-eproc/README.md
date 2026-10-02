# Robô do EPROC (TJPR)

**Ainda em construção.** Por enquanto o robô só faz login e grava um
diagnóstico da tela que aparece depois — ainda não lê nem envia intimações
pendentes. Isso é de propósito: antes de tentar adivinhar onde fica a lista
de intimações pendentes (o equivalente à caixa "Pendências" do Projudi),
precisamos ver o log de uma execução real contra o EPROC de verdade.

## Login

O EPROC usa o mesmo tipo de tela de login (SSO via Keycloak, em
`sso.tjpr.jus.br`) que o Projudi já usa — por isso os seletores em `robo.js`
(`#username`, `#password`, `#kc-login`, `#otp`) são os mesmos, e devem
funcionar sem ajuste. Login por usuário + senha + código do Google
Authenticator (TOTP) — **não precisa desabilitar o código nos "dispositivos
confiáveis"**: o robô gera o código automaticamente a cada execução, do
mesmo jeito que já faz com o Projudi.

## Configurar (GitHub Actions — recomendado)

No repositório → **Settings → Secrets and variables → Actions → New
repository secret**, cadastre:

- `EPROC_URL` — ex.: `https://eproc1g.tjpr.jus.br/eproc/`
- `EPROC_USUARIO`
- `EPROC_SENHA`
- `EPROC_TOTP_SEGREDO` — a mesma chave do Google Authenticator que você usa
  pra gerar o código de 6 dígitos (pode colar como veio do app/QR code: o
  robô entende base32 ou hexadecimal, com ou sem espaços)
- As três já existentes (reaproveitadas do robô do Projudi, mesmo valor):
  `CODIGO_ESCRITORIO`, `ROBO_SEGREDO`, `SITE_URL`

Depois, em **Actions → Robô do EPROC → Run workflow**, rode manualmente uma
vez. O log mostra se o login funcionou e lista os links/texto da página
depois do login — me manda esse log (sem se preocupar: o robô já apaga
usuário/senha/segredo do texto antes de logar, trocando por `[oculto]`) pra
eu mapear onde ficam as intimações pendentes e terminar a leitura do prazo.

## Rodar localmente (alternativa)

```
cd robo-eproc
npm install
EPROC_URL=https://eproc1g.tjpr.jus.br/eproc/ \
EPROC_USUARIO=seu-login \
EPROC_SENHA=sua-senha \
EPROC_TOTP_SEGREDO=a-chave-do-authenticator \
CODIGO_ESCRITORIO=XXXX ROBO_SEGREDO=XXXX SITE_URL=https://seu-site.vercel.app \
node robo.js
```
