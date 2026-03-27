import { localizarNoFrameComPaciencia } from "../util/utils.js";

export class Escrever {
    async escreverCodigo(page, codigo) {
        const seletor = '#_ACOCOD';
        
        try {
            // 1. Espera e garante o foco
            const input = await page.waitForSelector(seletor, { visible: true, timeout: 5000 });
            
            // 2. Limpeza profunda (Limpa valor e dispara eventos de reset)
            await input.evaluate(el => {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.focus();
            });

            // 3. Digitação simulada (Mantemos o delay para sistemas que validam tecla a tecla)
            await input.type(String(codigo), { delay: 20 }); 

            // 4. Confirmação e Gatilho (O TAB simula a saída do campo, disparando validações do sistema)
            await page.keyboard.press('Tab');

            // 5. Verificação Final (Garantia Atômica)
            const sucesso = await input.evaluate((el, cod) => {
                if (el.value !== cod) {
                    el.value = cod;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                return el.value === cod;
            }, String(codigo));

            if (sucesso) {
                console.log(`✅ Código ${codigo} inserido e validado.`);
            }
        } catch (error) {
            console.error(`❌ Erro ao escrever código ${codigo}:`, error.message);
            throw error;
        }
    }

    async escreverTextoSeguro(frameOrPage, seletor, texto, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const el = await frameOrPage.$(seletor);
                if (!el) throw new Error(`Elemento ${seletor} não encontrado`);
                await el.focus();
                await el.click({ clickCount: 3 });
                await el.type(texto, { delay: 50 });
                console.log(`✍️ Texto "${texto}" escrito em ${seletor}`);
                return el;
            } catch (err) {
                console.warn(`⚠️ Tentativa ${i + 1} falhou para ${seletor}: ${err.message}`);
                if (i === retries - 1) throw err;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }
}