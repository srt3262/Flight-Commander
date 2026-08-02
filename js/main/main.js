import { chmod, rm, mkdirSync, existsSync } from 'node:fs';
import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell, dialog, session, nativeImage } from 'electron';
import windowStateKeeper from 'electron-window-state';
import Store from "electron-store";
import path from 'path';
import { fileURLToPath } from 'node:url';
import started from 'electron-squirrel-startup';
import { writeFile, readFile, appendFile, readdir } from 'node:fs/promises';
import flightCommanderIconDataUrl from '../../images/flight_commander_256.png';

import tcp from './tcp';
import udp from './udp';
import serial from './serial';
import rtkBaseSerial from './rtkBaseSerial';
import child_process from './child_process';
import { registerMavlinkIpc } from './mavlink';
import { NtripClient } from './ntripClient';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flightCommanderIcon = nativeImage.createFromDataURL(
  flightCommanderIconDataUrl,
);

app.setName('Flight Commander');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.flightcommander.app');
}

/**
 * Returns the base path for SITL binaries.
 * - In packaged mode: uses Electron's resourcesPath (where extraResource files are placed)
 * - In dev mode: uses the source location in resources/public/sitl
 */
function getSitlBasePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'sitl');
  } else {
    return path.join(app.getAppPath(), 'resources', 'public', 'sitl');
  }
}

const FLIGHT_COMMANDER_FIRMWARE_FILENAME =
  /^Flight-Commander-Firmware-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:MICOAIR743|MICROAIR743)(?:-BENCH-ONLY)?\.hex$/i;

function getFlightCommanderFirmwareBasePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'firmware')
    : path.join(app.getAppPath(), 'resources', 'firmware');
}

function resolveBundledFlightCommanderFirmware(filename) {
  const basename = path.basename(String(filename ?? ''));
  if (basename !== filename || !FLIGHT_COMMANDER_FIRMWARE_FILENAME.test(basename)) {
    throw new Error('Invalid bundled Flight Commander Firmware filename.');
  }
  return path.join(getFlightCommanderFirmwareBasePath(), basename);
}

const usbBootloaderIds =  [
  { vendorId: 1155, productId: 57105}, 
  { vendorId: 11836, productId: 57105}
];

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow = null;
let bluetoothDeviceChooser = null;
let btDeviceList = null;
let selectBluetoothCallback = null;
let mavlinkIpc = null;
const ntripClient = new NtripClient({
  emit(type, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`ntrip${type[0].toUpperCase()}${type.slice(1)}`, payload);
    }
  },
});

const store = new Store();

// Workaround for some Linux systems: https://github.com/electron/electron/issues/32760
if (store.get('disable_3d_acceleration', false)) {
  app.disableHardwareAcceleration();
}

// Enable remote debugging in development mode
// This allows chrome://inspect and Playwright CDP connections
if (!app.isPackaged) {  // Development mode (not packaged)
  const port = process.env.CDP_PORT ?? '9222';
  app.commandLine.appendSwitch('remote-debugging-port', port);
  console.log(`[cdp] Remote debugging enabled on port ${port}`);
  console.log(`   Chrome DevTools: chrome://inspect`);
  console.log(`   CDP Endpoint: http://localhost:${port}`);
}

// In Electron the bluetooth device chooser didn't exist, so we have to build our own
function createDeviceChooser() {
  bluetoothDeviceChooser = new BrowserWindow({
    parent: mainWindow,
    width: 410,
    height: 600,
    icon: flightCommanderIcon,
    webPreferences: {
      preload: path.join(__dirname, 'bt-device-chooser-preload.mjs'),
    }
  });
  bluetoothDeviceChooser.removeMenu();
  
  if (BT_DEVICE_CHOOSER_VITE_DEV_SERVER_URL) {
    bluetoothDeviceChooser.loadURL(`${BT_DEVICE_CHOOSER_VITE_DEV_SERVER_URL}/js/libraries/bluetooth-device-chooser/bt-device-chooser-index.html`);
  } else {
    bluetoothDeviceChooser.loadFile(path.join(__dirname, `../renderer/${BT_DEVICE_CHOOSER_VITE_NAME}/js/libraries/bluetooth-device-chooser/bt-device-chooser-index.html`));
  }
  

  bluetoothDeviceChooser.on('closed', () => {
    btDeviceList = null;
    if (selectBluetoothCallback) {
      selectBluetoothCallback('');
      selectBluetoothCallback = null;
    }
    bluetoothDeviceChooser = null;
  });

  ipcMain.on('deviceSelected', (_event, deviceID) => {
    if (selectBluetoothCallback) {
      selectBluetoothCallback(deviceID);
      selectBluetoothCallback = null;
    }
  });

}

