import * as crypto from "crypto";
import axios from "axios";

export function getRandomElement(arr) {
  const randomIndex = Math.floor(Math.random() * arr.length);
  return arr[randomIndex];
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function generateRandom12Hex() {
  let hex = "";
  for (let i = 0; i < 12; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

export function generatePassword(length) {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, charset.length);
    password += charset[idx];
  }
  return password;
}

export function getRandomInterval(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export async function getRefreshTokenHotmail(currentRefreshToken, clientId) {
  let refreshToken = null;
  const url = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

  const axiosConfig = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };

  // Prepare the URL-encoded form data for the first attempt.
  const postData = new URLSearchParams();
  postData.append("client_id", clientId);
  postData.append("refresh_token", currentRefreshToken);
  postData.append("grant_type", "refresh_token");

  console.log(clientId);
  console.log(refreshToken);
  try {
    const response = await axios.post(url, postData, axiosConfig);
    refreshToken = response.data.access_token;
    console.debug(`Access token retrieved: ${refreshToken}`);
  } catch (error) {
    console.error(`Error during first request: ${error}`);

    // Second attempt with the additional scope parameter.
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
    } catch (error) {
      console.error(`Error during second request: ${error}`);
    }
  }

  return refreshToken;
}
