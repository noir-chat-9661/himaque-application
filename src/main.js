const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
let c1 = 0,
	c2 = 0;

let isMainWindow = false;

const Store = require("electron-store").default;
const store = new Store();

const { autoUpdater } = require("electron-updater");

autoUpdater.on("update-available", () => {
	autoUpdater.downloadUpdate().then(() => {
		dialog.showMessageBox({
			buttons: ["OK"],
			message:
				"新しいバージョンが公開されています。\nダウンロード終了後、再起動します。\n(ダウンロードは少し時間がかかります)",
		});
	});
});
autoUpdater.on("update-downloaded", (info) => {
	autoUpdater.quitAndInstall();
});
const state = {
	use: {
		exitField: false,
		partyReady: false,
	},
	links: {
		exitField: [],
		partyReady: [],
	},
};

const hcqLinks = [
	{
		url: "https://himaquest.com",
		id: 0,
		name: null,
	},
	{
		url: "http://himaquest.com.",
		id: 1,
		name: null,
	},
	{
		url: "http://www.himaquest.com",
		id: 2,
		name: null,
	},
	{
		url: "http://www.himaquest.com.",
		id: 3,
		name: null,
	},
	{
		url: "http://sub1.himaquest.com",
		id: 4,
		name: null,
	},
	{
		url: "http://sub1.himaquest.com.",
		id: 5,
		name: null,
	},
	{
		url: "http://sub2.himaquest.com",
		id: 6,
		name: null,
	},
	{
		url: "http://sub2.himaquest.com.",
		id: 7,
		name: null,
	},
	{
		url: "http://sub3.himaquest.com",
		id: 8,
		name: null,
	},
	{
		url: "http://sub3.himaquest.com.",
		id: 9,
		name: null,
	},
];

const setting = store.get("setting") || {
	windowCount: 1,
	addon: false,
	more_setting: "a",
	addonModules: {
		multilinechat: false,
		chatmaxup: false,
		displaystatus: false,
		morepresets: false,
		morefilter: false,
	},
	type: "a",
	mode: "tab",
	size: {
		modeSelect: {
			width: 800,
			height: 600,
		},
		main: {
			width: 960,
			height: 720,
		},
	},
};

app.setAboutPanelOptions({
	applicationName: "ヒマクエ専用ブラウザ Meteor",
	applicationVersion: require("../package.json").version,
	copyright: "©︎マグナム中野 (HIMACHATQUEST) 凶兆の黒猫(addon・Meteor)",
	authors: "マグナム中野、凶兆の黒猫",
	website: "https://addon.pjeita.top/",
});

let versionChecked = !app.isPackaged;

const keytar = require("keytar");
const SERVICE = "electron.himaqueapp.meteor" + !app.isPackaged ? "_dev" : "";
const ACCOUNT = "meteor_masterkey";

let masterkey = "";
const password = store.get("password") || [];

const crypto = require("crypto");
const { get } = require("http");

