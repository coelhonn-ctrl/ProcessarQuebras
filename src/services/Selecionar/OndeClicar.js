import { rastreador } from "../util/utils.js";

export class Local {
    // Objetivo: Ir até a tela de pesquisa
    async pesquisar(page) {
        await page.waitForSelector('#menu', { timeout: 10000 });
        await page.evaluate(() => {
            const link = document.querySelector('#menu li:nth-child(2) ul li:nth-child(5) a');
            if (link) link.click();
        });
        // Em headless, o networkidle0 às vezes demora. Usamos um seletor esperado da próxima tela.
        await page.waitForSelector('#_DEVEDOR_CODIGO', { timeout: 15000 });
        console.log("📍 Chegou na tela de pesquisa.");
    }

    // Objetivo: Clicar no botão pesquisar
    async botaoPesquisar(page) {
        const seletor = 'input[name="BTN_PESQUISAR"]';
        await page.waitForSelector(seletor, { visible: true });
        await page.click(seletor); 
        console.log("✅ Pesquisa disparada.");
    }

    // Objetivo: Entrar na ficha do primeiro cliente da lista
    async primeiroCliente(page) {
        const seletor = '#span__DEVCOD_0001 a';
        // O rastreador é essencial aqui se o resultado vier dentro de um frame
        const alvo = await rastreador(page, seletor);
        if (!alvo) throw new Error("Lista de clientes não apareceu.");
        
        await alvo.frame.click(seletor);
        console.log('✅ Entrou na ficha do cliente.');
    }

    // Objetivo: Clicar no link da aba "Boleto"
    async paginaBoleto(page) {
        const seletor = 'span#BOLETO a';
        const alvo = await rastreador(page, seletor);
        if (!alvo) throw new Error("Link 'Boleto' não encontrado.");
        
        await alvo.frame.click(seletor);
        console.log("✅ Aba de boletos acessada.");
    }

    // Objetivo: Clicar no código do acordo selecionado
    async noCodigo(frame, elemento) {
        console.log("chamando click")
        const id = await frame.evaluate(el => el.id, elemento);
        await frame.click(`#${id}`);
        console.log(`🖱️ Acordo ${id} selecionado.`);
    }

    async prucarardentrodeumelementosuandoumseletor(elementHandle, selector) {
        return await elementHandle.$(selector);
    }

}