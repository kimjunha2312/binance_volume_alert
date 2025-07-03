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
const searchInput = document.getElementById('search-alerts');
const filterSelect = document.getElementById('alerts-filter');
const clearAlertsBtn = document.getElementById('clear-alerts');
const alertsContainer = document.getElementById('alerts-container');

// 설정 및 상태 변수
let settings = {
  timeframe: '5m',
  volumeMultiplier: 3.0,
  topVolumePercent: 70,
  soundEnabled: true
};
let isMonitoring = false;
let alertsList = [];

// 페이지 로드 시 설정 및 상태 로드
document.addEventListener('DOMContentLoaded', () => {
  // 설정 가져오기
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response && response.settings) {
      settings = response.settings;
      isMonitoring = response.isMonitoring;
      
      // UI 업데이트
      updateUI();
    }
  });
  
  // 알림 목록 가져오기
  loadAlerts();
  
  // 이벤트 리스너 설정
  setupEventListeners();
});

// 백그라운드로부터 메시지 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 알림 업데이트 메시지 수신
  if (message.action === 'alertsUpdated' && message.alerts) {
    // 알림 목록 업데이트
    alertsList = message.alerts;
    
    // 현재 필터 적용하여 목록 갱신
    filterAlerts();
    
    // 선택적: 새 알림이 있다는 시각적 피드백 추가
    const pageTitle = document.querySelector('h1');
    if (pageTitle) {
      pageTitle.classList.add('new-alert-highlight');
      setTimeout(() => {
        pageTitle.classList.remove('new-alert-highlight');
      }, 3000);
    }
  }
  
  // 응답 처리 (필요하면)
  if (sendResponse) {
    sendResponse({ received: true });
  }
  
  // 비동기 응답 가능하게 함
  return true;
});

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
    statusText.textContent = '상태: 모니터링 중';
    statusText.className = 'status-active';
    toggleMonitoringBtn.textContent = '중지';
    toggleMonitoringBtn.className = 'stop';
  } else {
    statusText.textContent = '상태: 모니터링 중지됨';
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
  
  // 검색 및 필터링
  searchInput.addEventListener('input', filterAlerts);
  filterSelect.addEventListener('change', filterAlerts);
  
  // 알림 삭제 버튼
  clearAlertsBtn.addEventListener('click', clearAlerts);

  // 페이지가 닫힐 때 백그라운드 알림
  window.addEventListener('beforeunload', () => {
    // 백그라운드에게 탭이 닫힘을 알림
    chrome.runtime.sendMessage({ action: 'dashboardClosed' });
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

// 알림 목록 로드
function loadAlerts() {
  chrome.runtime.sendMessage({ action: 'getAlerts' }, (response) => {
    if (response && response.alerts) {
      alertsList = response.alerts;
      filterAlerts();
    } else {
      alertsContainer.innerHTML = '<p class="no-alerts">알림 데이터를 불러올 수 없습니다. 확장프로그램이 실행 중인지 확인하세요.</p>';
    }
  });
}

// 알림 필터링 및 표시
function filterAlerts() {
  const searchTerm = searchInput.value.toUpperCase();
  const ratioFilter = parseFloat(filterSelect.value);
  
  // 검색어와 필터 적용
  const filteredAlerts = alertsList.filter(alert => {
    const matchesSearch = alert.symbol.toUpperCase().includes(searchTerm);
    const matchesRatio = isNaN(ratioFilter) || alert.ratio >= ratioFilter;
    return matchesSearch && matchesRatio;
  });
  
  displayAlerts(filteredAlerts);
}

// 알림 표시
function displayAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    alertsContainer.innerHTML = '<p class="no-alerts">조건에 맞는 알림이 없습니다</p>';
    return;
  }
  
  let html = '';
  
  alerts.forEach(alert => {
    const date = new Date(alert.timestamp);
    const timeString = date.toLocaleTimeString();
    const dateString = date.toLocaleDateString();
    
    html += `
      <div class="alert-item">
        <div class="alert-header">
          <span class="alert-symbol">${alert.symbol}</span>
          <span class="alert-time">${dateString} ${timeString}</span>
        </div>
        <div class="alert-content">
          <div class="alert-metric">
            <span class="metric-label">거래량 급증:</span>
            <span class="metric-value">${alert.ratio.toFixed(2)}배</span>
          </div>
          <div class="alert-metric">
            <span class="metric-label">현재 가격:</span>
            <span class="metric-value">$${alert.price.toFixed(alert.price < 1 ? 6 : 3)}</span>
          </div>
          <div class="alert-metric">
            <span class="metric-label">타임프레임:</span>
            <span class="metric-value">${alert.timeframe}</span>
          </div>
        
          <div class="alert-actions">
          <a href="https://www.binance.com/en/futures/${alert.symbol}USDT" target="_blank" class="chart-link">
            차트 보기
          </a>
        </div>
        </div>
      </div>
    `;
  });
  
  alertsContainer.innerHTML = html;
}

// 모든 알림 삭제
function clearAlerts() {
  if (confirm('모든 알림을 삭제하시겠습니까?')) {
    chrome.runtime.sendMessage({ action: 'clearAlerts' }, (response) => {
      if (response && response.success) {
        alertsList = [];
        alertsContainer.innerHTML = '<p class="no-alerts">아직 알림이 없습니다</p>';
      }
    });
  }
}

// 새 알림 받았을 때 스타일을 위한 CSS 추가
const newAlertStyle = document.createElement('style');
newAlertStyle.textContent = `
  .new-alert-highlight {
    animation: highlightNew 1.5s ease-in-out;
  }
  
  @keyframes highlightNew {
    0%, 100% { color: #1976d2; }
    50% { color: #f44336; }
  }
`;
document.head.appendChild(newAlertStyle);