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

// Igual ao emAlgumFrame, mas insiste até o conteúdo aparecer (ou estourar o
// tempo). Aba do Projudi carrega por Ajax, e processo grande demora: um
// processo com 1069 movimentos exibindo 500 por página não fica pronto em 2s.
// Com espera fixa, o robô lia a tabela antes de ela existir e concluía, errado,
// que o processo não tinha movimentação nenhuma.
async function esperarEmAlgumFrame(page, fn, timeout = 25000, ...args) {
  const limite = Date.now() + timeout;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await emAlgumFrame(page, fn, ...args);
    if (ultimo) return ultimo;
    await dormir(700);
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

// Espera entre as tentativas de abrir o Projudi, crescendo a cada falha. Antes
// eram 3 tentativas de 5 em 5 segundos: a janela toda dava ~3 minutos, curta
// demais para atravessar uma instabilidade do Projudi (que sai do ar de vez em
// quando) — e uma rodada perdida só volta na hora seguinte.
const ESPERAS_LOGIN = [10000, 30000, 60000, 120000];

async function login(page) {
  let carregou = false;
  for (let tentativa = 1; tentativa <= ESPERAS_LOGIN.length + 1 && !carregou; tentativa++) {
    try {
      await page.goto(PROJUDI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      carregou = true;
    } catch (e) {
      const espera = ESPERAS_LOGIN[tentativa - 1];
      console.log('Tentativa', tentativa, 'de abrir o Projudi falhou:', e.message,
        espera ? '— tentando de novo em ' + (espera / 1000) + 's' : '');
      if (espera) await dormir(espera);
    }
  }
  if (!carregou) {
    // O navegador não abriu a página, mas isso não diz POR QUÊ. Uma requisição
    // simples responde a pergunta que importa: se vier status HTTP (403, 503...)
    // o servidor está de pé e recusando este runner — bloqueio, e insistir não
    // adianta; se estourar no nível de rede (ETIMEDOUT, ECONNREFUSED), o site
    // está fora do ar ou inalcançável daqui. Sem isso, cada falha vira mais uma
    // rodada de adivinhação.
    let diag;
    try {
      const r = await fetch(PROJUDI_URL, { timeout: 20000, redirect: 'manual' });
      diag = 'respondeu HTTP ' + r.status + ' ' + (r.statusText || '') +
        ' — servidor de pé; se for 403/503 é bloqueio a este servidor, não queda do Projudi';
    } catch (e) {
      diag = 'nem respondeu (' + (e.code || e.type || e.name) + ': ' + e.message + ')' +
        ' — fora do ar ou inalcançável daqui';
    }
    console.log('Diagnóstico do acesso ao Projudi:', limpar(diag));
    throw new Error('não conseguiu abrir o site do Projudi (fora do ar ou bloqueando o acesso)');
  }
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
      // innerText (não textContent!) — o Projudi põe um <script> de balãozinho de
      // ajuda dentro da própria célula do valor; textContent inclui esse script
      // no texto, innerText respeita o que é realmente exibido na tela.
      const tds = Array.from(document.querySelectorAll('td'));
      const alvo = tds.find(td => td.innerText.replace(/\s+/g, ' ').trim() === rotulo);
      if (!alvo) return '';
      let prox = alvo.nextElementSibling;
      while (prox && !prox.innerText.trim()) prox = prox.nextElementSibling;
      return prox ? prox.innerText.replace(/\s+/g, ' ').trim() : '';
    }
    const juizo = porRotulo('Juízo:');
    // Diagnóstico: se não achou pelo padrão <td>Juízo:</td><td>valor</td>,
    // procura qualquer elemento pequeno (sem filhos com o mesmo texto, pra não
    // pegar a página inteira) que contenha a palavra "Juízo" e manda um
    // pedacinho do texto pro log, pra descobrir onde esse dado realmente fica.
    let diagnosticoJuizo = [];
    if (!juizo) {
      const todos = Array.from(document.querySelectorAll('td,span,div,a,li'));
      diagnosticoJuizo = todos
        .filter(el => /ju[íi]zo/i.test(el.innerText || '') && !Array.from(el.children).some(c => /ju[íi]zo/i.test(c.innerText || '')))
        .slice(0, 5)
        .map(el => (el.tagName + ': ' + el.innerText.replace(/\s+/g, ' ').trim()).slice(0, 160));
    }
    return {
      classeProcessual: porRotulo('Classe Processual:'),
      assunto: porRotulo('Assunto Principal:'),
      juizo, diagnosticoJuizo
    };
  });
  return r ? r.resultado : { classeProcessual: '', assunto: '', juizo: '', diagnosticoJuizo: [] };
}

