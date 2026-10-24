const net = require('net');

const PORT = process.env.PORT || 25566;
const rooms = new Map(); // Хранит активные комнаты: code -> { hostSocket, guests: [] }

const server = net.createServer((socket) => {
    let roomCode = null;
    let role = null; // 'host' или 'guest'

    socket.on('data', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            // ПЕРЕВОДЧИК: берем команду из 't' или из 'action'
            const currentAction = msg.t || msg.action;
            
            // Регистрация комнаты хостом
            if (currentAction === 'host') {
                roomCode = msg.code;
                role = 'host';
                rooms.set(roomCode, { hostSocket: socket, guests: [] });
                console.log(`[Server] Хост создал комнату: ${roomCode}`);
                // Отвечаем лаунчеру тоже в двух форматах
                socket.write(JSON.stringify({ t: 'ok', status: 'ok' }));
                return;
            }

            // Подключение друга (гостя)
            if (currentAction === 'join') {
                roomCode = msg.code;
                role = 'guest';
                const room = rooms.get(roomCode);
                if (room) {
                    room.guests.push(socket);
                    console.log(`[Server] Друг подключился к комнате: ${roomCode}`);
                    socket.write(JSON.stringify({ t: 'ok', status: 'ok' }));
                    // Уведомляем хоста, что кто-то зашел (передаем и t, и event)
                    if (room.hostSocket && !room.hostSocket.destroyed) {
                        room.hostSocket.write(JSON.stringify({ t: 'guest_connected', event: 'guest_connected' }));
                    }
                } else {
                    socket.write(JSON.stringify({ t: 'error', status: 'error', message: 'Room not found' }));
                    socket.end();
                }
                return;
            }
        } catch (e) {
            // Если это не JSON, значит пошел чистый игровой трафик Minecraft
            if (roomCode && rooms.has(roomCode)) {
                const room = rooms.get(roomCode);
                if (role === 'host' && room.guests.length > 0) {
                    // Трафик от хоста пересылаем гостям
                    room.guests.forEach(guest => {
                        if (!guest.destroyed) guest.write(data);
                    });
                } else if (role === 'guest' && room.hostSocket && !room.hostSocket.destroyed) {
                    // Трафик от гостя пересылаем хосту
                    room.hostSocket.write(data);
                }
            }
        }
    });

    socket.on('close', () => {
        if (roomCode && rooms.has(roomCode)) {
            const room = rooms.get(roomCode);
            if (role === 'host') {
                console.log(`[Server] Хост закрыл комнату: ${roomCode}`);
                room.guests.forEach(g => g.end());
                rooms.delete(roomCode);
            } else if (role === 'guest') {
                room.guests = room.guests.filter(g => g !== socket);
                console.log(`[Server] Гость вышел из комнаты: ${roomCode}`);
            }
        }
    });

    socket.on('error', (err) => {
        // Ошибки соединения гасим, чтобы сервер не падал
    });
});

server.listen(PORT, () => {
    console.log(`[Server] Релей-сервер запущен на порту ${PORT}`);
});
