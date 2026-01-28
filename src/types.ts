export interface UserData {
	id: string | number;
	[key: string]: any;
}

export interface PasswordEntry {
	userdata: UserData;
	password: string;
	memo?: string;
	[key: string]: any;
}

export interface HCQLink {
	url: string;
	id: number;
	name: string | null;
}

export interface SizeConfig {
	width?: number;
	height?: number;
	maximized?: boolean;
}

export interface Setting {
	windowCount: number;
	addon: boolean;
	more_setting: string;
	addonModules: { [key: string]: boolean };
	type: string;
	mode: string;
	size: {
		modeSelect: SizeConfig;
		main: SizeConfig;
	};
	proxy?: {
		enable: boolean;
		url: string;
	};
	addonData?: any[];
	version?: string;
}