function addPassword(data, place = password.length) {
	const { password: pass } = data;
	const salt = crypto.randomBytes(16);
	const key = crypto.scryptSync(masterkey, salt, 32);
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(pass, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();

	password.splice(place, 0, {
		...data,
		password: [
			salt.toString("base64"),
			iv.toString("base64"),
			tag.toString("base64"),
			encrypted.toString("base64"),
		].join(":"),
	});
	store.set("password", password);
}

function getPassword() {
	const data = [];
	for (let i = 0; i < password.length; i++) {
		const { password: pass } = password[i];
		const [saltB64, ivB64, tagB64, encryptedB64] = pass.split(":");
		const salt = Buffer.from(saltB64, "base64");
		const key = crypto.scryptSync(masterkey, salt, 32);
		const iv = Buffer.from(ivB64, "base64");
		const tag = Buffer.from(tagB64, "base64");
		const encrypted = Buffer.from(encryptedB64, "base64");
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		data.push({
			...password[i],
			password: Buffer.concat([
				decipher.update(encrypted),
				decipher.final(),
			]).toString("utf8"),
		});
	}
	return data;
}

keytar.getPassword(SERVICE, ACCOUNT).then((result) => {
	if (result) {
		masterkey = result;
	} else {
		const masterKey = crypto.randomUUID();
		keytar.setPassword(SERVICE, ACCOUNT, masterKey).then(() => {
			masterkey = masterKey;
		});
	}
});

ipcMain.handle("password", () => {
	return getPassword();
});

ipcMain.on("password", (e, data) => {
	if (data.type == "add") {
		const { userdata } = data.data;
		const index = password.findIndex((n) => n.userdata.id == userdata.id);
		if (index !== -1) {
			password.splice(index, 1);
			addPassword(data.data, index);
		} else {
			addPassword(data.data);
		}
	} else if (data.type == "delete") {
		const hcqId = data.id;
		const index = password.findIndex((n) => n.userdata.id == hcqId);
		if (index !== -1) {
			password.splice(index, 1);
		}
		store.set("password", password);
	} else if (data.type == "memo") {
		const { userdata, memo } = data.data;
		const index = password.findIndex((n) => n.userdata.id == userdata.id);
		if (index !== -1) {
			password[index].memo = memo;
			store.set("password", password);
		}
	}
});

ipcMain.on("passwordsort", (e, data) => {
	const p = data.map((n) => password.find((m) => m.userdata.id == n));
	password.length = 0;
	password.push(...p);
});

ipcMain.handle("ougipreset", (d, e) => {
	return (
		store.get("ougipreset") || {
			version: 3,
			data: {
				ougi: [],
			},
		}
	);
});

ipcMain.on("ougipreset", (e, d) => {
	store.set("ougipreset", d);
});

ipcMain.on("tabAdd", () => {
	if (setting.mode == "window") return;
	mainWindow.webContents.send("tabAdd");
});
ipcMain.on("tabClose", () => {
	if (setting.mode == "window") return;
	mainWindow.webContents.send("tabClose");
});
ipcMain.on("tabChange", (e, d) => {
	if (setting.mode == "window") return;
	mainWindow.webContents.send("tabChange", d.reverse);
});
ipcMain.on("tabReload", (e, d) => {
	if (setting.mode == "window") return;
	mainWindow.webContents.send("tabReload", 1);
});
ipcMain.on("state", (e, d) => {
	if (d.type == "exitField") {
		state.use.exitField = true;
		state.links.exitField.length = 0;
		setTimeout(() => {
			state.use.exitField = false;
			state.links.exitField.length = 0;
		}, 1500);
	}
	if (d.type == "partyReady") {
		state.use.partyReady = true;
		state.links.partyReady.length = 0;
		setTimeout(() => {
			state.use.partyReady = false;
			state.links.partyReady.length = 0;
		}, 1500);
	}
});
ipcMain.handle("state", (e, d) => {
	const { url, name } = d;
	const returnValue = {};
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
	if (setting.mode == "tab") {
		const d = hcqLinks.find((n) => n.url == url);
		if (d.name != name) {
			d.name = name;
			mainWindow.webContents.send("nameChange", {id: d.id, name});
		}
	}
	return returnValue;
});

app.once("ready", async () => {
	ipcMain.on("ready", async (e) => {
		const { net: { fetch } } = require('electron')
		const modules = await fetch("https://addon.pjeita.top/module/modules.json", {
			cache: "no-store",
		})
			.then((n) => n.json())
		setting.addonData = [];
		modules.forEach((n) => {
			if (app.isPackaged && n.beta) return;
			if (!(n.id in setting.addonModules)) {
				setting.addonModules[n.id] = false;
			}
			setting.addonData.push(n);
		});
		return (e.returnValue = setting);
	});
});

let mainWindow = null;

app.on("ready", () => {
	if (!versionChecked) autoUpdater.checkForUpdatesAndNotify();
	start();
});

autoUpdater.on("update-not-available", () => {
	versionChecked = true;
});
autoUpdater.on("update-cancelled", () => {
	versionChecked = true;
});
autoUpdater.on("error", () => {
	versionChecked = true;
});

function start() {
	mainWindow = null;
	c2 = 0;
	if (!setting.size)
		setting.size = {
			modeSelect: {
				width: 800,
				height: 600,
				maximized: false,
			},
			main: {
				width: 960,
				height: 720,
				maximized: false,
			},
		};
	const modeSelectWindow = new BrowserWindow({
		width: setting.size.modeSelect.width || 800,
		height: setting.size.modeSelect.height || 600,
		show: false,
		webPreferences: {
			devTools: !app.isPackaged,
			preload: path.join(__dirname, "preload_ModeSelect.js"),
		},
	});
	nowWindow = modeSelectWindow;
	if (!app.isPackaged) modeSelectWindow.webContents.openDevTools();

	app.once("activate", () => {
		if (!BrowserWindow.getAllWindows().length) createWindow();
	});
	modeSelectWindow.loadFile(path.join(__dirname, "ModeSelect.html"));
	modeSelectWindow.once("ready-to-show", () => {
		if (versionChecked) {
			modeSelectWindow.show();
			if (setting.size.modeSelect.maximized)
				modeSelectWindow.maximize();
		} else {
			autoUpdater.on("update-not-available", () => {
				modeSelectWindow.show();
				if (setting.size.modeSelect.maximized)
					modeSelectWindow.maximize();
			});
			autoUpdater.on("update-cancelled", () => {
				modeSelectWindow.show();
				if (setting.size.modeSelect.maximized)
					modeSelectWindow.maximize();
			});
			autoUpdater.on("error", () => {
				modeSelectWindow.show();
				if (setting.size.modeSelect.maximized)
					modeSelectWindow.maximize();
			});
		}
	});
	modeSelectWindow.once("close", () => {
		if (c1) return;
		if (process.platform === "darwin") return;
		if (modeSelectWindow.isMaximized()) {
			setting.size.modeSelect.maximized = true;
		} else {
			setting.size.modeSelect.maximized = false;
			setting.size.modeSelect.width =
				modeSelectWindow.getBounds().width;
			setting.size.modeSelect.height =
				modeSelectWindow.getBounds().height;
		}
		app.exit();
	});
	modeSelectWindow.webContents.on("did-create-window", (w, e) => {
		w.setMenuBarVisibility(false);
	});
	modeSelectWindow.setMenuBarVisibility(false);
	ipcMain.once("start", (e, obj) => {
		c1 = 1;
		if (modeSelectWindow.isMaximized()) {
			setting.size.modeSelect.maximized = true;
		} else {
			setting.size.modeSelect.maximized = false;
			setting.size.modeSelect.width =
				modeSelectWindow.getBounds().width;
			setting.size.modeSelect.height =
				modeSelectWindow.getBounds().height;
		}
		modeSelectWindow.close();

		mainWindow = new BrowserWindow({
			width: setting.size.main.width,
			height: setting.size.main.height,
			show: false,
			webPreferences: {
				devTools: !app.isPackaged,
				preload: path.join(__dirname, "preload.js"),
				contextIsolation: false,
				nodeIntegration: false,
				nodeIntegrationInSubFrames: true,
				allowRunningInsecureContent: true,
				webSecurity: false,
			},
		});
		nowWindow = mainWindow;

		if (!app.isPackaged) mainWindow.webContents.openDevTools();

		setting.windowCount = obj.windowCount;
		setting.addon = obj.addon;
		setting.type = obj?.type || "a";
		setting.addonModules = obj.addonModules;
		setting.mode = obj.mode;

		for (let i = 0; i < hcqLinks.length; i++) hcqLinks[i].name = null;
		store.set("setting", setting);

		mainWindow.loadFile(path.join(__dirname, `${obj.mode}.html`));

		mainWindow.once("ready-to-show", () => {
			mainWindow.show();
			if (setting.size.main.maximized) mainWindow.maximize();
			isMainWindow = true;
		});
		mainWindow.on("close", () => {
			isMainWindow = false;
			if (c2) return;
			if (process.platform === "darwin") return;
			if (mainWindow.isMaximized()) {
				setting.size.main.maximized = true;
			} else {
				setting.size.main.maximized = false;
				setting.size.main.width = mainWindow.getBounds().width;
				setting.size.main.height = mainWindow.getBounds().height;
			}
			app.exit();
		});
		mainWindow.webContents.once("did-create-window", (w, e) => {
			w.setMenuBarVisibility(false);
		});
	});
}

ipcMain.on("startgame", (e) => {
	return (e.returnValue = {
		addon: setting.addon,
		addonData: setting.addonData,
		addonModules: setting.addonModules,
		windowCount: setting.windowCount,
		type: setting.type,
		mode: setting.mode,
	});
});

app.on("quit", () => {
	store.set("setting", setting);
});

const templateMenu = [
	...(process.platform == "darwin"
		? [
				{
					label: "Meteor",
					submenu: [{ label: "このアプリについて", role: "about" }],
				},
		  ]
		: []),
	{
		label: "編集",
		submenu: [
			{ label: "元に戻す", role: "undo" },
			{ label: "やり直し", role: "redo" },
			{ type: "separator" },
			{ label: "切り取り", role: "cut" },
			{ label: "コピー", role: "copy" },
			{ label: "ペースト", role: "paste" },
		],
	},
	{
		label: "選択",
		submenu: [{ label: "すべて選択", role: "selectAll" }],
	},
	{
		label: "表示",
		submenu: [
			{ label: "再読み込み", role: "reload" },
			{ type: "separator" },
			{ role: "togglefullscreen", label: "全画面表示" },
			{ type: "separator" },
			{ role: "quit", label: "終了" },
		],
	},
	{
		label: "設定",
		submenu: [
			{
				label: "窓数・アドオン有無の切り替え",
				click(item, focusedWindow) {
					if (!isMainWindow) return;
					if (focusedWindow) {
						c2 = 1;
						if (focusedWindow.isMaximized()) {
							setting.size.main.maximized = true;
						} else {
							setting.size.main.maximized = false;
							setting.size.main.width =
								focusedWindow.getBounds().width;
							setting.size.main.height =
								focusedWindow.getBounds().height;
						}
						focusedWindow.close();
						start();
					}
				},
			},
			/*
				{
					label: "パスワードマネージャー",
					click(item, focusedWindow) {
					},
				}
			*/
		],
	},
	{
		label: "一括操作",
		submenu: [
			{
				label: "一斉準備完了",
				click(item, focusedWindow) {
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
				label: "一斉帰宅",
				click(item, focusedWindow) {
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