app.on('ready', () => {
  // Electron provides no valid Referer for OSM tiles (file:// in prod, localhost in dev).
  // OSM CDN rejects both with 403, so inject the required headers unconditionally.
  const PROJECT_URL = 'https://github.com/srt3262/Flight-Commander';
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://tile.openstreetmap.org/*', 'https://*.tile.openstreetmap.org/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = PROJECT_URL;
      details.requestHeaders['User-Agent'] = `Flight-Commander/${app.getVersion()} (${PROJECT_URL})`;
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  createWindow();
});

function createWindow() {

  let mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800
  });
  
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    title: 'Flight Commander',
    icon: flightCommanderIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: true,
      webSecurity: false,
      contextIsolation: true
    },
  });

  mainWindow.webContents.on('context-menu', (_, props) => {
    const menu = new Menu()  ;
    menu.append(new MenuItem({ label: "Undo", role: "undo", accelerator: 'CmdOrCtrl+Z', visible: props.isEditable }));
    menu.append(new MenuItem({ label: "Redo", role: "redo", accelerator: 'CmdOrCtrl+Y', visible: props.isEditable }));
    menu.append(new MenuItem({ type: "separator", visible: props.isEditable }));
    menu.append(new MenuItem({ label: 'Cut', role: 'cut', accelerator: 'CmdOrCtrl+X', visible: props.isEditable && props.selectionText }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy', accelerator: 'CmdOrCtrl+C', visible: props.selectionText }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste', accelerator: 'CmdOrCtrl+V', visible: props.isEditable }));
    menu.append(new MenuItem({ label: "Select all", role: 'selectAll', accelerator: 'CmdOrCtrl+A', visible: props.isEditable}));

    menu.items.forEach(item => {
      if (item.visible) {
        menu.popup();
        return;
      } 
    });
  });

  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    selectBluetoothCallback = callback;

    const compare = (a, b) => {
      if (a.length !== b.length) {
        return false;
      }
      a.every((element, index) => {
        if (element.deviceId !== b[index].deviceId) {
          return false;
        }
      })
      return true;
    }

    if (!btDeviceList || !compare(btDeviceList, deviceList)) {
      btDeviceList = [...deviceList];
  
      if (!bluetoothDeviceChooser) {
        createDeviceChooser();
      }
      bluetoothDeviceChooser.webContents.send('ble-scan', btDeviceList);
    }
  });

  
  mainWindow.webContents.session.on('select-usb-device', (event, details, callback) => {
    console.log(details.deviceList)
    let premittedDevice = null;
    if (details.deviceList) {
      details.deviceList.every((device, idx) => {
        if (device.productId == usbBootloaderIds[idx].productId && device.vendorId == usbBootloaderIds[idx].vendorId) {
          premittedDevice = device.deviceId;
          return;
        }
      });
    } 

    if (premittedDevice) {
      callback(premittedDevice);
    } else {
      callback();
    }
  });

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb') {     
        return true;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open links starts with https:// in default browser
    if (url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true
      }
    }
  });

  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  
  if (process.platform === "linux"){
    app.commandLine.appendSwitch("enable-experimental-web-platform-features", true);
  }

  app.commandLine.appendSwitch("enable-web-bluetooth", true);

  mainWindow.removeMenu();
  mainWindow.setMinimumSize(1024, 720);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  
  mainWindowState.manage(mainWindow);

  // Open the DevTools.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.on("ready-to-show", () => {
      mainWindow.webContents.openDevTools({mode: process.env.DEV_TOOLS_MODE});
    });
  }
};

