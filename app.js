const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// 1. 'public' хавтсыг "Static" болгож зарлах
// Ингэснээр браузер CSS, JS, зураг зэргийг шууд унших боломжтой болно
app.use(express.static(path.join(__dirname, 'public')));

// 2. Үндсэн зам дээр 'public/index.html' файлыг харуулах
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Сервер http://localhost:${port} дээр аслаа`);
});