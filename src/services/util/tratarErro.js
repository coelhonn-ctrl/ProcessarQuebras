import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function tratarErro(page, cliente, idBot, error) {
    console.error(`[Bot ${idBot}] ❌ Erro no Cód ${cliente.codigo_cliente}: ${error.message}`);

    const printPath = path.join(
        __dirname,
        `../../erros/erro_bot${idBot}_${cliente.codigo_cliente}.png`
    );

    await page.screenshot({ path: printPath, fullPage: true });

    await page.goto(
        'http://172.16.55.252:8080/siscobraweb/servlet/hbranco',
        { waitUntil: 'networkidle2' }
    );
}
