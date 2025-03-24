import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent'
import Imap from 'imap';
import retry from 'async-retry';
import CapMonster from 'node-capmonster';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function getRefreshTokenHotmail(currentRefreshToken, clientId) {
    let refreshToken = null;
    const proxy = process.env.PROXY;
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    // Axios configuration with headers.
    const axiosConfig = {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    };

    // If a proxy is provided, set the Axios proxy configuration.
    if (proxy) {
        axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
    }

    // Prepare the URL-encoded form data for the first attempt.
    const postData = new URLSearchParams();
    postData.append('client_id', clientId);
    postData.append('refresh_token', currentRefreshToken);
    postData.append('grant_type', 'refresh_token');

    try {
        const response = await axios.post(url, postData, axiosConfig);
        console.log(response.data);
        refreshToken = response.data.access_token;
        console.debug(`Access token retrieved: ${refreshToken}`);
    } catch (error) {
        console.error(`Error during first request: ${error}`);

        // Second attempt with the additional scope parameter.
        try {
            const postData2 = new URLSearchParams();
            postData2.append('client_id', clientId);
            postData2.append('refresh_token', currentRefreshToken);
            postData2.append('grant_type', 'refresh_token');
            postData2.append('scope', 'https://outlook.office.com/IMAP.AccessAsUser.All');

            const response2 = await axios.post(url, postData2, axiosConfig);
            refreshToken = response2.data.access_token;
            console.debug(`Access token retrieved on second attempt: ${refreshToken}`);
        } catch (error) {
            console.error(`Error during second request: ${error}`);
        }
    }

    return refreshToken;
}



class RegistrationManager {
    /**
     * Create a new RegistrationManager.
     * @param {string|null} proxyUrl Optional proxy URL.
     * @param {string} userAgent Optional proxy URL.
     */
    constructor(proxyUrl, userAgent ) {
        this.proxyUrl = proxyUrl;
        this.baseUrl = 'https://api.getgrass.io';

        // Captcha settings (update the API key as needed)
        this.captchaWebsiteURL = 'https://app.getgrass.io/register';
        this.captchaWebsiteKey = '6LeeT-0pAAAAAFJ5JnCpNcbYCBcAerNHlkK4nm6y';
        this.captchaSolver = new CapMonster.RecaptchaV2Task(process.env.CAPMONSTER_KEY);
        this.userAgent = userAgent;
    }

    /**
     * Uses node-capmonster to solve the reCAPTCHA.
     * @returns {Promise<string>} A recaptcha token.
     */
    async solveCaptcha() {
        try {
            const taskId = await this.captchaSolver.createTask(this.captchaWebsiteURL, this.captchaWebsiteKey);
            const result = await this.captchaSolver.getTaskResult(taskId);
            return result.gRecaptchaResponse;
        } catch (error) {
            console.error('Error solving captcha:', error.message);
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
        } while (!recaptchaToken)

        const payload = {
            email,
            referralCode: "",
            marketingEmailConsent: false,
            recaptchaToken,
            termsAccepted: true,
            page: "register"
        };

        const headers = {
            'User-Agent': this.userAgent,
            'Referer': 'https://app.getgrass.io/',
            'Origin': 'https://app.getgrass.io'
        };

        const axiosConfig = {
            headers,
            timeout: 30000,
            httpsAgent: new HttpsProxyAgent(this.proxyUrl)
        };

        try {
            const response = await axios.post(`${this.baseUrl}/sendOtp`, JSON.stringify(payload), axiosConfig);
            if (response.status === 200) {
                console.log(`OTP sent to ${email}`);
                return true;
            }
            throw new Error('Failed to send OTP');
        } catch (err) {
            throw new Error(`sendOtp error: ${err.message}`);
        }
    }

