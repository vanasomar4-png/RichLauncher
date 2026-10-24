<!-- Кнопка вызова ИИ-помощника -->
<div id="ai-chat-toggle" onclick="toggleAIChat()">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
</div>

<!-- Окно чата ИИ -->
<div id="ai-chat-window" class="hidden">
    <div class="ai-chat-header">
        <div class="ai-header-title">
            <span class="ai-status-dot"></span>
            Помощник RichAI
        </div>
        <button class="ai-close-btn" onclick="toggleAIChat()">×</button>
    </div>
    <div id="ai-chat-messages" class="ai-chat-messages">
        <div class="message ai-message">Привет! Я твой локальный ИИ-помощник. Чем могу помочь? Ты можешь спросить меня про оптимизацию или как поиграть с другом!</div>
    </div>
    <div class="ai-chat-input-area">
        <input type="text" id="ai-user-input" placeholder="Задай вопрос (например: лагает игра)..." onkeydown="if(event.key === 'Enter') sendAIMessage()">
        <button id="ai-send-btn" onclick="sendAIMessage()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
    </div>
</div>
