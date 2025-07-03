// DOM 요소
const statusText = document.getElementById('status-text');
const toggleMonitoringBtn = document.getElementById('toggle-monitoring');
const timeframeSelect = document.getElementById('timeframe');
const volumeMultiplierInput = document.getElementById('volume-multiplier');
const volumeMultiplierValue = document.getElementById('volume-multiplier-value');
const topVolumeInput = document.getElementById('top-volume');
const topVolumeValue = document.getElementById('top-volume-value');
const soundEnabledCheckbox = document.getElementById('sound-enabled');
const saveSettingsBtn = document.getElementById('save-settings');
const viewDashboardBtn = document.getElementById('view-dashboard');
const alertsContainer = document.getElementById('alerts-container');

// 설정 및 상태 변수
let settings = {
  timeframe: '5m',
  volumeMultiplier: 3.0,
  topVolumePercent: 70,
  soundEnabled: true
};
let isMonitoring = false;

// 표시할 알림 수
const MAX_POPUP_ALERTS = 10; // 기존 5개에서 10개로 늘림

// 백그라운드 연결 포트
let port = null;
let connectionFailed = false;
let lastUpdateTimestamp = 0;
let retryCount = 0;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
  // 백그라운드 연결
  connectToBackground();
  
  // 설정 가져오기
  await loadSettings();
  
  // 최근 알림 가져오기
  await loadRecentAlerts();
  
  // 이벤트 리스너 설정
  setupEventListeners();
  
  // 연결 상태 주기적 확인
  setInterval(checkConnection, 10000);
});

// 백그라운드에 연결
function connectToBackground() {
  try {
    // 포트 연결 생성
    port = chrome.runtime.connect({ name: 'popup' });
    connectionFailed = false;
    retryCount = 0;
    
    // 메시지 리스너 설정
    port.onMessage.addListener((message) => {
      // 알림 업데이트 메시지 수신
      if (message.action === 'alertsUpdated' && message.alerts) {
        // 중복 업데이트 방지 (타임스탬프 비교)
        if (message.timestamp && message.timestamp > lastUpdateTimestamp) {
          lastUpdateTimestamp = message.timestamp;
          displayRecentAlerts(message.alerts);
        }
      }
    });
    
    // 연결 해제 감지
    port.onDisconnect.addListener(() => {
      console.log('Disconnected from background. Attempting to reconnect...');
      port = null;
      
      // 연결 끊김 시 재연결 시도 (모든 시도 실패시 오류 표시)
      if (retryCount < 3) {
        retryCount++;
        setTimeout(connectToBackground, 1000); // 1초 후 재시도
      } else {
        connectionFailed = true;
        showConnectionError();
      }
    });
  } catch (error) {
    console.error('Failed to connect to background:', error);
    connectionFailed = true;
    showConnectionError();
  }
}

// 연결 상태 체크
function checkConnection() {
  if (!port && !connectionFailed) {
    console.log('Connection check: reconnecting to background...');
    connectToBackground();
  }
  
  // 10초마다 알림 새로고침
  if (port) {
    loadRecentAlerts();
  }
}

// 연결 오류 표시
function showConnectionError() {
  alertsContainer.innerHTML = `
    <div class="connection-error">
      <p>백그라운드 연결에 실패했습니다. 확장 프로그램이 활성화되어 있는지 확인하세요.</p>
      <button id="retry-connection">재연결 시도</button>
    </div>
  `;
  
  document.getElementById('retry-connection')?.addEventListener('click', () => {
    connectionFailed = false;
    retryCount = 0;
    connectToBackground();
    loadRecentAlerts();
  });
}

// 설정 로드
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (response && response.settings) {
        settings = response.settings;
        isMonitoring = response.isMonitoring;
        updateUI();
      }
      resolve();
    });
  });
}

