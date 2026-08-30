(function () {
  "use strict";

  const FILE_NAME = "huy-sano-lista-musical.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  let tokenClient;
  let accessToken = "";
  let remoteFileId = "";
  let api;
  let backupTimer;

  const el = (id) => document.getElementById(id);
  const localUpdatedAt = () => localStorage.getItem("hs-updated-at") || "1970-01-01T00:00:00.000Z";

  function status(message, connected) {
    if (el("driveStatus")) {
      el("driveStatus").firstChild.textContent = message + " ";
      el("driveDisconnect").hidden = !connected;
    }
    if (el("driveBtn")) el("driveBtn").textContent = connected ? "☁ Sincronizar ahora" : "☁ Conectar Drive";
  }

  async function driveJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`Google Drive respondió ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  async function locateRemote() {
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      q: `name='${FILE_NAME}' and trashed=false`,
      fields: "files(id,name,modifiedTime)",
      pageSize: "1",
    });
    const result = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`);
    remoteFileId = result.files?.[0]?.id || "";
    return result.files?.[0] || null;
  }

  async function downloadRemote() {
    return driveJson(`https://www.googleapis.com/drive/v3/files/${remoteFileId}?alt=media`);
  }

  async function uploadLocal() {
    const payload = { ...api.getData(), updatedAt: localUpdatedAt(), formatVersion: 1 };
    const metadata = remoteFileId
      ? { name: FILE_NAME }
      : { name: FILE_NAME, parents: ["appDataFolder"] };
    const boundary = `huy_sano_${Date.now()}`;
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`,
      `--${boundary}--`,
    ].join("");
    const url = remoteFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${remoteFileId}?uploadType=multipart&fields=id`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
    const result = await driveJson(url, {
      method: remoteFileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    remoteFileId = result.id;
    status(`Copia actualizada en Google Drive · ${new Date().toLocaleString("es")}`, true);
  }

  async function sync() {
    if (!accessToken) return connect();
    status("Sincronizando con Google Drive…", true);
    try {
      const remote = await locateRemote();
      if (!remote) return uploadLocal();
      const cloud = await downloadRemote();
      const cloudTime = Date.parse(cloud.updatedAt || remote.modifiedTime || 0);
      const localTime = Date.parse(localUpdatedAt());
      const hasLocalData = api.getData().songs.length || api.getData().trash.length;
      if (cloudTime > localTime && (!hasLocalData || confirm("Google Drive tiene una lista más reciente. ¿Quieres usarla en este dispositivo?"))) {
        api.setData(cloud);
        status(`Lista recuperada de Google Drive · ${new Date().toLocaleString("es")}`, true);
      } else {
        await uploadLocal();
      }
    } catch (error) {
      console.error(error);
      status("No se pudo sincronizar; tus datos locales permanecen seguros.", !!accessToken);
      alert("No se pudo sincronizar con Google Drive. La lista local no fue modificada.");
    }
  }

  function connect() {
    const clientId = window.HUY_SANO_GOOGLE_CLIENT_ID || "";
    if (!clientId || clientId.startsWith("PENDIENTE")) {
      alert("Falta configurar la credencial de Google de Huy Sano.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      alert("El servicio de acceso de Google todavía está cargando. Inténtalo nuevamente.");
      return;
    }
    tokenClient ||= google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: async (response) => {
        if (response.error) return status("Google no autorizó la conexión.", false);
        accessToken = response.access_token;
        await sync();
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function disconnect() {
    if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken);
    accessToken = "";
    remoteFileId = "";
    status("Guardado únicamente en este dispositivo", false);
  }

  window.HuySanoDrive = {
    init(callbacks) {
      api = callbacks;
      el("driveBtn")?.addEventListener("click", () => (accessToken ? sync() : connect()));
      el("driveDisconnect")?.addEventListener("click", disconnect);
    },
    scheduleBackup() {
      if (!accessToken) return;
      clearTimeout(backupTimer);
      backupTimer = setTimeout(uploadLocal, 1500);
    },
  };
})();
