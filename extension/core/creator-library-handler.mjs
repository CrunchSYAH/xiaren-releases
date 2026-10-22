import { CREATOR_LIBRARY_KEY, readCreatorLibrary, listCreatorLibrary, createCreatorLibraryRecord, updateCreatorLibraryRecord, importCreatorLibraryRecords, parseCreatorLibraryImport, exportCreatorLibrary, selectCreatorLibrary } from './creator-library.mjs';

const EVENTS = new Set(['panel:library-list', 'panel:library-add', 'panel:library-update', 'panel:library-import', 'panel:library-export', 'panel:library-select']);
export function isCreatorLibraryMessage(message) { return EVENTS.has(message?.type); }

// Create once per background worker, dispatch BEFORE business initialization.
// This independent serial chain prevents lost writes across extension pages.
export function createCreatorLibraryHandler(api, { now = () => Date.now(), uid = () => crypto.randomUUID() } = {}) {
  let serial = Promise.resolve();
  async function run(message, sender) {
    if (!isCreatorLibraryMessage(message)) throw new Error('不支持此达人库操作');
    if (sender?.id !== api.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) || !['dashboard.html', 'creator-library.html'].some(path => sender.url === api.runtime.getURL(path))) throw new Error('只允许扩展工作台或达人库顶层页面操作本地达人库');
    let raw;
    try { raw = await api.storage.local.get([CREATOR_LIBRARY_KEY]); }
    catch { throw new Error('本地达人库读取失败，请刷新后重试'); }
    const store = readCreatorLibrary(raw?.[CREATOR_LIBRARY_KEY]);
    if (message.type === 'panel:library-list') return { creatorLibrary: listCreatorLibrary(store, message.filters) };
    if (message.type === 'panel:library-export') return { creatorLibraryExport: exportCreatorLibrary(store, message) };
    if (message.type === 'panel:library-select') return { creatorLibrarySelection: selectCreatorLibrary(store, message) };
    let next, savedRecordId, added, skipped;
    const options = { now: now(), expectedRevision: message.expectedRevision };
    if (message.type === 'panel:library-add') {
      savedRecordId = uid(); next = createCreatorLibraryRecord(store, message.draft, { ...options, id: savedRecordId });
    } else if (message.type === 'panel:library-update') {
      savedRecordId = message.recordId; next = updateCreatorLibraryRecord(store, message, options);
    } else {
      const records = message.records === undefined ? parseCreatorLibraryImport(message.content, message.format) : message.records;
      const result = importCreatorLibraryRecords(store, records, { ...options, uid });
      next = result.store; added = result.added; skipped = result.skipped;
    }
    if (next.revision !== store.revision) {
      try { await api.storage.local.set({ [CREATOR_LIBRARY_KEY]: next }); }
      catch { throw new Error('本地达人库保存失败，未确认新增或修改；请刷新核对后重试'); }
    }
    return { creatorLibrary: listCreatorLibrary(next), ...(savedRecordId ? { savedRecordId } : {}), ...(added !== undefined ? { added, skipped } : {}) };
  }
  return { handle(message, sender) {
    const result = serial.then(() => run(message, sender));
    serial = result.catch(() => {});
    return result;
  } };
}
