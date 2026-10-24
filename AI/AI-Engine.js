const fs = require('fs');
const path = require('path');

class LauncherAI {
    constructor() {
        this.database = [];
        this.loadDatabase();
    }

    // Загружаем твой созданный JSON файл
    loadDatabase() {
        try {
            const jsonPath = path.join(__dirname, 'AI-Help.json');
            const data = fs.readFileSync(jsonPath, 'utf8');
            this.database = JSON.parse(data);
            console.log(`[AI System] База знаний успешно загружена. Всего сценариев: ${this.database.length}`);
        } catch (error) {
            console.error('[AI System] Ошибка при загрузке AI-Help.json:', error);
            this.database = [];
        }
    }

    // Вспомогательная функция для нечёткого сравнения слов (проверка схожести букв)
    isFuzzyMatch(word, keyword) {
        if (word.includes(keyword) || keyword.includes(word)) return true;
        
        // Если слова длинные, проверяем их схожесть (пропускаем мелкие опечатки)
        if (word.length > 4 && keyword.length > 4) {
            let matches = 0;
            for (let i = 0; i < word.length; i++) {
                if (keyword.includes(word[i])) matches++;
            }
            // Если больше 70% букв совпало, считаем, что слово угадано
            return (matches / keyword.length) > 0.7;
        }
        return false;
    }

    // Главная функция: принимает текст от игрока и возвращает ответ + действие
    analyzeMessage(userText) {
        if (!userText || typeof userText !== 'string') {
            return { reply: 'Я тебя не расслышала. Напиши что-нибудь!', action: null };
        }

        // Очищаем текст: переводим в нижний регистр и убираем знаки препинания (?, !, .)
        const cleanText = userText.toLowerCase().replace(/[?!.,]/g, '');
        // Разбиваем сообщение пользователя на отдельные слова
        const userWords = cleanText.split(/\s+/);

        // Ищем совпадения в базе знаний
        for (const item of this.database) {
            for (const keyword of item.keywords) {
                const keywordLower = keyword.toLowerCase();

                // 1. Прямая проверка: если пользователь просто ввел фразу целиком (например, "слабый ноут")
                if (cleanText.includes(keywordLower)) {
                    return { reply: item.reply, action: item.action };
                }

                // 2. Пословесная проверка с исправлением грамматики и опечаток
                for (const word of userWords) {
                    if (this.isFuzzyMatch(word, keywordLower)) {
                        return { reply: item.reply, action: item.action };
                    }
                }
            }
        }

        // Если лаунчер вообще ничего не понял из того, что написал игрок
        return {
            reply: 'Я пока только учусь и не совсем поняла этот вопрос. Ты можешь спросить меня про "оптимизацию", "как играть с другом" или "ошибки запуска"!',
            action: null
        };
    }
}

module.exports = new LauncherAI();
