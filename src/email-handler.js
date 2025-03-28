import Imap from "imap";
import axios from "axios";

class EmailHandler {
    /**
     * Retrieves a new refresh token from Microsoft using the given refresh token.
     * Implementation mirrors the `getRefreshTokenHotmail` function.
     *
     * @param {string} currentRefreshToken The current refresh token.
     * @param {string} clientId The Client ID (App ID) for your Microsoft OAuth.
     * @returns {Promise<string|null>} The new access token, or null if unsuccessful.
     */
    static async getRefreshTokenHotmail(currentRefreshToken, clientId) {
        let refreshToken = null;
        const url = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

        const axiosConfig = {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        };

        // First attempt (no scope).
        const postData = new URLSearchParams();
        postData.append("client_id", clientId);
        postData.append("refresh_token", currentRefreshToken);
        postData.append("grant_type", "refresh_token");

        try {
            const response = await axios.post(url, postData, axiosConfig);
            refreshToken = response.data.access_token;
            console.debug(`Access token retrieved: ${refreshToken}`);
        } catch (error) {
            console.error(`Error during first token request: ${error}`);

            // Second attempt with scope appended.
            try {
                const postData2 = new URLSearchParams();
                postData2.append("client_id", clientId);
                postData2.append("refresh_token", currentRefreshToken);
                postData2.append("grant_type", "refresh_token");
                postData2.append(
                    "scope",
                    "https://outlook.office.com/IMAP.AccessAsUser.All",
                );

                const response2 = await axios.post(url, postData2, axiosConfig);
                refreshToken = response2.data.access_token;
                console.debug(
                    `Access token retrieved on second attempt: ${refreshToken}`,
                );
            } catch (error2) {
                console.error(`Error during second token request: ${error2}`);
            }
        }
        return refreshToken;
    }

    /**
     * Connects via IMAP using OAuth, searches all mailboxes for an OTP code that
     * appears *after* a given timestamp, using the regex
     *
     * Logic is the same as your original `fetchOtpFromEmail` method.
     *
     * @param {string} email The full email address (e.g. test@hotmail.com).
     * @param {string} currentRefreshToken The current MS refresh token.
     * @param {string} clientId The MS OAuth Client ID.
     * @param {RegExp} regex The MS OAuth Client ID.
     * @param {number} timestamp Only fetch OTP messages after this timestamp (ms).
     * @returns {Promise<string|null>} The first matching OTP code found, or null if not found.
     */
    static async fetchOtpFromEmail(email, currentRefreshToken, clientId, regex, timestamp) {
        // Determine host based on domain.
        let host = "outlook.office365.com";
        const lowerEmail = email.toLowerCase();
        if (
            lowerEmail.includes("outlook.com") ||
            lowerEmail.includes("hotmail.com") ||
            lowerEmail.includes("live.com")
        ) {
            host = "outlook.office365.com";
        }

        // Get the access token from your refresh token.
        const token = await EmailHandler.getRefreshTokenHotmail(
            currentRefreshToken,
            clientId,
        );
        console.log("OAuth Token:", token);

        // Build xoauth2 string.
        const base64Encoded = Buffer.from(
            [`user=${email}`, `auth=Bearer ${token}`, "", ""].join("\x01"),
            "utf-8",
        ).toString("base64");

        // IMAP connection config.
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

        console.log("IMAP Config:", imapConfig);

        return new Promise((resolve, reject) => {
            const imap = new Imap(imapConfig);
            let latestDate = timestamp; // We'll only consider messages newer than this.
            let latestOtp = null;

            imap.once("ready", () => {
                imap.getBoxes((err, boxes) => {
                    if (err) {
                        imap.end();
                        return reject(err);
                    }
                    console.log("Mailboxes:", boxes);

                    // Gather top-level mailboxes into an array for iteration.
                    const mailboxNames = Object.keys(boxes);

                    const processMailbox = (names) => {
                        // If no more mailboxes are left, finish up.
                        if (names.length === 0) {
                            imap.end();
                            return latestOtp
                                ? resolve(latestOtp)
                                : reject(new Error("OTP not found"));
                        }

                        const mailbox = names.shift();
                        console.log(`\nOpening mailbox: ${mailbox}`);

                        imap.openBox(mailbox, true, (openErr, box) => {
                            if (openErr) {
                                console.error(`Error opening mailbox ${mailbox}:`, openErr);
                                return processMailbox(names);
                            }

                            // Search for ALL messages in this mailbox.
                            imap.search(["ALL"], (searchErr, results) => {
                                if (searchErr) {
                                    console.error(`Search error in mailbox ${mailbox}:`, searchErr);
                                    return processMailbox(names);
                                }

                                console.log(
                                    `Found ${results.length} messages in mailbox ${mailbox}`,
                                );

                                if (!results || !results.length) {
                                    return processMailbox(names);
                                }

                                // Fetch the full raw message.
                                const fetcher = imap.fetch(results, { bodies: "" });

                                fetcher.on("message", (msg, seqno) => {
                                    let buffer = "";

                                    msg.on("body", (stream) => {
                                        stream.on("data", (chunk) => {
                                            buffer += chunk.toString("utf8");
                                        });

                                        stream.once("end", () => {
                                            const header = Imap.parseHeader(buffer);

                                            // Check message date, skip if older than timestamp we want.
                                            const msgDate = new Date(header.date?.[0] || 0).getTime();
                                            if (!msgDate || msgDate < timestamp) return;

                                            // Look for the OTP in the message text.
                                            const match = buffer.match(
                                                regex,
                                            );
                                            if (match && msgDate > latestDate) {
                                                // If it's newer than our last OTP, save it.
                                                latestDate = msgDate;
                                                latestOtp = match[1];
                                                console.log(`Found OTP [${latestOtp}] on ${header.date}`);
                                            }
                                        });
                                    });

                                    msg.once("error", (msgErr) => {
                                        console.error(`Error processing message ${seqno}:`, msgErr);
                                    });
                                });

                                fetcher.once("error", (fetchErr) => {
                                    console.error("Fetch error:", fetchErr);
                                });

                                // Once done fetching all messages in this mailbox, move on.
                                fetcher.once("end", () => {
                                    processMailbox(names);
                                });
                            });
                        });
                    };

                    processMailbox(mailboxNames);
                });
            });

            imap.once("error", (imapErr) => {
                reject(imapErr);
            });

            imap.once("end", () => {
                console.log("IMAP connection ended");
                // If we never found an OTP, resolve with null; otherwise, we’ve already resolved.
                if (!latestOtp) resolve(null);
            });

            imap.connect();
        });
    }
}

export default EmailHandler;