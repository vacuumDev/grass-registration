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
