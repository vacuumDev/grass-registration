import axios from "axios";
import Imap from "imap";
import { getRefreshTokenHotmail } from "./helper.js";

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
      timeout: 30000,
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
      timeout: 30000,
    };

    console.debug("=== Отправка запроса на подтверждение кошелька ===");
    console.debug(`URL: ${url}`);
    console.debug(`Headers: ${JSON.stringify(headers, null, 2)}`);
    console.debug(`Proxy: ${this.proxy}`);

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

  /**
   * Retrieves the confirmation token from the wallet confirmation email.
   *
   * This version uses an OAuth token for IMAP access (using a refresh token and client ID)
   * instead of a plain email password.
   *
   * @param {string} currentRefreshToken Your current refresh token.
   * @param {string} clientId Your client ID.
   * @returns {Promise<string>} The confirmation token or an error.
   */
  async getConfirmationTokenFromEmail(currentRefreshToken, clientId) {
    return new Promise(async (resolve, reject) => {
      // Determine the IMAP host (using Outlook/Hotmail here).
      let host = "outlook.office365.com";
      const lowerEmail = this.email.toLowerCase();

      // If you need to support other email providers, adjust the host accordingly.
      if (
        !(
          lowerEmail.includes("outlook.com") ||
          lowerEmail.includes("hotmail.com") ||
          lowerEmail.includes("live.com")
        )
      ) {
        host = "imap.gmail.com";
      }

      // Obtain the OAuth access token using the refresh token and client ID.
      const accessToken = await getRefreshTokenHotmail(
        currentRefreshToken,
        clientId,
      );
      if (!accessToken) {
        return reject(new Error("Failed to retrieve OAuth token"));
      }

      // Build the XOAUTH2 string.
      const base64Encoded = Buffer.from(
        [`user=${this.email}`, `auth=Bearer ${accessToken}`, "", ""].join(
          "\x01",
        ),
        "utf-8",
      ).toString("base64");

      const imapConfig = {
        xoauth2: base64Encoded,
        host: host,
        port: 993,
        tls: true,
        authTimeout: 25000,
        connTimeout: 30000,
        tlsOptions: {
          rejectUnauthorized: false,
          servername: host,
        },
      };

      const imap = new Imap(imapConfig);
      let tokenFound = false;
      let token = "";

      imap.once("ready", () => {
        // List all mailboxes.
        imap.getBoxes((err, boxes) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // Function to process each mailbox.
          const processMailbox = (mailboxNames) => {
            if (tokenFound) return; // Stop processing if OTP has been found.
            if (mailboxNames.length === 0) {
              imap.end();
              if (!tokenFound) reject(new Error("OTP email not found"));
              return;
            }
            const mailbox = mailboxNames.shift();
            imap.openBox(mailbox, true, (err, box) => {
              if (err) {
                console.error(`Error opening mailbox ${mailbox}:`, err);
                return processMailbox(mailboxNames);
              }
              // Search for all messages in this mailbox.
              imap.search(["ALL"], (err, results) => {
                if (err) {
                  console.error(`Search error in mailbox ${mailbox}:`, err);
                  return processMailbox(mailboxNames);
                }
                console.log(
                  `Found ${results.length} messages in mailbox ${mailbox}`,
                );
                if (!results || results.length === 0) {
                  return processMailbox(mailboxNames);
                }
                const fetcher = imap.fetch(results, { bodies: "" });
                fetcher.on("message", (msg, seqno) => {
                  let buffer = "";
                  msg.on("body", (stream) => {
                    stream.on("data", (chunk) => {
                      buffer += chunk.toString("utf8");
                    });
                    stream.once("end", () => {
                      const regex = /token=([^"]+)/;
                      const tokenMatch = buffer.match(regex);
                      if (tokenMatch && tokenMatch[1]) {
                        tokenFound = true;
                        console.log(`Найден токен: ${tokenMatch[1]}`);
                        token = tokenMatch[1];
                        imap.end();
                        return;
                      }
                    });
                  });
                  msg.once("error", (err) => {
                    console.error(`Error processing message ${seqno}:`, err);
                  });
                });
                fetcher.once("error", (err) => {
                  console.error("Fetch error:", err);
                });
                fetcher.once("end", () => {
                  // Process the next mailbox.
                  processMailbox(mailboxNames);
                });
              });
            });
          };

          // Extract top-level mailbox names.
          const mailboxNames = Object.keys(boxes);
          processMailbox(mailboxNames);
        });
      });

      imap.once("error", (err) => {
        reject(err);
      });
      imap.once("end", () => {
        console.log("Connection ended");
        if (tokenFound) resolve(token);
        resolve(null);
      });
      imap.connect();
    });
  }
}
