import * as crypto from "crypto";
import fs from "fs/promises";
import {TARGET_COUNTS} from "./config.js";

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

function getPlatformFromUserAgent(ua = "") {
  const uaLower = ua.toLowerCase();

  if (uaLower.includes("windows")) {
    return "Windows";
  } else if (uaLower.includes("mac os x") || uaLower.includes("macintosh")) {
    return "macOS";
  } else if (uaLower.includes("android")) {
    return "Android";
  } else if (uaLower.includes("iphone") || uaLower.includes("ipad") || uaLower.includes("ios")) {
    return "iOS";
  } else if (uaLower.includes("linux")) {
    return "Linux";
  }

  // Если не распознали
  return "Windows";
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

export const headersInterceptor = (config) => {
  if (
      config.baseURL &&
      (config.baseURL.includes("app.getgrass.io") ||
          config.baseURL.includes("api.getgrass.io") ||
          config.baseURL.includes("director.getgrass.io"))
  ) {
    const isChrome =
        typeof config.headers['User-Agent'] === "string" && config.headers['User-Agent'].includes("Chrome/");

    const match = isChrome && config.headers['User-Agent'].match(/Chrome\/(\d+)/);
    let chromeVersion = 0;
    if (match) {
      chromeVersion = match[1];
    }

    const platform = getPlatformFromUserAgent(config.headers['User-Agent']);

    config.headers = {
      accept: "application/json, text/plain, */*",
      "accept-encoding": "gzip, deflate, br, zstd",
      "accept-language": "en-US;q=0.8,en;q=0.7",
      'authorization': config.headers['Authorization'],
      origin: "https://app.getgrass.io",
      priority: "u=1, i",
      referer: "https://app.getgrass.io/",
      ...(isChrome && {
        "sec-ch-ua":
            `"Chromium";v="${chromeVersion}", "Not:A-Brand";v="${config.brandVersion}", "Google Chrome";v="${chromeVersion}"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": `"${platform}"`,
      }),
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      'user-agent': config.headers['User-Agent'],
    };

  }

  delete config.brandVersion;
  return config;
};

export async function getReadyCounts() {
  const counts = Object.fromEntries(TARGET_COUNTS.map(([c]) => [c, 0]));
  const COUNTRY_RE =
      /(?:[-_=](?:country|region)[-_]|[-=])([a-z]{2})(?=[.\-_:]|$)/i;
  try {
    const data = await fs.readFile("data/ready_accounts.txt", "utf-8");
    data
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          // в конце строки с 05.04.25 будем хранить код страны,
          // но поддержим и «старый» формат без него
          const parts = line.trim().split("|");
          const explicitCountry = parts.at(-1)?.toLowerCase();

          let country = explicitCountry;
          if (!country || country.length !== 2) {
            const proxy = parts.at(-2) ?? "";
            const m = proxy.match(COUNTRY_RE);
            country = m ? m[1].toLowerCase() : null;
          }

          if (country && counts.hasOwnProperty(country)) {
            counts[country] += 1;
          }
        });
  } catch {
  }

  return counts;
}
