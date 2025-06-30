# 🌱 Grass Auto-Registration Bot

Этот проект автоматизирует массовую регистрацию аккаунтов на платформе [Grass](https://getgrass.io), включая подтверждение почты, привязку кошелька и финализацию через API. Поддерживает работу с прокси, Redis, CapMonster, email-инбоксами и Solana-ключами.

## 🚀 Что делает скрипт

- Читает email-учётки из `data/emails.txt`
- Инициализирует прокси и user-agent
- Генерирует ключи на базе `tweetnacl`
- Регистрирует аккаунт и подтверждает OTP-код
- Линкует Solana-кошелёк
- Подтверждает привязку через ссылку из email
- Сохраняет userId и accessToken в Redis и файл

## ⚙️ Настройка

1. Установить зависимости:

npm install

2. Создать `.env` файл на основе `.env.example`:

STICKY_PROXY=...  
ROTATING_PROXY=...  
MIN_DELAY=1  
MAX_DELAY=30  
CAPMONSTER_KEY=...  
REDIS_URL=redis://...  
REFERRAL_CODE=...  
COUNTRY_COUNT=br=5,at=4

3. Убедись, что у тебя есть файл `data/emails.txt` в формате:

email:password:refreshToken:clientId

## 📦 Зависимости

- axios  
- puppeteer  
- redis  
- dotenv  
- tweetnacl  
- user-agents  
- mailparser, imapflow — для email обработки  
- capmonster для капчи  
- async-retry — устойчивость к ошибкам  
- http/https proxy agents

## 📁 Основные модули

- `index.js` — главный скрипт
- `registration-manager.js` — API-логика
- `wallet-linker.js` — привязка кошелька
- `wallet-confirmer.js` — подтверждение по email
- `redis-worker.js` — хранение данных

## 📊 Выходные данные

Успешные регистрации сохраняются в `data/ready_accounts.txt` в формате:

email|pass|refresh|clientId|newPass|proxy|token|userId|ua|privKey|pubKey|proxy2|brandVersion

## ⚠️ Предупреждение

Проект создан только для образовательных целей. Использование в продакшене — на свой риск.
