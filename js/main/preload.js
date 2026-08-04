
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  listSerialDevices: () => ipcRenderer.invoke('listSerialDevices'),
  listSerialDeviceInfo: () => ipcRenderer.invoke('listSerialDeviceInfo'),
  storeGet: (key, defaultValue) => ipcRenderer.sendSync('storeGet', key, defaultValue),
  storeSet: (key, value) => ipcRenderer.send('storeSet', key, value),
  storeDelete: (key) => ipcRenderer.send('storeDelete', key),
  appGetPath: (name) => ipcRenderer.sendSync('appGetPath', name),
  appGetVersion: () => ipcRenderer.sendSync('appGetVersion'),
  appGetLocale: () => ipcRenderer.sendSync('appGetLocale'),
  showOpenDialog: (options) => ipcRenderer.invoke('dialog.showOpenDialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog.showSaveDialog', options),
  alertDialog: (message) => ipcRenderer.sendSync('dialog.alert', message), // TODO: still blocks renderer event loop — needs same async fix (invoke/handle) as confirm; see ipcMain.on('dialog.alert') in main.js
  confirmDialog: (message) => ipcRenderer.invoke('dialog.confirm', message),
  tcpConnect: (host, port) => ipcRenderer.invoke('tcpConnect', host, port),
  tcpClose: () => ipcRenderer.send('tcpClose'),
  tcpSend: (data) => ipcRenderer.invoke('tcpSend', data),
  onTcpError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('tcpError', handler);
    return handler;
  },
  offTcpError: (handler) => ipcRenderer.removeListener('tcpError', handler),
  onTcpData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('tcpData', handler);
    return handler;
  },
  offTcpData: (handler) => ipcRenderer.removeListener('tcpData', handler),
  onTcpEnd: (callback) => {
    const handler = (_event) => callback();
    ipcRenderer.on('tcpEnd', handler);
    return handler;
  },
  offTcpEnd: (handler) => ipcRenderer.removeListener('tcpEnd', handler),
  serialConnect: (path, options) => ipcRenderer.invoke('serialConnect', path, options),
  serialClose: (connectionId) => ipcRenderer.invoke('serialClose', connectionId),
  serialSend: (data, connectionId) => ipcRenderer.invoke('serialSend', data, connectionId),
  onSerialError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('serialError', handler);
    return handler;
  },
  offSerialError: (handler) => ipcRenderer.removeListener('serialError', handler),
  onSerialData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('serialData', handler);
    return handler;
  },
  offSerialData: (handler) => ipcRenderer.removeListener('serialData', handler),
  onSerialClose: (callback) => {
    const handler = (_event, envelope) => callback(envelope);
    ipcRenderer.on('serialClose', handler);
    return handler;
  },
  offSerialClose: (handler) => ipcRenderer.removeListener('serialClose', handler),
  rtkBaseConnect: (path, options) => ipcRenderer.invoke('rtkBaseConnect', path, options),
  rtkBaseSend: (data, connectionId) => ipcRenderer.invoke('rtkBaseSend', data, connectionId),
  rtkBaseClose: (connectionId) => ipcRenderer.invoke('rtkBaseClose', connectionId),
  onRtkBaseData: (callback) => {
    const handler = (_event, envelope) => callback(envelope);
    ipcRenderer.on('rtkBaseData', handler);
    return handler;
  },
  offRtkBaseData: (handler) => ipcRenderer.removeListener('rtkBaseData', handler),
  onRtkBaseError: (callback) => {
    const handler = (_event, envelope) => callback(envelope);
    ipcRenderer.on('rtkBaseError', handler);
    return handler;
  },
  offRtkBaseError: (handler) => ipcRenderer.removeListener('rtkBaseError', handler),
  onRtkBaseClose: (callback) => {
    const handler = (_event, envelope) => callback(envelope);
    ipcRenderer.on('rtkBaseClose', handler);
    return handler;
  },
  offRtkBaseClose: (handler) => ipcRenderer.removeListener('rtkBaseClose', handler),
  ntripConnect: (settings) => ipcRenderer.invoke('ntripConnect', settings),
  ntripListMountpoints: (settings) => ipcRenderer.invoke('ntripListMountpoints', settings),
  ntripSendGga: (sentence) => ipcRenderer.invoke('ntripSendGga', sentence),
  ntripClose: () => ipcRenderer.invoke('ntripClose'),
  onNtripData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ntripData', handler);
    return handler;
  },
  offNtripData: (handler) => ipcRenderer.removeListener('ntripData', handler),
  onNtripStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('ntripStatus', handler);
    return handler;
  },
  offNtripStatus: (handler) => ipcRenderer.removeListener('ntripStatus', handler),
  onNtripError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('ntripError', handler);
    return handler;
  },
  offNtripError: (handler) => ipcRenderer.removeListener('ntripError', handler),
  onNtripClose: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('ntripClose', handler);
    return handler;
  },
  offNtripClose: (handler) => ipcRenderer.removeListener('ntripClose', handler),
  udpConnect: (ip, port) => ipcRenderer.invoke('udpConnect', ip, port),
  udpClose: () => ipcRenderer.invoke('udpClose'),
  udpSend: (data) => ipcRenderer.invoke('udpSend', data),
  onUdpError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('udpError', handler);
    return handler;
  },
  offUdpError: (handler) => ipcRenderer.removeListener('udpError', handler),
  onUdpMessage: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('udpMessage', handler);
    return handler;
  },
  offUdpMessage: (handler) => ipcRenderer.removeListener('udpMessage', handler),
  mavlinkReset: (generation) => ipcRenderer.send('mavlinkReset', generation),
  mavlinkFeed: (data, generation) => ipcRenderer.send('mavlinkFeed', data, generation),
  mavlinkEncode: (messageName, payload, options) => (
    ipcRenderer.invoke('mavlinkEncode', messageName, payload, options)
  ),
  onMavlinkMessage: (callback) => {
    const handler = (_event, envelope) => callback(envelope);
    ipcRenderer.on('mavlinkMessage', handler);
    return handler;
  },
  offMavlinkMessage: (handler) => ipcRenderer.removeListener('mavlinkMessage', handler),
  writeFile: (filename, data) => ipcRenderer.invoke('writeFile', filename, data),
  appendFile: (filename, data) => ipcRenderer.invoke('appendFile', filename, data),
  readFile: (filename, encoding = 'utf8') => ipcRenderer.invoke('readFile', filename, encoding),
  rm: (path) => ipcRenderer.invoke('rm', path),
  chmod: (path, mode) => ipcRenderer.invoke('chmod', path, mode),
  getBackupDir: () => ipcRenderer.invoke('getBackupDir'),
  openBackupDir: () => ipcRenderer.invoke('openBackupDir'),
  listBackups: () => ipcRenderer.invoke('listBackups'),
  startChildProcess: (command, args, opts) => ipcRenderer.send('startChildProcess', command, args, opts),
  killChildProcess: () => ipcRenderer.send('killChildProcess'),
  onChildProcessStdout: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('onChildProcessStdout', handler);
    return handler;
  },
  offChildProcessStdout: (handler) => ipcRenderer.removeListener('onChildProcessStdout', handler),
  onChildProcessStderr: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('onChildProcessStderr', handler);
    return handler;
  },
  offChildProcessStderr: (handler) => ipcRenderer.removeListener('onChildProcessStderr', handler),
  onChildProcessError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('onChildProcessError', handler);
    return handler;
  },
  offChildProcessError: (handler) => ipcRenderer.removeListener('onChildProcessError', handler),
});
