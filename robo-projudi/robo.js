// Robô do Projudi — lê a tabela de movimentos dos processos ativos e envia
// para o site na nuvem. Roda no GitHub Actions ou num computador local.
//
// Login: usuário + senha + código do Google Authenticator (TOTP). Sem
// certificado digital.
//
// IMPORTANTE: o Projudi usa frames — o conteúdo real fica dentro de frames
// internos, não no documento principal. Por isso todas as buscas/cliques aqui
// passam pelos helpers abaixo, que procuram em todos os frames da página.
//
// Variáveis de ambiente necessárias (Secrets no GitHub / .env local):
//   PROJUDI_URL, PROJUDI_USUARIO, PROJUDI_SENHA, PROJUDI_TOTP_SEGREDO,
//   CODIGO_ESCRITORIO, ROBO_SEGREDO, SITE_URL

const puppeteer = require('puppeteer');
const { authenticator } = require('otplib');
const fetch = require('node-fetch');

const PROJUDI_URL = process.env.PROJUDI_URL || 'https://projudi.tjpr.jus.br/projudi/';
const USUARIO = process.env.PROJUDI_USUARIO;
const SENHA = process.env.PROJUDI_SENHA;

// otplib/authenticator (compatível com Google Authenticator) espera o segredo
// em base32. Algumas ferramentas de leitura de QR code mostram o segredo em
// hexadecimal (os mesmos bytes, outra codificação) — se vier assim, converte
// para base32 em vez de tentar usar hex direto, que geraria código sempre errado.
function hexParaBase32(hex) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(hex, 'hex');
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let saida = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) saida += alfabeto[parseInt(bits.slice(i, i + 5), 2)];
  const resto = bits.length % 5;
  if (resto) saida += alfabeto[parseInt(bits.slice(-resto).padEnd(5, '0'), 2)];
  return saida;
}

// Segredos colados no GitHub às vezes vêm com espaço/quebra de linha extra
// (ex.: copiado de um terminal), embutidos numa URI/trecho tipo "secret=XXXX"
// (o prefixo "otpauth://totp/...?" pode não estar presente se o texto foi
// cortado), ou num rótulo tipo "Chave secreta: XXXX XXXX" — tenta cada recorte
// possível e usa o primeiro que realmente validar como base32 ou hex.
const totpCru = String(process.env.PROJUDI_TOTP_SEGREDO || '').trim();
const totpMatchSecret = totpCru.match(/secret=([^&\s]+)/i);
const totpMatchRotulo = totpCru.match(/:\s*(.+)$/);
const totpCandidatos = [
  { origem: 'trecho "secret=..."', valor: totpMatchSecret && decodeURIComponent(totpMatchSecret[1]) },
  { origem: 'trecho após "rótulo:"', valor: totpMatchRotulo && totpMatchRotulo[1] },
  { origem: 'texto original', valor: totpCru }
].filter(c => c.valor);

function validarSegredo(bruto) {
  if (/^[A-Z2-7]+=*$/.test(bruto)) return 'base32';
  if (bruto.length % 2 === 0 && /^[0-9A-F]+$/.test(bruto)) return 'hex';
  return null;
}

let totpBruto = '', totpTipo = null, totpOrigem = 'texto original';
for (const c of totpCandidatos) {
  const normalizado = c.valor.replace(/\s+/g, '').toUpperCase();
  const tipo = validarSegredo(normalizado);
  if (tipo) { totpBruto = normalizado; totpTipo = tipo; totpOrigem = c.origem; break; }
}
if (!totpTipo) totpBruto = (totpCandidatos[0] ? totpCandidatos[0].valor : totpCru).replace(/\s+/g, '').toUpperCase();

const TOTP_SEGREDO = totpTipo === 'hex' ? hexParaBase32(totpBruto) : totpBruto;
const TOTP_FORMATO = totpTipo
  ? `${totpOrigem} + ${totpTipo === 'hex' ? 'hex (convertido p/ base32)' : 'base32'}`
  : 'desconhecido — confira o segredo';

const CODIGO_ESCRITORIO = process.env.CODIGO_ESCRITORIO;
const ROBO_SEGREDO = process.env.ROBO_SEGREDO;
const SITE_URL = process.env.SITE_URL;

function checarConfig() {
  const faltando = ['PROJUDI_USUARIO', 'PROJUDI_SENHA', 'PROJUDI_TOTP_SEGREDO', 'CODIGO_ESCRITORIO', 'ROBO_SEGREDO', 'SITE_URL']
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

// Remove valores sensíveis do texto antes de logar (senão o GitHub mascara
// a linha inteira e não conseguimos ler o diagnóstico).
function limpar(t) {
  let s = String(t || '');
  for (const v of [PROJUDI_URL, USUARIO, SENHA, TOTP_SEGREDO, CODIGO_ESCRITORIO, ROBO_SEGREDO, SITE_URL]) {
    if (v) s = s.split(v).join('[oculto]');
  }
  return s.replace(/\s+/g, ' ').trim();
}

async function textoDosFrames(page, limite = 300) {
  const out = [];
  for (const f of page.frames()) {
    const t = await f.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
    if (t && t.trim()) out.push(limpar(t).slice(0, limite));
  }
  return out;
}

// --- helpers que enxergam dentro dos frames -------------------------------

// Espera até algum frame ter o seletor; devolve esse frame (ou null).
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

// Roda uma função em cada frame até uma delas devolver algo "verdadeiro".
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
    // pega todos que contêm o texto e escolhe o MAIS ESPECÍFICO (menor texto),
    // senão um container grande da página seria clicado sem efeito.
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
      tamanho: (document.body && document.body.innerText || '').length,
      links: document.querySelectorAll('a').length
    })).catch(() => null);
    if (d && (d.tamanho || d.links)) frames.push(d);
  }
  return { qtdFrames: page.frames().length, comConteudo: frames };
}

