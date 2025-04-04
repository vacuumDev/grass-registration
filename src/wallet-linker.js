import axios from "axios";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { TextEncoder } from "util";
import {HttpsProxyAgent} from "https-proxy-agent";
import {headersInterceptor} from "./helper.js";
import {HttpProxyAgent} from "http-proxy-agent";

axios.interceptors.request.use(
    headersInterceptor,
    (error) => Promise.reject(error),
);


export class GrassWalletLinker {
  userAgent;
  proxy;
  /**
   * @param {string} accessToken
   * @param {string} privateKey Приватный ключ в формате base58
   * @param {string} proxy URL прокси-сервера (если требуется)
   * @param {string} userAgent URL прокси-сервера (если требуется)
   */
  constructor(accessToken, privateKey, proxy, userAgent) {
    this.accessToken = accessToken;
    this.privateKey = privateKey;
    this.baseUrl = "https://api.getgrass.io";
    this.userAgent = userAgent;
    this.proxy = proxy;

    this.headers = {
      authority: "api.getgrass.io",
      authorization: this.accessToken,
      "content-type": "application/json",
      origin: "https://app.getgrass.io",
      referer: "https://app.getgrass.io/",
      "user-agent": this.userAgent,
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
    const publicKeyBase64 = Buffer.from(keypair.publicKey).toString("base64");

    const encoder = new TextEncoder();
    const msgUint8 = encoder.encode(msg);
    const signature = nacl.sign.detached(msgUint8, keypair.secretKey);
    const signatureBase64 = Buffer.from(signature).toString("base64");

    return {
      walletAddress,
      publicKey: publicKeyBase64,
      signature: signatureBase64,
    };
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
      isAfterCountdown: true,
    };

    const axiosConfig = {
      headers: this.headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    console.log(payload);
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
        response.data.error?.message?.includes(
          "Wallet address is already being used",
        )
      ) {
        console.log(
          `Кошелек ${walletAddress} уже привязан к аккаунту. Переходим к активации.`,
        );
        return true;
      } else {
        console.error(`Ошибка привязки кошелька. Статус: ${response.status}`);
        console.error(`Ответ: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (error) {
      console.error(`Ошибка: ${error.message}`);
      console.error(error.response.data);
      return false;
    }
  }
}
