import "dotenv/config";
import RegistrationManager from "./registration-manager.js";
import fs from "fs/promises";
import { WalletConfirmer } from "./wallet-confirmer.js";
import { GrassWalletLinker } from "./wallet-linker.js";
import bs58 from "bs58";
import retry from "async-retry";
import nacl from "tweetnacl";
import UserAgent from "user-agents";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import RedisWorker from "./redis-worker.js";
import {
  generateRandom12Hex,
  getRandomInterval,
  generatePassword,
  getRandomElement,
  delay,
} from "./helper.js";

const countries = process.env.COUNTRIES.split(",");

const minDelay = Math.floor(Number(process.env.MIN_DELAY) * 1000);
const maxDelay = Math.floor(Number(process.env.MAX_DELAY) * 1000);

const processAccount = async (emailData, index) => {
  let country = null;
  if (process.env.IS_SEQUENTIAL === "1") {
    country = countries[index % countries.length];
  } else {
    country = getRandomElement(country);
  }

  if (!emailData.trim()) return;

  let [email, password, currentRefreshToken, clientId] = emailData.split(":");

  const existingSession = await RedisWorker.getSession(email);
  if (existingSession) {
    console.log(`Skipping ${email} — session already exists.`);
    return;
  }

  let proxyUrl = process.env.STICKY_PROXY.replace(
    "{ID}",
    generateRandom12Hex(),
  ).replace("{COUNTRY}", country);

  axios.defaults.httpsAgent = new HttpsProxyAgent(proxyUrl);
  axios.defaults.httpAgent = new HttpsProxyAgent(proxyUrl);

  const userAgent = new UserAgent({ deviceCategory: "desktop" });

  const registrationManager = new RegistrationManager(
    proxyUrl,
    userAgent.toString(),
  );

  const keyPair = nacl.sign.keyPair();
  const privateKey = keyPair.secretKey;
  const privateKeyBase58 = bs58.encode(privateKey);
  const publicKeyBase58 = bs58.encode(keyPair.publicKey);

  try {
    let count = 0;
    await delay(getRandomInterval(minDelay, maxDelay));
    let accessToken = await registrationManager.registerAndVerify(
      email,
      password,
      currentRefreshToken,
      clientId,
    );

    while (!accessToken && count < 6) {
      count++;
      proxyUrl = process.env.STICKY_PROXY.replace(
        "{ID}",
        generateRandom12Hex(),
      ).replace("{COUNTRY}", country);
      await delay(getRandomInterval(minDelay, maxDelay));

      accessToken = await registrationManager.registerAndVerify(
        email,
        password,
        currentRefreshToken,
        clientId,
      );
    }

    if (!accessToken) {
      throw new Error(`Can not verify otp code for ${email} restart app`);
    }

    const linker = new GrassWalletLinker(
      accessToken,
      privateKeyBase58,
      proxyUrl,
      userAgent.toString(),
    );

    await delay(getRandomInterval(minDelay, maxDelay));
    const isSuccess = await linker.linkWallet();

    if (!isSuccess) {
      throw new Error(`Can not link wallet`);
    }

    const confirmer = new WalletConfirmer(
      email,
      accessToken,
      proxyUrl,
      userAgent.toString(),
    );
    await delay(getRandomInterval(minDelay, maxDelay));
    await confirmer.sendApproveLink();

    await delay(120_000);

    await delay(getRandomInterval(minDelay, maxDelay));
    let token = null;
    await retry(
      async () => {
        await delay(getRandomInterval(minDelay, maxDelay));
        token = await confirmer.getConfirmationTokenFromEmail(
          currentRefreshToken,
          clientId,
        );
      },
      { retries: 6, minTimeout: 30_000 },
    );

    if(!token)
      throw new Error('Can not get wallet token');

    token = token.replaceAll("3D", "").replaceAll("=\r\n", "");
    await delay(getRandomInterval(minDelay, maxDelay));
    await confirmer.confirmWallet(token);

    console.log("Registration and OTP verification completed successfully.");
    await delay(getRandomInterval(minDelay, maxDelay));

    const accPassword = generatePassword(10);

    await registrationManager.resetPassword(accessToken, accPassword);
    await delay(getRandomInterval(minDelay, maxDelay));
    const res = await axios.get("https://api.getgrass.io/retrieveUser", {
      headers: {
        Authorization: accessToken,
        "User-Agent": userAgent.toString(),
      },
      timeout: 20000,
    });
    const userId = res.data.result.data.userId;

    await RedisWorker.setSession(
      email,
      JSON.stringify({
        accessToken: accessToken,
        userId: userId,
      }),
    );

    const rotatingProxy = process.env.ROTATING_PROXY.replace(
      "{COUNTRY}",
      country,
    );
    await fs.appendFile(
      "data/ready_accounts.txt",
      emailData.split(":").join("|") +
        `|${accPassword}|${proxyUrl}|${accessToken}|${userId}|${userAgent.toString()}|${privateKeyBase58}|${publicKeyBase58}|${rotatingProxy}` +
        "\n",
    );
  } catch (err) {
    console.error("Error during registration and verification:", err.message);
    throw err;
  }
};

// Process an entire batch concurrently
async function processBatch(batch, index) {
  await RedisWorker.init();

  const promises = [];
  for (const emailData of batch) {
    promises.push(processAccount(emailData, index));
    await delay(getRandomInterval(minDelay, maxDelay));
  }
  await Promise.all(promises);
}

// Listen for message from parent process to start processing
process.on("message", async (data) => {
  const { batch, index } = data;
  console.log(`Worker ${index} received batch with ${batch.length} accounts.`);

  await processBatch(batch, index);

  process.send({ status: "done", index });
  process.exit(0);
});
