import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';

const invoke = <T>(method: string, input?: unknown): Promise<T> => ipcRenderer.invoke(`desk:${method}`, input);
const api: DesktopApi = {
  getSnapshot: () => invoke('getSnapshot'),
  setUnsaved: input => invoke('setUnsaved', input),
  setup: input => invoke('setup', input),
  switchWorkspace: input => invoke('switchWorkspace', input),
  saveWorkspace: input => invoke('saveWorkspace', input),
  saveProject: input => invoke('saveProject', input),
  archiveProject: input => invoke('archiveProject', input),
  previewLegacy: input => invoke('previewLegacy', input),
  importLegacy: input => invoke('importLegacy', input),
  saveRequirement: input => invoke('saveRequirement', input),
  saveProgress: input => invoke('saveProgress', input),
  importMaterial: input => invoke('importMaterial', input),
  openMaterial: input => invoke('openMaterial', input),
  checkMaterial: input => invoke('checkMaterial', input),
  saveContact: input => invoke('saveContact', input),
  saveRecommendation: input => invoke('saveRecommendation', input),
  saveSubmission: input => invoke('saveSubmission', input),
  saveApiSettings: input => invoke('saveApiSettings', input),
  testApi: () => invoke('testApi'),
  startResearch: input => invoke('startResearch', input),
  cancelResearch: input => invoke('cancelResearch', input),
  resumeResearch: input => invoke('resumeResearch', input),
  adoptResearch: input => invoke('adoptResearch', input),
  createBackup: () => invoke('createBackup'),
  restoreBackup: () => invoke('restoreBackup'),
  openExternal: input => invoke('openExternal', input),
  onChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('desk:changed', listener);
    return () => { ipcRenderer.removeListener('desk:changed', listener); };
  },
};
contextBridge.exposeInMainWorld('desk', api);
