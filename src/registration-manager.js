import "dotenv/config";
import axios from "axios";
import retry from "async-retry";
import CapMonster from "node-capmonster";
import EmailHandler from "./email-handler.js";
import {HttpsProxyAgent} from "https-proxy-agent";
import {delay, headersInterceptor} from "./helper.js";
import {CAPMONSTER_KEY} from "./config.js";
import {HttpProxyAgent} from "http-proxy-agent";

axios.interceptors.request.use(
  headersInterceptor,
  (error) => Promise.reject(error),
);

class RegistrationManager {
  proxy;
  captchaToken;
  /**
   * Create a new RegistrationManager.
   * @param {string|null} proxyUrl Optional proxy URL.
   * @param {string} userAgent Optional proxy URL.
   */
  constructor(proxyUrl, userAgent) {
    this.baseUrl = "https://api.getgrass.io";
    this.proxy = proxyUrl;

    // Captcha settings (update the API key as needed)
    this.captchaWebsiteURL = "https://app.getgrass.io/register";
    this.captchaWebsiteKey = "6LeeT-0pAAAAAFJ5JnCpNcbYCBcAerNHlkK4nm6y";
    this.captchaSolver = new CapMonster.RecaptchaV2Task(
        CAPMONSTER_KEY,
    );
    this.userAgent = userAgent;
  }

  /**
   * Uses node-capmonster to solve the reCAPTCHA.
   * @returns {Promise<string>} A recaptcha token.
   */
  async solveCaptcha() {
    try {
      if(this.captchaToken != null)
        return this.captchaToken;

      const taskId = await this.captchaSolver.createTask(
        this.captchaWebsiteURL,
        this.captchaWebsiteKey,
      );
      let result = await this.captchaSolver.getTaskResult(taskId);
      while (result === null) {
        await delay(1_000);
        result = await this.captchaSolver.getTaskResult(taskId);
      }

      return result.gRecaptchaResponse;
    } catch (error) {
      console.error("Error solving captcha:", error.message);
      return null;
    }
  }

  /**
   * Sends an OTP code to the provided email.
   * @param {string} email
   * @returns {Promise<boolean>} Resolves true on success.
   */
  async sendOtp(email) {
    let recaptchaToken = null;
    do {
      recaptchaToken = await this.solveCaptcha();
    } while (!recaptchaToken);

    const payload = {
      email,
      referralCode: process.env.REFERRAL_CODE,
      marketingEmailConsent: false,
      recaptchaToken,
      termsAccepted: true,
      page: "register",
    };

    const headers = {
      "User-Agent": this.userAgent,
      Referer: "https://app.getgrass.io/",
      Origin: "https://app.getgrass.io",
    };

    const axiosConfig = {
      headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/sendOtp`,
        JSON.stringify(payload),
        axiosConfig,
      );
      if (response.status === 200) {
        console.log(`OTP sent to ${email}`);
        this.captchaToken = null;
        return true;
      }
      this.captchaToken = recaptchaToken;
      throw new Error("Failed to send OTP");
    } catch (err) {
      this.captchaToken = recaptchaToken;
      throw new Error(`sendOtp error: ${err.message}`);
    }
  }

  /**
   * Verifies the OTP code.
   * @param {string} email
   * @param {string} otp The OTP code.
   * @returns {Promise<boolean>} Resolves true if verified.
   */
  async verifyOtp(email, otp) {
    const payload = { email, otp };

    const headers = {
      "User-Agent": this.userAgent,
      Referer: "https://app.getgrass.io/",
      Origin: "https://app.getgrass.io",
    };

    const axiosConfig = {
      headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/verifyOtp`,
        JSON.stringify(payload),
        axiosConfig,
      );
      if (response.status === 200) {
        console.log(`OTP verified for ${email}`);
        return response.data.result.data.accessToken;
      }
      throw new Error("OTP verification failed");
    } catch (err) {
      throw new Error(
        `verifyOtp error: ${err.message} ${JSON.stringify(err.response?.data || {})}`,
      );
    }
  }

  async registerAndVerify(email, emailPassword, currentRefreshToken, clientId) {
    let timestamp = Date.now();
    await retry(
      async () => {
        await this.sendOtp(email);
      },
      { retries: 1, minTimeout: 2_000 },
    );

    let otp = null;
    await retry(
      async () => {
        otp = await EmailHandler.fetchOtpFromEmail(
          email,
          currentRefreshToken,
          clientId,
          /Your One Time Password for Grass is (\d{6})/,
          timestamp,
        );
        if(!otp)
          await this.sendOtp(email);
      },
      { retries: 4, minTimeout: 30_000 },
    );

    console.log(otp);
    if (!otp) {
      return false;
    }

    // Fetch the OTP from the email.
    console.log(`Fetched OTP: ${otp}`);

    let accessToken = null;
    await retry(
      async () => {
        accessToken = await this.verifyOtp(email, otp);
      },
      { retries: 3, minTimeout: 2000 },
    );

    return accessToken;
  }

  async resetPassword(accessToken, newPassword) {
    const url = `${this.baseUrl}/resetPassword`;
    const payload = { password: newPassword };

    const headers = {
      Authorization: accessToken,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://app.getgrass.io",
      Referer: "https://app.getgrass.io/",
      "User-Agent": this.userAgent,
    };

    const axiosConfig = {
      headers,
      httpsAgent: new HttpsProxyAgent(this.proxy),
      httpAgent: new HttpProxyAgent(this.proxy)
    };

    try {
      const response = await axios.post(url, payload, axiosConfig);
      return response.data;
    } catch (err) {
      console.error("resetPassword error →", err.response?.data || err.message);
      throw err;
    }
  }
}

export default RegistrationManager;
