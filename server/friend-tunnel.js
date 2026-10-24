const net = require('net');

class FriendTunnel {
    constructor(relayHost, relayPort) {
        this.relayHost = relayHost; // IP или домен твоего релей-сервера
        this.relayPort = relayPort; // Порт релей-сервера (например, 25566)
        this.activeServer = null;
        this.activeClient = null;
    }

    /**
     * Запускается у ХОСТА: ловит локальный порт майнкрафта и шлет на релей-сервер
     */
    startHost(roomCode, minecraftPort) {
        // Поднимаем локальный прокси-сервер для хоста
        const server = net.createServer((socket) => {
            const relay = net.createConnection({ host: this.relayHost, port: this.relayPort }, () => {
                // ДВУЯЗЫЧНАЯ ОТПРАВКА: шлем и t, и action, чтобы лаунчер точно понял!
                relay.write(JSON.stringify({ t: 'host', action: 'host', code: roomCode }));
            });

            // Перенаправляем трафик между релеем и локальным майнкрафтом хоста
            socket.pipe(relay);
            relay.pipe(socket);

            socket.on('error', () => {});
            relay.on('error', () => {});
        });

        // Слушаем локалхост, к которому будет стучаться релей через туннель
        server.listen(0, '127.0.0.1', () => {
            const localProxyPort = server.address().port;
            
            // Подключаемся к релею для регистрации комнаты
            const client = net.createConnection({ host: this.relayHost, port: this.relayPort }, () => {
                client.write(JSON.stringify({ t: 'host', action: 'host', code: roomCode }));
            });

            client.on('data', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    // Читаем событие из t или event
                    const currentEvent = msg.t || msg.event;
                    if (currentEvent === 'guest_connected' || msg.event === 'guest_connected') {
                        console.log('[Tunnel] К вам подключился друг!');
                    }
                } catch (e) {
                    // Если пошел игровой трафик, перенаправляем на локальный порт майнкрафта
                    const mcConn = net.createConnection({ host: '127.0.0.1', port: minecraftPort }, () => {
                        mcConn.write(data);
                    });
                    client.pipe(mcConn);
                    mcConn.pipe(client);
                }
            });

            this.activeServer = server;
        });
    }

    /**
     * Запускается у ДРУГА: создает локальный порт, на который друг заходит в майнкрафте
     */
    startGuest(roomCode) {
        return new Promise((resolve) => {
            const server = net.createServer((minecraftSocket) => {
                // Когда друг в майнкрафте нажимает "По сетевой игре" -> вводит локальный порт
                const relay = net.createConnection({ host: this.relayHost, port: this.relayPort }, () => {
                    // ДВУЯЗЫЧНАЯ ОТПРАВКА: шлем и t, и action
                    relay.write(JSON.stringify({ t: 'join', action: 'join', code: roomCode }));
                });

                minecraftSocket.pipe(relay);
                relay.pipe(minecraftSocket);

                minecraftSocket.on('error', () => {});
                relay.on('error', () => {});
            });

            server.listen(0, '127.0.0.1', () => {
                const localPort = server.address().port;
                this.activeClient = server;
                console.log(`[Tunnel] Туннель для гостя запущен. В игре подключайтесь на: 127.0.0.1:${localPort}`);
                resolve(localPort); // Вот этот порт лаунчер подставляет другу автоматически!
            });
        });
    }

    stop() {
        if (this.activeServer) this.activeServer.close();
        if (this.activeClient) this.activeClient.close();
    }
}

module.exports = FriendTunnel;
