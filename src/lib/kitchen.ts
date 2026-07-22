import { settings, projects } from "./db";

type KitchenFolder = {
  id: string;
  name?: string;
};

type KitchenBoard = {
  id: string;
  title?: string;
  folder_id?: string | null;
};

type KitchenConfig = {
  token: string;
  workspace: string;
  apiBase: string;
};

async function getKitchenConfig(): Promise<KitchenConfig> {
  const tokenRow = await settings.get("kitchen_api_token");
  const workspaceRow = await settings.get("kitchen_workspace_id");

  if (!tokenRow?.value) throw new Error("Kitchen API Token fehlt.");

  const workspace = workspaceRow?.value
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.kitchen\.co$/, "") || "";

  return {
    token: tokenRow.value.trim(),
    workspace,
    apiBase: `https://${workspace}.kitchen.co/api`
  };
}

async function kitchenFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const { token } = await getKitchenConfig();

  console.log(`📡 REQUEST [${options.method || 'GET'}] ${url}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  // Für saubere Logs behalten wir das bei
  console.log(`✅ RESPONSE [${response.status}]:`, data);

  if (!response.ok) {
    throw new Error(`Kitchen API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as T;
}

let kitchenSyncRunning = false;

// ---------------------------------------------------------------------------
// HIER STARTEN DIE EXPORTE - Alles sauber in einem Objekt!
// ---------------------------------------------------------------------------
export const kitchen = {
  
  createFolder: async (name: string): Promise<KitchenFolder> => {
    const { apiBase } = await getKitchenConfig();
    return kitchenFetch<KitchenFolder>(`${apiBase}/folders`, {
      method: "POST",
      body: JSON.stringify({ name, visibility: "internal" })
    });
  },

  createBoard: async (folderId: string, title: string): Promise<KitchenBoard> => {
    const { apiBase } = await getKitchenConfig();
    return kitchenFetch<KitchenBoard>(`${apiBase}/boards`, {
      method: "POST",
      body: JSON.stringify({
        title,
        visibility: "internal",
        // Der "Schrotflinten-Ansatz", der erfolgreich war:
        folder: folderId,
        folderId: folderId,
        parent_id: folderId,
        project_id: folderId
      })
    });
  },

  setupProject: async (projectName: string) => {
    if (kitchenSyncRunning) {
      console.warn("⚠️ Sync blockiert: setupProject() läuft bereits.");
      return null;
    }
    
    kitchenSyncRunning = true;

    try {
      console.log("🚀 START: Erstelle Ordner");
      const folder = await kitchen.createFolder(projectName);
      
      console.log(`🚀 START: Erstelle Board im Ordner (Folder-ID: ${folder.id})`);
      const board = await kitchen.createBoard(folder.id, projectName);
      
      // ALARM WURDE ENTFERNT: Kitchen sendet die folder_id im Response nicht zurück, 
      // ordnet das Board aber trotzdem korrekt ein.

      return { folderId: folder.id, boardId: board.id };
    } catch (err) {
      console.error("❌ Fehler im Kitchen-Setup:", err);
      throw err;
    } finally {
      setTimeout(() => { kitchenSyncRunning = false; }, 1000);
    }
  },

  deleteFolder: async (folderId: string) => {
    const { apiBase } = await getKitchenConfig();
    return kitchenFetch(`${apiBase}/folders/${folderId}`, {
      method: "DELETE"
    });
  },

  deleteBoard: async (boardId: string) => {
    const { apiBase } = await getKitchenConfig();
    return kitchenFetch(`${apiBase}/boards/${boardId}`, {
      method: "DELETE"
    });
  },

  getBoards: async (): Promise<KitchenBoard[]> => {
    const { apiBase } = await getKitchenConfig();
    const result = await kitchenFetch<any>(`${apiBase}/boards`);
    return result.data ?? result;
  },

  syncKitchenDeletes: async () => {
    console.log("🔄 Kitchen Sync gestartet");
    try {
      const remoteBoards = await kitchen.getBoards();
      const localProjects = await projects.list();

      for (const project of localProjects) {
        const boardId = (project as any).kitchen_board_id;
        if (!boardId) continue;

        const exists = remoteBoards.some((board: any) => board.id === boardId);

        if (!exists) {
          console.log(`🗑 Remote-Board fehlt! Entferne lokales Projekt: ${project.name}`);
          await projects.remove(project.id);
        }
      }
      console.log("✅ Kitchen Sync fertig");
    } catch (err) {
      console.error("❌ Fehler beim Sync:", err);
    }
  }
};