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
  delay, headersInterceptor,
} from "./helper.js";
import EmailHandler from "./email-handler.js";
import {COUNTRIES, IS_SEQUENTIAL, MAX_DELAY, MIN_DELAY, ROTATING_PROXY, STICKY_PROXY} from "./config.js";
import {HttpProxyAgent} from "http-proxy-agent";

const countries = COUNTRIES.split(",");
const minDelay = Math.floor(Number(MIN_DELAY ?? 1000) * 1000);
const maxDelay = Math.floor(Number(MAX_DELAY ?? 10_000) * 1000);

const versions = [99, 8, 110];

axios.interceptors.request.use(
    headersInterceptor,
    (error) => Promise.reject(error),
);


/**
 * Проверка прокси. Делаем простой запрос (например, к ipify).
 * Если запрос проходит без ошибок и возвращает IP, считаем прокси валидной.
 * В противном случае ловим ошибку и генерируем новую.
 */
async function getValidProxy(country) {
  let attempts = 0;

  while (attempts < 40) {
    attempts++;
    const proxyUrl = STICKY_PROXY
        .replace("{ID}", generateRandom12Hex())
        .replace("{COUNTRY}", country);

    console.log(proxyUrl)
    try {
      await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: new HttpsProxyAgent(proxyUrl),
        httpAgent: new HttpProxyAgent(proxyUrl),
        timeout: 10000,
      });
      // Если ошибок нет – прокси рабочая
      return proxyUrl;
    } catch (error) {
      console.log(`Прокси ${proxyUrl} невалидна, пытаемся снова... (${attempts})`);
      await delay(getRandomInterval(minDelay, maxDelay));
    }
  }
  // Если не нашли валидный прокси
  return false;
}

/**
 * Шаг 1: Генерируем валидный прокси, user-agent, ключи.
 * Если всё ок – возвращаем true, иначе false.
 */
async function stepInitAccount(accountData) {
  try {
    // Создаём user-agent (будем использовать один и тот же для всех шагов)
    const userAgent = new UserAgent({ deviceCategory: "desktop" });
    accountData.userAgent = userAgent.toString();

    // Создаём ключи
    const keyPair = nacl.sign.keyPair();
    accountData.privateKeyBase58 = bs58.encode(keyPair.secretKey);
    accountData.publicKeyBase58 = bs58.encode(keyPair.publicKey);

    // Инициализируем registrationManager с новыми данными
    accountData.registrationManager = new RegistrationManager(
        accountData.proxyUrl,
        accountData.userAgent,
        accountData.brandVersion
    );

    return true;
  } catch (err) {
    console.error("Ошибка на шаге инициализации аккаунта:", err.message);
    return false;
  }
}

/**
 * Шаг 2: Регистрация + подтверждение кода (registerAndVerify).
 * Если всё ок – возвращаем true, иначе false.
 */
async function stepRegisterAndVerify(accountData) {
  try {
    const { email, password, currentRefreshToken, clientId } = accountData;
    const { registrationManager } = accountData;

    let attempt = 0;
    let accessToken = null;
    while (!accessToken && attempt < 6) {
      attempt++;

      accessToken = await registrationManager.registerAndVerify(
          email,
          password,
          currentRefreshToken,
          clientId,
      );
    }

    if (!accessToken) {
      console.error(`Не получилось подтвердить OTP для ${email}.`);
      return false;
    }
    accountData.accessToken = accessToken;
    return true;
  } catch (err) {
    console.error("Ошибка на шаге регистрации и верификации:", err.message);
    accountData.proxyUrl = await getValidProxy(accountData.country);

    if (!accountData.proxyUrl) {
      console.error(`Не смогли подобрать прокси для ${accountData.email}`);
    }
    return false;
  }
}

/**
 * Шаг 3: Линкуем кошелёк (linkWallet).
 * Если всё ок – возвращаем true, иначе false.
 */
