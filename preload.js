const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(캔버스)는 Node.js에 직접 접근 못 하니, 필요한 기능만
// 이렇게 뚫어서 노출시킵니다.
contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', dx, dy),
  // main.js가 uiohook으로 잡은 전역 마우스 위치를 렌더러(화면 코드)로 전달.
  // 렌더러는 이 함수에 콜백만 등록하면 되고, ipcRenderer 자체는 못 만짐(보안).
  onGlobalMouseMove: (callback) => {
    ipcRenderer.on('global-mouse-move', (event, pos) => callback(pos));
  },

  // ===== 뽀모도로 타이머 =====
  getTimerState: () => ipcRenderer.invoke('timer-get-state'),
  setTimerDurations: (workMinutes, breakMinutes) =>
    ipcRenderer.send('timer-set-durations', workMinutes, breakMinutes),
  startTimer: () => ipcRenderer.send('timer-start'),
  pauseTimer: () => ipcRenderer.send('timer-pause'),
  resetTimer: () => ipcRenderer.send('timer-reset'),
  onTimerUpdate: (callback) => {
    ipcRenderer.on('timer-tick', (event, state) => callback(state));
  },
});