// Lê o nome da primeira parte de cada polo (autor/réu) na aba "Partes e Outros".
// O Projudi marca cada seção com um <input type="hidden"> antes da tabela
// (ex.: name="promoventesPageSize") — mais estável do que procurar por <h4>,
// que muda de rótulo conforme o tipo de ação (Requerente/Autor/Exequente...).
async function lerPartes(page) {
  await clicarPorTexto(page, 'Partes e Outros');
  const r = await esperarEmAlgumFrame(page, () => {
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
    function primeiraLinhaDeDados(tabela) {
      if (!tabela) return null;
      return Array.from(tabela.querySelectorAll('tbody tr')).find(tr => !tr.querySelector('th')) || null;
    }
    function colunas(tr) {
      return tr ? Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\s+/g, ' ').trim()) : [];
    }
    const tabAtivo = tabelaAposMarcador('promoventesPageSize');
    const tabPassivo = tabelaAposMarcador('promovidasPageSize');
    const colsAtivo = colunas(primeiraLinhaDeDados(tabAtivo));
    const colsPassivo = colunas(primeiraLinhaDeDados(tabPassivo));
    // devolve "false" enquanto não achou nome nenhum, para quem chamou continuar
    // esperando/procurando em outro frame — devolver um objeto vazio aqui daria
    // a aba como lida antes de ela ter carregado
    if (!colsAtivo[1] && !colsPassivo[1]) return false;
    // Confirmado pelo diagnóstico em produção (31 processos, todos os tipos de
    // ação): a coluna 0 vem sempre vazia (ícone/checkbox) e a coluna 1 é o nome
    // da parte, nessa ordem, sempre.
    return {
      ativo: colsAtivo[1] || '',
      passivo: colsPassivo[1] || '',
      colsAtivo, colsPassivo
    };
  });
  const partes = r ? r.resultado : { ativo: '', passivo: '', colsAtivo: [], colsPassivo: [] };
  return {
    texto: [partes.ativo, partes.passivo].filter(Boolean).join(' x '),
    colsAtivo: partes.colsAtivo, colsPassivo: partes.colsPassivo
  };
}

async function lerMovimentos(page) {
  await clicarPorTexto(page, 'Movimentações');
  const r = await esperarEmAlgumFrame(page, () => {
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
  // se mesmo esperando não veio movimento nenhum, registra o que a tela tinha,
  // para dar pra saber se foi aba errada, tabela com outro cabeçalho ou timeout
  let diagnosticoMovimentos = '';
  if (!linhasMov.length) {
    const probe = await emAlgumFrame(page, () => {
      const t = (document.body && document.body.innerText) || '';
      if (!t.trim()) return false;
      return {
        tamanho: t.length,
        temSeq: t.includes('Seq.'),
        temEvento: t.includes('Evento'),
        registros: (t.match(/\d+\s+registro\(s\) encontrado\(s\)/) || [''])[0],
        inicio: t.replace(/\s+/g, ' ').slice(0, 120)
      };
    });
    diagnosticoMovimentos = probe ? JSON.stringify(probe.resultado) : '(nenhum frame com texto)';
  }
  return {
    movimentos: linhasMov.map(l => ({ numero: processo.numero, data: l.data, texto: l.texto })),
    diagnosticoMovimentos,
    dadosGerais: { numero: processo.numero, classeProcessual: gerais.classeProcessual, assunto: gerais.assunto, juizo: gerais.juizo, partes: partes.texto },
    diagnosticoPartes: { colsAtivo: partes.colsAtivo, colsPassivo: partes.colsPassivo },
    diagnosticoJuizo: gerais.diagnosticoJuizo || []
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
        // ainda sem achar o padrão certo do Juízo — loga pistas pra descobrir onde
        // esse dado fica nessa versão do Projudi
        if (r.diagnosticoJuizo.length) {
          console.log('  juízo (diagnóstico):', JSON.stringify(r.diagnosticoJuizo));
        }
        if (r.diagnosticoMovimentos) {
          console.log('  sem movimentos (diagnóstico):', limpar(r.diagnosticoMovimentos));
        }
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
