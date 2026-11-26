(() => {
  "use strict";

  const dictionaries = window.AmadeusZhTwDictionaries ?? [];
  const containsHan = /[\u3400-\u9fff\uf900-\ufaff]/;
  const conversion = dictionaries.map(words => ({
    words,
    longest: Object.keys(words).reduce((length, word) => Math.max(length, word.length), 1)
  }));

  const phrases = new Map(Object.entries({
    "Amadeus System": "Amadeus 系統",
    "Live2D initializing": "正在初始化 Live2D",
    "Live2D online": "Live2D 已就緒",
    "Live2D load failed": "無法載入 Live2D",
    "Loading Cubism model": "正在載入 Cubism 模型",
    "SpokenTextJa": "日文朗讀稿",
    "Speech units": "朗讀段落",
    "Status": "狀態",
    "Browse": "瀏覽",
    "Save": "儲存",
    "Cancel": "取消",
    "Close": "關閉",
    "Open": "開啟",
    "Continue": "繼續",
    "Retry": "重試",
    "System": "系統",
    "Startup greeting local": "本機開場問候",
    "Backend reconnect": "正在重新連線到後端",
    "Local backend lost": "本機後端已中斷",
    "API reconnect": "API 重新連線中",
    "Developer mode": "開發者模式",
    "Developer preview": "開發者預覽",
    "Local config": "本機設定",
    "Awaiting identifier": "等待識別",
    "Unknown channel": "未知頻道",
    "Auto / neutral": "自動／平常",
    "TTS endpoint": "語音合成服務網址",
    "TTS locale": "朗讀語言地區",
    "Historical context": "歷史對話脈絡",
    "No connection": "未連線",
    "No data": "沒有資料",
    "Not configured": "尚未設定",
    "Initialize system": "初始化系統",
    "Connecting boot device": "連接開機裝置",
    "Selecting OS control device": "選擇作業系統控制裝置",
    "Memory initialization": "初始化記憶體",
    "Mounting proc at": "掛載 proc 至",
    "Mounting sysfs at": "掛載 sysfs 至",
    "Detecting network": "偵測網路",
    "Setting up localhost": "設定本機位址",
    "Setting up routes": "設定路由",
    "Loading system image": "載入系統映像",
    "Uncompressing files": "解壓縮檔案",
    "Launching X": "啟動顯示服務",
    "Unknown": "未知",
    "Identifier": "識別碼",
    "Recording": "錄音中",
    "Thinking": "思考中",
    "Loading": "載入中",
    "Starting": "啟動中",
    "Streaming": "接收中",
    "Reconnecting": "重新連線中",
    "Connected": "已連線",
    "Failed": "失敗",
    "Error": "錯誤",
    "Offline": "離線",
    "Online": "已上線",
    "Disabled": "已停用",
    "Enabled": "已啟用",
    "Pending": "等待中",
    "Ready": "就緒",
    "Success": "成功",
    "Cancelled": "已取消",
    "Developer": "開發者",
    "Connection": "連線",
    "Settings": "設定",
    "Default": "預設",
    "Typical": "一般",
    "Strong": "強烈",
    "Subtle": "輕微",
    "Custom": "自訂",
    "Speaker": "語音ID",
    "Agent": "助理",
    "Endpoint": "服務網址",
    "Style Map": "語氣對照表",
    "Skill": "技能",
    "Token": "詞元",
    "Tokens": "詞元",
    "Model": "模型",
    "Key": "金鑰",
    "Local": "本機",
    "Cloud": "雲端",
    "Search": "搜尋",
    "Assistant": "助理",
    "User": "使用者",
    "You": "你",
    "File": "檔案",
    "Tool": "工具",
    "Todo": "待辦",
    "Mem": "記憶",
    "Id": "識別碼",
    "Ok": "完成",
    "Bytes": "位元組"
  }).map(([from, to]) => [from.toLowerCase(), to]));

  const feelings = new Map(Object.entries({
    neutral: "平常", idle: "待命", boot: "啟動", thinking: "思考中",
    affectionate: "親切", amused: "愉快", annoyed: "不悅",
    awkward: "尷尬", concerned: "擔心", excited: "興奮",
    flustered: "慌張", focused: "專注", furious: "生氣",
    glitch: "故障", laugh: "大笑", laughing: "笑著", lean: "靠近",
    look_away: "移開視線", melancholic: "低落", nod: "點頭",
    perk: "振作", protective: "保護", proud: "得意", recoil: "後退",
    shy: "害羞", skeptical: "懷疑", smile: "微笑", soften: "放鬆",
    startled: "吃驚", tap: "輕觸", teasing: "逗趣", tilt: "歪頭",
    explain: "說明", test: "測試", joy: "高興", anger: "生氣",
    sadness: "難過", surprise: "驚訝", unhappy: "不開心"
  }));

  // Keep links, paths, command examples and JSON property names usable when copied.
  const protectedLiteral = /(`[^`\n]+`|(?:https?:\/\/|[A-Za-z]:\\|\/(?:dev|persona)\b)[^\s<>"，。；！？）]+|(?:[\w.-]+\/)+[\w.-]+\.(?:jsonl?|js|md|txt|exe|wav|ps1|cmd)\b)/gi;
  const phrasePattern = new RegExp(
    "\\b(?:" + [...phrases.keys()].sort((left, right) => right.length - left.length)
      .map(word => word.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "gi"
  );
  const renderedText = new WeakMap();
  const settingsAttributes = ["title", "placeholder", "aria-label", "aria-description", "aria-valuetext", "alt"];
  const skipText = [
    "script", "style", "noscript", "textarea", "code", "pre", "kbd", "samp",
    "[contenteditable='true']", "[data-preserve-locale]", ".msg.user .message-body",
    ".message-file-label", ".dev-ja-line", "#devSpokenJa", "#devSpokenRepair"
  ].join(", ");

  function convertChinese(text) {
    if (!containsHan.test(text)) return text;
    for (const { words, longest } of conversion) {
      let localized = "";
      for (let position = 0; position < text.length;) {
        const character = text[position];
        let count = Math.min(longest, text.length - position);
        let word = character;
        let replacement;
        if (containsHan.test(character)) {
          while (count > 0) {
            word = text.slice(position, position + count);
            if (Object.hasOwn(words, word)) {
              replacement = words[word];
              break;
            }
            count--;
          }
        }
        localized += replacement ?? character;
        position += replacement === undefined ? 1 : word.length;
      }
      text = localized;
    }
    return text;
  }

  function localizeText(raw) {
    if (typeof raw !== "string" || !raw.trim()) return raw;
    return raw.split(protectedLiteral).map((part, index) => {
      if (index % 2) return part;
      const translated = convertChinese(part)
        .replace(/本地/g, "本機")
        .replace(/未配置/g, "尚未設定")
        .replace(/聊天記錄/g, "聊天紀錄")
        .replace(/processor (\d+) is activated/gi, "處理器 $1 已啟用")
        .replace(/init:\s*kernel version ([\d.]+) booting/gi, "正在啟動核心 $1 版")
        .replace(/\b(\d+)\s*ms\b/gi, "$1 毫秒")
        .replace(/\+(\d+)m\b/g, "延後 $1 分鐘")
        .replace(/\b(?:lite|full)(?=\s+[\u3400-\u9fff])/gi, "")
        .replace(phrasePattern, word => phrases.get(word.toLowerCase()));
      return translated.replace(/(?<![A-Za-z0-9_])(?:affectionate|amused|annoyed|awkward|boot|concerned|excited|flustered|focused|furious|glitch|idle|laugh|laughing|lean|look_away|melancholic|neutral|nod|perk|protective|proud|recoil|shy|skeptical|smile|soften|startled|tap|teasing|tilt|explain)(?=\s*\/)/gi,
        word => feelings.get(word.toLowerCase()) ?? word);
    }).join("");
  }

  function localizeStatus(label) {
    return label.split("/").map(part => {
      const word = part.trim();
      return feelings.get(word.toLowerCase()) ?? localizeText(word);
    }).join(" ／ ");
  }

  function translateAttributes(element) {
    if (element.closest("[data-preserve-locale]")) return;
    for (const attribute of settingsAttributes) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const translated = localizeText(value);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(skipText)) return;
    const value = node.nodeValue;
    if (renderedText.get(node) === value) return;
    const translated = localizeText(value);
    renderedText.set(node, translated);
    if (translated === value) return;
    if (parent.tagName === "OPTION" && !parent.hasAttribute("value")) {
      parent.setAttribute("value", parent.value);
    }
    node.nodeValue = translated;
  }

  function translateTree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.closest(skipText)) return;
    translateAttributes(node);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(child) {
        return child.nodeType === Node.ELEMENT_NODE && child.matches(skipText)
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) translateTextNode(walker.currentNode);
      else translateAttributes(walker.currentNode);
    }
  }

  window.AmadeusLocale = Object.freeze({ text: localizeText, status: localizeStatus });
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.alert = value => nativeAlert(localizeText(String(value ?? "")));
  window.confirm = value => nativeConfirm(localizeText(String(value ?? "")));
  window.prompt = (value, initial) => nativePrompt(localizeText(String(value ?? "")), initial);

  const pendingNodes = new Set();
  const pendingAttributes = new Set();
  const options = {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: settingsAttributes
  };
  let scheduled = false;
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") pendingAttributes.add(record.target);
      else if (record.type === "characterData") pendingNodes.add(record.target);
      else for (const node of record.addedNodes) pendingNodes.add(node);
    }
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flushTranslations);
    }
  });

  function flushTranslations() {
    scheduled = false;
    // Do not observe the translation writes themselves.
    observer.disconnect();
    try {
      for (const node of pendingNodes) if (node.isConnected) translateTree(node);
      for (const element of pendingAttributes) if (element.isConnected) translateAttributes(element);
    } finally {
      pendingNodes.clear();
      pendingAttributes.clear();
      observer.observe(document.documentElement, options);
    }
  }

  function startLocalization() {
    translateTree(document.documentElement);
    observer.observe(document.documentElement, options);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startLocalization, { once: true });
  } else {
    startLocalization();
  }
})();
