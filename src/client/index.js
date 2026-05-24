const getWsTargetUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

const CONFIG = {
  wsUrl: getWsTargetUrl(),
  maxReconnectDelay: 30000,
  baseReconnectDelay: 1000,
};

let wssClient = null;
let reconnectAttempts = 0;
let reconnectTimeoutId = null;

const nodes = {
  statusBar: document.querySelector('#status-bar'),
  button: document.querySelector('#submit-button'),
  messageInput: document.querySelector('#message-input'),
  messagesDiv: document.querySelector('#message-container'),
};

const getOrCreateUserId = () => {
  let id = sessionStorage.getItem('userId');
  if (!id) {
    id = `user_${Date.now()}`;
    sessionStorage.setItem('userId', id);
  }
  return id;
};

const userId = getOrCreateUserId();

const updateUIState = (isConnected) => {
  if (isConnected) {
    nodes.statusBar.style.background = '#80EF80';
    nodes.statusBar.textContent = 'connected';
    nodes.button.removeAttribute('disabled');
    nodes.messageInput.removeAttribute('disabled');
  } else {
    nodes.statusBar.style.background = '#ff746c';
    nodes.statusBar.textContent = 'reconnecting...';
    nodes.button.setAttribute('disabled', 'true');
    nodes.messageInput.setAttribute('disabled', 'true');
  }
};

const renderMessageHTML = (from, text, timestamp) => {
  const isYou = from === userId;
  const sender = isYou ? 'You' : from;
  const timeStr = new Date(timestamp).toISOString();
  return `<p id="message-text"><b>${sender}:</b> ${text} <i id="timestamp">${timeStr}</i></p>`;
};

const handleMessage = (event) => {
  try {
    const response = JSON.parse(event.data);

    if (response.status === 'connected') return;

    if (response.type === 'HISTORY') {
      nodes.messagesDiv.innerHTML = '';
      const historyHTML = response.payload
        .map((msg) => renderMessageHTML(msg.from, msg.text, msg.timestamp))
        .join('');
      nodes.messagesDiv.insertAdjacentHTML('beforeend', historyHTML);
      return;
    }

    const singleMessageHTML = renderMessageHTML(response.from, response.text, response.timestamp);
    nodes.messagesDiv.insertAdjacentHTML('beforeend', singleMessageHTML);
  } catch (error) {
    console.error('Failed to parse WS message:', error, event.data);
  }
};

const connect = () => {
  if (wssClient) {
    wssClient.close();
    wssClient.onopen = null;
    wssClient.onmessage = null;
    wssClient.onclose = null;
  }
  clearTimeout(reconnectTimeoutId);

  const url = new URL(CONFIG.wsUrl);
  url.searchParams.set('userId', userId);

  wssClient = new WebSocket(url.href);

  wssClient.onopen = () => {
    reconnectAttempts = 0;
    updateUIState(true);
  };

  wssClient.onmessage = handleMessage;

  wssClient.onclose = () => {
    updateUIState(false);
    reconnectAttempts++;

    const delay =
      reconnectAttempts === 1
        ? 200
        : Math.min(
            CONFIG.baseReconnectDelay * Math.pow(2, reconnectAttempts),
            CONFIG.maxReconnectDelay,
          );

    reconnectTimeoutId = setTimeout(connect, delay);
  };
};

const sendMessage = () => {
  const text = nodes.messageInput.value.trim();
  if (!text) return;

  if (wssClient && wssClient.readyState === WebSocket.OPEN) {
    wssClient.send(JSON.stringify({ text }));
    nodes.messageInput.value = '';
  }
};

nodes.button.addEventListener('click', sendMessage);
nodes.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

connect();
