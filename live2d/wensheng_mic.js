(() => {
  const button = document.getElementById("wenshengMic");
  const input = document.getElementById("userInput");
  let current = null;

  function update(title, pressed) {
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", String(pressed));
  }

  async function transcribe(recording) {
    clearTimeout(recording.timer);
    recording.stream.getTracks().forEach(track => track.stop());
    button.disabled = true;
    update("正在本機辨識語音", false);
    try {
      const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType });
      const audio = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const response = await fetch("/api/wensheng-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio })
      });
      const data = await response.json();
      if (!response.ok || !data.text) throw new Error(data.error || "語音辨識失敗");
      input.value = (input.value.trim() + " " + data.text).trim();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      update("語音已轉為文字，確認後送出", false);
    } catch (error) {
      update(error.message || "語音辨識失敗", false);
      alert(button.title);
    } finally {
      button.disabled = false;
      current = null;
    }
  }

  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    button.disabled = true;
    update("目前無法使用麥克風錄音", false);
    return;
  }

  button.addEventListener("click", async () => {
    if (current) {
      if (current.recorder.state === "recording") current.recorder.stop();
      return;
    }
    button.disabled = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const recording = { stream, recorder, chunks: [] };
      recorder.ondataavailable = event => {
        if (event.data.size) recording.chunks.push(event.data);
      };
      recorder.onstop = () => transcribe(recording);
      recorder.start();
      current = recording;
      recording.timer = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 15000);
      update("結束錄音並辨識", true);
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      update("請確認 Windows 已允許麥克風", false);
      alert(button.title);
    } finally {
      button.disabled = false;
    }
  });
})();
