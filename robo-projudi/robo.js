// Robô do Projudi — roda no computador do escritório (Node.js), lê a tabela
// de movimentos de cada processo cadastrado e envia para o site na nuvem.
//
// Não usa certificado digital: login é usuário + senha + código do
// Google Authenticator (TOTP), igual ao que você já faz manualmente.
//
// CONFIGURAÇÃO (não coloque senhas no código — use variáveis de ambiente):
//   PROJUDI_USUARIO      seu login do Projudi
//   PROJUDI_SENHA        sua senha do Projudi
//   PROJUDI_TOTP_SEGREDO a chave secreta extraída do QR code do Authenticator
//   CODIGO_ESCRITORIO    o código de sincronização do site (aba Integração)
//   ROBO_SEGREDO         o mesmo valor de ROBO_PROJUDI_SEGREDO da Vercel
//   SITE_URL             ex.: https://processos-joao.vercel.app
//
// No Windows, defina essas variáveis no Agendador de Tarefas (Task Scheduler)
// como "Environment Variables" da tarefa, ou num arquivo .env carregado antes
// de rodar (veja README.md nesta pasta).
//
// INSTALAÇÃO (uma vez): dentro desta pasta, rode:
//   npm install puppeteer otplib node-fetch@2
//
// EXECUÇÃO: node robo.js
// Rode via Agendador de Tarefas do Windows na frequência desejada — o robô só
// funciona enquanto o computador estiver ligado.

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const fetch = require('node-fetch');

const PROJUDI_URL = process.env.PROJUDI_URL || 'https://projudi.tjpr.jus.br/projudi/'; // ajuste para o site do seu tribunal
const USUARIO = process.env.PROJUDI_USUARIO;
const SENHA = process.env.PROJUDI_SENHA;
const TOTP_SEGREDO = process.env.PROJUDI_TOTP_SEGREDO;
const CODIGO_ESCRITORIO = process.env.CODIGO_ESCRITORIO;
const ROBO_SEGREDO = process.env.ROBO_SEGREDO;
const SITE_URL = process.env.SITE_URL;

// Lista de processos a consultar. Mais simples: mantenha um arquivo processos.json
// nesta pasta com ["0001011-08.2024.8.16.0065", ...] — edite quando cadastrar
// processos novos no site (por ora não há uma via automática de buscar essa
// lista do site; é a limitação aceitável desta primeira versão do robô).
const PROCESSOS = require('./processos.json');

function checarConfig() {
  const faltando = ['PROJUDI_USUARIO', 'PROJUDI_SENHA', 'PROJUDI_TOTP_SEGREDO', 'CODIGO_ESCRITORIO', 'ROBO_SEGREDO', 'SITE_URL']
    .filter(k => !process.env[k]);
  if (faltando.length) { console.error('Faltam variáveis de ambiente:', faltando.join(', ')); process.exit(1); }
}

async function clicarPorTexto(page, textoAlvo) {
  return page.evaluate((texto) => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const els = Array.from(document.querySelectorAll('a, button, div, td, span, li, h1, h2, h3, strong'));
    const alvo = els.find(e => norm(e.innerText).includes(norm(texto)));
    if (!alvo) return false;
    (alvo.closest('a') || alvo.closest('[onclick]') || alvo).click();
    return true;
  }, textoAlvo);
}

