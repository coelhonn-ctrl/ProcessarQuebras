import puppeteer from "puppeteer";
import path from "path";
import readline from "readline";
import fs from "fs";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import fse from "fs-extra";

// Importando suas classes de serviço e utilitários
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

// Configuração de caminhos e diretórios
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÕES ---
const sessionId = "usuario_julia";
const userDataDir = path.join(__dirname, "sessions", sessionId);
const caminho_planilha = path.join(process.cwd(), "planilhas", "planilha.csv");
const urlSistema = "http://172.16.55.252:8080/siscobraweb/servlet/hbranco";
const totalTelas = 1; // Quantidade de bots rodando simultaneamente

// Interface para pausar o terminal e aguardar ação do usuário
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const esperarEnter = () =>
  new Promise((resolve) => rl.question("", () => resolve()));

(async () => {
  console.log("🚀 Iniciando sistema...");

  // 1️⃣ CARREGA PLANILHA
  const clientes = [];
  console.log(`📂 Procurando planilha em: ${caminho_planilha}`);

  try {
    if (!fs.existsSync(caminho_planilha)) {
      throw new Error(
        `Arquivo não encontrado! Verifique se ele está em: ${caminho_planilha}`,
      );
    }

    await new Promise((resolve, reject) => {
      fs.createReadStream(caminho_planilha)
        .pipe(csv({ separator: ";" }))
        .on("data", (linha) => {
          const objetoLimpo = {};
          for (const key in linha) objetoLimpo[key.trim()] = linha[key];
          clientes.push(objetoLimpo);
        })
        .on("end", () => {
          if (clientes.length === 0)
            return reject(new Error("Planilha vazia!"));
          console.log(`✅ Planilha carregada: ${clientes.length} registros.`);
          resolve();
        })
        .on("error", (err) => reject(err));
    });
  } catch (error) {
    console.error("💥 Erro ao carregar dados:", error.message);
    process.exit(1);
  }

  // 2️⃣ LOGIN MANUAL
  const browserLogin = await puppeteer.launch({
    headless: false,
    executablePath: "/usr/bin/google-chrome",
    userDataDir,
    args: ["--start-maximized"],
  });

  const pageLogin = await browserLogin.newPage();
  await pageLogin.goto(urlSistema);

  console.log("🔐 Faça o login e pressione ENTER no terminal...");
  await esperarEnter();

  const cookiesSalvos = await pageLogin.cookies();
  await browserLogin.close();

  // 3️⃣ FUNÇÃO DE PROCESSAMENTO (mantida 100% igual)
  async function processarDados(page, listaClientes, idBot) {
    const local = new Local();
    const acoes = new Escrever();
    const servicoAcordo = new Acordo();

    for (const cliente of listaClientes) {
      const inicioDate = new Date();
      const inicio = performance.now();

      try {
        if (!cliente.codigo_cliente) continue;
        console.log(`[Bot ${idBot}] ⏳ Iniciando: ${cliente.nome_cliente}`);

        await local.pesquisar(page);
        await acoes.escreverCodigo(page, String(cliente.codigo_cliente));
        await local.botaoPesquisar(page);

        await new Promise((r) => setTimeout(r, 1500));
        await local.primeiroCliente(page);
        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
          .catch(() => {});

        const [umAcordo, el, frameAcordo] = await servicoAcordo.haQuantos(page);
        if (umAcordo) {
          await local.noCodigo(frameAcordo, el);
          await new Promise((r) => setTimeout(r, 2000));
        }

        console.log(`[Bot ${idBot}] Tentando abrir a tela de boletos...`);
        const btnBoleto = await rastreador(page, "span#BOLETO a");
        if (!btnBoleto) throw new Error("Link 'Boleto' não localizado.");

        await btnBoleto.handle.click();
        await new Promise((r) => setTimeout(r, 4000));

        const tabela = await rastreadorPotente(page, "table#GRID_BOLETO");
        if (!tabela?.handle)
          throw new Error("GRID_BOLETO encontrada, mas sem handle válido.");

        const tabela_objeto = await servicoAcordo.extrairDadosGridAdaptado(
          tabela.handle,
        );

        let linha_certa = await servicoAcordo.verificar_data_de_vencimento(
          tabela_objeto,
          cliente.vencimento || cliente.data_vencimento,
        );

        if (linha_certa === -1)
          throw new Error("Vencimento não encontrado no GRID.");

        if (linha_certa.status !== "Ativo")
          throw new Error(
            `Boleto INATIVO (Vencimento: ${linha_certa.vencimento}).`,
          );

        const botaoImpressao =
          await local.prucarardentrodeumelementosuandoumseletor(
            linha_certa.elementHandle,
            '[id^="_BOLETO_IMP2V"]',
          );

        if (!botaoImpressao)
          throw new Error("Botão de impressão não encontrado.");

        await botaoImpressao.click();
        await new Promise((r) => setTimeout(r, 3000));

        const clicoutudo = await clicarcomvarreduracompleta(page, [
          'input[name="BTN_SELECIONAR_TUDO"]',
        ]);

        const clicou = await clicarcomvarreduracompleta(page, [
          'input[name="BTN_BOLETO_PDF"]',
        ]);

        if (!clicoutudo) throw new Error("BTN_SELECIONAR_TUDO não encontrado.");

        if (!clicou) throw new Error("BTN_BOLETO_PDF não encontrado.");

        await new Promise((r) => setTimeout(r, 1500));
        await page.reload({ waitUntil: "networkidle2" });

        const btnBoleto2 = await rastreador(page, "span#BOLETO a");
        await btnBoleto2.handle.click();
        await new Promise((r) => setTimeout(r, 4000));

        const tabela2 = await rastreadorPotente(page, "table#GRID_BOLETO");
        const tabela_objeto2 = await servicoAcordo.extrairDadosGridAdaptado(
          tabela2.handle,
        );

        linha_certa = await servicoAcordo.verificar_data_de_vencimento(
          tabela_objeto2,
          cliente.vencimento || cliente.data_vencimento,
        );

        if (!linha_certa?.elementHandle)
          throw new Error("Linha encontrada sem elementHandle.");

        const span = await local.prucarardentrodeumelementosuandoumseletor(
          linha_certa.elementHandle,
          '[id^="span__CAMINHOBOLETO"]',
        );

        if (!span) throw new Error("Span do caminho do boleto não encontrado.");

        const anchor = await span.$("a");
        if (!anchor) throw new Error("Tag <a> não encontrada dentro do span.");

        let caminhoRelativo = null;
        let tentativas = 0;

        while (!caminhoRelativo && tentativas < 5) {
          caminhoRelativo = await anchor.evaluate((el) =>
            el.textContent.trim(),
          );

          if (!caminhoRelativo) {
            console.log(`[Bot ${idBot}] ⏳ Aguardando geração do PDF...`);
            await new Promise((r) => setTimeout(r, 1500));
            tentativas++;
          }
        }

        if (!caminhoRelativo) {
          throw new Error("PDF não foi gerado a tempo.");
        }

        const urlFinal =
          "http://172.16.55.252:8080/siscobraweb" +
          caminhoRelativo.replace("..", "");

        console.log("✅ URL final:", urlFinal);

        const outputPath = path.resolve(
          __dirname,
          "downloads",
          `${cliente.codigo_cliente}.pdf`,
        );

        await downloadPDF(urlFinal, outputPath);
        console.log("✅ PDF baixado com sucesso:", outputPath);

        await acoes.escreverTextoSeguro(
          page,
          "textarea#_RETACA",
          "encaminhado boleto via whatsapp",
        );

        const data_agenda = doisDiasUteisAtras(cliente.data_vencimento);
        await acoes.escreverTextoSeguro(page, "input#_RETDATAGE", data_agenda);

        await page.keyboard.press("Tab");
        await new Promise((r) => setTimeout(r, 500));

        const elemento_select = await page.$('select[name="_SITCOMCOD"]');
        if (elemento_select) {
          await elemento_select.select("58");
        }

        console.log("🔍 Confirmando registro...");

        await page.click('input[name="BTN_CONFIRMAR"][value="Confirmar"]');

        await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        console.log("✅ Navegação detectada após confirmação.");
        const fim = performance.now();

        appendCsvRow(
          {
            vencimento: cliente.vencimento,
            cliente: cliente.codigo_cliente,
            inicio: inicioDate.toISOString(),
            fim: new Date().toISOString(),
            tempoMs: (fim - inicio).toFixed(2),
            status: "OK",
          },
          "tempo_por_processo_08_08.csv",
        );

        console.log(`⏱️ Tempo: ${(fim - inicio).toFixed(2)} ms`);
        console.log("====================================================");
      } catch (error) {
        console.error(
          `❌ Erro ao processar cliente ${cliente.codigo_cliente}:`,
          error.message,
        );

        appendCsvRow(
          {
            vencimento: cliente.vencimento,
            cliente: cliente.codigo_cliente,
            inicio: new Date().toISOString(),
            fim: new Date().toISOString(),
            tempoMs: 0,
            status: "ERRO",
          },
          "tempo_por_processo_08_08.csv",
        );
      }
    }
  }

  // 4️⃣ GERENCIAMENTO POR ABAS (UM CHROME, VÁRIAS ABAS INDEPENDENTES)

  console.log(`🚀 Preparando ${totalTelas} abas independentes...`);

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "/usr/bin/google-chrome",
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  const instancias = [];
  const fatia = Math.ceil(clientes.length / totalTelas);

  for (let i = 0; i < totalTelas; i++) {
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`⏳ Inicializando aba ${i + 1}...`);

    await page.goto(urlSistema, {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    instancias.push({
      page,
      lista: clientes.slice(i * fatia, (i + 1) * fatia),
      id: i + 1,
    });

    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("🟢 Todas as abas prontas. Iniciando bots...");

  await Promise.all(
    instancias.map((b) => processarDados(b.page, b.lista, b.id)),
  );

  console.log("🧹 Fechando navegador...");

  await browser.close();

  console.log("✅ Fim do processamento.");
  process.exit(0);
})();
