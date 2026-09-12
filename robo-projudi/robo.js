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

async function login(page) {
  await page.goto(PROJUDI_URL, { waitUntil: 'networkidle2' });
  // ATENÇÃO: os seletores abaixo (#login, #senha, etc.) são um ponto de partida —
  // confira os nomes reais dos campos na tela de login do seu tribunal (botão
  // direito → Inspecionar) e ajuste antes de rodar de verdade.
  await page.type('#login', USUARIO, { delay: 20 });
  await page.type('#senha', SENHA, { delay: 20 });
  await page.click('#btnEntrar');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  const pediu2FA = await page.$('#codigoAutenticacao');
  if (pediu2FA) {
    const codigo = authenticator.generate(TOTP_SEGREDO);
    await page.type('#codigoAutenticacao', codigo, { delay: 20 });
    await page.click('#btnConfirmar');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }

  // Tela "Selecione o Perfil de Usuário do Projudi" — só aparece quando o CPF
  // tem mais de um perfil (ex.: Advogado e Assessor). Clica na linha
  // "Advogado" para entrar com esse perfil.
  const escolhaPerfil = await page.$$('table tr');
  for (const linha of escolhaPerfil) {
    const texto = await page.evaluate(el => el.innerText, linha);
    if (texto && texto.trim().toLowerCase().startsWith('advogado')) {
      await linha.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
      break;
    }
  }
}

async function lerMovimentos(page, numero) {
  // Ajuste a URL/fluxo de busca do processo para o padrão do seu tribunal.
  await page.goto(PROJUDI_URL + 'BuscaProcesso?numero=' + encodeURIComponent(numero), { waitUntil: 'networkidle2' });
  const linhas = await page.$$eval('table.tabelaMovimentos tr', trs => trs.slice(1).map(tr => {
    const tds = tr.querySelectorAll('td');
    return {
      data: tds[1] && tds[1].innerText.trim(),
      evento: tds[2] && tds[2].querySelector('b') ? tds[2].querySelector('b').innerText.trim() : (tds[2] && tds[2].innerText.trim())
    };
  }));
  return linhas
    .filter(l => l.data && l.evento)
    .map(l => {
      const [dia, mes, resto] = l.data.split('/');
      const ano = (resto || '').slice(0, 4);
      return { numero, data: ano + '-' + mes + '-' + dia, texto: l.evento };
    });
}

async function main() {
  checarConfig();
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const movimentos = [];
  try {
    await login(page);
    for (const numero of PROCESSOS) {
      try {
        const movs = await lerMovimentos(page, numero);
        movimentos.push(...movs);
        console.log(numero, '→', movs.length, 'movimentos lidos');
      } catch (e) {
        console.error('Falhou em', numero, ':', e.message);
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
