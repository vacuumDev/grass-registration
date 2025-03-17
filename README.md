### Настройка
```bash
npm install
```

### Заполнить .env файл
```dotenv
PROXY=*** # rotating proxy
```
### Заполнить data/emails.txt форматом
```text
email:password:refreshToken:clientId
```
### Запустить
```bash
node src/index.js
```

### После запуска появится файл data/ready_accounts.txt которые можно использовать в ферме
