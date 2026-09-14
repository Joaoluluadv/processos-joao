// Vercel Serverless Function — consulta o DJEN (Diário de Justiça Eletrônico
// Nacional, CNJ) pela OAB do advogado e devolve as comunicações com o teor
// integral. Rota: POST /api/djen
//
// Body: { "oab": "131339", "uf": "PR", "dias": 7 }
// Resposta: { consultados, encontradas, comunicacoes: [...], ultimas: { numero: {...} } }
//
// Fonte: API pública Comunica/DJEN — não exige chave. É a mesma base oficial
// em que a intimação é disponibilizada, por isso não há defasagem: o que está
// no DJEN de hoje é o que abre prazo.

const BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

function limparHtml(s) {
  return String(s || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function diaISO(d) { return d.toISOString().slice(0, 10); }

function primeiro() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function normalizar(it) {
  const teor = limparHtml(primeiro(it.texto, it.teor, it.conteudo, it.textoComunicacao));
  const tipoComunicacao = String(primeiro(it.tipoComunicacao, it.tipo_comunicacao, it.tipoAto, '')).trim();
  const tipoDocumento = String(primeiro(it.tipoDocumento, it.tipo_documento, it.nomeClasse, '')).trim();
  const titulo = [tipoComunicacao, tipoDocumento].filter(Boolean).join(' — ') || 'Comunicação';
  const numeroMask = String(primeiro(it.numeroprocessocommascara, it.numeroProcessoComMascara, it.numero_processo, it.numeroProcesso, ''));
  return {
    numero: numeroMask,
    numeroDigitos: soDigitos(numeroMask),
    data: String(primeiro(it.data_disponibilizacao, it.dataDisponibilizacao, it.datadisponibilizacao, '')).slice(0, 10),
    texto: titulo,
    teor: teor,
    tipoComunicacao: tipoComunicacao,
    tipoDocumento: tipoDocumento,
    orgao: String(primeiro(it.nomeOrgao, it.nome_orgao, it.orgao, '')).trim(),
    tribunal: String(primeiro(it.siglaTribunal, it.sigla_tribunal, it.tribunal, '')).trim(),
    meio: String(primeiro(it.meiocompleto, it.meioCompleto, it.meio, '')).trim(),
    link: String(primeiro(it.link, it.linkDocumento, '')).trim(),
    id: String(primeiro(it.id, it.hash, '') || ('h' + hash(numeroMask + '|' + teor)))
  };
}

// identificador estável quando o DJEN não manda id — duas intimações no mesmo
// processo e no mesmo dia precisam de chaves diferentes para não se anularem
function hash(s) {
  let h = 5381;
  const t = String(s);
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function paginar(params) {
  const itens = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const qs = new URLSearchParams(Object.assign({}, params, { pagina: String(pagina), itensPorPagina: '100' }));
    const resp = await fetch(BASE + '?' + qs.toString(), { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('DJEN respondeu ' + resp.status);
    const json = await resp.json();
    const lote = (json && (json.items || json.content || json.dados)) || [];
    itens.push(...lote);
    if (lote.length < 100) break;
  }
  return itens;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Use POST com { oab, uf, dias }' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const oab = soDigitos(body && body.oab);
  const uf = String((body && body.uf) || 'PR').toUpperCase().slice(0, 2);
  const dias = Math.min(Math.max(Number((body && body.dias) || 7), 1), 90);

  if (!oab) { res.status(400).json({ erro: 'Informe o número da OAB' }); return; }

  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 86400000);

  try {
    const brutos = await paginar({
      numeroOab: oab,
      ufOab: uf,
      dataDisponibilizacaoInicio: diaISO(inicio),
      dataDisponibilizacaoFim: diaISO(fim)
    });

    const comunicacoes = brutos.map(normalizar).filter(c => c.data);
    comunicacoes.sort((a, b) => String(b.data).localeCompare(String(a.data)));

    const ultimas = {};
    for (const c of comunicacoes) {
      if (!ultimas[c.numero]) ultimas[c.numero] = c;
    }

    res.status(200).json({
      oab, uf, dias,
      periodo: { inicio: diaISO(inicio), fim: diaISO(fim) },
      encontradas: comunicacoes.length,
      ultimas,
      comunicacoes: comunicacoes.slice(0, 200)
    });
  } catch (e) {
    res.status(502).json({ erro: 'Não foi possível consultar o DJEN: ' + String(e.message || e) });
  }
};
