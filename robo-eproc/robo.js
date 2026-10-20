// Robô do EPROC (TJPR) — ainda em construção. Por enquanto só faz login e
// grava um diagnóstico da tela inicial, para descobrirmos juntos (a partir do
// log real) onde fica a lista de intimações pendentes e o prazo de cada uma.
// Depois que isso estiver mapeado, este arquivo passa a enviar os dados pro
// site, no mesmo formato que o robô do Projudi já usa (ver robo-projudi/robo.js
// e api/robo-projudi.js).
//
// Login: usuário + senha + código do Google Authenticator (TOTP), via tela de
// SSO (sso.tjpr.jus.br) — o mesmo esquema Keycloak que o Projudi já usa, então
// os seletores de login abaixo (#username, #password, #kc-login, #otp) são os
// mesmos. Sem certificado digital.
//
// Variáveis de ambiente necessárias (Secrets no GitHub / .env local):
//   EPROC_URL, EPROC_USUARIO, EPROC_SENHA, EPROC_TOTP_SEGREDO,
//   CODIGO_ESCRITORIO, ROBO_SEGREDO, SITE_URL

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const { resolverSegredo } = require('../robo-comum/totp.js');

const EPROC_URL = process.env.EPROC_URL || 'https://eproc1g.tjpr.jus.br/eproc/';
const USUARIO = process.env.EPROC_USUARIO;
const SENHA = process.env.EPROC_SENHA;

const totpCru = String(process.env.EPROC_TOTP_SEGREDO || '').trim();
const { segredo: TOTP_SEGREDO, formato: TOTP_FORMATO } = resolverSegredo(totpCru);

const CODIGO_ESCRITORIO = process.env.CODIGO_ESCRITORIO;
const ROBO_SEGREDO = process.env.ROBO_SEGREDO;
const SITE_URL = process.env.SITE_URL;

function checarConfig() {
  const faltando = ['EPROC_USUARIO', 'EPROC_SENHA', 'EPROC_TOTP_SEGREDO', 'CODIGO_ESCRITORIO', 'ROBO_SEGREDO', 'SITE_URL']
    .filter(k => !process.env[k]);
  if (faltando.length) { console.error('Faltam variáveis de ambiente:', faltando.join(', ')); process.exit(1); }
  // Não loga o segredo em si — só pistas sobre o formato, pra diagnosticar
  // sem nunca expor o valor real no log do GitHub Actions.
  console.log(
    'TOTP secreto: formato detectado —', TOTP_FORMATO, '— tamanho final', TOTP_SEGREDO.length,
    '— original continha "otpauth://"?', /otpauth:\/\//i.test(totpCru),
    '— original tinha minúsculas?', /[a-z]/.test(totpCru),
    '— original tinha símbolos (+ / = % : espaço)?', /[+/=%:\s]/.test(totpCru)
  );
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

// Remove valores sensíveis do texto antes de logar (senão o GitHub mascara a
// linha inteira e não conseguimos ler o diagnóstico).
function limpar(t) {
  let s = String(t || '');
  for (const v of [EPROC_URL, USUARIO, SENHA, TOTP_SEGREDO, CODIGO_ESCRITORIO, ROBO_SEGREDO, SITE_URL]) {
    if (v) s = s.split(v).join('[oculto]');
  }
  return s.replace(/\s+/g, ' ').trim();
}

// --- helpers que enxergam dentro dos frames (igual ao robô do Projudi — o
// EPROC pode ou não usar frames; page.frames() sempre inclui o documento
// principal, então os mesmos helpers funcionam dos dois jeitos) ------------

async function frameCom(page, seletor, timeout = 20000) {
  const limite = Date.now() + timeout;
  while (Date.now() < limite) {
    for (const f of page.frames()) {
      const tem = await f.$(seletor).catch(() => null);
      if (tem) return f;
    }
    await dormir(400);
  }
  return null;
}

async function emAlgumFrame(page, fn, ...args) {
  for (const f of page.frames()) {
    const r = await f.evaluate(fn, ...args).catch(() => null);
    if (r) return { frame: f, resultado: r };
  }
  return null;
}

async function clicarPorTexto(page, textoAlvo) {
  const r = await emAlgumFrame(page, (texto) => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const alvoNorm = norm(texto);
    const els = Array.from(document.querySelectorAll('a, button, div, td, span, li, h1, h2, h3, strong, b'));
    const candidatos = els
      .filter(e => norm(e.innerText).includes(alvoNorm))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const alvo = candidatos[0];
    if (!alvo) return false;
    const clicavel = alvo.closest('[onclick]') || alvo.closest('a') || alvo;
    clicavel.click();
    return true;
  }, textoAlvo);
  return !!r;
}

