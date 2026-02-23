import puppeteer from "puppeteer";
import path from "path";
import readline from "readline";
import fs from "fs";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

// Importando serviços
import { Local } from "./services/Selecionar/OndeClicar.js";
import { Escrever } from "./services/Selecionar/OqueEscrever.js";
import { Acordo } from "./services/verificacoes/acordo.js";
import {
  clicarcomvarreduracompleta,
  rastreador,
  rastreadorPotente,
  downloadPDF,
  doisDiasUteisAtras,
  appendCsvRow,
} from "./services/util/utils.js";

const logSucesso = "processados.txt";
const processados = fs.existsSync(logSucesso)
  ? fs.readFileSync(logSucesso, "utf8").split(/\r?\n/).filter(Boolean)
  : [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÕES ---
const CONFIG = {
  sessionId: "usuario_julia",
  userDataDir: path.join(__dirname, "sessions", "usuario_julia"),
  caminhoPlanilha: path.join(process.cwd(), "planilhas", "planilha.csv"),
  urlSistema: "http://172.16.55.252:8080/siscobraweb/servlet/hbranco",
  totalTelas: 2, // 📉 Reduzi para 2 para evitar sobrecarga e timeouts
  chromePath: "/usr/bin/google-chrome",
  logCsv: "tempo_por_processo_08_08.csv",
};

// Garante que a pasta de downloads existe
if (!fs.existsSync(path.join(__dirname, "downloads"))) {
  fs.mkdirSync(path.join(__dirname, "downloads"));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const esperarEnter = () =>
  new Promise((resolve) => rl.question("", () => resolve()));

(async () => {
  console.log("🚀 [SISTEMA] Iniciando...");

  // 1️⃣ CARREGA PLANILHA
  const clientes = [];
  try {
    if (!fs.existsSync(CONFIG.caminhoPlanilha))
      throw new Error("Planilha não encontrada.");
    await new Promise((resolve, reject) => {
      fs.createReadStream(CONFIG.caminhoPlanilha)
        .pipe(csv({ separator: ";" }))
        .on("data", (linha) => {
          const obj = {};
          for (const key in linha) obj[key.trim()] = linha[key];
          clientes.push(obj);
        })
        .on("end", resolve)
        .on("error", reject);
    });
    console.log(`✅ [DADOS] ${clientes.length} registros carregados.`);
  } catch (error) {
    console.error("💥 [ERRO]", error.message);
    process.exit(1);
  }

  // 2️⃣ LOGIN MANUAL
  const browserLogin = await puppeteer.launch({
    headless: false,
    executablePath: CONFIG.chromePath,
    userDataDir: CONFIG.userDataDir,
    args: ["--start-maximized"],
  });
  const pageLogin = await browserLogin.newPage();
  await pageLogin.goto(CONFIG.urlSistema);
  console.log("🔐 [LOGIN] Faça o login e pressione ENTER no terminal...");
  await esperarEnter();
  await browserLogin.close();

  // 3️⃣ FUNÇÃO DE PROCESSAMENTO
  async function processarDados(page, listaClientes, idBot) {
    const local = new Local();
    const acoes = new Escrever();
    const servicoAcordo = new Acordo();

    for (const cliente of listaClientes) {
      const idAtual = String(cliente.codigo_cliente).trim();

      // Verifica se já foi processado (usando a lista carregada no início)
      if (processados.map((id) => id.trim()).includes(idAtual)) {
        console.log(
          `[Bot ${idBot}] ⏩ [PULANDO] ${idAtual} já foi processado.`,
        );
        continue;
      }

      if (!cliente.codigo_cliente) continue;
      const inicioDate = new Date();
      const t_inicio = performance.now();

      try {
        console.log(`[Bot ${idBot}] ⏳ Processando: ${cliente.codigo_cliente}`);

        // 🔄 LIMPEZA DE ESTADO: Se não estiver na tela de pesquisa, força a volta
        // Isso evita que o erro de um cliente trave o próximo
        if (!page.url().includes("hbranco")) {
          await page.goto(CONFIG.urlSistema, { waitUntil: "networkidle2" });
        }

        // Pesquisa e Ficha
        await local.pesquisar(page);
        await acoes.escreverCodigo(page, idAtual);
        await local.botaoPesquisar(page);

        await new Promise((r) => setTimeout(r, 2000));
        await local.primeiroCliente(page);

        // Espera a ficha carregar com um timeout seguro
        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 8000 })
          .catch(() => {});

        const [umAcordo, el, frameAcordo] = await servicoAcordo.haQuantos(page);
        if (umAcordo) {
          await local.noCodigo(frameAcordo, el);
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Tela de Boletos
        const btnBoleto = await rastreador(page, "span#BOLETO a");
        if (!btnBoleto) throw new Error("Link 'Boleto' não localizado");
        await btnBoleto.handle.click();
        await new Promise((r) => setTimeout(r, 4000));

        const tabela = await rastreadorPotente(page, "table#GRID_BOLETO");
        await new Promise((r) => setTimeout(r, 1000));
        // Antes de extrair, garanta que o elemento da tabela realmente existe e está estável
        await page
          .waitForSelector("table#GRID_BOLETO", { timeout: 30000 })
          .catch(() => {});
        const tabela_objeto = await servicoAcordo.extrairDadosGridAdaptado(
          tabela.handle,
          { timeout: 120000 },
        );

        let linha = await servicoAcordo.verificar_data_de_vencimento(
          tabela_objeto,
          cliente.vencimento || cliente.data_vencimento,
        );

        if (linha === -1)
          throw new Error("Vencimento não encontrado na tabela");
        if (linha.status !== "Ativo")
          throw new Error(`Boleto com status: ${linha.status}`);

        const btnImpressao =
          await local.prucarardentrodeumelementosuandoumseletor(
            linha.elementHandle,
            '[id^="_BOLETO_IMP2V"]',
          );
        await btnImpressao.click();
        await new Promise((r) => setTimeout(r, 3000));

        // Impressão PDF
        await clicarcomvarreduracompleta(page, [
          'input[name="BTN_SELECIONAR_TUDO"]',
        ]);
        await clicarcomvarreduracompleta(page, [
          'input[name="BTN_BOLETO_PDF"]',
        ]);
        await new Promise((r) => setTimeout(r, 3000));

        // Captura do Link
        await page.reload({ waitUntil: "networkidle2" });
        const linkBoletoRecarga = await rastreador(page, "span#BOLETO a");
        await linkBoletoRecarga.handle.click();
        await new Promise((r) => setTimeout(r, 4000));

        const tabela2 = await rastreadorPotente(page, "table#GRID_BOLETO");
        const dadosNovos = await servicoAcordo.extrairDadosGridAdaptado(
          tabela2.handle,
        );
        linha = await servicoAcordo.verificar_data_de_vencimento(
          dadosNovos,
          cliente.vencimento || cliente.data_vencimento,
        );

        const span = await local.prucarardentrodeumelementosuandoumseletor(
          linha.elementHandle,
          '[id^="span__CAMINHOBOLETO"]',
        );
        const anchor = await span?.$("a");
        if (!anchor) throw new Error("Link do PDF não encontrado no span");

        let caminhoRelativo = null;
        for (let i = 0; i < 5; i++) {
          caminhoRelativo = await anchor.evaluate((el) =>
            el.textContent.trim(),
          );
          if (caminhoRelativo && caminhoRelativo.length > 5) break;
          await new Promise((r) => setTimeout(r, 3000));
        }

        if (!caminhoRelativo)
          throw new Error("Caminho do PDF não gerado a tempo");

        const urlFinal = `${CONFIG.urlSistema.split("/servlet")[0]}${caminhoRelativo.replace("..", "")}`;
        await downloadPDF(
          urlFinal,
          path.resolve(__dirname, "downloads", `${idAtual}.pdf`),
        );

        // Finalização (Histórico)
        await acoes.escreverTextoSeguro(
          page,
          "textarea#_RETACA",
          "encaminhado boleto via whatsapp",
        );
        await acoes.escreverTextoSeguro(
          page,
          "input#_RETDATAGE",
          doisDiasUteisAtras(cliente.data_vencimento),
        );

        await page.keyboard.press("Tab");
        await new Promise((r) => setTimeout(r, 1000));

        const select = await page.$('select[name="_SITCOMCOD"]');
        if (select) await select.select("58");

        await page.click('input[name="BTN_CONFIRMAR"][value="Confirmar"]');
        await page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
          .catch(() => {});

        const t_fim = performance.now();
        console.log(
          `✅ [SUCESSO] ${idAtual} em ${(t_fim - t_inicio).toFixed(2)}ms`,
        );

        // Grava no TXT para não repetir
        fs.appendFileSync(logSucesso, `${idAtual}\n`);
      } catch (error) {
        console.error(
          `❌ [ERRO Bot ${idBot}] ${cliente.codigo_cliente}: ${error.message}`,
        );

        // Se o erro for de Timeout ou comunicação, a aba pode ter "morrido"
        if (
          error.message.includes("timeout") ||
          error.message.includes("Navigation")
        ) {
          console.log(
            `[Bot ${idBot}] 🔄 Reiniciando aba para recuperar estabilidade...`,
          );
          await page.close().catch(() => {});
          page = await browser.newPage();

          // Reaplicar o bloqueio de imagens na aba nova!
          await page.setRequestInterception(true);
          page.on("request", (req) => {
            if (req.resourceType() === "image") req.abort();
            else req.continue();
          });

          await page.goto(CONFIG.urlSistema, { waitUntil: "networkidle2" });
        }
      }
    }
  }

  // 4️⃣ INICIALIZAÇÃO MULTI-ABA
  console.log(`🚀 [EXECUÇÃO] Abrindo ${CONFIG.totalTelas} aba(s)...`);
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: CONFIG.chromePath,
    userDataDir: CONFIG.userDataDir,
    protocolTimeout: 120000, // 2 minutos de paciência máxima
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-service-workers", // Evita processos de fundo que pesam
      '--js-flags="--max-old-space-size=4096"',
    ],
  });

  const tarefas = [];
  const fatia = Math.ceil(clientes.length / CONFIG.totalTelas);

  for (let i = 0; i < CONFIG.totalTelas; i++) {
    const page = await browser.newPage();
    // Bloqueia imagens para economizar memória e evitar timeouts
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.resourceType() === "image") req.abort();
      else req.continue();
    });

    await page.setViewport({ width: 1366, height: 768 }); // Resolução menor gasta menos memória
    await page.goto(CONFIG.urlSistema, {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    const lista = clientes.slice(i * fatia, (i + 1) * fatia);
    tarefas.push(processarDados(page, lista, i + 1));
    await new Promise((r) => setTimeout(r, 3000)); // Delay maior entre abertura de abas
  }

  await Promise.all(tarefas);
  await browser.close();
  console.log("🏁 [FIM] Processamento concluído.");
  process.exit(0);
})();