// UI 업데이트 함수
function updateUI() {
  // 설정값으로 UI 업데이트
  timeframeSelect.value = settings.timeframe;
  volumeMultiplierInput.value = settings.volumeMultiplier;
  volumeMultiplierValue.textContent = settings.volumeMultiplier;
  topVolumeInput.value = settings.topVolumePercent;
  topVolumeValue.textContent = settings.topVolumePercent;
  soundEnabledCheckbox.checked = settings.soundEnabled;
  
  // 모니터링 상태 업데이트
  if (isMonitoring) {
    statusText.textContent = '모니터링 중';
    statusText.className = 'status-active';
    toggleMonitoringBtn.textContent = '중지';
    toggleMonitoringBtn.className = 'stop';
  } else {
    statusText.textContent = '모니터링 중지됨';
    statusText.className = 'status-inactive';
    toggleMonitoringBtn.textContent = '시작';
    toggleMonitoringBtn.className = 'start';
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  // 슬라이더 값 실시간 표시
  volumeMultiplierInput.addEventListener('input', () => {
    volumeMultiplierValue.textContent = volumeMultiplierInput.value;
  });
  
  topVolumeInput.addEventListener('input', () => {
    topVolumeValue.textContent = topVolumeInput.value;
  });
  
  // 설정 저장 버튼
  saveSettingsBtn.addEventListener('click', saveSettings);
  
  // 모니터링 토글 버튼
  toggleMonitoringBtn.addEventListener('click', toggleMonitoring);
  
  // 대시보드 보기 버튼 - 백그라운드를 통해 열기
  viewDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
    // 팝업 닫기 (선택적)
    window.close();
  });
}

// 설정 저장
function saveSettings() {
  // UI에서 값 가져오기
  settings.timeframe = timeframeSelect.value;
  settings.volumeMultiplier = parseFloat(volumeMultiplierInput.value);
  settings.topVolumePercent = parseInt(topVolumeInput.value);
  settings.soundEnabled = soundEnabledCheckbox.checked;
  
  // 백그라운드에 설정 저장 요청
  chrome.runtime.sendMessage(
    { action: 'saveSettings', settings },
    (response) => {
      if (response && response.success) {
        // 저장 성공 표시
        const saveBtn = document.getElementById('save-settings');
        saveBtn.textContent = '저장 완료!';
        setTimeout(() => {
          saveBtn.textContent = '설정 저장';
        }, 1500);
      }
    }
  );
}

// 모니터링 상태 토글
function toggleMonitoring() {
  const action = isMonitoring ? 'stopMonitoring' : 'startMonitoring';
  
  chrome.runtime.sendMessage({ action }, (response) => {
    if (response && response.success) {
      isMonitoring = response.isMonitoring;
      updateUI();
    }
  });
}

// 최근 알림 로드
async function loadRecentAlerts() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getAlerts' }, (response) => {
      if (response && response.alerts) {
        displayRecentAlerts(response.alerts);
      }
      resolve();
    });
  });
}

// 최근 알림 표시
function displayRecentAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    alertsContainer.innerHTML = '<p class="no-alerts">아직 알림이 없습니다</p>';
    return;
  }
  
  // 최근 알림만 표시 (개수 증가)
  const recentAlerts = alerts.slice(0, MAX_POPUP_ALERTS);
  let html = '';
  
  recentAlerts.forEach(alert => {
    const time = new Date(alert.timestamp).toLocaleTimeString();
    html += `
      <div class="alert-item">
        <div class="alert-header">
          <span class="alert-symbol">
            <a href="https://www.binance.com/en/futures/${alert.symbol}USDT" target="_blank" class="symbol-link">
              ${alert.symbol}
            </a>
          </span>
          <span class="alert-time">${time}</span>
        </div>
        <div class="alert-details">
          <span class="alert-ratio">거래량 ${alert.ratio.toFixed(2)}배</span>
          <span class="alert-price">가격: $${alert.price.toFixed(alert.price < 1 ? 6 : 3)}</span>
        </div>
      </div>
    `;
  });
  
  if (alerts.length > MAX_POPUP_ALERTS) {
    html += `
      <div class="more-alerts">
        <button id="view-all-alerts" class="view-all">더 많은 알림 보기 (${alerts.length - MAX_POPUP_ALERTS}개 더)</button>
      </div>
    `;
  }
  
  alertsContainer.innerHTML = html;
  
  // 더 많은 알림 보기 버튼 클릭 시 대시보드 열기
  document.getElementById('view-all-alerts')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
    window.close();
  });
}

// 오류 표시 (추가)
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  
  document.body.appendChild(errorDiv);
  
  setTimeout(() => {
    errorDiv.remove();
  }, 5000);
}