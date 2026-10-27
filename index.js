try { require('dotenv').config(); } catch (e) {}
const WebSocket = require('ws');
const fs = require('fs');
const http = require('http');
const https = require('https');

// Lấy PORT từ biến môi trường của Render
const PORT = process.env.PORT || 8080;

// Tạo HTTP server đáp ứng healthcheck & chống ngủ
http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'alive', uptime: process.uptime() }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}).listen(PORT, () => {
    console.log(`[HTTP] Server keep-alive đang chạy trên cổng ${PORT}`);
});

const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}/health`, () => {}).on('error', () => {});
    if (EXTERNAL_URL) {
        https.get(`${EXTERNAL_URL}/health`, () => {}).on('error', () => {});
    }
}, 180000);

// Lấy 3 Token từ biến môi trường
const tokens = [
    process.env.TOKEN_1,
    process.env.TOKEN_2,
    process.env.TOKEN_3
].filter(Boolean);

if (tokens.length === 0) {
    console.error('[-] Lỗi: Không tìm thấy TOKEN_1, TOKEN_2 hoặc TOKEN_3 trong biến môi trường!');
    process.exit(1);
}

// Đọc danh sách ID từ file id.json và lấy đúng 3 ID đầu tiên
let gamesToPush = [];
try {
    const rawData = fs.readFileSync('id.json', 'utf-8');
    const data = JSON.parse(rawData);
    const allGames = data.used_games || data;

    if (!Array.isArray(allGames) || allGames.length === 0) {
        throw new Error('File id.json không chứa mảng ID hợp lệ!');
    }

    // Lấy chính xác 3 ID đầu tiên
    gamesToPush = allGames.slice(0, 3);
    console.log(`[+] Đã tải ${gamesToPush.length} ID game cố định cho ${tokens.length} tài khoản.`);
} catch (error) {
    console.error('[-] Lỗi đọc file id.json:', error.message);
    process.exit(1);
}

// Hàm khởi chạy kết nối Discord cho từng tài khoản (Cố định ID, không đổi)
function startBot(token, accountIndex) {
    // Gán cố định: Acc 1 lấy ID thứ 1, Acc 2 lấy ID thứ 2, Acc 3 lấy ID thứ 3
    const assignedGameId = gamesToPush[accountIndex % gamesToPush.length];
    let heartbeatInterval = null;

    function connect() {
        const ws = new WebSocket('wss://gateway.discord.gg/?v=9&encoding=json');

        ws.on('open', () => {
            console.log(`[Acc #${accountIndex + 1}] Đã kết nối tới Discord Gateway WebSocket...`);
        });

        ws.on('message', (data) => {
            const payload = JSON.parse(data);
            const { op, d, t } = payload;

            if (op === 10) {
                const { heartbeat_interval } = d;
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ op: 1, d: null }));
                    }
                }, heartbeat_interval);

                // Gửi trạng thái với ID game cố định
                ws.send(JSON.stringify({
                    op: 2,
                    d: {
                        token: token,
                        capabilities: 8189,
                        properties: {
                            os: 'Windows',
                            browser: 'Chrome',
                            device: ''
                        },
                        presence: {
                            status: 'online',
                            since: 0,
                            activities: [{
                                name: 'Custom Game',
                                type: 0,
                                application_id: assignedGameId,
                                timestamps: { start: Date.now() }
                            }],
                            afk: false
                        }
                    }
                }));
            }

            if (t === 'READY') {
                console.log(`[Acc #${accountIndex + 1}] Đăng nhập thành công! Đang treo cố định Game ID: ${assignedGameId}`);
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`[Acc #${accountIndex + 1}] Kết nối đóng (${code}): ${reason}. Đang kết nối lại sau 5 giây...`);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            setTimeout(connect, 5000);
        });

        ws.on('error', (error) => {
            console.error(`[Acc #${accountIndex + 1}] Lỗi WebSocket:`, error.message);
        });
    }

    connect();
}

// Khởi chạy đồng thời cho cả 3 tài khoản
tokens.forEach((token, index) => {
    startBot(token, index);
});
