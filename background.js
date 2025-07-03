// 설정 기본값
let settings = {
  timeframe: '5m',
  volumeMultiplier: 3.0,
  topVolumePercent: 70,
  soundEnabled: true,
  isMonitoring: false
};

// 알림 히스토리
let alertHistory = [];

// 마지막 알림 시간 (중복 방지)
let lastAlertTimes = {};

// 대시보드 탭 ID 저장
let dashboardTabId = null;

// 활성화된 팝업 포트 보관
let connectedPorts = {};

// 설정 로드
chrome.storage.local.get(['settings', 'alertHistory'], (result) => {
  if (result.settings) settings = result.settings;
  if (result.alertHistory) alertHistory = result.alertHistory;
  
  // 저장된 상태가 모니터링 중이었다면 다시 시작
  if (settings.isMonitoring) {
    startMonitoring();
  }
  
  // 이미 최신 데이터로 동기화된 상태임을 표시
  chrome.storage.local.set({ lastSyncTime: Date.now() });
});

// 모니터링 시작 함수
function startMonitoring() {
  if (settings.isMonitoring) return; // 이미 모니터링 중이면 중복 시작 방지
  
  settings.isMonitoring = true;
  saveSettings();
  
  // 주기적으로 거래량 체크하는 알람 생성 (30초마다)
  chrome.alarms.create('volumeCheck', { periodInMinutes: 0.5 });
  
  // 첫 체크 바로 실행
  checkVolumeSurge();
}

// 모니터링 중지 함수
function stopMonitoring() {
  settings.isMonitoring = false;
  saveSettings();
  
  // 알람 제거
  chrome.alarms.clear('volumeCheck');
}

// 알람 이벤트 리스너
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'volumeCheck') {
    checkVolumeSurge();
  } else if (alarm.name === 'keepAlive') {
    console.log('Background script kept alive at ' + new Date().toLocaleTimeString());
  }
});

// 백그라운드 스크립트 활성 유지 (매 5분마다 핑)
chrome.alarms.create('keepAlive', { periodInMinutes: 5 });

