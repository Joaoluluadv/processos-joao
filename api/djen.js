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
  const POR_PAGINA = 50;
  for (let pagina = 1; pagina <= 8; pagina++) {
    const qs = new URLSearchParams(Object.assign({}, params, { pagina: String(pagina), itensPorPagina: String(POR_PAGINA) }));
    const url = BASE + '?' + qs.toString();
    // o DJEN fica atrás de um WAF que rejeita cliente sem cara de navegador
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://comunica.pje.jus.br/',
        'Origin': 'https://comunica.pje.jus.br'
      }
    });
    const corpo = await resp.text();
    if (!resp.ok) {
      throw new Error('o DJEN respondeu ' + resp.status + (corpo ? ' — ' + corpo.slice(0, 180) : ''));
    }
    let json;
    try { json = JSON.parse(corpo); } catch (e) {
      throw new Error('o DJEN devolveu algo que não é JSON: ' + corpo.slice(0, 180));
    }
    const lote = (json && (json.items || json.content || json.dados)) || [];
    itens.push(...lote);
    if (lote.length < POR_PAGINA) break;
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

  // o tribunal grava a OAB com ou sem sufixo (123456, 123456-O…) e às vezes com
  // zeros à esquerda — tenta as variantes e junta o que vier
  const variantes = [oab];
  if (/^0+/.test(oab)) variantes.push(oab.replace(/^0+/, ''));

  try {
    const brutos = [];
    const erros = [];
    for (const v of variantes) {
      try {
        const lote = await paginar({
          numeroOab: v,
          ufOab: uf,
          dataDisponibilizacaoInicio: diaISO(inicio),
          dataDisponibilizacaoFim: diaISO(fim)
        });
        brutos.push(...lote);
      } catch (e) { erros.push(String(e.message || e)); }
    }
    if (!brutos.length && erros.length) throw new Error(erros[0]);

    const vistos = {};
    const comunicacoes = brutos.map(normalizar).filter(c => {
      if (!c.data) return false;
      if (vistos[c.id]) return false;
      vistos[c.id] = true;
      return true;
    });
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
