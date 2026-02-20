import fs from "fs-extra";
import path from "path";
import http from "http";
import https from "https";

// Funções puras: Recebem dados, devolvem resultados. Sem misturar com a classe Local.
export async function localizarNoFrame(parent, selector) {
  const element = await parent.$(selector);
  if (element) return { handle: element, frame: parent };

  for (const child of parent.childFrames()) {
    const result = await localizarNoFrame(child, selector); // Recursão limpa
    if (result) return result;
  }
  return null;
}

/**
 * Localiza um elemento em qualquer profundidade de iframe com Retentativas.
 * Ideal para sistemas que injetam iframes dinamicamente.
 */
export async function localizarNoFrameComPaciencia(
  page,
  selector,
  timeout = 10000,
) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // Pega todos os frames atuais da página (incluindo os recém-criados)
    const frames = page.frames();

    for (const frame of frames) {
      try {
        const element = await frame.$(selector);
        if (element) {
          // Verifica se o elemento está visível/clicável
          return { elementHandle: element, frame: frame };
        }
      } catch (e) {
        // Ignora erros de frames que foram destruídos durante a busca
        continue;
      }
    }

    // Espera 500ms antes de tentar de novo em todos os frames
    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}

export async function rastreador(page, selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await localizarNoFrame(page.mainFrame(), selector);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function scannerSiscobra(parent, selector) {
  // 1. Tenta achar no nível atual
  const element = await parent.$(selector);
  if (element) {
    // "Acorda" o elemento antes de retornar
    await parent.evaluate((el) => {
      el.scrollIntoView();
      el.dispatchEvent(new Event("mousemove", { bubbles: true }));
    }, element);
    return { handle: element, frame: parent };
  }

  // 2. "Destrava" o frame atual para carregar o que está oculto
  await parent
    .evaluate(() => {
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new Event("DOMContentLoaded"));
    })
    .catch(() => {});

  // 3. Mergulha nos filhos (Recursão)
  for (const child of parent.childFrames()) {
    const result = await scannerSiscobra(child, selector);
    if (result) return result;
  }
  return null;
}

// O seu rastreador agora usa o scanner potente por baixo
export async function rastreadorPotente(page, selector, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await scannerSiscobra(page.mainFrame(), selector);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export async function clicarcomvarreduracompleta(page, seletores) {
  let elementoEncontrado = null;

  for (const seletor of seletores) {
    try {
      const res = await localizarNoFrameComPaciencia(page, seletor);
      if (res && res.elementHandle) {
        elementoEncontrado = res;
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (elementoEncontrado) {
    const { elementHandle, frame } = elementoEncontrado;

    const html = await elementHandle.evaluate(el => el.outerHTML);
    console.log(`[Bot] HTML do botão: ${html.substring(0, 60)}...`);

    await elementHandle.evaluate(el => el.click());

    console.log("🖱️ Clique realizado com sucesso.");

    await new Promise(r => setTimeout(r, 2000));

    return elementoEncontrado;
  }

  return null;
}

export async function downloadPDF(url, outputPath) {
  const proto = url.startsWith("https") ? https : http;
  const file = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    proto
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject(
            new Error("Falha ao baixar PDF, status: " + response.statusCode),
          );
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        fs.unlink(outputPath, () => reject(err));
      });
  });
}

export function doisDiasUteisAtras(dataISO) {
  // Converte string 'YYYY-MM-DD' para Date
  let data = new Date(dataISO);

  let diasUteis = 0;

  while (diasUteis < 2) {
    data.setDate(data.getDate() - 1); // retrocede 1 dia
    const diaSemana = data.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) {
      // ignora domingo (0) e sábado (6)
      diasUteis++;
    }
  }

  // Ajusta se cair em final de semana
  const diaSemana = data.getDay();
  if (diaSemana === 0) data.setDate(data.getDate() - 2); // domingo -> sexta
  if (diaSemana === 6) data.setDate(data.getDate() - 1); // sábado -> sexta

  // Formata para DD/MM/YYYY
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const ano = data.getFullYear();

  return `${dia}/${mes}/${ano}`;
}

export function formatarDataParaBR(dataISO) {
  // Recebe "2026-12-01" e retorna "01/12/2026"
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function appendCsvRow(rowObj, csvFilePath = "tempo_por_processo.csv") {
  const fileExists = fs.existsSync(csvFilePath);
  const rowValues = Object.values(rowObj).map(
    (v) => `"${String(v).replace(/"/g, '""')}"`,
  );
  const row = rowValues.join(",") + "\n";

  if (!fileExists) {
    const header = Object.keys(rowObj).join(",") + "\n";
    fs.writeFileSync(csvFilePath, header + row);
  } else {
    fs.appendFileSync(csvFilePath, row);
  }
}