async function diagnostico(page) {
  const frames = [];
  for (const f of page.frames()) {
    const d = await f.evaluate(() => ({
      url: location.href,
      titulo: document.title,
      tamanho: (document.body && document.body.innerText || '').length,
      inicio: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      links: Array.from(document.querySelectorAll('a')).map(a => a.innerText.trim()).filter(Boolean).slice(0, 30)
    })).catch(() => null);
    if (d && (d.tamanho || d.links.length)) frames.push(d);
  }
  return { qtdFrames: page.frames().length, comConteudo: frames };
}

// --- login ------------------------------------------------------------------

async function login(page) {
  await page.goto(EPROC_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await dormir(2000);
  console.log('Página inicial do EPROC:', limpar(JSON.stringify(await diagnostico(page))));

  // Se não cair direto na tela de login (SSO), tenta achar um link de entrada
  // (igual ao Projudi, que exige clicar em "Advogados, Partes" antes).
  let fLogin = await frameCom(page, '#username', 5000);
  if (!fLogin) {
    for (const texto of ['Entrar', 'Acessar', 'Acesso Externo', 'Login']) {
      const clicou = await clicarPorTexto(page, texto);
      if (clicou) { console.log('Clicou em "' + texto + '"'); await dormir(2000); break; }
    }
    fLogin = await frameCom(page, '#username', 10000);
  }
  if (!fLogin) {
    console.log('Não achei o campo de login. Diagnóstico:', limpar(JSON.stringify(await diagnostico(page))));
    throw new Error('tela de login do EPROC não apareceu');
  }

  await fLogin.type('#username', USUARIO, { delay: 20 });
  await fLogin.type('#password', SENHA, { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    fLogin.click('#kc-login')
  ]);
  await dormir(1500);

  const fOtp = await frameCom(page, '#otp, #totp, input[name="otp"], input[autocomplete="one-time-code"]', 10000);
  if (fOtp) {
    const sel = await fOtp.evaluate(() => {
      const cands = ['#otp', '#totp', 'input[name="otp"]', 'input[autocomplete="one-time-code"]'];
      return cands.find(s => document.querySelector(s)) || null;
    });
    await fOtp.type(sel, authenticator.generate(TOTP_SEGREDO), { delay: 20 });
    const btn = await fOtp.evaluate(() => {
      const b = document.querySelector('#kc-login') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');
      if (!b) return false;
      b.click();
      return true;
    });
    await dormir(3000);
    console.log('2FA enviado (campo', sel, ', botão', btn, ')');
  } else {
    console.log('Não apareceu campo de 2FA. Diagnóstico:', limpar(JSON.stringify(await diagnostico(page))));
  }

  console.log('Depois do login — diagnóstico da página:', limpar(JSON.stringify(await diagnostico(page))));
}

async function main() {
  checarConfig();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1400, height: 900 });
  try {
    await login(page);
    // TODO: depois de confirmar o login pelo diagnóstico acima, o próximo
    // passo é mapear a tela de intimações pendentes (o equivalente à caixa
    // "Pendências" do Projudi) e implementar a leitura + envio pro site.
    console.log('Login no EPROC concluído — aguardando mapear a tela de intimações pendentes.');
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('Erro no robô do EPROC:', e); process.exit(1); });
