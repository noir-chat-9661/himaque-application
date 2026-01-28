import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell } from 'electron';
import log from 'electron-log';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';
import keytar from 'keytar';
import pkg from '../package.json';
import type { HCQLink, PasswordEntry, Setting } from './types';

let isMainWindow = false;

const store = new Store();

// Log Setup
log.transports.file.level = 'info';
autoUpdater.autoDownload = false;

autoUpdater.on('checking-for-update', () => {
	log.info('アップデートを確認中...');
});
autoUpdater.on('update-available', (info) => {
	log.info('アップデートあり:', info);
	// Force Update Logic
	if (process.platform === 'darwin') {
		const url = `https://github.com/noir-chat-9661/himaque-application/releases/download/v${info.version}/Meteor-${info.version}-${process.arch}.dmg`;
		log.info('Download URL:', url);

		// Manual Download for Mac
		const tempPath = path.join(app.getPath('temp'), `Meteor-${info.version}.dmg`);
		const file = fs.createWriteStream(tempPath);

		net.fetch(url)
			.then(async (res) => {
				if (!res.ok) throw new Error(`Unexpected response ${res.statusText}`);
				// @ts-ignore: node-fetch/electron-fetch stream piping
				if (res.body) {
					// Electron's net.fetch returns a ReadableStream (web stream), not Node stream.
					// We need to read it.
					const reader = res.body.getReader();
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						file.write(value);
					}
					file.end();
				}
			})
			.then(() => {
				file.close(() => {
					log.info('Download complete. Opening DMG...');
					shell.openPath(tempPath);
					app.quit();
				});
			})
			.catch((err) => {
				log.error('Download failed:', err);
				// Fallback to normal open if failed? Or just error.
				// For forced update, we might want to retry or alert user.
				// For now, let's open window so they aren't locked out?
				createWindow();
			});
	} else {
		// Windows/Linux - Auto Download
		autoUpdater.downloadUpdate();
	}
});
autoUpdater.on('update-not-available', (info) => {
	log.info('アップデートなし:', info);
	createWindow(); // Open app
});
autoUpdater.on('error', (err) => {
	log.error('エラー発生:', err);
	createWindow(); // Open app on error (fail-safe)
});
autoUpdater.on('download-progress', (progressObj) => {
	log.info('ダウンロード中:', progressObj.percent + '%');
});
autoUpdater.on('update-downloaded', () => {
	log.info('ダウンロード完了。再起動してインストールします。');
	autoUpdater.quitAndInstall();
});

app.whenReady().then(async () => {
	// Ensuring master key is loaded before starting
	await initMasterKey();

	if (!app.isPackaged) {
		// Dev mode: Skip update check
		createWindow();
	} else {
		autoUpdater.checkForUpdates();
	}
});

const state = {
	use: {
		exitField: false,
		partyReady: false,
	},
	links: {
		exitField: [] as string[],
		partyReady: [] as string[],
	},
};

const hcqLinks: HCQLink[] = [
	{ url: 'https://himaquest.com', id: 0, name: null },
	{ url: 'http://himaquest.com.', id: 1, name: null },
	{ url: 'http://www.himaquest.com', id: 2, name: null },
	{ url: 'http://www.himaquest.com.', id: 3, name: null },
	{ url: 'http://sub1.himaquest.com', id: 4, name: null },
	{ url: 'http://sub1.himaquest.com.', id: 5, name: null },
	{ url: 'http://sub2.himaquest.com', id: 6, name: null },
	{ url: 'http://sub2.himaquest.com.', id: 7, name: null },
	{ url: 'http://sub3.himaquest.com', id: 8, name: null },
	{ url: 'http://sub3.himaquest.com.', id: 9, name: null },
];

const defaultSetting: Setting = {
	windowCount: 1,
	addon: false,
	more_setting: 'a',
	addonModules: {
		multilinechat: false,
		chatmaxup: false,
		displaystatus: false,
		morepresets: false,
		morefilter: false,
	},
	type: 'a',
	mode: 'tab',
	size: {
		modeSelect: { width: 800, height: 600 },
		main: { width: 960, height: 720 },
	},
};

