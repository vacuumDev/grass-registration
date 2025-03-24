import 'dotenv/config';
import RegistrationManager from './registration-manager.js';
import fs from 'fs/promises';
import { WalletConfirmer } from "./wallet-confirmer.js";
import { GrassWalletLinker } from "./wallet-linker.js";
import bs58 from "bs58";
import retry from 'async-retry';
import nacl from "tweetnacl";
import UserAgent from "user-agents";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import RedisWorker from "./redis-worker.js";
import * as crypto from "crypto";

// Helper delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getRandomInterval(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function generateRandom12Hex() {
    let hex = '';
    for (let i = 0; i < 12; i++) {
        hex += Math.floor(Math.random() * 16).toString(16);
    }
    return hex;
}

function generatePassword(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        const idx = crypto.randomInt(0, charset.length);
        password += charset[idx];
    }
    return password;
}


const processAccount = async (emailData) => {
    if (!emailData.trim()) return;

    let [email, password, currentRefreshToken, clientId] = emailData.split(':');

    const existingSession = await RedisWorker.getSession(email);
    if (existingSession) {
        console.log(`Skipping ${email} — session already exists.`);
        return;
    }

    const proxyUrl = process.env.PROXY.replace('{ID}', generateRandom12Hex());

    const minDelay = Number(process.env.MIN_DELAY);
    const maxDelay = Number(process.env.MAX_DELAY);

    await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))

    const userAgent = new UserAgent({ deviceCategory: 'desktop' });

    console.log(userAgent.toString());

    const registrationManager = new RegistrationManager(proxyUrl, userAgent.toString());

    const keyPair = nacl.sign.keyPair();
    const privateKey = keyPair.secretKey;
    const privateKeyBase58 = bs58.encode(privateKey);
    const publicKeyBase58 = bs58.encode(keyPair.publicKey);

    try {
        let count = 0;
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
        let accessToken = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
        while (!accessToken && count < 3) {
            count++;
            await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
            accessToken = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
        }
        if (!accessToken) {
            console.error(`Can not verify otp code for ${email} restart app`);
        }

        const linker = new GrassWalletLinker(accessToken, privateKeyBase58, proxyUrl, userAgent.toString());
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
        const isSuccess = await linker.linkWallet();

        if (!isSuccess) {
            console.error('Can not link');
            return;
        }

        const confirmer = new WalletConfirmer(email, accessToken, proxyUrl, userAgent.toString());
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
        await confirmer.sendApproveLink();

        await delay(120_000);

        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
        let token = null;
        await retry(async () => {
            await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
            token = await confirmer.getConfirmationTokenFromEmail(currentRefreshToken, clientId);
        }, { retries: 6, minTimeout: 30_000 });

        token = token.replaceAll('3D', '').replaceAll('=\r\n', '');
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)))
        await confirmer.confirmWallet(token);

        console.log('Registration and OTP verification completed successfully.');
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)));

        const accPassword = generatePassword(10);

        await registrationManager.resetPassword(accessToken, accPassword)
        await delay(getRandomInterval(Math.floor(minDelay * 1000), Math.floor(maxDelay * 1000)));
        const res = await axios.get("https://api.getgrass.io/retrieveUser", {
            headers: {
                Authorization: accessToken,
                "User-Agent": userAgent.toString(),
            },
            httpsAgent: new HttpsProxyAgent(proxyUrl),
            httpAgent: new HttpsProxyAgent(proxyUrl),
            timeout: 20000,
        });
        const userId = res.data.result.data.userId;

        await RedisWorker.setSession(email, JSON.stringify({
            accessToken: accessToken,
            userId: userId
        }));

        await fs.appendFile('data/ready_accounts.txt', emailData.split(':').join('|') + `|${accPassword}|${proxyUrl}|${accessToken}|${userId}|${userAgent.toString()}|${privateKeyBase58}|${publicKeyBase58}` + "\n");
    } catch (err) {
        console.error('Error during registration and verification:', err.message);
    }
};

// Process an entire batch concurrently
async function processBatch(batch) {
    await RedisWorker.init();
    await Promise.all(batch.map(emailData => processAccount(emailData)));
}

// Listen for message from parent process to start processing
process.on('message', async (data) => {
    const { batch, index } = data;
    console.log(`Worker ${index} received batch with ${batch.length} accounts.`);

    await processBatch(batch);

    process.send({ status: 'done', index });
    process.exit(0);
});
