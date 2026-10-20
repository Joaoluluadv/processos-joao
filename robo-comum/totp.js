// Leitura do segredo TOTP (Google Authenticator), compartilhada pelos robôs
// do Projudi e do EPROC — os dois pedem esse código na tela de login, e o
// jeito de guardar/ler o segredo é o mesmo nos dois. Não depende do otplib:
// só normaliza o texto do segredo; quem chama gera o código com o otplib que
// já tem instalado (authenticator.generate(segredo)).
//
// otplib/authenticator espera o segredo em base32. Algumas ferramentas de
// leitura de QR code mostram o segredo em hexadecimal (os mesmos bytes, outra
// codificação) — se vier assim, converte para base32 em vez de tentar usar
// hex direto, que geraria código sempre errado.
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

function validarSegredo(bruto) {
  if (/^[A-Z2-7]+=*$/.test(bruto)) return 'base32';
  if (bruto.length % 2 === 0 && /^[0-9A-F]+$/.test(bruto)) return 'hex';
  return null;
}

// Segredos colados no GitHub às vezes vêm com espaço/quebra de linha extra
// (ex.: copiado de um terminal), embutidos numa URI/trecho tipo "secret=XXXX"
// (o prefixo "otpauth://totp/...?" pode não estar presente se o texto foi
// cortado), ou num rótulo tipo "Chave secreta: XXXX XXXX" — tenta cada recorte
// possível e usa o primeiro que realmente validar como base32 ou hex.
function resolverSegredo(bruto) {
  const totpCru = String(bruto || '').trim();
  const totpMatchSecret = totpCru.match(/secret=([^&\s]+)/i);
  const totpMatchRotulo = totpCru.match(/:\s*(.+)$/);
  const candidatos = [
    { origem: 'trecho "secret=..."', valor: totpMatchSecret && decodeURIComponent(totpMatchSecret[1]) },
    { origem: 'trecho após "rótulo:"', valor: totpMatchRotulo && totpMatchRotulo[1] },
    { origem: 'texto original', valor: totpCru }
  ].filter(c => c.valor);

  let segredoBruto = '', tipo = null, origem = 'texto original';
  for (const c of candidatos) {
    const normalizado = c.valor.replace(/\s+/g, '').toUpperCase();
    const t = validarSegredo(normalizado);
    if (t) { segredoBruto = normalizado; tipo = t; origem = c.origem; break; }
  }
  if (!tipo) segredoBruto = (candidatos[0] ? candidatos[0].valor : totpCru).replace(/\s+/g, '').toUpperCase();

  const segredo = tipo === 'hex' ? hexParaBase32(segredoBruto) : segredoBruto;
  const formato = tipo
    ? `${origem} + ${tipo === 'hex' ? 'hex (convertido p/ base32)' : 'base32'}`
    : 'desconhecido — confira o segredo';

  return { segredo, formato, totpCru };
}

module.exports = { resolverSegredo, hexParaBase32, validarSegredo };