const setting = (store.get('setting') as Setting) || defaultSetting;

app.setAboutPanelOptions({
	applicationName: 'ヒマクエ専用ブラウザ Meteor',
	applicationVersion: pkg.version,
	copyright: '©︎マグナム中野 (HIMACHATQUEST)\n凶兆の黒猫(addon・Meteor)',
	authors: ['マグナム中野', '凶兆の黒猫'],
	website: 'https://addon.pjeita.top/',
});

const SERVICE = 'electron.himaqueapp.meteor' + (!app.isPackaged ? '_dev' : '');
const ACCOUNT = 'meteor_masterkey';

let masterkey = '';
const password: PasswordEntry[] = (store.get('password') as PasswordEntry[]) || [];

function addPassword(data: any, place = password.length) {
	const { password: pass } = data;
	const salt = crypto.randomBytes(16);
	const key = crypto.scryptSync(masterkey, salt, 32);
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(pass, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	password.splice(place, 0, {
		...data,
		password: [
			salt.toString('base64'),
			iv.toString('base64'),
			tag.toString('base64'),
			encrypted.toString('base64'),
		].join(':'),
	});
	store.set('password', password);
}

function getPassword() {
	const data = [];
	for (let i = 0; i < password.length; i++) {
		const { password: pass } = password[i];
		const [saltB64, ivB64, tagB64, encryptedB64] = pass.split(':');
		const salt = Buffer.from(saltB64, 'base64');
		const key = crypto.scryptSync(masterkey, salt, 32);
		const iv = Buffer.from(ivB64, 'base64');
		const tag = Buffer.from(tagB64, 'base64');
		const encrypted = Buffer.from(encryptedB64, 'base64');
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag);
		data.push({
			...password[i],
			password: Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'),
		});
	}
	return data;
}

async function initMasterKey() {
	const result = await keytar.getPassword(SERVICE, ACCOUNT);
	if (result) {
		masterkey = result;
	} else {
		const legacyResult = await keytar.getPassword('_dev', ACCOUNT);
		if (legacyResult) {
			masterkey = legacyResult;
			await keytar.setPassword(SERVICE, ACCOUNT, legacyResult);
		} else {
			const masterKey = crypto.randomUUID();
			await keytar.setPassword(SERVICE, ACCOUNT, masterKey);
			masterkey = masterKey;
		}
	}
}

ipcMain.handle('password', () => {
	return getPassword();
});

ipcMain.on('password', (_, data) => {
	if (data.type === 'add') {
		const { userdata } = data.data;
		const index = password.findIndex((n) => n.userdata.id === userdata.id);
		if (index !== -1) {
			password.splice(index, 1);
			addPassword(data.data, index);
		} else {
			addPassword(data.data);
		}
	} else if (data.type === 'delete') {
		const hcqId = data.id;
		const index = password.findIndex((n) => n.userdata.id === hcqId);
		if (index !== -1) {
			password.splice(index, 1);
		}
		store.set('password', password);
	} else if (data.type === 'memo') {
		const { userdata, memo } = data.data;
		const index = password.findIndex((n) => n.userdata.id === userdata.id);
		if (index !== -1) {
			password[index].memo = memo;
			store.set('password', password);
		}
	}
});

ipcMain.on('passwordsort', (_, data: any[]) => {
	const p = data.map((n) => password.find((m) => m.userdata.id === n));
	// Filter out undefined if find fails (though logic assumes it exists)
	const validP = p.filter((item): item is PasswordEntry => item !== undefined);
	password.length = 0;
	password.push(...validP);
});

ipcMain.handle('ougipreset', () => {
	return (
		store.get('ougipreset') || {
			version: 3,
			data: {
				ougi: [],
			},
		}
	);
});

ipcMain.on('ougipreset', (_, d) => {
	store.set('ougipreset', d);
});

