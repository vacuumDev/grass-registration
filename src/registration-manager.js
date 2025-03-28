import "dotenv/config";
import axios from "axios";
import Imap from "imap";
import retry from "async-retry";
import CapMonster from "node-capmonster";
import { getRefreshTokenHotmail } from "./helper.js";
import EmailHandler from "./email-handler.js";

axios.interceptors.request.use(
  (config) => {
    if (
      config.url &&
      (config.url.includes("app.getgrass.io") ||
        config.url.includes("api.getgrass.io"))
    ) {
      config.headers = {
        ...config.headers,
        "sec-ch-ua":
          '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        priority: "u=1, i",
        origin: "https://app.getgrass.io",
        referer: "https://app.getgrass.io/",
        accept: "application/json, text/plain, */*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US;q=0.8,en;q=0.7",
      };
    }
    return config;
  },
  (error) => Promise.reject(error),
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RegistrationManager {
  /**
   * Create a new RegistrationManager.
   * @param {string|null} proxyUrl Optional proxy URL.
   * @param {string} userAgent Optional proxy URL.
   */
  constructor(proxyUrl, userAgent) {
    this.baseUrl = "https://api.getgrass.io";

    // Captcha settings (update the API key as needed)
    this.captchaWebsiteURL = "https://app.getgrass.io/register";
    this.captchaWebsiteKey = "6LeeT-0pAAAAAFJ5JnCpNcbYCBcAerNHlkK4nm6y";
    this.captchaSolver = new CapMonster.RecaptchaV2Task(
      process.env.CAPMONSTER_KEY,
    );
    this.userAgent = userAgent;
  }

  /**
   * Uses node-capmonster to solve the reCAPTCHA.
   * @returns {Promise<string>} A recaptcha token.
   */
  async solveCaptcha() {
    try {
      const taskId = await this.captchaSolver.createTask(
        this.captchaWebsiteURL,
        this.captchaWebsiteKey,
      );
      const result = await this.captchaSolver.getTaskResult(taskId);
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
      referralCode: "",
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
      timeout: 30000,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/sendOtp`,
        JSON.stringify(payload),
        axiosConfig,
      );
      if (response.status === 200) {
        console.log(`OTP sent to ${email}`);
        return true;
      }
      throw new Error("Failed to send OTP");
    } catch (err) {
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
      timeout: 30000,
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
      { retries: 3, minTimeout: 5000 },
    );

    await delay(120_000);

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
      },
      { retries: 8, minTimeout: 30_000 },
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
      timeout: 30000,
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
