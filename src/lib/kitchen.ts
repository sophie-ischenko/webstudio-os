import { settings } from "./db";

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

  // 🕵️‍♀️ DEBUG: Logge den ausgehenden Request
  console.log(`📡 REQUEST [${options.method || 'GET'}] ${url}`);
  if (options.body) console.log(`📦 BODY:`, JSON.parse(options.body as string));

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

  // 🕵️‍♀️ DEBUG: Logge die Antwort
  console.log(`✅ RESPONSE [${response.status}]:`, data);

  if (!response.ok) {
    throw new Error(`Kitchen API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data as T;
}

let kitchenSyncRunning = false;

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
    
    // VERSUCH 1: Vielleicht nutzt Kitchen verschachtelte Routen? (Sehr typisch für solche APIs)
    try {
      console.log(`📡 VERSUCH 1: Nested Route (/folders/.../boards)`);
      const board = await kitchenFetch<KitchenBoard>(`${apiBase}/folders/${folderId}/boards`, {
        method: "POST",
        body: JSON.stringify({ title, visibility: "internal" })
      });
      return board;
    } catch (e) {
      console.log("❌ Nested Route existiert nicht (404). Wechsel zu Versuch 2...");
    }

    // VERSUCH 2: Wir senden alle gängigen Parameter. Da Kitchen unbekannte Parameter 
    // ignoriert, zünden wir hier einfach alle auf einmal.
    console.log(`📡 VERSUCH 2: Root Route mit allen gängigen Keys`);
    return kitchenFetch<KitchenBoard>(`${apiBase}/boards`, {
      method: "POST",
      body: JSON.stringify({
        title,
        visibility: "internal",
        // Der Schrotflinten-Ansatz:
        folder: folderId,          // Stripe-Style
        folderId: folderId,        // CamelCase-Style
        parent_id: folderId,       // Hierarchie-Style
        project_id: folderId       // Alias-Style
      })
    });
  },

  setupProject: async (projectName: string) => {
    // Doppel-Aufruf-Sperre
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

      // 🕵️‍♀️ DEBUG CHECK: Ist das Board wirklich im Ordner?
      if (!board.folder_id && (board as any).folderId === undefined) {
        console.warn("🚨 ALARM: Kitchen hat den Ordner-Parameter ignoriert! Das Board liegt wahrscheinlich auf der Hauptebene.");
      }
      
      return { folderId: folder.id, boardId: board.id };
    } catch (err) {
      console.error("❌ Fehler im Kitchen-Setup:", err);
      throw err;
    } finally {
      // WICHTIG: Kurze Verzögerung, falls React StrictMode dazwischenfunkt
      setTimeout(() => { kitchenSyncRunning = false; }, 1000);
    }
  }
};