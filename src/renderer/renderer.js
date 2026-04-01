const STATUS_LABELS = {
  working: "Working",
  idle: "Idle",
  error: "Error"
};
const AI_LABELS = {
  disabled: "AI Off",
  "missing-config": "AI Key Missing",
  ready: "AI Ready",
  classifying: "AI Working",
  active: "AI Active",
  fallback: "AI Fallback"
};

const statusDot = document.getElementById("statusDot");
const aiDot = document.getElementById("aiDot");
const discordDot = document.getElementById("discordDot");
const statusValue = document.getElementById("statusValue");
const toolBadge = document.getElementById("toolBadge");
const projectValue = document.getElementById("projectValue");
const phaseValue = document.getElementById("phaseValue");
const fileValue = document.getElementById("fileValue");
const diffValue = document.getElementById("diffValue");
const sessionValue = document.getElementById("sessionValue");
const aiValue = document.getElementById("aiValue");
const connectionValue = document.getElementById("connectionValue");
const settingsButton = document.getElementById("settingsButton");
const minimizeButton = document.getElementById("minimizeButton");
const closeButton = document.getElementById("closeButton");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const cancelSettingsButton = document.getElementById("cancelSettingsButton");
const browseFolderButton = document.getElementById("browseFolderButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsForm = document.getElementById("settingsForm");
const settingsStatus = document.getElementById("settingsStatus");
const usernameInput = document.getElementById("usernameInput");
const watchedFolderInput = document.getElementById("watchedFolderInput");
const detailsTemplateInput = document.getElementById("detailsTemplateInput");
const stateTemplateInput = document.getElementById("stateTemplateInput");
const aiLabelingEnabledInput = document.getElementById("aiLabelingEnabledInput");
const openAiModelInput = document.getElementById("openAiModelInput");
const openAiApiKeyInput = document.getElementById("openAiApiKeyInput");
const geminiApiKeyInput = document.getElementById("geminiApiKeyInput");
const pollIntervalInput = document.getElementById("pollIntervalInput");
const inactivityTimeoutInput = document.getElementById("inactivityTimeoutInput");
const showElapsedTimeInput = document.getElementById("showElapsedTimeInput");
const minimizeToTrayInput = document.getElementById("minimizeToTrayInput");
const launchOnStartupInput = document.getElementById("launchOnStartupInput");
const modelSelectContainer = openAiModelInput.parentElement;

function updateModelIcon() {
  const model = openAiModelInput.value.toLowerCase();
  if (model.includes("gpt")) {
    modelSelectContainer.dataset.company = "openai";
  } else if (model.includes("gemini")) {
    modelSelectContainer.dataset.company = "google";
  } else if (model) {
    modelSelectContainer.dataset.company = "other";
  } else {
    delete modelSelectContainer.dataset.company;
  }
}

openAiModelInput.addEventListener("input", updateModelIcon);

openAiModelInput.addEventListener("mousedown", () => {
  openAiModelInput.setAttribute("list", "");
});

openAiModelInput.addEventListener("mouseup", () => {
  openAiModelInput.setAttribute("list", "aiModels");
  openAiModelInput.focus();
});

openAiModelInput.addEventListener("focus", () => {
  openAiModelInput.setAttribute("list", "aiModels");
});

let currentSnapshot = null;
let currentSettings = null;
let wasMaximizedBeforeSettings = false;

function formatElapsedTime(startedAt) {
  if (!startedAt) {
    return "00:00:00";
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
}

function setDotState(element, state) {
  element.className = `status-dot status-${state}`;
}

function renderSnapshot(snapshot) {
  currentSnapshot = snapshot;

  statusValue.textContent = STATUS_LABELS[snapshot.status] ?? "Waiting";

  if (snapshot.cliTool) {
    toolBadge.textContent = snapshot.cliTool;
    toolBadge.classList.remove("hidden");
  } else {
    toolBadge.classList.add("hidden");
  }

  projectValue.textContent = snapshot.projectName ?? "No active project";
  phaseValue.textContent = snapshot.phase ?? (snapshot.status === "error" ? "Check settings" : "Waiting for activity");

  if (snapshot.lastFile) {
    fileValue.textContent = snapshot.lastFile;
    fileValue.classList.remove("hidden");
  } else {
    fileValue.classList.add("hidden");
  }

  if (snapshot.diffStats && (snapshot.diffStats.additions > 0 || snapshot.diffStats.deletions > 0)) {
    const { additions, deletions, filesChanged } = snapshot.diffStats;
    diffValue.innerHTML = `
      <span class="diff-files">${filesChanged} file${filesChanged !== 1 ? "s" : ""}</span>
      <span class="diff-add">+${additions}</span>
      <span class="diff-remove">-${deletions}</span>
    `;
    diffValue.classList.remove("hidden");
  } else {
    diffValue.classList.add("hidden");
  }

  sessionValue.textContent = formatElapsedTime(snapshot.sessionStartedAt);

  if (snapshot.discordState === "connected") {
    connectionValue.textContent = "Discord";
    setDotState(discordDot, "connected");
  } else {
    connectionValue.textContent = snapshot.watcherState === "error" ? "Watcher" : "Discord Off";
    setDotState(discordDot, snapshot.watcherState === "error" ? "error" : "disconnected");
  }

  aiValue.textContent = AI_LABELS[snapshot.aiState] ?? snapshot.aiMessage ?? "AI";
  if (snapshot.aiMessage) {
    aiValue.textContent = snapshot.aiMessage;
  }
  setDotState(aiDot, mapAiStateToDot(snapshot.aiState));
  setDotState(statusDot, snapshot.status);
}

function mapAiStateToDot(state) {
  if (state === "active" || state === "ready") {
    return "connected";
  }

  if (state === "classifying") {
    return "working";
  }

  if (state === "fallback" || state === "missing-config") {
    return "error";
  }

  return "idle";
}

function applySettingsToForm(settings) {
  usernameInput.value = settings.username ?? "";
  usernameInput.placeholder = settings.systemUsername || "Optional";
  watchedFolderInput.value = settings.watchedFolderPath ?? "";
  detailsTemplateInput.value = settings.detailsTemplate ?? "";
  stateTemplateInput.value = settings.stateTemplate ?? "";
  aiLabelingEnabledInput.checked = Boolean(settings.aiLabelingEnabled);
  openAiModelInput.value = settings.openAiModel ?? "gpt-5.4-nano";
  updateModelIcon();
  openAiApiKeyInput.value = settings.openAiApiKey ?? "";
  geminiApiKeyInput.value = settings.geminiApiKey ?? "";
  pollIntervalInput.value = String(settings.pollIntervalSeconds ?? 15);
  inactivityTimeoutInput.value = String(settings.inactivityTimeoutMinutes ?? 30);
  showElapsedTimeInput.checked = Boolean(settings.showElapsedTime);
  minimizeToTrayInput.checked = Boolean(settings.minimizeToTray);
  launchOnStartupInput.checked = Boolean(settings.launchOnStartup);

  if (!settings.discordClientIdConfigured) {
    setSettingsStatus("Discord app ID is not configured yet. Set it in watcher.config.json.", "error");
  } else if (settings.aiLabelingEnabled) {
    const model = openAiModelInput.value.toLowerCase();
    const needsGemini = model.includes("gemini");
    const needsOpenAi = !needsGemini;

    if (needsOpenAi && !settings.openAiApiKeyConfigured) {
      setSettingsStatus("AI labeling is enabled, but OpenAI API key is missing.", "error");
    } else if (needsGemini && !settings.geminiApiKeyConfigured) {
      setSettingsStatus("AI labeling is enabled, but Gemini API key is missing.", "error");
    } else {
      clearSettingsStatus();
    }
  } else {
    clearSettingsStatus();
  }
}

function collectSettingsFromForm() {
  return {
    username: usernameInput.value.trim(),
    watchedFolderPath: watchedFolderInput.value.trim(),
    detailsTemplate: detailsTemplateInput.value.trim(),
    stateTemplate: stateTemplateInput.value.trim(),
    aiLabelingEnabled: aiLabelingEnabledInput.checked,
    openAiModel: openAiModelInput.value.trim(),
    openAiApiKey: openAiApiKeyInput.value.trim(),
    geminiApiKey: geminiApiKeyInput.value.trim(),
    pollIntervalSeconds: Number(pollIntervalInput.value),
    inactivityTimeoutMinutes: Number(inactivityTimeoutInput.value),
    showElapsedTime: showElapsedTimeInput.checked,
    minimizeToTray: minimizeToTrayInput.checked,
    launchOnStartup: launchOnStartupInput.checked
  };
}

async function openSettings() {
  if (!currentSettings) {
    return;
  }

  wasMaximizedBeforeSettings = await window.presenceWatcher.isWindowMaximized();
  if (!wasMaximizedBeforeSettings) {
    await window.presenceWatcher.maximizeWindow();
  }

  applySettingsToForm(currentSettings);
  settingsOverlay.classList.remove("hidden");
  usernameInput.focus();
}

async function closeSettings() {
  settingsOverlay.classList.add("hidden");

  if (!wasMaximizedBeforeSettings) {
    await window.presenceWatcher.unmaximizeWindow();
  }

  if (currentSettings?.discordClientIdConfigured) {
    clearSettingsStatus();
  }
}

function setSettingsStatus(message, state) {
  settingsStatus.textContent = message;
  settingsStatus.dataset.state = state;
}

function clearSettingsStatus() {
  settingsStatus.textContent = "";
  delete settingsStatus.dataset.state;
}

async function loadSettings() {
  currentSettings = await window.presenceWatcher.getSettings();
  applySettingsToForm(currentSettings);
}

async function saveSettings(event) {
  event.preventDefault();
  setSettingsStatus("Saving settings...", "success");
  saveSettingsButton.disabled = true;

  try {
    const nextSettings = await window.presenceWatcher.saveSettings(collectSettingsFromForm());
    currentSettings = nextSettings;
    applySettingsToForm(nextSettings);
    setSettingsStatus("Saved.", "success");
    window.setTimeout(() => {
      closeSettings();
    }, 300);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSettingsStatus(message, "error");
  } finally {
    saveSettingsButton.disabled = false;
  }
}

async function browseForFolder() {
  try {
    const selectedPath = await window.presenceWatcher.browseForFolder();
    if (!selectedPath) {
      return;
    }

    watchedFolderInput.value = selectedPath;
    clearSettingsStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSettingsStatus(message, "error");
  }
}

async function boot() {
  const [snapshot] = await Promise.all([
    window.presenceWatcher.getSnapshot(),
    loadSettings()
  ]);

  renderSnapshot(snapshot);

  window.presenceWatcher.onSnapshot((nextSnapshot) => {
    renderSnapshot(nextSnapshot);
  });
}

settingsButton.addEventListener("click", () => {
  void openSettings();
});

minimizeButton.addEventListener("click", () => {
  void window.presenceWatcher.minimizeWindow();
});

closeButton.addEventListener("click", () => {
  void window.presenceWatcher.quit();
});

closeSettingsButton.addEventListener("click", () => {
  void closeSettings();
});

cancelSettingsButton.addEventListener("click", () => {
  void closeSettings();
});

browseFolderButton.addEventListener("click", () => {
  void browseForFolder();
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    void closeSettings();
  }
});

settingsForm.addEventListener("submit", (event) => {
  void saveSettings(event);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsOverlay.classList.contains("hidden")) {
    void closeSettings();
  }
});

setInterval(() => {
  if (!currentSnapshot) {
    return;
  }

  sessionValue.textContent = formatElapsedTime(currentSnapshot.sessionStartedAt);
}, 1000);

void boot();
