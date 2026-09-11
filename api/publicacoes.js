// Vercel Serverless Function — consulta o DataJud (CNJ) e devolve as movimentações
// dos processos informados. Rota: POST /api/publicacoes
//
// Body: { "tribunal": "TJPR", "processos": ["0001011-08.2024.8.16.0065", ...] }
// Resposta: { tribunal, consultados, movimentacoes: [{ numero, data, texto, codigo }] }
//
// A chave pública do DataJud é publicada pelo CNJ. Para trocá-la, defina a
// variável de ambiente DATAJUD_API_KEY no painel da Vercel.

const INDICES = {
  TJPR: 'api_publica_tjpr',
  TJSP: 'api_publica_tjsp',
  TJSC: 'api_publica_tjsc',
  TJRS: 'api_publica_tjrs',
  TJMG: 'api_publica_tjmg',
  TRF4: 'api_publica_trf4',
  TRT9: 'api_publica_trt9'
};

const CHAVE = process.env.DATAJUD_API_KEY ||
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

function dataISO(dataHora) {
  if (!dataHora) return null;
  return String(dataHora).slice(0, 10);
}

async function consultar(indice, numero) {
  const url = 'https://api-publica.datajud.cnj.jus.br/' + indice + '/_search';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'APIKey ' + CHAVE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: 1, query: { match: { numeroProcesso: soDigitos(numero) } } })
  });
  if (!resp.ok) throw new Error('DataJud respondeu ' + resp.status);
  const json = await resp.json();
  const hit = json && json.hits && json.hits.hits && json.hits.hits[0];
  if (!hit) return [];
  const src = hit._source || {};
  const orgao = (src.orgaoJulgador && src.orgaoJulgador.nome) || src.tribunal || '';
  return (src.movimentos || []).map(m => ({
    numero,
    data: dataISO(m.dataHora),
    texto: m.nome || 'Movimentação',
    codigo: m.codigo || null,
    orgao
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Use POST com { tribunal, processos: [] }' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const tribunal = (body && body.tribunal) || 'TJPR';
  const processos = ((body && body.processos) || []).filter(Boolean).slice(0, 25);
  const indice = INDICES[tribunal];

  if (!indice) { res.status(400).json({ erro: 'Tribunal não mapeado: ' + tribunal }); return; }
  if (!processos.length) { res.status(400).json({ erro: 'Nenhum processo informado' }); return; }

  const movimentacoes = [];
  const falhas = [];
  for (const numero of processos) {
    try {
      const movs = await consultar(indice, numero);
      movimentacoes.push(...movs);
    } catch (e) {
      falhas.push({ numero, erro: String(e.message || e) });
    }
  }

  movimentacoes.sort((a, b) => String(b.data).localeCompare(String(a.data)));

  // Última movimentação de cada processo — o site usa isso na coluna MOVIMENTAÇÃO.
  const ultimas = {};
  for (const m of movimentacoes) {
    if (!ultimas[m.numero]) ultimas[m.numero] = { data: m.data, texto: m.texto, codigo: m.codigo };
  }

  res.status(200).json({
    tribunal,
    consultados: processos.length,
    encontradas: movimentacoes.length,
    falhas,
    ultimas,
    movimentacoes: movimentacoes.slice(0, 200)
  });
};