async function login(page) {
  await page.goto(PROJUDI_URL, { waitUntil: 'networkidle2' });
  console.log('Após abrir o site:', page.url());

  // Tela inicial do TJPR: precisa clicar em "Advogados, Partes," antes de
  // chegar no formulário de login em si.
  const clicou = await clicarPorTexto(page, 'Advogados, Partes');
  console.log('Clicou em "Advogados, Partes"?', clicou);
  if (clicou) await page.waitForSelector('#username', { timeout: 15000 }).catch(() => {});
  console.log('Depois do clique, URL:', page.url());
  console.log('Título da página:', await page.title());
  console.log('Trecho do conteúdo:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));

  // ATENÇÃO: seletores confirmados para o login do TJPR (tela Keycloak,
  // "kc-form-login"). Se o campo de senha ou o botão tiverem outro id no seu
  // tribunal, ajuste aqui.
  await page.waitForSelector('#username', { timeout: 15000 });
  await page.type('#username', USUARIO, { delay: 20 });
  await page.type('#password', SENHA, { delay: 20 });
  await page.click('#kc-login');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  const pediu2FA = await page.$('#otp');
  if (pediu2FA) {
    const codigo = authenticator.generate(TOTP_SEGREDO);
    await page.type('#otp', codigo, { delay: 20 });
    await page.click('#kc-login');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  // Tela "Selecione o Perfil de Usuário do Projudi" — só aparece quando o CPF
  // tem mais de um perfil (ex.: Advogado e Assessor). Clica no link "Advogado".
  const temEscolhaPerfil = await page.$('.logonLinkPerfil');
  if (temEscolhaPerfil) {
    await clicarPorTexto(page, 'Advogado');
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  }
}

async function abrirListaAtivos(page) {
  const clicou = await page.evaluate(() => {
    const tds = Array.from(document.querySelectorAll('td'));
    const rotulo = tds.find(td => td.innerText && td.innerText.trim() === 'Ativos:');
    if (!rotulo) return false;
    const linha = rotulo.closest('tr');
    const link = linha && linha.querySelector('a');
    if (!link) return false;
    link.click();
    return true;
  });
  if (clicou) await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  return clicou;
}

async function coletarProcessosDaLista(page) {
  const processos = [];
  let pagina = 1;
  while (pagina <= 10) { // limite de segurança
    const daPagina = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="processo.do"]'));
      return links.map(a => {
        const em = a.querySelector('em.normal');
        return { numero: em ? em.innerText.trim() : a.innerText.trim(), href: a.href };
      }).filter(p => p.numero);
    });
    processos.push(...daPagina);
    const avancou = await page.evaluate(() => {
      const proximo = Array.from(document.querySelectorAll('a')).find(a => a.innerText.trim() === '▶' || a.title === 'Próxima página');
      if (!proximo) return false;
      proximo.click();
      return true;
    });
    if (!avancou) break;
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    pagina++;
  }
  // remove duplicados por número
  const vistos = new Set();
  return processos.filter(p => (vistos.has(p.numero) ? false : (vistos.add(p.numero), true)));
}

async function lerMovimentos(page, processo) {
  await page.goto(processo.href, { waitUntil: 'networkidle2' });
  await clicarPorTexto(page, 'Movimentações');
  await new Promise(r => setTimeout(r, 1500));
  const linhas = await page.evaluate(() => {
    const tabelas = Array.from(document.querySelectorAll('table'));
    const tabela = tabelas.find(t => t.innerText.includes('Seq.') && t.innerText.includes('Evento'));
    if (!tabela) return [];
    return Array.from(tabela.querySelectorAll('tr')).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const idxData = tds.findIndex(td => /\d{2}\/\d{2}\/\d{4}/.test(td.innerText));
      if (idxData === -1) return null;
      const m = tds[idxData].innerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const eventoTd = tds[idxData + 1];
      const evento = eventoTd ? eventoTd.innerText.replace(/\s+/g, ' ').trim() : '';
      if (!m || !evento) return null;
      return { dia: m[1], mes: m[2], ano: m[3], evento };
    }).filter(Boolean);
  });
  return linhas.map(l => ({ numero: processo.numero, data: l.ano + '-' + l.mes + '-' + l.dia, texto: l.evento }));
}

async function main() {
  checarConfig();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const movimentos = [];
  try {
    await login(page);
    const abriu = await abrirListaAtivos(page);
    console.log('Abriu lista de processos ativos?', abriu, '— URL:', page.url());
    const daLista = await coletarProcessosDaLista(page);
    console.log('Processos encontrados na lista:', daLista.length, JSON.stringify(daLista.slice(0, 5)));
    for (const processo of daLista) {
      try {
        const movs = await lerMovimentos(page, processo);
        movimentos.push(...movs);
        console.log(processo.numero, '→', movs.length, 'movimentos lidos');
      } catch (e) {
        console.error('Falhou em', processo.numero, ':', e.message);
      }
    }
  } finally {
    await browser.close();
  }

  if (!movimentos.length) { console.log('Nenhum movimento novo para enviar.'); return; }

  const resp = await fetch(SITE_URL + '/api/robo-projudi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: CODIGO_ESCRITORIO, segredo: ROBO_SEGREDO, movimentos })
  });
  const json = await resp.json();
  console.log('Enviado:', json);
}

main().catch(e => { console.error('Erro no robô:', e); process.exit(1); });