ipcMain.on('tabAdd', () => {
	if (setting.mode === 'window') return;
	mainWindow?.webContents.send('tabAdd');
});
ipcMain.on('tabClose', () => {
	if (setting.mode === 'window') return;
	mainWindow?.webContents.send('tabClose');
});
ipcMain.on('tabChange', (_, d) => {
	if (setting.mode === 'window') return;
	mainWindow?.webContents.send('tabChange', d.reverse);
});
ipcMain.on('tabReload', () => {
	if (setting.mode === 'window') return;
	mainWindow?.webContents.send('tabReload', 1);
});
ipcMain.on('state', (_, d) => {
	if (d.type === 'exitField') {
		state.use.exitField = true;
		state.links.exitField.length = 0;
		setTimeout(() => {
			state.use.exitField = false;
			state.links.exitField.length = 0;
		}, 1500);
	}
	if (d.type === 'partyReady') {
		state.use.partyReady = true;
		state.links.partyReady.length = 0;
		setTimeout(() => {
			state.use.partyReady = false;
			state.links.partyReady.length = 0;
		}, 1500);
	}
});
ipcMain.handle('state', (_, d) => {
	const { url, name } = d;
	const returnValue: any = {};
	if (state.use.exitField) {
		if (!state.links.exitField.includes(url)) {
			state.links.exitField.push(url);
			returnValue.exitField = true;
		}
	}
	if (state.use.partyReady) {
		if (!state.links.partyReady.includes(url)) {
			state.links.partyReady.push(url);
			returnValue.partyReady = true;
		}
	}
	if (setting.mode === 'tab') {
		const d = hcqLinks.find((n) => n.url === url);
		if (d) {
			if (d.name !== name) {
				d.name = name;
				mainWindow?.webContents.send('nameChange', { id: d.id, name });
			}
		}
	}
	return returnValue;
});

app.once('ready', async () => {
	ipcMain.on('ready', async (e) => {
		const modules: any = await net
			.fetch('https://addon.pjeita.top/module/modules.json', {
				cache: 'no-store',
			})
			.then((n: any) => n.json());

		setting.addonData = [];
		modules.forEach((n: any) => {
			if (app.isPackaged && n.beta) return;
			if (!(n.id in setting.addonModules)) {
				setting.addonModules[n.id] = false;
			}
			setting.addonData?.push(n);
		});
		setting.version = pkg.version;
		e.returnValue = setting;
		return setting;
	});
});

let mainWindow: BrowserWindow | null = null;

// app.on('ready') merged into app.whenReady() above

// Rename 'start' to 'createWindow' to match call in app.whenReady
function createWindow() {
	mainWindow = null;
	// Removed c2 = 0;
	// Initialize sizes if missing
	if (!setting.size)
		setting.size = {
			modeSelect: { width: 800, height: 600, maximized: false },
			main: { width: 960, height: 720, maximized: false },
		};

	// Create the single main window
	mainWindow = new BrowserWindow({
		width: setting.size.modeSelect.width || 800,
		height: setting.size.modeSelect.height || 600,
		show: false,
		webPreferences: {
			devTools: !app.isPackaged,
			// Changed path to point to src from dist
			preload: path.join(__dirname, '../src/preload.js'),
			contextIsolation: false,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: true,
			allowRunningInsecureContent: true,
			webSecurity: false,
		}
	});

	if (!app.isPackaged) mainWindow.webContents.openDevTools();


	// Changed path to point to src from dist
	mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

	mainWindow.once('ready-to-show', () => {
		mainWindow?.setMenuBarVisibility(false);
		if (mainWindow) {
			mainWindow.show();
			if (setting.size.modeSelect.maximized) mainWindow.maximize();
		}
	});

	mainWindow.on('close', () => {
		app.exit();
	});
}

