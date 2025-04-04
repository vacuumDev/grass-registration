import axios from "axios";
import {HttpsProxyAgent} from "https-proxy-agent";
import {headersInterceptor} from "./helper.js";
import {HttpProxyAgent} from "http-proxy-agent";


axios.interceptors.request.use(
    headersInterceptor,
    (error) => Promise.reject(error),
);

export class WalletConfirmer {
  userAgent;
  /**
   * @param {string} email
   * @param {string} accessToken
   * @param {string} proxy URL of the proxy server (if needed)
   * @param {string} userAgent URL of the proxy server (if needed)
   */
  constructor(email, accessToken, proxy, userAgent) {
    this.email = email;
    this.accessToken = accessToken;
    this.proxy = proxy;
    this.baseUrl = "https://api.getgrass.io";
    this.userAgent = userAgent;

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
   * Sends a request to send the wallet confirmation email.
   * @returns {Promise<boolean|null>} true if the email was sent, false if the wallet is already activated, null on error.
   */
  async sendApproveLink() {
    const url = `${this.baseUrl}/sendWalletAddressEmailVerification`;
    const payload = { email: this.email };

    const axiosConfig = {
      headers: this.headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    try {
      const response = await axios.post(url, payload, axiosConfig);
      if (response.status === 200) {
        console.log(
          `Письмо для подтверждения кошелька отправлено на ${this.email}`,
        );
        return true;
      } else if (
        response.status === 400 &&
        response.data.error?.message?.includes("already verified")
      ) {
        console.log(`Кошелек для ${this.email} уже привязан и активирован`);
        return false;
      } else {
        if (
          !(
            response.status === 400 &&
            response.data.error?.message?.includes(
              "Wallet address change is not allowed",
            )
          )
        ) {
          console.error(
            `Ошибка отправки письма подтверждения. Статус: ${response.status}`,
          );
          console.error(`Ответ: ${JSON.stringify(response.data)}`);
        }
        return null;
      }
    } catch (error) {
      console.error(`Ошибка: ${error.message}`);
      throw new Error('Can not send approve link')
    }
  }

  /**
   * Confirms the wallet via the API.
   * @param {string} verifyToken
   * @returns {Promise<boolean>} true if confirmed, false on error.
   */
  async confirmWallet(verifyToken) {
    // Clean the token from extra characters.
    if (verifyToken.includes("/")) {
      verifyToken = verifyToken.split("/")[0];
    }
    if (verifyToken.includes("=")) {
      verifyToken = verifyToken.split("=").pop();
    }
    verifyToken = verifyToken.trim();

    const url = `${this.baseUrl}/confirmWalletAddress`;
    const headers = {
      ...this.headers,
      authorization: verifyToken,
    };

    const axiosConfig = {
      headers: headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    console.debug("=== Отправка запроса на подтверждение кошелька ===");

    try {
      const response = await axios.post(url, {}, axiosConfig);
      if (
        response.status === 200 &&
        response.data.result &&
        Object.keys(response.data.result).length === 0
      ) {
        console.log("Кошелек успешно подтвержден!");
        return true;
      } else if (
        response.status === 400 &&
        response.data.error?.message?.includes("already verified")
      ) {
        console.log(`Кошелек уже подтвержден для ${this.email}`);
        return true;
      } else {
        console.error(
          `Ошибка подтверждения кошелька. Статус: ${response.status}`,
        );
        console.error(`Ответ: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (error) {
      console.error(`Ошибка: ${error.message}`);
      return false;
    }
  }
}
