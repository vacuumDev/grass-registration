import 'dotenv/config';
import RegistrationManager from './registration-manager.js';
import fs from 'fs/promises'
import {WalletConfirmer} from "./wallet-confirmer.js";
import {GrassWalletLinker} from "./wallet-linker.js";
import bs58 from "bs58";
import retry from 'async-retry';
import nacl from 'tweetnacl';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const processAccount = async (emailData) => {
    const proxyUrl = process.env.PROXY;

    const registrationManager = new RegistrationManager(proxyUrl);

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

        const linker = new GrassWalletLinker(accessToken, privateKeyBase58, proxyUrl);
        const isSuccess = await linker.linkWallet();

        if(!isSuccess) {
            console.error('Can not link');
            return;
        }

        const confirmer = new WalletConfirmer(email, accessToken, proxyUrl);
        await confirmer.sendApproveLink();

        await delay(120_000)

        let token = null;

        await retry(async () => {
            token = await confirmer.getConfirmationTokenFromEmail(currentRefreshToken, clientId);
        }, { retries: 6, minTimeout: 30_000 });

        token = token.replaceAll('3D', '').replaceAll('=\r\n', '')

        await confirmer.confirmWallet(token);

        console.log('Registration and OTP verification completed successfully.');
        await fs.appendFile('data/ready_accounts.txt', emailData + `:${privateKeyBase58}:${publicKeyBase58}` + "\n");
    } catch (err) {
        console.error('Error during registration and verification:', err.message);
    }
}


async function main() {
    const emailsData = (await fs.readFile('data/emails.txt', 'utf-8')).split('\n').filter(line => line.trim() !== '');
    const batchSize = 20;

    for (let i = 0; i < emailsData.length; i += batchSize) {
        const batch = emailsData.slice(i, i + batchSize);
        const promises = batch.map(emailData => processAccount(emailData));

        await Promise.all(promises);
    }
}

main();