// Handle "start" command from renderer (Mode Selection -> Game)
// Handle "start" command from renderer (Mode Selection -> Game)
ipcMain.on('start', async (_, obj) => {
	if (!mainWindow) return;

	// Update settings
	setting.windowCount = obj.windowCount;
	setting.addon = obj.addon;
	setting.type = obj?.type || 'a';
	setting.addonModules = obj.addonModules;
	setting.mode = obj.mode;
	setting.proxy = obj.proxy; // Save proxy settings

	// Reset names
	for (let i = 0; i < hcqLinks.length; i++) hcqLinks[i].name = null;
	store.set('setting', setting);

	// Apply Proxy if enabled
	try {
		if (setting.proxy?.enable && setting.proxy.url) {
			const proxyConfig = { proxyRules: setting.proxy.url };
			await mainWindow.webContents.session.setProxy(proxyConfig);
			log.info(`Proxy set to: ${setting.proxy?.url}`);
		} else {
			// Clear proxy if disabled
			await mainWindow.webContents.session.setProxy({ proxyRules: '' });
		}
	} catch (err) {
		log.error('Failed to set proxy:', err);
	}

	// Resize to Main Size
	if (setting.size.main.maximized) {
		mainWindow.maximize();
	} else {
		mainWindow.setSize(setting.size.main.width || 960, setting.size.main.height || 720);
		mainWindow.center();
	}

	isMainWindow = true; // Mark as Game Running

	// Tell renderer to switch UI
	mainWindow.webContents.send('init-game', setting);
});

ipcMain.handle('proxy-test', async (_, proxyUrl) => {
	if (!proxyUrl) return false;
	try {
		// Create a temporary session for testing
		const { session } = require('electron');
		const testSession = session.fromPartition('proxy-test-partition');
		await testSession.setProxy({ proxyRules: proxyUrl });

		// Attempt fetch
		await net.fetch('https://himaquest.com', {
			method: 'HEAD',
			session: testSession,
		} as any);
		return true;
	} catch (e) {
		log.error('Proxy test failed:', e);
		return false;
	}
});

ipcMain.on('startgame', (e) => {
	if (mainWindow) mainWindow.setMenuBarVisibility(true);
	const returnValue = {
		addon: setting.addon,
		addonData: setting.addonData,
		addonModules: setting.addonModules,
		windowCount: setting.windowCount,
		type: setting.type,
		mode: setting.mode,
	};
	e.returnValue = returnValue;
	return returnValue;
});

app.on('quit', () => {
	store.set('setting', setting);
});

// Helper to prompt password
function promptPassword(type: string): Promise<string | null> {
	return new Promise((resolve) => {
		if (!mainWindow) return resolve(null);
		mainWindow.webContents.send('prompt-password', type);
		ipcMain.once('password-result', (_, res) => {
			resolve(res.password);
		});
	});
}

async function exportPasswords() {
	const passwordStr = await promptPassword('export');
	if (!passwordStr) return; // Cancelled

	const data = getPassword(); // Decrypted list
	const json = JSON.stringify(data);

	// Encrypt JSON with provided password
	try {
		const salt = crypto.randomBytes(16);
		const key = crypto.scryptSync(passwordStr, salt, 32);
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
		const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
		const tag = cipher.getAuthTag();

		// Format: salt:iv:tag:encrypted (base64)
		const output = [
			salt.toString('base64'),
			iv.toString('base64'),
			tag.toString('base64'),
			encrypted.toString('base64'),
		].join(':');

		if (mainWindow) {
			dialog
				.showSaveDialog(mainWindow, {
					title: 'パスワードをエクスポート',
					defaultPath: 'meteor_passwords.dat',
					filters: [{ name: 'Meteor Data', extensions: ['dat'] }],
				})
				.then((result) => {
					if (!result.canceled && result.filePath) {
						fs.writeFileSync(result.filePath, output, 'utf-8');
						if (mainWindow)
							dialog.showMessageBox(mainWindow, { message: '暗号化してエクスポートしました。' });
					}
				});
		}
	} catch (e) {
		console.error(e);
		dialog.showErrorBox('エラー', '暗号化に失敗しました。');
	}
}

