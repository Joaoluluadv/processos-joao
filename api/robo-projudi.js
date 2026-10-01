// Vercel Serverless Function — recebe movimentações lidas pelo robô do Projudi
// (rodando no computador do escritório) e guarda como pendentes na nuvem.
// O próprio site (em qualquer computador) processa essas pendências na próxima
// vez que abrir ou sincronizar: cria o prazo automaticamente quando a
// movimentação bate com uma palavra-chave e tem prazo claro (mesma regra do
// DataJud), ou entra como publicação a triar.
//
// Rota: POST /api/robo-projudi
// Body: { codigo, segredo, movimentos: [{ numero, data: 'AAAA-MM-DD', texto }],
//         dadosGerais: [{ numero, classeProcessual, assunto, juizo, partes }],
//         pendencias: [{ numero, inicio, fim, dias, descricao, evento }] }
//
// dadosGerais é opcional — uma "foto" atual de cada processo (classe
// processual detalhada, assunto, juízo, partes), sem histórico. O site usa
// isso só pra preencher campos que ainda estão vazios, nunca para sobrescrever
// algo que a pessoa já preencheu à mão.
//
// pendencias é opcional — a caixa "Pendências" do Projudi, que já traz a data
// final do prazo calculada pelo próprio tribunal (dias úteis e feriados já
// descontados). "fim" é 'AAAA-MM-DD'. Um processo que estava com pendência e
// deixou de mandar uma nesta rodada teve o prazo cumprido (ou deixou de
// existir) — a entrada antiga dele é apagada, não fica parada.
//
// Exige a mesma integração Vercel KV usada por /api/dados, e a variável de
// ambiente ROBO_PROJUDI_SEGREDO (defina você mesmo, qualquer texto — é a senha
// que só o robô conhece, para ninguém mais poder gravar dados por essa rota).

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEGREDO = process.env.ROBO_PROJUDI_SEGREDO;

// Quantas movimentações recentes de cada processo o site mostra na linha do tempo.
const MOVIMENTOS_POR_PROCESSO = 5;

function chave(codigo) {
  return 'prazos_escritorio:' + String(codigo || '').trim().toUpperCase();
}

async function kvCmd(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const json = await r.json();
  if (!r.ok || json.error) throw new Error(json.error || ('KV respondeu ' + r.status));
  return json.result;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Use POST' }); return; }
  if (!URL || !TOKEN) { res.status(501).json({ erro: 'Banco de dados (Vercel KV) não configurado.' }); return; }
  if (!SEGREDO) { res.status(501).json({ erro: 'Defina ROBO_PROJUDI_SEGREDO nas variáveis de ambiente da Vercel.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const codigo = body && body.codigo;
  const segredo = body && body.segredo;
  const movimentos = (body && body.movimentos) || [];
  const dadosGerais = (body && body.dadosGerais) || [];
  const pendencias = (body && body.pendencias) || [];
  if (!codigo) { res.status(400).json({ erro: 'Informe { codigo }' }); return; }
  if (segredo !== SEGREDO) { res.status(401).json({ erro: 'Segredo inválido' }); return; }
  if (!Array.isArray(movimentos) || !movimentos.length) { res.status(400).json({ erro: 'Informe { movimentos: [...] }' }); return; }

  try {
    const bruto = await kvCmd(['GET', chave(codigo)]);
    const registro = bruto ? JSON.parse(bruto) : { dados: { processos: [], publicacoes: [], eventos: [] } };
    const dados = registro.dados || {};

    // "Já visto" só conta se o movimento realmente entrou na linha do tempo de um
    // processo (dados.processos[].movimentacoes). NÃO conta publicações: antes de
    // comparar número só pelos dígitos, um movimento podia virar só uma
    // "publicação solta" (número não bateu com nenhum processo cadastrado) — se
    // isso contasse como "já visto", o robô nunca mais reenviaria esse movimento,
    // e ele ficaria pra sempre sem processo associado.
    const vistos = {};
    (dados.processos || []).forEach(p => (p.movimentacoes || []).forEach(m => { vistos[p.numero + '|' + m.data + '|' + m.texto] = true; }));
    const pendentesAtuais = dados.roboPendentes || [];
    pendentesAtuais.forEach(m => { vistos[m.numero + '|' + m.data + '|' + m.texto] = true; });

    const novas = movimentos.filter(m => m && m.numero && m.data && m.texto && !vistos[m.numero + '|' + m.data + '|' + m.texto]);
    dados.roboPendentes = pendentesAtuais.concat(novas).slice(-300);

    // "Foto" das últimas movimentações de cada processo, sempre sobrescrita
    // (sem "já visto"). É daqui que o site monta a linha do tempo: assim as
    // movimentações aparecem sempre, mesmo que o robô já as tenha enviado antes
    // ou que o processo não tenha nenhum prazo aberto. A fila roboPendentes
    // acima continua existindo só para a triagem de publicações/prazos novos.
    const porProcesso = {};
    movimentos.forEach(m => {
      if (!m || !m.numero || !m.data || !m.texto) return;
      (porProcesso[m.numero] = porProcesso[m.numero] || []).push({ data: m.data, texto: m.texto });
    });
    const foto = dados.roboMovimentos || {};
    Object.keys(porProcesso).forEach(numero => {
      const lista = porProcesso[numero]
        .sort((a, b) => String(b.data).localeCompare(String(a.data)))
        .slice(0, MOVIMENTOS_POR_PROCESSO);
      foto[numero] = { numero, movimentos: lista, atualizadoEm: Date.now() };
    });
    dados.roboMovimentos = foto;

    if (Array.isArray(dadosGerais) && dadosGerais.length) {
      const mapa = dados.roboDadosGerais || {};
      dadosGerais.forEach(d => {
        if (!d || !d.numero) return;
        mapa[d.numero] = {
          numero: d.numero,
          classeProcessual: d.classeProcessual || '',
          assunto: d.assunto || '',
          juizo: d.juizo || '',
          partes: d.partes || '',
          atualizadoEm: Date.now()
        };
      });
      dados.roboDadosGerais = mapa;
    }

    // Igual a roboDadosGerais: só mexe se o robô mandou algo de verdade. Mas
    // ao contrário dele, aqui é "foto" de verdade — processo visitado nesta
    // rodada e sem pendência mandada teve a intimação dele cumprida (ou a
    // pendência some por outro motivo), então a entrada antiga é removida em
    // vez de ficar esquecida mostrando um prazo que já não existe mais.
    if (Array.isArray(dadosGerais) && dadosGerais.length) {
      const mapaPend = dados.roboPendenciasPrazo || {};
      const comPendenciaAgora = {};
      pendencias.forEach(p => { if (p && p.numero) comPendenciaAgora[p.numero] = true; });
      dadosGerais.forEach(d => {
        if (d && d.numero && !comPendenciaAgora[d.numero]) delete mapaPend[d.numero];
      });
      pendencias.forEach(p => {
        if (!p || !p.numero || !p.fim) return;
        mapaPend[p.numero] = {
          numero: p.numero, inicio: p.inicio || '', fim: p.fim, dias: p.dias || '',
          descricao: p.descricao || '', evento: p.evento || '', atualizadoEm: Date.now()
        };
      });
      dados.roboPendenciasPrazo = mapaPend;
    }

    const atualizadoEm = Date.now();
    await kvCmd(['SET', chave(codigo), JSON.stringify({ dados, atualizadoEm })]);
    res.status(200).json({ ok: true, recebidas: novas.length, ignoradas: movimentos.length - novas.length });
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
};
