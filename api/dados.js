// Vercel Serverless Function — guarda/lê o estado do escritório na nuvem,
// para sincronizar o site entre computadores. Rota: /api/dados
//
// GET  /api/dados?codigo=XXXX        -> { ok, dados, atualizadoEm }
// POST /api/dados { codigo, dados }  -> { ok, atualizadoEm }
//
// Exige a integração "Vercel KV" (ou "Upstash Redis") no projeto na Vercel —
// ela injeta KV_REST_API_URL e KV_REST_API_TOKEN automaticamente, sem custo
// no plano gratuito. Sem essa integração a rota responde 501 e o site
// continua funcionando normalmente só no localStorage de cada aparelho.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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
  if (!URL || !TOKEN) {
    res.status(501).json({
      erro: 'Banco de dados não configurado. Na Vercel, adicione a integração "Vercel KV" (Storage → KV) ao projeto — isso ativa a sincronização entre computadores.'
    });
    return;
  }
  try {
    if (req.method === 'GET') {
      const codigo = req.query && req.query.codigo;
      if (!codigo) { res.status(400).json({ erro: 'Informe ?codigo=' }); return; }
      const bruto = await kvCmd(['GET', chave(codigo)]);
      if (!bruto) { res.status(404).json({ erro: 'Nenhum dado guardado para este código ainda' }); return; }
      const registro = JSON.parse(bruto);
      res.status(200).json({ ok: true, dados: registro.dados, atualizadoEm: registro.atualizadoEm });
      return;
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const codigo = body && body.codigo;
      const dados = body && body.dados;
      if (!codigo || !dados) { res.status(400).json({ erro: 'Informe { codigo, dados }' }); return; }

      // Faz merge em cima do que já está salvo, em vez de SET direto: o site só
      // conhece processos/publicacoes/eventos/integracao, mas o robô do Projudi
      // grava campos próprios (roboPendentes, roboDadosGerais) na mesma chave.
      // Um SET cego aqui apagaria qualquer atualização do robô que tivesse
      // chegado entre o site buscar os dados e salvar de volta.
      const bruto = await kvCmd(['GET', chave(codigo)]);
      const atual = bruto ? (JSON.parse(bruto).dados || {}) : {};
      const mesclado = Object.assign({}, atual, dados);

      const atualizadoEm = Date.now();
      await kvCmd(['SET', chave(codigo), JSON.stringify({ dados: mesclado, atualizadoEm })]);
      res.status(200).json({ ok: true, atualizadoEm });
      return;
    }
    res.status(405).json({ erro: 'Use GET ou POST' });
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
};
