// walletLinker.js
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { TextEncoder } from 'util';

export class GrassWalletLinker {
    /**
     * @param {string} accessToken
     * @param {string} privateKey Приватный ключ в формате base58
     * @param {string|null} proxy URL прокси-сервера (если требуется)
     */
    constructor(accessToken, privateKey, proxy = null) {
        this.accessToken = accessToken;
        this.privateKey = privateKey;
        this.proxy = proxy;
        this.baseUrl = 'https://api.getgrass.io';

        this.headers = {
            'authority': 'api.getgrass.io',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
            'authorization': this.accessToken,
            'content-type': 'application/json',
            'origin': 'https://app.getgrass.io',
            'referer': 'https://app.getgrass.io/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }

    /**
     * Подписывает сообщение, используя приватный ключ.
     * @param {number} timestamp
     * @returns {Object} { walletAddress, publicKey, signature }
     */
    signMessage(timestamp) {
        const privateKeyBytes = bs58.decode(this.privateKey);
        const keypair = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);

        const msg = `By signing this message you are binding this wallet to all activities associated to your Grass account and agree to our Terms and Conditions (https://www.getgrass.io/terms-and-conditions) and Privacy Policy (https://www.getgrass.io/privacy-policy).

Nonce: ${timestamp}`;

        const walletAddress = bs58.encode(keypair.publicKey);
        const publicKeyBase64 = Buffer.from(keypair.publicKey).toString('base64');

        const encoder = new TextEncoder();
        const msgUint8 = encoder.encode(msg);
        const signature = nacl.sign.detached(msgUint8, keypair.secretKey);
        const signatureBase64 = Buffer.from(signature).toString('base64');

        return { walletAddress, publicKey: publicKeyBase64, signature: signatureBase64 };
    }

    /**
     * Привязывает кошелек через API.
     * @returns {Promise<boolean>} true – привязка успешна, false – ошибка
     */
    async linkWallet() {
        const url = `${this.baseUrl}/verifySignedMessage`;
        const timestamp = Math.floor(Date.now() / 1000);
        const { walletAddress, publicKey, signature } = this.signMessage(timestamp);

        const payload = {
            signedMessage: signature,
            publicKey: publicKey,
            walletAddress: walletAddress,
            timestamp: timestamp,
            isLedger: false,
            isAfterCountdown: true
        };

        const axiosConfig = {
            headers: this.headers,
            timeout: 30000
        };

        if (this.proxy) {
            axiosConfig.httpsAgent = new HttpsProxyAgent(this.proxy);
        }

        try {
            const response = await axios.post(url, payload, axiosConfig);
            if (
                response.status === 200 &&
                response.data.result &&
                Object.keys(response.data.result).length === 0
            ) {
                console.log(`Кошелек ${walletAddress} успешно привязан!`);
                return true;
            } else if (
                response.status === 400 &&
                response.data.error?.message?.includes("Wallet address is already being used")
            ) {
                console.log(`Кошелек ${walletAddress} уже привязан к аккаунту. Переходим к активации.`);
                return true;
            } else {
                console.error(`Ошибка привязки кошелька. Статус: ${response.status}`);
                console.error(`Ответ: ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error) {
            console.error(`Ошибка: ${error.message}`);
            return false;
        }
    }
}