async function stepLinkWallet(accountData) {
  try {

    const { accessToken, privateKeyBase58 } = accountData;
    const linker = new GrassWalletLinker(
        accessToken,
        privateKeyBase58,
        accountData.proxyUrl,
        accountData.userAgent,
        accountData.brandVersion
    );

    await delay(getRandomInterval(minDelay, maxDelay));
    const isSuccess = await linker.linkWallet();
    if (!isSuccess) {
      console.error(`Не смогли связать кошелёк.`);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Ошибка на шаге привязки кошелька:", err.message);
    return false;
  }
}

/**
 * Шаг 4: Отправка approve-link на почту и его подтверждение.
 * Если не получилось найти токен, пробуем несколько раз заново.
 */
async function stepConfirmWallet(accountData) {
  try {

    const { email, accessToken, currentRefreshToken, clientId } = accountData;
    const confirmer = new WalletConfirmer(
        email,
        accessToken,
        accountData.proxyUrl,
        accountData.userAgent,
        accountData.brandVersion
    );

    let attempt = 0;
    let isConfirmed = false;
    while (!isConfirmed && attempt < 6) {
      attempt++;
      try {
        const timestamp = Date.now();
        await delay(getRandomInterval(minDelay, maxDelay));
        await confirmer.sendApproveLink();

        // Пытаемся вытащить токен из письма
        let token = null;
        await retry(
            async () => {
              await delay(getRandomInterval(minDelay, maxDelay));
              token = await EmailHandler.fetchOtpFromEmail(
                  email,
                  currentRefreshToken,
                  clientId,
                  /token=([^"]+)/,
                  timestamp,
              );
            },
            { retries: 6, minTimeout: 30_000 },
        );

        if (!token) {
          console.error(`Не удалось получить токен для подтверждения кошелька (попытка ${attempt}).`);
          continue;
        }

        token = token.replaceAll("3D", "").replaceAll("=\r\n", "");
        await delay(getRandomInterval(minDelay, maxDelay));
        await confirmer.confirmWallet(token);

        // Если дошли до этой точки без ошибок, значит успешно
        isConfirmed = true;
      } catch (e) {
        console.error(`Ошибка при подтверждении кошелька (попытка ${attempt}): ${e.message}`);
      }
    }

    return isConfirmed;
  } catch (err) {
    console.error("Ошибка на шаге подтверждения кошелька:", err.message);
    return false;
  }
}

/**
 * Шаг 5: Сброс пароля, получение userId и сохранение данных в Redis/файл.
 * Если всё ок – возвращаем true, иначе false.
 */
async function stepFinalizeAccount(accountData) {
  try {
    const { accessToken } = accountData;
    const registrationManager = accountData.registrationManager;
    const newPassword = generatePassword(10);

    await delay(getRandomInterval(minDelay, maxDelay));
    // Сброс пароля
    await registrationManager.resetPassword(accessToken, newPassword);

    // Получаем userId
    const res = await axios.get("https://api.getgrass.io/retrieveUser", {
      headers: {
        Authorization: accessToken,
        "User-Agent": accountData.userAgent,
      },
      httpAgent: new HttpProxyAgent(accountData.proxyUrl),
      httpsAgent: new HttpsProxyAgent(accountData.proxyUrl),
      brandVersion: accountData.brandVersion
    });
    const userId = res.data.result.data.userId;

    accountData.finalPassword = newPassword;
    accountData.userId = userId;
    return true;
  } catch (err) {
    console.error("Ошибка на финальном шаге:", err.message);
    return false;
  }
}

/**
 * Основная функция обработки одного аккаунта с использованием пошаговой логики.
 */
async function processAccount(emailData, index) {
  if (!emailData.trim()) return;

  let [email, password, currentRefreshToken, clientId] = emailData.split(":");

  // Проверяем, есть ли уже сессия
  const existingSession = await RedisWorker.getSession(email);
  if (existingSession) {
    console.log(`Skipping ${email} — session already exists.`);
    return;
  }

  // Выбираем страну
  let country = null;
  if (IS_SEQUENTIAL === "1") {
    country = countries[index % countries.length];
  } else {
    country = getRandomElement(countries);
  }

  country = country.toLowerCase();
  const randomBrandVersion = versions[Math.floor(Math.random() * versions.length)];

  // Собираем все данные об аккаунте в единый объект
  let accountData = {
    step: 0, // с какого шага начинаем (если нужно восстанавливать, можно подставить другое)
    email,
    password,
    currentRefreshToken,
    clientId,
    country,
    proxyUrl: null,
    userAgent: null,
    privateKeyBase58: null,
    publicKeyBase58: null,
    accessToken: null,
    finalPassword: null,
    userId: null,
    registrationManager: null,
    // Флаг для рандомизации шагов 2-4, чтобы блок выполнился только один раз
    randomized: false,
    brandVersion: randomBrandVersion
  };

  accountData.proxyUrl = await getValidProxy(accountData.country);

  if (!accountData.proxyUrl) {
    console.error(`Не смогли подобрать прокси для ${email}`);
    return;
  }

  // Лимит попыток, чтобы не было бесконечных циклов при какой-то постоянной ошибке
  let totalAttempts = 0;
  const maxTotalAttempts = 20;

  while (accountData.step < 6 && totalAttempts < maxTotalAttempts) {
    totalAttempts++;
    let stepDone = false;

    switch (accountData.step) {
      case 0: {
        console.log(`Шаг 0: Инициализация аккаунта для ${accountData.email}`);
        stepDone = await stepInitAccount(accountData);
        if (stepDone) accountData.step = 1;
        break;
      }
      case 1: {
        accountData.registrationManager.proxy = accountData.proxyUrl;
        console.log(`Шаг 1: Регистрация и проверка OTP для ${accountData.email}`);
        stepDone = await stepRegisterAndVerify(accountData);
        if (stepDone) accountData.step = 2;
        break;
      }
        // Объединяем шаги 2, 3 и 4 с рандомизацией порядка
      case 2: {
        if (!accountData.randomized) {
          accountData.randomized = true;
          if (Math.random() < 0.5) {
            console.log(`Для ${accountData.email} выполняем: (Шаг 2 + Шаг 3) -> Шаг 4`);
            // Выполнение шагов 2 и 3
            const success2 = await stepLinkWallet(accountData);
            if (!success2) {
              console.error(`Шаг 2 не выполнен для ${accountData.email}`);
              break;
            }
            await delay(getRandomInterval(minDelay, maxDelay));

            const success3 = await stepConfirmWallet(accountData);
            if (!success3) {
              console.error(`Шаг 3 не выполнен для ${accountData.email}`);
              break;
            }
            await delay(getRandomInterval(minDelay, maxDelay));

            // Затем шаг 4
            const success4 = await stepFinalizeAccount(accountData);
            if (!success4) {
              console.error(`Шаг 4 не выполнен для ${accountData.email}`);
              break;
            }
          } else {
            console.log(`Для ${accountData.email} выполняем: Шаг 4 -> (Шаг 2 + Шаг 3)`);
            // Сначала шаг 4
            const success4 = await stepFinalizeAccount(accountData);
            if (!success4) {
              console.error(`Шаг 4 не выполнен для ${accountData.email}`);
              break;
            }
            await delay(getRandomInterval(minDelay, maxDelay));

            // Затем шаги 2 и 3
            const success2 = await stepLinkWallet(accountData);
            if (!success2) {
              console.error(`Шаг 2 не выполнен для ${accountData.email}`);
              break;
            }
            await delay(getRandomInterval(minDelay, maxDelay));

            const success3 = await stepConfirmWallet(accountData);
            if (!success3) {
              console.error(`Шаг 3 не выполнен для ${accountData.email}`);
              break;
            }
          }
          // После объединённых шагов сразу переходим к шагу 5
          accountData.step = 5;
          stepDone = true;
        }
        break;
      }
      case 5: {
        console.log(`Шаг 5: Сохраняем результат для ${accountData.email}`);
        // Сохраняем данные в Redis
        await RedisWorker.setSession(
            accountData.email,
            JSON.stringify({
              accessToken: accountData.accessToken,
              userId: accountData.userId,
            })
        );

        // Пишем в файл
        const rotatingProxy = ROTATING_PROXY.replace("{COUNTRY}", accountData.country);
        const lineToAppend =
            ([
                  accountData.email,
                  accountData.password,
                  accountData.currentRefreshToken,
                  accountData.clientId,
                ].join("|") +
                "|" +
                [
                  accountData.finalPassword,
                  accountData.proxyUrl,
                  accountData.accessToken,
                  accountData.userId,
                  accountData.userAgent,
                  accountData.privateKeyBase58,
                  accountData.publicKeyBase58,
                  rotatingProxy,
                  accountData.brandVersion
                ].join("|")) +
            "\n";

        console.log(lineToAppend);
        await fs.appendFile("data/ready_accounts.txt", lineToAppend);
        accountData.step = 6; // Успешно закончили все шаги
        stepDone = true;
        break;
      }
      default:
        break;
    }

    if (accountData.step === 6) break;
    if (!stepDone) {
      console.log(`Шаг ${accountData.step} неудачен, пробуем ещё раз...`);
      await delay(getRandomInterval(minDelay, maxDelay));
    }
  }

  if (accountData.step < 6) {
    console.log(`Превышено число попыток для ${accountData.email}. Сохраняем прогресс, переходим к следующему.`);
  } else {
    console.log(`Аккаунт ${accountData.email} успешно обработан.`);
  }
}


async function main() {
  await RedisWorker.init();

  const emailsData = (await fs.readFile("data/emails.txt", "utf-8"))
      .split("\n")
      .filter((line) => line.trim() !== "");

  const promises = [];
  for (let i = 0; i < emailsData.length; i++) {
    const emailData = emailsData[i];
    promises.push(processAccount(emailData, i));
    // Между аккаунтами тоже делаем рандомную задержку
    await delay(getRandomInterval(minDelay, maxDelay));
  }

  await Promise.all(promises);
  process.exit(0);
}

main();