    async fetchOtpFromEmail(email, currentRefreshToken, clientId) {
        let host = 'outlook.office365.com';
        const lowerEmail = email.toLowerCase();
        if (lowerEmail.includes('outlook.com') || lowerEmail.includes('hotmail.com') || lowerEmail.includes('live.com')) {
            host = 'outlook.office365.com';
        }

        const token = await getRefreshTokenHotmail(currentRefreshToken, clientId);
        console.log('OAuth Token:', token);
        const base64Encoded = Buffer.from(
            [`user=${email}`, `auth=Bearer ${token}`, '', ''].join('\x01'),
            'utf-8'
        ).toString('base64');

        const imapConfig = {
            xoauth2: base64Encoded,
            host: host,
            port: 993,
            tls: true,
            authTimeout: 25000,
            connTimeout: 30000,
            tlsOptions: {
                rejectUnauthorized: false,
                servername: host
            }
        };

        console.log('IMAP Config:', imapConfig);

        return new Promise((resolve, reject) => {
            const imap = new Imap(imapConfig);
            let otpFound = false;

            imap.once('ready', () => {
                // List all mailboxes.
                imap.getBoxes((err, boxes) => {
                    if (err) {
                        imap.end();
                        return reject(err);
                    }
                    console.log('Mailboxes:', boxes);

                    // Function to process each mailbox.
                    const processMailbox = (mailboxNames) => {
                        if (otpFound) return; // Stop processing if OTP has been found.
                        if (mailboxNames.length === 0) {
                            imap.end();
                            if (!otpFound) reject(new Error('OTP email not found'));
                            return;
                        }
                        const mailbox = mailboxNames.shift();
                        console.log(`\nOpening mailbox: ${mailbox}`);
                        imap.openBox(mailbox, true, (err, box) => {
                            if (err) {
                                console.error(`Error opening mailbox ${mailbox}:`, err);
                                return processMailbox(mailboxNames);
                            }
                            // Search for all messages in this mailbox.
                            imap.search(['ALL'], (err, results) => {
                                if (err) {
                                    console.error(`Search error in mailbox ${mailbox}:`, err);
                                    return processMailbox(mailboxNames);
                                }
                                console.log(`Found ${results.length} messages in mailbox ${mailbox}`);
                                if (!results || results.length === 0) {
                                    return processMailbox(mailboxNames);
                                }
                                const fetcher = imap.fetch(results, { bodies: '' });
                                fetcher.on('message', (msg, seqno) => {
                                    let buffer = '';
                                    msg.on('body', (stream) => {
                                        stream.on('data', (chunk) => {
                                            buffer += chunk.toString('utf8');
                                        });
                                        stream.once('end', () => {
                                            console.log(`\nMessage ${seqno} in ${mailbox}:`);
                                            console.log(buffer);
                                            // Check for OTP in the message using regex.
                                            const otpRegex = /Subject: Your One Time Password for Grass is (\d{6})/;
                                            const match = buffer.match(otpRegex);
                                            if (match && match[1]) {
                                                otpFound = true;
                                                console.log(`OTP found: ${match[1]}`);
                                                resolve(match[1]);
                                                imap.end(); // End the connection once OTP is found.
                                            }
                                        });
                                    });
                                    msg.once('error', (err) => {
                                        console.error(`Error processing message ${seqno}:`, err);
                                    });
                                });
                                fetcher.once('error', (err) => {
                                    console.error('Fetch error:', err);
                                });
                                fetcher.once('end', () => {
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

            imap.once('error', (err) => {
                reject(err);
            });
            imap.once('end', () => {
                console.log('Connection ended');
            });
            imap.connect();
        });
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
            'User-Agent': this.userAgent,
            'Referer': 'https://app.getgrass.io/',
            'Origin': 'https://app.getgrass.io'
        };

        const axiosConfig = {
            headers,
            timeout: 30000,
            httpsAgent: new HttpsProxyAgent(this.proxyUrl)
        };

        try {
            const response = await axios.post(`${this.baseUrl}/verifyOtp`, JSON.stringify(payload), axiosConfig);
            if (response.status === 200) {
                console.log(JSON.stringify(response.data))
                console.log(`OTP verified for ${email}`);
                return response.data.result.data.accessToken;
            }
            throw new Error('OTP verification failed');
        } catch (err) {
            throw new Error(`verifyOtp error: ${err.message} ${JSON.stringify(err.response?.data || {})}`);
        }
    }

    async registerAndVerify(email, emailPassword, currentRefreshToken, clientId) {
        await retry(async () => {
            await this.sendOtp(email);
        }, { retries: 3, minTimeout: 5000 });

        await delay(120_000);

        let otp = null;
        await retry(async () => {
            otp = await this.fetchOtpFromEmail(email, currentRefreshToken, clientId);
        }, { retries: 6, minTimeout: 30_000 });

        console.log(otp)
        if(!otp) {
            return false;
        }

        // Fetch the OTP from the email.
        console.log(`Fetched OTP: ${otp}`);

        let accessToken = null;
        await retry(async () => {
            accessToken = await this.verifyOtp(email, otp);
        }, { retries: 3, minTimeout: 2000 });

        return accessToken;
    }

    async resetPassword(accessToken, newPassword) {
        const url = `${this.baseUrl}/resetPassword`;
        const payload = { password: newPassword };

        const headers = {
            'Authorization': accessToken,
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Origin': 'https://app.getgrass.io',
            'Referer': 'https://app.getgrass.io/',
            'User-Agent': this.userAgent
        };

        const axiosConfig = {
            headers,
            timeout: 30000,
            httpsAgent: this.proxyUrl ? new HttpsProxyAgent(this.proxyUrl) : undefined
        };

        try {
            const response = await axios.post(url, payload, axiosConfig);
            console.log('resetPassword response →', response.data);
            return response.data;
        } catch (err) {
            console.error('resetPassword error →', err.response?.data || err.message);
            throw err;
        }
    }
}

export default RegistrationManager;
