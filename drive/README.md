# Pastas dos processos no Google Drive

O site guarda apenas o **endereço** da pasta de cada processo — os arquivos
ficam no Drive. Não há integração com o Google: nada de autorização, de conta
de serviço ou de armazenamento pago.

## Ligar a pasta de um processo

Na página do processo, aba **Documentos**:

- com link salvo, o botão abre a pasta direto;
- sem link salvo, o botão abre o Drive já buscando pelo número do processo;
- o campo abaixo aceita colar, trocar e remover o link.

Para pegar o link no Drive: botão direito na pasta → Compartilhar → Copiar link.

## Ligar muitas pastas de uma vez

Na aba **Importar**, seção "Pastas do Google Drive em lote". Cole uma linha por
processo, com o número e o link — a ordem dentro da linha não importa, e linhas
que sobrarem do copiar-e-colar (nome do cliente, ponto e vírgula) não atrapalham.

## Criar as pastas automaticamente

`criar-pastas.gs` é um Google Apps Script que roda **dentro da sua própria conta
do Drive**. Ele cria uma pasta por processo e devolve a lista de números e links
já no formato que a seção em lote espera. As instruções passo a passo estão no
cabeçalho do arquivo.

Rodar o script mais de uma vez é seguro: pasta que já existe é reaproveitada.