// --- fluxo ----------------------------------------------------------------

async function login(page) {
  let carregou = false;
  for (let tentativa = 1; tentativa <= 3 && !carregou; tentativa++) {
    try {
      await page.goto(PROJUDI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      carregou = true;
    } catch (e) {
      console.log('Tentativa', tentativa, 'de abrir o Projudi falhou:', e.message);
      await dormir(5000);
    }
  }
  if (!carregou) throw new Error('não conseguiu abrir o site do Projudi');
  await dormir(2500);
  console.log('Página inicial:', JSON.stringify(await diagnostico(page)));

  const clicou = await clicarPorTexto(page, 'Advogados, Partes');
  console.log('Clicou em "Advogados, Partes"?', clicou);

  const fLogin = await frameCom(page, '#username');
  if (!fLogin) {
    console.log('Não achei o campo de login. Diagnóstico:', JSON.stringify(await diagnostico(page)));
    throw new Error('tela de login não apareceu');
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
    console.log('Não apareceu campo de 2FA. Diagnóstico:', JSON.stringify(await diagnostico(page)));
  }

  const fPerfil = await frameCom(page, '.logonLinkPerfil', 8000);
  if (fPerfil) {
    await clicarPorTexto(page, 'Advogado');
    await dormir(2500);
    console.log('Perfil "Advogado" selecionado');
  } else {
    console.log('Não apareceu escolha de perfil.');
  }

  const logado = await emAlgumFrame(page, () => {
    const t = (document.body.innerText || '').toLowerCase();
    return t.includes('ativos:') || t.includes('mesa do(a)') || t.includes('ações 1º grau');
  });
  console.log('Parece logado?', !!logado, '— Diagnóstico:', JSON.stringify(await diagnostico(page)));
  if (!logado) console.log('Conteúdo das telas:', JSON.stringify(await textoDosFrames(page)));
}

async function abrirListaAtivos(page) {
  const r = await emAlgumFrame(page, () => {
    const tds = Array.from(document.querySelectorAll('td'));
    const rotulo = tds.find(td => td.innerText && td.innerText.trim() === 'Ativos:');
    if (!rotulo) return false;
    const linha = rotulo.closest('tr');
    const link = linha && linha.querySelector('a');
    if (!link) return false;
    link.click();
    return true;
  });
  await dormir(2500);
  return !!r;
}

async function coletarProcessosDaLista(page) {
  const todos = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await emAlgumFrame(page, () => {
      const links = Array.from(document.querySelectorAll('a[href*="processo.do"]'));
      const lista = links.map(a => {
        const em = a.querySelector('em');
        return { numero: (em ? em.innerText : a.innerText).trim(), href: a.href };
      }).filter(p => /\d{7}-\d{2}\.\d{4}/.test(p.numero));
      return lista.length ? lista : false;
    });
    if (!r) break;
    todos.push(...r.resultado);
    const avancou = await emAlgumFrame(page, () => {
      const prox = Array.from(document.querySelectorAll('a')).find(a =>
        a.title === 'Próxima página' || a.innerText.trim() === '▶' || /pr[óo]xima/i.test(a.title || ''));
      if (!prox) return false;
      prox.click();
      return true;
    });
    if (!avancou) break;
    await dormir(2500);
  }
  const vistos = new Set();
  return todos.filter(p => (vistos.has(p.numero) ? false : (vistos.add(p.numero), true)));
}

