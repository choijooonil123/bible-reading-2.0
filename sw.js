// sw.js (프로젝트 루트에 두세요)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 선택: 네트워크 통과
self.addEventListener('fetch', () => {});