async function importPasswords() {
	if (!mainWindow) return;
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: 'パスワードをインポート',
		filters: [{ name: 'Meteor Data', extensions: ['dat'] }],
		properties: ['openFile'],
	});

	if (canceled || filePaths.length === 0) return;

	const filePath = filePaths[0];
	const inputPwd = await promptPassword('import');
	if (!inputPwd) return; // Cancelled

	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const [saltB64, ivB64, tagB64, encryptedB64] = content.split(':');

		if (!saltB64 || !ivB64 || !tagB64 || !encryptedB64) {
			throw new Error('Invalid format');
		}

		const salt = Buffer.from(saltB64, 'base64');
		const iv = Buffer.from(ivB64, 'base64');
		const tag = Buffer.from(tagB64, 'base64');
		const encrypted = Buffer.from(encryptedB64, 'base64');

		const key = crypto.scryptSync(inputPwd, salt, 32);
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag);

		const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
		const data = JSON.parse(decrypted);

		if (!Array.isArray(data)) {
			throw new Error('Invalid JSON structure');
		}

		let addedCount = 0;
		data.forEach((item) => {
			const existsIndex = password.findIndex((p) => p.userdata?.id === item.userdata?.id);
			if (existsIndex !== -1) {
				password.splice(existsIndex, 1);
				addPassword(item, existsIndex);
			} else {
				addPassword(item);
			}
			addedCount++;
		});

		dialog.showMessageBox({ message: `${addedCount}件のパスワードをインポートしました。` });
	} catch (err) {
		console.error(err);
		dialog.showErrorBox('エラー', 'インポートに失敗しました。パスワードが間違っていないか確認してください。');
	}
}

const templateMenu: Electron.MenuItemConstructorOptions[] = [
	...(process.platform === 'darwin'
		? [
				{
					label: 'Meteor',
					submenu: [{ label: 'このアプリについて', role: 'about' } as Electron.MenuItemConstructorOptions],
				},
			]
		: []),
	{
		label: '編集',
		submenu: [
			{ label: '元に戻す', role: 'undo' },
			{ label: 'やり直し', role: 'redo' },
			{ type: 'separator' },
			{ label: '切り取り', role: 'cut' },
			{ label: 'コピー', role: 'copy' },
			{ label: 'ペースト', role: 'paste' },
		],
	},
	{
		label: '選択',
		submenu: [{ label: 'すべて選択', role: 'selectAll' }],
	},
	{
		label: '表示',
		submenu: [
			{ label: '再読み込み', role: 'reload' },
			{ type: 'separator' },
			{ role: 'togglefullscreen', label: '全画面表示' },
			{ type: 'separator' },
			{ role: 'quit', label: '終了' },
		],
	},
	{
		label: '設定',
		submenu: [
			{
				label: '窓数・アドオン有無の切り替え',
				click(_, focusedWindow) {
					const target = focusedWindow || mainWindow;
					if (target) {
						// Save current Main Window size
						if (target.isMaximized()) {
							setting.size.main.maximized = true;
						} else {
							setting.size.main.maximized = false;
							setting.size.main.width = target.getBounds().width;
							setting.size.main.height = target.getBounds().height;
						}

						// Restore Mode Select size
						if (setting.size.modeSelect.maximized) {
							target.maximize();
						} else {
							target.setSize(setting.size.modeSelect.width || 800, setting.size.modeSelect.height || 600);
							target.center();
						}
						target.setMenuBarVisibility(false);

						// Reload to resetting UI to Mode Select
						isMainWindow = false; // Reset game state flag
						target.reload();
					}
				},
			},
			{ type: 'separator' },
			{
				label: 'パスワードをインポート',
				click() {
					importPasswords();
				},
			},
			{
				label: 'パスワードをエクスポート',
				click() {
					exportPasswords();
				},
			},
		],
	},
	{
		label: '一括操作',
		submenu: [
			{
				label: '一斉準備完了',
				click(_, focusedWindow) {
					if (!isMainWindow) return;
					if (focusedWindow) {
						state.use.partyReady = true;
						state.links.partyReady.length = 0;
						setTimeout(() => {
							state.use.partyReady = false;
							state.links.partyReady.length = 0;
						}, 1500);
					}
				},
			},
			{
				label: '一斉帰宅',
				click(_, focusedWindow) {
					if (!isMainWindow) return;
					if (focusedWindow) {
						state.use.exitField = true;
						state.links.exitField.length = 0;
						setTimeout(() => {
							state.use.exitField = false;
							state.links.exitField.length = 0;
						}, 1500);
					}
				},
			},
		],
	},
];

const menu = Menu.buildFromTemplate(templateMenu);
Menu.setApplicationMenu(menu);
