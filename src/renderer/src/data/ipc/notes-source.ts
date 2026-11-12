// NotesRepository 的 IPC 实现(阶段 5:扫描/CAS/原子写全在 main,renderer 只发意图)
import type { NotesRepository } from '../ports'

export function createIpcNotesRepo(): NotesRepository {
  return {
    list: () => window.launcher.notes.list(),
    read: (id) => window.launcher.notes.read(id),
    create: (input) => window.launcher.notes.create(input),
    save: (input) => window.launcher.notes.save(input),
    rename: (input) => window.launcher.notes.rename(input),
    remove: (input) => window.launcher.notes.remove(input),
    search: (query, limit) => window.launcher.notes.search(query, limit),
    dir: () => window.launcher.notes.dir(),
    reveal: (id) => window.launcher.notes.reveal(id),
    saveAsset: (input) => window.launcher.notes.saveAsset(input),
    createFolder: (input) => window.launcher.notes.createFolder(input),
    removeFolder: (id) => window.launcher.notes.removeFolder(id),
    renameFolder: (input) => window.launcher.notes.renameFolder(input),
    move: (input) => window.launcher.notes.move(input),
    import: (input) => window.launcher.notes.import(input),
    probeExternal: (input) => window.launcher.notes.probeExternal(input),
    removeFile: (path) => window.launcher.notes.removeFile(path),
    openFile: (path) => window.launcher.notes.openFile(path),
    statFile: (path) => window.launcher.notes.statFile(path),
    readFile: (path) => window.launcher.notes.readFile(path),
    readFileBytes: (path, maxBytes) => window.launcher.notes.readFileBytes(path, maxBytes),
    saveFile: (input) => window.launcher.notes.saveFile(input),
    createFile: (input) => window.launcher.notes.createFile(input),
    renameFile: (input) => window.launcher.notes.renameFile(input)
  }
}
