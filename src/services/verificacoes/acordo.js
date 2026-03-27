import { rastreador } from "../util/utils.js";

export class Acordo {
  async haQuantos(frame, codigoAlvo) {
    // Busca direto todos os spans de código
    const spans = await frame.$$('[id^="span__CONPARACOCOD_"]');

    for (const span of spans) {
      const codigo = await span.evaluate((el) => el.textContent.trim());

      if (codigo === codigoAlvo) {
        // Pega a linha da tabela direto
        const linha = await span.evaluateHandle((el) => el.closest("tr"));

        return [true, span, frame];
      }
    }

    return [false, null, null];
  }

  // async haQuantos(page) {
  //   const seletor = 'span[id^="span__CONPARACOCOD_"]';

  //   // 1. Usa o rastreador único (reutilização de código!)
  //   const alvo = await rastreador(page, seletor, 8000);

  //   if (!alvo) {
  //     console.log("⚠️ Nenhum acordo listado para este cliente.");
  //     return [false, null, null];
  //   }

  //   const { frame } = alvo;

  //   try {
  //     // 2. Lógica de validação atômica dentro do frame correto
  //     const resultado = await frame.evaluate((sel) => {
  //       const spans = Array.from(document.querySelectorAll(sel));
  //       if (spans.length === 0) return null;

  //       const textos = spans.map((s) => s.textContent.trim());
  //       const primeiro = textos[0];
  //       // Verifica se todos os códigos de acordo na tela são o mesmo
  //       const todosIguais = textos.every((t) => t === primeiro);

  //       return {
  //         umAcordo: todosIguais,
  //         total: textos.length,
  //         codigo: primeiro,
  //       };
  //     }, seletor);

  //     if (resultado?.umAcordo) {
  //       console.log(
  //         `✅ Acordo único detectado: ${resultado.codigo} (${resultado.total} linhas).`,
  //       );
  //       const elementos = await frame.$$(seletor);
  //       return [true, elementos[0], frame];
  //     }

  //     console.log(`⚠️ Múltiplos acordos ou lista vazia.`);
  //     return [false, null, null];
  //   } catch (err) {
  //     console.error("❌ Erro ao validar grid de acordos:", err.message);
  //     return [false, null, null];
  //   }
  // }

  // Transformamos em um método de instância para manter o padrão
  async buscarBotaoBoletoPorData(frame, dataAlvo) {
    return await frame.evaluate((vencimento) => {
      const alvo = vencimento.trim();
      const celulas = Array.from(document.querySelectorAll("td, span"));

      // 1. Encontra a célula que tem a data exata
      const celulaData = celulas.find((c) => c.textContent.trim() === alvo);

      if (!celulaData) return null;

      // 2. Sobe até a linha (TR) para não confundir com boletos de outras datas
      const linha = celulaData.closest("tr");
      if (!linha) return null;

      // 3. Busca o botão de imprimir especificamente desta linha
      // Procuramos por links que contenham "BOLIMP" ou ícones de impressora
      const btn = linha.querySelector(
        'a[id*="BOLIMP"], a[id*="IMP"], img[id*="IMP"], a[onclick*="Impressao"]',
      );

      if (btn) {
        // Se o botão não tiver ID (raro no Siscobra), criamos um
        if (!btn.id)
          btn.id = "click_boleto_" + Math.floor(Math.random() * 1000);
        console.log(
          `👀 Achei o botão de impressão: ${btn.id} para a data ${alvo}`,
        );
        return btn.id;
      }

      return null;
    }, dataAlvo);
  }

  async extrairDadosGridAdaptado(tabelaHandle) {
    if (!tabelaHandle)
      throw new Error("Handle da tabela não fornecido para extração.");

    const dados = await tabelaHandle.evaluate((tabela) => {
      const linhas = Array.from(tabela.querySelectorAll("tbody tr"));

      return linhas.map((linha, index) => {
        const tds = Array.from(linha.querySelectorAll("td"));

        const getValue = (selector, tdIndex) => {
          const el = linha.querySelector(selector);
          if (el) {
            if (el.tagName === "INPUT") return el.value || "";
            if (el.tagName === "A") return el.href || "";
            return el.textContent.trim();
          }
          if (typeof tdIndex === "number" && tds[tdIndex]) {
            return tds[tdIndex].textContent.trim();
          }
          return "";
        };

        return {
          index,
          tipoEnvio: getValue('span[id^="span__BOLTIPENV_"]', 0),
          dataDocumento: getValue('span[id^="span__BOLDATDOC_"]', 4),
          vencimento: getValue('span[id^="span__BOLDATVEN_"]', 5),
          numeroDocumento: getValue('span[id^="span__BOLNUMDOC_"]', 6),
          parcela: getValue('span[id^="span__BOLPARCELA_"]', 7),
          valorDocumento: getValue('span[id^="span__BOLVALDOC_"]', 8),
          boleto: getValue('span[id^="span__BOLETO_"]', 9),
          cedente: getValue('span[id^="span__CEDENTE_"]', 10),
          sequencia: getValue('span[id^="span__BOLSEQ_"]', 11),
          controle: getValue('span[id^="span__BOLCONTROLE_"]', 12),
          nossoNumero: getValue('span[id^="span__BOLNOSSONUMERO_"]', 13),
          boletoImp: getValue('span[id^="span__BOLIMP_"]', 15),
          status: getValue('span[id^="span__BOLSTATUS_"]', 17),
          email: getValue('span[id^="span__BOLEMAIL_"]', 18),
          sms: getValue('span[id^="span__BOLSMS_"]', 19),
          ativoInativo: getValue('span[id^="span__BOLAI_"]', 22),
          registro: getValue('span[id^="span__BOLREGISTRO_"]', 24),
          retornoBanco: getValue('span[id^="span__BOLRETBANCO_"]', 25),
          linkExterno: getValue('a[id^="link__BOLEXTERNO_"]', 34),
        };
      });
    });

    // Esta parte associa o elemento físico da linha para podermos clicar depois
    const linhasHandles = await tabelaHandle.$$("tbody tr");
    for (let i = 0; i < dados.length; i++) {
      dados[i].elementHandle = linhasHandles[i];
    }

    return dados;
  }

  async verificar_data_de_vencimento(tabela_objeto, vencimento) {
    // 1. Formata a data (manteve sua lógica segura)
    const formatarData = (data) => {
      if (!data || typeof data !== "string") return "";
      const [ano, mes, dia] = data.split("-");
      return `${dia.padStart(2, "0")}/${mes.padStart(2, "0")}/${ano.padStart(4, "0")}`;
    };

    const vencimentoFormatado = formatarData(vencimento);
    let linhaInativaEncontrada = null;

    // 2. Processamento em memória (Não usa await aqui dentro, é instantâneo)
    for (let i = 0; i < tabela_objeto.length; i++) {
      const linha = tabela_objeto[i];

      if (linha.vencimento === vencimentoFormatado) {
        if (linha.status === "Ativo") {
          return linha; // Achou o melhor cenário, para o loop.
        }
        if (!linhaInativaEncontrada) {
          linhaInativaEncontrada = linha; // Guarda o reserva.
        }
      }
    }

    // 3. Retorno final
    return linhaInativaEncontrada || -1;
  }
}
