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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÕES PARA API / CONTROLLER ---
const CONFIG = {
  sessionId: "usuario_julia",
  userDataDir: path.join(__dirname, "sessions", "usuario_julia"),
  caminhoPlanilha: path.join(process.cwd(), "planilhas", "planilha.csv"),
  urlSistema: "http://172.16.55.252:8080/siscobraweb/servlet/hbranco",
  totalTelas: 1,
  chromePath: "/usr/bin/google-chrome",
  logCsv: "tempo_por_processo_08_08.csv"
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const esperarEnter = () => new Promise((resolve) => rl.question("", () => resolve()));

(async () => {
  console.log("🚀 [SISTEMA] Iniciando...");

  // 1️⃣ CARREGA PLANILHA
  const clientes = [];
  try {
    if (!fs.existsSync(CONFIG.caminhoPlanilha)) throw new Error("Planilha não encontrada.");
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
      if (!cliente.codigo_cliente) continue;
      const inicioDate = new Date();
      const t_inicio = performance.now();

      try {
        console.log(`[Bot ${idBot}] ⏳ Processando: ${cliente.codigo_cliente}`);

        // Pesquisa e Ficha
        await local.pesquisar(page);
        await acoes.escreverCodigo(page, String(cliente.codigo_cliente));
        await local.botaoPesquisar(page);

        await new Promise((r) => setTimeout(r, 1500));
        await local.primeiroCliente(page);
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

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
        const tabela_objeto = await servicoAcordo.extrairDadosGridAdaptado(tabela.handle);
        let linha = await servicoAcordo.verificar_data_de_vencimento(tabela_objeto, cliente.vencimento || cliente.data_vencimento);

        if (linha === -1 || linha.status !== "Ativo") throw new Error("Boleto inválido/inativo");

        const btnImpressao = await local.prucarardentrodeumelementosuandoumseletor(linha.elementHandle, '[id^="_BOLETO_IMP2V"]');
        await btnImpressao.click();
        await new Promise((r) => setTimeout(r, 3000));

        // Impressão PDF
        await clicarcomvarreduracompleta(page, ['input[name="BTN_SELECIONAR_TUDO"]']);
        await clicarcomvarreduracompleta(page, ['input[name="BTN_BOLETO_PDF"]']);
        await new Promise((r) => setTimeout(r, 1500));

        // Captura do Link
        await page.reload({ waitUntil: "networkidle2" });
        await (await rastreador(page, "span#BOLETO a")).handle.click();
        await new Promise((r) => setTimeout(r, 4000));

        const tabela2 = await rastreadorPotente(page, "table#GRID_BOLETO");
        const dadosNovos = await servicoAcordo.extrairDadosGridAdaptado(tabela2.handle);
        linha = await servicoAcordo.verificar_data_de_vencimento(dadosNovos, cliente.vencimento || cliente.data_vencimento);

        const span = await local.prucarardentrodeumelementosuandoumseletor(linha.elementHandle, '[id^="span__CAMINHOBOLETO"]');
        const anchor = await span?.$("a");
        if (!anchor) throw new Error("Link do PDF não encontrado no span");

        let caminhoRelativo = null;
        for (let i = 0; i < 5; i++) {
          caminhoRelativo = await anchor.evaluate(el => el.textContent.trim());
          if (caminhoRelativo && caminhoRelativo.length > 5) break;
          await new Promise(r => setTimeout(r, 1500));
        }

        if (!caminhoRelativo) throw new Error("Caminho do PDF não gerado");

        const urlFinal = `${CONFIG.urlSistema.split('/servlet')[0]}${caminhoRelativo.replace("..", "")}`;
        await downloadPDF(urlFinal, path.resolve(__dirname, "downloads", `${cliente.codigo_cliente}.pdf`));

        // Finalização
        await acoes.escreverTextoSeguro(page, "textarea#_RETACA", "encaminhado boleto via whatsapp");
        await acoes.escreverTextoSeguro(page, "input#_RETDATAGE", doisDiasUteisAtras(cliente.data_vencimento));
        
        await page.keyboard.press("Tab");
        await new Promise(r => setTimeout(r, 500));

        const select = await page.$('select[name="_SITCOMCOD"]');
        if (select) await select.select("58");

        await page.click('input[name="BTN_CONFIRMAR"][value="Confirmar"]');
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });

        const t_fim = performance.now();
        appendCsvRow({
          vencimento: cliente.vencimento,
          cliente: cliente.codigo_cliente,
          inicio: inicioDate.toISOString(),
          fim: new Date().toISOString(),
          tempoMs: (t_fim - t_inicio).toFixed(2),
          status: "OK",
        }, CONFIG.logCsv);

        console.log(`✅ [SUCESSO] ${cliente.codigo_cliente} em ${(t_fim - t_inicio).toFixed(2)}ms`);

      } catch (error) {
        console.error(`❌ [ERRO] ${cliente.codigo_cliente}: ${error.message}`);
        appendCsvRow({
          vencimento: cliente.vencimento,
          cliente: cliente.codigo_cliente,
          inicio: new Date().toISOString(),
          fim: new Date().toISOString(),
          tempoMs: 0,
          status: "ERRO",
        }, CONFIG.logCsv);
      }
    }
  }

  // 4️⃣ INICIALIZAÇÃO MULTI-ABA
  console.log(`🚀 [EXECUÇÃO] Abrindo ${CONFIG.totalTelas} aba(s)...`);
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: CONFIG.chromePath,
    userDataDir: CONFIG.userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const tarefas = [];
  const fatia = Math.ceil(clientes.length / CONFIG.totalTelas);

  for (let i = 0; i < CONFIG.totalTelas; i++) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(CONFIG.urlSistema, { waitUntil: "networkidle2", timeout: 90000 });
    
    const lista = clientes.slice(i * fatia, (i + 1) * fatia);
    tarefas.push(processarDados(page, lista, i + 1));
    await new Promise((r) => setTimeout(r, 1500));
  }

  await Promise.all(tarefas);
  await browser.close();
  console.log("🏁 [FIM] Processamento concluído.");
  process.exit(0);
})();