// Lê Classe Processual / Assunto Principal / Juízo — campos de rótulo+valor
// visíveis na aba inicial do processo (mesmo padrão em todo o Projudi:
// <td>Rótulo:</td><td>valor</td> ou <td>Rótulo:</td><td><a>valor</a></td>).
async function lerDadosGerais(page) {
  const r = await emAlgumFrame(page, () => {
    function porRotulo(rotulo) {
      const tds = Array.from(document.querySelectorAll('td'));
      const alvo = tds.find(td => td.textContent.replace(/\s+/g, ' ').trim() === rotulo);
      if (!alvo) return '';
      let prox = alvo.nextElementSibling;
      while (prox && !prox.textContent.trim()) prox = prox.nextElementSibling;
      return prox ? prox.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    return {
      classeProcessual: porRotulo('Classe Processual:'),
      assunto: porRotulo('Assunto Principal:'),
      juizo: porRotulo('Juízo:')
    };
  });
  return r ? r.resultado : { classeProcessual: '', assunto: '', juizo: '' };
}

// Lê o nome da primeira parte de cada polo (autor/réu) na aba "Partes e Outros".
// O Projudi marca cada seção com um <input type="hidden"> antes da tabela
// (ex.: name="promoventesPageSize") — mais estável do que procurar por <h4>,
// que muda de rótulo conforme o tipo de ação (Requerente/Autor/Exequente...).
async function lerPartes(page) {
  await clicarPorTexto(page, 'Partes e Outros');
  await dormir(1500);
  const r = await emAlgumFrame(page, () => {
    const marcadores = ['promoventesPageSize', 'promovidasPageSize', 'terceirasPageSize'];
    function tabelaAposMarcador(nome) {
      const marcador = document.querySelector('input[type="hidden"][name="' + nome + '"]');
      if (!marcador) return null;
      let el = marcador.nextElementSibling;
      while (el) {
        if (el.tagName === 'INPUT' && el.type === 'hidden' && marcadores.includes(el.getAttribute('name'))) break;
        if (el.tagName === 'TABLE') return el;
        el = el.nextElementSibling;
      }
      return null;
    }
    function primeiroNome(tabela) {
      if (!tabela) return '';
      const linhas = Array.from(tabela.querySelectorAll('tbody tr'));
      for (const tr of linhas) {
        if (tr.querySelector('th')) continue;
        const cel = tr.querySelector('td');
        if (cel && cel.textContent.trim()) return cel.textContent.replace(/\s+/g, ' ').trim();
      }
      return '';
    }
    return {
      ativo: primeiroNome(tabelaAposMarcador('promoventesPageSize')),
      passivo: primeiroNome(tabelaAposMarcador('promovidasPageSize'))
    };
  });
  const partes = r ? r.resultado : { ativo: '', passivo: '' };
  return [partes.ativo, partes.passivo].filter(Boolean).join(' x ');
}

async function lerMovimentos(page) {
  await clicarPorTexto(page, 'Movimentações');
  await dormir(2000);
  const r = await emAlgumFrame(page, () => {
    const tabelas = Array.from(document.querySelectorAll('table'));
    const tabela = tabelas.find(t => t.innerText.includes('Seq.') && t.innerText.includes('Evento'));
    if (!tabela) return false;
    const linhas = Array.from(tabela.querySelectorAll('tr')).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const idxData = tds.findIndex(td => /\d{2}\/\d{2}\/\d{4}/.test(td.innerText));
      if (idxData === -1) return null;
      const m = tds[idxData].innerText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const eventoTd = tds[idxData + 1];
      const evento = eventoTd ? eventoTd.innerText.replace(/\s+/g, ' ').trim() : '';
      if (!m || !evento) return null;
      return { data: m[3] + '-' + m[2] + '-' + m[1], texto: evento };
    }).filter(Boolean);
    return linhas.length ? linhas : false;
  });
  // só as 10 mais recentes de cada processo, para não inflar o envio
  return r ? r.resultado.slice(0, 10) : [];
}

async function lerDadosProcesso(page, processo) {
  await page.goto(processo.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dormir(1200);
  const gerais = await lerDadosGerais(page);
  const partes = await lerPartes(page);
  const linhasMov = await lerMovimentos(page);
  return {
    movimentos: linhasMov.map(l => ({ numero: processo.numero, data: l.data, texto: l.texto })),
    dadosGerais: { numero: processo.numero, classeProcessual: gerais.classeProcessual, assunto: gerais.assunto, juizo: gerais.juizo, partes }
  };
}

async function main() {
  checarConfig();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1400, height: 900 });
  const movimentos = [];
  const dadosGerais = [];
  try {
    await login(page);
    const abriu = await abrirListaAtivos(page);
    console.log('Abriu lista de processos ativos?', abriu);
    const daLista = await coletarProcessosDaLista(page);
    console.log('Processos encontrados:', daLista.length);
    for (const processo of daLista) {
      try {
        const r = await lerDadosProcesso(page, processo);
        movimentos.push(...r.movimentos);
        dadosGerais.push(r.dadosGerais);
        console.log(
          processo.numero, '→', r.movimentos.length, 'movimentos',
          '· classe:', r.dadosGerais.classeProcessual || '(vazio)',
          '· assunto:', r.dadosGerais.assunto || '(vazio)',
          '· juízo:', r.dadosGerais.juizo || '(vazio)',
          '· partes:', r.dadosGerais.partes || '(vazio)'
        );
      } catch (e) {
        console.error('Falhou em', processo.numero, ':', e.message);
      }
    }
  } finally {
    await browser.close();
  }

  if (!movimentos.length) { console.log('Nada para enviar.'); return; }

  const resp = await fetch(SITE_URL + '/api/robo-projudi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: CODIGO_ESCRITORIO, segredo: ROBO_SEGREDO, movimentos, dadosGerais })
  });
  const json = await resp.json();
  console.log('Enviado:', movimentos.length, 'movimentos →', JSON.stringify(json));
}

main().catch(e => { console.error('Erro no robô:', e); process.exit(1); });
