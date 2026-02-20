export const config = {
    headless: process.env.HEADLESS === 'true',
    maxJanelas: Number(process.env.MAX_JANELAS) || 4,
    slowMo: Number(process.env.SLOWMO) || 0,
    urlSistema: 'http://172.16.55.252:8080/siscobraweb/servlet/hbranco',
    sessionId: 'usuario_julia'
}