app.on('before-quit', async () => {
  mavlinkIpc?.dispose();
  mavlinkIpc = null;
  await tcp.close();
  await serial.close();
  await rtkBaseSerial.close();
  await ntripClient.close();
  child_process.stop();
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }  
  console.log("We're closing...");
});

app.whenReady().then(() => {
  mavlinkIpc = registerMavlinkIpc(ipcMain, () => mainWindow);
  
   ipcMain.handle('listSerialDevices', (_event) => {
    return serial.getDevices()
  });
  ipcMain.handle('listSerialDeviceInfo', (_event) => {
    return serial.getDeviceInfo()
  });

  ipcMain.on('storeGet', (event, key, defaultVale) => {
    event.returnValue = store.get(key, defaultVale);
  });

  ipcMain.on('storeSet', (_event, key, value) => {
    store.set(key, value);
  });
  ipcMain.on('storeDelete', (_event, key) => {
    store.delete(key);
  });

  ipcMain.on('appGetPath', (event, name) => {
    event.returnValue = app.getPath(name);
  });

  ipcMain.on('appGetVersion', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on('appGetLocale', (event) => {
    event.returnValue = app.getLocale();
  });

  ipcMain.handle('dialog.showOpenDialog', (_event, options) => {
    return dialog.showOpenDialog(options);
  }),

  ipcMain.handle('dialog.showSaveDialog', async (_event, options) => {
    const opts = options || {};
    const LAST_SAVE_DIRECTORY_KEY = 'lastSaveDirectory';

    // Get the last save directory from store
    const lastDirectory = store.get(LAST_SAVE_DIRECTORY_KEY, null);

    // If we have a last directory, combine it with the filename if one was provided
    if (lastDirectory && opts.defaultPath) {
      // If defaultPath is just a filename (no directory), prepend the last directory
      if (!path.dirname(opts.defaultPath) || path.dirname(opts.defaultPath) === '.') {
        opts.defaultPath = path.join(lastDirectory, opts.defaultPath);
      }
    } else if (lastDirectory && !opts.defaultPath) {
      // No filename provided, just use the directory
      opts.defaultPath = lastDirectory;
    }

    // Show the save dialog
    const result = await dialog.showSaveDialog(opts);

    // If user selected a file (didn't cancel), save the directory for next time
    if (result && result.filePath && !result.canceled) {
      // Extract directory from the full file path (path already imported at top)
      const directory = path.dirname(result.filePath);
      store.set(LAST_SAVE_DIRECTORY_KEY, directory);
    }

    return result;
  }),

  ipcMain.on('dialog.alert', (event, message) => {
    event.returnValue = dialog.showMessageBoxSync({
      message,
      icon: flightCommanderIcon,
    });
  });

  ipcMain.handle('dialog.confirm', async (_event, message) => {
    const result = await dialog.showMessageBox({
      message,
      icon: flightCommanderIcon,
      buttons: ["Yes", "No"],
    });
    return result.response === 0;
  });

  ipcMain.handle('tcpConnect', (_event, host, port) => {
    return tcp.connect(host, port, mainWindow);
  });

  ipcMain.handle('tcpSend', (_event, data) => {
    return tcp.send(data);
  });

  ipcMain.on('tcpClose', (_event) => {
    tcp.close();
  });

  ipcMain.handle('serialConnect', (_event, path, options) => {
    if (rtkBaseSerial.getActivePath() === path) {
      return { error: true, msg: 'That serial port is already connected as the USB RTK base.' };
    }
    return serial.connect(path, options, mainWindow);
  });

  ipcMain.handle('serialSend', (_event, data, connectionId) => {
    return serial.send(data, connectionId);
  });

  ipcMain.handle('serialClose', (_event, connectionId) => {
    return serial.close(connectionId);
  });

  ipcMain.handle('rtkBaseConnect', (_event, path, options) => {
    if (serial.getActivePath() === path) {
      return { error: true, msg: 'That serial port is already connected to the flight controller.' };
    }
    return rtkBaseSerial.connect(path, options, mainWindow);
  });

  ipcMain.handle('rtkBaseSend', (_event, data, connectionId) => {
    return rtkBaseSerial.send(data, connectionId);
  });

  ipcMain.handle('rtkBaseClose', (_event, connectionId) => {
    return rtkBaseSerial.close(connectionId);
  });

  ipcMain.handle('ntripConnect', async (_event, settings) => {
    try {
      return await ntripClient.connect(settings);
    } catch (error) {
      return { error: true, msg: error?.message || String(error) };
    }
  });

  ipcMain.handle('ntripListMountpoints', async (_event, settings) => {
    try {
      return { error: false, sourcetable: await ntripClient.fetchSourcetable(settings) };
    } catch (error) {
      return { error: true, msg: error?.message || String(error) };
    }
  });

  ipcMain.handle('ntripSendGga', (_event, sentence) => {
    return ntripClient.sendGga(sentence);
  });

  ipcMain.handle('ntripClose', () => ntripClient.close());

  ipcMain.handle('udpConnect', (_event, ip, port) => {
    return udp.connect(ip, port, mainWindow);
  });

  ipcMain.handle('udpSend', (_event, data) => {
    return udp.send(data);
  });

  ipcMain.on('udpClose', (_event) => {
    udp.close();
  });

  ipcMain.handle('writeFile', (_event, filename, data) => {
    return new Promise(async resolve => {
      try {
        await writeFile(filename, data);
        resolve(false)
      } catch (err) {
        resolve(err);
      }
    });
  });

  ipcMain.handle('appendFile', async (_event, filename, data) => {
    try {
      await appendFile(filename, data);
      return false;
    } catch (err) {
      // Re-throwing the error will cause the promise on the renderer side to be rejected.
      throw err;
    }
  });

  ipcMain.handle('readFile', (_event, filename, encoding) => {
    return new Promise(async resolve => {
      try {
        const data = await readFile(filename, {encoding: encoding});
        
        resolve({error: false, data: data});
      } catch (err) {
        resolve({error: err});
      }
    });
  });

  ipcMain.handle('listBundledFlightCommanderFirmware', async () => {
    try {
      const files = await readdir(getFlightCommanderFirmwareBasePath());
      return files.filter((file) => FLIGHT_COMMANDER_FIRMWARE_FILENAME.test(file));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  });

  ipcMain.handle('readBundledFlightCommanderFirmware', async (_event, filename) => {
    try {
      const data = await readFile(resolveBundledFlightCommanderFirmware(filename), 'utf8');
      return { error: false, data };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  });

  ipcMain.handle('chmod', (_event, pathName, mode) => {
    return new Promise(resolve => {
      chmod(path.join(getSitlBasePath(), pathName), mode, error => {
        if (error) {
          resolve(error.message)
        } else {
          resolve(false)
        }
      });
    });
  });

  ipcMain.handle('rm', (_event, path) => {
    return new Promise(resolve => {
      rm(path, error => {
        if (error) {
          resolve(error.message)
        } else {
          resolve(false)
        }
      });
    });
  });

  ipcMain.handle('getBackupDir', (_event) => {
    const backupDir = path.join(app.getPath('userData'), 'inav-backups');
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    return backupDir;
  });

  ipcMain.handle('openBackupDir', (_event) => {
    const backupDir = path.join(app.getPath('userData'), 'inav-backups');
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    shell.openPath(backupDir); // fire-and-forget: xdg-open on Linux never exits
    return backupDir;
  });

  ipcMain.handle('listBackups', async (_event) => {
    const backupDir = path.join(app.getPath('userData'), 'inav-backups');
    if (!existsSync(backupDir)) {
      return [];
    }
    const files = await readdir(backupDir);
    return files.filter(f => f.endsWith('.txt') || f.endsWith('.cli'));
  });

  ipcMain.on('startChildProcess', (_event, command, args, opts) => {
    child_process.start(path.join(getSitlBasePath(), command), args, opts, mainWindow);
  });

  ipcMain.on('killChildProcess', (_event) => {
    child_process.stop();
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
