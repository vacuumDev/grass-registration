import 'dotenv/config';
import RegistrationManager from './registration-manager.js';
import fs from 'fs/promises'

async function main() {
    const emails = (await fs.readFile('data/emails.txt')).toString().split('\n');
    const proxyUrl = process.env.PROXY;

    const registrationManager = new RegistrationManager(proxyUrl);

    for (const emailData of emails) {
        if (!emailData.trim()) continue;

        const [email, password, currentRefreshToken, clientId] = emailData.split(':');
        console.log(email, password, currentRefreshToken, clientId);

        try {
            let success = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
            while (!success) {
                success = await registrationManager.registerAndVerify(email, password, currentRefreshToken, clientId);
            }
            console.log(success)
            console.log('Registration and OTP verification completed successfully.');
            await fs.appendFile('data/ready_accounts.txt', emailData + "\n");
        } catch (err) {
            console.error('Error during registration and verification:', err.message);
        }
    }
}

main();
