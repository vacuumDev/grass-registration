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

// Helper delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const processAccount = async (emailData) => {
    const proxyUrl = process.env.PROXY;
    const userAgent = new UserAgent();

    console.log(userAgent.toString());

    const registrationManager = new RegistrationManager(proxyUrl, userAgent.toString());

    if (!emailData.trim()) return;

    const keyPair = nacl.sign.keyPair();
    const privateKey = keyPair.secretKey;
    const privateKeyBase58 = bs58.encode(privateKey);
    const publicKeyBase58 = bs58.encode(keyPair.publicKey);
    const [email, password, currentRefreshToken, clientId] = emailData.split(':');

    try {
        let count = 0;
        let accessToken = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
        while (!accessToken && count < 3) {
            count++;
            accessToken = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
        }
        if (!accessToken) {
            throw new Error('Can not verify otp code');
        }

        const linker = new GrassWalletLinker(accessToken, privateKeyBase58, proxyUrl, userAgent.toString());
        const isSuccess = await linker.linkWallet();

        if (!isSuccess) {
            console.error('Can not link');
            return;
        }

        const confirmer = new WalletConfirmer(email, accessToken, proxyUrl, userAgent.toString());
        await confirmer.sendApproveLink();

        await delay(120_000);

        let token = null;
        await retry(async () => {
            token = await confirmer.getConfirmationTokenFromEmail(currentRefreshToken, clientId);
        }, { retries: 6, minTimeout: 30_000 });

        token = token.replaceAll('3D', '').replaceAll('=\r\n', '');
        await confirmer.confirmWallet(token);

        console.log('Registration and OTP verification completed successfully.');

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

        await fs.appendFile('data/ready_accounts.txt', emailData + `:${accessToken}:${userId}:${privateKeyBase58}:${publicKeyBase58}` + "\n");
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
