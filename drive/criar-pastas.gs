/**
 * Cria no Google Drive uma pasta por processo e devolve a lista pronta para
 * colar no site, em Importar → "Pastas do Google Drive em lote".
 *
 * Como usar
 * ---------
 * 1. Abra https://script.google.com e crie um projeto novo.
 * 2. Apague o conteúdo do editor e cole este arquivo inteiro.
 * 3. No site, aba Importar, clique em "Copiar lista dos processos" e cole o
 *    resultado dentro da constante LISTA, logo abaixo.
 * 4. Confira PASTA_MAE (a pasta do Meu Drive onde tudo vai ficar).
 * 5. Clique em Executar. Na primeira vez o Google pede autorização — é a sua
 *    própria conta autorizando o seu próprio script.
 * 6. Terminando, abra "Registro de execução" e copie a lista que aparece lá.
 *    Ela também fica salva no arquivo "pastas-para-o-site.txt", dentro da
 *    pasta mãe. Cole essa lista no site e clique em "Ligar pastas".
 *
 * Rodar de novo é seguro: pasta que já existe é reaproveitada, não duplicada.
 */

// Pasta do Meu Drive que guarda todas as pastas de processo.
const PASTA_MAE = 'Processos';

// Uma linha por processo: número do processo e, depois do travessão, o nome.
// É exatamente o que o botão "Copiar lista dos processos" põe na área de
// transferência — basta colar entre as crases.
const LISTA = `
0001186-43.2022.8.16.0074 — FLÁVIO TOZZO x GABRIEL DA SILVA
0002483-41.2025.8.16.0087 — MINISTÉRIO PÚBLICO x VINICIUS
`;

function criarPastas() {
  const mae = acharOuCriarNaRaiz(PASTA_MAE);
  const linhas = [];
  let criadas = 0;
  let reaproveitadas = 0;

  LISTA.split('\n').map(l => l.trim()).filter(Boolean).forEach(linha => {
    const numero = (linha.match(/\d[\d.\-]{13,}/) || [''])[0];
    if (!numero) {
      Logger.log('IGNORADA (sem número de processo): ' + linha);
      return;
    }
    // O nome é o que vem depois do número, sem o travessão/hífen de separação.
    const nome = linha.replace(numero, '').replace(/^[\s—–\-;|]+/, '').replace(/[\s—–\-;|]+$/, '').trim();
    const nomePasta = nome ? numero + ' - ' + limpar(nome) : numero;

    const achada = mae.getFoldersByName(nomePasta);
    let pasta;
    if (achada.hasNext()) { pasta = achada.next(); reaproveitadas++; }
    else { pasta = mae.createFolder(nomePasta); criadas++; }

    linhas.push(numero + '\t' + pasta.getUrl());
  });

  const saida = linhas.join('\n');
  Logger.log('Pastas criadas: %s · já existentes: %s', criadas, reaproveitadas);
  Logger.log('--- copie daqui para baixo e cole no site ---\n' + saida);
  salvarTxt(mae, 'pastas-para-o-site.txt', saida);
  return saida;
}

function acharOuCriarNaRaiz(nome) {
  const achada = DriveApp.getRootFolder().getFoldersByName(nome);
  return achada.hasNext() ? achada.next() : DriveApp.createFolder(nome);
}

// O Drive aceita quase tudo em nome de pasta, mas barra e contrabarra
// atrapalham na hora de procurar — troca por hífen.
function limpar(texto) {
  return String(texto).replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ').trim();
}

function salvarTxt(pasta, nome, conteudo) {
  const achado = pasta.getFilesByName(nome);
  if (achado.hasNext()) { achado.next().setContent(conteudo); return; }
  pasta.createFile(nome, conteudo, MimeType.PLAIN_TEXT);
}