// 거래량 급증 체크 함수
async function checkVolumeSurge() {
  try {
    // 상위 거래량 코인 가져오기
    const coins = await getTopVolumeCoins();
    
    // 각 코인별 거래량 확인
    for (const symbol of coins) {
      try {
        // 중복 알림 방지
        const now = Date.now();
        if (lastAlertTimes[symbol] && (now - lastAlertTimes[symbol] < 3 * 60 * 1000)) {
          continue;
        }
        
        // 거래량 급증 확인
        const result = await checkCoinVolume(symbol);
        if (result) {
          // 알림 생성
          createAlert(result);
          
          // 마지막 알림 시간 업데이트
          lastAlertTimes[symbol] = now;
        }
      } catch (error) {
        console.error(`Error checking ${symbol}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in volume check:', error);
  }
}

// 상위 거래량 코인 가져오기
async function getTopVolumeCoins() {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
    const data = await response.json();
    
    // USDT 페어만 필터링
    const usdtPairs = data.filter(item => 
      item.symbol.endsWith('USDT') && !item.symbol.endsWith('BUSDUSDT')
    ).map(item => ({
      symbol: item.symbol.slice(0, -4), // 'BTCUSDT' -> 'BTC'
      volume: parseFloat(item.quoteVolume)
    }));
    
    // 거래량 기준 정렬
    usdtPairs.sort((a, b) => b.volume - a.volume);
    
    // 상위 퍼센트만 선택
    const numCoins = Math.max(1, Math.floor(usdtPairs.length * settings.topVolumePercent / 100));
    return usdtPairs.slice(0, numCoins).map(pair => pair.symbol);
  } catch (error) {
    console.error('Error fetching top volume coins:', error);
    return [];
  }
}

// 코인별 거래량 급증 확인
async function checkCoinVolume(symbol) {
  try {
    const futuresSymbol = `${symbol}USDT`;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${futuresSymbol}&interval=${settings.timeframe}&limit=10`;
    
    const response = await fetch(url);
    const klines = await response.json();
    
    if (!klines || klines.length < 6) return null;
    
    // 현재 캔들
    const currentCandle = klines[klines.length - 1];
    const previousCandles = klines.slice(-6, -1);
    
    // 이전 5개 캔들의 평균 거래량 계산
    const currentVolume = parseFloat(currentCandle[5]);
    const avgVolume = previousCandles.reduce((sum, candle) => sum + parseFloat(candle[5]), 0) / 5;
    
    // 거래량 급증 확인
    if (currentVolume > avgVolume * settings.volumeMultiplier) {
      return {
        symbol: symbol,
        currentVolume: currentVolume,
        avgVolume: avgVolume,
        ratio: currentVolume / avgVolume,
        timeframe: settings.timeframe,
        timestamp: new Date().toISOString(),
        price: parseFloat(currentCandle[4]) // 현재 종가
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error checking volume for ${symbol}:`, error);
    return null;
  }
}

// 알림 생성
function createAlert(alertData) {
  // 알림 히스토리에 추가
  alertHistory.unshift(alertData);
  
  // 최대 100개만 저장
  if (alertHistory.length > 100) {
    alertHistory = alertHistory.slice(0, 100);
  }
  
  // 저장 - 항상 저장소에 최신 상태 유지
  persistAlertHistory();
  
  // 열려있는 모든 팝업과 대시보드에 알림 업데이트 메시지 전송
  broadcastAlertUpdate();
  
  // 브라우저 알림 표시
  if (settings.soundEnabled) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '바이낸스 거래량 급증 감지',
      message: `${alertData.symbol}: 평균 대비 ${alertData.ratio.toFixed(2)}배 증가`,
      priority: 2
    });
  }
}

// 알림 기록 영구 저장
function persistAlertHistory() {
  // 스토리지에 저장
  chrome.storage.local.set({ 
    alertHistory: alertHistory,
    lastUpdateTime: Date.now() 
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Storage error:', chrome.runtime.lastError);
    }
  });
}

// 모든 활성 팝업과 대시보드에 알림 업데이트 메시지 전송
function broadcastAlertUpdate() {
  try {
    // 1. 일반 메시지로 브로드캐스트
    chrome.runtime.sendMessage({ 
      action: 'alertsUpdated', 
      alerts: alertHistory,
      timestamp: Date.now()
    }).catch(error => {
      // 수신자가 없어도 에러를 표시하지 않음 (정상적인 상황)
      console.log('No receivers for general message');
    });
    
    // 2. 열려있는 대시보드 탭에 직접 전송
    if (dashboardTabId) {
      chrome.tabs.sendMessage(dashboardTabId, {
        action: 'alertsUpdated',
        alerts: alertHistory,
        timestamp: Date.now()
      }).catch(error => {
        console.log('Dashboard tab might be closed or unreachable', error);
        // 탭이 더 이상 존재하지 않을 수 있음
        dashboardTabId = null;
      });
    }
    
    // 3. 연결된 포트를 통해 메시지 전송
    Object.values(connectedPorts).forEach(port => {
      try {
        if (port && port.name === 'popup') {
          port.postMessage({
            action: 'alertsUpdated',
            alerts: alertHistory,
            timestamp: Date.now()
          });
        }
      } catch (e) {
        console.log('Error sending to port:', e);
        // 오류가 발생한 포트 제거
        const portId = Object.keys(connectedPorts).find(key => connectedPorts[key] === port);
        if (portId) delete connectedPorts[portId];
      }
    });
  } catch (error) {
    console.error('Error broadcasting alert update:', error);
  }
}

// 설정 저장
function saveSettings() {
  chrome.storage.local.set({ settings });
}

// 대시보드 실행 및 관리
function openDashboard() {
  // 이미 대시보드가 열려있는지 확인
  if (dashboardTabId !== null) {
    // 열려있는 탭으로 포커스 이동
    chrome.tabs.get(dashboardTabId, (tab) => {
      if (chrome.runtime.lastError) {
        // 탭이 존재하지 않으면 새로 열기
        createDashboardTab();
      } else {
        // 탭이 존재하면 활성화
        chrome.tabs.update(dashboardTabId, { active: true });
      }
    });
  } else {
    // 대시보드 탭 새로 열기
    createDashboardTab();
  }
}

// 대시보드 탭 생성
function createDashboardTab() {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.create({ url: dashboardUrl }, (tab) => {
    dashboardTabId = tab.id;
    
    // 탭 닫힘 이벤트 감지
    chrome.tabs.onRemoved.addListener(function onTabRemoved(tabId) {
      if (tabId === dashboardTabId) {
        dashboardTabId = null;
        // 이벤트 리스너 제거하여 메모리 누수 방지
        chrome.tabs.onRemoved.removeListener(onTabRemoved);
      }
    });
  });
}

// 연결된 팝업 등록 
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    const portId = Date.now().toString();
    connectedPorts[portId] = port;
    
    // 팝업이 연결되면 즉시 최신 알림 전송
    port.postMessage({
      action: 'alertsUpdated',
      alerts: alertHistory,
      timestamp: Date.now()
    });
    
    port.onDisconnect.addListener(() => {
      delete connectedPorts[portId];
      console.log('Port disconnected, remaining ports:', Object.keys(connectedPorts).length);
    });
  }
});

// 메시지 리스너 (팝업과 통신)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("메시지 수신:", message.action);
  
  if (message.action === 'getSettings') {
    sendResponse({ settings, isMonitoring: settings.isMonitoring });
  } else if (message.action === 'saveSettings') {
    settings = message.settings;
    saveSettings();
    sendResponse({ success: true });
  } else if (message.action === 'startMonitoring') {
    startMonitoring();
    sendResponse({ success: true, isMonitoring: true });
  } else if (message.action === 'stopMonitoring') {
    stopMonitoring();
    sendResponse({ success: true, isMonitoring: false });
  } else if (message.action === 'getAlerts') {
    console.log("전송할 알림 데이터:", alertHistory.length + "개");
    sendResponse({ alerts: alertHistory });
  } else if (message.action === 'clearAlerts') {
    alertHistory = [];
    persistAlertHistory();
    broadcastAlertUpdate();
    sendResponse({ success: true });
  } else if (message.action === 'openDashboard') {
    openDashboard();
    sendResponse({ success: true });
  } else if (message.action === 'registerPopup') {
    // 이제 registerPopup은 Port 연결로 대체됨
    sendResponse({ success: true, message: 'Use port connection instead' });
  } else if (message.action === 'unregisterPopup') {
    // 이제 unregisterPopup은 Port 연결로 대체됨
    sendResponse({ success: true, message: 'Use port disconnection instead' });
  } else if (message.action === 'dashboardClosed') {
    dashboardTabId = null;
    sendResponse({ success: true });
  } else if (message.action === 'ping') {
    // 백그라운드 스크립트가 살아있는지 확인하는 핑
    sendResponse({ success: true, timestamp: Date.now() });
  }
  
  return true; // 비동기 응답 유지
});