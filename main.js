const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// 창 크기는 여러 곳(초기 생성, 드래그 이동)에서 재사용하니 상수로 고정
const WIDTH = 340;
const HEIGHT = 400;

// 앱 아이콘 — OS별로 확장자가 다름(Mac: .icns, Windows: .ico).
// 창 아이콘(BrowserWindow, Windows용)은 .ico를 그대로 쓰고,
// macOS Dock 아이콘(app.dock.setIcon)은 .icns 로딩이 실패하는 경우가 있어
// 더 안전한 PNG를 별도로 사용함.
const ICON_PATH = path.join(
  __dirname,
  'renderer',
  'assets',
  process.platform === 'win32' ? 'icon.ico' : 'icon.icns'
);
const DOCK_ICON_PATH = path.join(__dirname, 'renderer', 'assets', 'icon_512.png');

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const x = workArea.x + workArea.width - WIDTH - 40;
  const y = workArea.y + workArea.height - HEIGHT - 40;

  mainWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    backgroundThrottling: false,
    icon: ICON_PATH, // Windows에서 창/작업표시줄 아이콘으로 사용됨
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // macOS는 BrowserWindow의 icon 옵션만으로는 Dock 아이콘이 안 바뀌어서,
  // 개발 모드(npm start)에서도 보이도록 별도로 Dock 아이콘을 지정함.
  // 배포된 .app에서는 패키징된 아이콘(icon.icns)이 자동 적용되므로 이 코드는
  // 주로 npm start로 개발할 때를 위한 것.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(DOCK_ICON_PATH);
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 개발 중(npm start)일 때만 개발자 도구를 자동으로 열고,
  // 배포된 앱(app.isPackaged === true)에서는 사용자에게 보이지 않도록 함.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 렌더러가 완전히 로드된 다음에 첫 타이머 상태를 보내줘야
  // 창을 새로 열었을 때도 바로 정확한 시간이 표시됨.
  mainWindow.webContents.on('did-finish-load', () => {
    broadcastTimerState();
  });
}

// 렌더러에서 드래그 델타(dx, dy)를 보내면 창을 그만큼 이동.
// setPosition이 아니라 setBounds를 쓰고 width/height를 매번 명시해야
// Windows DPI 스케일링 환경에서 창이 서서히 커지는 버그를 피할 수 있음.
// (Mac에서는 이 버그가 없지만, 나중에 Windows로도 배포할 수 있으니 그대로 유지)
ipcMain.on('window-move', (event, dx, dy) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds(
    {
      x: Math.round(bounds.x + dx),
      y: Math.round(bounds.y + dy),
      width: WIDTH,
      height: HEIGHT,
    },
    false // macOS 애니메이션 없이 즉시 이동 (애니메이션이 잔상 원인 중 하나)
  );
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  createWindow();
  startTimerLoop();
});

app.on('window-all-closed', () => {
  app.quit();
});

// ===== 뽀모도로 타이머 =====
// main.js(메인 프로세스)가 타이머를 소유함 — 렌더러(화면)는 "지금 몇 분 남았는지"만
// 전달받아서 보여주는 역할만 함. 이렇게 해야 나중에 설정 패널을 닫아도 시간은 계속 흐름.

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    const workMinutes = Number(parsed.workMinutes);
    const breakMinutes = Number(parsed.breakMinutes);
    return {
      workMinutes: workMinutes > 0 ? workMinutes : 50,
      breakMinutes: breakMinutes > 0 ? breakMinutes : 10,
    };
  } catch (err) {
    // 파일이 아직 없거나(첫 실행) 깨져있으면 기본값으로 시작
    return { workMinutes: 50, breakMinutes: 10 };
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('타이머 설정 저장 실패:', err);
  }
}

let timerSettings = loadSettings();
let timerState = {
  mode: 'work', // 'work' 또는 'break'
  remainingSeconds: timerSettings.workMinutes * 60,
  isRunning: false,
};

function broadcastTimerState() {
  if (mainWindow) {
    mainWindow.webContents.send('timer-tick', {
      mode: timerState.mode,
      remainingSeconds: timerState.remainingSeconds,
      isRunning: timerState.isRunning,
      settings: timerSettings,
    });
  }
}

function startTimerLoop() {
  // 1초마다 항상 도는 루프. isRunning이 false면 그냥 아무것도 안 하고 넘어감.
  setInterval(() => {
    if (!timerState.isRunning) return;

    timerState.remainingSeconds -= 1;

    if (timerState.remainingSeconds <= 0) {
      // 작업 시간 끝나면 휴식으로, 휴식 끝나면 다시 작업으로 자동 전환
      timerState.mode = timerState.mode === 'work' ? 'break' : 'work';
      timerState.remainingSeconds =
        timerState.mode === 'work'
          ? timerSettings.workMinutes * 60
          : timerSettings.breakMinutes * 60;
    }

    broadcastTimerState();
  }, 1000);
}

ipcMain.handle('timer-get-state', () => ({
  mode: timerState.mode,
  remainingSeconds: timerState.remainingSeconds,
  isRunning: timerState.isRunning,
  settings: timerSettings,
}));

ipcMain.on('timer-set-durations', (event, workMinutes, breakMinutes) => {
  const w = Math.max(1, Math.round(Number(workMinutes) || timerSettings.workMinutes));
  const b = Math.max(1, Math.round(Number(breakMinutes) || timerSettings.breakMinutes));
  timerSettings = { workMinutes: w, breakMinutes: b };
  saveSettings(timerSettings);

  // 지금 멈춰있는 상태면, 남은 시간도 새로 입력한 값으로 바로 반영
  // (돌아가는 중이면 지금 진행 중인 걸 방해하지 않게 다음 전환 때부터 적용됨)
  if (!timerState.isRunning) {
    timerState.remainingSeconds =
      timerState.mode === 'work' ? timerSettings.workMinutes * 60 : timerSettings.breakMinutes * 60;
  }

  broadcastTimerState();
});

ipcMain.on('timer-start', () => {
  timerState.isRunning = true;
  broadcastTimerState();
});

ipcMain.on('timer-pause', () => {
  timerState.isRunning = false;
  broadcastTimerState();
});

ipcMain.on('timer-reset', () => {
  timerState.mode = 'work';
  timerState.remainingSeconds = timerSettings.workMinutes * 60;
  timerState.isRunning = false;
  broadcastTimerState();
});
